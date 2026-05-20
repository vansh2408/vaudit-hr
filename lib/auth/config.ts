/**
 * NextAuth v5 configuration.
 *
 * decisions.md A15 — pre-staged user rows + email-link on first sign-in.
 * The Google provider sets `allowDangerousEmailAccountLinking: true` so the
 * incoming OAuth identity is bound to the existing HR-staged row by email.
 * This is safe here because (1) we hard-restrict the email domain in the
 * signIn callback, and (2) HR controls the canonical email mapping. There is
 * no password account to silently link to, only the explicit HR-curated row.
 *
 * TEST MODE — when process.env.PLAYWRIGHT_TEST === "1" we additionally
 * register a passwordless `Credentials` provider that signs in any seeded
 * user by email. This is the OAuth bypass used by Playwright tests. See
 * /docs/security/test-auth.md for the threat model. The flag is checked
 * at module-load time and is never set by next.config / .env in production.
 *
 * Because next-auth v5 doesn't support `Credentials` with the `database`
 * session strategy, when the flag is on we switch to `jwt` sessions for
 * the test process only. Production stays on `database` sessions.
 */
import NextAuth, {
  type NextAuthConfig,
  type Session,
  type User as NextAuthUser,
} from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
  type UserRole,
} from "@/lib/db/schema";
import { writeAuditLog } from "@/lib/audit/log";

const IS_TEST_AUTH = process.env["PLAYWRIGHT_TEST"] === "1";

// Boot-time safety: refuse to start if the test-auth bypass is enabled in
// a production build. See /docs/security/test-auth.md. The flag is never
// part of `.env*` we ship, but if an operator accidentally exports
// PLAYWRIGHT_TEST=1 into a prod environment, fail loudly at module load
// rather than silently registering the Credentials provider.
if (IS_TEST_AUTH && process.env["NODE_ENV"] === "production") {
  throw new Error(
    "Test auth provider must never be enabled in production (PLAYWRIGHT_TEST=1 and NODE_ENV=production).",
  );
}

function parseAllowedDomains(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      image?: string | null;
      role: UserRole;
      employeeId: string;
      /**
       * True when this user appears as someone else's `users.managerId` —
       * i.e. they have at least one direct report and can therefore approve
       * that report's requests. Computed once per session refresh.
       */
      isManager: boolean;
    };
  }
}

/**
 * Test-only Credentials provider. Accepts `{ email }` and returns the
 * seeded user row if `PLAYWRIGHT_TEST=1` AND the email matches an active
 * pre-staged row. Never registered in production builds.
 */
function buildTestProvider(): Provider {
  return Credentials({
    id: "test-credentials",
    name: "Test Credentials",
    credentials: {
      email: { label: "Email", type: "email" },
    },
    async authorize(raw): Promise<NextAuthUser | null> {
      if (!IS_TEST_AUTH) return null; // belt-and-braces guard
      const email =
        typeof raw === "object" &&
        raw !== null &&
        typeof (raw as { email?: unknown }).email === "string"
          ? (raw as { email: string }).email.toLowerCase()
          : null;
      if (!email) return null;
      const row = await db.query.users.findFirst({
        where: eq(users.email, email),
      });
      if (!row || !row.isActive) return null;
      return {
        id: row.id,
        email: row.email,
        name: row.name ?? `${row.firstName} ${row.lastName}`,
        image: row.image ?? null,
      };
    },
  });
}

const providers: Provider[] = [
  Google({
    clientId: process.env["GOOGLE_CLIENT_ID"] ?? "",
    clientSecret: process.env["GOOGLE_CLIENT_SECRET"] ?? "",
    // A15: safe because signIn callback enforces domain + pre-staged row.
    allowDangerousEmailAccountLinking: true,
  }),
];
if (IS_TEST_AUTH) {
  providers.push(buildTestProvider());
}

