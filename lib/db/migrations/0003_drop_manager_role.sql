-- Drop MANAGER as a user_role enum value. Approval rights now derive
-- purely from the users.manager_id self-reference: anyone listed as
-- someone's manager_id can approve that person's requests, no special
-- role required. See decisions.md.
--
-- Step 1: demote any existing MANAGER rows so the cast in step 5 does
-- not fail. They keep their approval rights via manager_id pointing at
-- them — only the redundant role label goes away.
UPDATE "users" SET "role" = 'EMPLOYEE' WHERE "role" = 'MANAGER';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE'::text;--> statement-breakpoint
DROP TYPE "public"."user_role";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('EMPLOYEE', 'HR_ADMIN', 'SUPER_ADMIN');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE'::"public"."user_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";
