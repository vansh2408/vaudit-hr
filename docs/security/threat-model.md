# Vaudit HR — Threat Model (STRIDE)

Scope: the v1 HR app described in `docs/prd.md`. Trust boundaries are
(1) the public internet → Next.js edge, (2) Next.js server → Postgres,
(3) Next.js server → Slack API, (4) Google Apps Script cron → Next.js
`/api/cron/birthdays`. NextAuth holds the user-session boundary.

Severity legend: **Critical / High / Medium / Low** (DREAD-weighted —
damage × reproducibility × exploitability × affected-users × discoverability).

Mitigation references point at the exact code path that enforces them.

---

## T1. OAuth account linking — stolen-email takeover

- **STRIDE:** Spoofing (S), Information disclosure (I)
- **Scenario:** Attacker obtains a victim's email at `vaudit.com` (e.g.
  via Google Workspace compromise or an HR mistake re-using an old
  address). Because `allowDangerousEmailAccountLinking: true` is enabled,
  any Google identity that returns that email address would be bound to
  the pre-staged HR row, granting whatever role the row carries.
- **Severity:** High
- **Mitigations:**
  - Domain allow-list enforced in `lib/auth/config.ts:signIn` before any
    DB lookup (`ALLOWED_EMAIL_DOMAINS`).
  - Pre-staged-row requirement: no DB row → sign-in refused
    (`lib/auth/config.ts:84`).
  - Deactivated rows refused (`lib/auth/config.ts:isActive` check,
    Wave 1 patch).
  - First-time link is audit-logged (`auth.first_link`) so HR sees an
    alert if an unexpected identity binds to a sensitive row.
  - **Open:** Google Workspace itself is the root of trust; loss of an
    admin account at the Workspace tier is out of scope. Document in
    `docs/security/secrets.md`.

---

## T2. IDOR on `/api/leave/[id]`, `/api/wfh/[id]`, `/api/admin/*`

- **STRIDE:** Elevation of Privilege (E), Tampering (T), I
- **Scenario:** Authenticated EMPLOYEE iterates `id` parameters to read
  or mutate another employee's leave/WFH request, or hits an admin route
  to escalate role.
  - Horizontal: employee A reads/cancels employee B's request.
  - Vertical: any non-admin POSTs to `/api/admin/employees` to create or
    edit a row.
- **Severity:** Critical
- **Mitigations:**
  - Every route handler must call `requireSession` then either
    `requireRole(...)` or perform a row-level ownership check
    (`employeeId === session.user.id` or manager-of relationship).
    Captured in `docs/security/api-checklist.md` items 1–4.
  - Admin routes mounted under `/api/admin/*` must call
    `requireAdmin()` (`HR_ADMIN | SUPER_ADMIN`) as the first statement.
  - Role-mutation endpoints (Phase 6) must additionally restrict to
    `SUPER_ADMIN` per decisions.md A14.
  - Middleware (`/middleware.ts`) is **not** an authorization layer — it
    only rejects anonymous traffic; per-route guards remain mandatory.
  - **Wave 2 audit task:** grade every handler in `app/api/**` against
    `api-checklist.md`.

---

## T3. CSV bulk import — injection, pollution, oversize

- **STRIDE:** T, I, Denial of Service (D), E
- **Scenario:**
  1. **Formula injection:** an attacker submits `=cmd|'/c calc'!A1` in
     `firstName`. When the audit log or a future export is opened in
     Excel/Sheets, the formula executes on the analyst's machine.
  2. **Prototype pollution:** crafted column names (`__proto__`,
     `constructor`) confuse a naïve `Object.assign`-style row builder.
  3. **Oversized upload:** a 100 MB CSV exhausts server memory.
  4. **Stored XSS:** raw values flow into Slack DMs or notification
     bodies without escaping.
