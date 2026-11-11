// Per-lab seat summary for the Members page and the invite seat gate (bug 4,
// 2026-10-09: "Every lab is showing that they have 25 admin seats and no staff
// seats").
//
// What was wrong: the cap came from the lab OWNER's account plan, not the lab's
// plan. Michael's own account is forced to "enterprise" (25) on every boot, so
// every lab he created showed 25; an invitee's account copies the inviting
// owner's plan on accept, so Redington (Community, 5) still showed 25 after its
// ownership moved to Lindsay Webber. The used count ran across ALL of the owner's
// labs and added the owner on top of their own seat row. Staff had no stored
// band to show against.
//
// Rule now:
//   included = PLAN_SEATS[lab's own plan]; when the owner owns exactly one lab,
//              their purchased account seats are that lab's (Stripe writes
//              users.seat_count), so included = max(plan seats, seat_count).
//              Org-linked labs keep the organization's pooled cap and count.
//   used     = this lab's active seats, the owner counted once, the designated
//              medical director's seat free.
//   staff    = this lab's Staff Portal seats against labs.staff_portal_band.

import { PLAN_SEATS } from "./db";
import { PLAN_LIMITS, STAFF_PORTAL_BANDS } from "./stripe";
import { orgSeatCapForOwner } from "./organizationSeats";
import { OWNER_EMAIL } from "./constants";

export type LabSeatSummary = {
  activeIncluded: number;
  activeUsed: number;            // includes the owner, and (Q282 = 1) admins writing without a seat row
  adminsWithoutSeatCounted: number; // how many of activeUsed are admins with no seat row (never a Veritas login)
  medicalDirectorUsed: number;
  pooled: boolean;               // org-linked: cap and count are the organization's
  staffPortalBand: "small" | "medium" | "large" | null;
  staffPortalMax: number | null;
  staffPortalUsed: number;
};

const planSeatsFor = (plan: string | null | undefined): number =>
  PLAN_SEATS[String(plan || "free")] ?? (PLAN_LIMITS as any)[String(plan || "free")]?.maxAnalysts ?? 1;

