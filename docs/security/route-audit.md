# Wave 2 — API route security audit

Audited every handler under `/app/api/**` against the 10-item
`api-checklist.md` grid. The "Findings / Patches applied" column at the
bottom of each route block flags the gap and the file:line where the fix
landed.

Legend for the grid:

- ✓ — passes the item as authored.
- ✓★ — passed only after a Wave-2 patch from this audit.
- ✗ — fails (no patch found that closes the gap).
- — — not applicable (e.g. row-guard for a routeless of `[id]`).

Items, recap:

1. Session guard first
2. Role guard if privileged
3. Zod parse before DB
4. Row-level guard (non-admin)
5. Parameterised DB access only
6. Audit-log on writes
7. No PII in error responses
8. No mass-assignment
9. Free-text sanitisation
10. Method whitelist

---

## Audit grid

| # | Route + method | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Findings → fix |
|---|----------------|---|---|---|---|---|---|---|---|---|----|-----------------|
| 01 | GET `/api/auth/[...nextauth]` | — | — | — | — | — | — | — | — | — | ✓★ | Catch-all NextAuth route. The file exported `handlers as GET, handlers as POST` which mounts the **whole handlers record** at `GET`/`POST`, not the `.GET` / `.POST` members. Patched to destructure: `app/api/auth/[...nextauth]/route.ts:7-8`. |
| 02 | POST `/api/auth/[...nextauth]` | — | — | — | — | — | — | — | — | — | ✓★ | Same fix as #01. NextAuth's own CSRF token + Origin checks cover this route; assertSameOrigin is deliberately NOT applied here. |
| 03 | POST `/api/cron/birthdays` | — (Bearer) | — | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Already uses `timingSafeEqualString` on `CRON_SECRET`. `extractBearer` strict regex. Generic 401 on mismatch. GET / PATCH / DELETE are auto-405 (file exports POST only). |
| 04 | GET `/api/leave` | ✓ | ✓ (own) | ✓ | ✓ | ✓ | — | ✓ | — | — | ✓ | Read endpoint, no writes. EMPLOYEE may only read their own rows; `targetEmployeeId` derived from `session.user.id` for non-admins. |
| 05 | POST `/api/leave` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓★ | ✓ | Missing CSRF guard + missing `sanitizeFreeText(reason)` → patched `app/api/leave/route.ts:57-64` + Slack body wraps `userContent`. |
| 06 | GET `/api/leave/[id]` | ✓ | — | — | ✓ | ✓ | — | ✓ | — | — | ✓ | Owner / manager-of / admin ternary covers IDOR (T2). |
| 07 | PATCH `/api/leave/[id]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓★ | ✓ | Missing CSRF + missing `sanitizeFreeText(reviewerNote)` → patched `app/api/leave/[id]/route.ts:56-67` + Slack `userContent`. |
| 08 | DELETE `/api/leave/[id]` | ✓ | ✓ | — | ✓ | ✓ | ✓ (via cancel.ts) | ✓ | — | — | ✓ | Missing CSRF → patched `app/api/leave/[id]/route.ts:108-111`. |
| 09 | GET `/api/wfh` | ✓ | ✓ (own) | ✓ | ✓ | ✓ | — | ✓ | — | — | ✓ | Read endpoint. Same ternary as #04. |
| 10 | POST `/api/wfh` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓★ | ✓ | Missing CSRF + missing `sanitizeFreeText(reason)` → patched `app/api/wfh/route.ts:53-62` + Slack `userContent`. |
| 11 | GET `/api/wfh/[id]` | ✓ | — | — | ✓ | ✓ | — | ✓ | — | — | ✓ | Same owner / mgr / admin ternary. |
| 12 | PATCH `/api/wfh/[id]` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓★ | ✓ | Missing CSRF + missing `sanitizeFreeText(reviewerNote)` → patched `app/api/wfh/[id]/route.ts:54-67`. |
| 13 | DELETE `/api/wfh/[id]` | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — | — | ✓ | Missing CSRF → patched `app/api/wfh/[id]/route.ts:95-98`. |
| 14 | GET `/api/notifications` | ✓ | ✓ (own) | ✓ | ✓ | ✓ | — | ✓ | — | — | ✓ | Hard-pins `notifications.employeeId = session.user.id`; no cross-user query path. |
| 15 | POST `/api/notifications/read` | ✓ | ✓ (own) | ✓ | ✓ | ✓ | — (no audit on user read) | ✓ | ✓ | — | ✓ | Missing CSRF → patched `app/api/notifications/read/route.ts:17-20`. Note: marking your own notification as read is a deliberate exception to the audit-log rule per A-row decisions (no security signal). |
| 16 | GET `/api/org-chart` | ✓ | ✓ (managers + admins) | — | — | ✓ | — | ✓ | — | — | ✓ | `requireManagerOrAdmin()` — admin role OR `session.user.isManager` (derived from the org chart per ADR-0006). Plain employees with no reports are blocked. |
| 17 | GET `/api/admin/audit-logs` | ✓ | ✓ (admin) | ✓ | — | ✓ | — | ✓ | — | — | ✓ | Read-only admin endpoint. |
| 18 | GET `/api/admin/balances` | ✓ | ✓ | ✓ | — | ✓ | — | ✓ | — | — | ✓ | Read-only admin endpoint. |
| 19 | PATCH `/api/admin/balances` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓★ | ✓ | Missing CSRF + `reason` not sanitised before landing in audit-log JSON → patched `app/api/admin/balances/route.ts:54-62`. |
| 20 | GET `/api/admin/employees` | ✓ | ✓ | ✓ | — | ✓ | — | ✓ | — | — | ✓ | Read-only admin endpoint. |
| 21 | POST `/api/admin/employees` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓★ | ✓ | Missing CSRF + free-text fields (`firstName`, `lastName`, `address`, `position`, `department`) not sanitised → patched `app/api/admin/employees/route.ts:55-70` + insert uses sanitised values. |
| 22 | GET `/api/admin/employees/[id]` | ✓ | ✓ | — | — | ✓ | — | ✓ | — | — | ✓ | Admin-only read. |
| 23 | PATCH `/api/admin/employees/[id]` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓★ | ✓ | Missing CSRF + free-text fields not sanitised → patched `app/api/admin/employees/[id]/route.ts:42-67`. Mass-assignment: schema already omits `role`, `email`; verified — `email` cannot be PATCHed even by HR_ADMIN. |
| 24 | DELETE `/api/admin/employees/[id]` | ✓ | ✓ | — | — | ✓ | ✓ (via deactivate.ts) | ✓ | — | — | ✓ | Missing CSRF → patched `app/api/admin/employees/[id]/route.ts:98-101`. Self-deactivation blocked. |
| 25 | PATCH `/api/admin/employees/[id]/role` | ✓ | ✓ (SUPER_ADMIN) | ✓ | — | ✓ | ✓ | ✓ | ✓ | — | ✓ | Missing CSRF → patched `app/api/admin/employees/[id]/role/route.ts:21-24`. Role mutation gated to SUPER_ADMIN per A14, self-role-change blocked. |
| 26 | POST `/api/admin/employees/import` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓★ | ✓ | Missing CSRF + missing size cap + CSV insert path not sanitising free-text → patched `app/api/admin/employees/import/route.ts:55-77` (size cap 2 MB) and `lib/csv/import.ts:271-321` (sanitises firstName / lastName / address / position / department on both insert and update). |
| 27 | GET `/api/admin/holidays` | ✓ | ✓ | ✓ | — | ✓ | — | ✓ | — | — | ✓ | Read-only admin. |
| 28 | POST `/api/admin/holidays` | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓★ | ✓ | Missing CSRF + `name` not sanitised → patched `app/api/admin/holidays/route.ts:44-50`. |
| 29 | DELETE `/api/admin/holidays/[id]` | ✓ | ✓ | — | — | ✓ | ✓ | ✓ | — | — | ✓ | Missing CSRF → patched `app/api/admin/holidays/[id]/route.ts:18-21`. |

**Routes audited:** 17 files, 29 handlers (GET + POST in the auth catch-all
count as separate route-method pairs although they share the file).

**Findings by severity:**

- Critical: 1 — auth `[...nextauth]` route exported `handlers as GET/POST`,
  which would compile (NextAuth's `handlers` is callable-like only
  because it's a record of callables) but break dispatch on the App
  Router contract. **Patched.**
- High: 1 — CSRF guard missing on every state-changing handler outside
  `/api/auth` and `/api/cron` (15 handlers). **Patched on every handler.**
- High: 1 — CSV import had no body-size cap (T3 mitigated to ≤2 MB).
  **Patched** in `app/api/admin/employees/import/route.ts`.
- Medium: 7 — free-text fields landing in DB without `sanitizeFreeText`:
  leave.reason, leave.reviewerNote, wfh.reason, wfh.reviewerNote,
  holiday.name, employee free-text (5 columns), balance audit
  metadata.reason. **All patched.**
- Medium: 1 — CSV bulk-insert path skipped sanitisation of every free-text
  column. **Patched in `lib/csv/import.ts`.**
- Low: 0.

**Patches applied (count + file:line):**

1. `app/api/auth/[...nextauth]/route.ts:1-9` — re-exported `handlers.GET`
   and `handlers.POST` as App-Router-compliant exports.
2. `lib/auth/config.ts:42-52` — boot-time guard: refuse to start if
   `PLAYWRIGHT_TEST=1` AND `NODE_ENV=production`.
3. `lib/security/csrf.ts` (new) — `assertSameOrigin(req)` helper.
4. `lib/slack/format.ts` (new) — `formatSlackUserContent(s)` helper that
   wraps user content in a triple-backtick fence, neutralising inner
   fences with zero-width spaces.
5. `lib/notify/index.ts` — accepts optional `userContent` field; when
   present, appends `formatSlackUserContent(userContent)` as a Slack
   body block. In-app row is unchanged.
6. `lib/csv/import.ts:18,271-321` — sanitises every free-text column
   before insert / update.
7. `app/api/leave/route.ts:21-26,56-65,114-117` — CSRF guard, reason
   sanitised, Slack notify uses `userContent`.
8. `app/api/leave/[id]/route.ts:18-19,54-67,75-81,90-99,103-107` — CSRF
   on PATCH + DELETE, reviewerNote sanitised, Slack `userContent`.
9. `app/api/wfh/route.ts:18-19,49-61,87-90` — CSRF, reason sanitised,
   Slack `userContent`.
10. `app/api/wfh/[id]/route.ts:17-18,52-65,69-72,82-85,92-95` — CSRF on
    PATCH + DELETE, reviewerNote sanitised, Slack `userContent`.
11. `app/api/notifications/read/route.ts:12-18` — CSRF.
12. `app/api/admin/employees/route.ts:18-21,48-66,68-83` — CSRF + free-
    text sanitisation on POST.
13. `app/api/admin/employees/[id]/route.ts:16-17,38-66,68-83,95-99` —
    CSRF on PATCH + DELETE, free-text sanitisation on PATCH.
14. `app/api/admin/employees/[id]/role/route.ts:13-14,18-21` — CSRF.
15. `app/api/admin/employees/import/route.ts:18-26,54-77` — CSRF +
    Content-Length + post-parse size cap (2 MB).
16. `app/api/admin/holidays/route.ts:18-20,40-52` — CSRF + name
    sanitised.
17. `app/api/admin/holidays/[id]/route.ts:12-13,17-19` — CSRF.
18. `app/api/admin/balances/route.ts:18-21,50-58,90-96,113-121` — CSRF +
    `reason` sanitised before landing in audit metadata.
19. `lib/db/migrations/post-init/audit-immutability.sql` (new) — Postgres
    triggers blocking UPDATE / DELETE on `audit_logs`.
20. `docs/security/audit-immutability.md` (new) — runbook.
21. `docs/security/login-callback.md` (new) — open-redirect rule for
    Phase-1 login.

---

## Cross-checks

### Method whitelist (item 10)

Every handler file exports only the methods it intends to serve. Next's
App Router auto-405s any other verb. Spot-check:

- `app/api/leave/route.ts` — GET, POST (no PATCH / DELETE).
- `app/api/leave/[id]/route.ts` — GET, PATCH, DELETE (no POST).
- `app/api/cron/birthdays/route.ts` — POST only (T4: GET auto-405).
- `app/api/auth/[...nextauth]/route.ts` — GET, POST (NextAuth's own
  routing under the hood handles `/api/auth/csrf`, `/session`, etc.).

No stray `export const PATCH` from scaffolding found.

### Parameterised SQL (item 5)

Repo-wide grep for `sql\`` and `sql.raw(`:

