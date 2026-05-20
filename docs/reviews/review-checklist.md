# Review checklist — operational

Reviewer's working checklist for Phase 0 + Wave 1. Carry-forward into all
later waves.

## Severity rubric

| Severity   | Meaning                                                                |
| ---------- | ---------------------------------------------------------------------- |
| `block`    | Merge-blocker. Security, correctness, or PRD/decisions.md violation.   |
| `changes`  | Must be fixed in this wave but not merge-blocking on its own.          |
| `nit`      | Style, naming, redundancy. Land in this or next PR.                    |
| `praise`   | Worth highlighting so the pattern propagates.                          |

## Hard rules (no exceptions)

- **Never** approve `: any`, `as any`, or `<any>` outside `/components/ui`.
- **Never** approve a route without `requireSession` / `requireRole` /
  Bearer-CRON guard as the first awaited statement.
- **Never** approve a feature lacking either Vitest or Playwright tests
  (per A13). Phase 0 + Wave 1 lib helpers must ship with unit tests.
- **Never** approve UI lacking skeleton + empty-state coverage.

## Schema (`lib/db/schema.ts`)

- 11 PRD tables present (users, accounts, sessions, verificationTokens,
  holidays, leave_types, leave_balances, leave_requests, wfh_requests,
  notifications, audit_logs).
- `userRoleEnum` = 4 values; `requestStatusEnum` = 4 values.
- FKs on every `*_id` column; UNIQUE on
  `(employeeId, leaveTypeId, year)`.
- drizzle-zod `insertX` / `selectX` exported per table.
- `npm run db:generate` produces zero diff against the committed SQL.

## Auth (`lib/auth/config.ts`)

- Domain allow-list runs BEFORE DB lookup.
- Missing user row → reject.
- `allowDangerousEmailAccountLinking: true` is justified inline.
- Role from DB on every session evaluation. JWT mode (test only)
  re-reads the DB row in the session callback.
- First-time link audit-logged exactly once (gated on `priorLink` lookup).
- Test-auth provider gated by `PLAYWRIGHT_TEST=1`, never on in prod.
- Deactivated user rejected in both `signIn` and `session` callbacks.

## API routes (every `app/api/**/route.ts`)

1. `requireSession` / `requireRole` / Bearer is FIRST awaited statement.
2. Role guard matches PRD threat model for that route.
3. Zod schema (from `/lib/validation/common.ts`) parses body and query
   BEFORE any DB read/write.
4. Row-level guard (`isOwn || isManagerOf || isAdmin`) on per-id routes.
5. Only typed Drizzle builder or `sql` with placeholders — never string
   interpolation.
6. `writeAuditLog` on every successful mutating request.
7. `notifyEmployee` on every PRD-mandated event (Notifications §).
8. Idempotent guards: PATCH approve/reject rejects with 409 if not
   PENDING. Cancel rejects 409 if already CANCELLED/REJECTED.
9. Error bodies generic (`apiError` codes) — no PII of other users.
10. Free-text fields run through `sanitizeFreeText` before insert.
11. Method exports are tight (no stray exports left over).
12. File ≤500 lines.

## Components (`components/` excluding `/ui`)

- Type-safe props, generic where useful (`DataTable<T>`).
- Tailwind tokens only (no hardcoded `#abc` magic colors).
- CVA variants for badges / shells where applicable.
- ARIA labels + full keyboard support (Tab, Enter, Esc).
- Server vs client split correct (`"use client"` only where needed).
- File ≤200 lines.
- Dark mode + mobile layout verified.

## Security infra

- `middleware.ts` matcher excludes `_next`, static-asset extensions, and
  public prefixes `/login`, `/api/auth`, `/api/cron`, `/favicon.ico`.
- `next.config.mjs` headers: XFO=DENY, X-Content-Type-Options=nosniff,
  Referrer-Policy, Permissions-Policy, CSP with `frame-ancestors 'none'`.
- `sanitize.ts` strips `<script>` / `<style>`, inline `on*=` handlers,
  neutralises `javascript:` / `data:` / `vbscript:` URIs, HTML-encodes
  angle brackets, clamps to 5,000 chars.
- `constant-time.ts` uses `crypto.timingSafeEqual` with
  length-equalisation; rejects empty inputs.
- `cycle-detect.ts` handles self-management + bounded depth + treats a
  pre-existing cycle as a cycle.
- `csrf.ts` (`assertSameOrigin`) used on every state-changing browser
  route except `/api/auth/*` and `/api/cron/*`.

## Tests

- `vitest.config.ts` happy-dom, path alias `@`, setup file, no coverage
  gate (A13).
- `playwright.config.ts`: `workers: 1`, `globalSetup`, PLAYWRIGHT_TEST=1
  set on `webServer.env`.
- Test-auth provider double-gated: env-flag at module load AND inside
  `authorize()`.
- CI yaml has postgres service, migrate, seed, lint, typecheck, vitest,
  Playwright steps. Drizzle drift check present.
- No `setTimeout` / `sleep` in tests (rely on Playwright `expect.toHave*`
  retries).
- DB tests use real Postgres + `withDbTransaction` rollback.

## Decisions.md adherence (snapshot)

| Decision | Status |
| -------- | ------ |
| A1 working-days weekday-only minus holidays | implemented + unit tested |
| A2 notify fan-out, Slack failure non-blocking | implemented + unit tested |
| A3 rate-limit stub | present, returns `allowed:true` |
| A4 no half-days | `totalDays` is `integer` |
| A5 react-d3-tree in package.json | `^3.6.6` |
| A6 initials avatar | `components/avatar.tsx` |
| A7 calendar year | `body.startDate.getFullYear()` used everywhere |
| A8 cancel pending vs approved | `lib/leave/cancel.ts` |
| A9 deactivate auto-cancel | `lib/employee/deactivate.ts` |
| A10 cycle detection (single + CSV) | both paths covered |
| A11 birthday DM → HR_ADMIN only | cron uses `SLACK_HR_ADMIN_SLACK_USER_ID` |
| A12 app name "Vaudit HR" | layout.tsx metadata + sidebar brand |
| A13 tests required, no coverage gate | enforced; coverage disabled |
| A14 SUPER_ADMIN role | enum + role-change route requires SUPER_ADMIN |
| A15 pre-staged + email link | signIn callback enforces it |
| A16 CSV two-pass + dry-run | `lib/csv/import.ts` |
| A17 folder structure | mirrors decisions.md exactly |
| A18 type safety (strict + no any) | tsconfig strict + `noUncheckedIndexedAccess` |

## Verdict template

```
✅ APPROVED | 🟡 APPROVED WITH NITS | 🔴 CHANGES REQUESTED

Findings:
1. [severity] file:line — observation. Recommended fix.
…
```
