/**
 * /api/leave/[id]
 *  GET    → own request, or any if manager-of OR admin
 *  PATCH  → action: APPROVE | REJECT (manager-of OR admin, never self)
 *           action: EDIT             (owner-only, PENDING-only)
 *  DELETE → cancel (own, regardless of status — see decision A8)
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { holidays, leaveRequests, leaveTypes, users } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import {
  leaveRequestEditSchema,
  leaveRequestReviewSchema,
} from "@/lib/validation/common";
import { apiError, handleRouteError } from "@/lib/api/errors";
import { isAdminRole } from "@/lib/api/route-helpers";
import { checkBalance, consumeBalance } from "@/lib/leave/balance";
import { calcWorkingHalfDays } from "@/lib/leave/working-days";
import { findOverlap } from "@/lib/leave/overlap";
import { isHalfDayAllowedForLeaveType } from "@/lib/leave/policies";
import { formatDays } from "@/lib/utils/format-days";
import { ymdYear, unsafeYmd } from "@/lib/utils/dates";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyEmployee } from "@/lib/notify";
import { getApproverRecipients } from "@/lib/notify/recipients";
import {
  adminForceCancelLeave,
  approveLeaveCancellation,
  cancelLeaveRequest,
  rejectLeaveCancellation,
  withdrawLeaveCancellation,
} from "@/lib/leave/cancel";
import { assertSameOrigin } from "@/lib/security/csrf";
import { sanitizeFreeText } from "@/lib/security/sanitize";

interface Ctx {
  params: { id: string };
}

async function loadReqWithEmployee(id: string) {
  const rows = await db
    .select({
      req: leaveRequests,
      empManagerId: users.managerId,
      empFirstName: users.firstName,
      empSlackUserId: users.slackUserId,
    })
    .from(leaveRequests)
    .innerJoin(users, eq(users.id, leaveRequests.employeeId))
    .where(eq(leaveRequests.id, id))
    .limit(1);
  return rows[0];
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    const session = await requireSession();
    const row = await loadReqWithEmployee(ctx.params.id);
    if (!row) return apiError(404, "NOT_FOUND", "Leave request not found");
    const isOwn = row.req.employeeId === session.user.id;
    const isAdmin = isAdminRole(session.user.role);
    const isMgr = row.empManagerId === session.user.id;
    if (!isOwn && !isAdmin && !isMgr) return apiError(403, "FORBIDDEN", "Insufficient permissions");
    return NextResponse.json({ item: row.req });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;
    const session = await requireSession();
    const raw = (await req.json()) as { action?: unknown } | null;
    if (raw && typeof raw === "object" && raw.action === "EDIT") {
      return handleLeaveEdit(raw, ctx.params.id, session.user.id);
    }
    const body = leaveRequestReviewSchema.parse(raw);
    const safeNote =
      typeof body.reviewerNote === "string" && body.reviewerNote.length > 0
        ? sanitizeFreeText(body.reviewerNote)
        : undefined;
    const row = await loadReqWithEmployee(ctx.params.id);
    if (!row) return apiError(404, "NOT_FOUND", "Leave request not found");

    // Cancellation-workflow actions take a separate code path because the
    // state machine, auth model, and side effects differ from the normal
    // APPROVE/REJECT of a new PENDING request.
    if (
      body.action === "APPROVE_CANCEL" ||
      body.action === "REJECT_CANCEL" ||
      body.action === "WITHDRAW_CANCEL"
    ) {
      return handleCancellationDecision(
        body.action,
        ctx.params.id,
        session.user.id,
        isAdminRole(session.user.role),
        row.req.employeeId,
        row.empManagerId,
        safeNote,
      );
    }

    if (row.req.employeeId === session.user.id) {
      return apiError(403, "FORBIDDEN", "Cannot review your own request");
    }
    const isAdmin = isAdminRole(session.user.role);
    const isMgr = row.empManagerId === session.user.id;
    if (!isAdmin && !isMgr) return apiError(403, "FORBIDDEN", "Only manager or admin may review");
    if (row.req.status !== "PENDING") return apiError(409, "BAD_STATE", `Cannot review ${row.req.status} request`);
    const newStatus = body.action === "APPROVE" ? "APPROVED" : "REJECTED";
    const year = ymdYear(unsafeYmd(row.req.startDate));
    await db.transaction(async (tx) => {
      if (newStatus === "APPROVED") {
        await consumeBalance(row.req.employeeId, row.req.leaveTypeId, row.req.totalDays, year, tx);
      }
      await tx
        .update(leaveRequests)
        .set({
          status: newStatus,
          reviewedById: session.user.id,
          reviewedAt: new Date(),
          ...(safeNote !== undefined && { reviewerNote: safeNote }),
        })
        .where(eq(leaveRequests.id, ctx.params.id));
    });
    await writeAuditLog({
      actorId: session.user.id,
      action: newStatus === "APPROVED" ? "leave.approve" : "leave.reject",
      targetTable: "leave_requests",
      targetId: ctx.params.id,
      metadata: { employeeId: row.req.employeeId, totalDays: row.req.totalDays },
    });
    await notifyEmployee({
      employeeId: row.req.employeeId,
      slackUserId: row.empSlackUserId ?? null,
      type: newStatus === "APPROVED" ? "leave.approved" : "leave.rejected",
      message: `Your leave request (${formatDays(row.req.totalDays)}) was ${newStatus.toLowerCase()}.`,
      link: `/leave/${ctx.params.id}`,
      ...(safeNote !== undefined && { userContent: safeNote }),
    });
    return NextResponse.json({ id: ctx.params.id, status: newStatus });
  } catch (err) {
    return handleRouteError(err);
  }
}

/**
 * Cancellation-workflow PATCH handler. Splits out of the main PATCH because
 * each branch has its own auth rules (owner-only for WITHDRAW, manager/admin
 * for APPROVE/REJECT) and lives in lib/leave/cancel.ts which already wraps
 * the state-machine + audit + notifications.
 */
