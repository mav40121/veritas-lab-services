// client/src/pages/InventoryKioskPage.tsx
//
// Wave K4 (2026-06-07). Unauthenticated kiosk page at /inventory.
// Bench techs enter the lab's CLIA + 6-digit PIN, then count and
// adjust quantities. Each adjustment requires initials.
//
// Design notes:
// - Session token lives in sessionStorage, NOT localStorage. The
//   tablet is shared; we don't want the next tech to inherit the
//   prior tech's session across browser restarts.
// - No NavBar, no chrome, no links out. The kiosk surface is its
//   own world.
// - 15-minute idle timeout. Activity (any keypress or click) resets
//   the timer. On timeout the JWT is dropped and the login screen
//   reappears. The 8h JWT TTL is the hard ceiling; idle timeout is
//   the operational guard.
// - Initials persist across adjustments within a session (per-tech
//   convenience) but reset on sign-out / idle.

import { useEffect, useRef, useState } from "react";
import InventoryCountWorkflow, { type CountItem } from "@/components/InventoryCountWorkflow";

interface KioskItem {
  id: number;
  item_name: string;
  catalog_number: string | null;
  lot_number: string | null;
  department: string | null;
  category: string | null;
  quantity_on_hand: number;
  unit: string | null;
  storage_location: string | null;
  barcode_value: string | null;
  expiration_date: string | null;
}

interface KioskSession {
  token: string;
  lab: { id: number; name: string; clia_number: string };
  expires_in_seconds: number;
}

const STORAGE_KEY = "veritastock_kiosk_session_v1";
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

function readSession(): KioskSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as KioskSession;
  } catch {
    return null;
  }
}
function writeSession(s: KioskSession | null) {
  try {
    if (s) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* shared tablet; sessionStorage may be disabled */
  }
}

