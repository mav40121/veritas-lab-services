// server/staffSeatEditCounts.ts
//
// GET /api/admin/staff-seat-edit-counts (header x-admin-secret only; server/routes.ts). Michael 2026-11-11: a Staff seat
// (seat_type 'staff_portal', read and sign) never edits, whatever its stored permissions say (shared/seatEditRule.ts). This
// measures who loses edit when that ships: the active or pending Staff seats whose stored permissions give edit on any
// module, read the way resolveSeatPermission reads them (mode edit_all, or a module set to 'edit' in a custom or legacy
// shape), by lab id, and which modules. Counts and lab ids only: no names, emails or seat ids. It writes nothing.

import { SEAT_MODULE_KEYS } from "@shared/schema";
import { modulesWithStoredEdit } from "@shared/seatEditRule";

type Bucket = { staffSeats: number; withEdit: number; active: number; pending: number; editAll: number; modules: Record<string, number> };
const bucket = (): Bucket => ({ staffSeats: 0, withEdit: 0, active: 0, pending: 0, editAll: 0, modules: {} });

export function staffSeatEditCounts(sqlite: any) {
  const rows = sqlite.prepare(
    "SELECT lab_id, status, permissions FROM user_seats WHERE seat_type = 'staff_portal' AND status IN ('active', 'pending')"
  ).all() as Array<{ lab_id: number | null; status: string; permissions: string | null }>;
  const totals = bucket();
  const byLab = new Map<number | null, Bucket>();
  for (const r of rows) {
    const labId = r.lab_id == null ? null : Number(r.lab_id);
    const lab = byLab.get(labId) ?? bucket();
    byLab.set(labId, lab);
    for (const b of [totals, lab]) b.staffSeats++;
    const modules = modulesWithStoredEdit(r.permissions);
    if (!modules.length) continue;
    const editAll = SEAT_MODULE_KEYS.every((k) => modules.includes(k));
    for (const b of [totals, lab]) {
      b.withEdit++;
      if (r.status === "active") b.active++; else b.pending++;
      if (editAll) b.editAll++;
      for (const m of modules) b.modules[m] = (b.modules[m] ?? 0) + 1;
    }
  }
  const labs = [...byLab.entries()]
    .filter(([, b]) => b.withEdit > 0)
    .map(([labId, b]) => ({ labId, ...b }))
    .sort((a, b) => (a.labId ?? 0) - (b.labId ?? 0));
  return {
    rule: "A Staff seat (seat_type staff_portal) never passes a module edit check, whatever its stored permissions say.",
    totals: { ...totals, labsWithEdit: labs.length },
    labs,
  };
}