async function handleCancellationDecision(
  action: "APPROVE_CANCEL" | "REJECT_CANCEL" | "WITHDRAW_CANCEL",
  requestId: string,
  actorId: string,
  isAdmin: boolean,
  employeeId: string,
  empManagerId: string | null,
  safeNote: string | undefined,
): Promise<NextResponse> {
  if (action === "WITHDRAW_CANCEL") {
    if (actorId !== employeeId) {
      return apiError(403, "FORBIDDEN", "Only the requester can withdraw their cancellation request");
    }
    const result = await withdrawLeaveCancellation(requestId, actorId);
    return NextResponse.json(result);
  }
  // APPROVE_CANCEL or REJECT_CANCEL — manager-of OR admin, never self.
  if (actorId === employeeId) {
    return apiError(403, "FORBIDDEN", "Cannot review your own cancellation request");
  }
  if (!isAdmin && empManagerId !== actorId) {
    return apiError(403, "FORBIDDEN", "Only manager or admin may decide a cancellation");
  }
  if (action === "APPROVE_CANCEL") {
    // Note is optional on approval — manager may want to document "OK
    // — sorry to lose the coverage" or just approve silently.
    const result = await approveLeaveCancellation(
      requestId,
      actorId,
      safeNote,
    );
    return NextResponse.json(result);
  }
  // REJECT_CANCEL requires a note so the employee understands why.
  if (safeNote === undefined) {
    return apiError(400, "NOTE_REQUIRED", "A note is required when rejecting a cancellation");
  }
  const result = await rejectLeaveCancellation(requestId, actorId, safeNote);
  return NextResponse.json(result);
}

