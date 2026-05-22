/**
 * Calendar-date utilities.
 *
 * Calendar dates (leave dates, birthdays, holidays, employment-start dates)
 * are TZ-free: "May 10" means May 10 wherever you are. We model them as a
 * branded `Ymd` string ("YYYY-MM-DD") so the type system prevents accidental
 * conversion to/from JS `Date` (which is really an *instant*, not a date,
 * and silently shifts under TZ math).
 *
 * Use this module — never `new Date("YYYY-MM-DD")` or `d.toISOString().slice(0,10)`.
 * Those patterns are banned by eslint; see eslint.config.mjs.
 *
 * For instants (reviewedAt, createdAt, audit timestamps) use `lib/utils/timezone.ts`.
 */

const YMD_REGEX = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Branded YYYY-MM-DD string. Cannot be constructed from a plain string
 * without going through `parseYmd` (validation) or `unsafeYmd` (escape hatch
 * for trusted constants such as test fixtures).
 */
export type Ymd = string & { readonly __brand: "Ymd" };

/** Validate a string is YYYY-MM-DD and brand it. Throws on invalid input. */
export function parseYmd(s: string): Ymd {
  if (!YMD_REGEX.test(s)) {
    throw new Error(`Invalid Ymd: ${JSON.stringify(s)} (expected YYYY-MM-DD)`);
  }
  // Reject 2026-02-30 etc — regex passes but the date is bogus.
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const probe = new Date(y, m - 1, d);
  if (
    probe.getFullYear() !== y ||
    probe.getMonth() !== m - 1 ||
    probe.getDate() !== d
  ) {
    throw new Error(`Invalid Ymd: ${JSON.stringify(s)} (calendar date does not exist)`);
  }
  return s as Ymd;
}

/**
 * Escape hatch for cases where you have a string you KNOW is YYYY-MM-DD
 * (e.g. came from Drizzle's `mode: "string"` for a `date` column, or a
 * test fixture). Avoids the validation cost; do not use on user input.
 */
export function unsafeYmd(s: string): Ymd {
  return s as Ymd;
}

/**
 * Local-Date → Ymd. Uses LOCAL getters because the picker hands us a Date
 * at the user's local midnight for the day they actually clicked.
 *
 * Never use this on a Date that came from server JSON (those are instants,
 * not local dates) — extract Ymd at the server before serializing.
 */
export function localDateToYmd(d: Date): Ymd {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}` as Ymd;
}

/**
 * Ymd → Date at LOCAL midnight. For feeding into react-day-picker, working-
 * day iteration, etc. The returned Date is a local-midnight instant; its
 * absolute UTC moment depends on the runtime's TZ, but that's irrelevant
 * because we only ever read it back with local getters.
 */
export function ymdToLocalDate(s: Ymd): Date {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** Extract the year as a number. */
export function ymdYear(s: Ymd): number {
  return Number(s.slice(0, 4));
}

/** Compare two Ymd values. Negative if a < b, 0 if equal, positive if a > b. */
export function compareYmd(a: Ymd, b: Ymd): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Add (or subtract, with negative n) calendar days to an Ymd. */
export function addDays(s: Ymd, n: number): Ymd {
  const d = ymdToLocalDate(s);
  d.setDate(d.getDate() + n);
  return localDateToYmd(d);
}

/** Today as Ymd in the runtime's local TZ. */
export function todayYmd(): Ymd {
  return localDateToYmd(new Date());
}

/**
 * Format a Ymd for human display.
 *
 * Uses `Intl.DateTimeFormat` with the date parsed as a local Date — safe
 * because we never mix in a TZ. Pass `locale` to override; the default
 * undefined picks the runtime locale, which is what most UI wants.
 */
export function formatYmdHuman(
  s: Ymd,
  opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  },
  locale?: string,
): string {
  return new Intl.DateTimeFormat(locale, opts).format(ymdToLocalDate(s));
}

/**
 * Format a Ymd date range for human display, collapsing redundant parts:
 *   start === end                → "May 9, 2026"
 *   same month + year            → "May 9 – 10, 2026"
 *   same year, different month   → "May 30 – Jun 2, 2026"
 *   different year               → "Dec 30, 2026 – Jan 2, 2027"
 *
 * Reads only local Date components (`getFullYear`, `getMonth`, `getDate`) and
 * a month-name lookup via Intl, so the output is TZ-agnostic. The caller is
 * responsible for ordering — if `end < start` the range is rendered as given.
 */
export function formatYmdRange(start: Ymd, end: Ymd, locale?: string): string {
  if (start === end) {
    return formatYmdHuman(
      start,
      { month: "short", day: "numeric", year: "numeric" },
      locale,
    );
  }
  const s = ymdToLocalDate(start);
  const e = ymdToLocalDate(end);
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();

  if (sameMonth) {
    const head = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(s);
    return `${head} – ${e.getDate()}, ${e.getFullYear()}`;
  }
  if (sameYear) {
    const head = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(s);
    const tail = new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
    }).format(e);
    return `${head} – ${tail}, ${e.getFullYear()}`;
  }
  const head = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(s);
  const tail = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(e);
  return `${head} – ${tail}`;
}

/** True if a Ymd falls on Saturday or Sunday in the local calendar. */
export function isWeekendYmd(s: Ymd): boolean {
  const dow = ymdToLocalDate(s).getDay();
  return dow === 0 || dow === 6;
}

/** First day of the calendar month containing `s`. */
export function startOfMonth(s: Ymd): Ymd {
  return unsafeYmd(`${s.slice(0, 7)}-01`);
}

/** Last day of the calendar month containing `s`. */
export function endOfMonth(s: Ymd): Ymd {
  const d = ymdToLocalDate(s);
  // Day 0 of next month = last day of this month.
  return localDateToYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

/**
 * Monday of the week containing `s`. We anchor weeks to Monday because the
 * org operates on Mon–Fri work weeks; weekend chips render at the row edge.
 */
export function startOfWeek(s: Ymd): Ymd {
  const d = ymdToLocalDate(s);
  // getDay(): 0=Sun, 1=Mon, …, 6=Sat. Shift so Monday is 0.
  const fromMonday = (d.getDay() + 6) % 7;
  return addDays(s, -fromMonday);
}

/** Sunday of the week containing `s` (Monday-anchored week). */
export function endOfWeek(s: Ymd): Ymd {
  return addDays(startOfWeek(s), 6);
}

/**
 * Inclusive Ymd range as an array. Use for small spans (calendar grids,
 * working-day enumeration). Returns `[from]` when from === to.
 */
export function ymdRange(from: Ymd, to: Ymd): Ymd[] {
  if (compareYmd(from, to) > 0) return [];
  const out: Ymd[] = [];
  let cur = from;
  while (compareYmd(cur, to) <= 0) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}