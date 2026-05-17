import { createContext, useContext, useState, useCallback } from "react";
import { setAuth, clearAuth, getUser, getToken, authHeaders, type AuthUser } from "@/lib/auth";
import { API_BASE } from "@/lib/queryClient";

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
  isLoggedIn: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, token: null, login: () => {}, logout: () => {}, isLoggedIn: false });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getUser());
  const [token, setToken] = useState<string | null>(getToken());
  const login = useCallback((t: string, u: AuthUser) => { setAuth(t, u); setToken(t); setUser(u); }, []);
  // Server-notify logout so user_sessions.is_active flips to 0 BEFORE local
  // state clears. Without this, the next login sees a stale active session
  // row and returns session_conflict, looping the "Another session is
  // active" warning on every clean sign-out. Fire-and-forget so a network
  // failure doesn't strand the user signed-in locally.
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
    setUser(null);
  }, []);
  return <AuthContext.Provider value={{ user, token, login, logout, isLoggedIn: !!token }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
