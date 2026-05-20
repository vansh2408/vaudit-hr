# Wave 1 tests review — tester (vitest + playwright + CI workflow)

**Verdict: CHANGES REQUESTED**

The test *infrastructure* is well-architected: real Postgres
sessions, `withDbTransaction` rollback, Playwright globalSetup with
DB-name guard, fetch-stubbed Slack, a CI workflow with a postgres
service container and migration drift check. The *coverage*, however,
is thin: only two unit test files (`working-days.test.ts`,
`notify.test.ts`) ship. Per decisions.md A13 "tests required per
feature", every Wave 1 feature (auth callbacks, cycle detect, balance
math, CSV import, sanitiser, constant-time, org-tree builder, cancel
flow, deactivate flow) needs at minimum a unit test, and the PRD
mandates Playwright specs for auth, leave submission/approval/
cancellation, balance adjustment, CSV import, org-chart render. None
of those Playwright specs exist yet. **This is a Wave 2 blocker**.

## Test infrastructure

### `vitest.config.ts` ✓
happy-dom; path alias `@`; coverage informational (A13); 10s test +
hook timeout; excludes `tests/e2e/**`.

### `playwright.config.ts` ✓
`workers:1` (shared DB); `globalSetup` runs migrate+seed;
`webServer.env: { PLAYWRIGHT_TEST:"1" }`; `retries: isCi?1:0`; two
projects (chromium desktop + Pixel 5 mobile).

### `tests/e2e/global-setup.ts` ✓
- Refuses to run unless the URL contains `_test` or
  `DATABASE_URL_TEST` is set OR `ALLOW_NON_TEST_DB=1` is explicit.
  Critical safety — prevents nuking dev/prod.
- Sets `PLAYWRIGHT_TEST=1` so the Next.js child inherits it.

### `tests/e2e/helpers/db.ts` ✓
- Shared pool, lazy init.
- `resetAndSeedDb` truncates in FK-safe order + spawns
  `tsx scripts/seed.ts` as a child process (correct — importing
  the seed module would run its `main()` on load).
- `withDbTransaction(fn)` BEGINs, runs, ALWAYS rolls back — even on
  success. Lets unit tests touch the real DB without leaking rows.
- Inline comment warns "DO NOT use the global db from `@/lib/db`
  inside fn" — good documentation; corresponds with the `notify`
  test correctly using the global db deliberately and cleaning up by
  hand.

### `tests/e2e/helpers/auth.ts` ✓
- Uses the NextAuth credentials provider via `/api/auth/csrf` →
  `/api/auth/callback/test-credentials`.
- Asserts a session cookie is set; throws with an actionable error
  if not.
- Email-by-role map (`SEEDED_EMAILS`) deduplicates magic strings.

### `tests/e2e/fixtures.ts` ✓
- `authedAs(role)` factory returns a derived `test` object whose
  `page` is pre-logged-in. Composable.
- `mockSlack` auto-fixture intercepts every `slack.com/api/**`
  request and records the call shape so specs can assert on it.
  Clean separation from real Slack.

### CI workflow `.github/workflows/ci.yml` ✓
- Postgres 16 service container with `pg_isready` health check.
- Env vars set with deterministic CI values (NEXTAUTH_SECRET, etc).
- **Drizzle drift check**: runs `db:generate` and fails if any
  diff appears under `lib/db/migrations` — catches the
  forgot-to-regenerate footgun.
- Steps: install → drift check → migrate → seed → lint → typecheck
  → vitest → install Playwright → e2e → upload report on failure.
- Concurrency cancellation on the same ref — saves CI minutes.
- Playwright browser caching keyed on lockfile hash.
- `PLAYWRIGHT_TEST: "1"` is in the job-level env block, so the
  Next.js dev server boots with the credentials provider.

## Test-auth bypass safety analysis

Cross-checked against `docs/security/test-auth.md`. Three layers:

1. Module-load env-flag (`process.env.PLAYWRIGHT_TEST === "1"`).
2. Authorize-body re-check of the same flag.
3. Active-user check (`!row.isActive` rejects).

✓ The flag is not present in `.env.example`, not referenced by
`next.config.mjs`, not `NEXT_PUBLIC_*`. The only places it's set are
`playwright.config.ts`, `package.json` test scripts, and
`.github/workflows/ci.yml`'s test job. A production deploy would
have to deliberately opt in for the bypass to activate.

🟡 Open issue: there is no boot-time assertion `if (IS_TEST_AUTH
&& NODE_ENV === "production") throw …`. The auth checklist flags
this as a medium-risk open issue; tester should ensure backend-dev
lands it before Phase 7.

## Unit tests shipped

