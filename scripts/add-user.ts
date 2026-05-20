/**
 * Add a single user to the HR system (bootstrap / one-off provisioning).
 * Idempotent: re-running with the same email updates the existing row.
 * Auto-creates leave balances for the current year against every active
 * leave type — same behaviour as the /admin/employees POST handler.
 *
 * Usage:
 *   npx tsx scripts/add-user.ts <email> <role> <firstName> <lastName> [position] [department]
 *
 * Examples:
 *   npx tsx scripts/add-user.ts vansh@vaudit.com SUPER_ADMIN Vansh Joshi
 *   npx tsx scripts/add-user.ts jane@vaudit.com EMPLOYEE Jane Doe "Senior Engineer" Engineering
 *
 * Role must be one of: EMPLOYEE, HR_ADMIN, SUPER_ADMIN
 * Manager status is structural — assign a manager via the employee form,
 * not via this script's role argument.
 * Email domain must be in ALLOWED_EMAIL_DOMAINS (.env.local).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import {
  leaveBalances,
  leaveTypes,
  users,
  type UserRole,
} from "@/lib/db/schema";
import { todayYmd } from "@/lib/utils/dates";

const VALID_ROLES = ["EMPLOYEE", "HR_ADMIN", "SUPER_ADMIN"] as const;
type ValidRole = (typeof VALID_ROLES)[number];

function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

function isValidRole(s: string): s is ValidRole {
  return (VALID_ROLES as readonly string[]).includes(s);
}

async function main(): Promise<void> {
  const [emailRaw, roleRaw, firstName, lastName, positionArg, departmentArg] =
    process.argv.slice(2);

  if (!emailRaw || !roleRaw || !firstName || !lastName) {
    console.error(
      "Usage: npx tsx scripts/add-user.ts <email> <role> <firstName> <lastName> [position] [department]",
    );
    process.exit(1);
  }

  const email = emailRaw.toLowerCase();
  const domain = emailDomain(email);
  if (!domain) throw new Error(`Invalid email: ${emailRaw}`);

  const allowed = (process.env["ALLOWED_EMAIL_DOMAINS"] ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(domain)) {
    throw new Error(
      `Email domain "${domain}" not in ALLOWED_EMAIL_DOMAINS (${allowed.join(", ") || "<empty>"})`,
    );
  }

  if (!isValidRole(roleRaw)) {
    throw new Error(
      `Invalid role "${roleRaw}". Must be one of: ${VALID_ROLES.join(", ")}`,
    );
  }
  const role: UserRole = roleRaw;

  const position = positionArg ?? "Team Member";
  const department = departmentArg ?? "General";

  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  try {
    const [inserted] = await db
      .insert(users)
      .values({
        email,
        name: `${firstName} ${lastName}`,
        firstName,
        lastName,
        position,
        department,
        role,
        startDate: todayYmd(),
        isActive: true,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          firstName,
          lastName,
          position,
          department,
          role,
          isActive: true,
        },
      })
      .returning({ id: users.id, email: users.email, role: users.role });

    if (!inserted) {
      throw new Error("Failed to upsert user");
    }

    // Auto-create leave balances for the current year against every active
    // leave type, mirroring the /admin/employees POST handler.
    const year = new Date().getFullYear();
    const allTypes = await db
      .select()
      .from(leaveTypes)
      .where(eq(leaveTypes.isActive, true));

    let createdBalances = 0;
    for (const t of allTypes) {
      const existing = await db
        .select({ id: leaveBalances.id })
        .from(leaveBalances)
        .where(
          and(
            eq(leaveBalances.employeeId, inserted.id),
            eq(leaveBalances.leaveTypeId, t.id),
            eq(leaveBalances.year, year),
          ),
        );
      if (existing.length === 0) {
        await db.insert(leaveBalances).values({
          employeeId: inserted.id,
          leaveTypeId: t.id,
          year,
          allocated: t.defaultBalance,
          used: 0,
        });
        createdBalances++;
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `User ready: ${inserted.email} (${inserted.role}) — id=${inserted.id}, balances created=${createdBalances}/${allTypes.length}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
