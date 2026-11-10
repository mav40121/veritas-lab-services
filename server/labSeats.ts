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

export type LabSeatSummary = {
  activeIncluded: number;
  activeUsed: number;            // includes the owner
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
    return { activeIncluded, activeUsed: active + 1, medicalDirectorUsed: mdSeen ? 1 : 0, pooled: true, ...staff };
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
  return { activeIncluded, activeUsed: active + 1, medicalDirectorUsed: md, pooled: false, ...staff };
}

// BUG-096 (found 2026-10-25): measuring before deciding. Seats are counted from user_seats rows, so a lab admin who
// holds no seat row is never counted: Heywood's original owner became an admin when ownership moved to its medical
// director and was never given one, so the Members page read 1 of 10 with two people writing. Counting such people
// would also change the invite gate (it refuses a writer invite once activeUsed + 1 > activeIncluded), so this
// counts, per lab, the active owner or admin members who are writing without a seat row (not the lab's owner, not a
// Veritas support account, not a medical director, who sits on the free seat) and what the count and the gate would
// read with them. It changes nothing. GET /api/admin/seat-count-gaps sends it; lab ids and counts only, no names.
export type SeatCountGapRow = {
  labId: number; isDemo: boolean; pooled: boolean;
  activeIncluded: number; activeUsed: number; uncountedAdmins: number; usedIfCounted: number;
  overNow: boolean; overIfCounted: boolean;
  nextInviteRefusedNow: boolean; nextInviteRefusedIfCounted: boolean;
};

export function seatCountGaps(sqlite: any): { totals: Record<string, number>; labs: SeatCountGapRow[] } {
  const labs = sqlite.prepare("SELECT id, owner_user_id, organization_id, medical_director_email, COALESCE(is_demo, 0) AS is_demo FROM labs ORDER BY id").all() as any[];
  const mdByOwner = new Map<number, Set<string>>();
  for (const l of labs) {
    const e = String(l.medical_director_email || "").trim().toLowerCase();
    if (!e) continue;
    if (!mdByOwner.has(l.owner_user_id)) mdByOwner.set(l.owner_user_id, new Set());
    mdByOwner.get(l.owner_user_id)!.add(e);
  }
  const membersOf = sqlite.prepare(
    `SELECT m.user_id AS u, lower(u.email) AS e FROM lab_members m JOIN users u ON u.id = m.user_id
      WHERE m.lab_id = ? AND m.status = 'active' AND m.role IN ('owner', 'admin') AND COALESCE(u.vls_support, 0) = 0`
  );
  const seatsByLab = sqlite.prepare("SELECT seat_user_id AS u, lower(seat_email) AS e FROM user_seats WHERE lab_id = ? AND status != 'deactivated' AND COALESCE(seat_type, 'active') = 'active'");
  const seatsByOwner = sqlite.prepare("SELECT seat_user_id AS u, lower(seat_email) AS e FROM user_seats WHERE owner_user_id = ? AND status != 'deactivated' AND COALESCE(seat_type, 'active') = 'active'");

  // The people writing without a seat row in one lab: user ids, never shown.
  const uncountedIn = (l: any): number[] => {
    const pooled = l.organization_id != null;
    const seats = (pooled ? seatsByOwner.all(l.owner_user_id) : seatsByLab.all(l.id)) as { u: number | null; e: string | null }[];
    const seatUsers = new Set(seats.map((s) => s.u).filter((u) => u != null));
    const seatEmails = new Set(seats.map((s) => s.e).filter(Boolean));
    const mdEmails = pooled ? (mdByOwner.get(l.owner_user_id) ?? new Set<string>())
      : new Set([String(l.medical_director_email || "").trim().toLowerCase()].filter(Boolean));
    return (membersOf.all(l.id) as { u: number; e: string }[])
      .filter((m) => m.u !== l.owner_user_id && !seatUsers.has(m.u) && !(m.e && seatEmails.has(m.e)) && !(m.e && mdEmails.has(m.e)))
      .map((m) => m.u);
  };

  // An org-linked lab's count is pooled across the owner's labs, so its uncounted people are pooled the same way:
  // one person admin in two labs of a system is one more seat, not two.
  const pooledUncounted = new Map<number, Set<number>>();
  for (const l of labs) {
    if (l.organization_id == null) continue;
    if (!pooledUncounted.has(l.owner_user_id)) pooledUncounted.set(l.owner_user_id, new Set());
    for (const u of uncountedIn(l)) pooledUncounted.get(l.owner_user_id)!.add(u);
  }

  const rows: SeatCountGapRow[] = [];
  const people = new Set<string>();
  for (const l of labs) {
    const summary = labSeatSummary(sqlite, l.id);
    if (!summary) continue;
    const pooled = l.organization_id != null;
    const own = uncountedIn(l);
    const add = pooled ? (pooledUncounted.get(l.owner_user_id)?.size ?? 0) : own.length;
    for (const u of own) people.add(pooled ? `o${l.owner_user_id}:${u}` : `l${l.id}:${u}`);
    if (own.length === 0) continue;
    const usedIfCounted = summary.activeUsed + add;
    rows.push({
      labId: l.id, isDemo: Number(l.is_demo) === 1, pooled,
      activeIncluded: summary.activeIncluded, activeUsed: summary.activeUsed, uncountedAdmins: own.length, usedIfCounted,
      overNow: summary.activeUsed > summary.activeIncluded, overIfCounted: usedIfCounted > summary.activeIncluded,
      nextInviteRefusedNow: summary.activeUsed + 1 > summary.activeIncluded, nextInviteRefusedIfCounted: usedIfCounted + 1 > summary.activeIncluded,
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
  };
  return { totals, labs: rows };
}
