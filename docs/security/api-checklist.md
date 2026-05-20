# API Route Security Checklist

Audit grid for every `app/api/**/route.ts` handler. The security agent
uses this in Wave 2 to grade backend-dev's work; each item below is a
**must-pass**. A single ✗ blocks merge until fixed.

For each route, fill out:

```
Route: <METHOD> /api/<path>
File:  app/api/.../route.ts
Owner: <author>
```

Then grade against the 10 items below.

---

## 1. Session guard is the FIRST statement

The handler calls `requireSession()` (or `requireRole(...)`) before
touching anything else — DB, Slack, file IO, even logging request
metadata. Anonymous code paths must be limited to the cron handler,
which uses `timingSafeEqualString` instead.

- ✓ if: `const session = await requireSession();` (or `requireRole`) is
  the first await in the function.
- ✗ if: any DB read/write or external fetch precedes the session check.

## 2. Role guard if the route is privileged

Routes under `/api/admin/**` call `requireAdmin()` or
`requireRole("SUPER_ADMIN")` for role-mutation endpoints (A14). Routes
under `/api/approvals` or any cross-employee mutation use
`requireManagerOrAdmin()` (admin role OR `session.user.isManager`, per
ADR-0006 / A19), plus an additional ownership check that the request's
employee actually reports to the viewer (see item 4).

- ✓ if: role guard matches the threat model entry for this route.
- ✗ if: an EMPLOYEE could reach a route that mutates another row.

## 3. Zod parse BEFORE any DB read/write

Body, query params, and route params all parse through an explicit Zod
schema. The schema is the source of truth for the column allowlist (see
item 8). Failures return 400 with a generic message.

- ✓ if: `schema.parse(await req.json())` (or `.safeParse`) happens before
  the first `db.` call.
- ✗ if: `req.json()` value is spread directly into `db.insert().values(...)`.

## 4. Row-level guard for non-admin actions

For any handler that operates on a specific row (`/api/leave/[id]`,
`/api/wfh/[id]`, `/api/notifications/[id]`), the handler verifies the
session user is either:

- the owner (`row.employeeId === session.user.id`), OR
- the owner's manager (chain check), OR
- `HR_ADMIN | SUPER_ADMIN`.

The check happens AFTER fetching the row and BEFORE any mutation, on the
same SELECT used to mutate (avoid TOCTOU by reading the row once).

- ✓ if: a guarded `if (!isOwner && !isManager && !isAdmin) return 403;`
  exists between fetch and mutate.
- ✗ if: the route trusts the URL `id` alone.

## 5. Parameterised DB access only

All queries go through Drizzle's typed builder (`db.query.*`, `db.select`,
`db.insert(...).values`, `eq`, `and`, etc.). Raw SQL via `sql\`...\`` is
permitted only when the template uses `sql.placeholder` / `sql.param` for
every dynamic value — never string interpolation.

- ✓ if: no string concatenation in SQL anywhere in the handler.
- ✗ if: any user input lands in `sql\`SELECT ... WHERE x = ${input}\``
  without being a typed param.

## 6. Audit-log on writes

Every mutating route (`POST`, `PATCH`, `PUT`, `DELETE`) calls
`writeAuditLog({ actorId, action, targetTable, targetId, metadata })`
either inside the same transaction as the mutation or immediately after a
successful commit. `actorId` is `session.user.id`. `action` follows the
verb.noun convention (`leave.create`, `employee.deactivate`,
`balance.adjust`, `role.change`, etc.).

- ✓ if: every successful write is audit-logged.
- ✗ if: a write commits without a matching audit row.

## 7. No PII in error responses

Error bodies are generic (`{ error: "Bad request" }`, `"Forbidden"`,
`"Not found"`, `"Internal error"`). Detail strings — DB error messages,
email addresses, stack traces — go to `console.error` only. 404 vs 403
must be considered: returning 404 for unauthorised access avoids leaking
existence of the row, but only when consistent with the route's
behaviour for legitimate users.

- ✓ if: every `catch` block maps to a generic message.
- ✗ if: `err.message` is echoed to the client.

## 8. No mass-assignment

The Zod schema for body validation is an **explicit whitelist** of
columns. It does NOT use `.passthrough()`, does NOT spread an arbitrary
object into `db.insert(...).values(...)`, and PATCH schemas omit any
column the route is not allowed to write (e.g. self-edit profile schema
omits `role`, `managerId`, `isActive`, `email`).

- ✓ if: every field that lands in the DB call is named in the Zod schema.
- ✗ if: `db.update(users).set({ ...body })` appears anywhere.

## 9. Free-text sanitisation

Any free-text field that may be re-rendered (`reason`, `reviewerNote`,
`address`, `notification.message`, etc.) passes through
`sanitizeFreeText` from `lib/security/sanitize.ts` AFTER Zod parsing,
BEFORE DB insert. Sanitisation is idempotent so re-running on existing
rows is safe.

- ✓ if: every free-text column is sanitised on the way in.
- ✗ if: a `reason` / `note` string lands in the DB unsanitised.

## 10. Method whitelist

The route handler exports only the HTTP methods it intends to support.
Next.js App Router returns 405 for un-exported methods automatically;
this is for clarity and to prevent accidental coupling (e.g. a `DELETE`
appearing because the file also handled approvals via PATCH).

- ✓ if: file exports a tight method set (e.g. `GET`, `POST` only).
- ✗ if: a stray `export const PATCH` left over from scaffolding.

---

## Audit grade card (Wave 2)

| Route | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | Notes |
|-------|---|---|---|---|---|---|---|---|---|----|-------|
|       |   |   |   |   |   |   |   |   |   |    |       |

Backend-dev fills in the grid; security agent verifies each ✓ by reading
the handler. Any ✗ becomes a tracked open issue and blocks Wave 2 merge.
