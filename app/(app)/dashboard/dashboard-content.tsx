import * as React from "react";
import Link from "next/link";
import { and, asc, count, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { ArrowRight, CalendarDays, ClipboardCheck, Users } from "lucide-react";

import { Avatar } from "@/components/avatar";
import { BalanceCard } from "@/components/balance-card";
import { EmptyState } from "@/components/empty-state";
import { LeaveTypeBadge } from "@/components/leave-type-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import {
  leaveBalances,
  leaveRequests,
  leaveTypes,
  users,
  wfhRequests,
  type UserRole,
} from "@/lib/db/schema";
import { emptyStates } from "@/lib/copy/empty-states";
import {
  addDays as addCalendarDays,
  formatYmdHuman,
  todayYmd,
  unsafeYmd,
  type Ymd,
} from "@/lib/utils/dates";
import { formatDays } from "@/lib/utils/format-days";

interface Props {
  userId: string;
  role: UserRole;
  /** True when the viewer has at least one direct report. */
  isManager: boolean;
}

interface MyBalance {
  leaveTypeId: string;
  leaveTypeName: string;
  allocated: number;
  used: number;
  /** False for Unpaid-style leave types — drives the "Unlimited" card UI. */
  isPaid: boolean;
}

interface UpcomingLeave {
  id: string;
  leaveTypeName: string;
  startDate: Ymd;
  endDate: Ymd;
  totalDays: number;
}

interface TeamOnLeaveItem {
  employeeId: string;
  employeeName: string;
  leaveTypeName: string;
  endDate: Ymd;
}

function isAdminRole(role: UserRole): boolean {
  return role === "HR_ADMIN" || role === "SUPER_ADMIN";
}

function formatDateShort(ymd: Ymd): string {
  return formatYmdHuman(ymd, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function loadMyBalances(userId: string): Promise<MyBalance[]> {
  const year = new Date().getFullYear();
  const rows = await db
    .select({
      leaveTypeId: leaveBalances.leaveTypeId,
      leaveTypeName: leaveTypes.name,
      allocated: leaveBalances.allocated,
      used: leaveBalances.used,
      isActive: leaveTypes.isActive,
      isPaid: leaveTypes.isPaid,
    })
    .from(leaveBalances)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveBalances.leaveTypeId))
    .where(
      and(
        eq(leaveBalances.employeeId, userId),
        eq(leaveBalances.year, year),
      ),
    )
    .orderBy(asc(leaveTypes.name));
  return rows
    .filter((r) => r.isActive)
    .map((r) => ({
      leaveTypeId: r.leaveTypeId,
      leaveTypeName: r.leaveTypeName,
      allocated: r.allocated,
      used: r.used,
      isPaid: r.isPaid,
    }));
}

async function loadMyPendingCount(userId: string): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, userId),
        inArray(leaveRequests.status, ["PENDING", "PENDING_CANCELLATION"]),
      ),
    );
  return rows[0]?.n ?? 0;
}

async function loadMyUpcomingLeaves(userId: string): Promise<UpcomingLeave[]> {
  const today = todayYmd();
  const horizon = addCalendarDays(today, 30);
  const rows = await db
    .select({
      id: leaveRequests.id,
      leaveTypeName: leaveTypes.name,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
    })
    .from(leaveRequests)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        eq(leaveRequests.employeeId, userId),
        // Include PENDING_CANCELLATION — those are still committed leave
        // (balance consumed, dates blocked) until the manager actually
        // approves the cancellation. Showing them in "upcoming" tells the
        // employee they're still on the hook for those dates.
        inArray(leaveRequests.status, ["APPROVED", "PENDING_CANCELLATION"]),
        gte(leaveRequests.startDate, today),
        lte(leaveRequests.startDate, horizon),
      ),
    )
    .orderBy(asc(leaveRequests.startDate))
    .limit(5);
  return rows.map((r) => ({
    id: r.id,
    leaveTypeName: r.leaveTypeName,
    startDate: unsafeYmd(r.startDate),
    endDate: unsafeYmd(r.endDate),
    totalDays: r.totalDays,
  }));
}