export function labSeatSummary(sqlite: any, labId: number): LabSeatSummary | null {
  const lab = sqlite.prepare(
    "SELECT id, owner_user_id, plan, organization_id, medical_director_email, staff_portal_band FROM labs WHERE id = ?"
  ).get(labId) as any;
  if (!lab) return null;
  const owner = sqlite.prepare("SELECT id, email, plan, seat_count FROM users WHERE id = ?").get(lab.owner_user_id) as any;
  const ownerEmail = String(owner?.email || "").toLowerCase();
  const band = ["small", "medium", "large"].includes(String(lab.staff_portal_band)) ? lab.staff_portal_band : null;
  const staffPortalUsed = (sqlite.prepare(
    "SELECT COUNT(*) AS n FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal' AND status != 'deactivated'"
  ).get(labId) as any).n as number;
  const staff = {
    staffPortalBand: band as LabSeatSummary["staffPortalBand"],
    staffPortalMax: band ? (STAFF_PORTAL_BANDS as any)[band].maxStaff as number : null,
    staffPortalUsed,
  };

  if (lab.organization_id != null) {
    // Org-linked: unchanged pooled behavior (cap = organization pool; count across
    // the owner's labs).
    const ownerPlanSeats = planSeatsFor(owner?.plan);
    const activeIncluded = orgSeatCapForOwner(sqlite, lab.owner_user_id, owner?.seat_count || 0, ownerPlanSeats);
    const mdEmails = new Set(
      (sqlite.prepare("SELECT lower(medical_director_email) AS e FROM labs WHERE owner_user_id = ? AND medical_director_email IS NOT NULL AND TRIM(medical_director_email) != ''").all(lab.owner_user_id) as { e: string }[]).map(r => r.e)
    );
    const rows = sqlite.prepare(
      "SELECT lower(seat_email) AS e, COALESCE(seat_type,'active') AS t FROM user_seats WHERE owner_user_id = ? AND status != 'deactivated'"
    ).all(lab.owner_user_id) as { e: string; t: string }[];
    // BUG-093 (2026-10-25): the medical director seat is one free seat per lab (the members route's
    // medicalDirectorIncluded is 1 when this lab names one). This counted every seat row of every lab's director
    // across the owner's labs, so a director invited to both of a system's labs read "2 of 1" in each. It now counts
    // this lab's director once. Any lab's director still sits outside the active count, as before.
    const thisLabMd = String(lab.medical_director_email || "").trim().toLowerCase();
    let active = 0, mdSeen = false;
    for (const r of rows) {
      if (r.e && mdEmails.has(r.e)) { if (r.e === thisLabMd) mdSeen = true; continue; }
      if (r.t === "active") active++;
    }
    // BUG-096, Q282 = 1: admins writing in any of the system's labs without a seat row take a pooled seat, one person
    // once; a Veritas login never does.
    const extra = Array.from(pooledAdminsWithoutSeat(sqlite, lab.owner_user_id).values()).filter((veritas) => !veritas).length;
    return { activeIncluded, activeUsed: active + 1 + extra, adminsWithoutSeatCounted: extra, medicalDirectorUsed: mdSeen ? 1 : 0, pooled: true, ...staff };
  }

  // Standalone lab.
  const ownedLabs = (sqlite.prepare("SELECT COUNT(*) AS n FROM labs WHERE owner_user_id = ?").get(lab.owner_user_id) as any).n as number;
  const planSeats = planSeatsFor(lab.plan || owner?.plan);
  const activeIncluded = ownedLabs === 1 ? Math.max(planSeats, Number(owner?.seat_count) || 0) : planSeats;
  const mdEmail = String(lab.medical_director_email || "").trim().toLowerCase();
  const rows = sqlite.prepare(
    `SELECT lower(seat_email) AS e, seat_user_id AS u, COALESCE(seat_type,'active') AS t
       FROM user_seats WHERE lab_id = ? AND status != 'deactivated'`
  ).all(labId) as { e: string; u: number | null; t: string }[];
  let active = 0, md = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.t !== "active") continue;
    const key = r.u != null ? `u${r.u}` : `e${r.e}`;
    if (seen.has(key)) continue; // one person, one seat, even with a stale duplicate row
    seen.add(key);
    if (r.u === lab.owner_user_id || (r.e && r.e === ownerEmail)) continue; // the owner is counted once, below
    if (mdEmail && r.e === mdEmail) { md++; continue; }                     // the medical director's seat is free
    active++;
  }
  // BUG-096, Q282 = 1: an admin writing in this lab without a seat row takes a seat; a Veritas login never does.
  const extra = adminsWithoutSeatIn(sqlite, lab).filter((p) => !p.veritas).length;
  return { activeIncluded, activeUsed: active + 1 + extra, adminsWithoutSeatCounted: extra, medicalDirectorUsed: md, pooled: false, ...staff };
}

// BUG-096 (Michael 2026-11-11, Q282 = 1): seats were counted from user_seats rows only, so an active owner or admin
// member writing with no seat row took no seat (Heywood's original owner, made an admin by the 10/23 ownership
// transfer). They now count, in labSeatSummary, so the Members page and the invite gate read the same number. Left
// out, as before: the lab's owner (counted once already), a Veritas support account (vls_support), a medical director
// (the free seat), and now a Veritas login (isVeritasLogin), so our own access never takes a client's seat.
export type AdminWithoutSeat = { u: number; veritas: boolean };

