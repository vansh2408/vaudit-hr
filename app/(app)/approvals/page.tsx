import * as React from "react";
import { desc, eq, inArray } from "drizzle-orm";
import { ClipboardCheck } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { PageShell } from "@/components/layout/page-shell";
import { TableSkeleton } from "@/components/feedback/skeletons";
import { db } from "@/lib/db";
import {
  leaveRequests,
  leaveTypes,
  users,
  wfhRequests,
} from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import {
  ApprovalsClient,
  type PendingLeaveRow,
  type PendingWfhRow,
} from "./approvals-client";

export const metadata = {
  title: "Approvals",
};

export const dynamic = "force-dynamic";

export default async function ApprovalsPage(): Promise<React.JSX.Element> {
  // Use requireSession (not requireManagerOrAdmin) so a regular employee
  // who lands here — via a typed URL, an old bookmark, or a notification
  // link gone wrong — sees a friendly empty state instead of the global
  // "Something went wrong" boundary. The page's data is still scoped to
  // the viewer's eligibility (manager OR admin); a plain employee just
  // sees the empty page.
  const session = await requireSession();
  const reviewerId = session.user.id;
  const admin = isAdminRole(session.user.role);
  const canReview = admin || session.user.isManager;

  if (!canReview) {
    return (
      <PageShell
        title="Approvals"
        description="This page shows pending leave and WFH requests waiting for your review."
      >
        <EmptyState
          icon={<ClipboardCheck />}
          title="No approvals to review"
          description="You'll see requests here when team members reporting to you submit leave or WFH. HR admins also see every pending request."
        />
      </PageShell>
    );
  }

  // Admins see every pending request; managers see direct-report's only.
  // PENDING_CANCELLATION lives in the same queue but is rendered with the
  // "cancellation request" CTAs — the client distinguishes via row.status.
  const leaveBase = db
    .select({
      id: leaveRequests.id,
      employeeId: leaveRequests.employeeId,
      employeeFirstName: users.firstName,
      employeeLastName: users.lastName,
      managerId: users.managerId,
      leaveTypeId: leaveRequests.leaveTypeId,
      leaveTypeName: leaveTypes.name,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      createdAt: leaveRequests.createdAt,
    })
    .from(leaveRequests)
    .innerJoin(users, eq(users.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      inArray(leaveRequests.status, ["PENDING", "PENDING_CANCELLATION"]),
    )
    // Order by `updatedAt DESC` so:
    //   - fresh submissions sort to the top (updatedAt == createdAt at insert)
    //   - edited PENDING requests bubble back up for re-review
    //   - PENDING_CANCELLATION transitions surface as urgent
    // Stale untouched rows sink — fine, they have no new info to act on.
    .orderBy(desc(leaveRequests.updatedAt));

  const wfhBase = db
    .select({
      id: wfhRequests.id,
      employeeId: wfhRequests.employeeId,
      employeeFirstName: users.firstName,
      employeeLastName: users.lastName,
      managerId: users.managerId,
      startDate: wfhRequests.startDate,
      endDate: wfhRequests.endDate,
      totalDays: wfhRequests.totalDays,
      reason: wfhRequests.reason,
      status: wfhRequests.status,
      createdAt: wfhRequests.createdAt,
    })
    .from(wfhRequests)
    .innerJoin(users, eq(users.id, wfhRequests.employeeId))
    .where(
      inArray(wfhRequests.status, ["PENDING", "PENDING_CANCELLATION"]),
    )
    .orderBy(desc(wfhRequests.updatedAt));

  const [allLeave, allWfh] = await Promise.all([leaveBase, wfhBase]);

  // Reviewers never see their own requests in the queue — self-review is
  // blocked at the API. Filter here so the buttons don't appear either.
  const leaveRows: PendingLeaveRow[] = (
    admin
      ? allLeave.filter((r) => r.employeeId !== reviewerId)
      : allLeave.filter(
          (r) => r.managerId === reviewerId && r.employeeId !== reviewerId,
        )
  ).map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: `${r.employeeFirstName} ${r.employeeLastName}`,
    leaveTypeId: r.leaveTypeId,
    leaveTypeName: r.leaveTypeName,
    // startDate/endDate are calendar dates (Drizzle mode: "string") — pass
    // YYYY-MM-DD straight through, no Date conversion.
    startDate: r.startDate,
    endDate: r.endDate,
    totalDays: r.totalDays,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));

  const wfhRows: PendingWfhRow[] = (
    admin
      ? allWfh.filter((r) => r.employeeId !== reviewerId)
      : allWfh.filter(
          (r) => r.managerId === reviewerId && r.employeeId !== reviewerId,
        )
  ).map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeName: `${r.employeeFirstName} ${r.employeeLastName}`,
    // Calendar dates pass through; createdAt is an instant.
    startDate: r.startDate,
    endDate: r.endDate,
    totalDays: r.totalDays,
    reason: r.reason,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <PageShell
      title="Approvals"
      description="Review and respond to your team's pending requests."
    >
      <React.Suspense fallback={<TableSkeleton rows={6} cols={6} />}>
        <ApprovalsClient initialLeave={leaveRows} initialWfh={wfhRows} />
      </React.Suspense>
    </PageShell>
  );
}