- **Severity:** High
- **Mitigations:**
  - Per-row Zod schema (decisions.md A16) — only the documented columns
    are accepted; everything else is dropped at parse time. Schema must
    explicitly enumerate fields (no `passthrough`).
  - Free-text columns (`address`, `position`, `department`,
    `firstName`, `lastName`, etc.) pass through `sanitizeFreeText`
    (`lib/security/sanitize.ts`) before insert.
  - Cells beginning with `=`, `+`, `-`, `@`, `\t`, `\r` MUST be prefixed
    with a single-quote on any future CSV export. (Tracked as an
    open issue for the export path — no exporter exists in v1.)
  - Drizzle parameterised queries prevent SQL-side injection.
  - Multer/Next route body-size cap: enforce ≤ 2 MB CSV in the upload
    handler. (Open issue for backend-dev — Wave 2.)
  - Two-pass insert with `managerEmail` resolution and cycle detection
    via `lib/security/cycle-detect.ts` (decisions.md A10/A16).

---

## T4. Birthday cron — unauthenticated trigger

- **STRIDE:** S, I, D
- **Scenario:** Anonymous attacker hits `POST /api/cron/birthdays`.
  Without auth, the handler queries the entire user table (PII —
  birthday, position, department, Slack ID) and spams Slack DMs to HR.
- **Severity:** High
- **Mitigations:**
  - Middleware allows `/api/cron/*` through unauthenticated (no NextAuth
    session needed) BUT the handler MUST verify `Authorization: Bearer
    <CRON_SECRET>` using `timingSafeEqualString` from
    `lib/security/constant-time.ts`.
  - Bare 401 response — no PII echoed even in error.
  - Rate-limit hook reserved (`lib/security/rate-limit.ts`); no-op in v1
    per decisions.md A3 but slot is wired for Phase ≥ 2.
  - Cron MUST be POST only — middleware does not differentiate, the
    route handler must reject GET.
  - **Open:** consider IP-allowlisting Apps Script egress when Google
    publishes a stable CIDR range; today, the secret is the only gate.

---

## T5. NextAuth session forgery

- **STRIDE:** S, T
- **Scenario:** Attacker forges a session cookie or replays an expired
  one to impersonate a user.
- **Severity:** High
- **Mitigations:**
  - `session.strategy = "database"` (`lib/auth/config.ts:60`) — sessions
    are random opaque tokens looked up in `sessions` table; not JWTs that
    could be tampered with given the secret.
  - `NEXTAUTH_SECRET` mandated by NextAuth; absence breaks boot.
  - Role read on every session lookup from DB (`lib/auth/config.ts`
    `session` callback) — not pinned in the cookie. A revoked role takes
    effect immediately on the next request.
  - Deactivation kills sessions implicitly: `session` callback drops the
    `user.id` for `isActive=false` rows, so `requireSession()` throws.
  - Cookies are HTTPOnly + Secure + SameSite=Lax by NextAuth default.

---

## T6. PII leakage in error responses

- **STRIDE:** I
- **Scenario:** A route handler catches a DB error and returns the raw
  message (e.g. "duplicate key on email=alice@vaudit.com") to the
  client, leaking that the email exists.
- **Severity:** Medium
- **Mitigations:**
  - Route handlers MUST return generic 4xx/5xx bodies. Detail strings
    go to server logs only. Captured as item 7 in
    `docs/security/api-checklist.md`.
  - `UnauthorizedError` / `ForbiddenError` already carry safe messages
    (`lib/auth/guards.ts`).
  - Wave 2 audit: confirm every handler maps thrown errors to
    `{ error: "Bad request" | "Forbidden" | "Internal error" }` JSON.

---

## T7. Audit-log tampering

- **STRIDE:** Repudiation (R), T
- **Scenario:** An attacker who reaches DB credentials edits or deletes
  `audit_logs` rows to cover their tracks. Or an HR_ADMIN abuses their
  legitimate write access to erase a damning row.
- **Severity:** Medium
- **Mitigations:**
  - No app-level UPDATE/DELETE path exists for `audit_logs` —
    `lib/audit/log.ts` exposes `writeAuditLog` (insert only). Reviewer
    checks should flag any direct Drizzle access to the table.
  - Schema gives `audit_logs.id` a UUID PK and an immutable `createdAt`.
  - **Open:** add a Postgres trigger or row-level policy (RLS) to
    refuse UPDATE/DELETE on `audit_logs` from the application role.
    Tracked as a Phase 2 improvement.
  - **Open:** ship audit rows to an external sink (S3 / SIEM) for
    forensic durability. Out of scope for v1.

---

## T8. Mass-assignment in PATCH endpoints

