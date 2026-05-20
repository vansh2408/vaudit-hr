import * as React from "react";

import { PageShell } from "@/components/page-shell";
import { DashboardSkeleton } from "@/components/skeletons";
import { requireSession } from "@/lib/auth/guards";
import { DashboardContent } from "./dashboard-content";

export const metadata = {
  title: "Dashboard",
};

export const dynamic = "force-dynamic";

/**
 * Role-aware dashboard. Loads data server-side per-role and streams in
 * each section under a Suspense boundary so the shell renders instantly.
 */
export default async function DashboardPage(): Promise<React.JSX.Element> {
  const session = await requireSession();
  const firstName = (session.user.name ?? session.user.email).split(" ")[0];

  return (
    <PageShell
      title={`Hi${firstName ? `, ${firstName}` : ""}`}
      description="Your time off, requests, and team activity at a glance."
    >
      <React.Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent
          userId={session.user.id}
          role={session.user.role}
          isManager={session.user.isManager}
        />
      </React.Suspense>
    </PageShell>
  );
}
