// client/src/lib/currentLab.ts
//
// BUG-041 (2026-10-12): which of the user's labs is "current". On a /labs/:id page it is that lab. On a page with no
// lab in its URL (the VeritaAssure overview, marketing pages, un-prefixed module links) it is the lab the user was
// last in (remembered by NavBar on every /labs/:id page and by the switcher), when that lab is still in their list;
// only then the primary membership, then the first. Falling straight to the primary is what moved Michael from
// Redington-Fairview (Veritas support access, never primary) to "Michaels Lab" on every module switch.
import { getPersistedActiveLabId } from "@/lib/auth";

export function pickCurrentMembership<T extends { labId: number; isPrimaryLab?: boolean }>(
  memberships: T[] | null | undefined,
  urlLabId: number | null,
): T | null {
  if (!memberships || memberships.length === 0) return null;
  if (urlLabId) {
    const m = memberships.find((x) => x.labId === urlLabId);
    if (m) return m;
  }
  const remembered = getPersistedActiveLabId();
  if (remembered) {
    const m = memberships.find((x) => x.labId === remembered);
    if (m) return m;
  }
  return memberships.find((x) => x.isPrimaryLab) ?? memberships[0];
}
