# Audit-log immutability — operations runbook

Threat reference: `docs/security/threat-model.md` T7 (audit-log
tampering / repudiation).

## What we ship

`/lib/db/migrations/post-init/audit-immutability.sql` defines a trigger
function `block_audit_mutations()` and two `BEFORE UPDATE` /
`BEFORE DELETE` row-level triggers on `audit_logs`. Any attempt to
UPDATE or DELETE a row raises `audit_logs are append-only` and rolls
the statement back.

The triggers are **not** part of the Drizzle migration pipeline — Drizzle
generates structural DDL only. This file lives outside `lib/db/migrations`
proper so `drizzle-kit migrate` does not try to manage it.

## When to apply

Run **once per database**, immediately after the initial Drizzle migration
has created `audit_logs`:

```bash
# 1. Apply Drizzle structural migrations first.
npx drizzle-kit migrate

# 2. Then apply the immutability triggers.
psql "$DATABASE_URL" -f lib/db/migrations/post-init/audit-immutability.sql
```

The script is idempotent (`DROP TRIGGER IF EXISTS` + `CREATE OR REPLACE`),
so re-running on an already-protected database is a no-op.

## When NOT to apply

- **Local seed / fixture resets.** Tests that wipe the DB use `TRUNCATE`
  (not blocked by these triggers) or drop-and-recreate. Do not deploy
  the trigger inside the test DB unless you also want to gate test
  cleanups behind it.
- **Migration squashes.** If a future Drizzle migration must rewrite
  `audit_logs` rows, `DROP TRIGGER` before the migration, run the
  migration, then re-apply this file.

## Verification

```sql
-- Confirm triggers exist.
SELECT tgname, tgtype FROM pg_trigger
WHERE tgrelid = 'audit_logs'::regclass AND NOT tgisinternal;

-- Confirm enforcement (should both fail).
UPDATE audit_logs SET action = 'tampered' WHERE TRUE;
DELETE FROM audit_logs WHERE TRUE;
```

Expected error on both attempts:

```
ERROR: audit_logs are append-only
```

## Operator action required (Wave 2 ops handoff)

This file is **not** auto-applied by any code path. After provisioning
a fresh Vaudit HR database, an operator must run the `psql` command
above as part of the production runbook. CI / staging environments
should apply it too so leak detection in tests matches prod behaviour.

Track this in the deployment checklist alongside `NEXTAUTH_SECRET`
rotation and the Slack bot token install.
