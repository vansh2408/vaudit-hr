/**
 * Seed script — 4 test accounts, 7 leave types, sample holidays, and
 * leave balances for current year. Idempotent: re-running upserts users by
 * email and leave types by name, and inserts balances only if missing.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import {
  holidays,
  leaveBalances,
  leaveTypes,
  users,
  type UserRole,
} from "@/lib/db/schema";

interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  position: string;
  department: string;
  birthday: string; // MM-DD
  startDate: string; // YYYY-MM-DD (calendar date, TZ-free)
  managerEmail?: string;
}

interface SeedLeaveType {
  name: string;
  description: string;
  defaultBalance: number;
  isPaid: boolean;
  color: string;
}

const SEED_USERS: SeedUser[] = [
  {
    email: "ceo@vaudit.com",
    firstName: "Casey",
    lastName: "Vaudit",
    role: "SUPER_ADMIN",
    position: "Chief Executive Officer",
    department: "Executive",
    birthday: "1985-03-14",
    startDate: "2020-01-01",
  },
  {
    email: "admin@vaudit.com",
    firstName: "Alex",
    lastName: "Reyes",
    role: "HR_ADMIN",
    position: "HR Administrator",
    department: "People",
    birthday: "1990-07-22",
    startDate: "2021-03-15",
  },
  {
    email: "manager@vaudit.com",
    firstName: "Morgan",
    lastName: "Lee",
    role: "EMPLOYEE",
    position: "Engineering Manager",
    department: "Engineering",
    birthday: "1992-11-05",
    startDate: "2022-06-01",
    managerEmail: "ceo@vaudit.com",
  },
  {
    email: "employee@vaudit.com",
    firstName: "Riley",
    lastName: "Patel",
    role: "EMPLOYEE",
    position: "Software Engineer",
    department: "Engineering",
    birthday: "1996-02-18",
    startDate: "2024-09-09",
    managerEmail: "manager@vaudit.com",
  },
];

// Canonical leave-type policy — values supplied by HR (2026-05-19).
// `Unpaid` is exempt from balance checks via `isPaid: false`; its
// `defaultBalance` is stored as 0 but the API never decrements it (see
// lib/leave/balance.ts). Changing values here only affects rows created
// AFTER the next seed/insert; existing employees are migrated via
// scripts/apply-leave-policy-2026.ts.
const SEED_LEAVE_TYPES: SeedLeaveType[] = [
  {
    name: "Holiday Leave",
    description: "Holiday leave — 13 days per year",
    defaultBalance: 13,
    isPaid: true,
    color: "#f59e0b",
  },
  {
    name: "Annual",
    description: "Annual leave — 10 days per year",
    defaultBalance: 10,
    isPaid: true,
    color: "#2563eb",
  },
  {
    name: "Sick",
    description: "Sick leave — 30 days per year",
    defaultBalance: 30,
    isPaid: true,
    color: "#dc2626",
  },
  {
    name: "Personal",
    description: "Personal leave — 3 days per year",
    defaultBalance: 3,
    isPaid: true,
    color: "#10b981",
  },
  {
    name: "Paternity",
    description: "Paternity leave — 120 days per year",
    defaultBalance: 120,
    isPaid: true,
    color: "#0ea5e9",
  },
  {
    name: "Maternity",
    description: "Maternity leave — 15 days per year",
    defaultBalance: 15,
    isPaid: true,
    color: "#ec4899",
  },
  {
    name: "Unpaid",
    description: "Unpaid leave — unlimited",
    defaultBalance: 0,
    isPaid: false,
    color: "#64748b",
  },
];

/**
 * Seed list of Indian public holidays as (month, day) pairs. We materialise
 * them for the CURRENT year and the NEXT year so cross-year leave requests
 * (e.g. Dec 28 → Jan 3) don't silently miss a holiday on the second side of
 * the boundary.
 *
 * HR_ADMIN / SUPER_ADMIN can edit, add, or remove holidays via the
 * /holidays page after first deploy — this seed only ensures a
 * sensible starter set exists on a fresh DB.
 */
const SEED_HOLIDAY_DEFS: ReadonlyArray<{ month: number; day: number; name: string }> = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 1, day: 26, name: "Republic Day" },
  { month: 3, day: 8, name: "International Women's Day" },
  { month: 8, day: 15, name: "Independence Day" },
  { month: 10, day: 2, name: "Gandhi Jayanti" },
  { month: 12, day: 25, name: "Christmas Day" },
];

function buildSeedHolidays(): Array<{ date: string; name: string }> {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1];
  const out: Array<{ date: string; name: string }> = [];
  for (const year of years) {
    for (const def of SEED_HOLIDAY_DEFS) {
      // Calendar date stored as YYYY-MM-DD string — TZ-free by construction.
      out.push({
        date: `${year}-${String(def.month).padStart(2, "0")}-${String(def.day).padStart(2, "0")}`,
        name: def.name,
      });
    }
  }
  return out;
}

const SEED_HOLIDAYS: Array<{ date: string; name: string }> = buildSeedHolidays();

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  try {
    // ---- Leave types (upsert by name) ----
    for (const lt of SEED_LEAVE_TYPES) {
      await db
        .insert(leaveTypes)
        .values(lt)
        .onConflictDoUpdate({
          target: leaveTypes.name,
          set: {
            description: lt.description,
            defaultBalance: lt.defaultBalance,
            isPaid: lt.isPaid,
            color: lt.color,
            isActive: true,
          },
        });
    }

    // ---- Holidays (upsert by date) ----
    for (const h of SEED_HOLIDAYS) {
      await db
        .insert(holidays)
        .values(h)
        .onConflictDoUpdate({ target: holidays.date, set: { name: h.name } });
    }

    // ---- Users — pass 1: insert without managerId ----
    for (const u of SEED_USERS) {
      await db
        .insert(users)
        .values({
          email: u.email,
          name: `${u.firstName} ${u.lastName}`,
          firstName: u.firstName,
          lastName: u.lastName,
          position: u.position,
          department: u.department,
          birthday: u.birthday,
          startDate: u.startDate,
          role: u.role,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: users.email,
          set: {
            firstName: u.firstName,
            lastName: u.lastName,
            position: u.position,
            department: u.department,
            birthday: u.birthday,
            role: u.role,
            isActive: true,
          },
        });
    }

    // ---- Users — pass 2: resolve managerEmail → managerId ----
    for (const u of SEED_USERS) {
      if (!u.managerEmail) continue;
      await db.execute(sql`
        update ${users} as child
        set manager_id = mgr.id
        from ${users} as mgr
        where child.email = ${u.email} and mgr.email = ${u.managerEmail}
      `);
    }

    // ---- Balances for current year (insert if missing) ----
    const year = new Date().getFullYear();
    const allUsers = await db.select().from(users);
    const allTypes = await db.select().from(leaveTypes);

    for (const u of allUsers) {
      for (const t of allTypes) {
        const existing = await db
          .select({ id: leaveBalances.id })
          .from(leaveBalances)
          .where(
            and(
              eq(leaveBalances.employeeId, u.id),
              eq(leaveBalances.leaveTypeId, t.id),
              eq(leaveBalances.year, year),
            ),
          );
        if (existing.length === 0) {
          await db.insert(leaveBalances).values({
            employeeId: u.id,
            leaveTypeId: t.id,
            year,
            allocated: t.defaultBalance,
            used: 0,
          });
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(
      `Seed complete: ${SEED_USERS.length} users, ${SEED_LEAVE_TYPES.length} leave types, ${SEED_HOLIDAYS.length} holidays.`,
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
