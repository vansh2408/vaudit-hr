import { describe, expect, it } from "vitest";

import {
  formatYmdRange,
  isWeekendYmd,
  unsafeYmd,
} from "@/lib/utils/dates";

describe("formatYmdRange", () => {
  // Locale is pinned to en-US so the test is deterministic regardless of the
  // host's locale. Production callers pass `undefined` and pick up the user's
  // locale, which is the intent for UI.
  const LOCALE = "en-US";

  it("collapses a single-day range to one date", () => {
    expect(formatYmdRange(unsafeYmd("2026-05-11"), unsafeYmd("2026-05-11"), LOCALE))
      .toBe("May 11, 2026");
  });

  it("renders same-month ranges as 'May 9 – 10, 2026'", () => {
    expect(formatYmdRange(unsafeYmd("2026-05-09"), unsafeYmd("2026-05-10"), LOCALE))
      .toBe("May 9 – 10, 2026");
  });

  it("renders same-year, different-month ranges with both months", () => {
    expect(formatYmdRange(unsafeYmd("2026-05-30"), unsafeYmd("2026-06-02"), LOCALE))
      .toBe("May 30 – Jun 2, 2026");
  });

  it("renders cross-year ranges with both years", () => {
    expect(formatYmdRange(unsafeYmd("2026-12-30"), unsafeYmd("2027-01-02"), LOCALE))
      .toBe("Dec 30, 2026 – Jan 2, 2027");
  });
});

describe("isWeekendYmd", () => {
  // May 9, 2026 is Saturday; May 10 is Sunday; May 11 is Monday.
  it("flags Saturday", () => {
    expect(isWeekendYmd(unsafeYmd("2026-05-09"))).toBe(true);
  });
  it("flags Sunday", () => {
    expect(isWeekendYmd(unsafeYmd("2026-05-10"))).toBe(true);
  });
  it("does not flag Monday", () => {
    expect(isWeekendYmd(unsafeYmd("2026-05-11"))).toBe(false);
  });
  it("does not flag Friday", () => {
    // May 8 2026 is Friday
    expect(isWeekendYmd(unsafeYmd("2026-05-08"))).toBe(false);
  });
});