- **STRIDE:** E, T
- **Scenario:** `PATCH /api/admin/employees/[id]` accepts a partial body
  and merges it into the row. A non-admin (or a self-edit form) submits
  `{ role: "SUPER_ADMIN", managerId: null }` and the handler blindly
  writes those columns.
- **Severity:** Critical
- **Mitigations:**
  - Every mutating handler parses the body through a
    `createInsertSchema`-derived Zod schema that EXPLICITLY enumerates
    the writable columns (no `.passthrough()`, no spread of unvetted
    objects into Drizzle `.values()`).
  - Self-edit endpoints use a separate "profile" Zod schema that omits
    `role`, `managerId`, `isActive`, `email`.
  - Role mutation is gated on `SUPER_ADMIN` per A14.
  - Captured as item 8 in `docs/security/api-checklist.md`.

---

## T9. CSRF on state-changing routes

- **STRIDE:** T, E
- **Scenario:** A logged-in user is induced to visit a malicious site
  that POSTs to `/api/leave` etc. on their behalf.
- **Severity:** Medium
- **Mitigations:**
  - NextAuth session cookie defaults to `SameSite=Lax`, which blocks
    cross-site POSTs except top-level form GETs.
  - All state-changing routes are JSON-only (no
    `application/x-www-form-urlencoded` handling); browsers send
    `Origin` headers on cross-origin fetches and the route handler
    should reject when `Origin` is present and not same-origin.
    (Open issue: codify the Origin check in a small `assertSameOrigin`
    helper for Wave 2.)
  - CSP `form-action 'self' https://accounts.google.com` blocks form
    submissions to third-party origins.

---

## T10. Clickjacking

- **STRIDE:** T, S
- **Scenario:** App is framed by a malicious site; the user is tricked
  into clicking through approval / cancellation actions.
- **Severity:** Low
- **Mitigations:**
  - `X-Frame-Options: DENY` (`next.config.mjs`).
  - CSP `frame-ancestors 'none'` (`next.config.mjs`).

---

## T11. Open redirect on `callbackUrl`

- **STRIDE:** S, T
- **Scenario:** `/middleware.ts` writes the original path into
  `?callbackUrl=...` on the login redirect. A crafted URL like
  `/login?callbackUrl=https://attacker.example` would phish the user
  post-login if the login page blindly trusts it.
- **Severity:** Medium
- **Mitigations:**
  - Middleware only forwards the **path + query** of the original URL,
    never the host (`callback = ${pathname}${nextUrl.search}`), so the
    value is always relative.
  - The login page MUST additionally reject `callbackUrl` values that
    don't start with `/` and contain no protocol-relative `//` prefix.
    (Open issue for the login UI builder.)
  - NextAuth's own `callbackUrl` parsing is same-origin only by default.

---

## T12. Slack DM injection / impersonation

- **STRIDE:** S, I
- **Scenario:** User-supplied free-text (leave reason, reviewer note)
  flows verbatim into a Slack message body. An attacker crafts content
  like `<@U_HR_ADMIN> APPROVED` or includes Slack mrkdwn that mimics a
  system notice.
- **Severity:** Medium
- **Mitigations:**
  - `sanitizeFreeText` runs on every free-text input on the way IN, so
    angle brackets / event handlers never reach Slack.
  - Slack mrkdwn-specific characters (`<`, `>`, `&`) are HTML-encoded by
    the sanitiser; Slack will render the literal entities as text.
  - **Open:** wrap user content in code-fences (`` `…` ``) inside Slack
    messages to make impersonation visually obvious. Backend-dev
    follow-up.

---

## Summary

| Severity | Count |
|----------|------:|
| Critical | 2 (T2, T8) |
| High     | 4 (T1, T3, T4, T5) |
| Medium   | 5 (T6, T7, T9, T11, T12) |
| Low      | 1 (T10) |
| **Total** | **12** |

Mitigations span: middleware (`/middleware.ts`), security headers
(`next.config.mjs`), input sanitiser (`lib/security/sanitize.ts`),
constant-time secret check (`lib/security/constant-time.ts`), cycle
detector (`lib/security/cycle-detect.ts`), auth callbacks
(`lib/auth/config.ts`), route guards (`lib/auth/guards.ts`), and the
per-route checklist (`docs/security/api-checklist.md`).
