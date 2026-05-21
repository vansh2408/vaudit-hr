/**
 * /api/leave
 *  GET  → list own leave (or any employee's if admin); supports ?status & paging
 *  POST → create a new leave request (PENDING), validates balance + working days
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  holidays,
  leaveRequests,
  leaveTypes,
  users,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import {
  leaveListQuerySchema,
  leaveRequestCreateSchema,
} from "@/lib/validation/common";
import { apiError, handleRouteError } from "@/lib/api/errors";
import { isAdminRole, parseSearchParams } from "@/lib/api/route-helpers";
import { calcWorkingHalfDays } from "@/lib/leave/working-days";
import { ymdYear, unsafeYmd } from "@/lib/utils/dates";
import { checkBalance, consumeBalance } from "@/lib/leave/balance";
import { findOverlap } from "@/lib/leave/overlap";
import { isHalfDayAllowedForLeaveType } from "@/lib/leave/policies";
import { formatDays } from "@/lib/utils/format-days";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyEmployee } from "@/lib/notify";
import { getApproverRecipients } from "@/lib/notify/recipients";
import { assertSameOrigin } from "@/lib/security/csrf";
import { sanitizeFreeText } from "@/lib/security/sanitize";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession();
    const q = parseSearchParams(req.url, leaveListQuerySchema);
    const isAdmin = isAdminRole(session.user.role);
    // /api/leave is the personal "my time-off" feed. Default scope = the
    // caller's own rows so admins on /leave don't accidentally see every
    // employee's requests. Admins can query any employee by passing
    // ?employeeId=<id>; non-admin managers can query *their own direct
    // reports* (so /team/[id] history works); employees can only pass
    // their own id. Unauthorized ids silently coerce to self — same
    // behaviour as before.
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
    const conds = [eq(leaveRequests.employeeId, targetEmployeeId)];
    if (q.status) conds.push(eq(leaveRequests.status, q.status));
    const where = and(...conds);
    const offset = (q.page - 1) * q.pageSize;
    const rows = await db
      .select()
      .from(leaveRequests)
      .where(where)
      .orderBy(desc(leaveRequests.createdAt))
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
    const body = leaveRequestCreateSchema.parse(await req.json());
    const safeReason =
      typeof body.reason === "string" && body.reason.length > 0
        ? sanitizeFreeText(body.reason)
        : undefined;
    const year = ymdYear(body.startDate);
    if (ymdYear(body.endDate) !== year) {
      return apiError(400, "BAD_DATE_RANGE", "Leave range must lie in a single calendar year");
    }
    // Half-day eligibility for the chosen leave type (e.g. Maternity /
    // Paternity reject half-day by policy). Lookup also confirms the type
    // exists; checkBalance does its own row-existence check, but we want
    // a friendlier error here.
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
    const holidayRows = await db
      .select({ date: holidays.date })
      .from(holidays)
      .where(and(gte(holidays.date, body.startDate), lte(holidays.date, body.endDate)));
    const totalHalfDays = calcWorkingHalfDays(
      body.startDate,
      body.endDate,
      holidayRows.map((h) => unsafeYmd(h.date)),
      body.isHalfDay,
      body.halfDaySlot ?? null,
    );
    if (totalHalfDays <= 0) {
      return apiError(400, "ZERO_WORKING_DAYS", "Range contains no working days");
    }
    const bal = await checkBalance(session.user.id, body.leaveTypeId, totalHalfDays, year);
    if (!bal.ok) {
      return apiError(400, "INSUFFICIENT_BALANCE", bal.reason ?? "Insufficient balance");
    }
    // Overlap check: any existing PENDING/APPROVED/PENDING_CANCELLATION
    // leave OR WFH row on the same date+slot is a conflict. See
    // lib/leave/overlap.ts for the full ruleset (half × full = conflict;
    // same slot = conflict; different slots = OK).
    const overlap = await findOverlap({
      employeeId: session.user.id,
      startDate: body.startDate,
      endDate: body.endDate,
      isHalfDay: body.isHalfDay,
      halfDaySlot: body.halfDaySlot ?? null,
    });
    if (overlap) {
      return apiError(
        409,
        "OVERLAPPING_REQUEST",
        `You already have a ${overlap.kind === "leave" ? "leave" : "WFH"} request covering that ${body.isHalfDay ? "slot" : "date range"}`,
      );
    }
    const insertResult = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(leaveRequests)
        .values({
          employeeId: session.user.id,
          leaveTypeId: body.leaveTypeId,
          startDate: body.startDate,
          endDate: body.endDate,
          totalDays: totalHalfDays,
          ...(safeReason !== undefined && { reason: safeReason }),
          status: "PENDING",
          isHalfDay: body.isHalfDay,
          halfDaySlot: body.halfDaySlot ?? null,
        })
        .returning({ id: leaveRequests.id });
      return inserted[0];
    });
    if (!insertResult) return apiError(500, "INSERT_FAILED", "Insert returned no row");
    await writeAuditLog({
      actorId: session.user.id,
      action: "leave.create",
      targetTable: "leave_requests",
      targetId: insertResult.id,
      metadata: {
        leaveTypeId: body.leaveTypeId,
        totalHalfDays,
        year,
        isHalfDay: body.isHalfDay,
        halfDaySlot: body.halfDaySlot ?? null,
      },
    });
    const me = await db.select({ firstName: users.firstName, managerId: users.managerId }).from(users).where(eq(users.id, session.user.id)).limit(1);
    const managerId = me[0]?.managerId ?? null;
    const recipients = await getApproverRecipients(session.user.id, managerId);
    const submittedMessage = `${me[0]?.firstName ?? "An employee"} submitted a ${ltName} request (${formatDays(totalHalfDays)}).`;
    for (const r of recipients) {
      await notifyEmployee({
        employeeId: r.id,
        slackUserId: r.slackUserId,
        type: "leave.submitted",
        message: submittedMessage,
        link: `/approvals`,
        ...(safeReason !== undefined && { userContent: safeReason }),
      });
    }
    return NextResponse.json({ id: insertResult.id, totalDays: totalHalfDays, status: "PENDING" }, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}

void consumeBalance; // not consumed on PENDING (consumed on APPROVE in [id] route)
