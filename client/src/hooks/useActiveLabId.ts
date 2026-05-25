import { useLocation } from "wouter";

const LAB_PATH_REGEX = /^\/labs\/(\d+)(?:\/|$)/;

// Paths that have /labs/:labId/* variants in App.tsx. The lab switcher
// only rewrites the URL when navigating between these; on public /
// marketing pages it leaves the URL alone and just updates the server-
// side default + the memberships cache. Keep this in sync with the
// lab-scoped Route list in App.tsx (currently lines 349-372).
const LAB_SCOPABLE_PATHS: readonly string[] = [
  "/dashboard",
  "/study/",
  "/veritascan-app",
  "/veritamap-app",
  "/veritatrack-app",
  "/veritacomp-app",
  "/veritapt/app",
  "/veritaresponse",
  "/veritastaff-app",
  "/veritalab-app",
  "/veritapolicy-app",
  "/veritaqc-app",
  "/veritacheck/cumsum",
  "/veritastock",
  "/account/settings",
];

export function isLabScopablePath(path: string): boolean {
  const stripped = stripLabPrefix(path);
  // Strip query string + hash before matching so /faq?x=1 matches /faq.
  const pathOnly = stripped.split(/[?#]/)[0];
  return LAB_SCOPABLE_PATHS.some(p => {
    const base = p.endsWith("/") ? p.slice(0, -1) : p;
    return pathOnly === base || pathOnly.startsWith(base + "/");
  });
}

export function useActiveLabId(): number | null {
  const [location] = useLocation();
  const m = location.match(LAB_PATH_REGEX);
  return m ? Number(m[1]) : null;
}

export function stripLabPrefix(path: string): string {
  return path.replace(LAB_PATH_REGEX, "/");
}

export function withLabPrefix(path: string, labId: number): string {
  const stripped = stripLabPrefix(path);
  // Public / marketing pages (faq, pricing, veritaassure, home, etc.)
  // have no /labs/:labId/* variant; forcing the prefix produces a 404.
  // Leave the URL alone and let the active-lab state be carried by the
  // server-side default + the refreshed memberships cache.
  if (!isLabScopablePath(stripped)) return stripped;
  return `/labs/${labId}${stripped === "/" ? "" : stripped}`;
}
