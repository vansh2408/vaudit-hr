import * as React from "react";
import { and, asc, eq } from "drizzle-orm";
import { UsersRound } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { NoAccess } from "@/components/no-access";
import { PageShell } from "@/components/page-shell";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import { TeamListClient } from "./team-list-client";

export const metadata = {
  title: "Team",
};

export const dynamic = "force-dynamic";

export default async function TeamPage(): Promise<React.JSX.Element> {
  const session = await requireSession();
  const isAdmin = isAdminRole(session.user.role);
  // Two audiences share this page:
  //  - HR_ADMIN / SUPER_ADMIN → all active employees (org-wide visibility
  //    for leave/WFH history + balances)
  //  - Non-admin managers     → their direct reports only
  // Anyone else is refused (also hidden from the nav).
  if (!isAdmin && !session.user.isManager) return <NoAccess />;

  // Admins see everyone active; non-admin managers see only direct reports.
  const where = isAdmin
    ? eq(users.isActive, true)
    : and(eq(users.managerId, session.user.id), eq(users.isActive, true));
  const reports = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      position: users.position,
      department: users.department,
    })
    .from(users)
    .where(where)
    .orderBy(asc(users.firstName), asc(users.lastName));

  const description = isAdmin
    ? "All employees — click a name to view their leave and WFH history."
    : "Your direct reports — click a name to view their leave and WFH history.";

  return (
    <PageShell title="Team" description={description}>
      {reports.length === 0 ? (
        <EmptyState
          icon={<UsersRound />}
          title={isAdmin ? "No employees" : "No direct reports"}
          description={
            isAdmin
              ? "No active employees in the directory yet."
              : "When someone is assigned to report to you, they'll appear here."
          }
        />
      ) : (
        <TeamListClient reports={reports} />
      )}
    </PageShell>
  );
}