/**
 * Instant display in the organization's timezone.
 *
 * Instants (createdAt, reviewedAt, audit timestamps) are absolute moments
 * stored as PG `timestamptz` and transmitted as ISO 8601 strings with `Z`.
 * They MUST be formatted with an explicit `timeZone` — never relying on
 * the runtime default — because the runtime is the browser or Node, both
 * of which differ from the org's chosen display TZ.
 *
 * For now we display everything in a single org-wide TZ (`Asia/Bangkok` /
 * ICT) because most employees are there. A few IST employees see times
 * 1h30m ahead of their wall clock — acceptable for v1.
 *
 * To go per-user later: add `users.timezone` (IANA), thread the value
 * through to these helpers as an override, and keep `ORG_TZ` as the
 * fallback for unauthenticated / unknown viewers (e.g. emails).
 *
 * For calendar dates (no TZ), use `lib/utils/dates.ts` instead.
 */

/**
 * IANA timezone name. Single source of truth — change this one constant if
 * the org HQ moves.
 */
export const ORG_TZ = "Asia/Bangkok" as const;

const DEFAULT_DATETIME_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

const DEFAULT_DATE_OPTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

/**
 * Format an ISO instant for display in the org TZ.
 * Accepts ISO 8601 string or a Date object (treated as instant).
 */
export function formatInstant(
  instant: string | Date,
  opts: Intl.DateTimeFormatOptions = DEFAULT_DATETIME_OPTS,
  locale?: string,
): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat(locale, {
    ...opts,
    timeZone: ORG_TZ,
  }).format(date);
}

/** Format only the date portion of an instant in ORG_TZ. */
export function formatInstantDate(
  instant: string | Date,
  locale?: string,
): string {
  return formatInstant(instant, DEFAULT_DATE_OPTS, locale);
}

/**
 * Coarse relative time ("just now", "5m ago", "2h ago", "3d ago", or full
 * date for older). Anchored to "now" on every call. Suitable for
 * notification timestamps, audit log "when" columns, etc.
 */
export function formatRelative(instant: string | Date, locale?: string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return formatInstantDate(date, locale);
}
