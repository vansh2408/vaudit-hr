/**
 * Back-fill historical leave / WFH records.
 *
 * One-off HR tool to capture leave + WFH that happened BEFORE this app
 * existed. Inserts APPROVED rows directly (skips PENDING → review) and
 * does NOT consume leave_balances — HR adjusts those separately via
 * /admin/balances. Every row gets an audit_logs entry attributed to
 * ACTOR_EMAIL so the back-fill itself is traceable.
 *
 * Usage:
 *   npx tsx scripts/backfill-leave-wfh.ts             # dry-run (default)
 *   npx tsx scripts/backfill-leave-wfh.ts --commit    # writes
 *
 * Workflow:
 *   1. Edit BACKFILL[] below with HR's input.
 *   2. Confirm ACTOR_EMAIL points at the admin running the back-fill.
 *   3. Dry-run, eyeball the output for skips / overlap warnings.
 *   4. Re-run with --commit when satisfied.
 *
 * Safety:
 *   - Dry-run is the default.
 *   - Per-row overlap check (lib/leave/overlap.ts) refuses inserts that
 *     would conflict with existing leave / WFH rows for that employee.
 *   - Each row's insert lives in its own db.transaction; audit-log
 *     writes happen after commit (matches the pattern in the API routes).
 *   - Skipping balance consumption is intentional — see the comment in
 *     the script body. Adjust balances from /admin/balances separately.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

// Static-imported modules below are env-independent (just schemas / pure
// helpers). Anything that touches the singleton `@/lib/db` connection
// (which throws at module-load on a missing DATABASE_URL) is dynamic-
// imported inside main() after dotenv has populated process.env.
import {
  holidays,
  leaveRequests,
  leaveTypes,
  users,
  wfhRequests,
} from "@/lib/db/schema";
import { calcWorkingHalfDays } from "@/lib/leave/working-days";
import { parseYmd, unsafeYmd } from "@/lib/utils/dates";

// Type-only namespace imports — give us the function signatures of the
// modules we later DYNAMICALLY load inside main(). No runtime cost; the
// module body never executes from these declarations.
import type * as OverlapMod from "@/lib/leave/overlap";
import type * as AuditLogMod from "@/lib/audit/log";

// ---- Configuration -------------------------------------------------------

const ACTOR_EMAIL = "vansh@vaudit.com";

interface BackfillLeaveRow {
  email: string;
  kind: "leave";
  /** Must match a leaveTypes.name verbatim (e.g. "Annual", "Sick"). */
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  isHalfDay?: boolean;
  halfDaySlot?: "FIRST_HALF" | "SECOND_HALF";
  reason?: string;
}

interface BackfillWfhRow {
  email: string;
  kind: "wfh";
  startDate: string;
  endDate: string;
  isHalfDay?: boolean;
  halfDaySlot?: "FIRST_HALF" | "SECOND_HALF";
  reason?: string;
}

type BackfillRow = BackfillLeaveRow | BackfillWfhRow;

// NOTE: 45 rows from 2026-05-24 batch (13 employees) committed to DB.
// Overlap check will skip any of those if re-added. Keep this array
// scoped to the *next* batch of rows; the audit_logs table is the
// canonical record of what was inserted.
const BACKFILL: BackfillRow[] = [
  // Ankit — addendum (per HR, 2026-05-24). Sick leave 20 May, half-day morning.
  { email: "ankit@vaudit.com", kind: "leave", leaveTypeName: "Sick",
    startDate: "2026-05-20", endDate: "2026-05-20",
    isHalfDay: true, halfDaySlot: "FIRST_HALF" },
];

// ---- Script --------------------------------------------------------------

interface RunStats {
  inserts: number;
  skips: number;
  errors: number;
}

async function main(): Promise<void> {
  const commit = process.argv.includes("--commit");
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");

  // Late-bind the modules that read `@/lib/db` at module-load (which
  // would throw on a missing DATABASE_URL). loadEnv() has populated
  // process.env by this point, so the singleton inside those modules
  // can connect cleanly.
  const { findOverlap } = await import("@/lib/leave/overlap");
  const { writeAuditLog } = await import("@/lib/audit/log");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  try {
    const actorRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, ACTOR_EMAIL))
      .limit(1);
    const actorId = actorRows[0]?.id;
    if (!actorId) {
      throw new Error(`ACTOR_EMAIL not found: ${ACTOR_EMAIL}`);
    }

    // Holidays for calcWorkingHalfDays — fetched once, reused for every row.
    const holidayRows = await db.select({ date: holidays.date }).from(holidays);
    const holidayYmds = holidayRows.map((h) => unsafeYmd(h.date));

    const stats: RunStats = { inserts: 0, skips: 0, errors: 0 };

    for (const row of BACKFILL) {
      await processRow(
        db,
        row,
        holidayYmds,
        actorId,
        commit,
        stats,
        findOverlap,
        writeAuditLog,
      );
    }

    // eslint-disable-next-line no-console
    console.log("---");
    if (commit) {
      // eslint-disable-next-line no-console
      console.log(
        `Committed: ${stats.inserts} inserted, ${stats.skips} skipped, ${stats.errors} errors.`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `Dry run: ${stats.inserts} would insert, ${stats.skips} skipped, ${stats.errors} errors. Re-run with --commit to apply.`,
      );
    }
  } finally {
    await pool.end();
  }
}

