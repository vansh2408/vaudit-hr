import * as React from "react";

import { PageShell } from "@/components/page-shell";
import { TableSkeleton } from "@/components/skeletons";
import { NotificationsClient } from "./notifications-client";

export const metadata = {
  title: "Notifications",
};

export default function NotificationsPage(): React.JSX.Element {
  return (
    <PageShell
      title="Notifications"
      description="Everything that happened on your behalf, with the unread ones up top."
    >
      <React.Suspense fallback={<TableSkeleton rows={6} cols={3} />}>
        <NotificationsClient />
      </React.Suspense>
    </PageShell>
  );
}
