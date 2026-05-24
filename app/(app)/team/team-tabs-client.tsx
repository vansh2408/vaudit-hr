"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, UsersRound } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { TeamCalendarClient } from "./team-calendar-client";
import { TeamListClient, type TeamReport } from "./team-list-client";

type TabValue = "list" | "calendar";

interface Props {
  reports: ReadonlyArray<TeamReport>;
  holidayDatesYmd: ReadonlyArray<string>;
  /** Drives the "no reports" empty-state copy on the List tab. */
  isAdmin: boolean;
}

/**
 * Tabbed wrapper for the /team page. The list (directory) tab is the
 * default; the calendar tab is a read-only month/week/day view of
 * APPROVED + PENDING_CANCELLATION leave + WFH. Tab state is mirrored in
 * the URL (`?tab=calendar`) so it survives reload and links.
 */
export function TeamTabsClient({
  reports,
  holidayDatesYmd,
  isAdmin,
}: Props): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const tab: TabValue =
    params?.get("tab") === "calendar" ? "calendar" : "list";

  const onTabChange = (next: string): void => {
    const sp = new URLSearchParams(params?.toString() ?? "");
    if (next === "list") sp.delete("tab");
    else sp.set("tab", next);
    const qs = sp.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList>
        <TabsTrigger value="list">List</TabsTrigger>
        <TabsTrigger value="calendar">Calendar</TabsTrigger>
      </TabsList>
      <TabsContent value="list" className="mt-4">
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
      </TabsContent>
      <TabsContent value="calendar" className="mt-4">
        {reports.length === 0 ? (
          <EmptyState
            icon={<CalendarDays />}
            title="Nothing to show yet"
            description={
              isAdmin
                ? "Once employees are added, their leave and WFH will appear here."
                : "Once you have direct reports, their leave and WFH will appear here."
            }
          />
        ) : (
          <TeamCalendarClient holidayDatesYmd={holidayDatesYmd} />
        )}
      </TabsContent>
    </Tabs>
  );
}