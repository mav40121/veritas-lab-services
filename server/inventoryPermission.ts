// server/inventoryPermission.ts
//
// BUG-078 (Michael Q46 = 1, 2026-10-27): the VeritaStaff "Can adjust inventory" switch
// (staff_employees.can_adjust_inventory) controlled the shared inventory kiosk, which was removed 2026-09-30; since
// then nothing read it, so every Staff Portal login could change amounts on hand. It now does what it says for Staff
// Portal (read-and-sign) logins: a staff_portal seat linked to a roster row whose switch is off may still view
// VeritaStock but may not change amounts on hand (adjust, receive, write-off, barcode scan other than lookup, lot use).
// Editors and admins (writer seats) and owners are not affected. A staff seat that is not linked to a roster row has no
// switch to read and is left as before.

export const INVENTORY_NOT_ALLOWED =
  'Your lab director has not turned on "Can adjust inventory" for you in VeritaStaff. Ask them to turn it on to count or change inventory.';

/** True when this user acts in this lab through a Staff Portal seat whose roster row has "Can adjust inventory" off. */
export function staffInventoryBlocked(sqlite: any, userId: unknown, labId: unknown): boolean {
  const uid = Number(userId), lid = Number(labId);
  if (!Number.isFinite(uid) || !Number.isFinite(lid) || uid <= 0 || lid <= 0) return false;
  const seat = sqlite.prepare(
    `SELECT se.can_adjust_inventory AS flag
       FROM user_seats us
       JOIN staff_employees se ON se.id = us.staff_employee_id
      WHERE us.seat_user_id = ? AND us.lab_id = ? AND us.seat_type = 'staff_portal' AND us.status = 'active'
      LIMIT 1`
  ).get(uid, lid) as { flag: number | null } | undefined;
  if (!seat) return false;
  return Number(seat.flag) !== 1;
}

/** The 403 body every refused inventory change returns. */
export const inventoryNotAllowedBody = () => ({ error: INVENTORY_NOT_ALLOWED, code: "INVENTORY_NOT_ALLOWED" });
