# Cross-cutting findings — issues spanning multiple deliverables

**Verdict: CHANGES REQUESTED**

Issues that no single wave owns but that affect overall correctness,
maintainability, or PRD/decisions alignment. Each one needs a Wave
2 owner.

## 1. CSRF defence is half-applied

- **Where**: `lib/security/csrf.ts` exists and is used by
  `app/api/leave/**`, `app/api/wfh/**`, `app/api/notifications/read/
  route.ts`. NOT used by ANY route under `app/api/admin/**`.
- **Why it matters**: Threat T9 + decisions A15 imply uniform
  cookie-auth → uniform CSRF defence. The asymmetry leaves the
  highest-blast-radius routes (employee CRUD, role change, balance
  adjustment, holiday CRUD, CSV import) protected only by
  SameSite=Lax — fine in modern Chrome, weaker in older browsers.
- **Owner**: backend-dev (Wave 2). Owner cross-link:
  `wave-1-backend.md` finding 1.
- **Fix**: add `const csrf = assertSameOrigin(req); if (csrf)
  return csrf;` as the first statement in every POST/PATCH/DELETE
  under `app/api/admin/**`.

## 2. Sanitisation is opportunistic, not systematic

- **Where**: `sanitizeFreeText` is called in
  `app/api/leave/route.ts`, `app/api/leave/[id]/route.ts`,
  `app/api/wfh/route.ts`, `app/api/wfh/[id]/route.ts`. NOT called
  in `app/api/admin/employees/*`, `app/api/admin/holidays/route.ts`,
  `lib/csv/import.ts`.
- **Why it matters**: `firstName`, `lastName`, `address`,
  `position`, `department`, `holiday.name` all may be rendered in
  Slack DMs (Threat T12) and in admin listings (Threat T3 stored-
  XSS). The CSV import path is the highest-volume vector and
  currently sanitises nothing.
- **Owner**: backend-dev + security (Wave 2).
- **Fix**: centralise via a `sanitizeEmployeeFields(parsed)` helper
  and call it from every employee write path. Also call it on every
  holiday + leave-type write.

## 3. Cycle detection has two implementations with drift potential

- **Where**: `lib/employee/cycle-detect.ts` (DB-walking +
  in-memory) and `lib/security/cycle-detect.ts` (pure). The two
  in-memory versions differ in shape (one returns
  `{ok, reason, chain}`, the other returns `boolean`).
- **Why it matters**: Future maintainers may patch one and not the
  other. Threat-model mitigations name the security copy; actual
  callers use the employee copy. The single-create path in
  `app/api/admin/employees/route.ts:60` calls `detectCycle("__new__",
  body.managerId)` with a literal placeholder id that can never
  appear in the chain — silent false-negative.
- **Owner**: architect + security (Wave 2).
- **Fix**: pick one implementation (the pure version), re-export
  from `lib/employee/cycle-detect.ts`, fix the placeholder-id bug
  in the create route.

## 4. Schema-level FK on `users.manager_id` missing

- **Where**: `lib/db/migrations/0000_fat_cassandra_nova.sql:108`
  declares `manager_id text` with no FK.
- **Why it matters**: drift-prone — drift in `manager_id` won't be
  caught by Postgres; cycle detection becomes the only line of
  defence; deleting a user requires app code to null out children
  manually. With `ON DELETE SET NULL` declared in
  `lib/db/schema.ts` we already intend for the FK to exist.
- **Owner**: architect (Wave 2 follow-up migration).
- **Fix**: ship `0001_users_manager_fk.sql` with
  `ALTER TABLE users ADD CONSTRAINT users_manager_id_fk FOREIGN
  KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL`. Update
  the seed pass-2 + CSV pass-2 to ensure they don't trip the FK
  (they already insert manager_id in pass 2 so this is safe).

## 5. Audit-log `metadata` is nullable

- **Where**: `lib/db/schema.ts:312` declares `metadata: jsonb(...)
  .default(sql\`'{}'::jsonb\`)` — no `.notNull()`.
- **Why it matters**: Threat T7 (audit-log tampering) requires
  forensic durability. A future writer could land a row with NULL
  metadata and lose the `before`/`after`/`reason` payload.
  `writeAuditLog` always passes a value, so today's surface is
  fine — but the schema doesn't enforce it.
