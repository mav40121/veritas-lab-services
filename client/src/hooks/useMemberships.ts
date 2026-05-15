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
}

export function useMemberships() {
  return useQuery<Membership[]>({
    queryKey: ["/api/labs/me"],
    enabled: isLoggedIn(),
  });
}
