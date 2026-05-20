/**
 * Tests for `detectManagerCycle` — the pure manager-chain cycle detector
 * (decisions.md A10). Pure function, no DB, so we can hit every code path
 * with hand-built relation arrays.
 *
 * Two call shapes:
 *   - UPDATE: `employeeId` is the existing row's id.
 *   - CREATE: `employeeId` is `undefined`. The row doesn't yet exist in
 *     `allRelations`; the only failure mode is a pre-existing cycle in
 *     the relations data, which we still surface.
 */
import { describe, it, expect } from "vitest";
import {
  detectManagerCycle,
  type ManagerRelation,
} from "@/lib/security/cycle-detect";

describe("detectManagerCycle", () => {
  describe("UPDATE path (employeeId provided)", () => {
    it("flags self-management as a cycle", () => {
      expect(detectManagerCycle("A", "A", [])).toBe(true);
    });

    it("flags a direct 2-node cycle (A->B, set B->A)", () => {
      // Current state: A reports to B; B has no manager.
      // Proposed: B's managerId becomes A. Walking up from A reaches B
      // (the row we're updating) → cycle.
      const relations: ManagerRelation[] = [
        { id: "A", managerId: "B" },
        { id: "B", managerId: null },
      ];
      expect(detectManagerCycle("B", "A", relations)).toBe(true);
    });

    it("flags an indirect 3-node cycle (A->B->C, set C->A)", () => {
      // A reports to B, B reports to C. Proposing C->A creates A->B->C->A.
      const relations: ManagerRelation[] = [
        { id: "A", managerId: "B" },
        { id: "B", managerId: "C" },
        { id: "C", managerId: null },
      ];
      expect(detectManagerCycle("C", "A", relations)).toBe(true);
    });

    it("accepts an acyclic chain (A->B->C, set D->A)", () => {
      const relations: ManagerRelation[] = [
        { id: "A", managerId: "B" },
        { id: "B", managerId: "C" },
        { id: "C", managerId: null },
        { id: "D", managerId: null },
      ];
      expect(detectManagerCycle("D", "A", relations)).toBe(false);
    });

    it("treats null proposedManagerId as 'no manager' — never a cycle", () => {
      expect(detectManagerCycle("A", null, [])).toBe(false);
      // Even when a current cycle exists, removing the manager is fine.
      const relations: ManagerRelation[] = [
        { id: "A", managerId: "B" },
        { id: "B", managerId: "A" }, // pre-existing cycle
      ];
      expect(detectManagerCycle("A", null, relations)).toBe(false);
    });

    it("detects a pre-existing cycle while walking the proposed chain", () => {
      // Pre-existing cycle B->C->B in the DB. Proposing employee A's
      // manager = B should fail because the walk encounters the cycle.
      const relations: ManagerRelation[] = [
        { id: "A", managerId: null },
        { id: "B", managerId: "C" },
        { id: "C", managerId: "B" },
      ];
      expect(detectManagerCycle("A", "B", relations)).toBe(true);
    });

    it("returns false when the proposed manager is not in the relation set", () => {
      // The detector treats missing nodes as 'unknown — cannot prove cycle'.
      // Caller is responsible for supplying complete data.
      const relations: ManagerRelation[] = [
        { id: "A", managerId: null },
      ];
      expect(detectManagerCycle("A", "ghost", relations)).toBe(false);
    });

    it("does not blow the stack on a very deep linear chain (1,200 nodes)", () => {
      // Build a 1,200-deep chain: 0->1->2->...->1199. Internal MAX_CHAIN_DEPTH
      // is 1,000, so the detector should bail out with `true` (refusal)
      // rather than recurse to death.
      const n = 1_200;
      const relations: ManagerRelation[] = [];
      for (let i = 0; i < n; i += 1) {
        const next: string | null = i === n - 1 ? null : String(i + 1);
        relations.push({ id: String(i), managerId: next });
      }
      // Proposing root of the chain as the manager of node n-1 is a real
      // cycle (n-1 -> 0 -> ... -> n-1). The depth cap MUST fire `true`.
      expect(detectManagerCycle(String(n - 1), "0", relations)).toBe(true);
    });

    it("returns false for a deep but legitimate chain that terminates", () => {
      // 100-deep linear chain with a clear root — well under the cap and
      // does not loop back. Must return false.
      const n = 100;
      const relations: ManagerRelation[] = [];
      for (let i = 0; i < n; i += 1) {
        const next: string | null = i === n - 1 ? null : String(i + 1);
        relations.push({ id: String(i), managerId: next });
      }
      // Add an unrelated employee whose manager is mid-chain.
      relations.push({ id: "outsider", managerId: null });
      expect(detectManagerCycle("outsider", "0", relations)).toBe(false);
    });
  });

  describe("CREATE path (employeeId === undefined)", () => {
    it("never falsely flags a brand-new row whose proposed chain is acyclic", () => {
      // No existing cycle, no employeeId — should be false.
      const relations: ManagerRelation[] = [
        { id: "A", managerId: null },
        { id: "B", managerId: "A" },
      ];
      expect(detectManagerCycle(undefined, "B", relations)).toBe(false);
    });

    it("still detects a pre-existing cycle in the relations data", () => {
      const relations: ManagerRelation[] = [
        { id: "A", managerId: "B" },
        { id: "B", managerId: "A" },
      ];
      expect(detectManagerCycle(undefined, "A", relations)).toBe(true);
    });

    it("returns false when proposed manager is null (creating a root)", () => {
      expect(detectManagerCycle(undefined, null, [])).toBe(false);
    });

    it("ignores self-management check on CREATE (no row id yet)", () => {
      // Without an employeeId, there is no 'self' to clash with.
      // Acyclic relations → no cycle.
      expect(detectManagerCycle(undefined, "anyone", [])).toBe(false);
    });
  });
});