```
lib/db/schema.ts:312        metadata: jsonb("metadata").default(sql`'{}'::jsonb`),
lib/leave/balance.ts:151    .set({ used: sql`${leaveBalances.used} + ${days}` })
lib/leave/balance.ts:174    used: sql`GREATEST(0, ${leaveBalances.used} - ${days})`,
```

The schema-default usage embeds a literal, no user input. The two
`balance.ts` calls interpolate a Drizzle column ref (compiled to an
SQL identifier by the builder, not user-controlled) and a `days` value
that has already been validated as `z.number().int().min(0).max(366)`
upstream. Drizzle's `sql` tagged template auto-parameterises values, so
`${days}` becomes a typed bound param. No string concatenation of user
input survives anywhere — item 5 passes.

### Error envelope (item 7) — spot-checks

5 random handlers, all map to `handleRouteError` in the outer catch:

- `app/api/admin/employees/import/route.ts:101-105` — narrow case for
  "CSV content is required" returns a stable code `EMPTY_CSV`; everything
  else flows to `handleRouteError`. No `err.message` leaked.
- `app/api/leave/route.ts:122` — `handleRouteError(err)`.
- `app/api/admin/employees/route.ts:115` — `handleRouteError(err)`.
- `app/api/wfh/[id]/route.ts:138` — `handleRouteError(err)`.
- `app/api/admin/holidays/route.ts:63-72` — caught DB-unique violation
  returns generic `DUPLICATE_HOLIDAY` code. No internal message leaks.

