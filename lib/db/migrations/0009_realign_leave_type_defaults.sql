-- 0009: realign leave_types.default_balance with actual HR policy.
--
-- The seed defaults were set during initial scaffold, before HR
-- specified the real policy. Three values were wrong; this migration
-- realigns them. EXISTING leave_balances rows are intentionally NOT
-- touched — HR has manually adjusted per-employee allocations to match
-- the real policy, and re-running a backfill would overwrite those
-- deliberate edits.
--
-- Changes (half-day units, post-0006):
--   Holiday Leave   26  → 14   (was 13 days, now 7 — HR confirmed 2026-05-25)
--   Maternity       30  → 120  (was 15 days, now 60 — female-policy max)
--   Paternity       240 → 30   (was 120 days, now 15 — male-policy max)
--
-- Rationale for Maternity = 60 + Paternity = 15 defaults: HR policy is
-- gender-based (male: P=15 M=0; female: M=60 P=0), but `users` doesn't
-- track gender, so no single default is universally correct. The
-- migration sets each type to its real per-gender max; HR then zeros
-- the irrelevant one per new hire (one edit per new employee).
--
-- Failure mode of this choice: if HR forgets to zero the wrong-gender
-- type, the employee has an over-allocation they could (mis-)request
-- — this is *visible* the next time they try to take that leave, and
-- caught by the existing gender audit script. Compared with the
-- alternative ("zero both defaults"), where forgetting to set means
-- the employee can't request leave they're entitled to — *silent*
-- denial that only surfaces when the employee asks. Over-allocation is
-- easier to notice + correct than under-allocation.
--
-- Holiday Leave: 7-day default matches the majority of employees. HR
-- already manually bumped certain employees above 7 for tenure. Those
-- rows are untouched here; only the seed default changes.

UPDATE "leave_types" SET "default_balance" = 14  WHERE "name" = 'Holiday Leave';--> statement-breakpoint
UPDATE "leave_types" SET "default_balance" = 120 WHERE "name" = 'Maternity';--> statement-breakpoint
UPDATE "leave_types" SET "default_balance" = 30  WHERE "name" = 'Paternity';