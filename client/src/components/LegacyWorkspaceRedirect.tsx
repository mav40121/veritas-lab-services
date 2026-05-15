import { useEffect } from "react";
import { useLocation } from "wouter";
import { useMemberships } from "@/hooks/useMemberships";
import { isLoggedIn as authIsLoggedIn } from "@/lib/auth";

// Wraps a legacy unprefixed workspace route (e.g. /dashboard,
// /veritapolicy-app, /study/:id/results) and redirects to its lab-scoped
// form (/labs/:labId/<same>) once memberships load. Pass-through when:
//   - user is not logged in (page itself handles login redirect)
//   - memberships query is still loading
//   - user has zero memberships (onboarding case, no lab to redirect to)
//   - current URL is already lab-scoped (defensive; shouldn't reach here)
//
// The destination lab is the user's primary membership (the /api/labs/me
// response is server-side ordered: is_primary_lab DESC, id ASC), which
// matches users.default_lab_id from Phase 1 backfill.
export function LegacyWorkspaceRedirect({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const loggedIn = authIsLoggedIn();
  const { data: memberships, isLoading } = useMemberships();

  const willRedirect =
    loggedIn &&
    !isLoading &&
    !!memberships &&
    memberships.length > 0 &&
    !location.startsWith("/labs/");

  useEffect(() => {
    if (!willRedirect) return;
    const target = memberships![0];
    setLocation(`/labs/${target.labId}${location}`);
  }, [willRedirect, memberships, location, setLocation]);

  if (willRedirect) return null;
  return <>{children}</>;
}