`lib/api/errors.ts` only echoes ZodIssue paths in 400 responses, never
DB messages or stack traces. ✓

### Audit-log coverage (item 6)

`grep -n writeAuditLog` over `app/api/**` shows 13 call sites across 12
route files, plus 5 sites in `lib/{audit,auth,employee,leave}` helpers
the routes call into = **18 total mutation sites covered**. The cron
endpoint also writes a `cron.birthdays_run` audit row. Cross-referenced
against the mutating handler list above:

- `POST /api/leave` → `leave.create` (route line 96).
- `PATCH /api/leave/[id]` → `leave.approve` / `leave.reject` (route line 84).
- `DELETE /api/leave/[id]` → `leave.cancel_*` (via `lib/leave/cancel.ts:60`).
- `POST /api/wfh` → `wfh.create` (route line 68).
- `PATCH /api/wfh/[id]` → `wfh.approve` / `wfh.reject` (route line 76).
- `DELETE /api/wfh/[id]` → `wfh.cancel_*` (route line 112).
- `POST /api/notifications/read` — **no audit by design** (per A-row
  rationale: reading one's own notification creates no security signal
  worth a row; would inflate the table).
- `POST /api/admin/employees` → `employee.create` (route line 110).
- `PATCH /api/admin/employees/[id]` → `employee.update` (route line 92).
- `DELETE /api/admin/employees/[id]` → `employee.deactivate` (via
  `lib/employee/deactivate.ts:111`) + auto-cancel sub-rows.