async function loadPendingApprovalsCount(
  reviewerId: string,
  role: UserRole,
): Promise<number> {
  // Self-review is blocked at the API and filtered out of the /approvals
  // queue. Mirror that here so the dashboard counter never shows requests the
  // reviewer can't actually act on (matters for admins/super-admins who would
  // otherwise be counted against their own pending submissions).
  if (isAdminRole(role)) {
    const rows = await db
      .select({ n: count() })
      .from(leaveRequests)
      .where(
        and(
          inArray(leaveRequests.status, ["PENDING", "PENDING_CANCELLATION"]),
          ne(leaveRequests.employeeId, reviewerId),
        ),
      );
    const wfh = await db
      .select({ n: count() })
      .from(wfhRequests)
      .where(
        and(
          inArray(wfhRequests.status, ["PENDING", "PENDING_CANCELLATION"]),
          ne(wfhRequests.employeeId, reviewerId),
        ),
      );
    return (rows[0]?.n ?? 0) + (wfh[0]?.n ?? 0);
  }
  // Manager: pending requests of direct reports, excluding any row where the
  // reviewer is also the employee (edge case if managerId === id legacy data).
  const leaveRows = await db
    .select({ n: count() })
    .from(leaveRequests)
    .innerJoin(users, eq(users.id, leaveRequests.employeeId))
    .where(
      and(
        inArray(leaveRequests.status, ["PENDING", "PENDING_CANCELLATION"]),
        eq(users.managerId, reviewerId),
        ne(leaveRequests.employeeId, reviewerId),
      ),
    );
  const wfhRows = await db
    .select({ n: count() })
    .from(wfhRequests)
    .innerJoin(users, eq(users.id, wfhRequests.employeeId))
    .where(
      and(
        inArray(wfhRequests.status, ["PENDING", "PENDING_CANCELLATION"]),
        eq(users.managerId, reviewerId),
        ne(wfhRequests.employeeId, reviewerId),
      ),
    );
  return (leaveRows[0]?.n ?? 0) + (wfhRows[0]?.n ?? 0);
}

