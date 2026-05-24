import * as React from "react";

import { NoAccess } from "@/components/feedback/no-access";
import { PageShell } from "@/components/layout/page-shell";
import { TableSkeleton } from "@/components/feedback/skeletons";
import { requireSession } from "@/lib/auth/guards";
import { isAdminRole } from "@/lib/api/route-helpers";
import { AuditLogClient } from "./audit-log-client";

export const metadata = {
  title: "Audit log",
};

export default async function AuditLogPage(): Promise<React.JSX.Element> {
  const session = await requireSession();
  if (!isAdminRole(session.user.role)) return <NoAccess />;
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