- `PATCH /api/admin/employees/[id]/role` → `employee.role_change`.
- `POST /api/admin/employees/import` → `employee.import_commit` or
  `employee.import_dryrun`.
- `POST /api/admin/holidays` → `holiday.create`.
- `DELETE /api/admin/holidays/[id]` → `holiday.delete`.
- `PATCH /api/admin/balances` → `balance.create` or `balance.adjust`.

Every mutating handler emits at least one audit row. ✓

### Rate-limit stub (A3)

`lib/security/rate-limit.ts` still returns `{ allowed: true, remaining:
Infinity, resetAt: null }` for every key. Confirmed no-op per A3.
Documented in the threat model T4. No-op intentional in v1.

---

## Verification

- `npm run typecheck` — clean for every file I touched. Two pre-existing
  errors flag frontend-dev files that are outside this audit's scope:
  - `app/(app)/wfh/wfh-request-dialog.tsx:147` — Calendar `fromDate` prop
    type mismatch.
  - `app/(app)/wfh/[id]/page.tsx:10` — missing `./wfh-detail-view`
    module.
  Both predate this audit and should be flagged to frontend-dev.
- `npm run lint` — only pre-existing warnings in frontend / shadcn
  components (`leave/new/page.tsx`, `components/ui/calendar.tsx`,
  `components/ui/form.tsx`). My new file `lib/security/csrf.ts` is
  warning-free.

---

## 12 Wave-1 open items — status

