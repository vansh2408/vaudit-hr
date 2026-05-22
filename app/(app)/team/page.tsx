import * as React from "react";
import { and, asc, eq, gte, lte } from "drizzle-orm";

import { NoAccess } from "@/components/no-access";
import { PageShell } from "@/components/page-shell";
import { db } from "@/lib/db";
import { holidays, users } from "@/lib/db/schema";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import { TeamTabsClient } from "./team-tabs-client";

export const metadata = {
  title: "Team",
};

export const dynamic = "force-dynamic";

export default async function TeamPage(): Promise<React.JSX.Element> {
  const session = await requireSession();
  const isAdmin = isAdminRole(session.user.role);
  // Two audiences share this page:
  //  - HR_ADMIN / SUPER_ADMIN → all active employees (org-wide visibility
  //    for leave/WFH history + balances + calendar)
  //  - Non-admin managers     → their direct reports only
  // Anyone else is refused (also hidden from the nav).
  if (!isAdmin && !session.user.isManager) return <NoAccess />;

  // Admins see everyone active; non-admin managers see only direct reports.
  const where = isAdmin
    ? eq(users.isActive, true)
    : and(eq(users.managerId, session.user.id), eq(users.isActive, true));

  // Holidays for the calendar tab. Loading current year ±1 covers normal
  // prev/next navigation without a follow-up fetch; the visible window is
  // <= ~6 weeks so most browses stay inside this range.
  const thisYear = new Date().getFullYear();
  const [reports, holidayRows] = await Promise.all([
    db
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
      .orderBy(asc(users.firstName), asc(users.lastName)),
    db
      .select({ date: holidays.date })
      .from(holidays)
      .where(
        and(
          gte(holidays.date, `${thisYear - 1}-01-01`),
          lte(holidays.date, `${thisYear + 1}-12-31`),
        ),
      ),
  ]);

  const description = isAdmin
    ? "All employees — drill into a profile, or see who's out on the calendar."
    : "Your direct reports — drill into a profile, or see who's out on the calendar.";

  return (
    <PageShell title="Team" description={description}>
      <TeamTabsClient
        reports={reports}
        holidayDatesYmd={holidayRows.map((h) => h.date)}
        isAdmin={isAdmin}
      />
    </PageShell>
  );
}