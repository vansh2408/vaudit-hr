import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { leaveTypeColor } from "@/lib/leave/colors";
import { cn } from "@/lib/utils";

type LeaveTypeBadgeProps = {
  name: string;
  /** Show a leading colour dot (default true) */
  withDot?: boolean;
  className?: string;
};

export function LeaveTypeBadge({
  name,
  withDot = true,
  className,
}: LeaveTypeBadgeProps): React.JSX.Element {
  const c = leaveTypeColor(name);
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide transition-ui",
        c.bg,
        c.fg,
        c.border,
        className,
      )}
    >
      {withDot ? (
        <span
          aria-hidden
          className={cn("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", c.dot)}
        />
      ) : null}
      {name}
    </Badge>
  );
}
