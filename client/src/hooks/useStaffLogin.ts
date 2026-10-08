import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useMemberships } from "@/hooks/useMemberships";

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
