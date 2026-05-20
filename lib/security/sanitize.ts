/**
 * Conservative free-text sanitiser.
 *
 * Goal: defend against XSS-by-storage. Any user-supplied free-text field
 * that may be re-rendered (leave reason, reviewer note, employee address,
 * notification message, etc.) passes through `sanitizeFreeText` BEFORE it
 * touches the DB. The output is a plain string with no tags and no
 * dangerous URI schemes — safe to render as text content in either React
 * (which already escapes) or in Slack messages / emails (which do not).
 *
 * This is a defence-in-depth layer; it is NOT a replacement for proper
 * output encoding. React's JSX escaping still handles the primary XSS
 * vector. We sanitise on input as well to prevent stored XSS reaching
 * non-React sinks (Slack DM bodies, plain-text exports, email previews).
 */

const SCRIPT_TAG_RE = /<\s*\/?\s*script\b[^>]*>/gi;
const STYLE_TAG_RE = /<\s*\/?\s*style\b[^>]*>/gi;
const EVENT_HANDLER_RE = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_URI_RE = /(?:javascript|data|vbscript)\s*:/gi;

/**
 * Strip/encode the obvious XSS vectors from arbitrary user free-text.
 *
 * Operations, in order:
 *   1. Drop NUL bytes (some sinks treat them as string terminators).
 *   2. Remove `<script>` / `</script>` and `<style>` tag fragments entirely
 *      (even malformed ones — the regex is permissive on whitespace).
 *   3. Strip inline `on*=` event handlers (e.g. `onclick="..."`).
 *   4. Neutralise `javascript:`, `data:`, `vbscript:` URI schemes by
 *      inserting a zero-width-safe break (`javascript_:`); we do not just
 *      delete the prefix so legitimate text like "javascript: a language"
 *      is preserved in readable form for human reviewers.
 *   5. HTML-encode angle brackets so any remaining `<…>` becomes inert
 *      `&lt;…&gt;` even when later rendered by a non-escaping consumer.
 *   6. Collapse trailing whitespace and clamp length to 5,000 chars (more
 *      than enough for reasons / notes / addresses; defends against
 *      pathological inputs).
 */
export function sanitizeFreeText(input: string): string {
  if (typeof input !== "string") return "";

  let out = input;

  // 1. NUL bytes.
  out = out.replace(/\0/g, "");

  // 2. Tag-level removals.
  out = out.replace(SCRIPT_TAG_RE, "");
  out = out.replace(STYLE_TAG_RE, "");

  // 3. Event handlers anywhere in the text.
  out = out.replace(EVENT_HANDLER_RE, "");

  // 4. Dangerous URI schemes — neutralise rather than delete.
  out = out.replace(DANGEROUS_URI_RE, (match) => {
    // Insert underscore before colon: "javascript:" -> "javascript_:"
    return match.replace(/:$/, "").replace(/:\s*$/, "") + "_:";
  });

  // 5. HTML-encode angle brackets + ampersands (encode & first so we don't
  //    double-encode the entities we just produced).
  out = out
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 6. Trim + clamp.
  out = out.trim();
  if (out.length > 5_000) {
    out = out.slice(0, 5_000);
  }

  return out;
}
