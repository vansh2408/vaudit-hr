"use client";

import * as React from "react";
import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";

import { Avatar } from "@/components/domain/avatar";
import { RoleBadge } from "@/components/domain/role-badge";
import { SidebarTrigger } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UserRole } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

type NavbarUser = {
  name: string;
  email: string;
  role: UserRole;
  image?: string | null;
  isManager: boolean;
};

type NavbarProps = {
  user: NavbarUser;
  /** Slot for the notification bell — frontend-dev wires data + handlers. */
  notificationSlot?: React.ReactNode;
  className?: string;
};

export function Navbar({
  user,
  notificationSlot,
  className,
}: NavbarProps): React.JSX.Element {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-background/90 px-4 backdrop-blur sm:px-6",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <SidebarTrigger role={user.role} isManager={user.isManager} />
        <span className="text-sm font-semibold tracking-tight lg:hidden">
          Vaudit HR
        </span>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <ThemeToggle />
        {notificationSlot}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Account menu for ${user.name}`}
              className="rounded-full transition-ui"
            >
              <Avatar
                name={user.name}
                image={user.image ?? null}
                size="sm"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-1 py-2">
              <span className="text-sm font-semibold leading-tight">{user.name}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {user.email}
              </span>
              <span className="pt-1">
                <RoleBadge role={user.role} />
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void signOut({ callbackUrl: "/login" });
              }}
              className="cursor-pointer"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              <span>Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
