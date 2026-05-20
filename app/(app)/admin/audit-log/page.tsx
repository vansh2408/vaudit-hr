import * as React from "react";

import { PageShell } from "@/components/page-shell";
import { TableSkeleton } from "@/components/skeletons";
import { requireAdmin } from "@/lib/auth/guards";
import { AuditLogClient } from "./audit-log-client";

export const metadata = {
  title: "Audit log",
};

export default async function AuditLogPage(): Promise<React.JSX.Element> {
  await requireAdmin();
  return (
    <PageShell
      title="Audit log"
      description="Every sensitive action is recorded with actor, target, and metadata."
    >
      <React.Suspense fallback={<TableSkeleton rows={8} cols={4} />}>
        <AuditLogClient />
      </React.Suspense>
    </PageShell>
  );
}
