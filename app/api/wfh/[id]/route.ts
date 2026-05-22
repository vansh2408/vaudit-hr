/**
 * /api/wfh/[id]
 *  GET    → own, manager-of, or admin
 *  PATCH  → action: APPROVE | REJECT by manager-of OR admin (never self)
 *           action: EDIT             owner-only, PENDING-only
 *  DELETE → cancel by owner OR admin
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { holidays, users, wfhRequests } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import {
  wfhRequestEditSchema,
  wfhRequestReviewSchema,
} from "@/lib/validation/common";
import { apiError, BadStateError, handleRouteError } from "@/lib/api/errors";
import { isAdminRole } from "@/lib/api/route-helpers";
import { calcWorkingHalfDays } from "@/lib/leave/working-days";
import { findOverlap } from "@/lib/leave/overlap";
import { formatDays } from "@/lib/utils/format-days";
import { unsafeYmd } from "@/lib/utils/dates";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyEmployee } from "@/lib/notify";
import { getApproverRecipients } from "@/lib/notify/recipients";
import { assertSameOrigin } from "@/lib/security/csrf";
import { sanitizeFreeText } from "@/lib/security/sanitize";
import {
  adminForceCancelWfh,
  approveWfhCancellation,
  cancelWfhRequest,
  rejectWfhCancellation,
  withdrawWfhCancellation,
} from "@/lib/wfh/cancel";

interface Ctx {
  params: { id: string };
}

async function loadWithEmployee(id: string) {
  const rows = await db
    .select({
      req: wfhRequests,
      empManagerId: users.managerId,
      empFirstName: users.firstName,
      empSlackUserId: users.slackUserId,
    })
    .from(wfhRequests)
    .innerJoin(users, eq(users.id, wfhRequests.employeeId))
    .where(eq(wfhRequests.id, id))
    .limit(1);
  return rows[0];
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    const session = await requireSession();
    const row = await loadWithEmployee(ctx.params.id);
    if (!row) return apiError(404, "NOT_FOUND", "WFH request not found");
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
      return handleWfhEdit(raw, ctx.params.id, session.user.id);
    }
    const body = wfhRequestReviewSchema.parse(raw);
    const safeNote =
      typeof body.reviewerNote === "string" && body.reviewerNote.length > 0
        ? sanitizeFreeText(body.reviewerNote)
        : undefined;
    const row = await loadWithEmployee(ctx.params.id);
    if (!row) return apiError(404, "NOT_FOUND", "WFH request not found");

    if (
      body.action === "APPROVE_CANCEL" ||
      body.action === "REJECT_CANCEL" ||
      body.action === "WITHDRAW_CANCEL"
    ) {
      return handleWfhCancellationDecision(
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
    const newStatus = body.action === "APPROVE" ? "APPROVED" : "REJECTED";
    // Lock + status-recheck inside the tx — mirrors /api/leave/[id]. WFH
    // doesn't consume balance, so the bite is "double-notify + double
    // audit-entry" rather than a balance bug, but the discipline keeps
    // both routes consistent.
    const totalHalfDays = await db.transaction(async (tx) => {
      const locked = await tx
        .select({
          status: wfhRequests.status,
          totalDays: wfhRequests.totalDays,
        })
        .from(wfhRequests)
        .where(eq(wfhRequests.id, ctx.params.id))
        .for("update")
        .limit(1);
      const cur = locked[0];
      if (!cur) throw new BadStateError("WFH request not found", "NOT_FOUND");
      if (cur.status !== "PENDING") {
        throw new BadStateError(`Cannot review ${cur.status} request`);
      }
      await tx
        .update(wfhRequests)
        .set({
          status: newStatus,
          reviewedById: session.user.id,
          reviewedAt: new Date(),
          ...(safeNote !== undefined && { reviewerNote: safeNote }),
        })
        .where(eq(wfhRequests.id, ctx.params.id));
      return cur.totalDays;
    });
    await writeAuditLog({
      actorId: session.user.id,
      action: newStatus === "APPROVED" ? "wfh.approve" : "wfh.reject",
      targetTable: "wfh_requests",
      targetId: ctx.params.id,
      metadata: { employeeId: row.req.employeeId, totalHalfDays },
    });
    await notifyEmployee({
      employeeId: row.req.employeeId,
      slackUserId: row.empSlackUserId ?? null,
      type: newStatus === "APPROVED" ? "wfh.approved" : "wfh.rejected",
      message: `Your WFH request (${formatDays(totalHalfDays)}) was ${newStatus.toLowerCase()}.`,
      link: `/wfh/${ctx.params.id}`,
      ...(safeNote !== undefined && { userContent: safeNote }),
    });
    return NextResponse.json({ id: ctx.params.id, status: newStatus });
  } catch (err) {
    return handleRouteError(err);
  }
}

async function handleWfhEdit(
  raw: unknown,
  id: string,
  actorId: string,
): Promise<NextResponse> {
  const body = wfhRequestEditSchema.parse(raw);
  const row = await loadWithEmployee(id);
  if (!row) return apiError(404, "NOT_FOUND", "WFH request not found");
  if (row.req.employeeId !== actorId) {
    return apiError(403, "FORBIDDEN", "Only the requester can edit this request");
  }
  if (row.req.status !== "PENDING") {
    return apiError(409, "BAD_STATE", `Cannot edit ${row.req.status} request`);
  }
  const safeReason =
    typeof body.reason === "string" && body.reason.length > 0
      ? sanitizeFreeText(body.reason)
      : null;
  const holidayRows = await db.select({ date: holidays.date }).from(holidays);
  const newTotalHalfDays = calcWorkingHalfDays(
    body.startDate,
    body.endDate,
    holidayRows.map((h) => unsafeYmd(h.date)),
    body.isHalfDay,
    body.halfDaySlot ?? null,
  );
  if (newTotalHalfDays <= 0) {
    return apiError(
      400,
      "NO_WORKING_DAYS",
      "Selected range has no working days (weekends/holidays only).",
    );
  }
  // Overlap-check + update in the same tx — see app/api/leave/[id]/route.ts
  // for the rationale; same pattern keeps both edit paths consistent.
  const editResult = await db.transaction<
    { kind: "ok" } | { kind: "overlap"; with: "leave" | "wfh" }
  >(async (tx) => {
    const overlap = await findOverlap(
      {
        employeeId: actorId,
        startDate: body.startDate,
        endDate: body.endDate,
        isHalfDay: body.isHalfDay,
        halfDaySlot: body.halfDaySlot ?? null,
        excludeRequestId: id,
        excludeKind: "wfh",
      },
      tx,
    );
    if (overlap) return { kind: "overlap", with: overlap.kind };
    await tx
      .update(wfhRequests)
      .set({
        startDate: body.startDate,
        endDate: body.endDate,
        totalDays: newTotalHalfDays,
        reason: safeReason,
        isHalfDay: body.isHalfDay,
        halfDaySlot: body.halfDaySlot ?? null,
      })
      .where(eq(wfhRequests.id, id));
    return { kind: "ok" };
  });
  if (editResult.kind === "overlap") {
    return apiError(
      409,
      "OVERLAPPING_REQUEST",
      `You already have a ${editResult.with === "leave" ? "leave" : "WFH"} request covering that ${body.isHalfDay ? "slot" : "date range"}`,
    );
  }
  await writeAuditLog({
    actorId,
    action: "wfh.edit",
    targetTable: "wfh_requests",
    targetId: id,
    metadata: {
      before: {
        startDate: row.req.startDate,
        endDate: row.req.endDate,
        totalHalfDays: row.req.totalDays,
        reason: row.req.reason,
        isHalfDay: row.req.isHalfDay,
        halfDaySlot: row.req.halfDaySlot,
      },
      after: {
        startDate: body.startDate,
        endDate: body.endDate,
        totalHalfDays: newTotalHalfDays,
        reason: safeReason,
        isHalfDay: body.isHalfDay,
        halfDaySlot: body.halfDaySlot ?? null,
      },
    },
  });
  const editRecipients = await getApproverRecipients(actorId, row.empManagerId);
  const editedMessage = `${row.empFirstName ?? "An employee"} edited their WFH request — please re-review (${formatDays(newTotalHalfDays)}).`;
  for (const r of editRecipients) {
    await notifyEmployee({
      employeeId: r.id,
      slackUserId: r.slackUserId,
      type: "wfh.edited",
      message: editedMessage,
      link: `/approvals`,
      ...(safeReason !== null && { userContent: safeReason }),
    });
  }
  return NextResponse.json({ id, totalDays: newTotalHalfDays, status: "PENDING" });
}

/**
 * DELETE = "I want this cancelled." Behavior mirrors /api/leave/[id]:
 *   - Default: delegate to cancelWfhRequest (PENDING → instant,
 *     APPROVED → cancellation request with past-lock).
 *   - `?override=1`: admin-only force cancel with reason in body.
 * See lib/wfh/cancel.ts for the state machine.
 */