async function handleLeaveEdit(
  raw: unknown,
  id: string,
  actorId: string,
): Promise<NextResponse> {
  const body = leaveRequestEditSchema.parse(raw);
  const row = await loadReqWithEmployee(id);
  if (!row) return apiError(404, "NOT_FOUND", "Leave request not found");
  if (row.req.employeeId !== actorId) {
    return apiError(403, "FORBIDDEN", "Only the requester can edit this request");
  }
  if (row.req.status !== "PENDING") {
    return apiError(409, "BAD_STATE", `Cannot edit ${row.req.status} request`);
  }
  const year = ymdYear(body.startDate);
  if (ymdYear(body.endDate) !== year) {
    return apiError(400, "BAD_DATE_RANGE", "Leave range must lie in a single calendar year");
  }
  // Half-day eligibility for the (possibly new) leave type.
  const ltLookup = await db
    .select({ name: leaveTypes.name })
    .from(leaveTypes)
    .where(eq(leaveTypes.id, body.leaveTypeId))
    .limit(1);
  const ltName = ltLookup[0]?.name ?? null;
  if (!ltName) {
    return apiError(404, "LEAVE_TYPE_NOT_FOUND", "Leave type not found");
  }
  if (body.isHalfDay && !isHalfDayAllowedForLeaveType(ltName)) {
    return apiError(
      400,
      "HALF_DAY_NOT_ALLOWED",
      `${ltName} leave cannot be taken as a half day`,
    );
  }
  const safeReason =
    typeof body.reason === "string" && body.reason.length > 0
      ? sanitizeFreeText(body.reason)
      : null;
  const holidayRows = await db
    .select({ date: holidays.date })
    .from(holidays)
    .where(and(gte(holidays.date, body.startDate), lte(holidays.date, body.endDate)));
  const newTotalHalfDays = calcWorkingHalfDays(
    body.startDate,
    body.endDate,
    holidayRows.map((h) => unsafeYmd(h.date)),
    body.isHalfDay,
    body.halfDaySlot ?? null,
  );
  if (newTotalHalfDays <= 0) {
    return apiError(400, "ZERO_WORKING_DAYS", "Range contains no working days");
  }
  const bal = await checkBalance(actorId, body.leaveTypeId, newTotalHalfDays, year);
  if (!bal.ok) {
    return apiError(400, "INSUFFICIENT_BALANCE", bal.reason ?? "Insufficient balance");
  }
  // Overlap check excluding the row being edited (so it doesn't conflict
  // with itself).
  const overlap = await findOverlap({
    employeeId: actorId,
    startDate: body.startDate,
    endDate: body.endDate,
    isHalfDay: body.isHalfDay,
    halfDaySlot: body.halfDaySlot ?? null,
    excludeRequestId: id,
    excludeKind: "leave",
  });
  if (overlap) {
    return apiError(
      409,
      "OVERLAPPING_REQUEST",
      `You already have a ${overlap.kind === "leave" ? "leave" : "WFH"} request covering that ${body.isHalfDay ? "slot" : "date range"}`,
    );
  }
  await db
    .update(leaveRequests)
    .set({
      leaveTypeId: body.leaveTypeId,
      startDate: body.startDate,
      endDate: body.endDate,
      totalDays: newTotalHalfDays,
      reason: safeReason,
      isHalfDay: body.isHalfDay,
      halfDaySlot: body.halfDaySlot ?? null,
    })
    .where(eq(leaveRequests.id, id));
  await writeAuditLog({
    actorId,
    action: "leave.edit",
    targetTable: "leave_requests",
    targetId: id,
    metadata: {
      before: {
        leaveTypeId: row.req.leaveTypeId,
        startDate: row.req.startDate,
        endDate: row.req.endDate,
        totalDays: row.req.totalDays,
        reason: row.req.reason,
        isHalfDay: row.req.isHalfDay,
        halfDaySlot: row.req.halfDaySlot,
      },
      after: {
        leaveTypeId: body.leaveTypeId,
        startDate: body.startDate,
        endDate: body.endDate,
        totalDays: newTotalHalfDays,
        reason: safeReason,
        isHalfDay: body.isHalfDay,
        halfDaySlot: body.halfDaySlot ?? null,
      },
    },
  });
  const editRecipients = await getApproverRecipients(actorId, row.empManagerId);
  const editedMessage = `${row.empFirstName ?? "An employee"} edited their ${ltName} request — please re-review (${formatDays(newTotalHalfDays)}).`;
  for (const r of editRecipients) {
    await notifyEmployee({
      employeeId: r.id,
      slackUserId: r.slackUserId,
      type: "leave.edited",
      message: editedMessage,
      link: `/approvals`,
      ...(safeReason !== null && { userContent: safeReason }),
    });
  }
  return NextResponse.json({ id, totalDays: newTotalHalfDays, status: "PENDING" });
}

/**
 * DELETE = "I want this cancelled."
 *
 * The behavior depends on the current status and whether the caller passed
 * `?override=1` (admin force-cancel with a reason in the JSON body):
 *
 *   - Default path: delegate to `cancelLeaveRequest`, which branches
 *     PENDING → instant cancel; APPROVED → cancellation request awaiting
 *     manager approval (past-leave lock applies); PENDING_CANCELLATION →
 *     error (must use WITHDRAW_CANCEL via PATCH).
 *   - Admin override path (`?override=1`): admin only, accepts any
 *     non-terminal state, refunds balance if was APPROVED or PENDING_CANCEL.
 *     A reason is required in the body and is logged in audit metadata.
 */
export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;
    const session = await requireSession();
    const row = await loadReqWithEmployee(ctx.params.id);
    if (!row) return apiError(404, "NOT_FOUND", "Leave request not found");
    const isOwn = row.req.employeeId === session.user.id;
    const isAdmin = isAdminRole(session.user.role);
    if (!isOwn && !isAdmin) return apiError(403, "FORBIDDEN", "Only owner or admin may cancel");

    const url = new URL(req.url);
    const isOverride = url.searchParams.get("override") === "1";
    if (isOverride) {
      if (!isAdmin) {
        return apiError(403, "FORBIDDEN", "Only admins may force-cancel");
      }
      // Reason is mandatory for the audit trail; pulled from the request body.
      const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (reason.length === 0) {
        return apiError(400, "REASON_REQUIRED", "Admin override requires a reason");
      }
      const safeReason = sanitizeFreeText(reason);
      const result = await adminForceCancelLeave(
        ctx.params.id,
        session.user.id,
        safeReason,
      );
      return NextResponse.json(result);
    }

    // Owner path (or admin without override flag) — past-leave lock applies
    // inside cancelLeaveRequest for the APPROVED case.
    const result = await cancelLeaveRequest(ctx.params.id, session.user.id);
    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}
