// server/labReset.ts
//
// Admin-only lab content reset + ownership reassignment. Pure functions over the
// better-sqlite3 handle so they are unit-testable (scripts/verify-lab-reset.mjs)
// and reusable by the admin endpoint in routes.ts.
//
// The content reset is a transitive-closure delete seeded from the target labs,
// NOT a naive "DELETE WHERE lab_id IN (...)". That distinction matters because
// some tables carry a lab_id column whose value is NOT labs.id (e.g.
// staff_employees.lab_id is staff_labs.id). Deleting those by lab_id would hit the
// wrong rows. The closure reaches such tables through their real declared FK
// parent (labs -> staff_labs via tier2_lab_id -> staff_employees via lab_id),
// while tables whose lab_id column has NO declared FK are treated as genuinely
// labs-scoped and seeded directly. Verified against a copy of production data:
// 881 rows across 38 tables for the four USON demo labs, zero collateral, zero
// new orphans, shells + memberships + seats preserved.

type Sqlite = any;

export interface FkEdge { child: string; from: string; parent: string; to: string; }
export interface Introspection { tables: string[]; edges: FkEdge[]; cols: Record<string, string[]>; pk: Record<string, string>; }

// Rows we never delete: the lab shell, user accounts, memberships, seats, billing,
// and the organization itself (ownership is adjusted, not deleted).
export const PRESERVE = new Set<string>([
  'labs', 'users', 'lab_members', 'user_seats', 'organization_billing_line_items',
  'organizations', 'organization_members',
]);
// Parents the closure must not traverse OUT of, or it escapes into unrelated data.
// (labs is a root and IS traversed; users is the dangerous hub to stop at.)
export const NO_TRAVERSE = new Set<string>([
  'users', 'lab_members', 'user_seats', 'organization_billing_line_items',
  'organizations', 'organization_members',
]);

const CHUNK = 800;

export function introspect(sqlite: Sqlite): Introspection {
  const q = (sql: string, ...a: any[]) => sqlite.prepare(sql).all(...a);
  const tables: string[] = q(`SELECT name FROM sqlite_master WHERE type='table'`).map((t: any) => t.name);
  const edges: FkEdge[] = [];
  const cols: Record<string, string[]> = {};
  const pk: Record<string, string> = {};
  for (const t of tables) {
    const info = q(`PRAGMA table_info('${t}')`);
    cols[t] = info.map((c: any) => c.name);
    pk[t] = cols[t].includes('id') ? 'id' : (info.find((c: any) => c.pk > 0)?.name || 'rowid');
    let fks: any[] = [];
    try { fks = q(`PRAGMA foreign_key_list('${t}')`); } catch { fks = []; }
    for (const fk of fks) edges.push({ child: t, from: fk.from, parent: fk.table, to: fk.to || 'id' });
  }
  return { tables, edges, cols, pk };
}

function selectPkIn(sqlite: Sqlite, table: string, pkCol: string, whereCol: string, vals: any[]): any[] {
  const out: any[] = [];
  for (let i = 0; i < vals.length; i += CHUNK) {
    const slice = vals.slice(i, i + CHUNK);
    const rows = sqlite.prepare(
      `SELECT "${pkCol}" AS pk FROM "${table}" WHERE "${whereCol}" IN (${slice.map(() => '?').join(',')})`
    ).all(...slice);
    for (const r of rows) out.push(r.pk);
  }
  return out;
}

export interface DeletionScope {
  scope: Record<string, Set<string>>;
  seededUndeclared: string[];
  warnings: string[];
  meta: Introspection;
}

