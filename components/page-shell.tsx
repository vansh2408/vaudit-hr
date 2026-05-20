import * as React from "react";

import { cn } from "@/lib/utils";

type PageShellProps = {
  title: string;
  description?: string;
  /** Right-aligned actions in the header (buttons, dropdowns, etc.) */
  actions?: React.ReactNode;
  /** Optional breadcrumbs row above the title */
  breadcrumbs?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
};

/**
 * Page-level wrapper. The title scrolls naturally — the navbar is the
 * persistent header for the app, so duplicating that here would just add
 * visual noise.
 */
export function PageShell({
  title,
  description,
  actions,
  breadcrumbs,
  children,
  className,
}: PageShellProps): React.JSX.Element {
  return (
    <div className={cn("pb-10", className)}>
      <header className="flex flex-col gap-2 py-3">
        {breadcrumbs ? (
          <div className="text-xs text-muted-foreground">{breadcrumbs}</div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="max-w-2xl text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              {actions}
            </div>
          ) : null}
        </div>
      </header>
      <div className="mt-6 px-1">{children}</div>
    </div>
  );
}
