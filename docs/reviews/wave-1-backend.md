# Wave 1 backend review — 17 route files + 10 lib helpers

**Verdict: CHANGES REQUESTED**

Backend-dev's work is strong on shape (guard → parse → DB → audit →
notify) and consistent in its use of `apiError` / `handleRouteError`.
However four issues block sign-off: (a) inconsistent CSRF defence
across mutating routes, (b) free-text sanitisation gaps on admin
routes, (c) missing audit log on `notifications/read`, and
(d) idempotency / self-management edge cases on the role + employee
endpoints. None of these are catastrophic, but each is a security
deficiency the threat model explicitly calls out.

Route count: 17 (PRD requested 16 — there's an extra
`/api/auth/[...nextauth]/route.ts`, which is correct and required).

## Route grades

| Route | Guard | Zod | Row-lvl | Audit | Notify | Sanitize | CSRF | Verdict |
|---|---|---|---|---|---|---|---|---|
| GET    /api/leave                       | ✓ | ✓ | ✓ | n/a | n/a | n/a | n/a | ✓ |
| POST   /api/leave                       | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET    /api/leave/[id]                  | ✓ | n/a | ✓ | n/a | n/a | n/a | n/a | ✓ |
| PATCH  /api/leave/[id]                  | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| DELETE /api/leave/[id]                  | ✓ | n/a | ✓ | ✓ | ✓ | n/a | ✓ | ✓ |
| GET    /api/wfh                         | ✓ | ✓ | ✓ | n/a | n/a | n/a | n/a | ✓ |
| POST   /api/wfh                         | ✓ | ✓ | n/a | ✓ | ✓ | ✓ | ✓ | ✓ |
| GET    /api/wfh/[id]                    | ✓ | n/a | ✓ | n/a | n/a | n/a | n/a | ✓ |
| PATCH  /api/wfh/[id]                    | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| DELETE /api/wfh/[id]                    | ✓ | n/a | ✓ | ✓ | ✓ | n/a | ✓ | ✓ |
| GET    /api/admin/employees             | ✓ | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ |
| POST   /api/admin/employees             | ✓ | ✓ | n/a | ✓ | n/a | ✗ | ✗ | 🔴 |
| GET    /api/admin/employees/[id]        | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | ✓ |
| PATCH  /api/admin/employees/[id]        | ✓ | ✓ | n/a | ✓ | n/a | ✗ | ✗ | 🔴 |
| DELETE /api/admin/employees/[id]        | ✓ | n/a | n/a | ✓ | ✓ | n/a | ✗ | 🟡 |
| PATCH  /api/admin/employees/[id]/role   | ✓ | ✓ | n/a | ✓ | n/a | n/a | ✗ | 🟡 |
| POST   /api/admin/employees/import      | ✓ | ✓ | n/a | ✓ | n/a | ✗ | ✗ | 🔴 |
| GET    /api/admin/holidays              | ✓ | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ |
| POST   /api/admin/holidays              | ✓ | ✓ | n/a | ✓ | n/a | ✗ | ✗ | 🟡 |
| DELETE /api/admin/holidays/[id]         | ✓ | n/a | n/a | ✓ | n/a | n/a | ✗ | 🟡 |
| GET    /api/admin/balances              | ✓ | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ |
| PATCH  /api/admin/balances              | ✓ | ✓ | n/a | ✓ | n/a | n/a | ✗ | 🟡 |
| GET    /api/admin/audit-logs            | ✓ | ✓ | n/a | n/a | n/a | n/a | n/a | ✓ |
| GET    /api/notifications               | ✓ | ✓ | ✓ | n/a | n/a | n/a | n/a | ✓ |
| POST   /api/notifications/read          | ✓ | ✓ | ✓ | n/a | n/a | n/a | ✓ | ✓ |
| GET    /api/org-chart                   | ✓ | n/a | n/a | n/a | n/a | n/a | n/a | ✓ |
| POST   /api/cron/birthdays              | bearer | n/a | n/a | ✓ | ✓ | n/a | n/a | ✓ |

