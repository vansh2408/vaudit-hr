/**
 * Tests for `notifyEmployee` — decisions.md A2.
 *
 * Contract:
 *   1. A notification row is always written, even if Slack fails.
 *   2. A Slack DM is attempted iff `slackUserId` is provided.
 *   3. Slack errors must NOT propagate.
 *
 * The Slack client uses `globalThis.fetch`, so we stub fetch directly
 * with `vi.spyOn` rather than mocking the module. This keeps the real
 * Drizzle queries running against the real test DB — bugs in our SQL
 * layer are exactly what we want these tests to catch.
 *
 * DB hygiene: each test creates a uniquely-emailed user inside a
 * `withDbTransaction` block. The transaction is rolled back at the end,
 * so the user + every cascade-linked notification disappears. The seed
 * data is untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { withDbTransaction } from "../e2e/helpers/db";
import { notifications, users } from "@/lib/db/schema";

// DB-backed unit tests: only run when a test DB is reachable. CI provides
// `DATABASE_URL_TEST`. Developers can opt in locally by exporting the same
// var; otherwise these tests are skipped so `npm test` stays green on a
// fresh checkout.
const HAS_TEST_DB =
  !!process.env["DATABASE_URL_TEST"] ||
  !!process.env["DATABASE_URL"];
const dbDescribe = HAS_TEST_DB ? describe : describe.skip;

// notify + slack client both use the global `db` from @/lib/db. We
// import them lazily inside each test so the env-based DATABASE_URL
// switch in helpers/db.ts is honored.

function uniqueEmail(): string {
  // Avoid collisions with the seed and across parallel test files.
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `notify-${stamp}-${rand}@vaudit.com`;
}

interface MockFetchOptions {
  failOpenConversations?: boolean;
  failPostMessage?: boolean;
}

function installMockFetch(opts: MockFetchOptions = {}): ReturnType<
  typeof vi.spyOn
> {
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("conversations.open")) {
        const body = opts.failOpenConversations
          ? { ok: false, error: "channel_not_found" }
          : { ok: true, channel: { id: "C_TEST" } };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("chat.postMessage")) {
        const body = opts.failPostMessage
          ? { ok: false, error: "channel_not_found" }
          : { ok: true };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });
  return spy;
}

dbDescribe("notifyEmployee", () => {
  beforeEach(() => {
    // The Slack client refuses to fire without this token configured.
    process.env["SLACK_BOT_TOKEN"] = "xoxb-test-token";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes a notification row AND fires a Slack DM on the happy path", async () => {
    const fetchSpy = installMockFetch();
    await withDbTransaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: uniqueEmail(),
          firstName: "Notify",
          lastName: "Target",
          role: "EMPLOYEE",
        })
        .returning();
      if (!u) throw new Error("fixture insert returned no row");

      // Import lazily — the module reads DATABASE_URL at first import.
      const { notifyEmployee } = await import("@/lib/notify");
      await notifyEmployee({
        employeeId: u.id,
        slackUserId: "U_TEST",
        type: "leave.submitted",
        message: "Your leave request was submitted.",
        link: "/leave",
      });

      // The notification row exists. We read through the GLOBAL db here
      // because notifyEmployee writes through it — the tx connection
      // would not see the row.
      const { db } = await import("@/lib/db");
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.employeeId, u.id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.type).toBe("leave.submitted");
      expect(rows[0]?.message).toContain("submitted");

      // Slack: conversations.open + chat.postMessage were both called.
      const slackUrls: string[] = fetchSpy.mock.calls.map((c: unknown[]) =>
        String(c[0]),
      );
      expect(
        slackUrls.some((s: string) => s.includes("conversations.open")),
      ).toBe(true);
      expect(
        slackUrls.some((s: string) => s.includes("chat.postMessage")),
      ).toBe(true);

      // Hand-clean the notification: the rollback won't touch it because
      // notifyEmployee wrote it on the global pool, not on `tx`.
      await db.delete(notifications).where(eq(notifications.employeeId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
    });
  });

  it("does NOT throw when Slack returns ok:false", async () => {
    installMockFetch({ failOpenConversations: true });
    await withDbTransaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: uniqueEmail(),
          firstName: "SlackBroken",
          lastName: "Target",
          role: "EMPLOYEE",
        })
        .returning();
      if (!u) throw new Error("fixture insert returned no row");

      const { notifyEmployee } = await import("@/lib/notify");
      await expect(
        notifyEmployee({
          employeeId: u.id,
          slackUserId: "U_TEST",
          type: "leave.submitted",
          message: "Should still persist",
        }),
      ).resolves.toBeUndefined();

      // The DB row was still written — Slack failure must not block A2.
      const { db } = await import("@/lib/db");
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.employeeId, u.id));
      expect(rows).toHaveLength(1);

      await db.delete(notifications).where(eq(notifications.employeeId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
    });
  });

  it("skips Slack when slackUserId is null but still writes the row", async () => {
    const fetchSpy = installMockFetch();
    await withDbTransaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: uniqueEmail(),
          firstName: "NoSlack",
          lastName: "Target",
          role: "EMPLOYEE",
        })
        .returning();
      if (!u) throw new Error("fixture insert returned no row");

      const { notifyEmployee } = await import("@/lib/notify");
      await notifyEmployee({
        employeeId: u.id,
        slackUserId: null,
        type: "leave.submitted",
        message: "In-app only",
      });

      expect(fetchSpy).not.toHaveBeenCalled();

      const { db } = await import("@/lib/db");
      const rows = await db
        .select()
        .from(notifications)
        .where(eq(notifications.employeeId, u.id));
      expect(rows).toHaveLength(1);

      await db.delete(notifications).where(eq(notifications.employeeId, u.id));
      await db.delete(users).where(eq(users.id, u.id));
    });
  });
});
