/**
 * /api/wfh
 *  GET  → list own (or any for admin)
 *  POST → create PENDING WFH request (no balance check; date in future-or-today)
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, wfhRequests } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import {
  leaveListQuerySchema,
  wfhRequestCreateSchema,
} from "@/lib/validation/common";
import { apiError, handleRouteError } from "@/lib/api/errors";
import { isAdminRole, parseSearchParams } from "@/lib/api/route-helpers";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyEmployee } from "@/lib/notify";
import { getApproverRecipients } from "@/lib/notify/recipients";
import { assertSameOrigin } from "@/lib/security/csrf";
import { sanitizeFreeText } from "@/lib/security/sanitize";
import { calcWorkingHalfDays } from "@/lib/leave/working-days";
import { findOverlap } from "@/lib/leave/overlap";
import { formatDays } from "@/lib/utils/format-days";
import { unsafeYmd } from "@/lib/utils/dates";
import { holidays } from "@/lib/db/schema";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession();
    const q = parseSearchParams(req.url, leaveListQuerySchema);
    const isAdmin = isAdminRole(session.user.role);
    // Same scope rule as /api/leave — see that route for the rationale.
    // Admin OR self OR (caller is the target's direct manager).
    let targetEmployeeId = session.user.id;
    if (q.employeeId) {
      if (isAdmin || q.employeeId === session.user.id) {
        targetEmployeeId = q.employeeId;
      } else {
        const mgr = await db
          .select({ managerId: users.managerId })
          .from(users)
          .where(eq(users.id, q.employeeId))
          .limit(1);
        if (mgr[0]?.managerId === session.user.id) {
          targetEmployeeId = q.employeeId;
        }
      }
    }
    const conds = [eq(wfhRequests.employeeId, targetEmployeeId)];
    if (q.status) conds.push(eq(wfhRequests.status, q.status));
    const where = and(...conds);
    const offset = (q.page - 1) * q.pageSize;
    const rows = await db
      .select()
      .from(wfhRequests)
      .where(where)
      .orderBy(desc(wfhRequests.createdAt))
      .limit(q.pageSize)
      .offset(offset);
    return NextResponse.json({ items: rows, page: q.page, pageSize: q.pageSize });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const csrf = assertSameOrigin(req);
    if (csrf) return csrf;
    const session = await requireSession();
    const body = wfhRequestCreateSchema.parse(await req.json());
    const safeReason =
      typeof body.reason === "string" && body.reason.length > 0
        ? sanitizeFreeText(body.reason)
        : undefined;
    // Working-day count excludes weekends + company holidays, matching the
    // leave-request logic. A range with zero working days (e.g. a weekend
    // only) is rejected — there's nothing to WFH on.
    const holidayRows = await db
      .select({ date: holidays.date })
      .from(holidays);
    const totalHalfDays = calcWorkingHalfDays(
      body.startDate,
      body.endDate,
      holidayRows.map((h) => unsafeYmd(h.date)),
      body.isHalfDay,
      body.halfDaySlot ?? null,
    );
    if (totalHalfDays <= 0) {
      return apiError(
        400,
        "NO_WORKING_DAYS",
        "Selected range has no working days (weekends/holidays only).",
      );
    }
    // Overlap: same-slot leave or WFH on any covered date is rejected.
    // Runs inside the insert tx so two simultaneous POSTs can't both pass
    // a stale pre-check — see app/api/leave/route.ts for the rationale.
    const insertOrError = await db.transaction<
      | { kind: "ok"; id: string }
      | { kind: "overlap"; with: "leave" | "wfh" }
    >(async (tx) => {
      const overlap = await findOverlap(
        {
          employeeId: session.user.id,
          startDate: body.startDate,
          endDate: body.endDate,
          isHalfDay: body.isHalfDay,
          halfDaySlot: body.halfDaySlot ?? null,
        },
        tx,
      );
      if (overlap) return { kind: "overlap", with: overlap.kind };
      const inserted = await tx
        .insert(wfhRequests)
        .values({
          employeeId: session.user.id,
          startDate: body.startDate,
          endDate: body.endDate,
          totalDays: totalHalfDays,
          ...(safeReason !== undefined && { reason: safeReason }),
          status: "PENDING",
          isHalfDay: body.isHalfDay,
          halfDaySlot: body.halfDaySlot ?? null,
        })
        .returning({ id: wfhRequests.id });
      const inner = inserted[0];
      if (!inner) throw new Error("INSERT_FAILED");
      return { kind: "ok", id: inner.id };
    });
    if (insertOrError.kind === "overlap") {
      return apiError(
        409,
        "OVERLAPPING_REQUEST",
        `You already have a ${insertOrError.with === "leave" ? "leave" : "WFH"} request covering that ${body.isHalfDay ? "slot" : "date range"}`,
      );
    }
    const row = { id: insertOrError.id };
    await writeAuditLog({
      actorId: session.user.id,
      action: "wfh.create",
      targetTable: "wfh_requests",
      targetId: row.id,
      metadata: {
        startDate: body.startDate,
        endDate: body.endDate,
        totalHalfDays,
        isHalfDay: body.isHalfDay,
        halfDaySlot: body.halfDaySlot ?? null,
      },
    });
    const me = await db
      .select({ firstName: users.firstName, managerId: users.managerId })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    const managerId = me[0]?.managerId ?? null;
    const recipients = await getApproverRecipients(session.user.id, managerId);
    const submittedMessage = `${me[0]?.firstName ?? "An employee"} submitted a WFH request (${formatDays(totalHalfDays)}).`;
    for (const r of recipients) {
      await notifyEmployee({
        employeeId: r.id,
        slackUserId: r.slackUserId,
        type: "wfh.submitted",
        message: submittedMessage,
        link: `/approvals`,
        ...(safeReason !== undefined && { userContent: safeReason }),
      });
    }
    return NextResponse.json(
      { id: row.id, status: "PENDING", totalDays: totalHalfDays },
      { status: 201 },
    );
  } catch (err) {
    return handleRouteError(err);
  }
}