## Spot-checked handlers

### `app/api/leave/route.ts` (POST)
✓ CSRF → session → Zod → balance check → tx insert → audit → notify.
`consumeBalance` deferral to PATCH approve documented inline. Nit:
the post-insert `me` / `lt` lookups are extra round-trips.

### `app/api/leave/[id]/route.ts` (PATCH)
✓ Single-tx approve/reject. Idempotency: `if (row.req.status !==
"PENDING") return 409` — a second PATCH responds 409, no double
audit, no double notify.

### `app/api/admin/employees/route.ts` (POST)
🔴 Three concerns: (1) `firstName/lastName/address/position/
department` write to DB without `sanitizeFreeText` (T3/T12).
(2) No `assertSameOrigin` — cookie-auth like `/api/leave`, same CSRF
risk. (3) `detectCycle("__new__", body.managerId)` uses a literal
placeholder id, so a chain looping back to the new user is not
detected. CSV path uses synthetic ids correctly; mirror that.

### `app/api/admin/employees/[id]/role/route.ts` (PATCH)
🟡 Idempotent (returns `changed:false` on a no-op). But self-demote
guard at line 22 doesn't cover the last-SUPER_ADMIN case — a
SUPER_ADMIN can demote another SUPER_ADMIN, possibly leaving zero.
Add a count-based guard before the write.

### `app/api/cron/birthdays/route.ts` (POST)
✓ Constant-time secret → env lookup → DB query → per-match Slack
send (errors collected) → audit row. Bearer regex rejects empty
secrets. Praise.

## Library helpers

| File | Verdict | Notes |
|---|---|---|
| `lib/auth/config.ts`       | ✓ | covered in Phase 0 review item 7 |
| `lib/auth/guards.ts`       | ✓ | small, focused; `requireAdmin` is a tidy alias |
| `lib/leave/working-days.ts`| ✓ | Phase 0; unit-tested |
| `lib/leave/balance.ts`     | ✓ | tx-aware, unpaid-leave exempt path documented |
| `lib/leave/cancel.ts`      | 🟡 | see finding 5 |
| `lib/leave/colors.ts`      | ✓ | full Tailwind class literals so JIT picks them up |
| `lib/employee/cycle-detect.ts` | 🟡 | see finding 6 |
| `lib/employee/deactivate.ts`   | ✓ | tx + post-commit audit/notify is the right shape |
| `lib/csv/import.ts`        | 🔴 | see finding 4 |
| `lib/notify/index.ts`      | ✓ | A2 contract upheld; unit-tested incl. failure path |
| `lib/slack/client.ts`      | ✓ | small surface; throws on missing token |
| `lib/audit/log.ts`         | ✓ | append-only; no update path exposed |
| `lib/orgchart/tree.ts`     | ✓ | O(N), handles missing parents gracefully |
| `lib/api/errors.ts`        | ✓ | stable codes; no internal leakage |
| `lib/api/route-helpers.ts` | ✓ | tiny, focused |
| `lib/validation/common.ts` | ✓ | every API route's source-of-truth Zod |
| `lib/security/csrf.ts`     | ✓ | well-documented; exempts auth + cron correctly |

## Numbered findings (block / changes / nit)

1. **block** — `app/api/admin/**` is missing `assertSameOrigin` on
   every mutating handler (POST/PATCH/DELETE × employees, holidays,
   balances). Threat T9 says SameSite=Lax is the first line of
   defence but not sufficient on its own. Wave 1 added CSRF to leave/
   wfh/notifications already — admin routes must follow the same
   pattern. Fix: `const csrf = assertSameOrigin(req); if (csrf)
   return csrf;` as the first statement in each handler.

