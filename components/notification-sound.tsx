"use client";

import * as React from "react";

import { useRecentNotifications } from "@/components/notifications-data";

const NOTIFICATION_SOUND_SRC = "/sounds/notification.wav";

/**
 * Plays a short "ding" whenever the unread count INCREASES — the Slack /
 * Gmail "new message" cue. Renders NOTHING into the DOM; the HTMLAudioElement
 * is constructed imperatively in an effect so we avoid the SSR / hydration
 * quirks that can come with `<audio>` JSX, and the component reads as a
 * side-effect component (mirrors `<TitleBadge />`).
 *
 * Wired to the same shared `useRecentNotifications` query as the navbar
 * bell, sidebar badge and `<TitleBadge />` — single source of truth,
 * single polling timer.
 *
 * Important quirks:
 *  - First mount with N already-unread rows must NOT ping N times. The
 *    `lastSeen.current === null` branch establishes a baseline silently.
 *  - Browser autoplay policy rejects `audio.play()` until the user has
 *    interacted with the page at least once. We swallow the rejection
 *    silently — the first ping on a freshly-opened tab may be lost, but
 *    every subsequent one (after any click/keypress) works.
 *  - Mark-read flows decrement `unread`; the increase-only check below
 *    prevents a ping on those transitions.
 */
export function NotificationSound(): null {
  const { unread } = useRecentNotifications();
  const lastSeen = React.useRef<number | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  // Lazily construct the Audio element on first client-side render. Doing
  // this in an effect (instead of `useState(() => new Audio(...))`) keeps
  // the constructor strictly client-only — `Audio` doesn't exist in the
  // SSR environment.
  React.useEffect(() => {
    if (audioRef.current !== null) return;
    if (typeof window === "undefined") return;
    const a = new Audio(NOTIFICATION_SOUND_SRC);
    a.preload = "auto";
    audioRef.current = a;
  }, []);

  React.useEffect(() => {
    if (lastSeen.current === null) {
      // Baseline — set without playing so we don't ping for pre-existing
      // unread rows on the first render of a session.
      lastSeen.current = unread;
      return;
    }
    if (unread > lastSeen.current) {
      const a = audioRef.current;
      if (a) {
        // Reset to the start so rapid back-to-back notifications still
        // trigger an audible ping even if the previous play() is mid-clip.
        a.currentTime = 0;
        void a.play().catch(() => {
          // Autoplay policy or absent file — silent failure is the right
          // UX. The badge + tab title still convey the unread state.
        });
      }
    }
    lastSeen.current = unread;
  }, [unread]);

  return null;
}
