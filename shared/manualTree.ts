// shared/manualTree.ts
//
// VeritaDC sub-manuals (Michael 2026-11-03, Q151 = 1; parity plan Phase 1 item 1). A manual may sit inside another
// manual (policy_manuals.parent_id) to any depth; Heywood's MediaLab library has 5 manuals and about 95 sub-manuals,
// nested up to 6 levels. These pure helpers are the single place that orders the tree, names each manual by its full
// path, and refuses a move that would make a manual its own ancestor. The server (routes.ts) and the documents page
// both use them, so the list, the pickers and the grouping always agree.

export type ManualNode = {
  id: number;
  parent_id: number | null;
  name: string;
  display_order: number;
};

export type ManualInTree<T extends ManualNode = ManualNode> = T & {
  depth: number; // 0 = top level
  path: string; // "Heywood Hospital › Heywood Microbiology › HH Abbott ID NOW"
  ancestor_ids: number[]; // outermost first
};

export const MANUAL_PATH_SEPARATOR = " › ";
// Deeper than anything a lab has asked for (MediaLab libraries go to 6); stops a runaway chain.
export const MAX_MANUAL_DEPTH = 10;

const bySiblingOrder = (a: ManualNode, b: ManualNode) =>
  (a.display_order ?? 0) - (b.display_order ?? 0) || a.name.localeCompare(b.name) || a.id - b.id;

/**
 * Depth-first order (siblings by display_order, then name), with each manual's depth and full path. A manual whose
 * parent is missing from `rows` (archived, deleted or in another lab) is shown at the top level, so a document is
 * never hidden by its manual's parent going away. A stored loop (which the routes refuse to create) is broken the
 * same way instead of recursing forever.
 */
export function orderManualTree<T extends ManualNode>(rows: T[]): ManualInTree<T>[] {
  const ids = new Set(rows.map((r) => r.id));
  const children = new Map<number | null, T[]>();
  for (const r of rows) {
    const parent = r.parent_id != null && ids.has(r.parent_id) && r.parent_id !== r.id ? r.parent_id : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(r);
  }
  for (const list of children.values()) list.sort(bySiblingOrder);
  const out: ManualInTree<T>[] = [];
  const placed = new Set<number>();
  const walk = (parent: number | null, depth: number, names: string[], ancestors: number[]) => {
    for (const r of children.get(parent) || []) {
      if (placed.has(r.id)) continue;
      placed.add(r.id);
      const path = [...names, r.name];
      out.push({ ...r, depth, path: path.join(MANUAL_PATH_SEPARATOR), ancestor_ids: ancestors });
      walk(r.id, depth + 1, path, [...ancestors, r.id]);
    }
  };
  walk(null, 0, [], []);
  // Rows caught in a stored loop never hang off the top level: show them at the top instead of dropping them.
  for (const r of [...rows].sort(bySiblingOrder)) {
    if (placed.has(r.id)) continue;
    placed.add(r.id);
    out.push({ ...r, depth: 0, path: r.name, ancestor_ids: [] });
    walk(r.id, 1, [r.name], [r.id]);
  }
  return out;
}

/** Every manual inside `manualId`, at any depth (not including itself). */
export function descendantIds(rows: ManualNode[], manualId: number): Set<number> {
  const kids = new Map<number, number[]>();
  for (const r of rows) if (r.parent_id != null) (kids.get(r.parent_id) ?? kids.set(r.parent_id, []).get(r.parent_id)!).push(r.id);
  const out = new Set<number>();
  const stack = [...(kids.get(manualId) || [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || id === manualId) continue;
    out.add(id);
    stack.push(...(kids.get(id) || []));
  }
  return out;
}

/**
 * Why `manualId` cannot move under `newParentId`, or null when it can. null for newParentId means "top level".
 * `rows` are the lab's active manuals.
 */
export function manualMoveProblem(rows: ManualNode[], manualId: number, newParentId: number | null): string | null {
  if (newParentId == null) return null;
  if (newParentId === manualId) return "A manual can't be placed inside itself.";
  const parent = rows.find((r) => r.id === newParentId);
  if (!parent) return "That manual isn't available in this lab.";
  if (descendantIds(rows, manualId).has(newParentId)) return "A manual can't be placed inside one of its own sub-manuals.";
  const tree = orderManualTree(rows);
  const parentDepth = tree.find((r) => r.id === newParentId)?.depth ?? 0;
  const ownHeight = (() => {
    const moving = tree.find((r) => r.id === manualId);
    if (!moving) return 0;
    const below = tree.filter((r) => r.ancestor_ids.includes(manualId)).map((r) => r.depth - moving.depth);
    return below.length ? Math.max(...below) : 0;
  })();
  if (parentDepth + 1 + ownHeight >= MAX_MANUAL_DEPTH) return `Manuals can nest up to ${MAX_MANUAL_DEPTH} levels.`;
  return null;
}
