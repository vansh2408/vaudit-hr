/**
 * Tests for `timingSafeEqualString`.
 *
 * The cron Bearer comparison must be:
 *   - Constant-time on equal-length inputs (we trust node:crypto for this).
 *   - Defensive against the obvious foot-guns: empty inputs, non-strings,
 *     length mismatches.
 *
 * We do NOT measure timing here — that requires a statistical setup well
 * outside vitest's wheelhouse. We exercise the *correctness* surface and
 * leave timing assertions to manual review of the implementation.
 */
import { describe, it, expect } from "vitest";
import { timingSafeEqualString } from "@/lib/security/constant-time";

describe("timingSafeEqualString", () => {
  it("returns true for two equal non-empty strings", () => {
    expect(timingSafeEqualString("hunter2", "hunter2")).toBe(true);
  });

  it("returns false for two different strings of the same length", () => {
    expect(timingSafeEqualString("aaaaaa", "bbbbbb")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(timingSafeEqualString("short", "longerstring")).toBe(false);
    expect(timingSafeEqualString("longerstring", "short")).toBe(false);
  });

  it("returns false when either side is an empty string", () => {
    // Critical guard: prevents `process.env.X` being undefined → coerced
    // to "" → matching an attacker-supplied empty Authorization header.
    expect(timingSafeEqualString("", "")).toBe(false);
    expect(timingSafeEqualString("", "secret")).toBe(false);
    expect(timingSafeEqualString("secret", "")).toBe(false);
  });

  it("returns false (not throw) when passed non-string values", () => {
    // The typeof guard at the top of the function rejects non-strings.
    // We pass `unknown` via a deliberate cast to exercise that runtime
    // path without disabling strict typing.
    const cmp = (a: unknown, b: unknown): boolean =>
      timingSafeEqualString(a as string, b as string);
    expect(cmp(null, "x")).toBe(false);
    expect(cmp("x", null)).toBe(false);
    expect(cmp(undefined, undefined)).toBe(false);
    expect(cmp(0, 0)).toBe(false);
    expect(cmp({}, {})).toBe(false);
  });

  it("handles BMP unicode strings correctly", () => {
    // Multi-byte UTF-8 — Buffer.from(..., 'utf8') is used internally,
    // so the comparison is over bytes, not code points. Equal source =
    // equal bytes.
    expect(timingSafeEqualString("héllo café", "héllo café")).toBe(true);
    expect(timingSafeEqualString("héllo café", "héllo cafe")).toBe(false);
  });

  it("handles surrogate-pair unicode (e.g. emoji)", () => {
    // "🔒" is U+1F512, a surrogate pair in UTF-16 / 4 bytes in UTF-8.
    expect(timingSafeEqualString("hello 🔒", "hello 🔒")).toBe(true);
    expect(timingSafeEqualString("hello 🔒", "hello 🔓")).toBe(false);
  });

  it("returns false for strings that only differ in trailing whitespace", () => {
    // No magic trim — callers must handle whitespace upstream.
    expect(timingSafeEqualString("secret", "secret ")).toBe(false);
  });
});
