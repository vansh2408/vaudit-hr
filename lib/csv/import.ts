/**
 * CSV bulk employee import — decisions.md A16.
 *
 * Pipeline:
 *  1. Parse CSV (papaparse, header row required)
 *  2. Per-row Zod validation — accumulate errors, never throw on first
 *  3. Detect intra-CSV duplicates by email
 *  4. Pre-fetch existing users by email — flag skip/update per chosen policy
 *  5. Build the "if all rows applied" view of the org graph
 *  6. Resolve managerEmail → managerId across CSV rows + DB
 *  7. Detect cycles using the merged graph
 *  8. If mode=dryrun → return the plan, no DB writes
 *  9. If mode=commit → single transaction:
 *      a. Insert/update users (two-pass: insert with null managerId first)
 *      b. Resolve managerId in pass 2
 *      c. Create missing leave_balances for current year for active types
 */
import Papa from "papaparse";
import { inArray } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/lib/db";
import {
  leaveBalances,
  leaveTypes,
  users,
  type UserRole,
} from "@/lib/db/schema";
import { employeeImportRowSchema } from "@/lib/validation/common";
import { detectManagerCycle } from "@/lib/security/cycle-detect";
import { sanitizeFreeText } from "@/lib/security/sanitize";

export type ImportMode = "dryrun" | "commit";
export type ExistingEmailPolicy = "skip" | "update";

export type ParsedRow = z.infer<typeof employeeImportRowSchema>;

export interface RowResult {
  rowIndex: number; // 0-based, header excluded
  email: string | null;
  status: "insert" | "update" | "skip" | "error";
  errors: string[];
}

export interface ImportResult {
  mode: ImportMode;
  policy: ExistingEmailPolicy;
  totalRows: number;
  willInsert: number;
  willUpdate: number;
  willSkip: number;
  errors: number;
  rowResults: RowResult[];
  // Only populated on commit
  committed?: {
    inserted: number;
    updated: number;
    balancesCreated: number;
  };
}

interface PlannedRow {
  rowIndex: number;
  parsed: ParsedRow;
  action: "insert" | "update" | "skip";
  existingId: string | null;
}

