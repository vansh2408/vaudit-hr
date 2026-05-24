import * as React from "react";

import { Badge } from "@/components/ui/badge";
import type { RequestStatus } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  status: RequestStatus;
  className?: string;
};

const STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  PENDING_CANCELLATION: "Cancellation pending",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const STATUS_CLASSES: Record<RequestStatus, string> = {
  PENDING:
    "border-amber-200 bg-amber-100 text-amber-900 hover:bg-amber-200/80 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
  APPROVED:
    "border-emerald-200 bg-emerald-100 text-emerald-800 hover:bg-emerald-200/80 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200",
  PENDING_CANCELLATION:
    "border-orange-200 bg-orange-100 text-orange-900 hover:bg-orange-200/80 dark:border-orange-900 dark:bg-orange-950/60 dark:text-orange-200",
  REJECTED:
    "border-red-200 bg-red-100 text-red-800 hover:bg-red-200/80 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200",
  CANCELLED:
    "border-zinc-200 bg-zinc-100 text-zinc-700 hover:bg-zinc-200/80 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300",
};

export function StatusBadge({ status, className }: StatusBadgeProps): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide transition-ui",
        STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </Badge>
  );
}
