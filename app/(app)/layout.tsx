import * as React from "react";

import { AppShell } from "@/components/app-shell";
import { NotificationsSlot } from "@/components/notifications-slot";
import { QueryProvider } from "@/providers/query-provider";
import { requireSession } from "@/lib/auth/guards";

/**
 * Authenticated layout group. Requires a session — `AppShell` already
 * server-checks and redirects, but we double-bind here so this layout
 * cannot accidentally render for an anonymous user even via streaming.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  await requireSession();
  return (
    <QueryProvider>
      <AppShell notificationSlot={<NotificationsSlot />}>{children}</AppShell>
    </QueryProvider>
  );
}