async function loadTeamOnLeaveToday(
  viewerId: string,
  role: UserRole,
): Promise<TeamOnLeaveItem[]> {
  const today = todayYmd();
  const base = db
    .select({
      employeeId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      leaveTypeName: leaveTypes.name,
      endDate: leaveRequests.endDate,
      managerId: users.managerId,
    })
    .from(leaveRequests)
    .innerJoin(users, eq(users.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
    .where(
      and(
        // Same reasoning as loadMyUpcomingLeaves — PENDING_CANCELLATION
        // hasn't been approved-as-cancelled yet, so the employee is still
        // out and should show in the "team out today" panel.
        inArray(leaveRequests.status, ["APPROVED", "PENDING_CANCELLATION"]),
        lte(leaveRequests.startDate, today),
        gte(leaveRequests.endDate, today),
      ),
    )
    .orderBy(asc(users.firstName));
  const rows = await base;
  const filtered = isAdminRole(role)
    ? rows
    : rows.filter((r) => r.managerId === viewerId);
  return filtered.slice(0, 8).map((r) => ({
    employeeId: r.employeeId,
    employeeName: `${r.firstName} ${r.lastName}`,
    leaveTypeName: r.leaveTypeName,
    endDate: unsafeYmd(r.endDate),
  }));
}

function MyBalancesGrid({ balances }: { balances: MyBalance[] }): React.JSX.Element {
  const year = new Date().getFullYear();
  if (balances.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays />}
        title="No balances yet"
        description="HR will configure your leave balances shortly."
      />
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {balances.map((b) => (
        <BalanceCard
          key={b.leaveTypeId}
          typeName={b.leaveTypeName}
          allocated={b.allocated}
          used={b.used}
          description={`Year ${year}`}
          unlimited={!b.isPaid}
        />
      ))}
    </div>
  );
}

function StatCard({
  title,
  value,
  href,
  hint,
  icon,
}: {
  title: string;
  value: React.ReactNode;
  href?: string;
  hint?: string;
  icon: React.ReactNode;
}): React.JSX.Element {
  const inner = (
    <Card className="transition-ui hover:shadow-md">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <span aria-hidden className="text-muted-foreground">
          {icon}
        </span>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-3xl font-semibold tabular-nums">{value}</span>
          {href ? (
            <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          ) : null}
        </div>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
  if (!href) return inner;
  return (
    <Link href={href} className="block focus-visible:outline-none">
      {inner}
    </Link>
  );
}

function UpcomingLeavesCard({
  items,
}: {
  items: UpcomingLeave[];
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Upcoming approved leaves</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No approved leaves in the next 30 days.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="flex items-center gap-2">
                  <LeaveTypeBadge name={it.leaveTypeName} />
                  <span className="text-muted-foreground">
                    {formatDateShort(it.startDate)}
                    {it.startDate !== it.endDate
                      ? ` – ${formatDateShort(it.endDate)}`
                      : ""}
                  </span>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatDays(it.totalDays)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TeamOnLeaveCard({
  items,
}: {
  items: TeamOnLeaveItem[];
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Team on leave today</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {emptyStates.noTeamOnLeave.description}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li
                key={it.employeeId}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={it.employeeName} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{it.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      Returns {formatDateShort(addCalendarDays(it.endDate, 1))}
                    </p>
                  </div>
                </div>
                <LeaveTypeBadge name={it.leaveTypeName} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export async function DashboardContent({
  userId,
  role,
  isManager,
}: Props): Promise<React.JSX.Element> {
  const [balances, pendingMine, upcoming] = await Promise.all([
    loadMyBalances(userId),
    loadMyPendingCount(userId),
    loadMyUpcomingLeaves(userId),
  ]);

  const managerOrAdmin = isManager || isAdminRole(role);
  const [pendingApprovals, teamOnLeave] = managerOrAdmin
    ? await Promise.all([
        loadPendingApprovalsCount(userId, role),
        loadTeamOnLeaveToday(userId, role),
      ])
    : [0, [] as TeamOnLeaveItem[]];

  return (
    <div className="space-y-8">
      <section aria-label="My leave balances">
        <MyBalancesGrid balances={balances} />
      </section>

      <section
        aria-label="Quick stats"
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <StatCard
          title="My pending requests"
          value={pendingMine}
          href="/leave"
          icon={<CalendarDays className="h-4 w-4" />}
          hint={
            pendingMine === 0
              ? "Nothing waiting for review"
              : "Awaiting a manager decision"
          }
        />
        {managerOrAdmin ? (
          <StatCard
            title="Pending approvals"
            value={pendingApprovals}
            href="/approvals"
            icon={<ClipboardCheck className="h-4 w-4" />}
            hint={
              pendingApprovals === 0
                ? "Inbox zero — nicely done."
                : "Requests waiting on you"
            }
          />
        ) : null}
        {managerOrAdmin ? (
          <StatCard
            title="Team out today"
            value={teamOnLeave.length}
            icon={<Users className="h-4 w-4" />}
            hint={
              teamOnLeave.length === 0
                ? "Everyone's in"
                : `${teamOnLeave.length} on approved leave`
            }
          />
        ) : null}
        <Card className="flex flex-col items-start justify-center gap-2 p-5">
          <p className="text-sm font-medium text-muted-foreground">
            Need time off?
          </p>
          <Button asChild>
            <Link href="/leave/new">New leave request</Link>
          </Button>
        </Card>
      </section>

      <section
        aria-label="Activity"
        className="grid gap-4 lg:grid-cols-2"
      >
        <UpcomingLeavesCard items={upcoming} />
        {managerOrAdmin ? <TeamOnLeaveCard items={teamOnLeave} /> : null}
      </section>
    </div>
  );
}
