"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  NotificationBell,
  type NotificationItem,
} from "@/components/notifications/notification-bell";
import { useRecentNotifications } from "@/components/notifications/notifications-data";
import { ApiError } from "@/lib/api/client";
import {
  markNotificationRead,
  type NotificationsListResponse,
} from "@/lib/api/queries";

function toItem(row: NotificationsListResponse["items"][number]): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    link: row.link,
    isRead: row.isRead,
    createdAt: row.createdAt,
  };
}

/** Hooks the dumb NotificationBell up to the API and refreshes every 30s. */
export function NotificationsSlot(): React.JSX.Element {
  const qc = useQueryClient();
  const { items: rawItems } = useRecentNotifications();

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  function reportError(err: unknown, fallback: string): void {
    const message = err instanceof ApiError ? err.message : fallback;
    toast.error(message);
  }

  const markOne = useMutation({
    mutationFn: (id: string) => markNotificationRead({ id }),
    onSuccess: invalidate,
    onError: (err) => reportError(err, "Could not mark as read"),
  });

  const markAll = useMutation({
    mutationFn: () => markNotificationRead({ all: true }),
    onSuccess: invalidate,
    onError: (err) => reportError(err, "Could not mark all as read"),
  });

  const items: ReadonlyArray<NotificationItem> = React.useMemo(
    () => rawItems.map(toItem),
    [rawItems],
  );

  return (
    <NotificationBell
      notifications={items}
      onMarkRead={(id) => markOne.mutate(id)}
      onMarkAllRead={() => markAll.mutate()}
    />
  );
}
