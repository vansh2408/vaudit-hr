/**
 * Tests for `importEmployeesFromCsv` (lib/csv/import.ts) — A16.
 *
 * Coverage:
 *   - dry-run path: row statuses (insert/update/skip/error), no DB writes.
 *   - commit path: rows persist; cycle in proposed graph blocks the import.
 *   - duplicate-email in CSV → error row.
 *   - missing required column → Zod error per row.
 *   - existing-email "skip" vs "update" policy paths.
 *
 * Size cap (2 MB) is enforced at the route layer (app/api/admin/employees/
 * import/route.ts) and is covered by an E2E test instead.
 *
 * The function uses the global db internally; we clean up by hand. Because
 * the commit path opens its own transaction, our `withDbTransaction`
 * rollback cannot reach those writes — same pattern as the cancel /
 * deactivate tests.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { closeTestPool } from "../../e2e/helpers/db";
import {
  auditLogs,
  leaveBalances,
  leaveTypes,
  users,
} from "@/lib/db/schema";

const HAS_TEST_DB =
  !!process.env["DATABASE_URL_TEST"] || !!process.env["DATABASE_URL"];
const dbDescribe = HAS_TEST_DB ? describe : describe.skip;

const CSV_HEADER =
  "firstName,lastName,email,phone,address,position,department,startDate,birthday,role,managerEmail,slackUserId";

function uniqueDomain(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `csvtest-${stamp}-${rand}.local`;
}

function row(
  firstName: string,
  lastName: string,
  email: string,
  managerEmail = "",
  role = "EMPLOYEE",
): string {
  return [firstName, lastName, email, "", "", "", "", "", "", role, managerEmail, ""].join(",");
}

async function cleanupEmails(emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  const { db } = await import("@/lib/db");
  const matched = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, emails));
  if (matched.length > 0) {
    const ids = matched.map((r) => r.id);
    for (const id of ids) {
      await db.delete(auditLogs).where(eq(auditLogs.targetId, id));
    }
    await db.delete(users).where(inArray(users.id, ids));
  }
}

async function cleanupLeaveTypes(prefix: string): Promise<void> {
  const { db } = await import("@/lib/db");
  await db.delete(leaveTypes).where(like(leaveTypes.name, `${prefix}%`));
}

async function runImport(
  csv: string,
  mode: "dryrun" | "commit",
  policy: "skip" | "update",
): Promise<import("@/lib/csv/import").ImportResult> {
  const mod = await import("@/lib/csv/import");
  return mod.importEmployeesFromCsv(csv, mode, policy, "actor-test");
}

dbDescribe("importEmployeesFromCsv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("dry-run with all valid rows reports insert statuses and does not commit", async () => {
    const domain = uniqueDomain();
    const emails = [`csv-one@${domain}`, `csv-two@${domain}`];
    const csv = [CSV_HEADER, row("Csv", "One", emails[0]!), row("Csv", "Two", emails[1]!)].join("\n");
    try {
      const result = await runImport(csv, "dryrun", "skip");
      expect(result.mode).toBe("dryrun");
      expect(result.totalRows).toBe(2);
      expect(result.willInsert).toBe(2);
      expect(result.errors).toBe(0);
      expect(result.committed).toBeUndefined();
      const { db } = await import("@/lib/db");
      const rows = await db.select().from(users).where(inArray(users.email, emails));
      expect(rows).toHaveLength(0);
    } finally {
      await cleanupEmails(emails);
    }
  });

  it("commit with two valid rows inserts users and auto-creates balances", async () => {
    const domain = uniqueDomain();
    const emails = [`csv-c1@${domain}`, `csv-c2@${domain}`];
    const csv = [CSV_HEADER, row("Csv", "C1", emails[0]!), row("Csv", "C2", emails[1]!)].join("\n");
    try {
      const result = await runImport(csv, "commit", "skip");
      expect(result.committed?.inserted).toBe(2);
      expect(result.errors).toBe(0);

      const { db } = await import("@/lib/db");
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.email, emails));
      expect(rows).toHaveLength(2);
      const balances = await db
        .select()
        .from(leaveBalances)
        .where(inArray(leaveBalances.employeeId, rows.map((r) => r.id)));
      expect(balances.length).toBeGreaterThan(0);
    } finally {
      await cleanupEmails(emails);
    }
  });

  it("flags a manager-cycle in the proposed CSV graph as an error", async () => {
    const domain = uniqueDomain();
    const a = `cycle-a@${domain}`;
    const b = `cycle-b@${domain}`;
    // A reports to B and B reports to A — within the same CSV this is a
    // 2-node cycle.
    const csv = [CSV_HEADER, row("Cyc", "A", a, b), row("Cyc", "B", b, a)].join("\n");
    try {
      const result = await runImport(csv, "dryrun", "skip");
      const errorRows = result.rowResults.filter((r) => r.status === "error");
      expect(errorRows.length).toBeGreaterThanOrEqual(1);
      expect(errorRows.some((r) => r.errors.some((e) => /cycle/i.test(e)))).toBe(true);
    } finally {
      await cleanupEmails([a, b]);
    }
  });

  it("flags duplicate email in CSV as an error row", async () => {
    const domain = uniqueDomain();
    const dup = `dup@${domain}`;
    const csv = [CSV_HEADER, row("Dup", "One", dup), row("Dup", "Two", dup)].join("\n");
    try {
      const result = await runImport(csv, "dryrun", "skip");
      const errorRows = result.rowResults.filter((r) => r.status === "error");
      expect(errorRows.length).toBeGreaterThanOrEqual(1);
      expect(errorRows.some((r) => r.errors.some((e) => /duplicate/i.test(e)))).toBe(true);
    } finally {
      await cleanupEmails([dup]);
    }
  });

  it("flags rows missing the required email column as Zod errors", async () => {
    // Intentionally MISSING the email column.
    const badHeader =
      "firstName,lastName,phone,address,position,department,startDate,birthday,role,managerEmail,slackUserId";
    const csv = [badHeader, "Missing,Email,,,Eng,Eng,,,EMPLOYEE,,"].join("\n");
    const result = await runImport(csv, "dryrun", "skip");
    expect(result.errors).toBeGreaterThanOrEqual(1);
    const errorRow = result.rowResults.find((r) => r.status === "error");
    expect(errorRow?.errors.some((e) => /email/i.test(e))).toBe(true);
  });

  it("policy 'skip' marks an existing-email row as skip (no DB write)", async () => {
    const { db } = await import("@/lib/db");
    const domain = uniqueDomain();
    const email = `skipme@${domain}`;
    await db.insert(users).values({
      email,
      firstName: "Existing",
      lastName: "User",
      role: "EMPLOYEE",
      position: "Original",
    });
    try {
      const csv = [CSV_HEADER, row("Skip", "Wins", email)].join("\n");
      const result = await runImport(csv, "commit", "skip");
      const skipped = result.rowResults.filter((r) => r.status === "skip");
      expect(skipped).toHaveLength(1);

      const stillThere = await db
        .select({ firstName: users.firstName, position: users.position })
        .from(users)
        .where(eq(users.email, email));
      expect(stillThere[0]?.firstName).toBe("Existing");
      expect(stillThere[0]?.position).toBe("Original");
    } finally {
      await cleanupEmails([email]);
    }
  });

  it("policy 'update' overwrites an existing-email row on commit", async () => {
    const { db } = await import("@/lib/db");
    const domain = uniqueDomain();
    const email = `updateme@${domain}`;
    await db.insert(users).values({
      email,
      firstName: "Old",
      lastName: "Name",
      role: "EMPLOYEE",
      position: "OldRole",
    });
    try {
      const csv = [CSV_HEADER, row("New", "Name", email)].join("\n");
      const result = await runImport(csv, "commit", "update");
      expect(result.committed?.updated).toBe(1);

      const after = await db
        .select({ firstName: users.firstName })
        .from(users)
        .where(eq(users.email, email));
      expect(after[0]?.firstName).toBe("New");
    } finally {
      await cleanupEmails([email]);
      await cleanupLeaveTypes("never-matches");
    }
  });
});
