# Vaudit HR — Product Requirements

Internal HR management system for ~50 employees at Vaudit / BlokID. Production-grade, no placeholders, no mock data outside seed file.

## Tech stack (locked)
- Next.js 14+ App Router (full-stack, Route Handlers for APIs)
- TypeScript strict, no `any`
- PostgreSQL + Drizzle ORM (migrations + seed)
- NextAuth.js v5 + Google OAuth + Drizzle adapter
- shadcn/ui + Tailwind CSS, dark mode via next-themes
- TanStack Query v5
- React Hook Form + Zod
- Slack Web API (fetch, no Bolt SDK)
- Google Apps Script (external cron trigger for birthdays)
- Sonner toasts
- `react-d3-tree` for org chart
- No Redis, no file uploads, no rate limiting in v1

## Roles
- `EMPLOYEE` — own data, own requests. The default for everyone, including line managers.
- `HR_ADMIN` — full HR access + receives birthday DMs (via `SLACK_HR_ADMIN_SLACK_USER_ID`)
- `SUPER_ADMIN` — CEO/COO. All HR_ADMIN powers PLUS role management. Does NOT receive birthday DMs.

Manager status is NOT a role — it is derived structurally from `users.managerId`. Anyone whose `id` appears as someone else's `managerId` is that person's manager and can approve their requests. See ADR-0006 / decisions A19.

`requireAdmin = ['HR_ADMIN','SUPER_ADMIN']` for admin guards. `requireManagerOrAdmin = admin role OR session.user.isManager` for approval-tier surfaces. Birthday cron filters only `HR_ADMIN`.

## Data model
- **users** (merged with employees): id, firstName, lastName, email, phone, address, position, department, startDate, birthday (YYYY-MM-DD; A21), role (`EMPLOYEE | HR_ADMIN | SUPER_ADMIN`), managerId (self-ref FK; also the source of truth for "is this user a manager?"), slackUserId, isActive, image (NextAuth), emailVerified, createdAt, updatedAt
- **accounts** / **sessions** / **verificationTokens** — NextAuth managed
- **holidays**: id, date, name, createdAt — HR-managed list of company holidays (excluded from working-days calc)
- **leave_types**: id, name, description, defaultBalance, isPaid, color (hex), isActive
- **leave_balances**: id, employeeId, leaveTypeId, year, allocated, used — UNIQUE(employeeId, leaveTypeId, year)
- **leave_requests**: id, employeeId, leaveTypeId, startDate, endDate, totalDays (auto-calc, excludes weekends + holidays), reason, status (PENDING/APPROVED/REJECTED/CANCELLED), reviewedById, reviewedAt, reviewerNote, createdAt, updatedAt
- **wfh_requests**: id, employeeId, startDate, endDate, totalDays (auto-calc, excludes weekends + holidays; A20), reason, status, reviewedById, reviewedAt, reviewerNote, createdAt, updatedAt
- **notifications**: id, employeeId, type, message, link, isRead, createdAt
- **audit_logs**: id, actorId, action, targetTable, targetId, metadata (JSON), createdAt

## Seed
- 4 test accounts:
  - `ceo@vaudit.com` → SUPER_ADMIN
  - `admin@vaudit.com` → HR_ADMIN
  - `manager@vaudit.com` → EMPLOYEE, with Riley as a direct report (so "is manager" is true via the org chart)
  - `employee@vaudit.com` → EMPLOYEE (reports to manager@)
- 7 leave types — HR-supplied policy 2026-05-19 (per-year allocation in days): Annual 10, Sick 30, Holiday Leave 13, Personal 3, Paternity 120, Maternity 15, Unpaid (unlimited; `isPaid=false` so balance check bypasses). Renamed "Holiday" → "Holiday Leave" to disambiguate from the public-holidays calendar at `/holidays`. Stored internally as half-day units (×2) after migration 0006 — see ADR-0007.
- Balances for all 4 test users for current year
- Sample holidays (5–10 for current year)

## Auth flow
1. Google OAuth only, no passwords
2. NextAuth `signIn` callback:
   - Reject if email domain not in `ALLOWED_EMAIL_DOMAINS`
   - Lookup users by email
   - No match → reject with "Your account hasn't been set up yet, contact HR"
   - Match → `allowDangerousEmailAccountLinking: true` links Google identity to pre-staged row
