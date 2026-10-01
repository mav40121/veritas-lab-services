// server/organizationBackfill.ts
//
// Phase 1b of the System/Organization entity work (docs/SYSTEM_ENTITY_DESIGN.md).
//
// Pure helpers for the admin backfill that links the already-live implicit
// systems (labs sharing one owner_user_id) to first-class organizations rows.
// The route (POST /api/admin/organizations/backfill) uses these to produce the
// dryRun candidate list; the actual writes live in the route. Mirrored by
// scripts/verify-organization-backfill.mjs.
//
// A candidate is any owner with MORE THAN ONE lab. Whether a candidate should
// actually become an organization is a human decision (e.g. owner #17 is a
// personal grab-bag, not a customer system), so apply takes an EXPLICIT
// {ownerUserId, name} list; this file only suggests.

export interface BackfillLabRow {
  id: number;
  lab_name: string | null;
  owner_user_id: number | null;
  is_demo: number | null;
  is_repository: number | null;
  organization_id: number | null;
}

export interface BackfillUserRow {
  id: number;
  email: string | null;
  name: string | null;
}

export interface BackfillCandidate {
  ownerUserId: number;
  ownerEmail: string | null;
  ownerName: string | null;
  labCount: number;
  labIds: number[];
  labNames: string[];
  suggestedName: string;
  alreadyLinked: boolean; // at least one of the owner's labs already has organization_id
}

/** Longest common prefix of a list of strings. */
export function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  let p = strs[0];
  for (let k = 1; k < strs.length; k++) {
    const s = strs[k];
    let i = 0;
    while (i < p.length && i < s.length && p[i] === s[i]) i++;
    p = p.slice(0, i);
    if (!p) break;
  }
  return p;
}

/**
 * Suggest a system name from the member lab names. Uses the longest common
 * prefix when it is meaningful (>= 4 chars after trimming trailing separators);
 * otherwise falls back to the longest lab name, then the owner's name, then the
 * owner's email. The caller always overrides this with an explicit name on
 * apply, so this only needs to be a helpful starting point.
 */
export function suggestOrgName(
  labNames: string[],
  ownerName?: string | null,
  ownerEmail?: string | null,
): string {
  const names = labNames.map((n) => (n || "").trim()).filter((n) => n.length > 0);
  if (names.length > 0) {
    let lcp = longestCommonPrefix(names).trim();
    lcp = lcp.replace(/[\s\-:,|/]+$/, "").trim();
    if (lcp.length >= 4) return lcp;
    return names.slice().sort((a, b) => b.length - a.length)[0];
  }
  if (ownerName && ownerName.trim()) return ownerName.trim();
  if (ownerEmail && ownerEmail.trim()) return ownerEmail.trim();
  return "Unnamed System";
}

/**
 * Candidate implicit systems: owners with more than one lab, newest/biggest
 * first. Pure over row arrays.
 */
export function computeBackfillCandidates(
  labs: BackfillLabRow[],
  users: BackfillUserRow[],
): BackfillCandidate[] {
  const userById = new Map<number, BackfillUserRow>();
  for (const u of users) userById.set(u.id, u);

  const byOwner = new Map<number, BackfillLabRow[]>();
  for (const l of labs) {
    if (l.owner_user_id == null) continue;
    const arr = byOwner.get(l.owner_user_id) || [];
    arr.push(l);
    byOwner.set(l.owner_user_id, arr);
  }

  const out: BackfillCandidate[] = [];
  for (const [ownerUserId, ownerLabs] of byOwner) {
    if (ownerLabs.length <= 1) continue;
    const u = userById.get(ownerUserId);
    const sorted = ownerLabs.slice().sort((a, b) => a.id - b.id);
    const labNames = sorted.map((l) => l.lab_name || "");
    out.push({
      ownerUserId,
      ownerEmail: u?.email ?? null,
      ownerName: u?.name ?? null,
      labCount: ownerLabs.length,
      labIds: sorted.map((l) => l.id),
      labNames,
      suggestedName: suggestOrgName(labNames, u?.name, u?.email),
      alreadyLinked: ownerLabs.some((l) => l.organization_id != null),
    });
  }
  out.sort((a, b) => b.labCount - a.labCount || a.ownerUserId - b.ownerUserId);
  return out;
}
