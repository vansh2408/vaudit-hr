/**
 * Leave cancellation workflow.
 *
 * State transitions:
 *
 *   PENDING ─(owner / admin)──────────────► CANCELLED       (instant, no balance change)
 *
 *   APPROVED ─(owner / admin, not past)──► PENDING_CANCELLATION
 *
 *   PENDING_CANCELLATION ─(manager / admin)─APPROVE_CANCEL─► CANCELLED  (balance refunded for paid leave)
 *                                          └REJECT_CANCEL ─► APPROVED   (reviewerNote required)
 *                                          └WITHDRAW (owner)─► APPROVED (no refund, audit-logged)
 *
 *   (any non-terminal state) ─(admin force-override w/ reason)─► CANCELLED
 *
 * Authorization is the route layer's job — this module trusts the caller
 * has already verified ownership / manager-of / admin status. It only
 * validates the *state machine* and the *past-leave lock*.
 *
 * Past-leave lock: an owner cannot cancel (or request cancellation of) a
 * leave whose start date is today or earlier — the time was effectively
 * consumed. Admin override (`adminForceCancelLeave`) bypasses this with
 * an audit-logged reason.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  leaveRequests,
  users,
  type LeaveRequest,
  type RequestStatus,
} from "@/lib/db/schema";
import { refundBalance } from "@/lib/leave/balance";
import { todayYmd, unsafeYmd, ymdYear } from "@/lib/utils/dates";
import { formatDays } from "@/lib/utils/format-days";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyEmployee } from "@/lib/notify";
import { getApproverRecipients } from "@/lib/notify/recipients";
import { BadStateError } from "@/lib/api/errors";

export interface CancelResult {
  id: string;
  status: RequestStatus;
  /** True only when balance was refunded as part of this call. */
  refunded: boolean;
  /**
   * Discriminator for the UI toast and downstream side effects. "cancelled"
   * means the request reached its terminal CANCELLED state; the other
   * actions represent intermediate transitions in the workflow.
   */
  action:
    | "cancelled"
    | "cancellation_requested"
    | "cancellation_approved"
    | "cancellation_rejected"
    | "cancellation_withdrawn";
}

const NOT_FOUND = "Leave request not found";

type LeaveTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function loadRequest(id: string): Promise<LeaveRequest> {
  const rows = await db
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.id, id))
    .limit(1);
  const req = rows[0];
  if (!req) throw new Error(NOT_FOUND);
  return req;
}

/**
 * SELECT ... FOR UPDATE — Postgres row-lock until the surrounding tx commits.
 *
 * Every cancellation transition goes through this so that two concurrent
 * operations on the same request serialize. Without it the
 * approve-cancellation + admin-force-cancel pair could both read
 * PENDING_CANCELLATION, both refund balance, and we'd issue the refund twice;
 * approve + withdraw could race and leave the row APPROVED with a refunded
 * balance. The lock blocks the second tx until the first commits, at which
 * point the second's state precondition fails and it errors cleanly.
 */
async function loadForUpdate(tx: LeaveTx, id: string): Promise<LeaveRequest> {
  const rows = await tx
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.id, id))
    .for("update")
    .limit(1);
  const req = rows[0];
  if (!req) throw new Error(NOT_FOUND);
  return req;
}

function assertNotStarted(req: LeaveRequest): void {
  // Calendar-date comparison via Ymd strings — TZ-stable, no Date math.
  // "Started" includes today: once today >= start, the day is being consumed.
  // Uses a dedicated PAST_LEAVE_LOCK code so the UI doesn't mistake this
  // for a race condition and silently refresh — it's a business rule, not
  // stale state, and the user needs to see the actual message.
  const today = todayYmd();
  if (req.startDate <= today) {
    throw new BadStateError(
      "Cannot cancel a leave that has already started. Contact an admin if this needs an override.",
      "PAST_LEAVE_LOCK",
    );
  }
}

/**
 * Public entry point for the owner-initiated DELETE handler. Branches on
 * current state and applies the past-leave lock for the APPROVED path.
 *   PENDING              → instant cancel (no notifications)
 *   APPROVED             → cancellation request (past-lock applies)
 *   PENDING_CANCELLATION → already requested, refuse (use withdraw to undo)
 *   else                 → refuse
 *
 * The whole branch runs inside a single tx with the row locked so concurrent
 * cancel + manager-approve / manager-reject can't both proceed; the loser
 * sees the lock release with the row already in its new state and fails the
 * precondition cleanly (rather than producing inconsistent rows).
 */
