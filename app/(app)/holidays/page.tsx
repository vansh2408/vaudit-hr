import * as React from "react";

import { PageShell } from "@/components/layout/page-shell";
import { TableSkeleton } from "@/components/feedback/skeletons";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import { HolidaysClient } from "./holidays-client";

export const metadata = {
  title: "Holidays",
};

export default async function HolidaysPage(): Promise<React.JSX.Element> {
  const session = await requireSession();
  const isAdmin = isAdminRole(session.user.role);
  return (
    <PageShell
      title="Holidays"
      description={
        isAdmin
          ? "Company holidays excluded from working-day calculations. Add or remove dates below."
          : "Company holidays excluded from working-day calculations."
      }
    >
      <React.Suspense fallback={<TableSkeleton rows={6} cols={isAdmin ? 3 : 2} />}>
        <HolidaysClient isAdmin={isAdmin} />
      </React.Suspense>
    </PageShell>
  );
}
