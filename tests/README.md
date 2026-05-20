# Tests — Vaudit HR

Two layers:

- `tests/unit/` — Vitest. Pure functions, components, and any helper that
  touches the DB through `withDbTransaction()` (rolled back per test).
- `tests/e2e/` — Playwright. Full browser flows against a running
  Next.js dev server + seeded Postgres.

No coverage % gate in v1 (decisions.md **A13**). Every feature PR ships
tests; CI fails if they're missing or red.

## Test database

A separate Postgres database, NEVER the dev or prod one. Two ways to
point at it:

```
# preferred — explicit
DATABASE_URL_TEST=postgres://postgres:postgres@localhost:5432/vaudit_test

# or override globally for the test run
DATABASE_URL=postgres://postgres:postgres@localhost:5432/vaudit_test
```

The Playwright globalSetup refuses to run unless the URL contains
`_test` or `DATABASE_URL_TEST` is set explicitly. This is the safety
that keeps `TRUNCATE` away from dev data.

### Local one-time setup

```bash
# create the DB
createdb vaudit_test

# point your shell at it
export DATABASE_URL_TEST=postgres://localhost:5432/vaudit_test

# install Playwright browsers (once per machine)
npm run test:e2e:install
```

## Running

| Command | What it does |
|--|--|
| `npm test` | One-shot Vitest run (used in CI) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Vitest + v8 coverage HTML/lcov |
| `npm run test:e2e` | Full Playwright suite (boots `next dev`) |
| `npm run test:e2e:ui` | Playwright UI mode for debugging |

Playwright auto-spawns `next dev` with `PLAYWRIGHT_TEST=1`. **Do not**
set that env var anywhere else — see security note below.

## Test-auth strategy

Tests bypass Google OAuth by signing in through a credentials provider
that is registered **only** when `PLAYWRIGHT_TEST === "1"`. See
[/docs/security/test-auth.md](../docs/security/test-auth.md) for the
threat model and review checklist.

`tests/e2e/helpers/auth.ts → loginAs(page, role)` posts to
`/api/auth/callback/test-credentials` and verifies a session cookie was
set. Uses these seeded emails:

| Role | Email |
|--|--|
| `SUPER_ADMIN` | `ceo@vaudit.com` |
| `HR_ADMIN` | `admin@vaudit.com` |
| `MANAGER` | `manager@vaudit.com` |
| `EMPLOYEE` | `employee@vaudit.com` |

## Writing a new unit test

```ts
// tests/unit/leave/cancel.test.ts
import { describe, it, expect } from "vitest";
import { withDbTransaction } from "../../e2e/helpers/db";
import { users, leaveRequests } from "@/lib/db/schema";

describe("cancelLeave", () => {
  it("flips status to CANCELLED", async () => {
    await withDbTransaction(async (tx) => {
      // Insert fixture rows on the transaction — they vanish at rollback.
      const [u] = await tx.insert(users).values({ /* ... */ }).returning();
      // ... exercise the function under test using `tx` ...
      // assert
    });
  });
});
```

Rules:
- Pure functions live next to features under `lib/**`; their tests live
  under `tests/unit/<feature>/`.
- For React components, prefer rendering with `@testing-library/react`
  and asserting on screen text/aria roles, not implementation details.
- For anything that hits the DB, wrap with `withDbTransaction()`.
  DO NOT use the global `db` from `@/lib/db` inside the callback — it
  would write outside the transaction and leak between tests.
- Mock Slack via `vi.spyOn(globalThis, "fetch")`. Never let a test hit
  the real Slack API.

## Writing a new Playwright test

```ts
// tests/e2e/leave/submit.spec.ts
import { test, expect, authedAs } from "../fixtures";

const employeeTest = authedAs("EMPLOYEE");

employeeTest("submits a leave request", async ({ page, mockSlack }) => {
  await page.goto("/leave/new");
  await page.getByLabel("Start date").fill("2026-06-01");
  // ...
  await page.getByRole("button", { name: /submit/i }).click();
  await expect(page.getByText(/request submitted/i)).toBeVisible();
  // mockSlack intercepts the manager DM — assert on it if relevant.
  expect(mockSlack.calls.length).toBeGreaterThan(0);
});
```

Rules:
- Use `authedAs(role)` from `tests/e2e/fixtures.ts` to start logged-in.
- The `mockSlack` fixture is on by default — every test stubs
  `https://slack.com/api/*` so we never call real Slack.
- Workers = 1 (DB safety). Don't try to parallelize.
- Reset DB state between specs by calling `resetAndSeedDb()` in a
  `test.beforeAll` if your spec needs a perfectly clean fixture.

## CI

See `.github/workflows/ci.yml`. The pipeline runs:

1. Drizzle schema-drift check (`db:generate` must produce zero diff)
2. Migrations + seed against a Postgres 16 service container
3. `lint` → `typecheck` → `test` (vitest) → `test:e2e` (Playwright)
4. Uploads the Playwright HTML report as an artifact on failure
