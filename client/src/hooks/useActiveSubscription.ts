import { useAuth } from "@/components/AuthContext";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useMemberships, type Membership } from "@/hooks/useMemberships";

// Multi-Lab Tier 2 Phase 4.3c: subscription state sourced from the active
// lab's membership row when available, with user-level fallback for
// unauthenticated / brand-new / no-membership cases. Server-side this
// mirrors the Phase 4.3a getAccessLevel(user, lab?) shape: lab wins, user
// falls back.

export type AccessLevel = "full" | "read_only" | "locked" | "free";

export interface ActiveSubscription {
  accessLevel: AccessLevel;
  plan: string | null;
  subscriptionStatus: string | null;
  subscriptionExpiresAt: string | null;
  source: "lab" | "user" | "none";
}

function computeAccessLevel(expiresAtISO: string | null | undefined): AccessLevel {
  if (!expiresAtISO) return "free";
  const now = new Date();
  const expiry = new Date(expiresAtISO);
  const retentionEnd = new Date(expiry);
  retentionEnd.setFullYear(retentionEnd.getFullYear() + 2);
  if (now < expiry) return "full";
  if (now < retentionEnd) return "read_only";
  return "locked";
}

function pickActive(memberships: Membership[] | undefined, activeLabId: number | null): Membership | null {
  if (!memberships || memberships.length === 0) return null;
  if (activeLabId) {
    const m = memberships.find(x => x.labId === activeLabId);
    if (m) return m;
  }
  // Fall back to primary lab
  const primary = memberships.find(x => x.isPrimaryLab);
  return primary ?? memberships[0];
}

export function useActiveSubscription(): ActiveSubscription {
  const { user, isLoggedIn } = useAuth();
  const activeLabId = useActiveLabId();
  const { data: memberships } = useMemberships();

  if (!isLoggedIn || !user) {
    return { accessLevel: "free", plan: null, subscriptionStatus: null, subscriptionExpiresAt: null, source: "none" };
  }

  const lab = pickActive(memberships, activeLabId);
  if (lab) {
    return {
      accessLevel: computeAccessLevel(lab.subscriptionExpiresAt),
      plan: lab.plan,
      subscriptionStatus: lab.subscriptionStatus,
      subscriptionExpiresAt: lab.subscriptionExpiresAt,
      source: "lab",
    };
  }

  // Fallback: user-level state from /api/auth/me. Covers (a) memberships
  // still loading, (b) user has no memberships yet (mid-onboarding).
  return {
    accessLevel: (user.accessLevel as AccessLevel) ?? "free",
    plan: user.plan ?? null,
    subscriptionStatus: user.subscriptionStatus ?? null,
    subscriptionExpiresAt: user.subscriptionExpiresAt ?? null,
    source: "user",
  };
}