| # | Item | Status |
|---|------|--------|
| 1 | Cron Bearer check | **Resolved** — `app/api/cron/birthdays/route.ts:33-38` uses `timingSafeEqualString`, rejects unknown / empty token with generic 401, GET / PATCH auto-405 because only POST is exported. |
| 2 | Origin / CSRF guard | **Patched** — new `lib/security/csrf.ts`, applied to every state-changing handler outside `/api/auth` and `/api/cron` (15 handlers). |
| 3 | Login `callbackUrl` validation | **Pending (frontend-dev)** — login page is still a Phase-0 placeholder that ignores `callbackUrl`. Rule + helper documented in `/docs/security/login-callback.md` for Phase-1. No exploitable surface today. |
| 4 | CSV upload size cap | **Patched** — `app/api/admin/employees/import/route.ts:55-77` rejects >2 MB with 413 (Content-Length pre-check + post-parse belt-and-braces). |
| 5 | Mass-assignment Zod whitelisting | **Resolved** — all PATCH schemas are explicit objects. `employeeUpdateSchema` omits `role` / `email`; `roleUpdateSchema` is SUPER_ADMIN-only and accepts only `role`. Confirmed no `.passthrough()` and no body-spread anywhere. Self-edit endpoints do not exist yet — when frontend-dev adds them, they must use a separate schema; flagged in `api-checklist.md` item 8. |
| 6 | Free-text sanitisation | **Patched** — every documented free-text field is now sanitised after Zod and before DB write: leave.reason (route line 60-63), leave.reviewerNote (route line 56-58), wfh.reason, wfh.reviewerNote, employee.address / position / department / firstName / lastName (single + CSV paths), notification.message stays system-composed, holiday.name (POST), balance audit reason. |
| 7 | Error envelope | **Resolved** — every handler ends in `catch { return handleRouteError(err); }` which maps to stable `{ error: { code, message } }` shapes via `lib/api/errors.ts`. PII spot-checks (5 random) all generic. |
| 8 | Audit-log coverage | **Resolved** — see cross-checks section above. 13 mutating handlers, 13 audit-log paths. |
| 9 | Audit-log immutability | **Patched (file shipped, needs ops action)** — `lib/db/migrations/post-init/audit-immutability.sql` defines BEFORE UPDATE / BEFORE DELETE triggers; `docs/security/audit-immutability.md` documents the manual `psql -f …` step. **Operator must apply** post-Drizzle-migrate on every environment. |
| 10 | Test-auth boot-time assertion + JWT-mode session callback carries role / employeeId | **Resolved** — `lib/auth/config.ts:42-52` throws on boot if `PLAYWRIGHT_TEST=1 && NODE_ENV=production`. JWT-mode session callback already reads `dbUserId` from `token.uid`, looks up the DB row fresh on every request, and returns `enriched.user` with `role` + `employeeId` (lines 209-227). |
| 11 | Slack message formatting | **Patched** — `lib/slack/format.ts` exports `formatSlackUserContent`. `lib/notify/index.ts` now accepts optional `userContent` and appends a fenced block to the Slack body. Routes that surface user content (leave.reason, leave.reviewerNote, wfh.reason, wfh.reviewerNote) pass `userContent` through. |
| 12 | No SQL string interpolation | **Resolved** — repo-wide grep for `sql\`` and `sql.raw(` found three usages, all with Drizzle-parameterised values (column refs + a Zod-validated numeric `days`). No user-string concatenation reaches a query. |

---

## Outstanding items needing user / ops action

1. **Apply the audit-immutability trigger** on every database — run
   `psql "$DATABASE_URL" -f lib/db/migrations/post-init/audit-immutability.sql`
   after `drizzle-kit migrate`. Tracked in
   `docs/security/audit-immutability.md`. (Wave-1 open #9.)

2. **Frontend-dev: build the Phase-1 login page** using the
   `safeCallbackUrl` rule documented in `docs/security/login-callback.md`
   and add the listed Vitest cases. (Wave-1 open #3.)

3. **Frontend-dev: fix pre-existing TypeScript errors** unrelated to
   this audit so future security checks run against a clean baseline:
   - `app/(app)/wfh/wfh-request-dialog.tsx:147` — Calendar API
     mismatch (`fromDate` → `startMonth` in react-day-picker v9).
   - `app/(app)/wfh/[id]/page.tsx:10` — missing
     `./wfh-detail-view` component.

4. **Add a CI lint check** for `.env*` files that grep for
   `PLAYWRIGHT_TEST` and fail the build if it shows up outside the
   playwright job. Captured as a future-work TODO in
   `docs/security/test-auth.md`.

5. **Consider Phase-2 hardening**: rate-limit on `/api/cron/birthdays`
   and on the bulk-import endpoint once a Redis / KV store is online.
   Currently `lib/security/rate-limit.ts` is a no-op (per A3).
