import { describe, it, expect } from "vitest";
import { rowsConflict } from "@/lib/leave/overlap-pure";
import { unsafeYmd, type Ymd } from "@/lib/utils/dates";

const y = (s: string): Ymd => unsafeYmd(s);

// Shorthand row builder for readability.
function full(start: string, end: string): {
  startDate: Ymd;
  endDate: Ymd;
  isHalfDay: boolean;
  halfDaySlot: null;
} {
  return { startDate: y(start), endDate: y(end), isHalfDay: false, halfDaySlot: null };
}

function half(
  date: string,
  slot: "FIRST_HALF" | "SECOND_HALF",
): {
  startDate: Ymd;
  endDate: Ymd;
  isHalfDay: boolean;
  halfDaySlot: "FIRST_HALF" | "SECOND_HALF";
} {
  return { startDate: y(date), endDate: y(date), isHalfDay: true, halfDaySlot: slot };
}

describe("rowsConflict — full × full", () => {
  it("overlapping ranges conflict", () => {
    // findOverlap's SQL pre-filter only invokes rowsConflict on rows whose
    // ranges already intersect, so this case represents the post-filter
    // result for full × full.
    expect(rowsConflict(full("2026-06-08", "2026-06-12"), full("2026-06-10", "2026-06-14"))).toBe(true);
  });

  it("contiguous-but-shared boundary still conflicts", () => {
    // Mon-Wed + Wed-Fri share Wednesday → conflict.
    expect(rowsConflict(full("2026-06-08", "2026-06-10"), full("2026-06-10", "2026-06-12"))).toBe(true);
  });
});

describe("rowsConflict — half × half", () => {
  it("same date, same slot conflicts", () => {
    expect(rowsConflict(half("2026-06-08", "FIRST_HALF"), half("2026-06-08", "FIRST_HALF"))).toBe(true);
    expect(rowsConflict(half("2026-06-08", "SECOND_HALF"), half("2026-06-08", "SECOND_HALF"))).toBe(true);
  });

  it("same date, different slot does NOT conflict", () => {
    // The whole point of half-day support — morning leave + afternoon WFH
    // on the same day must coexist.
    expect(rowsConflict(half("2026-06-08", "FIRST_HALF"), half("2026-06-08", "SECOND_HALF"))).toBe(false);
    expect(rowsConflict(half("2026-06-08", "SECOND_HALF"), half("2026-06-08", "FIRST_HALF"))).toBe(false);
  });

  it("different dates do not conflict (defensive — pre-filter usually drops these)", () => {
    expect(rowsConflict(half("2026-06-08", "FIRST_HALF"), half("2026-06-09", "FIRST_HALF"))).toBe(false);
  });
});

describe("rowsConflict — full × half (one of each side)", () => {
  it("a half-day inside a full-day range conflicts", () => {
    // Full Mon-Fri + half-day morning on Wed → conflict.
    expect(rowsConflict(full("2026-06-08", "2026-06-12"), half("2026-06-10", "FIRST_HALF"))).toBe(true);
    expect(rowsConflict(half("2026-06-10", "SECOND_HALF"), full("2026-06-08", "2026-06-12"))).toBe(true);
  });

  it("a half-day on the start-of-range date conflicts", () => {
    expect(rowsConflict(half("2026-06-08", "FIRST_HALF"), full("2026-06-08", "2026-06-12"))).toBe(true);
  });

  it("a half-day on the end-of-range date conflicts", () => {
    expect(rowsConflict(half("2026-06-12", "SECOND_HALF"), full("2026-06-08", "2026-06-12"))).toBe(true);
  });
});