/** The admins writing in one lab without a seat row. An org-linked lab is checked against the owner's pooled seats. */
export function adminsWithoutSeatIn(
  sqlite: any,
  lab: { id: number; owner_user_id: number; organization_id: number | null; medical_director_email?: string | null },
): AdminWithoutSeat[] {
  const pooled = lab.organization_id != null;
  const seats = (pooled
    ? sqlite.prepare("SELECT seat_user_id AS u, lower(seat_email) AS e FROM user_seats WHERE owner_user_id = ? AND status != 'deactivated' AND COALESCE(seat_type, 'active') = 'active'").all(lab.owner_user_id)
    : sqlite.prepare("SELECT seat_user_id AS u, lower(seat_email) AS e FROM user_seats WHERE lab_id = ? AND status != 'deactivated' AND COALESCE(seat_type, 'active') = 'active'").all(lab.id)
  ) as { u: number | null; e: string | null }[];
  const seatUsers = new Set(seats.map((s) => s.u).filter((u) => u != null));
  const seatEmails = new Set(seats.map((s) => s.e).filter(Boolean));
  const mdEmails = pooled
    ? new Set((sqlite.prepare("SELECT lower(medical_director_email) AS e FROM labs WHERE owner_user_id = ? AND medical_director_email IS NOT NULL AND TRIM(medical_director_email) != ''").all(lab.owner_user_id) as { e: string }[]).map((r) => r.e))
    : new Set([String(lab.medical_director_email || "").trim().toLowerCase()].filter(Boolean));
  const members = sqlite.prepare(
    `SELECT m.user_id AS u, lower(u.email) AS e FROM lab_members m JOIN users u ON u.id = m.user_id
      WHERE m.lab_id = ? AND m.status = 'active' AND m.role IN ('owner', 'admin') AND COALESCE(u.vls_support, 0) = 0`
  ).all(lab.id) as { u: number; e: string }[];
  return members
    .filter((m) => m.u !== lab.owner_user_id && !seatUsers.has(m.u) && !(m.e && seatEmails.has(m.e)) && !(m.e && mdEmails.has(m.e)))
    .map((m) => ({ u: m.u, veritas: isVeritasLogin(m.e) }));
}

/** Across an owner's org-linked labs: each admin without a seat row once (user id -> is a Veritas login). */
export function pooledAdminsWithoutSeat(sqlite: any, ownerUserId: number): Map<number, boolean> {
  const labs = sqlite.prepare("SELECT id, owner_user_id, organization_id, medical_director_email FROM labs WHERE owner_user_id = ? AND organization_id IS NOT NULL").all(ownerUserId) as any[];
  const out = new Map<number, boolean>();
  for (const l of labs) for (const p of adminsWithoutSeatIn(sqlite, l)) out.set(p.u, p.veritas);
  return out;
}

// BUG-096 (found 2026-10-25): measuring before deciding. Seats are counted from user_seats rows, so a lab admin who
// holds no seat row is never counted: Heywood's original owner became an admin when ownership moved to its medical
// director and was never given one, so the Members page read 1 of 10 with two people writing. Counting such people
// would also change the invite gate (it refuses a writer invite once activeUsed + 1 > activeIncluded), so this
// counts, per lab, the active owner or admin members who are writing without a seat row (not the lab's owner, not a
// Veritas support account, not a medical director, who sits on the free seat) and what the count and the gate would
// read with them. It changes nothing. GET /api/admin/seat-count-gaps sends it; lab ids and counts only, no names.
//
// Michael 2026-11-11 (Q279 = 1): before deciding, count how many of the uncounted admins are Veritas logins (our own
// accounts holding an admin role on a lab: the operator's address, OWNER_EMAIL, or any @veritaslabservices.com
// address), since counting them would charge a client a seat for our access. A Veritas support account (vls_support)
// was already left out above and still is. Counts only: veritasLogins per lab, usedIfCountedExceptVeritas (the count
// with only the other uncounted admins), and in totals the distinct people and distinct Veritas logins.
//
// Michael 2026-11-11 (Q282 = 1): admins who aren't Veritas logins now count (labSeatSummary), so `activeUsed` here is
// the count the Members page and the gate read, `activeUsedFromSeatRows` the count before, and `usedIfCounted` the
// count with Veritas logins too. `uncountedAdmins` keeps its name: admins with no seat row, counted or not.
export type SeatCountGapRow = {
  labId: number; isDemo: boolean; pooled: boolean; activeUsedFromSeatRows: number;
  activeIncluded: number; activeUsed: number; uncountedAdmins: number; usedIfCounted: number;
  overNow: boolean; overIfCounted: boolean;
  nextInviteRefusedNow: boolean; nextInviteRefusedIfCounted: boolean;
  veritasLogins: number; usedIfCountedExceptVeritas: number; overIfCountedExceptVeritas: boolean;
};

const VERITAS_DOMAIN = "@veritaslabservices.com";
export function isVeritasLogin(email: string | null | undefined): boolean {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return e === String(OWNER_EMAIL || "").trim().toLowerCase() || e.endsWith(VERITAS_DOMAIN);
}

