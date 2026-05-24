/**
 * Read-only audit of leave_balances.used vs the actual sum of approved
 * leave_requests.total_days, per (employee, leaveType, year).
 *
 * Use this after a back-fill batch + manual balance edits to confirm the
 * Used counter matches reality. Runs zero writes; safe to invoke any
 * time. Prints per-row status (✓ or ⚠ MISMATCH) and a summary.
 *
 * Usage:
 *   npx tsx scripts/check-balances.ts
 *
 * What counts as "consumed":
 *   - status = APPROVED              → balance was decremented on approve.
 *   - status = PENDING_CANCELLATION  → still consumed; cancel awaiting review.
 *
 * What does NOT count:
 *   - PENDING / REJECTED / CANCELLED → never consumed (or already refunded).
 *
 * Units: all numbers shown are HALF-DAY UNITS (post-0006). 2 = 1 day,
 * 1 = ½ day. The script also prints the human "days" rendering via
 * formatDays() for clarity.
 *
 * Orphans:
 *   - "ORPHAN" = approved leaves exist for an (employee, leaveType, year)
 *     triple, but no matching leave_balances row. The expected used has
 *     nowhere to land in HR's UI — HR should create the balance row.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { asc, eq } from "drizzle-orm";

import {
  leaveBalances,
  leaveRequests,
  leaveTypes,
  users,
} from "@/lib/db/schema";
import { formatDays } from "@/lib/utils/format-days";

interface Stats {
  employeesChecked: number;
  rowsChecked: number;
  mismatches: number;
  orphans: number;
}

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  try {
    const employees = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        isActive: users.isActive,
      })
      .from(users)
      .orderBy(asc(users.email));

    const types = await db
      .select({ id: leaveTypes.id, name: leaveTypes.name })
      .from(leaveTypes);
    const typeNameById = new Map<string, string>(
      types.map((t) => [t.id, t.name]),
    );

    const stats: Stats = {
      employeesChecked: 0,
      rowsChecked: 0,
      mismatches: 0,
      orphans: 0,
    };

    for (const emp of employees) {
      await checkEmployee(db, emp, typeNameById, stats);
    }

    // eslint-disable-next-line no-console
    console.log("---");
    // eslint-disable-next-line no-console
    console.log(
      `Checked ${stats.rowsChecked} balance rows across ${stats.employeesChecked} employees.`,
    );
    if (stats.mismatches === 0 && stats.orphans === 0) {
      // eslint-disable-next-line no-console
      console.log("✓ All balances match their approved leaves.");
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `⚠ Mismatches: ${stats.mismatches}, orphans: ${stats.orphans}.`,
      );
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

async function checkEmployee(
  db: ReturnType<typeof drizzle>,
  emp: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
  },
  typeNameById: Map<string, string>,
  stats: Stats,
): Promise<void> {
  const [balanceRows, leaveRows] = await Promise.all([
    db
      .select({
        leaveTypeId: leaveBalances.leaveTypeId,
        year: leaveBalances.year,
        allocated: leaveBalances.allocated,
        used: leaveBalances.used,
      })
      .from(leaveBalances)
      .where(eq(leaveBalances.employeeId, emp.id)),
    db
      .select({
        leaveTypeId: leaveRequests.leaveTypeId,
        startDate: leaveRequests.startDate,
        totalDays: leaveRequests.totalDays,
        status: leaveRequests.status,
      })
      .from(leaveRequests)
      .where(eq(leaveRequests.employeeId, emp.id)),
  ]);

  // expected[`${leaveTypeId}:${year}`] = sum of consumed half-days
  const expected = new Map<string, number>();
  for (const r of leaveRows) {
    if (r.status !== "APPROVED" && r.status !== "PENDING_CANCELLATION") continue;
    // Year = startDate year, matches how the API records balance year on approval.
    const year = Number(r.startDate.slice(0, 4));
    const key = `${r.leaveTypeId}:${year}`;
    expected.set(key, (expected.get(key) ?? 0) + r.totalDays);
  }

  stats.employeesChecked++;

  // Skip silently if the employee has no balance rows AND no consumed
  // leaves — nothing to audit.
  if (balanceRows.length === 0 && expected.size === 0) return;

  const label = `${emp.firstName} ${emp.lastName} <${emp.email}>${emp.isActive ? "" : " [INACTIVE]"}`;
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} ===`);

  // Sort balance rows for stable output: year asc, type name asc.
  const sortedBalances = [...balanceRows].sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    const an = typeNameById.get(a.leaveTypeId) ?? a.leaveTypeId;
    const bn = typeNameById.get(b.leaveTypeId) ?? b.leaveTypeId;
    return an.localeCompare(bn);
  });

  for (const b of sortedBalances) {
    const key = `${b.leaveTypeId}:${b.year}`;
    const expectedUsed = expected.get(key) ?? 0;
    const typeName = typeNameById.get(b.leaveTypeId) ?? b.leaveTypeId;
    const match = expectedUsed === b.used;
    stats.rowsChecked++;
    if (!match) stats.mismatches++;
    const delta = b.used - expectedUsed;
    const tag = match
      ? "✓"
      : `⚠ MISMATCH (actual − expected = ${delta} half-days = ${formatDays(Math.abs(delta))} ${delta > 0 ? "OVER" : "SHORT"})`;
    // eslint-disable-next-line no-console
    console.log(
      `  ${b.year} ${typeName.padEnd(14)} alloc=${pad(formatDays(b.allocated), 10)} used=${pad(formatDays(b.used), 10)} expected=${pad(formatDays(expectedUsed), 10)} ${tag}`,
    );
    expected.delete(key);
  }

  // Anything still in `expected` = orphan (approved leaves without a balance row).
  if (expected.size > 0) {
    for (const [key, val] of expected) {
      const [leaveTypeId, yearStr] = key.split(":") as [string, string];
      const typeName = typeNameById.get(leaveTypeId) ?? leaveTypeId;
      stats.orphans++;
      // eslint-disable-next-line no-console
      console.log(
        `  ${yearStr} ${typeName.padEnd(14)} (no balance row)              expected=${pad(formatDays(val), 10)} ⚠ ORPHAN`,
      );
    }
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});