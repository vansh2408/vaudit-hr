"use client";

import * as React from "react";

import { useRecentNotifications } from "@/components/notifications-data";
import { cn } from "@/lib/utils";

interface Props {
  /**
   * `dot` — a small destructive dot, absolutely positioned over the icon
   *         when the sidebar is collapsed to icon-only.
   * `pill` — a 99+/N pill rendered after the label when the sidebar is
   *          expanded or inside the mobile sheet.
   */
  variant: "dot" | "pill";
  className?: string;
}

/**
 * Sidebar unread indicator for the "Notifications" nav entry. Subscribes
 * to the same `["notifications", "recent"]` query as the navbar bell, so
 * both surfaces stay in sync via a single shared cache + polling timer.
 */
export function NotificationsNavBadge({
  variant,
  className,
}: Props): React.JSX.Element | null {
  const { unread } = useRecentNotifications();
  if (unread === 0) return null;

  const label = `${unread} unread notification${unread === 1 ? "" : "s"}`;

  if (variant === "dot") {
    return (
      <>
        <span className="sr-only">{label}</span>
        <span
          aria-hidden
          className={cn(
            "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-card",
            className,
          )}
        />
      </>
    );
  }

  return (
    <>
      <span className="sr-only">{label}</span>
      <span
        aria-hidden
        className={cn(
          "ml-auto inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-semibold leading-none text-destructive-foreground",
          className,
        )}
      >
        {unread > 99 ? "99+" : unread}
      </span>
    </>
  );
}
