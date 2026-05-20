/**
 * Working-days calculator — decisions.md A1.
 *
 * Counts inclusive weekdays (Mon-Fri) between `start` and `end`, minus any
 * date matching one of the provided holidays.
 *
 * Operates entirely on `Ymd` calendar-date strings ("YYYY-MM-DD"), so the
 * count is TZ-agnostic — the result is the same whether the calc runs on
 * a server in UTC, a browser in IST, or a CI worker in LA. See
 * lib/utils/dates.ts for the `Ymd` type.
 *
 * Internal unit (0006): callers now usually want HALF-DAYS — see
 * calcWorkingHalfDays below, which is the function consumed by the API
 * routes. calcWorkingDays remains exported for legacy callers and for the
 * internal multiplication.
 */

import { compareYmd, ymdToLocalDate, type Ymd } from "@/lib/utils/dates";
import type { HalfDaySlot } from "@/lib/utils/format-days";
import { FULL_DAY_UNITS, HALF_DAY_UNITS } from "@/lib/utils/format-days";

const SATURDAY = 6;
const SUNDAY = 0;

/**
 * Inclusive count of working days between start and end.
 * Returns 0 if end < start. Holidays falling on a weekend do not
 * double-discount.
 */
export function calcWorkingDays(
  start: Ymd,
  end: Ymd,
  holidays: ReadonlyArray<Ymd>,
): number {
  if (compareYmd(end, start) < 0) return 0;
  const holidaySet = new Set<string>(holidays);

  // Iterate by incrementing a local-Date cursor (cheap, no TZ surprises
  // because we only read .getDay() which is local). Comparing day-of-week
  // by name avoids any DST ambiguity at the boundary of a range.
  const startDate = ymdToLocalDate(start);
  const endDate = ymdToLocalDate(end);
  let count = 0;
  const cursor = new Date(startDate);
  while (cursor.getTime() <= endDate.getTime()) {
    const dow = cursor.getDay();
    const isWeekend = dow === SATURDAY || dow === SUNDAY;
    if (!isWeekend) {
      const cursorYmd =
        `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      if (!holidaySet.has(cursorYmd)) count += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/**
 * Working-day count in HALF-DAY UNITS — the canonical unit used by the
 * leave/WFH stack after the 0006 unit shift.
 *
 * Multi-day range (isHalfDay = false): 2 × calcWorkingDays(...).
 * Half-day single date (isHalfDay = true, start === end): returns 1 if
 * the date is a working weekday and not a holiday, else 0.
 *
 * Callers must reject a 0 result as "no working days in range" before
 * persisting — same contract as calcWorkingDays.
 */
export function calcWorkingHalfDays(
  start: Ymd,
  end: Ymd,
  holidays: ReadonlyArray<Ymd>,
  isHalfDay: boolean,
  slot: HalfDaySlot | null,
): number {
  if (isHalfDay) {
    // Half-day is single-date only. If a caller misuses this with start
    // !== end, fall through to the full-day calc — defensive but they
    // should also be rejected by Zod / the DB CHECK constraint.
    if (compareYmd(end, start) !== 0) {
      return calcWorkingDays(start, end, holidays) * FULL_DAY_UNITS;
    }
    void slot; // accepted for symmetry; doesn't affect the count
    const fullDayCount = calcWorkingDays(start, end, holidays);
    return fullDayCount > 0 ? HALF_DAY_UNITS : 0;
  }
  return calcWorkingDays(start, end, holidays) * FULL_DAY_UNITS;
}