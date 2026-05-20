import * as React from "react";
import { and, asc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { holidays, leaveBalances, leaveTypes } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import {
  LeaveListClient,
  type LeaveTypeLite,
  type MyBalanceLite,
} from "./leave-list-client";

/**
 * Server wrapper that hydrates the client list with seed data:
 *  - active leave types (for picker + filter)
 *  - the user's balances for the current year (live remaining hint)
 *  - this year's holidays (for working-days calc — picker is open to all)
 */
export async function LeaveListView(): Promise<React.JSX.Element> {
  const session = await requireSession();
  const year = new Date().getFullYear();

  const [types, balances, holidayRows] = await Promise.all([
    db
      .select({
        id: leaveTypes.id,
        name: leaveTypes.name,
        isPaid: leaveTypes.isPaid,
      })
      .from(leaveTypes)
      .where(eq(leaveTypes.isActive, true))
      .orderBy(asc(leaveTypes.name)),
    db
      .select({
        leaveTypeId: leaveBalances.leaveTypeId,
        allocated: leaveBalances.allocated,
        used: leaveBalances.used,
        year: leaveBalances.year,
      })
      .from(leaveBalances)
      .where(
        and(
          eq(leaveBalances.employeeId, session.user.id),
          eq(leaveBalances.year, year),
        ),
      ),
    db
      .select({ date: holidays.date })
      .from(holidays)
      .where(
        and(
          gte(holidays.date, `${year}-01-01`),
          lte(holidays.date, `${year}-12-31`),
        ),
      ),
  ]);

  const balanceByType = new Map<string, MyBalanceLite>(
    balances.map((b) => [
      b.leaveTypeId,
      { allocated: b.allocated, used: b.used, year: b.year },
    ]),
  );

  const typeOptions: LeaveTypeLite[] = types.map((t) => ({
    id: t.id,
    name: t.name,
    isPaid: t.isPaid,
  }));

  // holidays.date is already YYYY-MM-DD (Drizzle mode: "string"); no conversion.
  const holidayYmd = holidayRows.map((h) => h.date);

  return (
    <LeaveListClient
      leaveTypes={typeOptions}
      balancesByType={Object.fromEntries(balanceByType)}
      currentYear={year}
      holidayDatesYmd={holidayYmd}
    />
  );
}
