import * as React from "react";
import { redirect } from "next/navigation";

import { Navbar } from "@/components/navbar";
import { NotificationSound } from "@/components/notification-sound";
import { Sidebar } from "@/components/sidebar";
import { TitleBadge } from "@/components/title-badge";
import { auth } from "@/lib/auth/config";

type AppShellProps = {
  children: React.ReactNode;
  /** Optional override for the notification bell slot. */
  notificationSlot?: React.ReactNode;
};

/**
 * Server-side authenticated shell. Pulls the session, passes the user's role
 * down to the client-side Sidebar + Navbar which filter the nav locally.
 * (Passing pre-filtered items would mean serializing Lucide icon components
 * across the Server→Client boundary, which Next.js forbids.)
 * Anonymous visitors are redirected to /login.
 */
export async function AppShell({
  children,
  notificationSlot,
}: AppShellProps): Promise<React.JSX.Element> {
  const session = await auth();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-[100dvh] bg-background">
      {/* TitleBadge has no visible markup — it just keeps the browser-tab
          title prefixed with "(N) " whenever the user has unread
          notifications, like Slack/Gmail. NotificationSound is the audio
          counterpart — it pings when the unread count increases. */}
      <TitleBadge />
      <NotificationSound />
      <Sidebar role={session.user.role} isManager={session.user.isManager} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar
          user={{
            name: session.user.name ?? session.user.email,
            email: session.user.email,
            role: session.user.role,
            image: session.user.image ?? null,
            isManager: session.user.isManager,
          }}
          {...(notificationSlot !== undefined ? { notificationSlot } : {})}
        />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