- **Owner**: architect (Wave 2).
- **Fix**: `.notNull()` + ship migration.

## 6. `Session.user` carries both `id` and `employeeId`

- **Where**: `lib/auth/config.ts:60-68`. `Session.user.id === Session.
  user.employeeId` always.
- **Why it matters**: Routes use them interchangeably. Future
  refactors may diverge them by accident.
- **Owner**: architect (Wave 2).
- **Fix**: drop `employeeId`, update the four call sites that read
  it. (Searched: only `lib/auth/config.ts:224` writes it. No reads
  outside type declarations.)

## 7. Decision A18 says "no `any`" — verified clean

- **Where**: `grep -rEn '\bas any\b|: any\b|<any>' lib app
  components` returns hits only inside `/components/ui/*` (shadcn
  primitives, out of scope) and inside Drizzle return-type-cast
  patterns that are explicitly typed. The custom code is clean.
- **Status**: praise. No action.

## 8. Test-auth bypass safety relies on env-flag hygiene

- **Where**: `lib/auth/config.ts:41` reads `PLAYWRIGHT_TEST` at
  module load. The auth checklist and test-auth docs both flag the
  missing boot-time assertion (`if (IS_TEST_AUTH && NODE_ENV ===
  "production") throw`).
- **Why it matters**: One leaked env-var across deployment systems
  is the only thing between the bypass and prod. The assertion is
  trivial; absence is a latent foot-gun.
- **Owner**: backend-dev / DevOps (Phase 7 hardening at latest).
- **Fix**: add the boot-time throw inside the same module where
  `IS_TEST_AUTH` is computed.

## 9. CSP includes `'unsafe-eval'` in every build

- **Where**: `next.config.mjs:30`. Dev React Fast Refresh needs
  eval; prod doesn't.
- **Why it matters**: Phase 7 prod must not ship CSP with
  `unsafe-eval`. Same CSP today emits to both `next dev` and
  `next build`.
- **Owner**: security (Phase 7).
- **Fix**: branch the CSP on `NODE_ENV` or move to nonce-based
  config now.

## 10. `lib/csv/import.ts` has no upload size cap

- **Where**: `app/api/admin/employees/import/route.ts:28-50`
  reads `req.formData()` / `req.json()` with no size limit. Threat
  T3 explicitly calls out ≤ 2 MB.
- **Why it matters**: 100 MB CSV → out-of-memory the server.
- **Owner**: backend-dev (Wave 2).
- **Fix**: check `Content-Length` before reading the body, return
  413 if over cap. Belt-and-braces: cap `csvText.length` after read
  too.

## 11. Two leave-type colour systems coexist

- **Where**: `lib/db/schema.ts:153` defines `leaveTypes.color`
  (DB-stored hex). `lib/leave/colors.ts` defines Tailwind class
  literals keyed on name (not hex). UI components import only the
  Tailwind map; the DB `color` column is selected in
  `app/api/admin/balances/route.ts:35` but never read by the UI.
- **Why it matters**: Two sources of truth. HR can edit
  `leaveTypes.color` in (eventually) the admin UI but the change
  won't render because UI reads the Tailwind map.
- **Owner**: ui-ux-designer or backend-dev (Wave 2).
- **Fix**: either drop the DB `color` column, OR have the UI prefer
  DB hex over the Tailwind map (the latter is harder because
  Tailwind classes can't be dynamic — would need inline `style`
  for the dot/border). Recommend: drop the DB column for v1,
  re-introduce when admin UI for leave-type edit lands.

## 12. Seed holidays hardcoded to 2026

- **Where**: `scripts/seed.ts:135-141`.
- **Why it matters**: Runs in 2027 → working-days math diverges
  silently. CI is on 2026 today so green is irrelevant.
- **Owner**: architect (Wave 2).
- **Fix**: parameterise the year or fail-loud when the seed year
  is past.

## Summary

| Severity | Count |
| -------- | ----- |
| block    | 0 (the security-relevant items are blocking inside their wave reviews) |
| changes  | 9     |
| nit      | 2     |
| praise   | 1     |

Items 1, 2, 3, 4, 5, 8, 9, 10 belong on the Phase 7 hardening
backlog. Items 6, 11, 12 can land any time.
