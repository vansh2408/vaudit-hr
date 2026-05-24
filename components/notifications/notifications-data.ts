"use client";

import { useQuery } from "@tanstack/react-query";

import {
  listNotifications,
  queryKeys,
  type NotificationsListResponse,
} from "@/lib/api/queries";

const RECENT_PAGE_SIZE = 10;
/**
 * Shared polling cadence for every notification surface (navbar bell,
 * sidebar badge, /notifications page, tab title, sound). Bump this in
 * ONE place to retune "how fresh does the UI feel" for everyone.
 *
 * 10s is a snappy default for an HR app's notification volume; at 50
 * concurrent users that's ~300 requests/minute total, easily handled by
 * Postgres. If user count grows, consider 15–30s before adding real-time
 * push.
 */
export const NOTIFICATIONS_POLL_INTERVAL_MS = 10_000;

/**
 * Shared "recent notifications" query. Drives both the navbar bell
 * (NotificationsSlot) and the sidebar Notifications unread badge.
 *
 * Both surfaces subscribe with the SAME `queryKey` + `queryFn`, so React
 * Query dedupes the request, shares the cache, and runs a single polling
 * timer regardless of how many components consume the hook. Mark-as-read
 * mutations elsewhere invalidate `["notifications"]` and every consumer
 * re-reads automatically.
 */
export function useRecentNotifications(): {
  items: NotificationsListResponse["items"];
  unread: number;
} {
  const { data } = useQuery({
    queryKey: queryKeys.notifications.recent(),
    queryFn: () => listNotifications({ page: 1, pageSize: RECENT_PAGE_SIZE }),
    refetchInterval: NOTIFICATIONS_POLL_INTERVAL_MS,
    refetchOnMount: true,
  });
  const items = data?.items ?? [];
  const unread = items.reduce((acc, n) => acc + (n.isRead ? 0 : 1), 0);
  return { items, unread };
}
