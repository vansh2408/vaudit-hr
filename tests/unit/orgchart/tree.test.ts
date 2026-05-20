/**
 * Tests for `buildTree` — the org-chart flat→tree adapter.
 *
 * Important shape contracts:
 *   - One root per managerId == null.
 *   - Orphans (managerId points to a missing id) are surfaced as roots
 *     rather than dropped; we never silently lose subtrees.
 *   - Children are sorted alphabetically by their composed `name`.
 */
import { describe, it, expect } from "vitest";
import { buildTree, type OrgTreeNodeInput } from "@/lib/orgchart/tree";

function row(
  id: string,
  firstName: string,
  lastName: string,
  managerId: string | null,
): OrgTreeNodeInput {
  return {
    id,
    firstName,
    lastName,
    position: null,
    department: null,
    image: null,
    managerId,
  };
}

describe("buildTree", () => {
  it("returns an empty array for empty input", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("renders a single root with no children", () => {
    const roots = buildTree([row("ceo", "Casey", "Vaudit", null)]);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.name).toBe("Casey Vaudit");
    expect(roots[0]?.children).toEqual([]);
  });

  it("renders multiple roots when several users have managerId = null", () => {
    const roots = buildTree([
      row("u1", "Alice", "Adams", null),
      row("u2", "Bob", "Brown", null),
    ]);
    expect(roots).toHaveLength(2);
    // Roots are sorted by name — Alice < Bob.
    expect(roots[0]?.name).toBe("Alice Adams");
    expect(roots[1]?.name).toBe("Bob Brown");
  });

  it("builds a CEO → managers → employees tree", () => {
    const roots = buildTree([
      row("ceo", "Casey", "V", null),
      row("m1", "Morgan", "Lee", "ceo"),
      row("m2", "Quinn", "Park", "ceo"),
      row("e1", "Riley", "Patel", "m1"),
      row("e2", "Sam", "Smith", "m1"),
      row("e3", "Taylor", "Tan", "m2"),
    ]);
    expect(roots).toHaveLength(1);
    const ceo = roots[0];
    expect(ceo?.name).toBe("Casey V");
    expect(ceo?.children).toHaveLength(2);
    // Children sorted: Morgan < Quinn
    const [morgan, quinn] = ceo?.children ?? [];
    expect(morgan?.name).toBe("Morgan Lee");
    expect(quinn?.name).toBe("Quinn Park");
    expect(morgan?.children).toHaveLength(2);
    expect(morgan?.children.map((c) => c.name)).toEqual([
      "Riley Patel",
      "Sam Smith",
    ]);
    expect(quinn?.children).toHaveLength(1);
    expect(quinn?.children[0]?.name).toBe("Taylor Tan");
  });

  it("surfaces orphans as roots rather than dropping them", () => {
    // "u2" lists "missing-manager" as managerId, but no row with that id
    // exists in the input — treat u2 as a root so it still appears in
    // the chart.
    const roots = buildTree([
      row("u1", "Alice", "A", null),
      row("u2", "Bob", "B", "missing-manager"),
    ]);
    expect(roots).toHaveLength(2);
    const names = roots.map((r) => r.name).sort();
    expect(names).toEqual(["Alice A", "Bob B"]);
  });

  it("attaches each node to its parent exactly once", () => {
    const roots = buildTree([
      row("root", "Root", "R", null),
      row("child", "Child", "C", "root"),
    ]);
    expect(roots).toHaveLength(1);
    const childRefs = roots[0]?.children ?? [];
    expect(childRefs).toHaveLength(1);
    expect(childRefs[0]?.name).toBe("Child C");
  });

  it("handles a flat list of siblings under one parent (alphabetical order)", () => {
    const roots = buildTree([
      row("p", "Pat", "Z", null),
      row("c", "Charlie", "C", "p"),
      row("a", "Alpha", "A", "p"),
      row("b", "Bravo", "B", "p"),
    ]);
    const parent = roots[0];
    expect(parent?.children.map((c) => c.name)).toEqual([
      "Alpha A",
      "Bravo B",
      "Charlie C",
    ]);
  });

  it("preserves position / department / image on nodes", () => {
    const roots = buildTree([
      {
        id: "u1",
        firstName: "Riley",
        lastName: "Patel",
        position: "Engineer",
        department: "R&D",
        image: "https://example.com/a.png",
        managerId: null,
      },
    ]);
    expect(roots[0]?.position).toBe("Engineer");
    expect(roots[0]?.department).toBe("R&D");
    expect(roots[0]?.image).toBe("https://example.com/a.png");
  });
});
