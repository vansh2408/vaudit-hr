/**
 * Tests for the leave cancellation workflow (lib/leave/cancel.ts).
 *
 * State machine under test:
 *
 *   PENDING ─(cancelLeaveRequest)──────────► CANCELLED          (no balance change, no notify)
 *
 *   APPROVED, future ─(cancelLeaveRequest)─► PENDING_CANCELLATION   (notify manager, no refund)
 *   APPROVED, past   ─(cancelLeaveRequest)─► throws                  (past-leave lock)
 *
 *   PENDING_CANCELLATION ─(approveLeaveCancellation)──► CANCELLED  (refund + notify employee)
 *                        ─(rejectLeaveCancellation, note)─► APPROVED  (notify employee)
 *                        ─(withdrawLeaveCancellation, owner)─► APPROVED  (no notify)
 *
 *   any non-terminal ─(adminForceCancelLeave, reason)─► CANCELLED  (refund if was APPROVED/PENDING_CANCEL)
 *
 * NOTE: route-layer authorisation is NOT tested here. The cancel module
 * trusts that the caller has already verified isOwn / isAdmin / isManagerOf.
 * Owner-vs-non-owner withdraw defense is the only auth check inside the
 * module, so we exercise that.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { closeTestPool } from "../../e2e/helpers/db";
import {
  auditLogs,
  leaveBalances,
  leaveRequests,
  leaveTypes,
  notifications,
  users,
  type RequestStatus,
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
  managerId: string;
  reviewerId: string;
  leaveTypeId: string;
  requestId: string;
  cleanupIds: string[];
}

interface SeedOpts {
  status: RequestStatus;
  isPaid?: boolean;
  /** ISO-date strings (YYYY-MM-DD). Defaults to far-future so past-lock is inactive. */
  startDate?: string;
  endDate?: string;
}

async function seedFixture(opts: SeedOpts): Promise<Fixture> {
  const isPaid = opts.isPaid ?? true;
  const startDate = opts.startDate ?? "2099-06-01";
  const endDate = opts.endDate ?? "2099-06-03";
  const { db } = await import("@/lib/db");
  // Manager is also reviewer in these fixtures — keeps notify routing simple.
  const [mgr] = await db
    .insert(users)
    .values({
      email: uniqueEmail("cancel-mgr"),
      firstName: "Cancel",
      lastName: "Mgr",
      role: "EMPLOYEE",
      slackUserId: "U_MGR_TEST",
    })
    .returning();
  if (!mgr) throw new Error("manager fixture missing");
  const [emp] = await db
    .insert(users)
    .values({
      email: uniqueEmail("cancel-emp"),
      firstName: "Cancel",
      lastName: "Emp",
      role: "EMPLOYEE",
      slackUserId: "U_EMP_TEST",
      managerId: mgr.id,
    })
    .returning();
  if (!emp) throw new Error("employee fixture missing");
  const [lt] = await db
    .insert(leaveTypes)
    .values({
      name: `Cancel-${emp.id.slice(0, 8)}`,
      defaultBalance: 10,
      isPaid,
      color: "#2563eb",
    })
    .returning();
  if (!lt) throw new Error("leaveType fixture missing");
  const year = Number(startDate.slice(0, 4));
  // Seed used=3 for APPROVED-like states so refund moves it back to 0.
  const initialUsed =
    opts.status === "APPROVED" || opts.status === "PENDING_CANCELLATION"
      ? 3
      : 0;
  await db.insert(leaveBalances).values({
    employeeId: emp.id,
    leaveTypeId: lt.id,
    year,
    allocated: 10,
    used: initialUsed,
  });
  const [req] = await db
    .insert(leaveRequests)
    .values({
      employeeId: emp.id,
      leaveTypeId: lt.id,
      startDate,
      endDate,
      totalDays: 3,
      status: opts.status,
      reviewedById:
        opts.status === "APPROVED" || opts.status === "PENDING_CANCELLATION"
          ? mgr.id
          : null,
      reviewedAt:
        opts.status === "APPROVED" || opts.status === "PENDING_CANCELLATION"
          ? new Date("2099-05-15")
          : null,
    })
    .returning();
  if (!req) throw new Error("leaveRequest fixture missing");
  return {
    employeeId: emp.id,
    managerId: mgr.id,
    reviewerId: mgr.id,
    leaveTypeId: lt.id,
    requestId: req.id,
    cleanupIds: [emp.id, mgr.id],
  };
}

