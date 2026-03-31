// Auth state — token persisted to localStorage so it survives page refreshes

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

export function authHeaders(): Record<string, string> {
  return _token ? { Authorization: `Bearer ${_token}` } : {};
}
