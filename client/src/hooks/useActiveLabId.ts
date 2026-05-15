import { useLocation } from "wouter";

const LAB_PATH_REGEX = /^\/labs\/(\d+)(?:\/|$)/;

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
  return `/labs/${labId}${stripped === "/" ? "" : stripped}`;
}
