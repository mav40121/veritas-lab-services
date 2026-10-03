import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { setAuth, clearAuth, getUser, getToken, authHeaders, type AuthUser } from "@/lib/auth";
import { API_BASE } from "@/lib/queryClient";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useMemberships, type Membership } from "@/hooks/useMemberships";

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  // The user's OWN plan (users.plan), never overlaid with a lab plan. Billing /
  // checkout must use this, not the active-lab overlay on user.plan.
  personalPlan: string | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  isLoggedIn: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, token: null, personalPlan: null, login: () => {}, logout: () => {}, isLoggedIn: false });

// Mirrors useActiveSubscription / server getAccessLevel: full while active, then
// a 2-year read-only retention window, then locked.
function accessLevelFromExpiry(expiresAtISO?: string | null): AuthUser["accessLevel"] {
  if (!expiresAtISO) return "free";
  const now = new Date();
  const expiry = new Date(expiresAtISO);
  const retentionEnd = new Date(expiry);
  retentionEnd.setFullYear(retentionEnd.getFullYear() + 2);
  if (now < expiry) return "full";
  if (now < retentionEnd) return "read_only";
  return "locked";
}

function pickActiveLab(memberships: Membership[] | undefined, activeLabId: number | null): Membership | null {
  if (!memberships || memberships.length === 0) return null;
  if (activeLabId) {
    const m = memberships.find((x) => x.labId === activeLabId);
    if (m) return m;
  }
  return memberships.find((x) => x.isPrimaryLab) ?? memberships[0];
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [rawUser, setRawUser] = useState<AuthUser | null>(getUser());
  const [token, setToken] = useState<string | null>(getToken());
  const activeLabId = useActiveLabId();
  const { data: memberships } = useMemberships();

  const login = useCallback((t: string, u: AuthUser) => { setAuth(t, u); setToken(t); setRawUser(u); }, []);
  // Server-notify logout so user_sessions.is_active flips to 0 BEFORE local state
  // clears (otherwise the next login sees a stale active session and loops the
  // "Another session is active" warning). Fire-and-forget so a network failure
  // doesn't strand the user signed-in locally.
  const logout = useCallback(() => {
    try {
      fetch(`${API_BASE}/api/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({}),
      }).catch(() => { /* network failure is OK; local clear still runs */ });
    } catch { /* fetch threw synchronously, ignore */ }
    clearAuth();
    setToken(null);
    setRawUser(null);
  }, []);

  // Overlay the ACTIVE LAB's subscription onto the user so module gates, access
  // banners, and trial modals reflect the lab the user is working in, not the
  // stale login-time plan. A seat user inherits the seat owner's personal plan,
  // which can read "free" even on an enterprise lab (the subscription lives on
  // labs.plan, not the owner's user row); without this overlay every module
  // renders its upgrade wall / free-tier limit on a fully paid lab. Billing
  // reads personalPlan instead. Mirrors useActiveSubscription (lab wins, user
  // falls back) and the server-side active-lab plan resolution.
  const lab = pickActiveLab(memberships, activeLabId);
  const user = useMemo<AuthUser | null>(() => {
    if (!rawUser) return null;
    const withPersonal: AuthUser = { ...rawUser, personalPlan: rawUser.plan };
    if (!lab || !lab.plan) return withPersonal;
    return {
      ...withPersonal,
      plan: lab.plan,
      subscriptionStatus: lab.subscriptionStatus ?? rawUser.subscriptionStatus,
      subscriptionExpiresAt: lab.subscriptionExpiresAt ?? rawUser.subscriptionExpiresAt,
      accessLevel: lab.subscriptionExpiresAt ? accessLevelFromExpiry(lab.subscriptionExpiresAt) : rawUser.accessLevel,
    };
  }, [rawUser, lab]);

  return (
    <AuthContext.Provider value={{ user, token, personalPlan: rawUser?.plan ?? null, login, logout, isLoggedIn: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