export async function cancelLeaveRequest(
  requestId: string,
  byUserId: string,
): Promise<CancelResult> {
  // Pre-fetch outside the tx for the past-leave lock check (cheap, no
  // mutation). Past-lock failures need not lock the row.
  const initial = await loadRequest(requestId);
  if (initial.status === "APPROVED") assertNotStarted(initial);

  // Side effects we'll fire after the tx commits (notifications); we collect
  // them inside the tx instead of calling external services with the row
  // lock held.
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
        .update(leaveRequests)
        .set({ status: "CANCELLED" })
        .where(eq(leaveRequests.id, req.id));
      return {
        id: req.id,
        status: "CANCELLED" as RequestStatus,
        refunded: false,
        action: "cancelled" as const,
      };
    }
    if (req.status === "APPROVED") {
      // Re-check past-lock inside the tx in case the date somehow shifted.
      assertNotStarted(req);
      await tx
        .update(leaveRequests)
        .set({ status: "PENDING_CANCELLATION" })
        .where(eq(leaveRequests.id, req.id));
      await writeAuditLog({
        actorId: byUserId,
        action: "leave.cancel_requested",
        targetTable: "leave_requests",
        targetId: req.id,
        // `totalHalfDays` matches the column's unit (post-0006). The older
        // `totalDays` key in pre-existing audit rows also stored half-days
        // despite the name; standardising forward writes avoids analyst
        // confusion.
        metadata: {
          employeeId: req.employeeId,
          totalHalfDays: req.totalDays,
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
        refunded: false,
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

  // Post-commit notifications — only the cancel_requested path fires one.
  // Discriminate via the captured payload, not the result, so a future caller
  // adding new branches doesn't accidentally enable a side-effect.
  // TypeScript narrows pendingNotify to never inside the callback; cast back.
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
      .select({
        firstName: users.firstName,
        managerId: users.managerId,
      })
      .from(users)
      .where(eq(users.id, notify.employeeId))
      .limit(1);
    const employeeFirstName = me[0]?.firstName ?? null;
    // Fanout: current manager (or original reviewer if no manager today)
    // PLUS every active HR_ADMIN / SUPER_ADMIN — per A23. The requester
    // is excluded inside getApproverRecipients.
    const primaryApproverId = me[0]?.managerId ?? notify.reviewedById ?? null;
    const recipients = await getApproverRecipients(notify.employeeId, primaryApproverId);
    const cancelMessage = `${employeeFirstName ?? "An employee"} requested to cancel an approved leave (${formatDays(notify.totalDays)}) — please review.`;
    for (const r of recipients) {
      await notifyEmployee({
        employeeId: r.id,
        slackUserId: r.slackUserId,
        type: "leave.cancel_requested",
        message: cancelMessage,
        link: `/approvals`,
      });
    }
  }

  return result;
}

/**
 * Manager approves a pending cancellation. Refunds balance for paid leave
 * (refundBalance is a no-op for unpaid types — it inspects the leave_type).
 * Notifies the employee. Optional `reviewerNote` lets the manager record why
 * (e.g. "OK — sorry to lose the coverage but go ahead"); persisted on the
 * request row and surfaced on the timeline.
 *
 * Row locked for the duration of the tx so a concurrent withdraw or
 * admin-override can't double-refund.
 */
export async function approveLeaveCancellation(
  requestId: string,
  reviewerId: string,
  reviewerNote?: string,
): Promise<CancelResult> {
  const result = await db.transaction(async (tx) => {
    const req = await loadForUpdate(tx, requestId);
    if (req.status !== "PENDING_CANCELLATION") {
      throw new BadStateError(
        `Cannot approve cancellation: request is ${req.status}, expected PENDING_CANCELLATION`,
      );
    }
    // If the leave has already started while the cancellation sat in the
    // queue, refunding now would over-credit the employee — they've
    // already consumed those days. Block the approval; the manager can
    // still REJECT the cancellation (no refund, no change of state needed
    // beyond reverting to APPROVED) to close out the row.
    assertNotStarted(req);
    const year = ymdYear(unsafeYmd(req.startDate));
    await refundBalance(req.employeeId, req.leaveTypeId, req.totalDays, year, tx);
    await tx
      .update(leaveRequests)
      .set({
        status: "CANCELLED",
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        ...(reviewerNote !== undefined && reviewerNote.length > 0
          ? { reviewerNote }
          : {}),
      })
      .where(eq(leaveRequests.id, requestId));
    return req;
  });

  await writeAuditLog({
    actorId: reviewerId,
    action: "leave.cancel_approved",
    targetTable: "leave_requests",
    targetId: requestId,
    metadata: {
      employeeId: result.employeeId,
      totalHalfDays: result.totalDays,
      ...(reviewerNote !== undefined && reviewerNote.length > 0
        ? { reviewerNote }
        : {}),
    },
  });

  const emp = await db
    .select({ firstName: users.firstName, slackUserId: users.slackUserId })
    .from(users)
    .where(eq(users.id, result.employeeId))
    .limit(1);
  await notifyEmployee({
    employeeId: result.employeeId,
    slackUserId: emp[0]?.slackUserId ?? null,
    type: "leave.cancelled",
    message: `Your cancellation request was approved. Balance refunded (${formatDays(result.totalDays)}).`,
    link: `/leave/${requestId}`,
    ...(reviewerNote !== undefined && reviewerNote.length > 0
      ? { userContent: reviewerNote }
      : {}),
  });

  return {
    id: requestId,
    status: "CANCELLED",
    refunded: true,
    action: "cancellation_approved",
  };
}

/**
 * Manager rejects the cancellation. Status reverts to APPROVED, no balance
 * change. A reviewer note is required so the employee knows why.
 *
 * Row-locked so a concurrent approve/withdraw can't race past this.
 */
export async function rejectLeaveCancellation(
  requestId: string,
  reviewerId: string,
  reviewerNote: string,
): Promise<CancelResult> {
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
      .update(leaveRequests)
      .set({
        status: "APPROVED",
        reviewedById: reviewerId,
        reviewedAt: new Date(),
        reviewerNote,
      })
      .where(eq(leaveRequests.id, requestId));
    return req;
  });

  await writeAuditLog({
    actorId: reviewerId,
    action: "leave.cancel_rejected",
    targetTable: "leave_requests",
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
    type: "leave.cancel_rejected",
    message: `Your cancellation request was rejected. The leave remains approved.`,
    link: `/leave/${requestId}`,
    userContent: reviewerNote,
  });

  return {
    id: requestId,
    status: "APPROVED",
    refunded: false,
    action: "cancellation_rejected",
  };
}

