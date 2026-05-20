/**
 * Set a user's role and/or manager — direct DB write.
 *
 * Bypasses API guards (last-active-SUPER_ADMIN, self-demote,
 * self-managerId) ON PURPOSE: this script is for one-off org bootstrap
 * or repair when you don't have a peer admin to make the change through
 * the UI. Every change is still recorded in `audit_logs` so the trail
 * isn't lost.
 *
 * Usage:
 *   npx tsx scripts/set-user-role.ts <email> <role> [managerEmail|NONE]
 *
 * Examples:
 *   npx tsx scripts/set-user-role.ts vansh@vaudit.com EMPLOYEE support@vaudit.com
 *   npx tsx scripts/set-user-role.ts vansh@vaudit.com SUPER_ADMIN
 *   npx tsx scripts/set-user-role.ts vansh@vaudit.com EMPLOYEE NONE
 *
 * Role must be one of: EMPLOYEE, HR_ADMIN, SUPER_ADMIN.
 * managerEmail is optional. Pass "NONE" (or "null") to clear the manager.
 * Omit it to leave the manager unchanged.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import {
  auditLogs,
  users,
  type UserRole,
} from "@/lib/db/schema";

const VALID_ROLES = ["EMPLOYEE", "HR_ADMIN", "SUPER_ADMIN"] as const;
type ValidRole = (typeof VALID_ROLES)[number];

function isValidRole(v: string): v is ValidRole {
  return (VALID_ROLES as readonly string[]).includes(v);
}

async function main(): Promise<void> {
  const [emailRaw, roleRaw, managerEmailRaw] = process.argv.slice(2);

  if (!emailRaw || !roleRaw) {
    console.error(
      "Usage: npx tsx scripts/set-user-role.ts <email> <role> [managerEmail|NONE]",
    );
    process.exit(1);
  }

  if (!isValidRole(roleRaw)) {
    throw new Error(
      `Invalid role "${roleRaw}". Must be one of: ${VALID_ROLES.join(", ")}`,
    );
  }
  const role: UserRole = roleRaw;
  const email = emailRaw.toLowerCase();
  const managerArg = managerEmailRaw?.toLowerCase();

  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  try {
    const userRows = await db
      .select({
        id: users.id,
        role: users.role,
        managerId: users.managerId,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    const user = userRows[0];
    if (!user) {
      throw new Error(`No user with email ${email}`);
    }

    // Resolve managerId: undefined → don't touch, null → clear, string → set.
    let managerId: string | null | undefined = undefined;
    if (managerArg !== undefined) {
      if (managerArg === "none" || managerArg === "null") {
        managerId = null;
      } else {
        const mgrRows = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, managerArg))
          .limit(1);
        const mgr = mgrRows[0];
        if (!mgr) throw new Error(`No user with email ${managerArg}`);
        if (mgr.id === user.id) {
          throw new Error("A user cannot be their own manager");
        }
        managerId = mgr.id;
      }
    }

    await db
      .update(users)
      .set({
        role,
        ...(managerId !== undefined && { managerId }),
      })
      .where(eq(users.id, user.id));

    await db.insert(auditLogs).values({
      actorId: null, // system / script
      action: "script.set_user_role",
      targetTable: "users",
      targetId: user.id,
      metadata: {
        email,
        from: { role: user.role, managerId: user.managerId },
        to: {
          role,
          managerId: managerId !== undefined ? managerId : user.managerId,
        },
        managerEmail: managerArg ?? null,
        invokedAt: new Date().toISOString(),
      },
    });

    // eslint-disable-next-line no-console
    console.log(
      `✓ ${email}: role=${role}` +
        (managerId !== undefined
          ? `, managerId=${managerId ?? "(cleared)"}`
          : ""),
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("set-user-role failed:", err);
  process.exit(1);
});