export default function InventoryKioskPage() {
  const [session, setSession] = useState<KioskSession | null>(() => readSession());
  const [clia, setClia] = useState("");
  const [pin, setPin] = useState("");
  const [loginErr, setLoginErr] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const [items, setItems] = useState<KioskItem[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [initials, setInitials] = useState("");
  const [search, setSearch] = useState("");
  const [showList, setShowList] = useState(false);
  const [countWorkflowOpen, setCountWorkflowOpen] = useState(false);

  // Per-row save status: { [itemId]: "idle" | "saving" | "saved" | "error" }
  const [rowStatus, setRowStatus] = useState<Record<number, { state: string; msg?: string }>>({});
  // Per-row pending qty input value (separate from rendered qty so the input doesn't fight the user)
  const [pending, setPending] = useState<Record<number, string>>({});

  // ── idle timeout ─────────────────────────────────────────────────────
  const idleRef = useRef<number | null>(null);
  const resetIdle = () => {
    if (idleRef.current != null) window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => {
      handleSignOut("Signed out for inactivity.");
    }, IDLE_TIMEOUT_MS);
  };
  useEffect(() => {
    if (!session) {
      if (idleRef.current != null) window.clearTimeout(idleRef.current);
      return;
    }
    resetIdle();
    const onActivity = () => resetIdle();
    window.addEventListener("keydown", onActivity);
    window.addEventListener("mousedown", onActivity);
    window.addEventListener("touchstart", onActivity);
    return () => {
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("mousedown", onActivity);
      window.removeEventListener("touchstart", onActivity);
      if (idleRef.current != null) window.clearTimeout(idleRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // ── load items when session arrives ──────────────────────────────────
  useEffect(() => {
    if (!session) { setItems(null); return; }
    loadItems(session.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.token]);

  async function loadItems(token: string) {
    setLoadErr(null);
    try {
      const r = await fetch("/api/inventory-session/items", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.status === 401) {
        handleSignOut("Session expired. Sign in again.");
        return;
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setLoadErr(j.error || `Failed to load (status ${r.status})`);
        return;
      }
      const j = await r.json();
      setItems(j.items || []);
    } catch (e: any) {
      setLoadErr(e.message || "Network error");
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginErr(null);
    setLoginLoading(true);
    try {
      const r = await fetch("/api/inventory-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clia: clia.trim(), pin: pin.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 423) {
          setLoginErr("This lab is locked out for 15 minutes. Ask the director to rotate the PIN.");
        } else {
          setLoginErr(j.error || "Invalid CLIA or PIN.");
        }
        return;
      }
      const s: KioskSession = j;
      writeSession(s);
      setSession(s);
      setClia(""); setPin("");
    } catch (e: any) {
      setLoginErr(e.message || "Network error");
    } finally {
      setLoginLoading(false);
    }
  }

  function handleSignOut(notice?: string) {
    writeSession(null);
    setSession(null);
    setItems(null);
    setInitials("");
    setSearch("");
    setRowStatus({});
    setPending({});
    if (notice) setLoginErr(notice);
  }

  async function saveAdjustment(item: KioskItem) {
    if (!session) return;
    const raw = pending[item.id];
    const n = Number(raw);
    if (!/^\d+$/.test(String(raw || "")) || !Number.isFinite(n) || n < 0) {
      setRowStatus(prev => ({ ...prev, [item.id]: { state: "error", msg: "Enter a whole number" } }));
      return;
    }
    if (!/^[A-Za-z0-9]{2,4}$/.test(initials)) {
      setRowStatus(prev => ({ ...prev, [item.id]: { state: "error", msg: "Enter your initials (2-4 chars)" } }));
      return;
    }
    setRowStatus(prev => ({ ...prev, [item.id]: { state: "saving" } }));
    try {
      const r = await fetch(`/api/inventory-session/items/${item.id}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ new_quantity: n, initials }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) {
        handleSignOut("Session expired. Sign in again.");
        return;
      }
      if (!r.ok) {
        setRowStatus(prev => ({ ...prev, [item.id]: { state: "error", msg: j.error || `Save failed (${r.status})` } }));
        return;
      }
      setItems(prev => prev?.map(it => it.id === item.id ? { ...it, quantity_on_hand: n } : it) || null);
      setPending(prev => { const next = { ...prev }; delete next[item.id]; return next; });
      setRowStatus(prev => ({ ...prev, [item.id]: { state: "saved" } }));
      window.setTimeout(() => {
        setRowStatus(prev => {
          if (prev[item.id]?.state !== "saved") return prev;
          const next = { ...prev }; delete next[item.id]; return next;
        });
      }, 2000);
    } catch (e: any) {
      setRowStatus(prev => ({ ...prev, [item.id]: { state: "error", msg: e.message || "Network error" } }));
    }
  }

  // ── render: login screen ─────────────────────────────────────────────
  if (!session) {
    return (
      <div className="fixed inset-0 z-50 bg-slate-50 flex items-center justify-center p-4 overflow-auto" data-testid="kiosk-login">
        <div className="w-full max-w-md bg-white rounded-lg shadow-sm border border-slate-200 p-6 space-y-5">
          <div className="text-center space-y-1">
            <div className="text-xl font-semibold text-slate-900">Inventory Kiosk</div>
            <div className="text-xs text-slate-500">VeritaStock by VeritaAssure</div>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label htmlFor="clia" className="block text-xs font-medium text-slate-700 mb-1">CLIA number</label>
              <input
                id="clia" type="text" autoComplete="off" autoFocus
                value={clia} onChange={(e) => setClia(e.target.value)}
                className="w-full h-11 px-3 border border-slate-300 rounded-md text-base"
                placeholder="00D0000000"
                data-testid="kiosk-clia-input"
                required
              />
            </div>
            <div>
              <label htmlFor="pin" className="block text-xs font-medium text-slate-700 mb-1">6-digit PIN</label>
              <input
                id="pin" type="password" inputMode="numeric" pattern="\d{6}" autoComplete="off"
                value={pin} onChange={(e) => setPin(e.target.value)}
                className="w-full h-11 px-3 border border-slate-300 rounded-md text-base tracking-widest"
                placeholder="------"
                data-testid="kiosk-pin-input"
                required
              />
            </div>
            {loginErr && (
              <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-2" data-testid="kiosk-login-error">
                {loginErr}
              </div>
            )}
            <button
              type="submit" disabled={loginLoading}
              className="w-full h-11 bg-slate-900 text-white rounded-md font-medium disabled:opacity-50"
              data-testid="kiosk-login-submit"
            >
              {loginLoading ? "Signing in..." : "Sign in"}
            </button>
          </form>
          <div className="text-xs text-slate-500 text-center">
            Ask your lab director if you do not know your CLIA or PIN.
          </div>
        </div>
      </div>
    );
  }

  // ── render: signed-in count screen ───────────────────────────────────
  const filtered = (items || []).filter(it => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (it.item_name || "").toLowerCase().includes(q)
      || (it.catalog_number || "").toLowerCase().includes(q)
      || (it.lot_number || "").toLowerCase().includes(q)
      || (it.storage_location || "").toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 overflow-auto" data-testid="kiosk-shell">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-900 truncate" data-testid="kiosk-lab-name">{session.lab.name}</div>
            <div className="text-xs text-slate-500">CLIA {session.lab.clia_number}  ·  Inventory Kiosk</div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text" value={initials} maxLength={4}
              onChange={(e) => setInitials(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              className="h-10 w-24 px-3 border border-slate-300 rounded-md text-base text-center font-semibold"
              placeholder="INIT"
              data-testid="kiosk-initials-input"
              aria-label="Your initials"
            />
            <button
              onClick={() => handleSignOut()}
              className="h-10 px-4 border border-slate-300 rounded-md text-sm font-medium hover:bg-slate-100"
              data-testid="kiosk-signout-button"
            >
              Sign out
            </button>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-4 pb-3 flex items-center gap-2">
          {showList ? (
            <input
              type="search" value={search} onChange={(e) => setSearch(e.target.value)}
              className="flex-1 h-10 px-3 border border-slate-300 rounded-md text-base"
              placeholder="Search item, catalog, lot, location"
              data-testid="kiosk-search-input"
            />
          ) : (
            <div className="flex-1 text-xs text-slate-500">
              Tap <span className="font-medium text-slate-700">Scan to count</span> to scan a barcode and update its on-hand quantity.
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowList(s => !s)}
            className="h-10 px-3 border border-slate-300 rounded-md text-sm font-medium hover:bg-slate-100"
            data-testid="kiosk-toggle-list"
          >
            {showList ? "Hide list" : "Show list"}
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 space-y-3">
        {/* Task #129: scan-first count workflow. The button sits above the list
            (when showList=true) or replaces it (when showList=false). */}
        <button
          type="button"
          onClick={() => setCountWorkflowOpen(true)}
          disabled={!initials || initials.length < 2}
          className="w-full h-20 bg-teal-700 text-white text-lg font-semibold rounded-md disabled:opacity-50"
          data-testid="kiosk-open-count-workflow"
        >
          {initials && initials.length >= 2 ? "Scan to count" : "Type your initials (above) to start"}
        </button>

        {!showList && (
          <div className="text-xs text-slate-500 text-center pt-2">
            Don't have the barcode handy? Tap <span className="font-medium text-slate-700">Show list</span> above to browse items by name.
          </div>
        )}

        {loadErr && showList && (
          <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">{loadErr}</div>
        )}
        {showList && !items && !loadErr && (
          <div className="text-sm text-slate-500">Loading items...</div>
        )}
        {showList && items && items.length === 0 && (
          <div className="text-sm text-slate-500 text-center py-12">No inventory items in this lab yet.</div>
        )}
        {showList && filtered.map(item => {
          const status = rowStatus[item.id];
          const pendingVal = pending[item.id] ?? "";
          return (
            <div key={item.id} className="bg-white border border-slate-200 rounded-md p-3" data-testid={`kiosk-item-row-${item.id}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-slate-900 truncate">{item.item_name}</div>
                  <div className="text-xs text-slate-500">
                    {item.catalog_number || "no catalog"}  ·  Lot {item.lot_number || "n/a"}  ·  {item.storage_location || "no location"}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-500">Current on hand</div>
                  <div className="text-lg font-mono font-semibold" data-testid={`kiosk-item-qty-${item.id}`}>
                    {item.quantity_on_hand} <span className="text-xs font-normal text-slate-500">{item.unit || ""}</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number" inputMode="numeric" min={0} step={1}
                  value={pendingVal}
                  onChange={(e) => setPending(prev => ({ ...prev, [item.id]: e.target.value }))}
                  className="h-10 w-28 px-3 border border-slate-300 rounded-md text-base"
                  placeholder="New qty"
                  data-testid={`kiosk-item-input-${item.id}`}
                  aria-label={`New quantity for ${item.item_name}`}
                />
                <button
                  onClick={() => saveAdjustment(item)}
                  disabled={status?.state === "saving" || !pendingVal}
                  className="h-10 px-4 bg-slate-900 text-white rounded-md text-sm font-medium disabled:opacity-50"
                  data-testid={`kiosk-item-save-${item.id}`}
                >
                  {status?.state === "saving" ? "Saving..." : "Save"}
                </button>
                {status?.state === "saved" && (
                  <span className="text-xs text-emerald-700" data-testid={`kiosk-item-saved-${item.id}`}>Saved</span>
                )}
                {status?.state === "error" && (
                  <span className="text-xs text-rose-700" data-testid={`kiosk-item-error-${item.id}`}>{status.msg}</span>
                )}
              </div>
            </div>
          );
        })}
      </main>

      <footer className="max-w-5xl mx-auto p-4 text-xs text-slate-400 text-center">
        Session auto-signs-out after 15 minutes of inactivity. Hard expiration in 8 hours.
      </footer>

      <InventoryCountWorkflow
        open={countWorkflowOpen}
        onClose={() => {
          setCountWorkflowOpen(false);
          // Refresh the list when the workflow closes so any adjustments are reflected
          if (showList) {
            // re-fetch in background
            fetch("/api/inventory-session/items", { headers: { Authorization: `Bearer ${session.token}` } })
              .then(r => r.ok ? r.json() : null)
              .then(d => { if (d?.items) setItems(d.items); })
              .catch(() => {});
          }
        }}
        authHeaders={() => ({ Authorization: `Bearer ${session.token}` })}
        lookupPath={"/api/inventory-session/items/by-barcode"}
        adjustItemBasePath={"/api/inventory-session/items"}
        extraAdjustBody={{ initials }}
        signerWarning={initials && initials.length >= 2 ? null : "Type your 2-4 character initials in the header before saving."}
        onAdjustComplete={(updated: CountItem) => {
          // Reflect the new qty in the list immediately so the user sees consistency
          setItems(prev => prev?.map(it => it.id === updated.id ? { ...it, quantity_on_hand: updated.quantity_on_hand } : it) || null);
        }}
      />
    </div>
  );
}
