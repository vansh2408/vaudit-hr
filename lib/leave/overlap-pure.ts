/**
 * Pure conflict-test for overlap detection — split from overlap.ts so that
 * unit tests importing this module don't transitively pull in @/lib/db
 * (which requires DATABASE_URL at import time).
 *
 * See lib/leave/overlap.ts for the DB-querying entry point findOverlap;
 * this file holds the half-day-aware logic that decides whether two
 * already-intersecting requests are actually a conflict.
 */
import type { Ymd } from "@/lib/utils/dates";
import { compareYmd } from "@/lib/utils/dates";
import type { HalfDaySlot } from "@/lib/utils/format-days";

export function rowsConflict(
  a: { startDate: Ymd; endDate: Ymd; isHalfDay: boolean; halfDaySlot: HalfDaySlot | null },
  b: { startDate: Ymd; endDate: Ymd; isHalfDay: boolean; halfDaySlot: HalfDaySlot | null },
): boolean {
  // Neither side is half-day → any range overlap is a conflict.
  if (!a.isHalfDay && !b.isHalfDay) return true;

  // Half-day requests are single-date by construction. The "ranges
  // intersect" pre-filter applied by findOverlap is enough to know the
  // dates also match if BOTH sides are half-day.
  if (a.isHalfDay && b.isHalfDay) {
    if (compareYmd(a.startDate, b.startDate) !== 0) return false;
    return a.halfDaySlot === b.halfDaySlot;
  }

  // One half-day, one full-day. The full-day side's range covers the
  // half-day date by the pre-filter ⇒ always a conflict (you can't take
  // a half-day off a date you're already fully off).
  return true;
}
