import { describe, it, expect } from "vitest";
import {
  FULL_DAY_UNITS,
  HALF_DAY_UNITS,
  formatDays,
  formatDaysWithSlot,
  halfDaySlotLabel,
  isHalfDaySlot,
} from "@/lib/utils/format-days";

describe("formatDays", () => {
  it("renders 0 half-days as '0 days'", () => {
    expect(formatDays(0)).toBe("0 days");
  });

  it("renders 1 half-day as 'Half day'", () => {
    expect(formatDays(1)).toBe("Half day");
  });

  it("renders 2 half-days as '1 day'", () => {
    expect(formatDays(2)).toBe("1 day");
  });

  it("renders 3 half-days as '1.5 days'", () => {
    expect(formatDays(3)).toBe("1.5 days");
  });

  it("renders 10 half-days as '5 days'", () => {
    expect(formatDays(10)).toBe("5 days");
  });

  it("renders 11 half-days as '5.5 days'", () => {
    expect(formatDays(11)).toBe("5.5 days");
  });

  it("clamps negative inputs to 0", () => {
    expect(formatDays(-3)).toBe("0 days");
  });

  it("floors fractional inputs (defensive — units are always integer)", () => {
    expect(formatDays(2.9)).toBe("1 day");
  });
});

describe("formatDaysWithSlot", () => {
  it("appends the slot label when slot is set", () => {
    expect(formatDaysWithSlot(1, "FIRST_HALF")).toBe("Half day · Morning");
    expect(formatDaysWithSlot(1, "SECOND_HALF")).toBe("Half day · Afternoon");
  });

  it("falls back to formatDays when slot is null", () => {
    expect(formatDaysWithSlot(2, null)).toBe("1 day");
  });
});

describe("halfDaySlotLabel", () => {
  it("maps FIRST_HALF to Morning", () => {
    expect(halfDaySlotLabel("FIRST_HALF")).toBe("Morning");
  });
  it("maps SECOND_HALF to Afternoon", () => {
    expect(halfDaySlotLabel("SECOND_HALF")).toBe("Afternoon");
  });
});

describe("isHalfDaySlot", () => {
  it("accepts the two valid values", () => {
    expect(isHalfDaySlot("FIRST_HALF")).toBe(true);
    expect(isHalfDaySlot("SECOND_HALF")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isHalfDaySlot(null)).toBe(false);
    expect(isHalfDaySlot(undefined)).toBe(false);
    expect(isHalfDaySlot("")).toBe(false);
    expect(isHalfDaySlot("MORNING")).toBe(false);
    expect(isHalfDaySlot(1)).toBe(false);
  });
});

describe("FULL_DAY_UNITS / HALF_DAY_UNITS sanity", () => {
  it("equals 2 / 1 respectively", () => {
    expect(FULL_DAY_UNITS).toBe(2);
    expect(HALF_DAY_UNITS).toBe(1);
  });
});
