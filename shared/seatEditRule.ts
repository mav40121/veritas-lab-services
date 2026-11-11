// shared/seatEditRule.ts
//
// Staff seats are read and sign only (Michael Veri, 2026-11-11: "That should require an admin seat ... If she is in a staff
// seat, she should not be able to do that."). A Heywood user on a Staff seat was refused a new VeritaMap map, rightly, but
// the account owner could flip that seat to Edit and the seat would then write. A Staff seat never passes a module edit
// check, whatever its stored permissions say, and no route stores edit on one. Writer seats (seat_type 'active', or a
// missing type, which reads as active), admins and owners are unchanged.
//
// One rule for both sides: server/routes.ts requireModuleEdit and hasModuleEditAccess, and the client's useIsReadOnly
// (client/src/components/SubscriptionBanner.tsx), read a seat through effectiveSeatPermission, so the screen and the API
// can't disagree. Every route that writes user_seats.permissions refuses edit on a Staff seat through staffSeatEditRefusal.

import { resolveSeatPermission, SEAT_MODULE_KEYS, type SeatPermissions, type SeatPermLevel } from "./schema";

/** A Staff seat (seat_type 'staff_portal') never edits a module. */
export const STAFF_SEAT_CAN_EDIT = false as const;

/**
 * Seat types that never pass a module edit check. 'staff_portal' is the Staff login (read and sign). 'view_only' is the
 * reviewer seat: authMiddleware already refuses it every write (its view_only gate), so listing it here only keeps the edit
 * check and the screens saying the same thing as that gate. 'active' is a writer seat and reads its permissions as before.
 */
export const READ_ONLY_SEAT_TYPES: readonly string[] = ["staff_portal", "view_only"];

export function isReadOnlySeatType(seatType: string | null | undefined): boolean {
  return seatType != null && READ_ONLY_SEAT_TYPES.includes(seatType);
}

/** A seat's view or edit for one module: 'view' for a read-only seat type, otherwise its stored permissions as resolveSeatPermission reads them. */
export function effectiveSeatPermission(seatType: string | null | undefined, perms: SeatPermissions, moduleKey: string): SeatPermLevel {
  if (isReadOnlySeatType(seatType)) return "view";
  return resolveSeatPermission(perms, moduleKey);
}

/**
 * The modules stored permissions give edit on, read the way resolveSeatPermission reads them: the mode shape (edit_all,
 * view_all or custom, with overrides) and the legacy flat map (including its every-key-edit upgrade). A JSON string is
 * parsed; anything malformed gives none. Every module key is checked, plus any other key the stored value names.
 */
export function modulesWithStoredEdit(perms: unknown): string[] {
  let p: any = perms;
  if (typeof p === "string") {
    try { p = JSON.parse(p || "{}"); } catch { return []; }
  }
  if (!p || typeof p !== "object" || Array.isArray(p)) return [];
  const keys = new Set<string>(SEAT_MODULE_KEYS);
  const named = typeof p.mode === "string" ? p.overrides : p;
  if (named && typeof named === "object" && !Array.isArray(named)) for (const k of Object.keys(named)) keys.add(k);
  return [...keys].filter((k) => resolveSeatPermission(p as SeatPermissions, k) === "edit");
}

export const STAFF_SEAT_READ_ONLY = "STAFF_SEAT_READ_ONLY";
export const STAFF_SEAT_READ_ONLY_MESSAGE = "A staff login is for reading and signing. To let this person edit, give them an admin seat.";
export const STAFF_SEAT_TYPE_LABEL = "Staff login, read and sign";

/** The 400 body when a write would store edit on a Staff seat; null when the write may go ahead (view-only changes still save). */
export function staffSeatEditRefusal(seatType: string | null | undefined, perms: unknown): { error: string; code: string; modules: string[] } | null {
  if (seatType !== "staff_portal") return null;
  const modules = modulesWithStoredEdit(perms);
  return modules.length ? { error: STAFF_SEAT_READ_ONLY_MESSAGE, code: STAFF_SEAT_READ_ONLY, modules } : null;
}