### `tests/unit/working-days.test.ts` ✓
Seven cases: single weekday = 1, single weekend = 0, week-long
range minus weekends = 5, holiday in range = 4, weekend-holiday no
double-count = 5, end < start = 0, `toYmd` format. Solid coverage
of A1 edge cases.

### `tests/unit/notify.test.ts` ✓
Three cases (DB-backed via `withDbTransaction`):
- Happy path: notification row + Slack `conversations.open` +
  `chat.postMessage` all fire.
- Slack `ok:false`: notification row STILL written (A2 contract).
- `slackUserId: null`: Slack not called, row still written.

Stubs `globalThis.fetch` rather than the slack module — keeps the
real Drizzle query path live. Good pattern. `dbDescribe` skip guard
when no test DB available keeps CI green on fresh checkouts that
don't define `DATABASE_URL_TEST`.

## Missing tests

Per PRD §Testing + decisions A13, the following MUST ship with
their respective Wave 1 features and currently DO NOT:

| Feature | Required | Status |
| --- | --- | --- |
| `lib/leave/balance.ts` `checkBalance`/`consumeBalance`/`refundBalance` | unit | ✗ |
| `lib/leave/cancel.ts` PENDING vs APPROVED branches | unit | ✗ |
| `lib/employee/cycle-detect.ts` (both versions) | unit | ✗ |
| `lib/employee/deactivate.ts` tx + auto-cancel | unit | ✗ |
| `lib/csv/import.ts` dryrun, commit, duplicate-email, cycle | unit | ✗ |
| `lib/security/sanitize.ts` XSS bypass cases | unit | ✗ |
| `lib/security/constant-time.ts` length-equalisation | unit | ✗ |
| `lib/security/cycle-detect.ts` (pure version) | unit | ✗ |
| `lib/orgchart/tree.ts` parent-missing fallback | unit | ✗ |
| auth flow (login as 4 roles + redirect) | e2e | ✗ |
| leave submission + manager approval | e2e | ✗ |
| leave cancellation (refund + DM) | e2e | ✗ |
| balance adjustment audit trail | e2e | ✗ |
| CSV import dryrun + commit | e2e | ✗ |
| org-chart render | e2e | ✗ |

No `.spec.ts` files in `tests/e2e/`. The fixture infrastructure is
ready; the actual specs need to land.

## Numbered findings

1. **block** — `tests/e2e/` contains zero spec files. PRD requires
   Playwright specs for auth, leave submit, leave approval, leave
   cancel, balance adjust, CSV import, org-chart render. At least
   one spec covering the auth-then-dashboard happy path MUST land
   this wave to validate the test-auth bypass plumbing end-to-end.

2. **block** — Wave 1 lib helpers ship without unit tests. The two
   that DO have tests (`working-days`, `notify`) demonstrate the
   pattern is well-established. Cycle detection, balance math,
   cancel flow, deactivate flow, sanitiser, constant-time
   comparator, CSV import, org-tree builder must each get a
   `tests/unit/*.test.ts` file.

3. **changes** — `tests/unit/notify.test.ts:138`. Hand-cleans rows
   on the global db (notify writes outside the test tx). Consider a
   `tests/unit/setup.ts` afterEach that truncates by test-prefix.

4. **changes** — `tests/unit/setup.ts` should: set `TZ=UTC`, extend
   `expect` with jest-dom matchers, set `SLACK_BOT_TOKEN`. The
   notify test sets the token in `beforeEach` — sign the setup file
   isn't doing it globally.

5. **changes** — `.github/workflows/ci.yml` drift check runs
   `db:generate` via `drizzle-kit`. Pin `drizzle-kit` to an exact
   version (no caret) so the diff is deterministic across CI runs.

6. **nit** — `tests/e2e/global-setup.ts:35` regex
   `/_test(\b|[?/_])/i` matches `postgres_testing`. Tighten to
   `_test$` or prefer the explicit `DATABASE_URL_TEST` env override.

7. **nit** — `tests/e2e/helpers/db.ts:84-91`. `resetAndSeedDb`
   spawns `tsx scripts/seed.ts` per call (~2 s). Fine for globalSetup
   only; avoid calling mid-suite.

8. **praise** — `loginAs` uses NextAuth's real CSRF flow rather
   than fabricating cookies. Tests the auth plumbing end-to-end.

9. **praise** — `mockSlack` records call shape, not just count.
   Specs can assert on Slack message content.

## Summary

| Severity | Count |
| -------- | ----- |
| block    | 2 (items 1, 2 — missing specs) |
| changes  | 3     |
| nit      | 2     |
| praise   | 2     |

Infrastructure: 10/10. Coverage: insufficient for A13. Until the
two `block` items land, Wave 1 cannot be marked complete.
