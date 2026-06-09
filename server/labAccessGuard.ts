// server/labAccessGuard.ts
//
// Shape A mutation scope guard (2026-06-09).
//
// PROBLEM
// -------
// Multi-lab tables (inventory_items, veritatrack_tasks, veritatrack_signoffs,
// veritacheck_verifications, ...) carry both:
//   - An owner column (user_id or account_id) set at INSERT time to the
//     creator's user id, AND
//   - A lab_id column set by the multi-lab dual-write so rows live under a
//     specific lab.
//
// Many mutation endpoints (PUT / PATCH / DELETE) historically filter by
// `WHERE id = ? AND user_id = ?` for access control. Two things go wrong
// in multi-lab:
//   1. Seeded items have user_id != the current user; mutations 404 even
//      though list endpoints (lab-scoped) show the row.
//   2. A lab admin or co-owner who didn't create the row can't edit it
//      even though they have full lab access.
//
// FIX
// ---
// resolveRowForMutation() resolves a row by id alone, then verifies the
// requester has access via:
//   - Legacy direct ownership: row[ownerColumn] === req's owner id (fast path)
//   - Multi-lab membership: active lab_members.user_id row matching row.lab_id
//
// Returns:
//   { row, status: 200 } when access is granted
//   { row: null, status: 403 } for foreign labs (don't leak existence)
//   { row: null, status: 404 } when the row truly does not exist
//
// USAGE
// -----
//   const { row, status } = resolveRowForMutation(sqlite, "inventory_items", id, req);
//   if (!row) {
//     if (status === 403) return res.status(403).json({ error: "..." });
//     return res.status(404).json({ error: "Not found" });
//   }
//   sqlite.prepare("UPDATE ... WHERE id = ?").run(..., id);
//
// HISTORY
// -------
// 2026-06-09: extracted from server/veritabench.ts after PR #675 fixed the
// inventory mutation endpoints. Same shape sweep landed on veritatrack and
// veritacheck_verifications in the same PR.

// Loose any to avoid coupling to better-sqlite3's exported type shape; the
// caller passes the live `$client` instance which has `.prepare(...).get/run/all`.
type SqliteLike = any;

export type ResolveStatus = 200 | 403 | 404;
export type ResolveResult<T = any> = { row: T | null; status: ResolveStatus };

export interface RequestLike {
  userId?: number;
  ownerUserId?: number;
  user?: { userId?: number };
}

export interface ResolveOptions {
  // Which column on the row holds the legacy direct-ownership user id.
  // Most tables use 'user_id'; inventory_items / veritabench tables use 'account_id'.
  ownerColumn?: "user_id" | "account_id";
  // Additional SQL appended to the SELECT WHERE for soft-delete / status
  // filtering. Example: "active = 1" for veritatrack_tasks soft-delete.
  extraWhere?: string;
  // Bind params for placeholders in extraWhere.
  extraParams?: any[];
}

export function resolveRowForMutation<T = any>(
  sqlite: SqliteLike,
  table: string,
  id: number | string,
  req: RequestLike,
  options: ResolveOptions = {}
): ResolveResult<T> {
  const ownerCol = options.ownerColumn ?? "user_id";
  const extra = options.extraWhere ? ` AND ${options.extraWhere}` : "";
  const extraParams = options.extraParams ?? [];

  const row = sqlite.prepare(`SELECT * FROM ${table} WHERE id = ?${extra}`).get(id, ...extraParams) as any;
  if (!row) return { row: null, status: 404 };

  const userId = req.user?.userId ?? req.userId;
  const ownerId = req.ownerUserId ?? userId;
  if (userId == null) return { row: null, status: 403 };

  // Legacy direct ownership: row[ownerColumn] matches the requester
  if (row[ownerCol] != null && row[ownerCol] === ownerId) {
    return { row: row as T, status: 200 };
  }

  // Multi-lab: any active member of the row's lab can mutate
  if (row.lab_id != null) {
    const membership = sqlite.prepare(
      "SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active' LIMIT 1"
    ).get(row.lab_id, userId);
    if (membership) return { row: row as T, status: 200 };
  }

  return { row: null, status: 403 };
}

/**
 * resolveLegacyLabId — for legacy unscoped GET endpoints that need to filter
 * by the user's active lab. Returns the user's default_lab_id (set by the
 * LabSwitcher on every NavBar switch), falling back to the oldest active
 * lab_members row. Returns null only when the user has no membership at all.
 *
 * Use case: a list endpoint like `GET /api/veritascan/scans` historically
 * filtered by user_id and bled cross-lab rows for multi-lab users. Threading
 * through resolveLegacyLabId + scoping by lab_id matches what the user sees
 * in the NavBar without requiring the client to migrate to `/api/labs/:labId/...`.
 *
 * Documented in detail in routes.ts comment block (added 2026-06-05). This
 * exported copy lives in labAccessGuard so non-routes modules can share it.
 */
export function resolveLegacyLabId(
  sqlite: SqliteLike,
  req: RequestLike
): number | null {
  const userId = req.user?.userId ?? req.userId;
  if (userId == null) return null;
  const u = sqlite.prepare("SELECT default_lab_id FROM users WHERE id = ?").get(userId) as any;
  if (u?.default_lab_id) return Number(u.default_lab_id);
  const m = sqlite.prepare(
    "SELECT lab_id FROM lab_members WHERE user_id = ? AND status = 'active' ORDER BY id ASC LIMIT 1"
  ).get(userId) as any;
  return m?.lab_id ? Number(m.lab_id) : null;
}