export async function importEmployeesFromCsv(
  csvText: string,
  mode: ImportMode,
  policy: ExistingEmailPolicy,
  actorId: string | null,
): Promise<ImportResult> {
  void actorId; // reserved for audit-log calls at the route layer

  // ---- Parse ----
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const rawRows = parsed.data;

  const rowResults: RowResult[] = [];
  const validRows: Array<{ rowIndex: number; data: ParsedRow }> = [];

  // ---- Per-row validation ----
  rawRows.forEach((raw, idx) => {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      cleaned[k] = typeof v === "string" ? v.trim() : "";
    }
    const result = employeeImportRowSchema.safeParse(cleaned);
    if (!result.success) {
      rowResults.push({
        rowIndex: idx,
        email: typeof cleaned["email"] === "string" ? cleaned["email"] : null,
        status: "error",
        errors: result.error.issues.map(
          (i) => `${i.path.join(".") || "(row)"}: ${i.message}`,
        ),
      });
      return;
    }
    validRows.push({ rowIndex: idx, data: result.data });
  });

  // ---- Intra-CSV duplicate check ----
  const seenEmails = new Map<string, number>();
  for (const v of validRows) {
    const prev = seenEmails.get(v.data.email);
    if (prev !== undefined) {
      rowResults.push({
        rowIndex: v.rowIndex,
        email: v.data.email,
        status: "error",
        errors: [`Duplicate email in CSV (also at row ${prev})`],
      });
    } else {
      seenEmails.set(v.data.email, v.rowIndex);
    }
  }
  const duplicateIndexes = new Set(
    rowResults.filter((r) => r.status === "error").map((r) => r.rowIndex),
  );
  const dedupedRows = validRows.filter((v) => !duplicateIndexes.has(v.rowIndex));

  if (dedupedRows.length === 0) {
    return finaliseDryRun(rowResults, mode, policy, rawRows.length);
  }

  // ---- Look up existing users by email ----
  const emails = dedupedRows.map((r) => r.data.email);
  const existing =
    emails.length > 0
      ? await db
          .select({
            id: users.id,
            email: users.email,
            managerId: users.managerId,
          })
          .from(users)
          .where(inArray(users.email, emails))
      : [];
  const existingByEmail = new Map(existing.map((u) => [u.email, u]));

  // ---- Compute action per row ----
  const planned: PlannedRow[] = [];
  for (const v of dedupedRows) {
    const match = existingByEmail.get(v.data.email);
    if (match) {
      if (policy === "skip") {
        planned.push({
          rowIndex: v.rowIndex,
          parsed: v.data,
          action: "skip",
          existingId: match.id,
        });
      } else {
        planned.push({
          rowIndex: v.rowIndex,
          parsed: v.data,
          action: "update",
          existingId: match.id,
        });
      }
    } else {
      planned.push({
        rowIndex: v.rowIndex,
        parsed: v.data,
        action: "insert",
        existingId: null,
      });
    }
  }

  // ---- Resolve managerEmail → managerId (consider CSV inserts) ----
  const allUsersForGraph = await db
    .select({ id: users.id, email: users.email, managerId: users.managerId })
    .from(users);
  const idByEmailLive = new Map(allUsersForGraph.map((u) => [u.email, u.id]));
  // Synthesize ids for inserts so cycle detection has nodes to reason about.
  const synthIdByEmail = new Map<string, string>();
  for (const p of planned) {
    if (p.action === "insert") {
      synthIdByEmail.set(
        p.parsed.email,
        `__pending_${p.rowIndex}_${p.parsed.email}`,
      );
    }
  }
  function resolveEmailToId(email: string): string | undefined {
    return idByEmailLive.get(email) ?? synthIdByEmail.get(email);
  }

  // Build merged graph: live users + planned changes.
  const mergedGraph = new Map<string, string | null>();
  for (const u of allUsersForGraph) mergedGraph.set(u.id, u.managerId ?? null);
  for (const p of planned) {
    const selfId =
      p.existingId ?? synthIdByEmail.get(p.parsed.email) ?? p.parsed.email;
    const mgrId = p.parsed.managerEmail
      ? resolveEmailToId(p.parsed.managerEmail) ?? null
      : null;
    mergedGraph.set(selfId, mgrId);
  }
  const candidates = Array.from(mergedGraph, ([id, managerId]) => ({
    id,
    managerId,
  }));

  // ---- Per-row cycle + manager-resolution checks ----
  for (const p of planned) {
    const rowErrors: string[] = [];
    let managerId: string | null = null;
    if (p.parsed.managerEmail) {
      const resolved = resolveEmailToId(p.parsed.managerEmail);
      if (!resolved) {
        rowErrors.push(
          `managerEmail "${p.parsed.managerEmail}" not found in CSV or DB`,
        );
      } else {
        managerId = resolved;
      }
    }
    const selfId =
      p.existingId ?? synthIdByEmail.get(p.parsed.email) ?? p.parsed.email;
    if (managerId) {
      // For UPDATE rows we have the live id; for INSERT rows we have a
      // synthetic id that is also represented in `candidates`. Pass it as
      // the employeeId so the detector catches chains looping back through
      // the new row.
      if (detectManagerCycle(selfId, managerId, candidates)) {
        rowErrors.push("Manager chain would create a cycle");
      }
    }
    if (rowErrors.length > 0) {
      rowResults.push({
        rowIndex: p.rowIndex,
        email: p.parsed.email,
        status: "error",
        errors: rowErrors,
      });
    } else {
      rowResults.push({
        rowIndex: p.rowIndex,
        email: p.parsed.email,
        status: p.action,
        errors: [],
      });
    }
  }

  const errorIndexes = new Set(
    rowResults.filter((r) => r.status === "error").map((r) => r.rowIndex),
  );
  const committable = planned.filter((p) => !errorIndexes.has(p.rowIndex));

  if (mode === "dryrun") {
    return finaliseDryRun(rowResults, mode, policy, rawRows.length);
  }

  // ---- COMMIT ----
  const committed = await db.transaction(async (tx) => {
    let inserted = 0;
    let updated = 0;
    const emailToNewId = new Map<string, string>();

    // Pass 1: insert with null managerId; update non-manager fields.
    for (const p of committable) {
      if (p.action === "skip") continue;
      const d = p.parsed;
      const role: UserRole = d.role;
      // T3: every free-text column must be sanitised before insert. Drizzle's
      // parameterised query handles SQL-side injection; this defends Slack
      // DMs / future exports against stored XSS originating from CSV uploads.
      const safe = {
        firstName: sanitizeFreeText(d.firstName),
        lastName: sanitizeFreeText(d.lastName),
        address: d.address !== undefined ? sanitizeFreeText(d.address) : undefined,
        position: d.position !== undefined ? sanitizeFreeText(d.position) : undefined,
        department: d.department !== undefined ? sanitizeFreeText(d.department) : undefined,
      };
      if (p.action === "insert") {
        const newId = crypto.randomUUID();
        await tx.insert(users).values({
          id: newId,
          email: d.email,
          name: `${safe.firstName} ${safe.lastName}`,
          firstName: safe.firstName,
          lastName: safe.lastName,
          ...(d.phone !== undefined && { phone: d.phone }),
          ...(safe.address !== undefined && { address: safe.address }),
          ...(safe.position !== undefined && { position: safe.position }),
          ...(safe.department !== undefined && { department: safe.department }),
          ...(d.startDate !== undefined && { startDate: d.startDate }),
          ...(d.birthday !== undefined && { birthday: d.birthday }),
          role,
          ...(d.slackUserId !== undefined && { slackUserId: d.slackUserId }),
          isActive: true,
          managerId: null,
        });
        emailToNewId.set(d.email, newId);
        inserted += 1;
      } else if (p.action === "update" && p.existingId) {
        await tx
          .update(users)
          .set({
            firstName: safe.firstName,
            lastName: safe.lastName,
            name: `${safe.firstName} ${safe.lastName}`,
            ...(d.phone !== undefined && { phone: d.phone }),
            ...(safe.address !== undefined && { address: safe.address }),
            ...(safe.position !== undefined && { position: safe.position }),
            ...(safe.department !== undefined && { department: safe.department }),
            ...(d.startDate !== undefined && { startDate: d.startDate }),
            ...(d.birthday !== undefined && { birthday: d.birthday }),
            role,
            ...(d.slackUserId !== undefined && { slackUserId: d.slackUserId }),
          })
          .where(inArray(users.id, [p.existingId]));
        updated += 1;
      }
    }

    // Pass 2: resolve managerId now that all rows exist in DB.
    const allLive = await tx
      .select({ id: users.id, email: users.email })
      .from(users);
    const liveIdByEmail = new Map(allLive.map((u) => [u.email, u.id]));

    for (const p of committable) {
      if (p.action === "skip") continue;
      if (!p.parsed.managerEmail) continue;
      const mgrId = liveIdByEmail.get(p.parsed.managerEmail);
      if (!mgrId) continue;
      const selfId =
        p.existingId ??
        emailToNewId.get(p.parsed.email) ??
        liveIdByEmail.get(p.parsed.email);
      if (!selfId) continue;
      await tx
        .update(users)
        .set({ managerId: mgrId })
        .where(inArray(users.id, [selfId]));
    }

    // Auto-create balances for INSERTS only (updates keep existing balances).
    const year = new Date().getFullYear();
    const allTypes = await tx
      .select({ id: leaveTypes.id, defaultBalance: leaveTypes.defaultBalance })
      .from(leaveTypes)
      .where(inArray(leaveTypes.isActive, [true]));
    let balancesCreated = 0;
    for (const [, newId] of emailToNewId) {
      for (const t of allTypes) {
        await tx
          .insert(leaveBalances)
          .values({
            employeeId: newId,
            leaveTypeId: t.id,
            year,
            allocated: t.defaultBalance,
            used: 0,
          })
          .onConflictDoNothing();
        balancesCreated += 1;
      }
    }

    return { inserted, updated, balancesCreated };
  });

  const summary = summarise(rowResults);
  return {
    mode,
    policy,
    totalRows: rawRows.length,
    willInsert: summary.insert,
    willUpdate: summary.update,
    willSkip: summary.skip,
    errors: summary.error,
    rowResults,
    committed,
  };
}

function summarise(rowResults: RowResult[]) {
  let insert = 0;
  let update = 0;
  let skip = 0;
  let error = 0;
  for (const r of rowResults) {
    if (r.status === "insert") insert += 1;
    else if (r.status === "update") update += 1;
    else if (r.status === "skip") skip += 1;
    else error += 1;
  }
  return { insert, update, skip, error };
}

function finaliseDryRun(
  rowResults: RowResult[],
  mode: ImportMode,
  policy: ExistingEmailPolicy,
  total: number,
): ImportResult {
  const s = summarise(rowResults);
  return {
    mode,
    policy,
    totalRows: total,
    willInsert: s.insert,
    willUpdate: s.update,
    willSkip: s.skip,
    errors: s.error,
    rowResults,
  };
}
