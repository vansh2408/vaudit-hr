import * as React from "react";

import { PageShell } from "@/components/page-shell";
import { TableSkeleton } from "@/components/skeletons";
import { WfhListView } from "./wfh-list-view";

export const metadata = {
  title: "Work from home",
};

export default function WfhPage(): React.JSX.Element {
  return (
    <PageShell
      title="Work from home"
      description="Submit a single day or a range to work from home."
    >
      <React.Suspense fallback={<TableSkeleton rows={6} cols={5} />}>
        <WfhListView />
      </React.Suspense>
    </PageShell>
  );
}
