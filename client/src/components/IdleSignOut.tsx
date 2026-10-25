// System security settings (server/securityPolicy.ts; Michael Q27 = 1, 2026-10-25): when a system owner
// sets "sign out after idle", this signs the browser out after that many minutes with no mouse, key, touch
// or scroll activity. Activity in any tab counts (shared through localStorage), and a banner gives a
// one-minute warning with a button to stay signed in. It does not block the screen. The server ends an
// idle session on its own as well (sessionAuth.ts), so a closed laptop is covered too.
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { Button } from "@/components/ui/button";

const KEY = "veritas_last_activity";
const WARN_MS = 60_000;
const TICK_MS = 5_000;
const WRITE_GAP_MS = 10_000;

function readShared(): number {
  try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; }
}
function writeShared(t: number): void {
  try { localStorage.setItem(KEY, String(t)); } catch { /* private mode: this tab's own clock still works */ }
}

export function IdleSignOut() {
  const { isLoggedIn, logout } = useAuth();
  const { data } = useQuery<{ effective: { idleMinutes: number | null } | null }>({
    queryKey: ["/api/auth/security-settings"],
    enabled: isLoggedIn,
    staleTime: 5 * 60_000,
  });
  const idleMinutes = isLoggedIn ? Number(data?.effective?.idleMinutes || 0) : 0;
  const last = useRef<number>(Date.now());
  const lastWrite = useRef<number>(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!idleMinutes) { setSecondsLeft(null); return; }
    const now = Date.now();
    last.current = now;
    writeShared(now);
    const mark = () => {
      const t = Date.now();
      last.current = t;
      if (t - lastWrite.current > WRITE_GAP_MS) { lastWrite.current = t; writeShared(t); }
    };
    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart", "wheel"];
    for (const e of events) window.addEventListener(e, mark, { passive: true });
    const limit = idleMinutes * 60_000;
    const timer = window.setInterval(() => {
      const lastAny = Math.max(last.current, readShared());
      const left = limit - (Date.now() - lastAny);
      if (left <= 0) {
        window.clearInterval(timer);
        logout();
        window.location.href = `/login?reason=idle&minutes=${idleMinutes}`;
        return;
      }
      setSecondsLeft(left <= WARN_MS ? Math.ceil(left / 1000) : null);
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
      for (const e of events) window.removeEventListener(e, mark);
    };
  }, [idleMinutes, logout]);

  if (secondsLeft == null) return null;
  return (
    <div
      role="status"
      data-testid="idle-warning"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 flex items-center gap-3"
    >
      <span>For security, you'll be signed out in {secondsLeft} seconds without activity.</span>
      <Button size="sm" variant="outline" onClick={() => { const t = Date.now(); last.current = t; writeShared(t); setSecondsLeft(null); }}>
        Stay signed in
      </Button>
    </div>
  );
}