export function seatCountGaps(sqlite: any): { totals: Record<string, number>; labs: SeatCountGapRow[] } {
  const labs = sqlite.prepare("SELECT id, owner_user_id, organization_id, medical_director_email, COALESCE(is_demo, 0) AS is_demo FROM labs ORDER BY id").all() as any[];
  // Q282 = 1: the same rule labSeatSummary counts with (adminsWithoutSeatIn), so the report and the gate can't drift.
  const uncountedIn = (l: any): AdminWithoutSeat[] => adminsWithoutSeatIn(sqlite, l);

  // An org-linked lab's count is pooled across the owner's labs, so its admins are pooled the same way:
  // one person admin in two labs of a system is one seat, not two.
  const pooledUncounted = new Map<number, Map<number, boolean>>();
  for (const l of labs) {
    if (l.organization_id == null || pooledUncounted.has(l.owner_user_id)) continue;
    pooledUncounted.set(l.owner_user_id, pooledAdminsWithoutSeat(sqlite, l.owner_user_id));
  }

  const rows: SeatCountGapRow[] = [];
  const people = new Set<string>();
  const distinctPeople = new Set<number>();
  const distinctVeritas = new Set<number>();
  for (const l of labs) {
    const summary = labSeatSummary(sqlite, l.id);
    if (!summary) continue;
    const pooled = l.organization_id != null;
    const own = uncountedIn(l);
    const pool = pooled ? pooledUncounted.get(l.owner_user_id) : undefined;
    const add = pooled ? (pool?.size ?? 0) : own.length;
    const addExceptVeritas = pooled ? [...(pool?.values() ?? [])].filter((v) => !v).length : own.filter((p) => !p.veritas).length;
    for (const p of own) {
      people.add(pooled ? `o${l.owner_user_id}:${p.u}` : `l${l.id}:${p.u}`);
      distinctPeople.add(p.u);
      if (p.veritas) distinctVeritas.add(p.u);
    }
    if (own.length === 0) continue;
    // Since Q282 = 1, summary.activeUsed already counts the admins who aren't Veritas logins; the seat-row count is
    // what it read before.
    const fromSeatRows = summary.activeUsed - summary.adminsWithoutSeatCounted;
    const usedIfCounted = fromSeatRows + add;
    const usedIfCountedExceptVeritas = fromSeatRows + addExceptVeritas;
    rows.push({
      labId: l.id, isDemo: Number(l.is_demo) === 1, pooled, activeUsedFromSeatRows: fromSeatRows,
      activeIncluded: summary.activeIncluded, activeUsed: summary.activeUsed, uncountedAdmins: own.length, usedIfCounted,
      overNow: summary.activeUsed > summary.activeIncluded, overIfCounted: usedIfCounted > summary.activeIncluded,
      nextInviteRefusedNow: summary.activeUsed + 1 > summary.activeIncluded, nextInviteRefusedIfCounted: usedIfCounted + 1 > summary.activeIncluded,
      veritasLogins: own.filter((p) => p.veritas).length, usedIfCountedExceptVeritas,
      overIfCountedExceptVeritas: usedIfCountedExceptVeritas > summary.activeIncluded,
    });
  }
  const totals = {
    labs: labs.length,
    labsWithUncountedAdmins: rows.length,
    uncountedAdmins: people.size,
    labsOverIfCounted: rows.filter((r) => r.overIfCounted).length,
    labsNewlyOverIfCounted: rows.filter((r) => r.overIfCounted && !r.overNow).length,
    labsWhoseNextInviteWouldBeRefused: rows.filter((r) => r.nextInviteRefusedIfCounted && !r.nextInviteRefusedNow).length,
    demoLabsAmongThem: rows.filter((r) => r.isDemo).length,
    // Q279 = 1: one person counts once here even when uncounted in several labs or systems.
    uncountedPeopleDistinct: distinctPeople.size,
    uncountedVeritasLogins: distinctVeritas.size,
    labsWithVeritasLogins: rows.filter((r) => r.veritasLogins > 0).length,
    labsNewlyOverIfCountedExceptVeritas: rows.filter((r) => r.overIfCountedExceptVeritas && !r.overNow).length,
  };
  return { totals, labs: rows };
}
