import * as React from "react";

import { PageShell } from "@/components/layout/page-shell";
import { CardGridSkeleton } from "@/components/feedback/skeletons";
import { requireSession } from "@/lib/auth/guards";
import { OrgChartClient } from "./org-chart-client";

export const metadata = {
  title: "Org chart",
};

export default async function OrgChartPage(): Promise<React.JSX.Element> {
  await requireSession();
  return (
    <PageShell
      title="Org chart"
      description="Drag to pan, scroll or pinch to zoom, click a node to collapse."
    >
      <React.Suspense fallback={<CardGridSkeleton count={4} />}>
        <OrgChartClient />
      </React.Suspense>
    </PageShell>
  );
}
