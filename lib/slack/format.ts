/**
 * Slack message formatting helpers — threat-model T12.
 *
 * User-supplied free-text (leave reason, reviewer note) flows verbatim
 * into Slack DM bodies. Even after `sanitizeFreeText` strips angle
 * brackets and event handlers, an attacker can still write content like
 *
 *   "<@U_HR_ADMIN> APPROVED by SYSTEM"
 *
 * which Slack will render as a real user mention. To make impersonation
 * visually obvious, we wrap user-supplied content in a code-fence block
 * (triple backtick). Slack renders the content inside the fence as
 * plain monospace text — no mention expansion, no link auto-linking,
 * no emoji substitution.
 *
 * Triple-backticks inside the user content are escaped with a zero-width
 * space so the fence cannot be closed early.
 */

const TRIPLE_BACKTICK_RE = /```/g;

/**
 * Wrap user-supplied free-text for safe inclusion in a Slack message.
 * Returns the input unchanged when it's empty / whitespace so callers
 * can short-circuit (`if (!s) ...`).
 *
 * Output shape:
 *   ```
 *   <user content with triple-backticks neutralised>
 *   ```
 *
 * The wrapping fence guarantees Slack renders the content as preformatted
 * text — no mentions, no auto-links, no markdown expansion.
 */
export function formatSlackUserContent(s: string): string {
  if (typeof s !== "string") return "";
  const trimmed = s.trim();
  if (trimmed.length === 0) return "";
  // Neutralise inner triple-backticks so the fence is unbreakable.
  // U+200B (zero-width space) keeps the visible text intact.
  const safe = trimmed.replace(TRIPLE_BACKTICK_RE, "`​`​`");
  return `\`\`\`\n${safe}\n\`\`\``;
}
