/**
 * E2E: CSV import dry-run → commit, cycle-detection, 2 MB size cap.
 *
 * The size-cap test calls the API directly with a large JSON body — far
 * cheaper than rendering a 2 MB CSV through the form. The other cases
 * drive the full UI to validate the wiring.
 */
import { eq, inArray } from "drizzle-orm";
import { expect, test } from "../fixtures";
import { loginAs } from "../helpers/auth";
import {
  auditLogs,
  leaveBalances,
  users,
} from "@/lib/db/schema";

const CSV_HEADER =
  "firstName,lastName,email,phone,address,position,department,startDate,birthday,role,managerEmail,slackUserId";

function row(
  first: string,
  last: string,
  email: string,
  managerEmail = "",
): string {
  return [
    first,
    last,
    email,
    "",
    "",
    "",
    "",
    "",
    "",
    "EMPLOYEE",
    managerEmail,
    "",
  ].join(",");
}

async function cleanupEmails(emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  const { db } = await import("@/lib/db");
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, emails));
  if (rows.length === 0) return;
  const ids = rows.map((r) => r.id);
  for (const id of ids) {
    await db.delete(auditLogs).where(eq(auditLogs.targetId, id));
  }
  await db.delete(users).where(inArray(users.id, ids));
}

test.describe("/admin/employees/import", () => {
  test("HR_ADMIN drag-drops a valid 2-row CSV, previews 2 inserts, commits", async ({
    page,
  }) => {
    const tag = Date.now().toString(36);
    const emails = [
      `e2e-csv-a-${tag}@vaudit.com`,
      `e2e-csv-b-${tag}@vaudit.com`,
    ];
    const csv = [
      CSV_HEADER,
      row("Csv", "Alpha", emails[0]!),
      row("Csv", "Beta", emails[1]!),
    ].join("\n");
    try {
      await loginAs(page, "HR_ADMIN");
      await page.goto("/admin/employees/import");

      // Use setInputFiles on the hidden <input type=file>.
      await page.setInputFiles("input#csvFile", {
        name: "test.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv, "utf8"),
      });

      // Preview (dry run).
      await page
        .getByRole("button", { name: /Preview \(dry run\)/i })
        .click();
      await expect(page.getByText(/Preview generated/i)).toBeVisible();
      // Stat cards show the counts.
      await expect(page.getByText(/Insert/i)).toBeVisible();
      // Errors stat at 0 means the Commit CTA is enabled.
      await page.getByRole("button", { name: /Commit import/i }).click();
      await expect(page.getByText(/Import committed/i)).toBeVisible();

      // Verify rows in DB.
      const { db } = await import("@/lib/db");
      const inserted = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.email, emails));
      expect(inserted).toHaveLength(2);
      // Balances auto-created for each.
      for (const u of inserted) {
        const bals = await db
          .select()
          .from(leaveBalances)
          .where(eq(leaveBalances.employeeId, u.id));
        expect(bals.length).toBeGreaterThan(0);
      }
    } finally {
      await cleanupEmails(emails);
    }
  });

  test("manager-cycle in CSV shows error rows on preview", async ({ page }) => {
    const tag = Date.now().toString(36);
    const a = `e2e-cycA-${tag}@vaudit.com`;
    const b = `e2e-cycB-${tag}@vaudit.com`;
    const csv = [
      CSV_HEADER,
      row("Cyc", "A", a, b),
      row("Cyc", "B", b, a),
    ].join("\n");
    try {
      await loginAs(page, "HR_ADMIN");
      await page.goto("/admin/employees/import");

      await page.setInputFiles("input#csvFile", {
        name: "cycle.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv, "utf8"),
      });
      await page
        .getByRole("button", { name: /Preview \(dry run\)/i })
        .click();
      await expect(page.getByText(/Preview generated/i)).toBeVisible();
      // The preview table renders error rows with the cycle message.
      await expect(page.getByText(/cycle/i).first()).toBeVisible();
      // The Commit button is disabled when there are errors.
      const commit = page.getByRole("button", { name: /Commit import/i });
      await expect(commit).toBeDisabled();
    } finally {
      await cleanupEmails([a, b]);
    }
  });

  test("oversized JSON body to /api/admin/employees/import returns 413", async ({
    page,
  }) => {
    await loginAs(page, "HR_ADMIN");
    // Build > 2 MB CSV string. We don't actually need valid rows — the
    // size cap fires before the parser does.
    const bigCsv = "a,".repeat(1_100_000); // ~2.2 MB

    const res = await page.request.post(
      "/api/admin/employees/import",
      {
        data: {
          csv: bigCsv,
          mode: "dryrun",
          existingEmailPolicy: "skip",
        },
      },
    );
    expect(res.status()).toBe(413);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
