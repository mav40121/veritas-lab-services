import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useMemberships } from "@/hooks/useMemberships";
import { pickCurrentMembership } from "@/lib/currentLab";

// #84 (2026-10-08): true when the signed-in user is a Staff login in the active
// lab: a staff_portal seat there and not the lab's owner or admin. Staff see the
// same module screens as editors; this hook hides owner-oriented chrome (setup
// banners, Run a Study, plan links) and lands them on their own work.
export function useIsStaffLogin(): boolean {
  const labId = useActiveLabId();
  const { data } = useMemberships();
  const m = labId ? data?.find((x) => x.labId === labId) : undefined;
  if (!m) return false;
  if (m.role === "owner" || m.role === "admin") return false;
  return m.seatType === "staff_portal";
}

// Michael Q182 = 1 (2026-11-05): a Staff login sees only their own competency data, in every lab. The server decides this per lab
// (server/competencySelfEntry.ts staffOwnScope, sent on GET /api/labs/me), so the screens and the routes can't disagree. ready is
// false only while the memberships are loading, so a Staff login never sees the evaluator's screens flash first.
export function useStaffOwnScope(): { ownOnly: boolean; ownEmployeeId: number | null; ready: boolean } {
  const labId = useActiveLabId();
  const { data, isLoading } = useMemberships();
  const m = pickCurrentMembership(data, labId);
  return { ownOnly: !!m?.competencyOwnOnly, ownEmployeeId: m?.ownEmployeeId ?? null, ready: !isLoading };
}
