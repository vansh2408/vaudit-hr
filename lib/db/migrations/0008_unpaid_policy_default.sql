-- 0008: Unpaid leave gets a 30-day (60 half-day) policy default.
--
-- Per HR (2026-05-24): even though Unpaid is unlimited (isPaid = false, so
-- the API never decrements the balance — see lib/leave/balance.ts:99),
-- we want the balance editor + audit log to show a default allocation
-- so the policy is visible to anyone reviewing an employee's balances.
--
-- This migration is purely cosmetic / advisory:
--   1. leave_types.default_balance for Unpaid is set to 60 half-days
--      (= 30 days). New employees created after this migration get this
--      value in their leave_balances row.
--   2. EXISTING employees' Unpaid balance rows are bumped from 0 to 60
--      only where the current value is still the seed default (0). Rows
--      an admin has already changed are left alone.
--
-- No enforcement changes — checkBalance still short-circuits on Unpaid.
-- The BalanceCard still renders these rows as "Unlimited" (UI key:
-- `unlimited={!b.isPaid}`); the default just makes the underlying value
-- match HR's policy doc.

UPDATE "leave_types"
   SET "default_balance" = 60
 WHERE "name" = 'Unpaid';--> statement-breakpoint

UPDATE "leave_balances"
   SET "allocated" = 60
 WHERE "allocated" = 0
   AND "leave_type_id" = (SELECT "id" FROM "leave_types" WHERE "name" = 'Unpaid');