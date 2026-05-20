# Decisions log

Architectural decisions ratified before kickoff (2026-05-12). Source of truth — agents must respect these.

## A1. Working days exclude weekends + public holidays
Holidays table (HR-managed). Util `calcWorkingDays(start, end)` lives in `lib/leave/working-days.ts`.

## A2. Notifications fan-out: Slack DM + in-app
Both delivered for every employee-facing event. Single `notifyEmployee(opts)` helper writes the `notifications` row AND fires the Slack DM. Errors in Slack must NOT block the DB write.

## A3. Rate limiting skipped for v1
No middleware. Hook point reserved in `lib/security/rate-limit.ts` (no-op now) so we can add later without refactor.

## A4. Half-day leave: NOT supported in v1
Integer `totalDays`. No fractional balance math. **Superseded by A22 (2026-05-19)** — half-day support is now live via a half-day-unit shift; see ADR-0007 and decision A22 below.

## A5. Org chart library: `react-d3-tree`
Lightweight, zoom/pan/collapse built-in. Not React Flow.

## A6. Photos: initials avatar component
No upload yet. `<Avatar />` component generates initials + deterministic color from name. Future-proof for image URL.

## A7. Leave year = calendar year
Jan 1 – Dec 31. Year-end rollover policy is OUT OF SCOPE for v1.

## A8. Employee can cancel PENDING and APPROVED requests
- PENDING cancel → status change, no balance change, notify nobody
- APPROVED cancel → status change, refund balance (`used -= totalDays`), DM the reviewer, in-app notify employee, audit-log

## A9. Deactivating employee auto-cancels PENDING requests
Transaction: set `isActive=false`, cancel all their PENDING leave + WFH, notify employee with cancellation reason "account deactivated".

## A10. Self-management + cycle detection enforced server-side
- `managerId !== id`
- Walk up the chain on every create/update; reject if would create a cycle
- Applies to both single edit AND CSV bulk import

## A11. Birthday DM → HR_ADMIN only
SUPER_ADMIN never receives bday DMs. Cron filters `role = 'HR_ADMIN'` AND uses `SLACK_HR_ADMIN_SLACK_USER_ID` env var as the DM target (single configured HR person).

## A12. App name: "Vaudit HR"
Used in page titles, navbar branding, Slack message header.

## A13. Tests required per feature, no coverage % gate in v1
Each feature PR must include Vitest + (where applicable) Playwright tests. No coverage minimum enforced — will revisit post-Phase 7.

## A14. SUPER_ADMIN role added
4-role enum: `EMPLOYEE | MANAGER | HR_ADMIN | SUPER_ADMIN`. SUPER_ADMIN = HR_ADMIN superset + can change roles. **Superseded by A19**: the enum is now 3 roles (`EMPLOYEE | HR_ADMIN | SUPER_ADMIN`); manager status is derived from the org chart.

## A15. Auth: pre-staged users, email-link on first sign-in
- HR creates user row in DB (no OAuth account)
- NextAuth `signIn` callback rejects if domain disallowed OR no user row with that email
- `allowDangerousEmailAccountLinking: true` on Google provider — safe because we own the domain restriction
- Merged users table (NextAuth users + employee HR fields in one table)

## A16. CSV bulk import flow
Two-pass insert: rows first (managerId null) → resolve `managerEmail → managerId` → cycle check → auto-create balances. Dry-run preview before commit. Existing-email policy chosen per import.

## A17. Folder structure (architect to finalize, but baseline)
```
/app                 — Next.js App Router pages + route handlers
  /(auth)            — login
  /(app)             — authenticated layout group
    /dashboard
    /leave
    /wfh
    /approvals       — manager/admin
    /admin           — HR_ADMIN / SUPER_ADMIN only
      /employees
      /employees/import
      /balances
      /audit-log
      /holidays
    /org-chart
  /api
    /auth/[...nextauth]
    /leave
    /wfh
    /admin
    /cron/birthdays
    /notifications
/components          — UI components (shadcn re-exports in /ui)
  /ui                — shadcn primitives
  /forms             — RHF + Zod form components
  /tables            — DataTable + presets
  /layout            — Sidebar, Navbar, Shell
/lib
  /db                — Drizzle client + schema + migrations
  /auth              — NextAuth config + guards (requireSession, requireRole)
  /leave             — working-days, balance, validation
  /slack             — Slack client + DM helpers
  /notify            — unified notifyEmployee
  /audit             — audit-log writer
  /validation        — shared Zod schemas
/tests
  /unit              — Vitest
  /e2e               — Playwright
/scripts
  /seed.ts
/docs
  /prd.md
  /decisions.md
  /adrs              — ADR-0001, ADR-0002, ...
```

