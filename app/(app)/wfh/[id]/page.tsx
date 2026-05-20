import * as React from "react";
import { notFound } from "next/navigation";
import { and, eq, gte, lte } from "drizzle-orm";

import { PageShell } from "@/components/page-shell";
import { db } from "@/lib/db";
import { holidays, users, wfhRequests } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import { getRequestTimeline } from "@/lib/audit/timeline";
import { WfhDetailView } from "./wfh-detail-view";

export const metadata = {
  title: "WFH request",
};

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

export default async function WfhDetailPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const session = await requireSession();
  const id = params.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    notFound();
  }

  const rows = await db
    .select({
      id: wfhRequests.id,
      employeeId: wfhRequests.employeeId,
      startDate: wfhRequests.startDate,
      endDate: wfhRequests.endDate,
      totalDays: wfhRequests.totalDays,
      isHalfDay: wfhRequests.isHalfDay,
      halfDaySlot: wfhRequests.halfDaySlot,
      reason: wfhRequests.reason,
      status: wfhRequests.status,
      reviewedById: wfhRequests.reviewedById,
      reviewedAt: wfhRequests.reviewedAt,
      reviewerNote: wfhRequests.reviewerNote,
      createdAt: wfhRequests.createdAt,
      employeeFirstName: users.firstName,
      employeeLastName: users.lastName,
      employeeManagerId: users.managerId,
    })
    .from(wfhRequests)
    .innerJoin(users, eq(users.id, wfhRequests.employeeId))
    .where(eq(wfhRequests.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) notFound();

  const isOwn = row.employeeId === session.user.id;
  const isAdmin = isAdminRole(session.user.role);
  const isManagerOf = row.employeeManagerId === session.user.id;
  if (!isOwn && !isAdmin && !isManagerOf) notFound();

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

  // Full audit-log timeline for this request.
  const timeline = await getRequestTimeline("wfh_requests", row.id);

  // Holidays for the edit dialog's working-days calc — fetched only when the
  // viewer can edit (isOwn && PENDING) so we don't pay for them on approver
  // or read-only views.
  let editHolidayDatesYmd: string[] | undefined;
  if (isOwn && row.status === "PENDING") {
    const year = new Date().getFullYear();
    const holidayRows = await db
      .select({ date: holidays.date })
      .from(holidays)
      .where(
        and(
          gte(holidays.date, `${year}-01-01`),
          lte(holidays.date, `${year}-12-31`),
        ),
      );
    // holidays.date is already YYYY-MM-DD (Drizzle mode: "string").
    editHolidayDatesYmd = holidayRows.map((h) => h.date);
  }

  return (
    <PageShell
      title="Work from home"
      description={`Submitted by ${row.employeeFirstName} ${row.employeeLastName}`}
      breadcrumbs={
        <a
          href="/wfh"
          className="text-muted-foreground hover:text-foreground"
        >
          ← Back to WFH
        </a>
      }
    >
      <WfhDetailView
        id={row.id}
        isOwn={isOwn}
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
        {...(editHolidayDatesYmd !== undefined && { editHolidayDatesYmd })}
      />
    </PageShell>
  );
}
