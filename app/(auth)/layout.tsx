import * as React from "react";

import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Minimal authenticated-shell-free layout used for /login.
 * Centers content, surfaces the wordmark + theme toggle.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="flex h-14 items-center justify-between px-4 sm:px-6">
        <span className="text-sm font-semibold tracking-tight">Vaudit HR</span>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="px-4 py-6 text-center text-xs text-muted-foreground sm:px-6">
        Internal HR for Vaudit / BlokID
      </footer>
    </div>
  );
}
