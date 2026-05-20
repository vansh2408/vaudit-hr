import * as React from "react";
import { notFound } from "next/navigation";
import { and, asc, eq, gte, lte } from "drizzle-orm";

import { PageShell } from "@/components/page-shell";
import { db } from "@/lib/db";
import {
  holidays,
  leaveBalances,
  leaveRequests,
  leaveTypes,
  users,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import { getRequestTimeline } from "@/lib/audit/timeline";
import type {
  LeaveTypeLite,
  MyBalanceLite,
} from "../leave-list-client";
import { LeaveDetailView } from "./leave-detail-view";

export const metadata = {
  title: "Leave request",
};

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

export default async function LeaveDetailPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const session = await requireSession();

  // UUID lookup — if not a valid uuid, treat as not-found rather than DB error.
  const id = params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const rows = await db
    .select({
      id: leaveRequests.id,
      employeeId: leaveRequests.employeeId,
      leaveTypeId: leaveRequests.leaveTypeId,
      leaveTypeName: leaveTypes.name,
      isPaid: leaveTypes.isPaid,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
      isHalfDay: leaveRequests.isHalfDay,
      halfDaySlot: leaveRequests.halfDaySlot,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      reviewedById: leaveRequests.reviewedById,
      reviewedAt: leaveRequests.reviewedAt,
      reviewerNote: leaveRequests.reviewerNote,
      createdAt: leaveRequests.createdAt,
      employeeFirstName: users.firstName,
      employeeLastName: users.lastName,
      employeeManagerId: users.managerId,
    })
    .from(leaveRequests)
    .innerJoin(users, eq(users.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(and(eq(leaveRequests.id, id)))
    .limit(1);

  const row = rows[0];
  if (!row) notFound();

  const isOwn = row.employeeId === session.user.id;
  const isAdmin = isAdminRole(session.user.role);
  const isManagerOf = row.employeeManagerId === session.user.id;
  if (!isOwn && !isAdmin && !isManagerOf) {
    notFound();
  }

  // Resolve reviewer name (if any) for display.
  let reviewerName: string | null = null;
  if (row.reviewedById) {
    const rev = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, row.reviewedById))
      .limit(1);
    const r = rev[0];
    reviewerName = r ? `${r.firstName} ${r.lastName}` : null;
  }

  // Manager name — shown so the employee knows who reviews their request.
  let managerName: string | null = null;
  if (row.employeeManagerId) {
    const mgr = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, row.employeeManagerId))
      .limit(1);
    const m = mgr[0];
    managerName = m ? `${m.firstName} ${m.lastName}` : null;
  }

  // Full audit-log timeline (create / edit / approve / reject / cancel /
  // auto-cancel). Read in parallel with the edit-context fetches below.
  const timeline = await getRequestTimeline("leave_requests", row.id);

  // Hydrate edit context (leave types, own balances, holidays) only when the
  // viewer can actually edit the request. Avoids unnecessary DB work for
  // approver-side viewing.
  const currentYear = new Date().getFullYear();
  let editContext:
    | {
        leaveTypes: LeaveTypeLite[];
        balancesByType: Record<string, MyBalanceLite>;
        currentYear: number;
        holidayDatesYmd: string[];
      }
    | undefined;
  if (isOwn && row.status === "PENDING") {
    const [types, balances, holidayRows] = await Promise.all([
      db
        .select({
          id: leaveTypes.id,
          name: leaveTypes.name,
          isPaid: leaveTypes.isPaid,
        })
        .from(leaveTypes)
        .where(eq(leaveTypes.isActive, true))
        .orderBy(asc(leaveTypes.name)),
      db
        .select({
          leaveTypeId: leaveBalances.leaveTypeId,
          allocated: leaveBalances.allocated,
          used: leaveBalances.used,
          year: leaveBalances.year,
        })
        .from(leaveBalances)
        .where(
          and(
            eq(leaveBalances.employeeId, session.user.id),
            eq(leaveBalances.year, currentYear),
          ),
        ),
      db
        .select({ date: holidays.date })
        .from(holidays)
        .where(
          and(
            gte(holidays.date, `${currentYear}-01-01`),
            lte(holidays.date, `${currentYear}-12-31`),
          ),
        ),
    ]);
    editContext = {
      leaveTypes: types.map((t) => ({
        id: t.id,
        name: t.name,
        isPaid: t.isPaid,
      })),
      balancesByType: Object.fromEntries(
        balances.map((b) => [
          b.leaveTypeId,
          { allocated: b.allocated, used: b.used, year: b.year },
        ]),
      ),
      currentYear,
      // holidays.date is already YYYY-MM-DD (Drizzle mode: "string").
      holidayDatesYmd: holidayRows.map((h) => h.date),
    };
  }

  return (
    <PageShell
      title="Leave request"
      description={`Submitted by ${row.employeeFirstName} ${row.employeeLastName}`}
      breadcrumbs={
        <a
          href="/leave"
          className="text-muted-foreground hover:text-foreground"
        >
          ← Back to leave
        </a>
      }
    >
      <LeaveDetailView
        id={row.id}
        isOwn={isOwn}
        leaveTypeId={row.leaveTypeId}
        leaveTypeName={row.leaveTypeName}
        startDate={row.startDate}
        endDate={row.endDate}
        totalDays={row.totalDays}
        isHalfDay={row.isHalfDay}
        halfDaySlot={row.halfDaySlot}
        reason={row.reason}
        status={row.status}
        managerName={managerName}
        reviewerName={reviewerName}
        reviewedAt={row.reviewedAt ? row.reviewedAt.toISOString() : null}
        reviewerNote={row.reviewerNote}
        createdAt={row.createdAt.toISOString()}
        timeline={timeline}
        {...(editContext !== undefined && { editContext })}
      />
    </PageShell>
  );
}
