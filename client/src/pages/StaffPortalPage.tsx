// client/src/pages/StaffPortalPage.tsx
//
// 2026-06-08 (task #131). Unauthenticated Staff Portal landing at
// /staff-access. Mirrors the InventoryKioskPage pattern (Wave K4):
// CLIA + 6-digit PIN → synthetic JWT → employee picker → module tiles.
//
// Modules visible to the staff member depend on the two toggles on
// staff_employees:
//   - Policies + Competencies: universal (always shown)
//   - Inventory: shown only if can_adjust_inventory = 1
//   - Audit view: shown only if can_view_audit = 1
//
// The actual module screens (policy signing, competency sign-off,
// inventory adjust, audit grids) ship in subsequent PRs. This PR
// lands the entrance.
//
// Same operational guards as the inventory kiosk:
// - sessionStorage (not localStorage) so a shared tablet doesn't
//   leak a session across browser restarts.
// - 15-minute idle timeout. 8h JWT TTL is the hard ceiling.
// - No NavBar, no chrome, no links out. Kiosk surface.

import { useEffect, useRef, useState } from "react";

interface StaffPortalSession {
  token: string;
  lab: { id: number; name: string; clia_number: string };
  expires_in_seconds: number;
}

interface PortalEmployee {
  id: number;
  first_name: string;
  last_name: string;
  middle_initial: string | null;
  title: string | null;
  title_code: string | null;
  can_adjust_inventory: boolean;
  can_view_audit: boolean;
}

const STORAGE_KEY = "veritastaff_portal_session_v1";
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

function readSession(): StaffPortalSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StaffPortalSession;
  } catch { return null; }
}
function writeSession(s: StaffPortalSession | null) {
  try {
    if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* shared tablet; sessionStorage may be disabled */ }
}

function fullName(e: PortalEmployee): string {
  const mi = e.middle_initial ? ` ${e.middle_initial}.` : "";
  return `${e.first_name}${mi} ${e.last_name}`;
}