export function computeDeletionScope(sqlite: Sqlite, labIds: number[]): DeletionScope {
  const meta = introspect(sqlite);
  const { tables, edges, cols, pk } = meta;
  const colFk: Record<string, string> = {};
  for (const e of edges) colFk[`${e.child}.${e.from}`] = e.parent;
  const scope: Record<string, Set<string>> = {};
  const warnings: string[] = [];
  const seededUndeclared: string[] = [];

  const add = (table: string, whereCol: string, vals: any[]): number => {
    if (PRESERVE.has(table)) return 0;
    const ids = selectPkIn(sqlite, table, pk[table], whereCol, vals);
    const set = (scope[table] ??= new Set<string>());
    let added = 0;
    for (const id of ids) { const k = String(id); if (!set.has(k)) { set.add(k); added++; } }
    return added;
  };

  // 1. Direct declared FK -> labs.
  for (const e of edges) if (e.parent === 'labs') add(e.child, e.from, labIds);

  // 2. Undeclared labs-scoped columns (lab_id/tier2_lab_id with no declared FK).
  for (const t of tables) {
    if (PRESERVE.has(t)) continue;
    for (const c of ['lab_id', 'tier2_lab_id']) {
      if (!cols[t].includes(c)) continue;
      const fk = colFk[`${t}.${c}`];
      if (fk === undefined) { const n = add(t, c, labIds); if (n) seededUndeclared.push(`${t}.${c} (+${n})`); }
      // fk !== 'labs' -> reached via closure from its real parent; skip direct seeding.
    }
  }

  // 3. Transitive closure parent(scope) -> children over declared FKs.
  let changed = true, guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    for (const e of edges) {
      if (PRESERVE.has(e.child) || NO_TRAVERSE.has(e.parent)) continue;
      const pvals = e.parent === 'labs' ? labIds.map(String) : scope[e.parent];
      if (!pvals) continue;
      const arr = (pvals instanceof Set ? [...pvals] : pvals).map(Number).filter((n) => Number.isFinite(n));
      if (!arr.length) continue;
      if (add(e.child, e.from, arr)) changed = true;
    }
  }
  if (guard >= 50) warnings.push('closure did not converge in 50 passes');

  // Safety: every scoped row of a declared lab_id->labs table must have lab_id in labIds.
  for (const e of edges) {
    if (e.parent === 'labs' && e.from === 'lab_id' && scope[e.child]) {
      const ids = [...scope[e.child]];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const bad = sqlite.prepare(
          `SELECT COUNT(*) AS n FROM "${e.child}" WHERE "${pk[e.child]}" IN (${slice.map(() => '?').join(',')}) AND lab_id NOT IN (${labIds.map(() => '?').join(',')})`
        ).get(...slice, ...labIds).n;
        if (bad) warnings.push(`${e.child}: ${bad} scoped rows have lab_id outside target`);
      }
    }
  }
  return { scope, seededUndeclared, warnings, meta };
}

export function manifest(scope: Record<string, Set<string>>): Array<{ table: string; rows: number }> {
  return Object.entries(scope)
    .map(([table, set]) => ({ table, rows: set.size }))
    .filter((r) => r.rows > 0)
    .sort((a, b) => b.rows - a.rows);
}

export function applyDeletion(sqlite: Sqlite, scope: Record<string, Set<string>>, pk: Record<string, string>): number {
  let total = 0;
  // Production runs with foreign_keys ON. `scope` is the COMPLETE transitive
  // closure of the target labs, so the FINAL state is FK-consistent, but the
  // per-table deletes below are not ordered child-before-parent. defer_foreign_keys
  // moves FK enforcement to COMMIT (valid only inside a transaction, which the
  // caller provides; it auto-resets at transaction end), so the unordered deletes
  // do not trip constraints while the end state still passes the FK check.
  sqlite.exec('PRAGMA defer_foreign_keys = ON');
  for (const [table, set] of Object.entries(scope)) {
    const ids = [...set];
    if (!ids.length) continue;
    const col = pk[table];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      total += sqlite.prepare(
        `DELETE FROM "${table}" WHERE "${col}" IN (${slice.map(() => '?').join(',')})`
      ).run(...slice).changes;
    }
  }
  return total;
}

export interface TransferOpts {
  labIds: number[];
  newOwnerId: number;
  oldOwnerId: number;
  orgId?: number | null;
  makeOrgOwner?: boolean;
}

