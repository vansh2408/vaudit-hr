/**
 * Sidebar navigation registry. Items are gated by role and/or
 * "is the viewer somebody's manager?" at render time. This file is
 * the single source of truth for the left rail.
 */
import {
  Bell,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Gauge,
  Laptop,
  Network,
  Palmtree,
  Scale,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { UserRole } from "@/lib/db/schema";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Roles allowed to see this item. Undefined = visible to everyone signed in. */
  roles?: ReadonlyArray<UserRole>;
  /**
   * If true, also visible to non-admin users who have at least one direct
   * report. Used for the approval/org-chart entries that anyone with reports
   * needs, regardless of role.
   */
  alsoIfManager?: boolean;
};

export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  // ---- Everyone ----
  { href: "/dashboard", label: "Dashboard", icon: Gauge },
  { href: "/leave", label: "Leave", icon: CalendarDays },
  { href: "/wfh", label: "Work from home", icon: Laptop },
  { href: "/holidays", label: "Holidays", icon: Palmtree },
  { href: "/org-chart", label: "Org chart", icon: Network },
  { href: "/notifications", label: "Notifications", icon: Bell },

  // ---- Anyone with direct reports + HR ----
  {
    href: "/approvals",
    label: "Approvals",
    icon: ClipboardCheck,
    roles: ["HR_ADMIN", "SUPER_ADMIN"],
    alsoIfManager: true,
  },

  // ---- HR_ADMIN + SUPER_ADMIN ----
  {
    href: "/admin/employees",
    label: "Employees",
    icon: Users,
    roles: ["HR_ADMIN", "SUPER_ADMIN"],
  },
  {
    href: "/admin/balances",
    label: "Balances",
    icon: Scale,
    roles: ["HR_ADMIN", "SUPER_ADMIN"],
  },
  {
    href: "/admin/audit-log",
    label: "Audit log",
    icon: FileText,
    roles: ["HR_ADMIN", "SUPER_ADMIN"],
  },
];

/**
 * Filter the nav registry against the signed-in user. `isManager` is true
 * when the user has at least one direct report — see Session.user.isManager.
 */
export function navItemsForUser(
  role: UserRole,
  isManager: boolean,
): ReadonlyArray<NavItem> {
  return NAV_ITEMS.filter((item) => {
    if (!item.roles) return true;
    if (item.roles.includes(role)) return true;
    if (item.alsoIfManager && isManager) return true;
    return false;
  });
}
