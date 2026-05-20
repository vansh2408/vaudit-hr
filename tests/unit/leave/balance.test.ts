/**
 * Tests for `checkBalance` / `consumeBalance` / `refundBalance`
 * (lib/leave/balance.ts). These helpers accept an optional `client`
 * parameter so we can drive them entirely inside `withDbTransaction`'s
 * rollback-on-exit transaction — no manual cleanup needed.
 *
 * Skipped automatically when no test DB is configured, so `npm test`
 * stays green on a fresh checkout.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeTestPool, withDbTransaction, type TestDb } from "../../e2e/helpers/db";
import {
  leaveBalances,
  leaveTypes,
  users,
} from "@/lib/db/schema";

// `lib/leave/balance.ts` imports the global `db` at module load. We lazy-
// import it inside each test so a fresh checkout without DATABASE_URL set
// does not crash on file discovery — the dbDescribe skip-guard runs first.
async function balanceMod(): Promise<typeof import("@/lib/leave/balance")> {
  return import("@/lib/leave/balance");
}

const HAS_TEST_DB =
  !!process.env["DATABASE_URL_TEST"] || !!process.env["DATABASE_URL"];
const dbDescribe = HAS_TEST_DB ? describe : describe.skip;

function uniqueEmail(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}@test.vaudit.com`;
}

const YEAR = 2099;

interface BalanceFixture {
  employeeId: string;
  leaveTypeId: string;
}

async function seedBalanceFixture(
  tx: TestDb,
  label: string,
  opts: {
    isPaid?: boolean;
    allocated?: number;
    used?: number;
    skipBalanceRow?: boolean;
  } = {},
): Promise<BalanceFixture> {
  const [u] = await tx
    .insert(users)
    .values({
      email: uniqueEmail(label),
      firstName: "Bal",
      lastName: label,
      role: "EMPLOYEE",
    })
    .returning();
  if (!u) throw new Error("user fixture missing");
  const [lt] = await tx
    .insert(leaveTypes)
    .values({
      name: `Test-${label}-${u.id.slice(0, 8)}`,
      defaultBalance: opts.allocated ?? 10,
      isPaid: opts.isPaid ?? true,
      color: opts.isPaid === false ? "#64748b" : "#2563eb",
    })
    .returning();
  if (!lt) throw new Error("leaveType fixture missing");
  if (!opts.skipBalanceRow) {
    await tx.insert(leaveBalances).values({
      employeeId: u.id,
      leaveTypeId: lt.id,
      year: YEAR,
      allocated: opts.allocated ?? 10,
      used: opts.used ?? 0,
    });
  }
  return { employeeId: u.id, leaveTypeId: lt.id };
}

async function getUsed(tx: TestDb, fx: BalanceFixture): Promise<number> {
  const rows = await tx
    .select({ used: leaveBalances.used })
    .from(leaveBalances)
    .where(
      and(
        eq(leaveBalances.employeeId, fx.employeeId),
        eq(leaveBalances.leaveTypeId, fx.leaveTypeId),
        eq(leaveBalances.year, YEAR),
      ),
    );
  return rows[0]?.used ?? -1;
}

dbDescribe("leave/balance", () => {
  afterAll(async () => {
    await closeTestPool();
  });

  it("checkBalance returns ok with remaining when balance covers the request", async () => {
    await withDbTransaction(async (tx) => {
      const fx = await seedBalanceFixture(tx, "ok", { allocated: 20, used: 5 });
      const { checkBalance } = await balanceMod();
      const result = await checkBalance(fx.employeeId, fx.leaveTypeId, 3, YEAR, tx);
      expect(result.ok).toBe(true);
      expect(result.allocated).toBe(20);
      expect(result.used).toBe(5);
      expect(result.remaining).toBe(15);
      expect(result.isPaid).toBe(true);
      expect(result.isExempt).toBe(false);
    });
  });

  it("checkBalance returns ok with 0 remaining when the request exactly drains balance", async () => {
    await withDbTransaction(async (tx) => {
      const fx = await seedBalanceFixture(tx, "exact", { allocated: 5, used: 0 });
      const { checkBalance } = await balanceMod();
      const result = await checkBalance(fx.employeeId, fx.leaveTypeId, 5, YEAR, tx);
      expect(result.ok).toBe(true);
      expect(result.remaining).toBe(5);
    });
  });

  it("checkBalance returns not-ok when remaining is below the requested days", async () => {
    await withDbTransaction(async (tx) => {
      const fx = await seedBalanceFixture(tx, "nok", { allocated: 5, used: 4 });
      const { checkBalance } = await balanceMod();
      const result = await checkBalance(fx.employeeId, fx.leaveTypeId, 3, YEAR, tx);
      expect(result.ok).toBe(false);
      expect(result.remaining).toBe(1);
      expect(result.reason).toContain("Insufficient balance");
    });
  });

  it("unpaid leave type is exempt from balance checks", async () => {
    await withDbTransaction(async (tx) => {
      const fx = await seedBalanceFixture(tx, "unpaid", {
        isPaid: false,
        skipBalanceRow: true,
      });
      const { checkBalance } = await balanceMod();
      const result = await checkBalance(fx.employeeId, fx.leaveTypeId, 30, YEAR, tx);
      expect(result.ok).toBe(true);
      expect(result.isPaid).toBe(false);
      expect(result.isExempt).toBe(true);
    });
  });

  it("checkBalance returns not-ok with a leave-type-not-found reason when the type id is unknown", async () => {
    await withDbTransaction(async (tx) => {
      // Random uuid that does not exist.
      const ghostId = "00000000-0000-0000-0000-000000000000";
      const { checkBalance } = await balanceMod();
      const result = await checkBalance("ghost-user", ghostId, 1, YEAR, tx);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("not found");
    });
  });

  it("consumeBalance increases the used counter atomically", async () => {
    await withDbTransaction(async (tx) => {
      const fx = await seedBalanceFixture(tx, "consume", { allocated: 20, used: 2 });
      const { consumeBalance } = await balanceMod();
      await consumeBalance(fx.employeeId, fx.leaveTypeId, 3, YEAR, tx);
      expect(await getUsed(tx, fx)).toBe(5);
    });
  });

  it("refundBalance decreases used and never goes below 0", async () => {
    await withDbTransaction(async (tx) => {
      const fx = await seedBalanceFixture(tx, "refund", { allocated: 10, used: 3 });
      const { refundBalance } = await balanceMod();
      // Normal refund: 3 -> 1
      await refundBalance(fx.employeeId, fx.leaveTypeId, 2, YEAR, tx);
      expect(await getUsed(tx, fx)).toBe(1);
      // Pathological refund: more than current used → floor at 0.
      await refundBalance(fx.employeeId, fx.leaveTypeId, 99, YEAR, tx);
      expect(await getUsed(tx, fx)).toBe(0);
    });
  });

  it("consume + refund in the same tx leaves the counter consistent", async () => {
    // Concurrent-safety smoke test: a request approval (consume) followed
    // by an employee cancel (refund) inside one transaction must end at
    // the original used value.
    await withDbTransaction(async (tx) => {
      const fx = await seedBalanceFixture(tx, "cyc", { allocated: 10, used: 4 });
      const { consumeBalance, refundBalance } = await balanceMod();
      await consumeBalance(fx.employeeId, fx.leaveTypeId, 3, YEAR, tx); // 4 -> 7
      await refundBalance(fx.employeeId, fx.leaveTypeId, 3, YEAR, tx); // 7 -> 4
      expect(await getUsed(tx, fx)).toBe(4);
    });
  });
});