export const authConfig = {
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  // NextAuth v5 does not support `Credentials` with database sessions, so
  // when the test provider is active we switch to JWT sessions for the
  // test process only.
  session: { strategy: IS_TEST_AUTH ? "jwt" : "database" },
  // Self-hosted deployment: Auth.js v5 only auto-trusts the Host header on
  // Vercel. Without this, `npm start` on localhost (and any non-Vercel host)
  // throws UntrustedHost on every /api/auth/* request.
  trustHost: true,
  pages: { signIn: "/login", error: "/login" },
  providers,
  callbacks: {
    async signIn({ user, account }) {
      // Test-only credentials provider: `authorize()` already validated
      // the email against the seeded users table. Skip the OAuth domain
      // check (these emails are e.g. employee@vaudit.com — fine — but the
      // domain check is the Google-specific guardrail).
      if (IS_TEST_AUTH && account?.provider === "test-credentials") {
        return true;
      }

      const email = user.email?.toLowerCase();
      const domain = emailDomain(email);
      const allowed = parseAllowedDomains(process.env["ALLOWED_EMAIL_DOMAINS"]);

      if (!email || !domain || !allowed.includes(domain)) {
        return false;
      }

      const existing = await db.query.users.findFirst({
        where: eq(users.email, email),
      });

      if (!existing) {
        // No HR-staged row — refuse. UI shows the generic error page.
        return false;
      }

      // Defence-in-depth: a pre-staged row must never be deactivated by HR
      // and still be reachable. If isActive is false, deny sign-in here so
      // an offboarded user cannot reauthenticate through a stale OAuth row.
      if (!existing.isActive) {
        return false;
      }

      // First-time link audit log: ONLY emit if no account row exists for
      // this (provider, providerAccountId) pair yet. NextAuth's adapter
      // upserts the account after this callback returns true, so a miss
      // here means this is the inaugural link of the OAuth identity to the
      // HR-staged user row. Every subsequent sign-in is a no-op.
      if (account?.provider && account.providerAccountId) {
        const priorLink = await db.query.accounts.findFirst({
          where: and(
            eq(accounts.provider, account.provider),
            eq(accounts.providerAccountId, account.providerAccountId),
          ),
        });
        if (!priorLink) {
          await writeAuditLog({
            actorId: existing.id,
            action: "auth.first_link",
            targetTable: "users",
            targetId: existing.id,
            metadata: { provider: account.provider },
          }).catch(() => undefined);
        }
      }
      return true;
    },
    async jwt({ token, user }) {
      // JWT path only fires when session.strategy === "jwt" (test mode).
      // On first sign-in `user` is populated; on later requests only `token`
      // is. We persist the DB row id on the token so the session callback
      // can look up role/identity fresh from the DB every time.
      if (user?.id) {
        token["uid"] = user.id;
      }
      return token;
    },
    async session({ session, user, token }) {
      // In DB-session mode NextAuth passes `user`; in JWT mode it passes
      // `token`. We accept either, then read the canonical role/identity
      // from the DB so an HR role change takes effect on the next request.
      const dbUserId: string | undefined =
        user?.id ??
        (typeof token?.["uid"] === "string"
          ? (token["uid"] as string)
          : undefined);
      if (!dbUserId) return session;
      const row = await db.query.users.findFirst({
        where: eq(users.id, dbUserId),
      });
      // A deactivated user (A9) must lose every privilege immediately even
      // if a DB-backed session row still exists. Returning the bare session
      // (no `user.id` on our augmented shape) means `requireSession` throws.
      if (!row || !row.isActive) return session;
      // Derive "is this user somebody's manager?" from the org chart so we
      // don't need a separate MANAGER role to gate approval UI.
      const reportsProbe = await db
        .select({ exists: sql<number>`1` })
        .from(users)
        .where(eq(users.managerId, row.id))
        .limit(1);
      const enriched: Session = {
        ...session,
        user: {
          id: row.id,
          email: row.email,
          name: row.name ?? `${row.firstName} ${row.lastName}`,
          image: row.image ?? null,
          role: row.role,
          employeeId: row.id,
          isManager: reportsProbe.length > 0,
        },
      };
      return enriched;
    },
  },
} satisfies NextAuthConfig;

export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth(authConfig);
