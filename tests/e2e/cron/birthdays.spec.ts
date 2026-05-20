/**
 * E2E: /api/cron/birthdays direct API tests (no UI).
 *
 *   - 401 without Bearer.
 *   - 401 with wrong Bearer.
 *   - 200 with right Bearer when no birthdays today (count 0).
 *   - 200 with right Bearer when there is a seeded birthday today.
 *
 * The Bearer secret comes from CRON_SECRET (set by CI workflow + by the
 * Playwright dev-server env). For local runs the value is whatever the
 * developer set in .env — read it through `process.env` so we never
 * hard-code a default.
 */
import { eq } from "drizzle-orm";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { users } from "@/lib/db/schema";

function todayMmDd(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}-${day}`;
}

const CRON_SECRET = process.env["CRON_SECRET"];

async function postCron(
  request: APIRequestContext,
  bearer: string | null,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (bearer) headers["authorization"] = `Bearer ${bearer}`;
  const res = await request.post("/api/cron/birthdays", { headers });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status(), body };
}

test.describe("/api/cron/birthdays", () => {
  test("returns 401 without an Authorization header", async ({ request }) => {
    const { status } = await postCron(request, null);
    expect(status).toBe(401);
  });

  test("returns 401 with a wrong Bearer secret", async ({ request }) => {
    const { status } = await postCron(request, "wrong-bearer-token");
    expect(status).toBe(401);
  });

  test("returns 200 with the correct Bearer when no one has a birthday today", async ({
    request,
  }) => {
    test.skip(!CRON_SECRET, "CRON_SECRET not configured for this run");

    const { db } = await import("@/lib/db");
    const mmdd = todayMmDd();
    // Snapshot current birthdays today so we can restore after the test.
    const matches = await db
      .select({ id: users.id, birthday: users.birthday })
      .from(users)
      .where(eq(users.birthday, mmdd));
    const restore = matches.map((m) => ({ id: m.id, birthday: m.birthday }));
    // Move them out of the way (set to a guaranteed non-today MM-DD).
    if (restore.length > 0) {
      for (const r of restore) {
        await db
          .update(users)
          .set({ birthday: "01-01" === mmdd ? "12-31" : "01-01" })
          .where(eq(users.id, r.id));
      }
    }
    try {
      const { status, body } = await postCron(request, CRON_SECRET ?? "");
      expect(status).toBe(200);
      const json = body as { matched: number };
      expect(json.matched).toBe(0);
    } finally {
      // Restore birthdays — we always restore so other tests are stable.
      for (const r of restore) {
        await db
          .update(users)
          .set({ birthday: r.birthday })
          .where(eq(users.id, r.id));
      }
    }
  });

  test("returns 200 with matched>0 when there is a seeded birthday today", async ({
    request,
  }) => {
    test.skip(!CRON_SECRET, "CRON_SECRET not configured for this run");

    // Force-set the seeded EMPLOYEE's birthday to today, then call the
    // endpoint and restore.
    const { db } = await import("@/lib/db");
    const mmdd = todayMmDd();
    const rows = await db
      .select({ id: users.id, birthday: users.birthday })
      .from(users)
      .where(eq(users.email, "employee@vaudit.com"))
      .limit(1);
    const target = rows[0];
    if (!target) test.fail(true, "seeded employee not found");
    if (!target) return;
    try {
      await db
        .update(users)
        .set({ birthday: mmdd })
        .where(eq(users.id, target.id));
      const { status, body } = await postCron(request, CRON_SECRET ?? "");
      expect(status).toBe(200);
      const json = body as { matched: number };
      expect(json.matched).toBeGreaterThanOrEqual(1);
    } finally {
      await db
        .update(users)
        .set({ birthday: target.birthday })
        .where(eq(users.id, target.id));
    }
  });
});
