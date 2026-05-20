# Test-auth bypass — threat model

## What it is

`/lib/auth/config.ts` conditionally registers an additional NextAuth
`Credentials` provider with id `test-credentials`. It accepts a JSON
body of `{ email }` and signs that user in **without** a password,
**without** Google OAuth, and **without** the domain-allowlist check.

It exists for one reason only: Playwright tests need to be able to log
in as the four seeded users (CEO / HR admin / manager / employee)
without going through Google. Real Google OAuth in CI is brittle and
introduces a hard external dependency on the IdP for every PR.

## Why this is safe

Three layers, any one of which would defeat the bypass on its own:

1. **Compile/load gate.** The provider is added to the providers array
   only if `process.env.PLAYWRIGHT_TEST === "1"` at module-load time.
   This env var:
   - is **not** read from `next.config.*`
   - is **not** an `NEXT_PUBLIC_*` var (so it can't leak to the client)
   - is **not** referenced in any `.env*` file we ship
   - is set only by `playwright.config.ts → webServer.env` and by
     `package.json` test scripts (`test:e2e`, `test:e2e:ui`)
   - is explicitly set in the CI workflow (`.github/workflows/ci.yml`)
     for the test job
   For a production deploy to enable it, an operator would have to
   intentionally export `PLAYWRIGHT_TEST=1` into the runtime env — at
   which point you have far bigger problems than this provider.

2. **Authorize-time gate.** The `authorize()` function re-checks
   `IS_TEST_AUTH` defensively, and refuses to return a user if the
   flag is off. So even if a hostile build process somehow registered
   the provider, calling it would still fail closed.

3. **Active-user check.** `authorize()` only succeeds for emails that
   match an existing, **active** user row in `users`. There is no
   account creation — the email must already exist in the seed.
   A deactivated user (A9 cancellation flow) cannot log in.

## Session strategy switch

NextAuth v5 disallows `Credentials` providers with the `database`
session strategy. When `PLAYWRIGHT_TEST=1` is on we switch the
session strategy to `jwt`. This is a deliberate, narrow divergence
from production. The `session()` callback handles both shapes —
DB-session mode reads `user.id` from the adapter, JWT mode reads
`token.uid` that the new `jwt()` callback stores at sign-in. Either
way the canonical role + identity comes from a fresh DB lookup, so
a role change in HR_ADMIN UI takes effect on the next request in
both modes.

## Review checklist

Anyone modifying `/lib/auth/config.ts` MUST verify:

- [ ] `IS_TEST_AUTH` is still computed at module-load time (not
      per-request — a per-request check could be flipped by a header).
- [ ] The `Credentials` provider is gated by `if (IS_TEST_AUTH)` in
      both the providers array AND the `authorize()` body.
- [ ] The session-strategy switch (`IS_TEST_AUTH ? "jwt" : "database"`)
      is preserved.
- [ ] No production code path imports anything from `/tests/e2e/`.
- [ ] No `.env*` file ships with `PLAYWRIGHT_TEST=1`.
- [ ] `npm run build` for the production target does NOT set the flag.

## What could go wrong

| Scenario | Mitigation |
|--|--|
| Operator copies CI env to prod by accident | Use distinct secret stores for CI and prod runtimes; `PLAYWRIGHT_TEST` is not a real secret — its absence is the safety. |
| A future agent adds `PLAYWRIGHT_TEST` to `.env.example` | Lint check: grep `.env*` for the var in CI (TODO once a feature lands that justifies tightening). |
| Credentials provider used to sign in as a SUPER_ADMIN that doesn't exist in prod | Provider rejects unknown emails — only seeded test accounts work. Prod won't have those rows. |
| Token forgery if `NEXTAUTH_SECRET` leaks | Same risk as any NextAuth deployment. Rotate the secret on suspicion. |

## Removal

If we ever need to remove this bypass, delete:

- `buildTestProvider()` in `/lib/auth/config.ts`
- The `IS_TEST_AUTH` const + every reference
- The `jwt` callback (if no other JWT-mode users exist)
- `tests/e2e/helpers/auth.ts` and replace its single user with a real
  Google OAuth flow recorded via Playwright codegen.
