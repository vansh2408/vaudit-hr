import * as React from "react";

import { NoAccess } from "@/components/feedback/no-access";
import { PageShell } from "@/components/layout/page-shell";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import { ImportClient } from "./import-client";

export const metadata = {
  title: "Import employees",
};

export default async function ImportPage(): Promise<React.JSX.Element> {
  const session = await requireSession();
  if (!isAdminRole(session.user.role)) return <NoAccess />;
  return (
    <PageShell
      title="Import employees"
      description="Upload a CSV, preview the changes, then commit. Inserts auto-create balances for the current year."
      breadcrumbs={
        <a
          href="/admin/employees"
          className="text-muted-foreground hover:text-foreground"
        >
          ← Back to employees
        </a>
      }
    >
      <ImportClient />
    </PageShell>
  );
}
