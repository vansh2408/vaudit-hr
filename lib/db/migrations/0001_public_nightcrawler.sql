-- Phase 7 hardening migration.
--
-- 1. audit_logs.metadata → NOT NULL.
--    The column already has a `'{}'::jsonb` default, but no historical
--    constraint prevented a NULL value from being persisted. drizzle-kit
--    does not emit a backfill before flipping the constraint, so we add
--    one ourselves: any pre-existing NULL is coerced to an empty object
--    before SET NOT NULL runs. Threat T7 — audit-log tampering.
-- 2. users.manager_id → self-referential FK with ON DELETE SET NULL.
--    The application has always treated this column as a FK; the DB
--    constraint was missing. ON DELETE SET NULL matches the schema-level
--    intent (deactivating a manager nulls out direct reports' managerId
--    rather than cascade-deleting them). Threat: data drift / orphan refs.
--    drizzle-kit's emitted ALTER assumes existing manager_id values are
--    valid; if any rogue id slipped in, the FK creation will fail loudly
--    rather than silently re-anchor — that's the desired behaviour.

UPDATE "audit_logs" SET "metadata" = '{}'::jsonb WHERE "metadata" IS NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "metadata" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