## A18. Type safety
- TS strict, `noUncheckedIndexedAccess: true`
- No `any` — use `unknown` + Zod parsing at boundaries
- Drizzle infers types; never duplicate types between DB schema and Zod (use `createSelectSchema` / `createInsertSchema`)

## A19. MANAGER dropped as a role; derived from the org chart
See ADR-0006. The `user_role` enum is now `EMPLOYEE | HR_ADMIN | SUPER_ADMIN`. "Is this user a manager?" is `EXISTS (SELECT 1 FROM users WHERE manager_id = me)` and rides on the session as `isManager: boolean`. Approval permission becomes: admin role OR `request.employee.managerId === viewer.id`. Eliminates the drift between `users.role = 'MANAGER'` and the actual `managerId` graph. Supersedes A14's implication that MANAGER is a categorical role.

## A20. WFH is a date range, not a single day
WFH requests now mirror leave requests: `start_date`, `end_date`, `total_days` (working-day count). Single-day WFH is the special case where `start_date === end_date` and `total_days === 1`. Migration `0004_wfh_date_range` widens the schema and backfills existing rows. Rationale: employees plan WFH in stretches; one row + one approval matches the mental model and matches the leave flow.

## A21. Birthday is full YYYY-MM-DD, not MM-DD
`users.birthday` widened from `varchar(5)` MM-DD to `varchar(10)` YYYY-MM-DD. The daily cron extracts the MM-DD tail via `LIKE '%-MM-DD'`. Migration `0002_wide_killer_shrike` widens the column; old MM-DD values are inert (won't match the cron) and are re-entered via the date picker on next employee edit.

## A22. Half-day leave + WFH (2026-05-19)
Reverses A4. Day-count atomic unit shifted from "1 day" to "1 half-day" across `leave_balances` (`allocated`, `used`), `leave_requests.total_days`, and `wfh_requests.total_days`. Integer columns retain their types; only the meaning changes (2 = full day, 1 = half day). New columns on `leave_requests` + `wfh_requests`: `is_half_day BOOLEAN NOT NULL DEFAULT false` and `half_day_slot TEXT NULL` (values: `FIRST_HALF`, `SECOND_HALF`). DB-level `chk_leave_half_day` / `chk_wfh_half_day` CHECK constraints enforce the invariants `(is_half_day=false ⇒ slot null) OR (is_half_day=true ⇒ slot ∈ {FIRST_HALF, SECOND_HALF} AND start_date = end_date)`.

V1 scope: half-day applies to **single-date** requests only. Multi-day ranges remain full-day-only. First/last-day-half on a range deferred to V2 (no further schema change required).

Policy gates:
  - Half-day is **blocked** on `Maternity` and `Paternity` leave types (`isHalfDayAllowedForLeaveType`). All other paid types (Annual, Sick, Holiday Leave, Personal) and Unpaid permit half-day.
  - Overlap rule (`lib/leave/overlap.ts` + `overlap-pure.ts`): full × full = conflict on any shared date; full × half = conflict when the half-day date is in the full range; half × half same-slot = conflict, half × half different-slot = OK (so morning-leave + afternoon-WFH on the same date is permitted).

Migration `0006_half_day_unit_shift.sql` is **atomic**: schema additions + `*2` backfill + CHECK installation all ride in a single transaction so there is no window where the columns exist but rows still carry day-units (which would make the dashboard read half what it should).

Display: every UI day-count goes through `formatDays(halfDays)` (`lib/utils/format-days.ts`) — "Half day" / "1 day" / "1.5 days". `formatDaysWithSlot` appends `· Morning` / `· Afternoon` on detail views. Direct interpolation of `totalDays` into copy is a bug. See ADR-0007 for the rationale, alternatives considered, and forward path.