2. **block** — `app/api/admin/employees/route.ts:65-81` (POST) and
   `:65-81` (PATCH) write `firstName`, `lastName`, `address`,
   `position`, `department` to the DB without `sanitizeFreeText`.
   Same fields land in Slack messages (cancellation notes use
   `employee.firstName`), so Threat T12 (Slack DM injection) applies.
   Fix: sanitise each free-text field after Zod parse, before insert.

3. **block** — `app/api/admin/holidays/route.ts:43-48` (POST). The
   holiday `name` is rendered into audit-log metadata, Slack DMs are
   not affected here but `name` could appear in a future calendar
   widget. Add `sanitizeFreeText(body.name)`.

4. **block** — `lib/csv/import.ts`. Per-row Zod schema (good) but
   none of the free-text columns are sanitised before insert. Threat
   T3 explicitly calls out CSV stored-XSS. Also no upload size cap
   (T3 mitigation says ≤ 2 MB). Add `sanitizeFreeText` to firstName,
   lastName, address, position, department in BOTH the dryrun
   summary AND the commit path, and add a body-size check at the
   route layer.

5. **changes** — `lib/leave/cancel.ts:30-35`. The cancel helper
   throws plain `Error("Cannot cancel a CANCELLED request")`; the
   route catches `handleRouteError` which returns 500. Caller at
   `/api/leave/[id]/route.ts:108-110` already rejects with 409
   BEFORE calling the helper, but a future caller (admin override
   path) might forget. Throw a typed error or return a discriminated
   result so the route can map to a 409.

6. **changes** — `lib/employee/cycle-detect.ts:76-112`. The DB-walk
   path is only safe if the DB is already cycle-free. Comment claims
   "we already trust the DB to be cycle-free pre-edit", but if the
   schema-level FK on `users.manager_id` is missing (Phase 0
   finding #1), nothing prevents drift. Either land the FK or have
   `detectCycle` bail out when its `visited` set grows past N.

7. **changes** — `app/api/admin/employees/route.ts:60`. Single-create
   cycle check uses `__new__` literal as the target id. If the
   proposed manager chain loops back through `__new__`, the check
   passes (string never matches). Use a UUID generated up-front and
   re-use it for the insert.

8. **changes** — `app/api/admin/employees/[id]/role/route.ts:22`.
   Self-demote is blocked but last-SUPER_ADMIN demotion is not. Add
   a count-based guard.

9. **nit** — `app/api/leave/[id]/route.ts:74-78`. The reviewer note
   is sanitised AFTER the row is loaded but BEFORE the row-level
   guard runs (lines 60-62). Re-order so guard runs first; cheaper
   on the unhappy path.

10. **nit** — `app/api/notifications/read/route.ts:18-26`. The
    `body.all === true` branch updates every row owned by the
    session user but emits no audit log. Acceptable (it's a self-
    action) but a `notifications.mark_all_read` row would help
    forensics.

11. **nit** — `app/api/wfh/[id]/route.ts:128-135`. WFH cancel
    notifies reviewer + employee inline; leave cancel does so via a
    helper. Move into `cancelWfhRequest` for symmetry.

12. **nit** — `app/api/leave/route.ts:111-115` (and `wfh/route.ts`).
    Three DB round-trips after insert assemble the manager DM.
    Collapse into a single LEFT JOIN.

13. **praise** — `app/api/cron/birthdays/route.ts`. Constant-time
    auth + per-match error collection + summary audit row = threat-T4
    mitigation pattern exactly.

14. **praise** — `lib/notify/index.ts`. Smallest possible surface;
    Slack failure swallowed but DB write succeeds. A2 honoured.

## Summary

| Severity | Count |
| -------- | ----- |
| block    | 4     |
| changes  | 4     |
| nit      | 4     |
| praise   | 2     |

Wave 1 backend cannot ship until the four `block` items are fixed.
None require redesign — sanitisation + CSRF + body-size are all
additive layered defences over existing infrastructure.
