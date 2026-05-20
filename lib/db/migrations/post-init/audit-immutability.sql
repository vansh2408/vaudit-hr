-- Audit-log immutability triggers — threat-model T7.
--
-- Append-only invariant: no application path may UPDATE or DELETE rows in
-- `audit_logs`. The Drizzle layer already exposes only `writeAuditLog`
-- (INSERT), but a privileged actor with raw DB credentials could still
-- mutate rows directly. These triggers fail-closed at the database tier
-- so a compromised app role still cannot rewrite history.
--
-- TRUNCATE is intentionally NOT blocked here: in v1 we expect HR to need a
-- supervised wipe path (e.g. test/staging resets). A future Phase ≥ 2
-- patch will pin this further with row-level security (RLS).
--
-- Run manually after `drizzle-kit push` / `drizzle-kit migrate`:
--     psql "$DATABASE_URL" -f lib/db/migrations/post-init/audit-immutability.sql

CREATE OR REPLACE FUNCTION block_audit_mutations() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS no_update_audit ON audit_logs;
CREATE TRIGGER no_update_audit
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION block_audit_mutations();

DROP TRIGGER IF EXISTS no_delete_audit ON audit_logs;
CREATE TRIGGER no_delete_audit
  BEFORE DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION block_audit_mutations();
