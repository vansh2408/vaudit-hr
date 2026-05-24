"use client";

import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  type: string;
  message: string;
  link?: string | null;
  isRead: boolean;
  createdAt: Date | string;
};

type NotificationBellProps = {
  notifications: ReadonlyArray<NotificationItem>;
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
  className?: string;
};

function formatRelative(input: Date | string): string {
  const date = typeof input === "string" ? new Date(input) : input;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function NotificationBell({
  notifications,
  onMarkRead,
  onMarkAllRead,
  className,
}: NotificationBellProps): React.JSX.Element {
  const unread = notifications.filter((n) => !n.isRead).length;
  const hasUnread = unread > 0;
  const label = hasUnread ? `Notifications (${unread} unread)` : "Notifications";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn("relative transition-ui", className)}
        >
          <Bell className="h-[1.15rem] w-[1.15rem]" aria-hidden />
          {hasUnread ? (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold">Notifications</span>
          {hasUnread && onMarkAllRead ? (
            <button
              type="button"
              onClick={onMarkAllRead}
              className="text-xs font-medium text-primary transition-ui hover:underline focus-visible:underline"
            >
              Mark all read
            </button>
          ) : null}
        </div>
        <ScrollArea className="max-h-80">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => {
                const body = (
                  <div className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        n.isRead ? "bg-transparent" : "bg-primary",
                      )}
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className={cn("text-sm leading-snug", !n.isRead && "font-medium")}>
                        {n.message}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelative(n.createdAt)}
                      </p>
                    </div>
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link
                        href={n.link}
                        onClick={() => !n.isRead && onMarkRead?.(n.id)}
                        className="block px-4 py-3 transition-ui hover:bg-accent"
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => !n.isRead && onMarkRead?.(n.id)}
                        className="block w-full px-4 py-3 text-left transition-ui hover:bg-accent"
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
        <div className="border-t border-border px-4 py-2 text-right">
          <Link
            href="/notifications"
            className="text-xs font-medium text-muted-foreground transition-ui hover:text-foreground"
          >
            View all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