export default function StaffPortalPage() {
  const [session, setSession] = useState<StaffPortalSession | null>(() => readSession());
  const [clia, setClia] = useState("");
  const [pin, setPin] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [employees, setEmployees] = useState<PortalEmployee[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [activeEmployee, setActiveEmployee] = useState<PortalEmployee | null>(null);

  const idleTimerRef = useRef<number | null>(null);

  function resetIdleTimer() {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = window.setTimeout(() => {
      writeSession(null);
      setSession(null);
      setEmployees(null);
      setActiveEmployee(null);
    }, IDLE_TIMEOUT_MS) as unknown as number;
  }

  useEffect(() => {
    if (!session) return;
    const onActivity = () => resetIdleTimer();
    resetIdleTimer();
    window.addEventListener("keydown", onActivity);
    window.addEventListener("click", onActivity);
    window.addEventListener("touchstart", onActivity);
    return () => {
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("click", onActivity);
      window.removeEventListener("touchstart", onActivity);
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    };
  }, [session]);

  useEffect(() => {
    if (!session) { setEmployees(null); return; }
    setPickerError(null);
    fetch("/api/staff-portal-session/employees", {
      headers: { Authorization: `Bearer ${session.token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setEmployees(d.employees || []))
      .catch((e: any) => setPickerError(e.message || "Could not load employees"));
  }, [session]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/api/staff-portal-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clia: clia.trim(), pin: pin.trim() }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const next: StaffPortalSession = data;
      writeSession(next);
      setSession(next);
      setClia(""); setPin("");
    } catch (err: any) {
      setLoginError(err.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  function signOut() {
    writeSession(null);
    setSession(null);
    setEmployees(null);
    setActiveEmployee(null);
  }

  // ── Login screen ─────────────────────────────────────────────────────
  if (!session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-sm border border-border rounded-xl bg-card p-6 shadow-sm">
          <div className="text-center mb-6">
            <div className="font-serif text-2xl font-bold tracking-tight" style={{ color: "#01696F" }}>
              VeritaAssure&trade; Staff Portal
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Enter your lab's CLIA number and the staff PIN provided by the lab director.
            </p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1" htmlFor="sp-clia">CLIA Number</label>
              <input
                id="sp-clia"
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="e.g. 03D0531813"
                value={clia}
                onChange={(e) => setClia(e.target.value)}
                className="w-full border border-border rounded-md p-2 font-mono text-sm bg-background"
                data-testid="sp-login-clia"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1" htmlFor="sp-pin">6-digit PIN</label>
              <input
                id="sp-pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="••••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="w-full border border-border rounded-md p-2 font-mono text-lg tracking-widest text-center bg-background"
                data-testid="sp-login-pin"
              />
            </div>
            {loginError && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2">
                {loginError}
              </div>
            )}
            <button
              type="submit"
              disabled={submitting || !clia.trim() || pin.length < 6}
              className="w-full text-white font-semibold py-2 rounded-md disabled:opacity-50"
              style={{ backgroundColor: "#01696F" }}
              data-testid="sp-login-submit"
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Employee picker ──────────────────────────────────────────────────
  if (!activeEmployee) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Staff Portal</div>
              <div className="font-serif text-xl font-bold">{session.lab.name}</div>
              <div className="text-xs text-muted-foreground">CLIA: {session.lab.clia_number}</div>
            </div>
            <button onClick={signOut} className="text-xs text-muted-foreground hover:underline" data-testid="sp-sign-out">
              Sign out
            </button>
          </div>
          <div className="border border-border rounded-lg bg-card p-4">
            <div className="text-sm font-semibold mb-3">Who is signing in?</div>
            {pickerError && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2 mb-3">
                {pickerError}
              </div>
            )}
            {employees === null ? (
              <div className="text-sm text-muted-foreground py-6 text-center">Loading roster...</div>
            ) : employees.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                No active employees on this lab's VeritaStaff&trade; roster. Ask the lab director to add staff first.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {employees.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setActiveEmployee(e)}
                    className="w-full text-left py-3 px-2 hover:bg-muted flex items-center justify-between gap-3"
                    data-testid="sp-employee-row"
                  >
                    <div>
                      <div className="text-sm font-medium">{fullName(e)}</div>
                      <div className="text-xs text-muted-foreground">
                        {e.title || "(no title)"}{e.title_code ? ` · ${e.title_code}` : ""}
                      </div>
                    </div>
                    <span className="text-xs text-teal-700">Select</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Module tiles for the picked employee ─────────────────────────────
  // Policies + Competencies are always available. Inventory + Audit gate
  // on the staff_employees toggle flags. The actual module screens land
  // in subsequent PRs; tonight the tiles are visible-but-disabled with
  // "Coming soon" copy so the lab director can see the access model
  // working end-to-end.
  const tiles = [
    { key: "policies",    label: "Sign Policies",       available: true,                        ready: false },
    { key: "competency",  label: "Sign Competencies",   available: true,                        ready: false },
    { key: "inventory",   label: "Adjust Inventory",    available: activeEmployee.can_adjust_inventory, ready: false },
    { key: "audit",       label: "View Audit Trail",    available: activeEmployee.can_view_audit,       ready: false },
  ];

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Staff Portal</div>
            <div className="font-serif text-xl font-bold">{fullName(activeEmployee)}</div>
            <div className="text-xs text-muted-foreground">
              {activeEmployee.title || "(no title)"} · {session.lab.name}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button onClick={() => setActiveEmployee(null)} className="text-xs text-muted-foreground hover:underline" data-testid="sp-switch-employee">
              Not me / switch
            </button>
            <button onClick={signOut} className="text-xs text-muted-foreground hover:underline">
              Sign out
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="sp-tiles">
          {tiles.map((t) => (
            <div
              key={t.key}
              className={
                "border rounded-lg p-4 " +
                (t.available ? "border-primary/40 bg-card" : "border-border bg-muted/30 opacity-60")
              }
              data-testid={`sp-tile-${t.key}`}
            >
              <div className="font-semibold">{t.label}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {!t.available
                  ? "Not enabled for this staff member."
                  : t.ready
                    ? "Tap to begin."
                    : "Ready soon. Lab director has granted access."}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
