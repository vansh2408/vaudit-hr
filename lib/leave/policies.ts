/**
 * Leave-type policy helpers.
 *
 * Half-day eligibility is gated by leave-type *name* rather than a DB
 * column because the rule is editorial ("a half-day maternity leave makes
 * no operational sense") rather than data-driven. Keeping it inline as a
 * named set means the rule is visible alongside the API handler that
 * enforces it.
 *
 * If HR ever wants per-type half-day toggling, lift this into a
 * `leave_types.allow_half_day` column and migrate the set below into
 * default values.
 */

/**
 * Names of leave types where half-day requests are NOT permitted. Match
 * is case-insensitive to be forgiving of seed-data casing drift.
 */
const HALF_DAY_BLOCKED_TYPE_NAMES: ReadonlySet<string> = new Set(
  ["Maternity", "Paternity"].map((n) => n.toLowerCase()),
);

export function isHalfDayAllowedForLeaveType(typeName: string): boolean {
  return !HALF_DAY_BLOCKED_TYPE_NAMES.has(typeName.toLowerCase());
}
