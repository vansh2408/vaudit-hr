import { describe, it, expect } from "vitest";
import { calcWorkingDays, calcWorkingHalfDays } from "@/lib/leave/working-days";
import { unsafeYmd, type Ymd } from "@/lib/utils/dates";

// Trusted test-fixture constructor — same shape as the Drizzle date column
// returns. We don't call parseYmd here because these literals are known-good.
const y = (s: string): Ymd => unsafeYmd(s);

describe("calcWorkingDays", () => {
  it("counts a single weekday as 1", () => {
    const mon = y("2026-01-05"); // Mon
    expect(calcWorkingDays(mon, mon, [])).toBe(1);
  });

  it("returns 0 when start is a weekend single day", () => {
    const sat = y("2026-01-03");
    expect(calcWorkingDays(sat, sat, [])).toBe(0);
  });

  it("excludes weekends in a week-long range", () => {
    expect(calcWorkingDays(y("2026-01-05"), y("2026-01-11"), [])).toBe(5);
  });

  it("excludes holidays that fall on weekdays", () => {
    expect(
      calcWorkingDays(y("2026-01-05"), y("2026-01-09"), [y("2026-01-07")]),
    ).toBe(4);
  });

  it("does not double-discount a holiday that falls on a weekend", () => {
    expect(
      calcWorkingDays(y("2026-01-05"), y("2026-01-09"), [y("2026-01-10")]),
    ).toBe(5);
  });

  it("returns 0 when end < start", () => {
    expect(calcWorkingDays(y("2026-01-09"), y("2026-01-05"), [])).toBe(0);
  });

  it("is TZ-agnostic — same result regardless of process.env.TZ", () => {
    // This file is set up with TZ=America/Los_Angeles via tests/unit/setup.ts.
    // A correct calc returns 5; a buggy one that treats Ymd as a UTC instant
    // would shift one of the boundary days.
    expect(calcWorkingDays(y("2026-05-04"), y("2026-05-08"), [])).toBe(5);
  });
});

describe("calcWorkingHalfDays", () => {
  it("returns 2 half-days for a single full weekday", () => {
    const mon = y("2026-01-05");
    expect(calcWorkingHalfDays(mon, mon, [], false, null)).toBe(2);
  });

  it("returns 10 half-days for a five-day full-week range", () => {
    expect(
      calcWorkingHalfDays(y("2026-01-05"), y("2026-01-09"), [], false, null),
    ).toBe(10);
  });

  it("returns 1 half-day for a single-date half-day request on a weekday", () => {
    const mon = y("2026-01-05");
    expect(calcWorkingHalfDays(mon, mon, [], true, "FIRST_HALF")).toBe(1);
    expect(calcWorkingHalfDays(mon, mon, [], true, "SECOND_HALF")).toBe(1);
  });

  it("returns 0 for a half-day request on a weekend", () => {
    const sat = y("2026-01-03");
    expect(calcWorkingHalfDays(sat, sat, [], true, "FIRST_HALF")).toBe(0);
  });

  it("returns 0 for a half-day request on a public holiday", () => {
    const mon = y("2026-01-05");
    expect(calcWorkingHalfDays(mon, mon, [mon], true, "FIRST_HALF")).toBe(0);
  });

  it("excludes weekends in full-day-range mode", () => {
    // Mon-Sun span — 5 weekdays = 10 half-day units.
    expect(
      calcWorkingHalfDays(y("2026-01-05"), y("2026-01-11"), [], false, null),
    ).toBe(10);
  });

  it("excludes holidays in full-day-range mode", () => {
    // 4 weekdays * 2 = 8 (the holiday on Wed drops Mon-Fri to 4).
    expect(
      calcWorkingHalfDays(
        y("2026-01-05"),
        y("2026-01-09"),
        [y("2026-01-07")],
        false,
        null,
      ),
    ).toBe(8);
  });
});