/**
 * Tests for `deactivateEmployee` (lib/employee/deactivate.ts) — A9.
 *
 * Contract under test:
 *   - Flips users.isActive → false in a single transaction.
 *   - Auto-cancels every PENDING leave + WFH request for the target.
 *   - Audit-logs the deactivation AND each auto-cancellation.
 *   - Notifies the deactivated employee with the auto-cancellation note.
 *   - Already-inactive user → no-op (no extra audit log, no notify).
 *   - Last-active-SUPER_ADMIN guard throws `LastSuperAdminError`.
 *
 * Like the cancel test, `deactivateEmployee` opens its own transaction
 * via the global db. We create fixtures via the global db and clean up
 * manually (deleting the user cascades requests, balances, notifs).
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeTestPool } from "../../e2e/helpers/db";
import {
  auditLogs,
  leaveRequests,
  leaveTypes,
  notifications,
  users,
  wfhRequests,
} from "@/lib/db/schema";

const HAS_TEST_DB =
  !!process.env["DATABASE_URL_TEST"] || !!process.env["DATABASE_URL"];
const dbDescribe = HAS_TEST_DB ? describe : describe.skip;

function uniqueEmail(prefix: string): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}@test.vaudit.com`;
}

interface Fixture {
  employeeId: string;
  actorId: string;
  leaveTypeId: string;
  leaveIds: string[];
  wfhIds: string[];
}

async function seedFixture(opts: {
  withPendingLeave?: boolean;
  withPendingWfh?: boolean;
  role?: "EMPLOYEE" | "SUPER_ADMIN";
  alreadyInactive?: boolean;
}): Promise<Fixture> {
  const { db } = await import("@/lib/db");
  const [emp] = await db
    .insert(users)
    .values({
      email: uniqueEmail("deact-emp"),
      firstName: "Deact",
      lastName: "Target",
      role: opts.role ?? "EMPLOYEE",
      slackUserId: "U_DEACT_TEST",
      isActive: !opts.alreadyInactive,
    })
    .returning();
  if (!emp) throw new Error("employee fixture missing");
  const [actor] = await db
    .insert(users)
    .values({
      email: uniqueEmail("deact-actor"),
      firstName: "Deact",
      lastName: "Actor",
      role: "HR_ADMIN",
    })
    .returning();
  if (!actor) throw new Error("actor fixture missing");
  const [lt] = await db
    .insert(leaveTypes)
    .values({
      name: `Deact-${emp.id.slice(0, 8)}`,
      defaultBalance: 10,
      isPaid: true,
      color: "#2563eb",
    })
    .returning();
  if (!lt) throw new Error("leaveType fixture missing");
  const leaveIds: string[] = [];
  if (opts.withPendingLeave) {
    const [r] = await db
      .insert(leaveRequests)
      .values({
        employeeId: emp.id,
        leaveTypeId: lt.id,
        startDate: "2099-07-01",
        endDate: "2099-07-02",
        totalDays: 2,
        status: "PENDING",
      })
      .returning();
    if (r) leaveIds.push(r.id);
  }
  const wfhIds: string[] = [];
  if (opts.withPendingWfh) {
    const [r] = await db
      .insert(wfhRequests)
      .values({
        employeeId: emp.id,
        startDate: "2099-08-15",
        endDate: "2099-08-15",
        totalDays: 1,
        status: "PENDING",
      })
      .returning();
    if (r) wfhIds.push(r.id);
  }
  return {
    employeeId: emp.id,
    actorId: actor.id,
    leaveTypeId: lt.id,
    leaveIds,
    wfhIds,
  };
}

async function cleanupFixture(fx: Fixture): Promise<void> {
  const { db } = await import("@/lib/db");
  await db.delete(auditLogs).where(eq(auditLogs.actorId, fx.actorId));
  await db.delete(auditLogs).where(eq(auditLogs.targetId, fx.employeeId));
  for (const id of [...fx.leaveIds, ...fx.wfhIds]) {
    await db.delete(auditLogs).where(eq(auditLogs.targetId, id));
  }
  await db.delete(users).where(eq(users.id, fx.employeeId));
  await db.delete(users).where(eq(users.id, fx.actorId));
  await db.delete(leaveTypes).where(eq(leaveTypes.id, fx.leaveTypeId));
}

function installSlackStub(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    return new Response(
      JSON.stringify({ ok: true, channel: { id: "C_TEST" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

dbDescribe("deactivateEmployee", () => {
  beforeEach(() => {
    process.env["SLACK_BOT_TOKEN"] = "xoxb-test-token";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("flips isActive to false and auto-cancels every PENDING leave + WFH request", async () => {
    installSlackStub();
    const fx = await seedFixture({ withPendingLeave: true, withPendingWfh: true });
    try {
      const { deactivateEmployee } = await import("@/lib/employee/deactivate");
      const result = await deactivateEmployee(fx.employeeId, fx.actorId);
      expect(result.userId).toBe(fx.employeeId);
      expect(result.cancelledLeaveIds.length).toBe(1);
      expect(result.cancelledWfhIds.length).toBe(1);

      const { db } = await import("@/lib/db");
      const u = await db
        .select({ isActive: users.isActive })
        .from(users)
        .where(eq(users.id, fx.employeeId));
      expect(u[0]?.isActive).toBe(false);
      const leave = await db
        .select({ status: leaveRequests.status })
        .from(leaveRequests)
        .where(eq(leaveRequests.employeeId, fx.employeeId));
      expect(leave.every((r) => r.status === "CANCELLED")).toBe(true);
      const wfh = await db
        .select({ status: wfhRequests.status })
        .from(wfhRequests)
        .where(eq(wfhRequests.employeeId, fx.employeeId));
      expect(wfh.every((r) => r.status === "CANCELLED")).toBe(true);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("notifies the employee with the auto-cancellation reason when there were pending requests", async () => {
    installSlackStub();
    const fx = await seedFixture({ withPendingLeave: true });
    try {
      const { deactivateEmployee } = await import("@/lib/employee/deactivate");
      await deactivateEmployee(fx.employeeId, fx.actorId);

      const { db } = await import("@/lib/db");
      const rows = await db
        .select({ type: notifications.type, message: notifications.message })
        .from(notifications)
        .where(eq(notifications.employeeId, fx.employeeId));
      expect(rows.map((r) => r.type)).toContain("employee.deactivated");
      expect(rows.some((r) => /deactivat/i.test(r.message))).toBe(true);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("audit-logs the deactivation plus each auto-cancellation", async () => {
    installSlackStub();
    const fx = await seedFixture({ withPendingLeave: true, withPendingWfh: true });
    try {
      const { deactivateEmployee } = await import("@/lib/employee/deactivate");
      await deactivateEmployee(fx.employeeId, fx.actorId);

      const { db } = await import("@/lib/db");
      const actorLogs = await db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.actorId, fx.actorId));
      const actions = actorLogs.map((l) => l.action);
      expect(actions).toContain("employee.deactivate");
      expect(actions).toContain("leave.auto_cancel_on_deactivate");
      expect(actions).toContain("wfh.auto_cancel_on_deactivate");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("no-op when the target is already inactive (returns empty cancel lists)", async () => {
    installSlackStub();
    const fx = await seedFixture({ alreadyInactive: true });
    try {
      const { deactivateEmployee } = await import("@/lib/employee/deactivate");
      const result = await deactivateEmployee(fx.employeeId, fx.actorId);
      expect(result.cancelledLeaveIds).toEqual([]);
      expect(result.cancelledWfhIds).toEqual([]);

      const { db } = await import("@/lib/db");
      const cancelLogs = await db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.actorId, fx.actorId),
            eq(auditLogs.action, "leave.auto_cancel_on_deactivate"),
          ),
        );
      expect(cancelLogs).toHaveLength(0);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("throws LastSuperAdminError when the target is the only active SUPER_ADMIN", async () => {
    // The seed leaves ceo@vaudit.com as the only SUPER_ADMIN. Add a
    // second one as the actor, then deactivate it so the seeded CEO is
    // truly the last active SUPER_ADMIN, then expect the guard to fire.
    installSlackStub();
    const { db } = await import("@/lib/db");
    const supers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.isActive, true)));
    if (supers.length !== 1) {
      // eslint-disable-next-line no-console
      console.warn(
        `Skipping last-SUPER_ADMIN guard test — expected 1 active SUPER_ADMIN but found ${supers.length}.`,
      );
      return;
    }
    const targetId = supers[0]?.id;
    if (!targetId) return;
    const [actor] = await db
      .insert(users)
      .values({
        email: uniqueEmail("last-actor"),
        firstName: "Last",
        lastName: "Actor",
        role: "SUPER_ADMIN",
      })
      .returning();
    if (!actor) throw new Error("actor fixture missing");
    try {
      const { deactivateEmployee, LastSuperAdminError } = await import(
        "@/lib/employee/deactivate"
      );
      await db
        .update(users)
        .set({ isActive: false })
        .where(eq(users.id, actor.id));
      await expect(
        deactivateEmployee(targetId, actor.id),
      ).rejects.toBeInstanceOf(LastSuperAdminError);
      const after = await db
        .select({ isActive: users.isActive })
        .from(users)
        .where(eq(users.id, targetId));
      expect(after[0]?.isActive).toBe(true);
    } finally {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, actor.id));
      await db.delete(users).where(eq(users.id, actor.id));
    }
  });
});
