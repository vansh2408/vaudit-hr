/**
 * WFH cancellation workflow — mirrors lib/leave/cancel.ts.
 *
 * WFH never consumes balance, so there is no refund step. The workflow is
 * kept symmetric with leave so the UI, notifications, and audit timeline
 * stay consistent: a manager still sees and decides on a cancellation
 * request before an already-approved WFH day flips to CANCELLED.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  users,
  wfhRequests,
  type RequestStatus,
  type WfhRequest,
} from "@/lib/db/schema";
import { todayYmd } from "@/lib/utils/dates";
import { formatDays } from "@/lib/utils/format-days";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyEmployee } from "@/lib/notify";
import { getApproverRecipients } from "@/lib/notify/recipients";
import { BadStateError } from "@/lib/api/errors";

export interface WfhCancelResult {
  id: string;
  status: RequestStatus;
  action:
    | "cancelled"
    | "cancellation_requested"
    | "cancellation_approved"
    | "cancellation_rejected"
    | "cancellation_withdrawn";
}

const NOT_FOUND = "WFH request not found";

type WfhTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function loadRequest(id: string): Promise<WfhRequest> {
  const rows = await db
    .select()
    .from(wfhRequests)
    .where(eq(wfhRequests.id, id))
    .limit(1);
  const req = rows[0];
  if (!req) throw new Error(NOT_FOUND);
  return req;
}

/**
 * SELECT ... FOR UPDATE — see lib/leave/cancel.ts for the rationale. WFH
 * doesn't refund balance so the race consequences are milder, but the
 * status-flip races (e.g. approve cancellation vs. owner withdraw) are still
 * worth serializing for forensic clarity in the audit log.
 */
async function loadForUpdate(tx: WfhTx, id: string): Promise<WfhRequest> {
  const rows = await tx
    .select()
    .from(wfhRequests)
    .where(eq(wfhRequests.id, id))
    .for("update")
    .limit(1);
  const req = rows[0];
  if (!req) throw new Error(NOT_FOUND);
  return req;
}

function assertNotStarted(req: WfhRequest): void {
  const today = todayYmd();
  if (req.startDate <= today) {
    throw new BadStateError(
      "Cannot cancel a WFH request that has already started. Contact an admin for an override.",
    );
  }
}

/**
 * Owner-initiated entry point. Mirrors lib/leave/cancel.ts — branches by
 * status under a row lock so concurrent operations can't produce
 * inconsistent state. Past-leave lock blocks APPROVED + already-started.
 */
export async function cancelWfhRequest(
  requestId: string,
  byUserId: string,
): Promise<WfhCancelResult> {
  const initial = await loadRequest(requestId);
  if (initial.status === "APPROVED") assertNotStarted(initial);

  let pendingNotify:
    | {
        kind: "cancel_requested";
        employeeId: string;
        totalDays: number;
        reviewedById: string | null;
      }
    | null = null;

  const result = await db.transaction(async (tx) => {
    const req = await loadForUpdate(tx, requestId);

    if (req.status === "PENDING") {
      await tx
        .update(wfhRequests)
        .set({ status: "CANCELLED" })
        .where(eq(wfhRequests.id, req.id));
      return {
        id: req.id,
        status: "CANCELLED" as RequestStatus,
        action: "cancelled" as const,
      };
    }
    if (req.status === "APPROVED") {
      assertNotStarted(req);
      await tx
        .update(wfhRequests)
        .set({ status: "PENDING_CANCELLATION" })
        .where(eq(wfhRequests.id, req.id));
      await writeAuditLog({
        actorId: byUserId,
        action: "wfh.cancel_requested",
        targetTable: "wfh_requests",
        targetId: req.id,
        metadata: {
          employeeId: req.employeeId,
          totalDays: req.totalDays,
          reviewedById: req.reviewedById,
        },
      });
      pendingNotify = {
        kind: "cancel_requested",
        employeeId: req.employeeId,
        totalDays: req.totalDays,
        reviewedById: req.reviewedById,
      };
      return {
        id: req.id,
        status: "PENDING_CANCELLATION" as RequestStatus,
        action: "cancellation_requested" as const,
      };
    }
    if (req.status === "PENDING_CANCELLATION") {
      throw new BadStateError(
        "Cancellation already requested. Withdraw it or wait for the manager to decide.",
      );
    }
    throw new BadStateError(`Cannot cancel a ${req.status} request`);
  });

  const notify = pendingNotify as
    | {
        kind: "cancel_requested";
        employeeId: string;
        totalDays: number;
        reviewedById: string | null;
      }
    | null;
  if (notify !== null) {
    const me = await db
      .select({ firstName: users.firstName, managerId: users.managerId })
      .from(users)
      .where(eq(users.id, notify.employeeId))
      .limit(1);
    const employeeFirstName = me[0]?.firstName ?? null;
    const primaryApproverId = me[0]?.managerId ?? notify.reviewedById ?? null;
    const recipients = await getApproverRecipients(notify.employeeId, primaryApproverId);
    const cancelMessage = `${employeeFirstName ?? "An employee"} requested to cancel an approved WFH (${formatDays(notify.totalDays)}) — please review.`;
    for (const r of recipients) {
      await notifyEmployee({
        employeeId: r.id,
        slackUserId: r.slackUserId,
        type: "wfh.cancel_requested",
        message: cancelMessage,
        link: `/approvals`,
      });
    }
  }

  return result;
}

