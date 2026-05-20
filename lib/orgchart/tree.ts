/**
 * Build a tree view of the org from a flat list of users.
 *
 * Used by /api/org-chart. Returns roots[] (users with managerId == null among
 * the input set). Designed to be O(N) — single pass to bucket children per
 * parent, then attach.
 */

export interface OrgTreeNodeInput {
  id: string;
  firstName: string;
  lastName: string;
  position: string | null;
  department: string | null;
  image: string | null;
  managerId: string | null;
}

export interface OrgTreeNode {
  id: string;
  name: string;
  position: string | null;
  department: string | null;
  image: string | null;
  children: OrgTreeNode[];
}

export function buildTree(rows: ReadonlyArray<OrgTreeNodeInput>): OrgTreeNode[] {
  const byId = new Map<string, OrgTreeNode>();
  const childrenByParent = new Map<string, OrgTreeNode[]>();
  const presentIds = new Set(rows.map((r) => r.id));

  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      position: r.position,
      department: r.department,
      image: r.image,
      children: [],
    });
  }

  for (const r of rows) {
    const node = byId.get(r.id);
    if (!node) continue;
    // Treat managers outside the active set (e.g. deactivated) as null parents
    // so we still surface the team rather than dropping the subtree.
    const parentId =
      r.managerId && presentIds.has(r.managerId) ? r.managerId : null;
    if (!parentId) continue;
    const list = childrenByParent.get(parentId) ?? [];
    list.push(node);
    childrenByParent.set(parentId, list);
  }

  for (const [parentId, kids] of childrenByParent) {
    const parent = byId.get(parentId);
    if (!parent) continue;
    parent.children = kids.sort((a, b) => a.name.localeCompare(b.name));
  }

  const roots: OrgTreeNode[] = [];
  for (const r of rows) {
    const isRoot = !r.managerId || !presentIds.has(r.managerId);
    if (isRoot) {
      const node = byId.get(r.id);
      if (node) roots.push(node);
    }
  }
  return roots.sort((a, b) => a.name.localeCompare(b.name));
}
