/**
 * Leave balance helpers — single source of truth for allocate/check/refund.
 *
 * - `checkBalance` fetches the row (or returns defaults) and computes remaining.
 * - `consumeBalance` / `refundBalance` are transactional helpers that mutate
 *   the `leave_balances.used` counter atomically. They take an optional `tx`
 *   so callers can sequence balance + request status changes inside one
 *   transaction (decisions A8).
 *
 * "Unpaid" leave (isPaid=false) is exempt from balance checks — it always
 * passes and never mutates the counter.
 */
import { and, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db as defaultDb } from "@/lib/db";
import type { schema as dbSchema } from "@/lib/db";
import { leaveBalances, leaveTypes } from "@/lib/db/schema";

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
      reason: `Insufficient balance: need ${days}, have ${remaining}`,
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
  const type = await getLeaveType(client, leaveTypeId);
  if (!type || !type.isPaid) return; // Unpaid leave: no counter movement.
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
  if (!type || !type.isPaid) return;
  // Floor at 0 to prevent negatives if data drifted.
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
