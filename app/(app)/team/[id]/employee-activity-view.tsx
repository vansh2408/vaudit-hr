"use client";

import * as React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import { LeaveListClient, type LeaveTypeLite } from "@/app/(app)/leave/leave-list-client";
import { WfhListClient } from "@/app/(app)/wfh/wfh-list-client";

interface Props {
  employeeId: string;
  /**
   * Active leave types — used by `LeaveListClient` to resolve type badges
   * and populate the Type filter. Fetched once at the page level so both
   * tabs share it.
   */
  leaveTypes: LeaveTypeLite[];
  currentYear: number;
}

/**
 * Read-only leave + WFH history panel for viewing another employee's
 * activity. Embedded on the team-member page (/team/:id) — page-level
 * auth (admin OR direct manager) ensures the viewer is allowed to see
 * this employee before the component renders.
 *
 * Tab-switches between Leave + WFH lists scoped to `employeeId`. The
 * underlying list clients hide their "New request" affordances when an
 * `employeeId` is supplied, so this surface is read-only: rows link to
 * the existing /leave/:id and /wfh/:id detail pages where the regular
 * action buttons live (which themselves gate on owner/manager/admin).
 *
 * Submit-mode props on the list clients (`balancesByType`,
 * `holidayDatesYmd`) are only used by the request dialog, which doesn't
 * render in employee-scoped mode — we pass empty placeholders rather
 * than fetching unused data.
 */
export function EmployeeActivityView({
  employeeId,
  leaveTypes,
  currentYear,
}: Props): React.JSX.Element {
  const [tab, setTab] = React.useState<"leave" | "wfh">("leave");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Leave &amp; WFH history</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={(v) => setTab(v as "leave" | "wfh")}>
          <TabsList>
            <TabsTrigger value="leave">Leave</TabsTrigger>
            <TabsTrigger value="wfh">WFH</TabsTrigger>
          </TabsList>
          <TabsContent value="leave" className="mt-4">
            <LeaveListClient
              employeeId={employeeId}
              leaveTypes={leaveTypes}
              balancesByType={{}}
              currentYear={currentYear}
              holidayDatesYmd={[]}
            />
          </TabsContent>
          <TabsContent value="wfh" className="mt-4">
            <WfhListClient employeeId={employeeId} holidayDatesYmd={[]} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}