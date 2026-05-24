import * as React from "react";

import { Badge } from "@/components/ui/badge";
import type { UserRole } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

type RoleBadgeProps = {
  role: UserRole;
  className?: string;
};

const ROLE_LABEL: Record<UserRole, string> = {
  EMPLOYEE: "Employee",
  HR_ADMIN: "HR admin",
  SUPER_ADMIN: "Super admin",
};

const ROLE_CLASSES: Record<UserRole, string> = {
  EMPLOYEE:
    "border-border bg-muted text-foreground/80 hover:bg-muted/80",
  HR_ADMIN:
    "border-violet-200 bg-violet-100 text-violet-800 hover:bg-violet-200/80 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-200",
  SUPER_ADMIN:
    "border-amber-200 bg-amber-100 text-amber-900 hover:bg-amber-200/80 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
};

export function RoleBadge({ role, className }: RoleBadgeProps): React.JSX.Element {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide transition-ui",
        ROLE_CLASSES[role],
        className,
      )}
    >
      {ROLE_LABEL[role]}
    </Badge>
  );
}
