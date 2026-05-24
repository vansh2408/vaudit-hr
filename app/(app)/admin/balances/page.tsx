import * as React from "react";

import { NoAccess } from "@/components/feedback/no-access";
import { PageShell } from "@/components/layout/page-shell";
import { TableSkeleton } from "@/components/feedback/skeletons";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import { BalancesClient } from "./balances-client";

export const metadata = {
  title: "Balances",
};

export default async function BalancesPage(): Promise<React.JSX.Element> {
  const session = await requireSession();
  if (!isAdminRole(session.user.role)) return <NoAccess />;
  return (
    <PageShell
      title="Leave balances"
      description="Adjust an employee's allocated days. Every change is audit-logged."
    >
      <React.Suspense fallback={<TableSkeleton rows={6} cols={5} />}>
        <BalancesClient />
      </React.Suspense>
    </PageShell>
  );
}
