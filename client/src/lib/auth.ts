// Auth state — React context backed by in-memory token
// No localStorage (blocked in sandboxed iframes) — token lives in module state

let _token: string | null = null;
let _user: AuthUser | null = null;

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  plan: string;
  studyCredits: number;
}

export function setAuth(token: string, user: AuthUser) {
  _token = token;
  _user = user;
}

export function clearAuth() {
  _token = null;
  _user = null;
}

export function getToken(): string | null { return _token; }
export function getUser(): AuthUser | null { return _user; }
export function isLoggedIn(): boolean { return !!_token; }

export function authHeaders(): Record<string, string> {
  return _token ? { Authorization: `Bearer ${_token}` } : {};
}