export async function DELETE(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;
    const session = await requireSession();
    const row = await loadWithEmployee(ctx.params.id);
    if (!row) return apiError(404, "NOT_FOUND", "WFH request not found");
    const isOwn = row.req.employeeId === session.user.id;
    const isAdmin = isAdminRole(session.user.role);
    if (!isOwn && !isAdmin) return apiError(403, "FORBIDDEN", "Only owner or admin may cancel");

    const url = new URL(req.url);
    const isOverride = url.searchParams.get("override") === "1";
    if (isOverride) {
      if (!isAdmin) {
        return apiError(403, "FORBIDDEN", "Only admins may force-cancel");
      }
      const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (reason.length === 0) {
        return apiError(400, "REASON_REQUIRED", "Admin override requires a reason");
      }
      const safeReason = sanitizeFreeText(reason);
      const result = await adminForceCancelWfh(
        ctx.params.id,
        session.user.id,
        safeReason,
      );
      return NextResponse.json(result);
    }

    const result = await cancelWfhRequest(ctx.params.id, session.user.id);
    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err);
  }
}

async function handleWfhCancellationDecision(
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
    const result = await withdrawWfhCancellation(requestId, actorId);
    return NextResponse.json(result);
  }
  if (actorId === employeeId) {
    return apiError(403, "FORBIDDEN", "Cannot review your own cancellation request");
  }
  if (!isAdmin && empManagerId !== actorId) {
    return apiError(403, "FORBIDDEN", "Only manager or admin may decide a cancellation");
  }
  if (action === "APPROVE_CANCEL") {
    const result = await approveWfhCancellation(requestId, actorId, safeNote);
    return NextResponse.json(result);
  }
  if (safeNote === undefined) {
    return apiError(400, "NOTE_REQUIRED", "A note is required when rejecting a cancellation");
  }
  const result = await rejectWfhCancellation(requestId, actorId, safeNote);
  return NextResponse.json(result);
}
