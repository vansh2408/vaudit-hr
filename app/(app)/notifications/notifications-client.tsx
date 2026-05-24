"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, CheckCheck } from "lucide-react";

import { EmptyState } from "@/components/feedback/empty-state";
import { ListSkeleton } from "@/components/feedback/skeletons";
import { Button } from "@/components/ui/button";
import { NOTIFICATIONS_POLL_INTERVAL_MS } from "@/components/notifications/notifications-data";
import { ApiError } from "@/lib/api/client";
import {
  listNotifications,
  markNotificationRead,
  queryKeys,
  type NotificationRow,
} from "@/lib/api/queries";
import { emptyStates } from "@/lib/copy/empty-states";
import { formatRelative } from "@/lib/utils/timezone";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

// Delegates to the shared helper so the fallback date is rendered in ORG_TZ.
const relative = formatRelative;

export function NotificationsClient(): React.JSX.Element {
  const qc = useQueryClient();
  const [page, setPage] = React.useState(1);
  const [unreadOnly, setUnreadOnly] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.notifications.all(page, unreadOnly),
    queryFn: () =>
      listNotifications({
        page,
        pageSize: PAGE_SIZE,
        ...(unreadOnly !== undefined && { unreadOnly }),
      }),
    // Poll on the same cadence as the navbar bell + sidebar badge so the
    // page table stays in sync with the badge. Without this, the badge
    // ticks up but the list below stays cold until the user interacts.
    refetchInterval: NOTIFICATIONS_POLL_INTERVAL_MS,
  });

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: ["notifications"] });
  }

  function reportError(err: unknown, fallback: string): void {
    toast.error(err instanceof ApiError ? err.message : fallback);
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

  const items: NotificationRow[] = data?.items ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            variant={unreadOnly ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setPage(1);
              setUnreadOnly((v) => !v);
            }}
          >
            {unreadOnly ? "Show all" : "Unread only"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {unreadCount} unread
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAll.mutate()}
          disabled={unreadCount === 0 || markAll.isPending}
        >
          <CheckCheck className="h-4 w-4" aria-hidden />
          Mark all read
        </Button>
      </div>

      {isLoading ? (
        <ListSkeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title={emptyStates.noNotifications.title}
          description={emptyStates.noNotifications.description}
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {items.map((n) => (
            <li key={n.id}>
              <div className="flex items-start gap-3 px-4 py-3">
                <span
                  aria-hidden
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    n.isRead ? "bg-transparent" : "bg-primary",
                  )}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p
                    className={cn(
                      "text-sm leading-snug",
                      !n.isRead && "font-medium",
                    )}
                  >
                    {n.message}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {relative(n.createdAt)} · {n.type}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {n.link ? (
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        href={n.link}
                        onClick={() => !n.isRead && markOne.mutate(n.id)}
                      >
                        Open
                      </Link>
                    </Button>
                  ) : null}
                  {!n.isRead ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => markOne.mutate(n.id)}
                      disabled={markOne.isPending}
                    >
                      Mark read
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Page {page}</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={items.length < PAGE_SIZE}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