export async function approveWfhCancellation(
  requestId: string,
  reviewerId: string,
  reviewerNote?: string,
): Promise<WfhCancelResult> {
  const result = await db.transaction(async (tx) => {
    const req = await loadForUpdate(tx, requestId);
    if (req.status !== "PENDING_CANCELLATION") {
      throw new BadStateError(
        `Cannot approve cancellation: request is ${req.status}, expected PENDING_CANCELLATION`,
      );
    }
    await tx
      .update(wfhRequests)
      .set({
        status: "CANCELLED",
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        ...(reviewerNote !== undefined && reviewerNote.length > 0
          ? { reviewerNote }
          : {}),
      })
      .where(eq(wfhRequests.id, requestId));
    return req;
  });

  await writeAuditLog({
    actorId: reviewerId,
    action: "wfh.cancel_approved",
    targetTable: "wfh_requests",
    targetId: requestId,
    metadata: {
      employeeId: result.employeeId,
      totalDays: result.totalDays,
      ...(reviewerNote !== undefined && reviewerNote.length > 0
        ? { reviewerNote }
        : {}),
    },
  });

  const emp = await db
    .select({ slackUserId: users.slackUserId })
    .from(users)
    .where(eq(users.id, result.employeeId))
    .limit(1);
  await notifyEmployee({
    employeeId: result.employeeId,
    slackUserId: emp[0]?.slackUserId ?? null,
    type: "wfh.cancelled",
    message: `Your WFH cancellation request was approved.`,
    link: `/wfh/${requestId}`,
    ...(reviewerNote !== undefined && reviewerNote.length > 0
      ? { userContent: reviewerNote }
      : {}),
  });

  return {
    id: requestId,
    status: "CANCELLED",
    action: "cancellation_approved",
  };
}

export async function rejectWfhCancellation(
  requestId: string,
  reviewerId: string,
  reviewerNote: string,
): Promise<WfhCancelResult> {
  if (reviewerNote.trim().length === 0) {
    throw new Error("A note is required when rejecting a cancellation");
  }
  const result = await db.transaction(async (tx) => {
    const req = await loadForUpdate(tx, requestId);
    if (req.status !== "PENDING_CANCELLATION") {
      throw new BadStateError(
        `Cannot reject cancellation: request is ${req.status}, expected PENDING_CANCELLATION`,
      );
    }
    await tx
      .update(wfhRequests)
      .set({
        status: "APPROVED",
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewerNote,
      })
      .where(eq(wfhRequests.id, requestId));
    return req;
  });

  await writeAuditLog({
    actorId: reviewerId,
    action: "wfh.cancel_rejected",
    targetTable: "wfh_requests",
    targetId: requestId,
    metadata: { employeeId: result.employeeId, reviewerNote },
  });

  const emp = await db
    .select({ slackUserId: users.slackUserId })
    .from(users)
    .where(eq(users.id, result.employeeId))
    .limit(1);
  await notifyEmployee({
    employeeId: result.employeeId,
    slackUserId: emp[0]?.slackUserId ?? null,
    type: "wfh.cancel_rejected",
    message: `Your WFH cancellation request was rejected. The day remains approved.`,
    link: `/wfh/${requestId}`,
    userContent: reviewerNote,
  });

  return {
    id: requestId,
    status: "APPROVED",
    action: "cancellation_rejected",
  };
}

export async function withdrawWfhCancellation(
  requestId: string,
  byUserId: string,
): Promise<WfhCancelResult> {
  const result = await db.transaction(async (tx) => {
    const req = await loadForUpdate(tx, requestId);
    if (req.status !== "PENDING_CANCELLATION") {
      throw new BadStateError(
        `Cannot withdraw: request is ${req.status}, expected PENDING_CANCELLATION`,
      );
    }
    if (req.employeeId !== byUserId) {
      throw new Error("Only the requester can withdraw their cancellation request");
    }
    await tx
      .update(wfhRequests)
      .set({ status: "APPROVED" })
      .where(eq(wfhRequests.id, requestId));
    return req;
  });

  await writeAuditLog({
    actorId: byUserId,
    action: "wfh.cancel_withdrawn",
    targetTable: "wfh_requests",
    targetId: requestId,
    metadata: { employeeId: result.employeeId },
  });

  return {
    id: requestId,
    status: "APPROVED",
    action: "cancellation_withdrawn",
  };
}

export async function adminForceCancelWfh(
  requestId: string,
  adminId: string,
  reason: string,
): Promise<WfhCancelResult> {
  if (reason.trim().length === 0) {
    throw new Error("Admin override requires a reason");
  }
  const result = await db.transaction(async (tx) => {
    const req = await loadForUpdate(tx, requestId);
    if (req.status === "CANCELLED" || req.status === "REJECTED") {
      throw new BadStateError(`Cannot admin-cancel a ${req.status} request`);
    }
    await tx
      .update(wfhRequests)
      .set({ status: "CANCELLED" })
      .where(eq(wfhRequests.id, requestId));
    return req;
  });

  await writeAuditLog({
    actorId: adminId,
    action: "wfh.cancel_admin_override",
    targetTable: "wfh_requests",
    targetId: requestId,
    metadata: {
      employeeId: result.employeeId,
      previousStatus: result.status,
      reason,
    },
  });

  const emp = await db
    .select({ slackUserId: users.slackUserId })
    .from(users)
    .where(eq(users.id, result.employeeId))
    .limit(1);
  await notifyEmployee({
    employeeId: result.employeeId,
    slackUserId: emp[0]?.slackUserId ?? null,
    type: "wfh.cancelled_by_admin",
    message: `An admin cancelled your WFH request.`,
    link: `/wfh/${requestId}`,
    userContent: reason,
  });

  return { id: requestId, status: "CANCELLED", action: "cancelled" };
}