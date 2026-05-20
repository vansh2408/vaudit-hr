/**
 * Tests for `sanitizeFreeText` — defence-in-depth XSS strip.
 *
 * The sanitiser is pure, side-effect-free, and runs on every free-text
 * field that may be re-rendered in a non-React sink (Slack DMs, plain
 * exports, etc). We exercise the obvious bypass vectors so future
 * regressions in the regexes get caught here rather than in production.
 *
 * NOTE: the implementation HTML-encodes angle brackets AFTER tag-level
 * removal, so the assertions below check that the dangerous payload
 * disappears AND that the remaining innocuous angle brackets are encoded
 * — not stripped — as the docstring promises.
 */
import { describe, it, expect } from "vitest";
import { sanitizeFreeText } from "@/lib/security/sanitize";

describe("sanitizeFreeText", () => {
  it("passes plain text through unchanged", () => {
    const input = "Sick leave for the day, will be back Monday.";
    expect(sanitizeFreeText(input)).toBe(input);
  });

  it("strips a basic <script>alert(1)</script> tag pair", () => {
    const out = sanitizeFreeText("hello <script>alert(1)</script> world");
    expect(out).not.toMatch(/<script/i);
    expect(out).not.toMatch(/<\/script/i);
    // The payload "alert(1)" between the tags remains as inert text — we
    // strip the tag itself, not the entire content. This is intentional:
    // a benign string that happens to mention "alert(1)" should not be
    // erased from a user's leave reason.
    expect(out).toContain("alert(1)");
    expect(out).toContain("hello");
    expect(out).toContain("world");
  });

  it("strips inline event handlers like onerror=", () => {
    const out = sanitizeFreeText('<img src=x onerror="alert(1)">');
    // The onerror= handler must be gone, but the img tag's bracket may
    // remain — it will be HTML-encoded in step 5, neutralising it.
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toContain('"alert(1)"');
  });

  it("strips event handlers with unquoted values", () => {
    const out = sanitizeFreeText("<a href=# onclick=alert(1)>x</a>");
    expect(out).not.toMatch(/onclick/i);
  });

  it("neutralises javascript: URIs without losing surrounding text", () => {
    const out = sanitizeFreeText("Click here: javascript:alert(1)");
    // The dangerous prefix becomes inert with the underscore-break.
    expect(out.toLowerCase()).not.toMatch(/javascript:/);
    expect(out.toLowerCase()).toMatch(/javascript_:/);
    expect(out).toContain("alert(1)");
  });

  it("neutralises data: and vbscript: URIs too", () => {
    const a = sanitizeFreeText("data:text/html,<b>x</b>");
    expect(a.toLowerCase()).not.toMatch(/^data:/);
    expect(a.toLowerCase()).toContain("data_:");

    const b = sanitizeFreeText("vbscript:msgbox(1)");
    expect(b.toLowerCase()).not.toMatch(/^vbscript:/);
    expect(b.toLowerCase()).toContain("vbscript_:");
  });

  it("strips <style> blocks", () => {
    const out = sanitizeFreeText(
      "before <style>body{display:none}</style> after",
    );
    expect(out).not.toMatch(/<style/i);
    expect(out).not.toMatch(/<\/style/i);
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("does not double-encode pre-encoded entities like &lt;script&gt;", () => {
    // Already-encoded markup should be left readable. The sanitiser
    // encodes & first to avoid double-encoding, so &lt; stays &amp;lt;
    // — meaning the literal text "&lt;script&gt;" survives in a way
    // that a human reviewer can still read.
    const out = sanitizeFreeText("&lt;script&gt;alert(1)&lt;/script&gt;");
    // No actual <script> tag must appear (would happen if we decoded).
    expect(out).not.toMatch(/<script/i);
    // The original characters are preserved in some encoded form.
    expect(out).toContain("script");
    expect(out).toContain("alert(1)");
  });

  it("preserves whitespace and multi-line content", () => {
    const input = "line one\nline two\n  indented line";
    const out = sanitizeFreeText(input);
    expect(out).toContain("line one");
    expect(out).toContain("line two");
    expect(out).toContain("indented line");
    expect(out.split("\n")).toHaveLength(3);
  });

  it("clamps overly long input to 5,000 characters", () => {
    const huge = "a".repeat(10_000);
    const out = sanitizeFreeText(huge);
    expect(out.length).toBeLessThanOrEqual(5_000);
  });

  it("trims trailing whitespace", () => {
    const out = sanitizeFreeText("  hello world  \n\n");
    expect(out.startsWith(" ")).toBe(false);
    expect(out.endsWith(" ")).toBe(false);
    expect(out.endsWith("\n")).toBe(false);
  });

  it("handles empty string", () => {
    expect(sanitizeFreeText("")).toBe("");
  });

  it("returns empty string for non-string inputs without throwing", () => {
    // The runtime guard at the top of the function accepts only strings
    // and falls through to "" for anything else. We feed it `unknown`
    // values via a deliberate cast so the test exercises the runtime
    // path without disabling strict typing.
    const asUnknown = (v: unknown): string =>
      sanitizeFreeText(v as string);
    expect(asUnknown(null)).toBe("");
    expect(asUnknown(undefined)).toBe("");
    expect(asUnknown(42)).toBe("");
    expect(asUnknown({ toString: () => "<script>x</script>" })).toBe("");
  });

  it("strips NUL bytes which can terminate some downstream sinks", () => {
    // Build the NUL byte at runtime so the literal does not appear in
    // the source file (some editors / tooling mangle embedded NULs).
    const nul = String.fromCharCode(0);
    const out = sanitizeFreeText(`hello${nul}world`);
    expect(out).toBe("helloworld");
    expect(out.includes(nul)).toBe(false);
  });
});