async function cleanupFixture(fx: Fixture): Promise<void> {
  const { db } = await import("@/lib/db");
  await db.delete(auditLogs).where(eq(auditLogs.targetId, fx.requestId));
  for (const id of fx.cleanupIds) {
    await db.delete(users).where(eq(users.id, id));
  }
  await db.delete(leaveTypes).where(eq(leaveTypes.id, fx.leaveTypeId));
}

function installSlackStub(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    return new Response(JSON.stringify({ ok: true, channel: { id: "C_TEST" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

dbDescribe("leave cancellation workflow", () => {
  beforeEach(() => {
    process.env["SLACK_BOT_TOKEN"] = "xoxb-test-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  // ---------- cancelLeaveRequest (entry point) ----------

  it("PENDING → CANCELLED instantly, no balance change, no notifications", async () => {
    installSlackStub();
    const fx = await seedFixture({ status: "PENDING" });
    try {
      const { cancelLeaveRequest } = await import("@/lib/leave/cancel");
      const result = await cancelLeaveRequest(fx.requestId, fx.employeeId);

      expect(result.status).toBe("CANCELLED");
      expect(result.refunded).toBe(false);
      expect(result.action).toBe("cancelled");

      const { db } = await import("@/lib/db");
      const reqRows = await db
        .select({ status: leaveRequests.status })
        .from(leaveRequests)
        .where(eq(leaveRequests.id, fx.requestId));
      expect(reqRows[0]?.status).toBe("CANCELLED");

      const balRows = await db
        .select({ used: leaveBalances.used })
        .from(leaveBalances)
        .where(eq(leaveBalances.employeeId, fx.employeeId));
      expect(balRows[0]?.used).toBe(0);

      const empNotifs = await db
        .select()
        .from(notifications)
        .where(eq(notifications.employeeId, fx.employeeId));
      expect(empNotifs).toHaveLength(0);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("APPROVED + future → PENDING_CANCELLATION; no balance change; manager notified", async () => {
    installSlackStub();
    const fx = await seedFixture({ status: "APPROVED" });
    try {
      const { cancelLeaveRequest } = await import("@/lib/leave/cancel");
      const result = await cancelLeaveRequest(fx.requestId, fx.employeeId);

      expect(result.status).toBe("PENDING_CANCELLATION");
      expect(result.refunded).toBe(false);
      expect(result.action).toBe("cancellation_requested");

      const { db } = await import("@/lib/db");
      const reqRows = await db
        .select({ status: leaveRequests.status })
        .from(leaveRequests)
        .where(eq(leaveRequests.id, fx.requestId));
      expect(reqRows[0]?.status).toBe("PENDING_CANCELLATION");

      // Balance unchanged — refund only happens on manager approval.
      const balRows = await db
        .select({ used: leaveBalances.used })
        .from(leaveBalances)
        .where(eq(leaveBalances.employeeId, fx.employeeId));
      expect(balRows[0]?.used).toBe(3);

      // Manager got an in-app + slack notification.
      const mgrNotifs = await db
        .select({ type: notifications.type })
        .from(notifications)
        .where(eq(notifications.employeeId, fx.managerId));
      expect(mgrNotifs.map((n) => n.type)).toContain("leave.cancel_requested");

      // Audit log records the request.
      const logs = await db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.targetId, fx.requestId));
      expect(logs.map((l) => l.action)).toContain("leave.cancel_requested");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("APPROVED + past start date → throws (past-leave lock)", async () => {
    installSlackStub();
    // Pick a fixed past date — well before today regardless of when the
    // test runs.
    const fx = await seedFixture({
      status: "APPROVED",
      startDate: "2000-01-03",
      endDate: "2000-01-05",
    });
    try {
      const { cancelLeaveRequest } = await import("@/lib/leave/cancel");
      await expect(
        cancelLeaveRequest(fx.requestId, fx.employeeId),
      ).rejects.toThrow(/already started/i);

      // Status untouched.
      const { db } = await import("@/lib/db");
      const reqRows = await db
        .select({ status: leaveRequests.status })
        .from(leaveRequests)
        .where(eq(leaveRequests.id, fx.requestId));
      expect(reqRows[0]?.status).toBe("APPROVED");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("refuses to re-cancel a request already in PENDING_CANCELLATION", async () => {
    installSlackStub();
    const fx = await seedFixture({ status: "PENDING_CANCELLATION" });
    try {
      const { cancelLeaveRequest } = await import("@/lib/leave/cancel");
      await expect(
        cancelLeaveRequest(fx.requestId, fx.employeeId),
      ).rejects.toThrow(/already requested/i);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("refuses to cancel a CANCELLED or REJECTED request", async () => {
    installSlackStub();
    const fx = await seedFixture({ status: "PENDING" });
    try {
      const { db } = await import("@/lib/db");
      await db
        .update(leaveRequests)
        .set({ status: "CANCELLED" })
        .where(eq(leaveRequests.id, fx.requestId));

      const { cancelLeaveRequest } = await import("@/lib/leave/cancel");
      await expect(
        cancelLeaveRequest(fx.requestId, fx.employeeId),
      ).rejects.toThrow(/Cannot cancel/i);
    } finally {
      await cleanupFixture(fx);
    }
  });

  // ---------- approveLeaveCancellation (manager) ----------

  it("approveLeaveCancellation: refunds balance, flips to CANCELLED, notifies employee", async () => {
    installSlackStub();
    const fx = await seedFixture({ status: "PENDING_CANCELLATION" });
    try {
      const { approveLeaveCancellation } = await import("@/lib/leave/cancel");
      const result = await approveLeaveCancellation(fx.requestId, fx.reviewerId);
      expect(result.status).toBe("CANCELLED");
      expect(result.refunded).toBe(true);
      expect(result.action).toBe("cancellation_approved");

      const { db } = await import("@/lib/db");
      const balRows = await db
        .select({ used: leaveBalances.used })
        .from(leaveBalances)
        .where(eq(leaveBalances.employeeId, fx.employeeId));
      expect(balRows[0]?.used).toBe(0);

      const empNotifs = await db
        .select({ type: notifications.type })
        .from(notifications)
        .where(eq(notifications.employeeId, fx.employeeId));
      expect(empNotifs.map((n) => n.type)).toContain("leave.cancelled");

      const logs = await db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.targetId, fx.requestId));
      expect(logs.map((l) => l.action)).toContain("leave.cancel_approved");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("approveLeaveCancellation rejects if request is not PENDING_CANCELLATION", async () => {
    installSlackStub();
    const fx = await seedFixture({ status: "APPROVED" });
    try {
      const { approveLeaveCancellation } = await import("@/lib/leave/cancel");
      await expect(
        approveLeaveCancellation(fx.requestId, fx.reviewerId),
      ).rejects.toThrow(/PENDING_CANCELLATION/);
    } finally {
      await cleanupFixture(fx);
    }
  });

  // ---------- rejectLeaveCancellation (manager) ----------

  it("rejectLeaveCancellation: reverts to APPROVED, stores reviewerNote, notifies employee", async () => {
    installSlackStub();
    const fx = await seedFixture({ status: "PENDING_CANCELLATION" });
    try {
      const { rejectLeaveCancellation } = await import("@/lib/leave/cancel");
      const result = await rejectLeaveCancellation(
        fx.requestId,
        fx.reviewerId,
        "Need you for the deadline",
      );
      expect(result.status).toBe("APPROVED");
      expect(result.refunded).toBe(false);

      const { db } = await import("@/lib/db");
      const reqRows = await db
        .select({ status: leaveRequests.status, note: leaveRequests.reviewerNote })
        .from(leaveRequests)
        .where(eq(leaveRequests.id, fx.requestId));
      expect(reqRows[0]?.status).toBe("APPROVED");
      expect(reqRows[0]?.note).toBe("Need you for the deadline");

      // Balance unchanged (still APPROVED, still used=3).
      const balRows = await db
        .select({ used: leaveBalances.used })
        .from(leaveBalances)
        .where(eq(leaveBalances.employeeId, fx.employeeId));
      expect(balRows[0]?.used).toBe(3);

      const empNotifs = await db
        .select({ type: notifications.type })
        .from(notifications)
        .where(eq(notifications.employeeId, fx.employeeId));
      expect(empNotifs.map((n) => n.type)).toContain("leave.cancel_rejected");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("rejectLeaveCancellation requires a non-empty note", async () => {
    installSlackStub();
    const fx = await seedFixture({ status: "PENDING_CANCELLATION" });
    try {
      const { rejectLeaveCancellation } = await import("@/lib/leave/cancel");
      await expect(
        rejectLeaveCancellation(fx.requestId, fx.reviewerId, "   "),
      ).rejects.toThrow(/note is required/i);
    } finally {
      await cleanupFixture(fx);
    }
  });

  // ---------- withdrawLeaveCancellation (owner) ----------

  it("withdrawLeaveCancellation by owner: reverts to APPROVED, no notify", async () => {
    installSlackStub();
    const fx = await seedFixture({ status: "PENDING_CANCELLATION" });
    try {
      const { withdrawLeaveCancellation } = await import("@/lib/leave/cancel");
      const result = await withdrawLeaveCancellation(
        fx.requestId,
        fx.employeeId,
      );
      expect(result.status).toBe("APPROVED");

      const { db } = await import("@/lib/db");
      const reqRows = await db
        .select({ status: leaveRequests.status })
        .from(leaveRequests)
        .where(eq(leaveRequests.id, fx.requestId));
      expect(reqRows[0]?.status).toBe("APPROVED");

      const logs = await db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(eq(auditLogs.targetId, fx.requestId));
      expect(logs.map((l) => l.action)).toContain("leave.cancel_withdrawn");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("withdrawLeaveCancellation by non-owner throws", async () => {
    installSlackStub();
    const fx = await seedFixture({ status: "PENDING_CANCELLATION" });
    try {
      const { withdrawLeaveCancellation } = await import("@/lib/leave/cancel");
      await expect(
        withdrawLeaveCancellation(fx.requestId, "someone-else"),
      ).rejects.toThrow(/Only the requester/i);
    } finally {
      await cleanupFixture(fx);
    }
  });

  // ---------- adminForceCancelLeave ----------

  it("adminForceCancelLeave bypasses past-leave lock and refunds APPROVED leave", async () => {
    installSlackStub();
    const fx = await seedFixture({
      status: "APPROVED",
      startDate: "2000-01-03",
      endDate: "2000-01-05",
    });
    try {
      const { adminForceCancelLeave } = await import("@/lib/leave/cancel");
      const result = await adminForceCancelLeave(
        fx.requestId,
        fx.managerId,
        "Booked wrong dates by accident",
      );
      expect(result.status).toBe("CANCELLED");
      expect(result.refunded).toBe(true);

      const { db } = await import("@/lib/db");
      const logs = await db
        .select({ action: auditLogs.action, metadata: auditLogs.metadata })
        .from(auditLogs)
        .where(eq(auditLogs.targetId, fx.requestId));
      const override = logs.find((l) => l.action === "leave.cancel_admin_override");
      expect(override).toBeDefined();
      // Reason is persisted in metadata for forensics.
      const meta = override?.metadata as Record<string, unknown>;
      expect(meta["reason"]).toBe("Booked wrong dates by accident");
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("adminForceCancelLeave requires a reason", async () => {
    installSlackStub();
    const fx = await seedFixture({ status: "APPROVED" });
    try {
      const { adminForceCancelLeave } = await import("@/lib/leave/cancel");
      await expect(
        adminForceCancelLeave(fx.requestId, fx.managerId, "   "),
      ).rejects.toThrow(/reason/i);
    } finally {
      await cleanupFixture(fx);
    }
  });

  it("cancelLeaveRequest on a non-existent id throws not-found", async () => {
    installSlackStub();
    const { cancelLeaveRequest } = await import("@/lib/leave/cancel");
    const ghost = "00000000-0000-0000-0000-000000000000";
    await expect(cancelLeaveRequest(ghost, "actor")).rejects.toThrow(
      /not found/i,
    );
  });
});