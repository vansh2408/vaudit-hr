/**
 * Human-friendly formatting of half-day-unit counts (0006 unit shift).
 *
 * Internally all leave / WFH day-counts are stored as integer "half-days":
 *   - 1 unit  = half a working day
 *   - 2 units = one full working day
 *
 * Always format day-counts through `formatDays` so the UI never leaks the
 * internal unit. Direct interpolation of `totalDays` into copy is a bug.
 *
 * Examples:
 *   formatDays(0) → "0 days"
 *   formatDays(1) → "Half day"
 *   formatDays(2) → "1 day"
 *   formatDays(3) → "1.5 days"
 *   formatDays(4) → "2 days"
 *   formatDays(5) → "2.5 days"
 */

export type HalfDaySlot = "FIRST_HALF" | "SECOND_HALF";

export function isHalfDaySlot(value: unknown): value is HalfDaySlot {
  return value === "FIRST_HALF" || value === "SECOND_HALF";
}

/** Human label for the slot. Aligned with the UI radio labels. */
export function halfDaySlotLabel(slot: HalfDaySlot): "Morning" | "Afternoon" {
  return slot === "FIRST_HALF" ? "Morning" : "Afternoon";
}

/**
 * Format an integer half-day count as a human day-count string.
 * Negative inputs are clamped to 0.
 */
export function formatDays(halfDays: number): string {
  const n = Math.max(0, Math.floor(halfDays));
  if (n === 0) return "0 days";
  if (n === 1) return "Half day";
  if (n === 2) return "1 day";
  // n >= 3: render as X or X.5
  const fullDays = Math.floor(n / 2);
  const hasHalf = n % 2 === 1;
  if (!hasHalf) return `${fullDays} days`;
  return `${fullDays}.5 days`;
}

/**
 * Format the day count *with* an optional half-day-slot annotation for
 * detail views ("Half day · Morning"). Falls back to formatDays() when no
 * slot is supplied.
 */
export function formatDaysWithSlot(
  halfDays: number,
  slot: HalfDaySlot | null | undefined,
): string {
  const base = formatDays(halfDays);
  if (!slot) return base;
  return `${base} · ${halfDaySlotLabel(slot)}`;
}

/** Convenience: full half-day count for a single full working day. */
export const FULL_DAY_UNITS = 2;
/** Convenience: half-day count for a half-day request. */
export const HALF_DAY_UNITS = 1;
