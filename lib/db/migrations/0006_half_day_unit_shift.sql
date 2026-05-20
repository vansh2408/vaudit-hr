-- 0006: half-day support — unit shift from "day" to "half-day".
--
-- Switches the atomic day-count unit from 1 day to 1 half-day across the
-- leave + WFH stack so requests can legitimately consume 0.5 of a day
-- from the employee's balance. Existing integer columns keep their
-- types; only their meaning shifts: 1 day = 2 units.
--
-- This file is intentionally a single migration: the schema additions
-- and the *2 backfill ride in the same transaction so there is never a
-- window where the new columns exist but row values still carry
-- day-units (which would make the dashboard read half what it should).
--
-- New columns on leave_requests + wfh_requests:
--   is_half_day    BOOLEAN NOT NULL DEFAULT false
--   half_day_slot  TEXT NULL  -- 'FIRST_HALF' | 'SECOND_HALF' when half-day, else NULL
--
-- A CHECK constraint enforces three invariants per row:
--   - is_half_day = false  ⇒ half_day_slot must be NULL
--   - is_half_day = true   ⇒ slot must be FIRST_HALF or SECOND_HALF
--                            AND start_date = end_date (single date only in V1)
--
-- After this migration, leave_balances.allocated / leave_balances.used /
-- leave_requests.total_days / wfh_requests.total_days all store HALF-DAYS
-- as integers. The display layer (lib/utils/format-days.ts) converts to
-- the "1 day" / "1.5 days" / "Half day" presentation.

ALTER TABLE "leave_requests" ADD COLUMN "is_half_day" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "half_day_slot" text;--> statement-breakpoint
ALTER TABLE "wfh_requests" ADD COLUMN "is_half_day" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "wfh_requests" ADD COLUMN "half_day_slot" text;--> statement-breakpoint
UPDATE "leave_balances" SET "allocated" = "allocated" * 2, "used" = "used" * 2;--> statement-breakpoint
UPDATE "leave_requests" SET "total_days" = "total_days" * 2;--> statement-breakpoint
UPDATE "wfh_requests" SET "total_days" = "total_days" * 2;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "chk_leave_half_day" CHECK (
  ("is_half_day" = false AND "half_day_slot" IS NULL)
  OR
  ("is_half_day" = true AND "half_day_slot" IN ('FIRST_HALF', 'SECOND_HALF') AND "start_date" = "end_date")
);--> statement-breakpoint
ALTER TABLE "wfh_requests" ADD CONSTRAINT "chk_wfh_half_day" CHECK (
  ("is_half_day" = false AND "half_day_slot" IS NULL)
  OR
  ("is_half_day" = true AND "half_day_slot" IN ('FIRST_HALF', 'SECOND_HALF') AND "start_date" = "end_date")
);
