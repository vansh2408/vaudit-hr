/**
 * HARD-DELETE a user — destructive, one-off cleanup tool.
 *
 * Use only for test / seed users that need to be permanently removed.
 * Production employees should be soft-deleted via `isActive = false`
 * (the existing /admin/employees deactivate flow) so their history,
 * audit attribution, and approval chain stay intact.
 *
 * Usage:
 *   npx tsx scripts/delete-user.ts <email>             # dry-run (default)
 *   npx tsx scripts/delete-user.ts <email> --commit    # actually deletes
 *
 * What happens on commit:
 *   - users row: DELETED.
 *   - leave_requests.employeeId = user → CASCADE DELETE.
 *   - wfh_requests.employeeId = user → CASCADE DELETE.
 *   - leave_balances.employeeId = user → CASCADE DELETE.
 *   - notifications.userId = user → CASCADE DELETE (per schema).
 *   - leave/wfh_requests.reviewedById = user → SET NULL (rows preserved).
 *   - audit_logs.actorId = user → SET NULL (entries preserved, attribution lost).
 *   - users.managerId = user (direct reports) → SET NULL (reports become unmanaged).
 *
 * Safety:
 *   - Dry-run prints all impact counts.
 *   - Refuses if the target is the last active SUPER_ADMIN (lockout guard).
 *   - Refuses on --commit unless the email is passed *and* matches.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, isNotNull, ne, count } from "drizzle-orm";

import {
  auditLogs,
  leaveBalances,
  leaveRequests,
  users,
  wfhRequests,
} from "@/lib/db/schema";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith("--"));
  const commit = args.includes("--commit");

  if (!email) {
    // eslint-disable-next-line no-console
    console.error(
      "Usage: npx tsx scripts/delete-user.ts <email> [--commit]",
    );
    process.exit(1);
  }

  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  try {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        role: users.role,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const target = rows[0];
    if (!target) {
      // eslint-disable-next-line no-console
      console.error(`No user found with email: ${email}`);
      process.exit(1);
    }

    // Last-active-SUPER_ADMIN guard mirrors the role-change route.
    if (target.role === "SUPER_ADMIN" && target.isActive) {
      const others = await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.role, "SUPER_ADMIN"),
            eq(users.isActive, true),
            ne(users.id, target.id),
          ),
        )
        .limit(1);
      if (others.length === 0) {
        // eslint-disable-next-line no-console
        console.error(
          `Refusing to delete the last active SUPER_ADMIN (${email}). Promote another super-admin first.`,
        );
        process.exit(1);
      }
    }

    // Count dependents so the dry-run shows full impact.
    const [
      leaveOwnedRows,
      wfhOwnedRows,
      balanceRows,
      leaveReviewedRows,
      wfhReviewedRows,
      auditActorRows,
      managedRows,
    ] = await Promise.all([
      db
        .select({ n: count() })
        .from(leaveRequests)
        .where(eq(leaveRequests.employeeId, target.id)),
      db
        .select({ n: count() })
        .from(wfhRequests)
        .where(eq(wfhRequests.employeeId, target.id)),
      db
        .select({ n: count() })
        .from(leaveBalances)
        .where(eq(leaveBalances.employeeId, target.id)),
      db
        .select({ n: count() })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.reviewedById, target.id),
            isNotNull(leaveRequests.reviewedById),
          ),
        ),
      db
        .select({ n: count() })
        .from(wfhRequests)
        .where(
          and(
            eq(wfhRequests.reviewedById, target.id),
            isNotNull(wfhRequests.reviewedById),
          ),
        ),
      db
        .select({ n: count() })
        .from(auditLogs)
        .where(eq(auditLogs.actorId, target.id)),
      db
        .select({ n: count() })
        .from(users)
        .where(eq(users.managerId, target.id)),
    ]);

    const leaveOwned = leaveOwnedRows[0]?.n ?? 0;
    const wfhOwned = wfhOwnedRows[0]?.n ?? 0;
    const balances = balanceRows[0]?.n ?? 0;
    const leaveReviewed = leaveReviewedRows[0]?.n ?? 0;
    const wfhReviewed = wfhReviewedRows[0]?.n ?? 0;
    const auditActor = auditActorRows[0]?.n ?? 0;
    const managed = managedRows[0]?.n ?? 0;

    // eslint-disable-next-line no-console
    console.log(
      `Target: ${target.firstName} ${target.lastName} <${target.email}> (role=${target.role}, ${target.isActive ? "ACTIVE" : "INACTIVE"})`,
    );
    // eslint-disable-next-line no-console
    console.log(`  leave_requests owned       (CASCADE DELETE) : ${leaveOwned}`);
    // eslint-disable-next-line no-console
    console.log(`  wfh_requests owned         (CASCADE DELETE) : ${wfhOwned}`);
    // eslint-disable-next-line no-console
    console.log(`  leave_balances             (CASCADE DELETE) : ${balances}`);
    // eslint-disable-next-line no-console
    console.log(`  leave_requests reviewed    (SET NULL)       : ${leaveReviewed}`);
    // eslint-disable-next-line no-console
    console.log(`  wfh_requests reviewed      (SET NULL)       : ${wfhReviewed}`);
    // eslint-disable-next-line no-console
    console.log(`  audit_logs as actor        (SET NULL)       : ${auditActor}`);
    // eslint-disable-next-line no-console
    console.log(`  users with this as manager (SET NULL)       : ${managed}`);

    if (!commit) {
      // eslint-disable-next-line no-console
      console.log(
        `\nDry run. Re-run with --commit to actually delete this user.`,
      );
      return;
    }

    // Commit: single DELETE; FK cascade + set-null rules in the schema
    // handle every dependent row atomically.
    await db.delete(users).where(eq(users.id, target.id));
    // eslint-disable-next-line no-console
    console.log(`\n✓ Deleted ${target.email}.`);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});