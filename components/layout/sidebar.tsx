"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NotificationsNavBadge } from "@/components/notifications/notifications-nav-badge";
import type { NavItem } from "@/lib/nav/items";
import { navItemsForUser } from "@/lib/nav/items";
import type { UserRole } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const NOTIFICATIONS_HREF = "/notifications";

type SidebarProps = {
  // Receive `role` + `isManager` rather than the pre-filtered items:
  // React component references (Lucide icons) are not serializable across
  // the Server→Client boundary, so we filter on the client instead.
  role: UserRole;
  isManager: boolean;
  /** Brand line shown at the top of the rail. */
  brand?: React.ReactNode;
  className?: string;
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavList({
  items,
  pathname,
  onNavigate,
  collapsed,
}: {
  items: ReadonlyArray<NavItem>;
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}): React.JSX.Element {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1 p-2">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        const isNotifications = item.href === NOTIFICATIONS_HREF;
        return (
          <Link
            key={item.href}
            href={item.href}
            {...(onNavigate ? { onClick: onNavigate } : {})}
            {...(active ? { "aria-current": "page" as const } : {})}
            className={cn(
              "group inline-flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-ui",
              "hover:bg-accent hover:text-accent-foreground",
              active && "bg-accent text-accent-foreground",
              collapsed && "justify-center px-2",
            )}
            {...(collapsed ? { title: item.label } : {})}
          >
            <span className="relative inline-flex shrink-0">
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {isNotifications && collapsed ? (
                <NotificationsNavBadge variant="dot" />
              ) : null}
            </span>
            {!collapsed ? (
              <>
                <span className="truncate">{item.label}</span>
                {isNotifications ? (
                  <NotificationsNavBadge variant="pill" />
                ) : null}
              </>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Collapsible left rail. Desktop: persistent column with optional collapse.
 * Mobile: rendered as a Sheet via the exported `<SidebarTrigger />`.
 */
export function Sidebar({ role, isManager, brand, className }: SidebarProps): React.JSX.Element {
  const pathname = usePathname() ?? "";
  const [collapsed, setCollapsed] = React.useState(false);
  const items = React.useMemo(
    () => navItemsForUser(role, isManager),
    [role, isManager],
  );

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-[100dvh] shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 lg:flex",
        collapsed ? "w-[4.25rem]" : "w-60",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center border-b border-border px-3",
          collapsed ? "justify-center" : "justify-between",
        )}
      >
        {!collapsed ? (
          <div className="text-sm font-semibold tracking-tight">
            {brand ?? "Vaudit HR"}
          </div>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="transition-ui"
        >
          <ChevronLeft
            className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")}
            aria-hidden
          />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <NavList items={items} pathname={pathname} collapsed={collapsed} />
      </ScrollArea>
    </aside>
  );
}

type SidebarTriggerProps = {
  role: UserRole;
  isManager: boolean;
  brand?: React.ReactNode;
  className?: string;
};

/** Mobile trigger — opens the same nav inside a Sheet. */
export function SidebarTrigger({
  role,
  isManager,
  brand,
  className,
}: SidebarTriggerProps): React.JSX.Element {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = React.useState(false);
  const items = React.useMemo(
    () => navItemsForUser(role, isManager),
    [role, isManager],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          className={cn("lg:hidden", className)}
        >
          <Menu className="h-5 w-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 p-0">
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="text-base">{brand ?? "Vaudit HR"}</SheetTitle>
          <SheetDescription className="sr-only">
            Primary navigation
          </SheetDescription>
        </SheetHeader>
        <NavList items={items} pathname={pathname} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
