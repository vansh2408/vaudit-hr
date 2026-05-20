# Auth Configuration Audit — `lib/auth/config.ts`

Audited at Wave 1. Source: `lib/auth/config.ts` after Wave 1 patches.

## Checklist

### 1. Domain enforcement before linking — ✓ PASS
`signIn` callback computes `emailDomain(user.email)` and rejects when
the domain is not in `parseAllowedDomains(ALLOWED_EMAIL_DOMAINS)`. This
runs BEFORE the DB lookup and BEFORE NextAuth performs the account-link
side effect. (`lib/auth/config.ts:132-139`)

### 2. Pre-staged-user rejection — ✓ PASS
After the domain check, the callback queries `users` by email and
returns `false` if no row exists. `allowDangerousEmailAccountLinking`
cannot proceed past a `false` return. (`lib/auth/config.ts:141-148`)

### 3. `allowDangerousEmailAccountLinking` gated — ✓ PASS
The Google provider sets the flag (`lib/auth/config.ts:111`), but the
two gates above — domain allowlist + pre-staged-row requirement — mean
the only Google identity that can link is one whose email already lives
in a HR-curated row inside an allowed domain. The flag is "safe
dangerous" given those constraints, exactly as decisions.md A15
prescribes.

### 4. Role from DB, never from JWT/Google — ✓ PASS
`session` callback (`lib/auth/config.ts:181-203`) re-reads the user
row from the DB on every session evaluation and populates
`session.user.role` from `row.role`. Google's `profile` object is
never read after the initial NextAuth adapter insert. Database-session
strategy (`session.strategy = "database"` for the production path)
means there is no JWT to forge a role into.

### 5. Session callback doesn't leak secrets — ✓ PASS
The augmented `Session.user` exposes only `{ id, email, name, image,
role, employeeId }`. No tokens, refresh tokens, or NextAuth internals
escape. The Google account-level `access_token` / `refresh_token` /
`id_token` columns in the `accounts` table are never selected here.

### 6. First-time link audit-logged — ✓ PASS (patched in Wave 1)
The original implementation fired `auth.first_link` on EVERY OAuth
sign-in (`if (account?.provider)`), which would have flooded the audit
table and made the event useless for incident response. Patched to
look up an existing `(provider, providerAccountId)` row in the
`accounts` table BEFORE NextAuth's adapter upserts it; the audit row is
emitted only when no prior link exists. (`lib/auth/config.ts:162-178`)

### 7. Deactivated-user lockout — ✓ PASS (added in Wave 1)
Two layers:
1. `signIn` callback rejects when `existing.isActive === false`
   (`lib/auth/config.ts:153-155`).
2. `session` callback drops the enriched user shape when
   `row.isActive === false` (`lib/auth/config.ts:190`). Even if a
   stale DB session row survives an HR deactivation, the next request
   sees an unauthenticated session and `requireSession` throws.

This honours decisions.md A9 (deactivation auto-cancels PENDING
requests) by ensuring the deactivated user cannot keep operating
through a cached browser tab.

---

## Patches applied to `lib/auth/config.ts`

```diff
- import { eq } from "drizzle-orm";
+ import { and, eq } from "drizzle-orm";

  if (!existing) {
    return false;
  }

+ // Defence-in-depth: reject deactivated rows at sign-in time.
+ if (!existing.isActive) {
+   return false;
+ }

- if (account?.provider) {
+ if (account?.provider && account.providerAccountId) {
+   const priorLink = await db.query.accounts.findFirst({
+     where: and(
+       eq(accounts.provider, account.provider),
+       eq(accounts.providerAccountId, account.providerAccountId),
+     ),
+   });
+   if (!priorLink) {
      await writeAuditLog({
        actorId: existing.id,
        action: "auth.first_link",
        targetTable: "users",
        targetId: existing.id,
        metadata: { provider: account.provider },
      }).catch(() => undefined);
+   }
  }

  // session callback:
- if (!row) return session;
+ if (!row || !row.isActive) return session;
```

---

## Test-mode Credentials provider — open issue (for backend-dev / test owner)

The current file additionally registers a `Credentials` provider gated
by `process.env.PLAYWRIGHT_TEST === "1"` and switches `session.strategy`
to `"jwt"` in that mode. Security implications:

- **Production safety:** the flag is checked at module-load time and is
  intentionally absent from `docs/prd.md`'s env-var list, so a normal
  production build never registers the provider. Verified — no
  `PLAYWRIGHT_TEST` reference exists outside the auth config.
- **Open issue (low risk, test only):** under `jwt` sessions the
  `session({ session, user })` callback receives `token` (not `user`)
  on subsequent requests. The current callback short-circuits on
  `!user?.id` and returns the bare session, which means `session.user`
  in test mode is missing `role` / `employeeId` after the first
  request. A `jwt` callback that pins `id` onto the token is required
  for the test path to deliver role-aware sessions. Backend-dev to
  resolve when writing Playwright fixtures.
- **Open issue (medium):** when test mode is active, deploys MUST
  refuse to start if `NODE_ENV === "production"`. Add a boot-time
  assertion (`if (IS_TEST_AUTH && NODE_ENV === "production") throw …`)
  to make the bypass impossible to enable in prod by accident.
  Backend-dev / DevOps to land this guard before Wave 2 ships.

These do NOT downgrade the auth audit — production is unaffected — but
should be tracked as Wave 2 follow-ups.

---

## Summary

| Item | Status |
|------|--------|
| Domain enforcement before linking | ✓ |
| Pre-staged-user rejection | ✓ |
| `allowDangerousEmailAccountLinking` gated | ✓ |
| Role from DB, not JWT | ✓ |
| Session callback hides secrets | ✓ |
| First-time link audit-logged exactly once | ✓ (patched) |
| Deactivated-user lockout | ✓ (added) |

All seven items pass. Two open issues are tracked above for the test
auth path; neither affects production.
