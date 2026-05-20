/**
 * Manager-cycle detection (decisions.md A10) — single source of truth.
 *
 * Pure function — no DB access — so it can be invoked from every code path
 * that needs to validate a proposed `managerId` mutation:
 *   - Single employee CREATE (pass `employeeId: undefined`; the row doesn't
 *     exist yet, so no chain can loop back to it — the only failure mode is
 *     a pre-existing cycle in `allRelations`, which we still flag.)
 *   - Single employee UPDATE (pass the row's real `id`).
 *   - CSV bulk-import dry-run / commit (caller assembles the merged
 *     `allRelations` set incl. the rows being inserted/updated, using
 *     synthetic ids for rows that don't yet have a DB id).
 *
 * The walk climbs the manager chain from the proposed manager upwards. If
 * we ever revisit `employeeId`, a cycle would form. We also bail out after
 * a hard step cap to defend against runaway loops introduced by buggy data
 * (e.g. a pre-existing cycle in the DB that an FK / earlier check missed).
 *
 * Replaces the older DB-walking `detectCycle` helper (`lib/employee/
 * cycle-detect.ts`, removed Phase 7). The DB-walker took a placeholder
 * sentinel id for create paths and could silently miss cycles — that's
 * been a known foot-gun called out in `docs/reviews/wave-1-backend.md`
 * finding 7 and `docs/reviews/cross-cutting.md` item 3.
 */

export interface ManagerRelation {
  id: string;
  managerId: string | null;
}

const MAX_CHAIN_DEPTH = 1_000;

/**
 * @param employeeId       The row whose `managerId` is being changed.
 *                         Pass `undefined` for the CREATE case — the row
 *                         does not yet exist, so the chain cannot loop back
 *                         to it via `id`. Callers must NOT invent a sentinel
 *                         (it would silently match nothing on a real cycle).
 * @param proposedManagerId The candidate manager id, or `null` for "no manager".
 * @param allRelations     Every `{id, managerId}` pair the caller wants the
 *                         walk to see. For UPDATE this is the live `users`
 *                         table; for CSV it's live + the staged inserts/updates
 *                         with synthetic ids.
 */
export function detectManagerCycle(
  employeeId: string | undefined,
  proposedManagerId: string | null,
  allRelations: ReadonlyArray<ManagerRelation>,
): boolean {
  // No manager proposed → cannot form a cycle.
  if (proposedManagerId === null) return false;

  // Self-management is always a cycle (length-0 cycle). Only meaningful
  // when employeeId is supplied (UPDATE path).
  if (employeeId !== undefined && proposedManagerId === employeeId) {
    return true;
  }

  // Index the relations once for O(1) lookup as we walk.
  const byId = new Map<string, ManagerRelation>();
  for (const rel of allRelations) {
    byId.set(rel.id, rel);
  }

  // Track visited nodes during the climb so we also catch pre-existing
  // cycles in the data — those should be flagged loudly, not infinite-loop.
  const visited = new Set<string>();
  let cursor: string | null = proposedManagerId;
  let steps = 0;

  while (cursor !== null) {
    if (employeeId !== undefined && cursor === employeeId) {
      // Walking up the proposed manager's chain looped back to us → cycle.
      return true;
    }
    if (visited.has(cursor)) {
      // Pre-existing cycle in the relations data. Treat as a cycle so the
      // caller refuses the operation rather than silently amplifying bad
      // state.
      return true;
    }
    visited.add(cursor);

    if (++steps > MAX_CHAIN_DEPTH) {
      // Pathological chain — refuse rather than burn CPU.
      return true;
    }

    const node = byId.get(cursor);
    if (!node) {
      // Proposed manager (or some ancestor) is not present in the relation
      // set. Caller must pass complete data; treat missing as a non-cycle
      // because we cannot prove otherwise from here.
      return false;
    }
    cursor = node.managerId;
  }

  return false;
}
