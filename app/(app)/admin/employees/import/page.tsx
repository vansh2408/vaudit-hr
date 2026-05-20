import * as React from "react";

import { PageShell } from "@/components/page-shell";
import { requireAdmin } from "@/lib/auth/guards";
import { ImportClient } from "./import-client";

export const metadata = {
  title: "Import employees",
};

export default async function ImportPage(): Promise<React.JSX.Element> {
  await requireAdmin();
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