3. Role read from DB on every session, never from Google
4. Audit-log first-time account link

## Leave & WFH flow
- Working days = (end - start + 1) − weekends − holidays from `holidays` table
- Validation: cannot exceed `allocated - used` for selected type (Unpaid exempt)
- Show remaining balance live in form before submit
- Status: PENDING → APPROVED / REJECTED / CANCELLED
- Cancellation:
  - Employee can cancel PENDING (no balance change) or APPROVED (refund balance, DM manager, audit)
- Bulk approve in approval queue
- HR_ADMIN / SUPER_ADMIN can override any request regardless of reporting line
- Deactivating an employee auto-cancels their PENDING requests + notifies them
- **Half-day leave + WFH (2026-05-19, supersedes A4)**: requests can be submitted as
  "Full day", "Morning only" (`FIRST_HALF`), or "Afternoon only" (`SECOND_HALF`).
  V1 scope: half-day applies to single-date requests only (multi-day ranges are
  full-day-only). Blocked for `Maternity` and `Paternity` leave types. Day-count
  storage is in half-day units everywhere (1 = half, 2 = full day) — never display
  raw `total_days` to users; always format via `formatDays()` ("Half day" / "1 day" /
  "1.5 days"). Overlap rule: morning leave + afternoon WFH on the same date is
  permitted; same-slot on the same date is not. See decision A22 + ADR-0007.

## HR Admin features
- Employee CRUD (add/edit/deactivate/reactivate)
- Auto-create balances on add (all active leave types, current year)
- Manual balance adjustments (audit-logged)
- **CSV bulk import** at `/admin/employees/import`:
  - Columns: firstName, lastName, email, phone, address, position, department, startDate, birthday, role, managerEmail, slackUserId
  - Template download
  - Server-side Zod validation per row, dry-run preview before commit
  - Two-pass: insert with null managerId → resolve managerEmail → managerId → cycle detection → balances
  - Existing email = skip or update (user picks per import)
- Audit log viewer page

## Org chart
- HR_ADMIN + SUPER_ADMIN + anyone with at least one direct report can view (`requireManagerOrAdmin`)
- `react-d3-tree` tree based on managerId
- Node: initials avatar, name, position, department
- Zoom/pan, expand/collapse, no overflow on mobile
- Self-management blocked, cycle detection on add/edit

## Notifications
Every event triggers BOTH a Slack DM AND an in-app notification row.
- Leave/WFH submitted → manager
- Leave/WFH approved/rejected → employee
- Leave/WFH cancelled by employee on APPROVED → manager (with refund note)
- Employee deactivated with PENDING requests → employee (auto-cancellation note)
- Birthday cron → HR_ADMIN only (Slack DM only, no in-app)

## Cron
- `POST /api/cron/birthdays` — Bearer `CRON_SECRET` auth
- Queries `users` where MM-DD(birthday) = today, isActive = true
- Sends one Slack DM per match to `SLACK_HR_ADMIN_SLACK_USER_ID`
- Message: warm note with employee name, position, department

## UI/UX
- Persistent collapsible sidebar, role-aware nav
- Top navbar: avatar, role badge, notification bell with unread count
- Dashboard cards: leave balances, pending requests count, upcoming approved leaves, "team on leave today" (managers/admins)
- DataTable on all lists (sort, filter, paginate)
- Skeleton loaders (not spinners)
- Empty-state components everywhere
- Mobile responsive, ARIA labels, full keyboard nav
- Initials avatar component (no uploads yet)

## Security
- Every API route: session check + role check + Zod validate body BEFORE any DB op
- Row-level guards: employees only see own data unless manager/admin
- Audit-log every sensitive action (employee CRUD, balance adjust, request override, role changes, first-time login link)
- `CRON_SECRET` Bearer on birthday cron
- No secrets in client bundle
- Rate limiting: skipped for v1

## Testing
- Vitest unit tests alongside each feature
- Playwright E2E for: auth flow, leave submission, approval, cancellation, balance adjustment, CSV import, org chart render
- CI fails if a feature lands without tests; no coverage % gate in v1

## Env vars
```
DATABASE_URL=
NEXTAUTH_SECRET=
NEXTAUTH_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ALLOWED_EMAIL_DOMAINS=vaudit.com,blokid.com
SLACK_BOT_TOKEN=
SLACK_HR_ADMIN_SLACK_USER_ID=
CRON_SECRET=
```