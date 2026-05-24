/**
 * /api/cron/birthdays
 *  POST (Bearer CRON_SECRET) — sends ONE Slack DM per day to the
 *  configured HR admin, summarising every active employee whose
 *  birthday lands today. Auth via constant-time comparison against
 *  CRON_SECRET. Zero birthdays today → no DM sent; the audit log still
 *  records the run so a quiet day is visible in history.
 *
 * Filters: users.birthday endswith today's MM-DD AND users.isActive = true.
 * The single recipient is `SLACK_HR_ADMIN_SLACK_USER_ID`. SUPER_ADMINs
 * never receive these (A11).
 *
 * Scheduling (2026-05-20): invoked daily by a Google Apps Script trigger.
 * Set up by creating a time-based trigger in the Apps Script project
 * that calls a function like:
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

interface BirthdayPerson {
  firstName: string;
  lastName: string;
  email: string;
  position: string | null;
  department: string | null;
}

/**
 * Format the role line "Position · Department". Null-aware so an
 * employee with only one (or neither) field set still renders cleanly
 * — no stray separators / em-dashes.
 */
function fmtRole(position: string | null, department: string | null): string | null {
  if (position && department) return `${position} · ${department}`;
  return position ?? department ?? null;
}

/**
 * Compose the single per-day DM body. Heading auto-pluralises; each
 * person renders as a 3-line "card" (name / email / role). Multiple
 * birthdays are separated by a blank line so they don't run together.
 */
function buildBirthdayDm(people: ReadonlyArray<BirthdayPerson>): string {
  const heading =
    people.length === 1
      ? `🎂 *Birthday today*`
      : `🎂 *${people.length} birthdays today*`;
  const blocks = people.map((p) => {
    const lines = [`*${p.firstName} ${p.lastName}*`, p.email];
    const role = fmtRole(p.position, p.department);
    if (role) lines.push(role);
    return lines.join("\n");
  });
  return [heading, ...blocks].join("\n\n");
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
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        position: users.position,
        department: users.department,
      })
      .from(users)
      // birthday is stored as YYYY-MM-DD; match by the trailing -MM-DD.
      .where(and(like(users.birthday, `%-${mmdd}`), eq(users.isActive, true)));

    // No birthdays today → no DM, no noise. Audit log still records the
    // run so a missing day is visible in the audit history.
    let messageSent = false;
    const errors: Array<{ error: string }> = [];
    if (matches.length > 0) {
      const text = buildBirthdayDm(matches);
      try {
        await sendSlackDm({ userId: hrSlackUserId, text });
        messageSent = true;
      } catch (e) {
        errors.push({ error: e instanceof Error ? e.message : "send failed" });
      }
    }

    await writeAuditLog({
      actorId: null,
      action: "cron.birthdays_run",
      targetTable: "users",
      targetId: null,
      metadata: {
        date: mmdd,
        matched: matches.length,
        messageSent,
        errors: errors.length,
      },
    });
    return NextResponse.json({
      date: mmdd,
      matched: matches.length,
      sent: messageSent ? 1 : 0,
      errors,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