export function transferOwnership(sqlite: Sqlite, opts: TransferOpts): Array<{ labId: number; seatsReparented: number }> {
  const { labIds, newOwnerId, oldOwnerId, orgId = null, makeOrgOwner = true } = opts;
  const now = new Date().toISOString();
  const log: Array<{ labId: number; seatsReparented: number }> = [];
  for (const labId of labIds) {
    sqlite.prepare('UPDATE labs SET owner_user_id = ?, updated_at = ? WHERE id = ?').run(newOwnerId, now, labId);
    sqlite.prepare("UPDATE lab_members SET role = 'admin', updated_at = ? WHERE lab_id = ? AND user_id = ? AND role = 'owner'").run(now, labId, oldOwnerId);
    sqlite.prepare("UPDATE lab_members SET role = 'owner', updated_at = ? WHERE lab_id = ? AND user_id = ? AND status = 'active'").run(now, labId, newOwnerId);
    const op = sqlite.prepare('SELECT is_primary_lab FROM lab_members WHERE lab_id = ? AND user_id = ?').get(labId, oldOwnerId);
    if (op && op.is_primary_lab === 1) {
      sqlite.prepare('UPDATE lab_members SET is_primary_lab = 0, updated_at = ? WHERE lab_id = ? AND user_id = ?').run(now, labId, oldOwnerId);
      sqlite.prepare('UPDATE lab_members SET is_primary_lab = 0, updated_at = ? WHERE user_id = ? AND is_primary_lab = 1').run(now, newOwnerId);
      sqlite.prepare('UPDATE lab_members SET is_primary_lab = 1, updated_at = ? WHERE lab_id = ? AND user_id = ?').run(now, labId, newOwnerId);
    }
    const seats = sqlite.prepare('UPDATE user_seats SET owner_user_id = ? WHERE lab_id = ? AND owner_user_id = ?').run(newOwnerId, labId, oldOwnerId).changes;
    log.push({ labId, seatsReparented: seats });
  }
  if (makeOrgOwner && orgId) {
    sqlite.prepare('UPDATE organizations SET billing_owner_user_id = ?, updated_at = ? WHERE id = ?').run(newOwnerId, now, orgId);
    sqlite.prepare("UPDATE organization_members SET org_role = 'org_admin', updated_at = ? WHERE organization_id = ? AND user_id = ? AND org_role = 'org_owner'").run(now, orgId, oldOwnerId);
    const existing = sqlite.prepare('SELECT id FROM organization_members WHERE organization_id = ? AND user_id = ?').get(orgId, newOwnerId);
    if (existing) {
      sqlite.prepare("UPDATE organization_members SET org_role = 'org_owner', status = 'active', updated_at = ? WHERE id = ?").run(now, existing.id);
    } else {
      sqlite.prepare('INSERT INTO organization_members (organization_id, user_id, org_role, status, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(orgId, newOwnerId, 'org_owner', 'active', now, now);
    }
  }
  return log;
}

// Declared-FK orphan scan (excludes FKs to the preserved users/labs parents).
export function orphanScan(sqlite: Sqlite, edges: FkEdge[]): Array<{ edge: string; orphans: number | string }> {
  const out: Array<{ edge: string; orphans: number | string }> = [];
  for (const e of edges) {
    if (e.parent === 'users' || e.parent === 'labs') continue;
    try {
      const n = sqlite.prepare(
        `SELECT COUNT(*) AS n FROM "${e.child}" c WHERE c."${e.from}" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "${e.parent}" p WHERE p."${e.to}" = c."${e.from}")`
      ).get().n;
      if (n > 0) out.push({ edge: `${e.child}.${e.from}->${e.parent}.${e.to}`, orphans: n });
    } catch (err: any) {
      out.push({ edge: `${e.child}.${e.from}->${e.parent}.${e.to}`, orphans: 'ERR ' + err.message });
    }
  }
  return out;
}
