-- Convert WFH from single-day to a date range, matching leaveRequests.
-- Single-day WFH requests remain valid: they become rows where start_date
-- === end_date and total_days === 1.
--
-- Steps:
--   1. Rename the existing `date` column to `start_date`.
--   2. Add `end_date` and `total_days` columns nullable so existing rows
--      can be backfilled.
--   3. Backfill: end_date = start_date, total_days = 1 (every existing
--      WFH row was a single working day under the old model).
--   4. Tighten the new columns to NOT NULL.

ALTER TABLE "wfh_requests" RENAME COLUMN "date" TO "start_date";--> statement-breakpoint
ALTER TABLE "wfh_requests" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "wfh_requests" ADD COLUMN "total_days" integer;--> statement-breakpoint
UPDATE "wfh_requests" SET "end_date" = "start_date", "total_days" = 1 WHERE "end_date" IS NULL;--> statement-breakpoint
ALTER TABLE "wfh_requests" ALTER COLUMN "end_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "wfh_requests" ALTER COLUMN "total_days" SET NOT NULL;
