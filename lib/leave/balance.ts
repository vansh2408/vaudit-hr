/**
 * Leave balance helpers — single source of truth for allocate/check/refund.
 *
 * - `checkBalance` fetches the row (or returns defaults) and computes remaining.
 * - `consumeBalance` / `refundBalance` are transactional helpers that mutate
 *   the `leave_balances.used` counter atomically. They take an optional `tx`
 *   so callers can sequence balance + request status changes inside one
 *   transaction (decisions A8).
 *
 * "Unpaid" leave (isPaid=false) is exempt from the *cap* check — `checkBalance`
 * always returns ok=true so submissions aren't blocked. But the counter is
 * still tracked (consume + refund) so HR sees actual consumption against the
 * soft policy default; the balance card renders it as a regular tracked card
 * with overage shown when used > allocated.
 */
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db as defaultDb } from "@/lib/db";
import type { schema as dbSchema } from "@/lib/db";
import { leaveBalances, leaveTypes } from "@/lib/db/schema";
import { formatDays } from "@/lib/utils/format-days";

type Db = NodePgDatabase<typeof dbSchema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTx = Db | Tx;

export interface BalanceCheck {
  ok: boolean;
  allocated: number;
  used: number;
  remaining: number;
  isPaid: boolean;
  isExempt: boolean;
  reason?: string;
}

async function getLeaveType(
  client: DbOrTx,
  leaveTypeId: string,
): Promise<{ id: string; isPaid: boolean; isActive: boolean } | undefined> {
  const rows = await client
    .select({
      id: leaveTypes.id,
      isPaid: leaveTypes.isPaid,
      isActive: leaveTypes.isActive,
    })
    .from(leaveTypes)
    .where(eq(leaveTypes.id, leaveTypeId))
    .limit(1);
  return rows[0];
}

export async function checkBalance(
  employeeId: string,
  leaveTypeId: string,
  days: number,
  year: number,
  client: DbOrTx = defaultDb,
): Promise<BalanceCheck> {
  const type = await getLeaveType(client, leaveTypeId);
  if (!type) {
    return {
      ok: false,
      allocated: 0,
      used: 0,
      remaining: 0,
      isPaid: false,
      isExempt: false,
      reason: "Leave type not found",
    };
  }
  if (!type.isActive) {
    return {
      ok: false,
      allocated: 0,
      used: 0,
      remaining: 0,
      isPaid: type.isPaid,
      isExempt: false,
      reason: "Leave type is inactive",
    };
  }

  const rows = await client
    .select({
      allocated: leaveBalances.allocated,
      used: leaveBalances.used,
    })
    .from(leaveBalances)
    .where(
      and(
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.leaveTypeId, leaveTypeId),
        eq(leaveBalances.year, year),
      ),
    )
    .limit(1);

  const row = rows[0] ?? { allocated: 0, used: 0 };
  const remaining = row.allocated - row.used;

  if (!type.isPaid) {
    return {
      ok: true,
      allocated: row.allocated,
      used: row.used,
      remaining,
      isPaid: false,
      isExempt: true,
    };
  }
  if (days <= 0) {
    return {
      ok: false,
      allocated: row.allocated,
      used: row.used,
      remaining,
      isPaid: true,
      isExempt: false,
      reason: "Requested days must be > 0",
    };
  }
  if (remaining < days) {
    return {
      ok: false,
      allocated: row.allocated,
      used: row.used,
      remaining,
      isPaid: true,
      isExempt: false,
      // `days` and `remaining` are half-day units; format for user copy.
      reason: `Insufficient balance: need ${formatDays(days)}, have ${formatDays(remaining)}`,
    };
  }
  return {
    ok: true,
    allocated: row.allocated,
    used: row.used,
    remaining,
    isPaid: true,
    isExempt: false,
  };
}

export async function consumeBalance(
  employeeId: string,
  leaveTypeId: string,
  days: number,
  year: number,
  client: DbOrTx = defaultDb,
): Promise<void> {
  // Move the counter regardless of isPaid. Unpaid is exempt from the cap
  // CHECK (in checkBalance) but its usage is still tracked so HR sees real
  // consumption against the soft policy default. `used` can legitimately
  // exceed `allocated` for unpaid types; BalanceCard surfaces that as
  // "X over" rather than clamping to zero.
  const type = await getLeaveType(client, leaveTypeId);
  if (!type) return;
  await client
    .update(leaveBalances)
    .set({ used: sql`${leaveBalances.used} + ${days}` })
    .where(
      and(
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.leaveTypeId, leaveTypeId),
        eq(leaveBalances.year, year),
      ),
    );
}

export async function refundBalance(
  employeeId: string,
  leaveTypeId: string,
  days: number,
  year: number,
  client: DbOrTx = defaultDb,
): Promise<void> {
  const type = await getLeaveType(client, leaveTypeId);
  if (!type) return;
  // Floor at 0 to prevent negatives if data drifted. Applies to unpaid as
  // well — a cancelled Unpaid leave decrements used the same way.
  await client
    .update(leaveBalances)
    .set({
      used: sql`GREATEST(0, ${leaveBalances.used} - ${days})`,
    })
    .where(
      and(
        eq(leaveBalances.employeeId, employeeId),
        eq(leaveBalances.leaveTypeId, leaveTypeId),
        eq(leaveBalances.year, year),
      ),
    );
}
