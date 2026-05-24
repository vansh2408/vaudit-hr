import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type WithClass = { className?: string };

/** Generic table loading skeleton. */
export function TableSkeleton({
  rows = 6,
  cols = 4,
  className,
}: { rows?: number; cols?: number } & WithClass): React.JSX.Element {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
      <div className="grid gap-3 border-b border-border bg-muted/40 px-4 py-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-3/4" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className="grid gap-3 px-4 py-4"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className="h-4 w-full" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Grid of card skeletons, e.g. dashboard tiles or directory cards. */
export function CardGridSkeleton({
  count = 4,
  className,
}: { count?: number } & WithClass): React.JSX.Element {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border bg-card p-5">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ))}
    </div>
  );
}

/** Vertical list skeleton — e.g. notifications, activity feeds. */
export function ListSkeleton({
  rows = 5,
  className,
}: { rows?: number } & WithClass): React.JSX.Element {
  return (
    <ul
      className={cn(
        "divide-y divide-border overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 px-4 py-3">
          <Skeleton className="mt-1.5 h-2 w-2 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Full-dashboard skeleton: heading, stat row, table block. */
export function DashboardSkeleton({ className }: WithClass): React.JSX.Element {
  return (
    <div className={cn("space-y-8", className)}>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <CardGridSkeleton count={4} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TableSkeleton rows={5} cols={3} />
        <TableSkeleton rows={5} cols={3} />
      </div>
    </div>
  );
}
