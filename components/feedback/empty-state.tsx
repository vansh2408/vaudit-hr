import * as React from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  /** Lucide icon or any element. Will be rendered at 24x24 inside a tinted bubble. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Optional action — usually a <Button> */
  action?: React.ReactNode;
  className?: string;
};

/** Centered card used to fill a blank section (table, list, dashboard tile). */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mx-auto flex w-full max-w-md flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-6 py-12 text-center transition-ui",
        className,
      )}
    >
      {icon ? (
        <div
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground [&_svg]:h-6 [&_svg]:w-6"
        >
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
