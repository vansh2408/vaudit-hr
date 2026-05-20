# Phase 0 review — Architect (scaffold, schema, NextAuth, ADRs, seed, working-days)

**Verdict: APPROVED WITH NITS**

`npm run typecheck` and `npm run lint` both pass clean against the
Phase 0 + Wave 1 tree. Schema matches PRD; all 18 decisions are
ratified in `docs/decisions.md` and reflected in code. The five ADRs
in `docs/adrs/` flesh out the stack, auth, role model, notification
fan-out, and CSV import strategy.

## Strengths (praise)

- **`lib/db/schema.ts`** — clean, all 11 PRD tables present, all
  drizzle-zod insert/select schemas exported, type aliases (`User`,
  `UserRole`, `RequestStatus`) re-exported at the bottom. Birthday as
  `varchar(5) MM-DD` is exactly what A11 / cron want.
- **`lib/leave/working-days.ts`** — pure function, `toYmd` defends
  against TZ off-by-one, weekend-and-holiday union is set-based, full
  unit coverage in `tests/unit/working-days.test.ts` (7 cases incl.
  weekend-holiday no-double-count).
- **`tsconfig.json`** — `strict` + `noUncheckedIndexedAccess` +
  `exactOptionalPropertyTypes` + `noImplicitOverride` (A18 maxed out).
- **`scripts/seed.ts`** — idempotent, two-pass for managerId
  resolution (mirrors A16 CSV pattern), upserts leave types by name +
  holidays by date.
- **`docs/decisions.md`** — every decision references the code path
  that implements it; immutable artifact for downstream agents.

## Findings

1. **changes** — `lib/db/migrations/0000_fat_cassandra_nova.sql:108`.
   `users.manager_id` is `text` with no FK constraint to `users.id`.
   The Drizzle schema declares the self-relation but Drizzle-kit
   refuses to emit a self-ref FK in a single CREATE TABLE statement;
   the architect should ship a follow-up migration (`ALTER TABLE
   users ADD CONSTRAINT users_manager_id_fk FOREIGN KEY (manager_id)
   REFERENCES users(id) ON DELETE SET NULL`). Cycle detection is in
   app code so the integrity hole is bounded, but the DB should still
   enforce reference integrity. Phase 7 hardening, latest.

2. **changes** — `lib/db/schema.ts:312`. `audit_logs.metadata` is
   `jsonb DEFAULT '{}'::jsonb` but is *nullable* (no `.notNull()`).
   Threat T7 calls audit-log tampering Medium; nullable metadata
   allows a future writer to land a row with `NULL` metadata and lose
   the affected fields. Add `.notNull()` and drop the `default '{}'`
   or keep both — either way make it non-null.

3. **nit** — `lib/db/schema.ts:308`. `audit_logs.actor_id` is
   `ON DELETE set null`. Correct for keeping the audit trail, but the
   threat model (T7) wants append-only semantics. The set-null is
   fine but should be commented inline so future maintainers don't
   "fix" it to cascade.

4. **changes** — `scripts/seed.ts:135-141`. Seed holidays are
   hardcoded to year 2026. If `npm run db:seed` is run in 2027, the
   balances for the current year will be created (line 219) but the
   holidays won't apply, so leave calculations will silently
   over-count working days. Parameterise the year (`new
   Date().getFullYear()`) or emit a warning when the seed year is
   stale.

5. **nit** — `scripts/seed.ts:210-216`. Raw SQL UPDATE inside the
   seed bypasses Drizzle's typed builder. It works (and parameters
   are passed through `sql\`\`` tags), but the rest of the codebase
   exclusively uses the typed API; a builder-side update keeps the
   style consistent.

6. **nit** — `docs/adrs/`. Five ADRs ratified
   (ADR-0001…ADR-0005). PRD mentions decisions A1-A18 in
   `decisions.md`; the ADR set covers Stack, Auth, Role, Notify,
   CSV. Future-proofing: ADR-0006 should capture the
   `assertSameOrigin` CSRF defence (currently undocumented as an
   ADR even though it's in the threat model).

7. **nit** — `lib/auth/config.ts:60-68`. Session augmentation
   declares `employeeId: string` and `id: string`. Both always equal
   the same value (the user row PK). Pick one; carrying both invites
   bugs where a future route uses one when the other was intended.
   Prefer `id` — it matches what most routes already destructure.

8. **praise** — `lib/auth/config.ts:74-104`. Test-auth provider is
   triple-gated (env-flag at module load, env-flag at authorize, +
   `isActive` check). Matches the threat model in
   `docs/security/test-auth.md` exactly.

9. **nit** — `lib/employee/cycle-detect.ts` AND
   `lib/security/cycle-detect.ts`. Two cycle detectors live in the
   tree. They have slightly different APIs (the employee version
   does DB walks; the security one is pure). Folder confusion is
   minor but the security/ duplicate exists only to satisfy
   threat-model "T3 mitigations point here". Consider re-exporting
   from one canonical location.

## Decisions.md compliance

All 18 decisions implemented in Phase 0. See
`docs/reviews/review-checklist.md` table.

## Summary

| Severity  | Count |
| --------- | ----- |
| block     | 0     |
| changes   | 3 (items 1, 2, 4) |
| nit       | 5     |
| praise    | 3     |

Phase 0 is solid groundwork. The three `changes` items are tracked
for Wave 2 / Phase 7 hardening; none block downstream work.
