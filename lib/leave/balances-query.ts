/**
 * Shared "load balances for an employee" query.
 *
 * Used by the dashboard ("my balances"), the admin employee detail page,
 * and the manager's team-member page. Returns one row per *active* leave
 * type the employee has a balance row for in the given year. Inactive
 * types are filtered out — they shouldn't surface in any UI even if a
 * lingering balance row exists.
 *
 * Half-day units (post-0006): `allocated` and `used` are in half-days
 * (2 = full day). Callers format via `formatDays`.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { leaveBalances, leaveTypes } from "@/lib/db/schema";

export interface EmployeeBalanceRow {
  leaveTypeId: string;
  leaveTypeName: string;
  allocated: number;
  used: number;
  /** False for Unpaid-style leave types — drives the "Unlimited" card UI. */
  isPaid: boolean;
}

export async function loadEmployeeBalances(
  employeeId: string,
  year: number = new Date().getFullYear(),
): Promise<EmployeeBalanceRow[]> {
  const rows = await db
    .select({
      leaveTypeId: leaveBalances.leaveTypeId,
      leaveTypeName: leaveTypes.name,
      allocated: leaveBalances.allocated,
      used: leaveBalances.used,
      isActive: leaveTypes.isActive,
      isPaid: leaveTypes.isPaid,
    })
    .from(leaveBalances)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
    .where(
      and(
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.year, year),
      ),
    )
    .orderBy(asc(leaveTypes.name));
  return rows
    .filter((r) => r.isActive)
    .map((r) => ({
      leaveTypeId: r.leaveTypeId,
      leaveTypeName: r.leaveTypeName,
      allocated: r.allocated,
      used: r.used,
      isPaid: r.isPaid,
    }));
}