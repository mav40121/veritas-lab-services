import { createContext, useContext, useState, useCallback } from "react";
import { setAuth, clearAuth, getUser, getToken, type AuthUser } from "@/lib/auth";

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
  const logout = useCallback(() => { clearAuth(); setToken(null); setUser(null); }, []);
  return <AuthContext.Provider value={{ user, token, login, logout, isLoggedIn: !!token }}>{children}</AuthContext.Provider>;
}

export function useAuth() { return useContext(AuthContext); }