async function processRow(
  db: ReturnType<typeof drizzle>,
  row: BackfillRow,
  holidayYmds: ReadonlyArray<ReturnType<typeof unsafeYmd>>,
  actorId: string,
  commit: boolean,
  stats: RunStats,
  findOverlap: typeof OverlapMod.findOverlap,
  writeAuditLog: typeof AuditLogMod.writeAuditLog,
): Promise<void> {
  const tag = `[${row.email}] ${row.kind}${row.kind === "leave" ? ` ${row.leaveTypeName}` : ""} ${row.startDate}..${row.endDate}`;
  try {
    // Validate Ymd shape (regex + real-calendar check).
    const start = parseYmd(row.startDate);
    const end = parseYmd(row.endDate);

    // Resolve employee. Inactive users are warned but still accepted
    // (HR may be back-filling for an offboarded employee's records).
    const empRows = await db
      .select({ id: users.id, isActive: users.isActive })
      .from(users)
      .where(eq(users.email, row.email))
      .limit(1);
    const emp = empRows[0];
    if (!emp) {
      // eslint-disable-next-line no-console
      console.error(`${tag} SKIP: user not found`);
      stats.skips++;
      return;
    }
    if (!emp.isActive) {
      // eslint-disable-next-line no-console
      console.warn(`${tag} WARN: user is inactive — proceeding`);
    }

    const isHalfDay = row.isHalfDay ?? false;
    const halfDaySlot = row.halfDaySlot ?? null;
    const totalHalfDays = calcWorkingHalfDays(start, end, holidayYmds, isHalfDay, halfDaySlot);
    if (totalHalfDays <= 0) {
      // eslint-disable-next-line no-console
      console.error(`${tag} SKIP: 0 working days (weekend/holiday only?)`);
      stats.skips++;
      return;
    }

    // Resolve leave type if leave.
    let leaveTypeId: string | null = null;
    if (row.kind === "leave") {
      const ltRows = await db
        .select({ id: leaveTypes.id })
        .from(leaveTypes)
        .where(eq(leaveTypes.name, row.leaveTypeName))
        .limit(1);
      if (!ltRows[0]) {
        // eslint-disable-next-line no-console
        console.error(`${tag} SKIP: leave type "${row.leaveTypeName}" not found`);
        stats.skips++;
        return;
      }
      leaveTypeId = ltRows[0].id;
    }

    // Overlap check — refuse inserts that would conflict with existing
    // PENDING / APPROVED / PENDING_CANCELLATION rows for the same dates.
    const overlap = await findOverlap({
      employeeId: emp.id,
      startDate: start,
      endDate: end,
      isHalfDay,
      halfDaySlot,
    });
    if (overlap) {
      // eslint-disable-next-line no-console
      console.error(
        `${tag} SKIP: overlaps existing ${overlap.kind} ${overlap.id} (${overlap.startDate}..${overlap.endDate})`,
      );
      stats.skips++;
      return;
    }

    if (!commit) {
      // eslint-disable-next-line no-console
      console.log(`${tag} → would insert (${totalHalfDays} half-days)`);
      stats.inserts++;
      return;
    }

    // Commit: insert in a tx; write audit log after commit. NOT consuming
    // balance — HR adjusts leave_balances manually after this script.
    let insertedId: string;
    if (row.kind === "leave") {
      insertedId = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(leaveRequests)
          .values({
            employeeId: emp.id,
            leaveTypeId: leaveTypeId!,
            startDate: start,
            endDate: end,
            totalDays: totalHalfDays,
            ...(row.reason !== undefined && { reason: row.reason }),
            status: "APPROVED",
            isHalfDay,
            halfDaySlot,
            reviewedById: actorId,
            reviewedAt: new Date(),
          })
          .returning({ id: leaveRequests.id });
        const x = inserted[0];
        if (!x) throw new Error("INSERT_RETURNED_NO_ROW");
        return x.id;
      });
      await writeAuditLog({
        actorId,
        action: "leave.backfill",
        targetTable: "leave_requests",
        targetId: insertedId,
        metadata: {
          employeeId: emp.id,
          leaveTypeId,
          totalHalfDays,
          startDate: start,
          endDate: end,
          isHalfDay,
          halfDaySlot,
          ...(row.reason !== undefined && { reason: row.reason }),
        },
      });
    } else {
      insertedId = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(wfhRequests)
          .values({
            employeeId: emp.id,
            startDate: start,
            endDate: end,
            totalDays: totalHalfDays,
            ...(row.reason !== undefined && { reason: row.reason }),
            status: "APPROVED",
            isHalfDay,
            halfDaySlot,
            reviewedById: actorId,
            reviewedAt: new Date(),
          })
          .returning({ id: wfhRequests.id });
        const x = inserted[0];
        if (!x) throw new Error("INSERT_RETURNED_NO_ROW");
        return x.id;
      });
      await writeAuditLog({
        actorId,
        action: "wfh.backfill",
        targetTable: "wfh_requests",
        targetId: insertedId,
        metadata: {
          employeeId: emp.id,
          totalHalfDays,
          startDate: start,
          endDate: end,
          isHalfDay,
          halfDaySlot,
          ...(row.reason !== undefined && { reason: row.reason }),
        },
      });
    }

    // eslint-disable-next-line no-console
    console.log(`${tag} → inserted ${insertedId} (${totalHalfDays} half-days)`);
    stats.inserts++;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`${tag} ERROR:`, err instanceof Error ? err.message : err);
    stats.errors++;
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});