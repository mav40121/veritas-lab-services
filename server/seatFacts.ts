// server/seatFacts.ts
//
// GET /api/admin/users/:userId/seat-facts (header x-admin-secret only; server/routes.ts). Support read, 2026-11-11: a
// Heywood user was refused "view-only access to veritamap" while the owner's Team Members showed her seat as "Edit access
// to all modules". This shows, for one user and without opening any lab-scoped route (those write record_views), every
// seat row tied to them, their lab memberships, which seat row requireModuleEdit's lab-scoped lookup picks in each lab
// (the same SQL it runs), and the seat-permission changes audit_log holds for those seats. Ids, types, statuses, dates and
// permission modes only: no email, name or invite token. It writes nothing.

import { modulesWithStoredEdit } from "@shared/seatEditRule";
import { editSeatInLab, seatInLabOrderSql, seatInLabSql } from "./seatContext";

const permSummary = (raw: unknown) => {
  let p: any = raw;
  if (typeof p === "string") { try { p = JSON.parse(p || "{}"); } catch { return { mode: "unreadable", modulesWithEdit: [] as string[] }; } }
  const mode = p && typeof p === "object" && typeof p.mode === "string" ? p.mode : "legacy";
  return { mode, modulesWithEdit: modulesWithStoredEdit(raw) };
};

export function seatFactsForUser(sqlite: any, userId: number) {
  const user = sqlite.prepare("SELECT id, lower(email) AS e FROM users WHERE id = ?").get(userId) as any;
  if (!user) return null;
  const seats = (sqlite.prepare(
    `SELECT id, owner_user_id, lab_id, seat_type, status, seat_user_id, invited_at, accepted_at, permissions,
            CASE WHEN seat_user_id = ? THEN 'linked' ELSE 'email-only' END AS linkedBy
       FROM user_seats WHERE seat_user_id = ? OR lower(seat_email) = ? ORDER BY id`
  ).all(userId, userId, user.e) as any[]).map((s) => ({
    seatId: s.id, ownerUserId: s.owner_user_id, labId: s.lab_id, seatType: s.seat_type ?? null, status: s.status,
    linkedBy: s.linkedBy, invitedAt: s.invited_at, acceptedAt: s.accepted_at, ...permSummary(s.permissions),
  }));
  const memberships = sqlite.prepare(
    "SELECT lab_id AS labId, role, status, is_primary_lab AS isPrimaryLab FROM lab_members WHERE user_id = ? ORDER BY lab_id"
  ).all(userId) as any[];
  // The lookup requireModuleEdit runs for a non-owner, non-admin caller in a lab (server/seatContext.ts editSeatInLab, the
  // same function), so the answer shows which row it lands on. Since Q287 = 1 that includes a seat with no lab whose owner owns
  // the lab, while the person is an active member there; activeSeatsInLab lists every row that rule counts in the lab, in order.
  const editCheck = memberships.map((m) => {
    const row = editSeatInLab(sqlite, userId, m.labId, "id, permissions") as any;
    const candidates = (sqlite.prepare(
      `SELECT us.id FROM user_seats us WHERE us.seat_user_id = @user AND us.status = 'active' AND ${seatInLabSql("us", "@lab")} ORDER BY ${seatInLabOrderSql("us")}`
    ).all({ user: userId, lab: m.labId }) as any[]).map((r) => r.id);
    return { labId: m.labId, role: m.role, pickedSeatId: row?.id ?? null, pickedPermissions: row ? permSummary(row.permissions) : null, activeSeatsInLab: candidates };
  });
  const seatIds = seats.map((s) => String(s.seatId));
  const permissionChanges = seatIds.length ? (sqlite.prepare(
    `SELECT entity_id AS seatId, user_id AS byUserId, created_at AS at, before_json AS b, after_json AS a
       FROM audit_log WHERE entity_type = 'seat.permissions' AND entity_id IN (${seatIds.map(() => "?").join(",")}) ORDER BY id`
  ).all(...seatIds) as any[]).map((r) => ({ seatId: Number(r.seatId), byUserId: r.byUserId, at: r.at, before: permSummary(r.b), after: permSummary(r.a) })) : [];
  return { userId, seats, memberships, editCheck, permissionChanges };
}
