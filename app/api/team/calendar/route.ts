/**
 * /api/team/calendar
 *  GET → list APPROVED + PENDING_CANCELLATION leave & WFH rows whose date
 *        range overlaps the [from, to] window. Drives the `/team` calendar tab.
 *
 * Scope (mirrors the `/team` page):
 *   - admin (HR_ADMIN / SUPER_ADMIN) → all active employees
 *   - non-admin manager              → their direct reports only
 *   - anyone else                    → 403 (UI gates the page; this is defence-in-depth)
 *
 * PENDING is intentionally excluded — the calendar is about confirmed
 * coverage. PENDING_CANCELLATION rows are included because the leave/WFH
 * is still in effect until the cancel is approved.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  leaveRequests,
  leaveTypes,
  users,
  wfhRequests,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import { apiError, handleRouteError } from "@/lib/api/errors";
import { isAdminRole, parseSearchParams } from "@/lib/api/route-helpers";
import { teamCalendarQuerySchema } from "@/lib/validation/common";
import { compareYmd, ymdToLocalDate } from "@/lib/utils/dates";

const VISIBLE_STATUSES = ["APPROVED", "PENDING_CANCELLATION"] as const;

// Soft ceiling on the window the client can request. The month view needs
// ≤ 42 days (6 rows × 7), so 100 leaves comfortable headroom for the week
// view to also fetch a small surrounding buffer if that's ever wanted.
const MAX_WINDOW_DAYS = 100;

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await requireSession();
    const q = parseSearchParams(req.url, teamCalendarQuerySchema);

    if (compareYmd(q.from, q.to) > 0) {
      return apiError(400, "BAD_RANGE", "`to` must be on or after `from`");
    }
    // Cap the window so a misbehaving client can't drag a 10-year fetch.
    // ymdToLocalDate gives local-midnight instants; diff/86_400_000 rounds
    // away any DST drift to a clean calendar-day count.
    const days =
      Math.round(
        (ymdToLocalDate(q.to).getTime() - ymdToLocalDate(q.from).getTime()) /
          86_400_000,
      ) + 1;
    if (days > MAX_WINDOW_DAYS) {
      return apiError(
        400,
        "WINDOW_TOO_LARGE",
        `Calendar window may not exceed ${MAX_WINDOW_DAYS} days`,
      );
    }

    const isAdmin = isAdminRole(session.user.role);

    // Resolve the set of employee ids the caller may see. For admins this is
    // every active user; for managers it's their direct reports. Anyone else
    // is rejected — the /team page is the only entry point and it already
    // gates at the UI, but the API has to defend itself.
    let employeeIds: string[];
    if (isAdmin) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.isActive, true));
      employeeIds = rows.map((r) => r.id);
    } else if (session.user.isManager) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(eq(users.managerId, session.user.id), eq(users.isActive, true)),
        );
      employeeIds = rows.map((r) => r.id);
    } else {
      return apiError(403, "FORBIDDEN", "Calendar is for managers + admins");
    }

    if (employeeIds.length === 0) {
      return NextResponse.json({ items: [] });
    }

    // Overlap predicate: a row's [startDate, endDate] overlaps the window
    // [from, to] iff startDate <= to AND endDate >= from. Status filter is
    // an IN list so the query plan stays a single index probe per table.
    const leaveRows = await db
      .select({
        id: leaveRequests.id,
        employeeId: leaveRequests.employeeId,
        employeeFirstName: users.firstName,
        employeeLastName: users.lastName,
        leaveTypeId: leaveRequests.leaveTypeId,
        leaveTypeName: leaveTypes.name,
        leaveTypeColor: leaveTypes.color,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        isHalfDay: leaveRequests.isHalfDay,
        halfDaySlot: leaveRequests.halfDaySlot,
        status: leaveRequests.status,
      })
      .from(leaveRequests)
      .innerJoin(users, eq(users.id, leaveRequests.employeeId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(
        and(
          inArray(leaveRequests.employeeId, employeeIds),
          inArray(leaveRequests.status, [...VISIBLE_STATUSES]),
          lte(leaveRequests.startDate, q.to),
          gte(leaveRequests.endDate, q.from),
        ),
      );

    const wfhRows = await db
      .select({
        id: wfhRequests.id,
        employeeId: wfhRequests.employeeId,
        employeeFirstName: users.firstName,
        employeeLastName: users.lastName,
        startDate: wfhRequests.startDate,
        endDate: wfhRequests.endDate,
        isHalfDay: wfhRequests.isHalfDay,
        halfDaySlot: wfhRequests.halfDaySlot,
        status: wfhRequests.status,
      })
      .from(wfhRequests)
      .innerJoin(users, eq(users.id, wfhRequests.employeeId))
      .where(
        and(
          inArray(wfhRequests.employeeId, employeeIds),
          inArray(wfhRequests.status, [...VISIBLE_STATUSES]),
          lte(wfhRequests.startDate, q.to),
          gte(wfhRequests.endDate, q.from),
        ),
      );

    const items = [
      ...leaveRows.map((r) => ({
        kind: "leave" as const,
        id: r.id,
        employeeId: r.employeeId,
        employeeName: `${r.employeeFirstName} ${r.employeeLastName}`,
        leaveTypeId: r.leaveTypeId,
        leaveTypeName: r.leaveTypeName,
        leaveTypeColor: r.leaveTypeColor,
        startDate: r.startDate,
        endDate: r.endDate,
        isHalfDay: r.isHalfDay,
        halfDaySlot: r.halfDaySlot,
        status: r.status,
      })),
      ...wfhRows.map((r) => ({
        kind: "wfh" as const,
        id: r.id,
        employeeId: r.employeeId,
        employeeName: `${r.employeeFirstName} ${r.employeeLastName}`,
        leaveTypeId: null,
        leaveTypeName: null,
        leaveTypeColor: null,
        startDate: r.startDate,
        endDate: r.endDate,
        isHalfDay: r.isHalfDay,
        halfDaySlot: r.halfDaySlot,
        status: r.status,
      })),
    ];
    return NextResponse.json({ items });
  } catch (err) {
    return handleRouteError(err);
  }
}