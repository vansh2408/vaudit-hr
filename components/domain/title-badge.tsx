"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { useRecentNotifications } from "@/components/notifications/notifications-data";

/**
 * Prefixes the browser-tab title with the unread-notifications count, the
 * way Slack and Gmail do: "(3) Leave — Vaudit HR".
 *
 * Renders nothing — it's a hook in component clothing. Mount once inside
 * the authenticated app shell.
 *
 * Why a MutationObserver and not just a useEffect on [unread, pathname]?
 *
 * Next.js applies per-page `metadata.title` AFTER React's effects have
 * run on a route change. If we only re-prefix when pathname changes, our
 * prefix lands on the OLD title, then Next.js overwrites the title to
 * the new page's value (without our prefix). Net effect: the prefix only
 * sticks on the initial landing page. Watching the <title> element with
 * a MutationObserver makes us re-apply whenever anything (Next.js, a
 * library, a browser extension) rewrites it.
 *
 * Re-entry safety: we compute the desired title and only mutate if it
 * differs from the current one. So our own write doesn't cascade into an
 * infinite observer loop.
 */
export function TitleBadge(): null {
  const { unread } = useRecentNotifications();
  const pathname = usePathname();

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const titleEl = document.querySelector("title");
    if (!titleEl) return;

    function desiredTitle(): string {
      const current = document.title;
      const base = current.replace(/^\(\d+\+?\)\s*/, "");
      if (unread <= 0) return base;
      const label = unread > 99 ? "99+" : String(unread);
      return `(${label}) ${base}`;
    }

    function apply(): void {
      const next = desiredTitle();
      if (document.title !== next) document.title = next;
    }

    // Initial application (covers the case where Next.js metadata is
    // already in place by the time the effect runs).
    apply();

    // Re-apply whenever anything else mutates the title. This catches
    // Next.js's async metadata pipeline that runs after route changes.
    const observer = new MutationObserver(() => apply());
    observer.observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [unread, pathname]);

  return null;
}
