/**
 * /api/cron/birthdays
 *  POST (Bearer CRON_SECRET) — sends one Slack DM per HR_ADMIN birthday
 *  match. Auth via constant-time comparison against CRON_SECRET env var.
 *
 * Filters: users.birthday equals today's MM-DD AND users.isActive = true.
 * Birthday DMs go to the single configured HR_ADMIN Slack user
 * (`SLACK_HR_ADMIN_SLACK_USER_ID`). SUPER_ADMINs never receive these (A11).
 *
 * Scheduling (2026-05-20): this endpoint is invoked daily by a Google
 * Apps Script trigger. Set up by creating a time-based trigger in the
 * Apps Script project that runs a function like:
 *
 *   function pingHrBirthdays() {
 *     UrlFetchApp.fetch("https://<your-host>/api/cron/birthdays", {
 *       method: "post",
 *       headers: { Authorization: "Bearer " + PROD_CRON_SECRET },
 *       muteHttpExceptions: true,
 *     });
 *   }
 *
 * No vercel.json crons entry is needed — Apps Script is the scheduler.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { apiError, handleRouteError } from "@/lib/api/errors";
import { timingSafeEqualString } from "@/lib/security/constant-time";
import { sendSlackDm } from "@/lib/slack/client";
import { writeAuditLog } from "@/lib/audit/log";

function todayMmDd(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}-${day}`;
}

function extractBearer(header: string | null): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return m ? (m[1] ?? null) : null;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const expected = process.env["CRON_SECRET"] ?? "";
    const provided = extractBearer(req.headers.get("authorization"));
    if (!expected || !provided || !timingSafeEqualString(expected, provided)) {
      return apiError(401, "UNAUTHORIZED", "Invalid cron credentials");
    }
    const hrSlackUserId = process.env["SLACK_HR_ADMIN_SLACK_USER_ID"];
    if (!hrSlackUserId) {
      return apiError(500, "MISSING_CONFIG", "SLACK_HR_ADMIN_SLACK_USER_ID not configured");
    }
    const mmdd = todayMmDd();
    const matches = await db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        position: users.position,
        department: users.department,
      })
      .from(users)
      // birthday is stored as YYYY-MM-DD; match by the trailing -MM-DD.
      .where(and(like(users.birthday, `%-${mmdd}`), eq(users.isActive, true)));
    const errors: Array<{ id: string; error: string }> = [];
    for (const m of matches) {
      const lines = [
        `:birthday: *Vaudit HR* — birthday today!`,
        `${m.firstName} ${m.lastName} — ${m.position ?? "—"} (${m.department ?? "—"})`,
        `Drop them a note today.`,
      ];
      try {
        await sendSlackDm({ userId: hrSlackUserId, text: lines.join("\n") });
      } catch (e) {
        errors.push({
          id: m.id,
          error: e instanceof Error ? e.message : "send failed",
        });
      }
    }
    await writeAuditLog({
      actorId: null,
      action: "cron.birthdays_run",
      targetTable: "users",
      targetId: null,
      metadata: { date: mmdd, matched: matches.length, errors: errors.length },
    });
    return NextResponse.json({
      date: mmdd,
      matched: matches.length,
      sent: matches.length - errors.length,
      errors,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
