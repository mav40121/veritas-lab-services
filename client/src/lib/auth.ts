// Auth state -- token persisted to localStorage so it survives page refreshes
import type { SeatPermissions } from "@shared/schema";

const TOKEN_KEY = "veritas_token";
const USER_KEY  = "veritas_user";
// Last lab the user explicitly SWITCHED to (LabSwitcher). Used as the
// X-Active-Lab-Id fallback when the current URL has no /labs/:id prefix, so
// authenticated requests from un-prefixed pages still carry the user's current
// lab instead of leaving the server to resolve a possibly-stale default.
const ACTIVE_LAB_KEY = "veritas_active_lab_id";

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
    // Never let one account's active lab leak into the next session.
    localStorage.removeItem(ACTIVE_LAB_KEY);
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

// The lab the user last SWITCHED to, persisted so it survives navigation to an
// un-prefixed page and page refreshes. LabSwitcher.switchTo sets this in the
// same step it updates the server-side default lab, so the two stay aligned.
export function setActiveLabId(labId: number): void {
  try { localStorage.setItem(ACTIVE_LAB_KEY, String(labId)); } catch {}
}
function getPersistedActiveLabId(): number | null {
  try {
    const v = Number(localStorage.getItem(ACTIVE_LAB_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch { return null; }
}

export function authHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (_token) h.Authorization = `Bearer ${_token}`;
  // Prefer the lab in the URL (/labs/:id); fall back to the last switched lab
  // so un-prefixed authenticated pages still tell the server which lab is
  // active instead of letting it resolve to a possibly-stale default. The id
  // is validated server-side (membership/ownership) before it is honored.
  const labId = getActiveLabIdFromUrl() ?? getPersistedActiveLabId();
  if (labId) h["X-Active-Lab-Id"] = String(labId);
  return h;
}
