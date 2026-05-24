import * as React from "react";

import { PageShell } from "@/components/layout/page-shell";
import { TableSkeleton } from "@/components/feedback/skeletons";
import { LeaveListView } from "./leave-list-view";

export const metadata = {
  title: "Leave",
};

export default function LeavePage(): React.JSX.Element {
  return (
    <PageShell
      title="Leave"
      description="Submit and track your time-off requests."
    >
      <React.Suspense fallback={<TableSkeleton rows={6} cols={6} />}>
        <LeaveListView />
      </React.Suspense>
    </PageShell>
  );
}
