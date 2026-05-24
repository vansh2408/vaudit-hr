import * as React from "react";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";

import { Avatar } from "@/components/domain/avatar";
import { EmployeeBalanceSummary } from "@/components/domain/employee-balance-summary";
import { PageShell } from "@/components/layout/page-shell";
import { RoleBadge } from "@/components/domain/role-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { leaveTypes, users } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import { loadEmployeeBalances } from "@/lib/leave/balances-query";
import { formatYmdHuman, unsafeYmd } from "@/lib/utils/dates";
import { EmployeeActivityView } from "./employee-activity-view";

export const metadata = {
  title: "Team member",
};

export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

function fmtStartDate(s: string | null): string {
  if (!s) return "—";
  return formatYmdHuman(unsafeYmd(s), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function TeamMemberPage({
  params,
}: PageProps): Promise<React.JSX.Element> {
  const session = await requireSession();

  // Reject malformed ids early so we don't hit the DB with a non-uuid.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      params.id,
    )
  ) {
    notFound();
  }

  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      position: users.position,
      department: users.department,
      startDate: users.startDate,
      role: users.role,
      managerId: users.managerId,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, params.id))
    .limit(1);
  const row = rows[0];
  if (!row) notFound();

  // Auth: admin sees anyone; non-admin only their own direct reports.
  // 404 on unauthorised access (don't leak existence). Non-admin
  // self-on-self is intentionally refused — employees have /leave + /wfh
  // for their own data, so /team/<own-id> isn't a real flow.
  const isAdmin = isAdminRole(session.user.role);
  const isMyReport = row.managerId === session.user.id;
  if (!isAdmin && !isMyReport) notFound();

  // Manager name lookup — purely for display in the profile card.
  let managerName: string | null = null;
  if (row.managerId) {
    const mgr = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, row.managerId))
      .limit(1);
    const m = mgr[0];
    managerName = m ? `${m.firstName} ${m.lastName}` : null;
  }

  // Seed for the balance summary + activity tabs. Mirror of the admin
  // employee page (`/admin/employees/[id]`) so managers see the same
  // glance-level info admins do. Parallel-fetched to avoid waterfall
  // latency.
  const currentYear = new Date().getFullYear();
  const [activeLeaveTypes, balances] = await Promise.all([
    db
      .select({
        id: leaveTypes.id,
        name: leaveTypes.name,
        isPaid: leaveTypes.isPaid,
      })
      .from(leaveTypes)
      .where(eq(leaveTypes.isActive, true))
      .orderBy(asc(leaveTypes.name)),
    loadEmployeeBalances(row.id, currentYear),
  ]);

  const fullName = `${row.firstName} ${row.lastName}`;

  return (
    <PageShell
      title={fullName}
      description={row.email}
      breadcrumbs={
        <a
          href="/team"
          className="text-muted-foreground hover:text-foreground"
        >
          ← Back to team
        </a>
      }
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-4">
              <Avatar name={fullName} size="lg" />
              <dl className="grid flex-1 gap-3 text-sm sm:grid-cols-2">
                <div className="space-y-1">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Position
                  </dt>
                  <dd>{row.position ?? "—"}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Department
                  </dt>
                  <dd>{row.department ?? "—"}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Role
                  </dt>
                  <dd>
                    <RoleBadge role={row.role} />
                  </dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Manager
                  </dt>
                  <dd>{managerName ?? "—"}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Start date
                  </dt>
                  <dd>{fmtStartDate(row.startDate)}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    Status
                  </dt>
                  <dd>{row.isActive ? "Active" : "Inactive"}</dd>
                </div>
              </dl>
            </div>
          </CardContent>
        </Card>

        <EmployeeBalanceSummary balances={balances} year={currentYear} />
        <EmployeeActivityView
          employeeId={row.id}
          leaveTypes={activeLeaveTypes}
          currentYear={currentYear}
        />
      </div>
    </PageShell>
  );
}