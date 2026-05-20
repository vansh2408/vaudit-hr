import * as React from "react";

import { PageShell } from "@/components/page-shell";
import { TableSkeleton } from "@/components/skeletons";
import { requireAdmin } from "@/lib/auth/guards";
import { BalancesClient } from "./balances-client";

export const metadata = {
  title: "Balances",
};

export default async function BalancesPage(): Promise<React.JSX.Element> {
  await requireAdmin();
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
