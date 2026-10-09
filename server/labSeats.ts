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
    let active = 0, md = 0;
    for (const r of rows) {
      if (r.e && mdEmails.has(r.e)) { md++; continue; }
      if (r.t === "active") active++;
    }
    return { activeIncluded, activeUsed: active + 1, medicalDirectorUsed: md, pooled: true, ...staff };
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