/**
 * Owner withdraws their own pending cancellation before the manager acts.
 * Reverts to APPROVED with no balance change. No reviewer note needed.
 *
 * Row-locked so a concurrent manager approve/reject can't race; loser sees
 * the row in its new terminal state and errors cleanly.
 */
export async function withdrawLeaveCancellation(
  requestId: string,
  byUserId: string,
): Promise<CancelResult> {
  const result = await db.transaction(async (tx) => {
    const req = await loadForUpdate(tx, requestId);
    if (req.status !== "PENDING_CANCELLATION") {
      throw new BadStateError(
        `Cannot withdraw: request is ${req.status}, expected PENDING_CANCELLATION`,
      );
    }
    if (req.employeeId !== byUserId) {
      // Defense-in-depth — the route already checks ownership, but a stray
      // call from elsewhere shouldn't be able to withdraw someone else's
      // cancellation request.
      throw new Error("Only the requester can withdraw their cancellation request");
    }
    await tx
      .update(leaveRequests)
      .set({ status: "APPROVED" })
      .where(eq(leaveRequests.id, requestId));
    return req;
  });

  await writeAuditLog({
    actorId: byUserId,
    action: "leave.cancel_withdrawn",
    targetTable: "leave_requests",
    targetId: requestId,
    metadata: { employeeId: result.employeeId },
  });

  return {
    id: requestId,
    status: "APPROVED",
    refunded: false,
    action: "cancellation_withdrawn",
  };
}

/**
 * Admin escape hatch — force-cancel from any non-terminal state with a
 * mandatory reason. Refunds balance iff the request was APPROVED or
 * PENDING_CANCELLATION (both states mean the days were "committed"; the
 * pending-cancellation case had not refunded yet, so it must refund here).
 *
 * Row-locked so it can't race with concurrent owner/manager actions and
 * accidentally double-refund or under-refund.
 */
export async function adminForceCancelLeave(
  requestId: string,
  adminId: string,
  reason: string,
): Promise<CancelResult> {
  if (reason.trim().length === 0) {
    throw new Error("Admin override requires a reason");
  }
  const result = await db.transaction(async (tx) => {
    const req = await loadForUpdate(tx, requestId);
    if (req.status === "CANCELLED" || req.status === "REJECTED") {
      throw new BadStateError(`Cannot admin-cancel a ${req.status} request`);
    }
    const shouldRefund =
      req.status === "APPROVED" || req.status === "PENDING_CANCELLATION";
    if (shouldRefund) {
      const year = ymdYear(unsafeYmd(req.startDate));
      await refundBalance(req.employeeId, req.leaveTypeId, req.totalDays, year, tx);
    }
    await tx
      .update(leaveRequests)
      .set({ status: "CANCELLED" })
      .where(eq(leaveRequests.id, requestId));
    return { req, refunded: shouldRefund };
  });

  await writeAuditLog({
    actorId: adminId,
    action: "leave.cancel_admin_override",
    targetTable: "leave_requests",
    targetId: requestId,
    metadata: {
      employeeId: result.req.employeeId,
      previousStatus: result.req.status,
      reason,
      refunded: result.refunded,
    },
  });

  const emp = await db
    .select({ slackUserId: users.slackUserId })
    .from(users)
    .where(eq(users.id, result.req.employeeId))
    .limit(1);
  await notifyEmployee({
    employeeId: result.req.employeeId,
    slackUserId: emp[0]?.slackUserId ?? null,
    type: "leave.cancelled_by_admin",
    message: `An admin cancelled your leave request${result.refunded ? " (balance refunded)" : ""}.`,
    link: `/leave/${requestId}`,
    userContent: reason,
  });

  return {
    id: requestId,
    status: "CANCELLED",
    refunded: result.refunded,
    action: "cancelled",
  };
}