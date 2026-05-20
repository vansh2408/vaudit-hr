/**
 * Playwright auth helper.
 *
 * Bypasses Google OAuth by hitting the test-only NextAuth Credentials
 * provider (`test-credentials`, registered ONLY when PLAYWRIGHT_TEST=1
 * — see /lib/auth/config.ts and /docs/security/test-auth.md).
 *
 * Flow:
 *   1. GET /api/auth/csrf  → grab the csrfToken cookie + body token.
 *   2. POST /api/auth/callback/test-credentials with the email + csrf.
 *   3. NextAuth issues a session JWT cookie and the page is logged in.
 */
import type { Page } from "@playwright/test";

/**
 * Test fixture key. Identifies which seeded user to authenticate as.
 * "MANAGER" here is a label for the seeded user who has direct reports
 * (Morgan Lee, manager@vaudit.com) — not a database role. After the
 * MANAGER role was removed, Morgan's `users.role` is `EMPLOYEE` but she
 * still has Riley as a direct report via `managerId`.
 */
export type SeededRole = "EMPLOYEE" | "MANAGER" | "HR_ADMIN" | "SUPER_ADMIN";

const SEEDED_EMAILS: Readonly<Record<SeededRole, string>> = {
  EMPLOYEE: "employee@vaudit.com",
  MANAGER: "manager@vaudit.com",
  HR_ADMIN: "admin@vaudit.com",
  SUPER_ADMIN: "ceo@vaudit.com",
};

interface CsrfBody {
  csrfToken: string;
}

function isCsrfBody(value: unknown): value is CsrfBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { csrfToken?: unknown }).csrfToken === "string"
  );
}

/**
 * Log the Playwright `page` in as the seeded user for `role`. Caller is
 * responsible for navigating afterwards (this only sets the cookie).
 */
export async function loginAs(page: Page, role: SeededRole): Promise<void> {
  const email = SEEDED_EMAILS[role];
  const ctx = page.context();

  const csrfRes = await ctx.request.get("/api/auth/csrf");
  if (!csrfRes.ok()) {
    throw new Error(
      `loginAs: /api/auth/csrf returned ${csrfRes.status()} — ` +
        "is the dev server running with PLAYWRIGHT_TEST=1?",
    );
  }
  const csrfJson: unknown = await csrfRes.json();
  if (!isCsrfBody(csrfJson)) {
    throw new Error("loginAs: csrf response had no csrfToken field");
  }

  const callbackRes = await ctx.request.post(
    "/api/auth/callback/test-credentials",
    {
      form: {
        email,
        csrfToken: csrfJson.csrfToken,
        callbackUrl: "/dashboard",
        json: "true",
      },
      headers: { "content-type": "application/x-www-form-urlencoded" },
      // NextAuth redirects to /dashboard on success; we don't need to follow.
      maxRedirects: 0,
      failOnStatusCode: false,
    },
  );
  // NextAuth returns 200/302/200 depending on version; success = a session
  // cookie now exists on the context.
  const cookies = await ctx.cookies();
  const hasSession = cookies.some((c) =>
    /next-auth\.session-token|authjs\.session-token/.test(c.name),
  );
  if (!hasSession) {
    throw new Error(
      `loginAs(${role}): no session cookie set after credentials callback ` +
        `(status ${callbackRes.status()}). Check that the seed ran and ` +
        "that PLAYWRIGHT_TEST=1 is set on the Next.js process.",
    );
  }
}

export { SEEDED_EMAILS };
