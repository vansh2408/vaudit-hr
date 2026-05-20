/**
 * Soft-delete an employee — decisions.md A9.
 *
 * Single transaction:
 *  1. Refuse if target is the last active SUPER_ADMIN (would lock the org
 *     out of role management — see role-change route for the parallel
 *     guard). Surfaced as a `LastSuperAdminError` so the route handler can
 *     map it to a 409.
 *  2. Set users.isActive = false
 *  3. Cancel all PENDING leave_requests for this employee (no balance refund —
 *     PENDING never consumed balance)
 *  4. Cancel all PENDING wfh_requests for this employee
 *
 * After the transaction commits (so we don't hold open connections during
 * external IO):
 *  5. Audit log the deactivation
 *  6. Notify the employee in-app + Slack
 */
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  leaveRequests,
  users,
  wfhRequests,
} from "@/lib/db/schema";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyEmployee } from "@/lib/notify";

export interface DeactivateResult {
  userId: string;
  cancelledLeaveIds: string[];
  cancelledWfhIds: string[];
}

/**
 * Thrown when deactivation is refused because the target is the only
 * remaining active SUPER_ADMIN. Routes catch this and return a 409.
 */
export class LastSuperAdminError extends Error {
  override readonly name = "LastSuperAdminError";
  constructor(message = "Cannot deactivate the last active SUPER_ADMIN") {
    super(message);
  }
}

export async function deactivateEmployee(
  targetUserId: string,
  byUserId: string,
): Promise<DeactivateResult> {
  const result = await db.transaction(async (tx) => {
    const targetRows = await tx
      .select()
      .from(users)
      .where(eq(users.id, targetUserId))
      .limit(1);
    const target = targetRows[0];
    if (!target) throw new Error("Employee not found");
    if (!target.isActive) {
      return {
        userId: target.id,
        cancelledLeaveIds: [] as string[],
        cancelledWfhIds: [] as string[],
        slackUserId: target.slackUserId,
        firstName: target.firstName,
      };
    }

    // Last-SUPER_ADMIN guard. We count OTHER active SUPER_ADMINs inside the
    // transaction so concurrent deactivations don't both succeed. Same
    // shape as the role-change last-SUPER_ADMIN guard.
    if (target.role === "SUPER_ADMIN") {
      const others = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.role, "SUPER_ADMIN"),
            eq(users.isActive, true),
            ne(users.id, targetUserId),
          ),
        )
        .limit(1);
      if (others.length === 0) {
        throw new LastSuperAdminError();
      }
    }

    await tx
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, targetUserId));

    const pendingLeave = await tx
      .select({ id: leaveRequests.id })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.employeeId, targetUserId),
          eq(leaveRequests.status, "PENDING"),
        ),
      );

    if (pendingLeave.length > 0) {
      await tx
        .update(leaveRequests)
        .set({ status: "CANCELLED" })
        .where(
          and(
            eq(leaveRequests.employeeId, targetUserId),
            eq(leaveRequests.status, "PENDING"),
          ),
        );
    }

    const pendingWfh = await tx
      .select({ id: wfhRequests.id })
      .from(wfhRequests)
      .where(
        and(
          eq(wfhRequests.employeeId, targetUserId),
          eq(wfhRequests.status, "PENDING"),
        ),
      );

    if (pendingWfh.length > 0) {
      await tx
        .update(wfhRequests)
        .set({ status: "CANCELLED" })
        .where(
          and(
            eq(wfhRequests.employeeId, targetUserId),
            eq(wfhRequests.status, "PENDING"),
          ),
        );
    }

    return {
      userId: target.id,
      cancelledLeaveIds: pendingLeave.map((r) => r.id),
      cancelledWfhIds: pendingWfh.map((r) => r.id),
      slackUserId: target.slackUserId,
      firstName: target.firstName,
    };
  });

  await writeAuditLog({
    actorId: byUserId,
    action: "employee.deactivate",
    targetTable: "users",
    targetId: targetUserId,
    metadata: {
      cancelledLeaveIds: result.cancelledLeaveIds,
      cancelledWfhIds: result.cancelledWfhIds,
    },
  });

  for (const id of result.cancelledLeaveIds) {
    await writeAuditLog({
      actorId: byUserId,
      action: "leave.auto_cancel_on_deactivate",
      targetTable: "leave_requests",
      targetId: id,
      metadata: { reason: "account deactivated" },
    });
  }
  for (const id of result.cancelledWfhIds) {
    await writeAuditLog({
      actorId: byUserId,
      action: "wfh.auto_cancel_on_deactivate",
      targetTable: "wfh_requests",
      targetId: id,
      metadata: { reason: "account deactivated" },
    });
  }

  const totalCancelled =
    result.cancelledLeaveIds.length + result.cancelledWfhIds.length;
  if (totalCancelled > 0) {
    await notifyEmployee({
      employeeId: result.userId,
      slackUserId: result.slackUserId ?? null,
      type: "employee.deactivated",
      message: `Your account has been deactivated. ${totalCancelled} pending request(s) were auto-cancelled.`,
      link: null,
    });
  }

  return {
    userId: result.userId,
    cancelledLeaveIds: result.cancelledLeaveIds,
    cancelledWfhIds: result.cancelledWfhIds,
  };
}
