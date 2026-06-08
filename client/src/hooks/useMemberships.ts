import { useQuery } from "@tanstack/react-query";
import { isLoggedIn } from "@/lib/auth";

export interface Membership {
  membershipId: number;
  labId: number;
  cliaNumber: string | null;
  labName: string | null;
  role: string;
  permissions: Record<string, any>;
  isPrimaryLab: boolean;
  lastActiveAt: string | null;
  plan: string | null;
  subscriptionStatus: string | null;
  subscriptionExpiresAt: string | null;
  // Accreditation flags from labs.accreditation_*. Used by lab-aware
  // modules (e.g. VeritaResponse) to filter accreditor pickers and
  // renderer cards to bodies the lab actually claims. CMS/CLIA is
  // always implicit and not stored here.
  accreditationCap: boolean;
  accreditationTjc: boolean;
  accreditationCola: boolean;
  accreditationAabb: boolean;
  // CLIA certificate active-through date for this lab (latest active
  // cert by expiration_date). ISO YYYY-MM-DD when set, null when the
  // lab hasn't entered one. Informational only — never gates module
  // access (cert renewals can take months and freezing the app on an
  // expired CLIA would punish the lab for a CMS lag).
  cliaCertExpirationDate: string | null;
}

// Resolve the set of accreditors a lab is allowed to file findings under.
// CMS and Other are always allowed (every lab holds CLIA; Other is the
// escape hatch). Mirrors getLabAllowedAccreditors on the server.
export function allowedAccreditorsForMembership(m: Membership | null | undefined): Set<string> {
  const allowed = new Set<string>(['CMS', 'Other']);
  if (!m) return allowed;
  if (m.accreditationCap)  allowed.add('CAP');
  if (m.accreditationTjc)  allowed.add('TJC');
  if (m.accreditationCola) allowed.add('COLA');
  if (m.accreditationAabb) allowed.add('AABB');
  return allowed;
}

export function useMemberships() {
  return useQuery<Membership[]>({
    queryKey: ["/api/labs/me"],
    enabled: isLoggedIn(),
  });
}
