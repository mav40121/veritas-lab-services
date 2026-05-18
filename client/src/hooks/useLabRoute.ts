import { useActiveLabId } from "@/hooks/useActiveLabId";

/**
 * useLabRoute returns a function that prefixes an in-app path with the
 * active lab segment when the user is currently scoped to a lab.
 *
 * Use it for any forward navigation INSIDE the app (clicking into a
 * program, employee, finding, map, etc.) so the destination preserves
 * the lab context. Without this, navigate("/veritacomp-app/7") strips
 * /labs/N/, lands on the legacy unprefixed route, and the destination
 * page's useActiveLabId() returns null, so it reads from the user's
 * default lab instead of the lab the user was just looking at.
 *
 * Pair with the LAB_SCOPABLE_PATHS allowlist in useActiveLabId.ts.
 *
 * Example:
 *   const labRoute = useLabRoute();
 *   navigate(labRoute(`/veritacomp-app/${programId}`));
 */
export function useLabRoute(): (path: string) => string {
  const activeLabId = useActiveLabId();
  return (path: string) => {
    if (!activeLabId) return path;
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `/labs/${activeLabId}${normalized}`;
  };
}
