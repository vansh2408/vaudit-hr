/**
 * Unified notification fan-out — decisions.md A2.
 *
 * `notifyEmployee` writes the in-app row AND attempts a Slack DM.
 * Slack errors are swallowed so they never block the DB write.
 *
 * Slack body formatting — threat-model T12 — when the caller supplies
 * `userContent` (free-text the originator typed, e.g. leave reason /
 * reviewer note), it is appended to the Slack DM wrapped in a triple-
 * backtick code fence via `formatSlackUserContent`. The in-app row keeps
 * the system-composed `message` only — sanitisation already happened on
 * the way in to the DB, and React escapes the output, so we do not
 * double-encode for the in-app surface.
 */
import { db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";
import { sendSlackDm } from "@/lib/slack/client";
import { formatSlackUserContent } from "@/lib/slack/format";

export interface NotifyOptions {
  employeeId: string;
  slackUserId?: string | null;
  type: string;
  message: string;
  link?: string | null;
  /**
   * Free-text supplied by a user (leave reason, reviewer note). When set,
   * the Slack DM body appends a fenced block so Slack renders it as
   * preformatted text (no mention expansion / auto-linking).
   */
  userContent?: string | null;
}

export async function notifyEmployee(opts: NotifyOptions): Promise<void> {
  await db.insert(notifications).values({
    employeeId: opts.employeeId,
    type: opts.type,
    message: opts.message,
    link: opts.link ?? null,
  });

  if (opts.slackUserId) {
    try {
      const fenced =
        typeof opts.userContent === "string" && opts.userContent.length > 0
          ? formatSlackUserContent(opts.userContent)
          : "";
      const slackText = fenced.length > 0 ? `${opts.message}\n${fenced}` : opts.message;
      await sendSlackDm({ userId: opts.slackUserId, text: slackText });
    } catch {
      // Per A2: Slack failures must never block the DB write.
    }
  }
}
