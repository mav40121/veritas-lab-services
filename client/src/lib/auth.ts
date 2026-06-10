// Auth state -- token persisted to localStorage so it survives page refreshes
import type { SeatPermissions } from "@shared/schema";

const TOKEN_KEY = "veritas_token";
const USER_KEY  = "veritas_user";

let _token: string | null = null;
let _user: AuthUser | null = null;

// Hydrate from localStorage on module load
try {
  const stored = localStorage.getItem(TOKEN_KEY);
  const storedUser = localStorage.getItem(USER_KEY);
  if (stored) _token = stored;
  if (storedUser) _user = JSON.parse(storedUser);
} catch {}

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  plan: string;
  studyCredits: number;
  hasCompletedOnboarding?: boolean;
  subscriptionExpiresAt?: string | null;
  subscriptionStatus?: string;
  accessLevel?: 'full' | 'read_only' | 'locked' | 'free';
  cliaNumber?: string | null;
  cliaLabName?: string | null;
  cliaTier?: string | null;
  seatCount?: number;
  onboardingSeen?: boolean;
  isSeatUser?: boolean;
  // Two shapes accepted for backward compatibility (see shared/schema.ts):
  //   * legacy flat map  { veritacheck: 'edit', ... }
  //   * new mode shape   { mode: 'edit_all'|'view_all'|'custom', overrides?: {...} }
  // Always read through resolveSeatPermission(), never index this directly.
  seatPermissions?: SeatPermissions;
  ownerUserId?: number | null;
}

export function setAuth(token: string, user: AuthUser) {
  _token = token;
  _user = user;
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch {}
}

export function clearAuth() {
  _token = null;
  _user = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {}
}

export function getToken(): string | null { return _token; }
export function getUser(): AuthUser | null { return _user; }
export function isLoggedIn(): boolean { return !!_token; }

// 2026-06-10 (Michael L feedback on co2 PDF showing UMass Milford):
// every NavBar-aware request now carries the active lab in
// X-Active-Lab-Id. The server (resolveActiveLabForRequest) validates
// active membership before honoring it, so this is safe even on
// public / cross-lab paths. Reads from window.location.pathname so
// it never has to thread React hooks through to fetch helpers.
function getActiveLabIdFromUrl(): number | null {
  if (typeof window === "undefined") return null;
  const m = window.location.pathname.match(/^\/labs\/(\d+)(?:\/|$)/);
  return m ? Number(m[1]) : null;
}

export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (_token) h.Authorization = `Bearer ${_token}`;
  const labId = getActiveLabIdFromUrl();
  if (labId) h["X-Active-Lab-Id"] = String(labId);
  return h;
}
