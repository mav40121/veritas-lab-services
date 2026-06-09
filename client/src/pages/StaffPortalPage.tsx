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
import InventoryCountWorkflow, { type CountItem } from "@/components/InventoryCountWorkflow";

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
  const [activeModule, setActiveModule] = useState<"policies" | "inventory" | "audit" | "competency" | null>(null);

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

  // ── Inline module screens ────────────────────────────────────────────
  // Policies (sp-tile-policies → real screen as of Wave K5, 2026-06-08).
  // Competency / inventory / audit stay placeholder until their PRs land.
  if (activeModule === "policies") {
    return (
      <StaffPortalPoliciesView
        token={session.token}
        employee={activeEmployee}
        labName={session.lab.name}
        onBack={() => setActiveModule(null)}
        onSignOut={signOut}
      />
    );
  }
  if (activeModule === "inventory") {
    return (
      <StaffPortalInventoryView
        token={session.token}
        employee={activeEmployee}
        labName={session.lab.name}
        onBack={() => setActiveModule(null)}
        onSignOut={signOut}
      />
    );
  }
  if (activeModule === "audit") {
    return (
      <StaffPortalActivityView
        token={session.token}
        employee={activeEmployee}
        labName={session.lab.name}
        onBack={() => setActiveModule(null)}
        onSignOut={signOut}
      />
    );
  }
  if (activeModule === "competency") {
    return (
      <StaffPortalCompetenciesView
        token={session.token}
        employee={activeEmployee}
        labName={session.lab.name}
        onBack={() => setActiveModule(null)}
        onSignOut={signOut}
      />
    );
  }

  // ── Module tiles for the picked employee ─────────────────────────────
  // All four tiles are wired up. Inventory + audit gate on the
  // staff_employees toggle flags. Policies + competency are universal.
  const tiles = [
    { key: "policies",    label: "Sign Policies",       available: true,                                ready: true  },
    { key: "competency",  label: "Sign Competencies",   available: true,                                ready: true  },
    { key: "inventory",   label: "Adjust Inventory",    available: activeEmployee.can_adjust_inventory, ready: true  },
    { key: "audit",       label: "View Audit Trail",    available: activeEmployee.can_view_audit,       ready: true  },
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
          {tiles.map((t) => {
            const clickable = t.available && t.ready;
            const onClick = () => {
              if (!clickable) return;
              if (t.key === "policies") setActiveModule("policies");
              if (t.key === "inventory") setActiveModule("inventory");
              if (t.key === "audit") setActiveModule("audit");
              if (t.key === "competency") setActiveModule("competency");
            };
            return (
              <button
                key={t.key}
                type="button"
                disabled={!clickable}
                onClick={onClick}
                className={
                  "border rounded-lg p-4 text-left " +
                  (clickable
                    ? "border-primary/40 bg-card hover:bg-muted cursor-pointer"
                    : t.available
                      ? "border-border bg-muted/30 cursor-default"
                      : "border-border bg-muted/30 opacity-60 cursor-not-allowed")
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
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── StaffPortalPoliciesView (Wave K5, 2026-06-08) ─────────────────────
// Inline screen behind sp-tile-policies. Two states:
//   1. List: all approved policies for the lab + signed/unsigned chip
//      per row for the active employee.
//   2. Detail: title + rendered policy content (mammoth HTML for docx,
//      <object> for pdf) + typed signature input + Sign button. Sign
//      submits document_id/version_id/content_hash/typed_signature to
//      /api/staff-portal-session/policies/:documentId/sign and rolls
//      back to the list on success with the row showing "Signed".
//
// Surveyor defensibility: typed name + version's file_hash_sha256 +
// IP/UA/timestamp captured server-side. A revision between read and
// sign returns 409 and the staff member is asked to re-read.
interface PortalPolicy {
  document_id: number;
  title: string;
  description: string | null;
  version_id: number;
  version_number: number | null;
  effective_date: string | null;
  next_review_date: string | null;
  signed: boolean;
  signed_at: string | null;
  typed_signature: string | null;
}

interface PortalPolicyRender {
  document_id: number;
  title: string;
  description: string | null;
  effective_date: string | null;
  next_review_date: string | null;
  version_id: number;
  version_number: number | null;
  file_format: "docx" | "pdf" | "html";
  file_hash: string;
}

function StaffPortalPoliciesView({
  token, employee, labName, onBack, onSignOut,
}: {
  token: string;
  employee: PortalEmployee;
  labName: string;
  onBack: () => void;
  onSignOut: () => void;
}) {
  const [policies, setPolicies] = useState<PortalPolicy[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [active, setActive] = useState<PortalPolicy | null>(null);
  const [meta, setMeta] = useState<PortalPolicyRender | null>(null);
  const [renderHtml, setRenderHtml] = useState<string | null>(null);
  const [renderPdfUrl, setRenderPdfUrl] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [typedName, setTypedName] = useState<string>(`${employee.first_name}${employee.middle_initial ? ` ${employee.middle_initial}.` : ""} ${employee.last_name}`.trim());
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  function fetchList() {
    setPolicies(null);
    setListError(null);
    fetch(`/api/staff-portal-session/policies?employee_id=${employee.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setPolicies(d.policies || []))
      .catch((e: any) => setListError(e.message || "Could not load policies"));
  }

  useEffect(() => { fetchList(); }, [employee.id]);

  // Revoke any blob URLs on unmount or when switching policies, so we
  // don't leak PDF object URLs in a long-lived shared-tablet session.
  useEffect(() => {
    return () => {
      if (renderPdfUrl) URL.revokeObjectURL(renderPdfUrl);
    };
  }, [renderPdfUrl]);

  function openPolicy(p: PortalPolicy) {
    setActive(p);
    setMeta(null);
    setRenderHtml(null);
    if (renderPdfUrl) { URL.revokeObjectURL(renderPdfUrl); setRenderPdfUrl(null); }
    setRenderError(null);
    setSignError(null);

    // Fetch metadata first (so we know file_format for routing)
    fetch(`/api/staff-portal-session/policies/${p.document_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((m: PortalPolicyRender) => {
        setMeta(m);
        // Now fetch the render. For pdf the server sends the binary;
        // for docx/html the server returns { format: "html", html }.
        return fetch(`/api/staff-portal-session/policies/${p.document_id}/render`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      })
      .then(async (r) => {
        if (!r) throw new Error("Render request lost");
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Render HTTP ${r.status}`);
        const ct = r.headers.get("content-type") || "";
        if (ct.startsWith("application/pdf")) {
          const blob = await r.blob();
          setRenderPdfUrl(URL.createObjectURL(blob));
        } else {
          const d = await r.json();
          setRenderHtml(typeof d.html === "string" ? d.html : "");
        }
      })
      .catch((e: any) => setRenderError(e.message || "Could not load policy content"));
  }

  function closePolicy() {
    setActive(null);
    setMeta(null);
    setRenderHtml(null);
    if (renderPdfUrl) { URL.revokeObjectURL(renderPdfUrl); setRenderPdfUrl(null); }
    setRenderError(null);
    setSignError(null);
  }

  async function submitSignature() {
    if (!active || !meta) return;
    if (typedName.trim().length < 2) {
      setSignError("Type your full name to sign.");
      return;
    }
    setSigning(true);
    setSignError(null);
    try {
      const r = await fetch(`/api/staff-portal-session/policies/${active.document_id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          employee_id: employee.id,
          version_id: meta.version_id,
          content_hash: meta.file_hash,
          typed_signature: typedName.trim(),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      // Update list cache and return to list view
      setPolicies((prev) => prev?.map((row) => row.document_id === active.document_id
        ? { ...row, signed: true, signed_at: data.signed_at, typed_signature: typedName.trim() }
        : row
      ) ?? prev);
      closePolicy();
    } catch (e: any) {
      setSignError(e.message || "Signature failed");
    } finally {
      setSigning(false);
    }
  }

  // ── Detail screen ─────────────────────────────────────────────────
  if (active) {
    return (
      <div className="min-h-screen bg-background p-6" data-testid="sp-policies-detail">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <button onClick={closePolicy} className="text-xs text-muted-foreground hover:underline" data-testid="sp-policies-back-to-list">
              &larr; Back to policies
            </button>
            <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">
              Sign out
            </button>
          </div>
          <div className="border border-border rounded-lg bg-card p-4 mb-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{labName} &middot; Policy</div>
            <div className="font-serif text-xl font-bold" data-testid="sp-policies-detail-title">{active.title}</div>
            {active.description && (
              <div className="text-sm text-muted-foreground mt-1">{active.description}</div>
            )}
            <div className="text-xs text-muted-foreground mt-2">
              {meta?.version_number != null && <>Version {meta.version_number}{" "}</>}
              {meta?.effective_date && <>&middot; Effective {meta.effective_date}{" "}</>}
              {meta?.next_review_date && <>&middot; Review due {meta.next_review_date}</>}
            </div>
          </div>

          <div className="border border-border rounded-lg bg-card p-4 mb-4 min-h-[300px]">
            {renderError && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2">
                {renderError}
              </div>
            )}
            {!renderError && !meta && (
              <div className="text-sm text-muted-foreground py-12 text-center">Loading policy...</div>
            )}
            {!renderError && meta && renderHtml === null && renderPdfUrl === null && (
              <div className="text-sm text-muted-foreground py-12 text-center">Loading policy content...</div>
            )}
            {renderHtml !== null && (
              <div
                className="prose prose-sm max-w-none"
                data-testid="sp-policies-detail-html"
                dangerouslySetInnerHTML={{ __html: renderHtml }}
              />
            )}
            {renderPdfUrl !== null && (
              <object
                data={renderPdfUrl}
                type="application/pdf"
                className="w-full"
                style={{ height: "70vh" }}
                data-testid="sp-policies-detail-pdf"
              >
                <a href={renderPdfUrl} target="_blank" rel="noreferrer">Open policy PDF</a>
              </object>
            )}
          </div>

          {active.signed ? (
            <div className="border border-green-200 bg-green-50 rounded-lg p-4" data-testid="sp-policies-already-signed">
              <div className="text-sm font-medium text-green-900">
                You already signed this version
                {active.signed_at && <> on {new Date(active.signed_at).toLocaleString()}</>}.
              </div>
              {active.typed_signature && (
                <div className="text-xs text-green-800 mt-1">Signature on file: {active.typed_signature}</div>
              )}
            </div>
          ) : (
            <div className="border border-border rounded-lg bg-card p-4" data-testid="sp-policies-sign-block">
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1" htmlFor="sp-policy-typed-name">
                Type your full name to sign
              </label>
              <input
                id="sp-policy-typed-name"
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                className="w-full border border-border rounded-md p-2 text-sm bg-background mb-3"
                data-testid="sp-policies-typed-name"
              />
              {signError && (
                <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2 mb-3">
                  {signError}
                </div>
              )}
              <button
                type="button"
                onClick={submitSignature}
                disabled={signing || !meta}
                className="w-full text-white font-semibold py-2 rounded-md disabled:opacity-50"
                style={{ backgroundColor: "#01696F" }}
                data-testid="sp-policies-sign-submit"
              >
                {signing ? "Signing..." : "I have read this policy. Sign."}
              </button>
              <p className="text-xs text-muted-foreground mt-2">
                Your typed name, IP address, and the policy's content hash are recorded as your acknowledgement. Signatures are surveyor-defensible per 42 CFR §493.1251.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List screen ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background p-6" data-testid="sp-policies-list">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Sign Policies</div>
            <div className="font-serif text-xl font-bold">{labName}</div>
            <div className="text-xs text-muted-foreground">Signing as {employee.first_name} {employee.last_name}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button onClick={onBack} className="text-xs text-muted-foreground hover:underline" data-testid="sp-policies-back">
              &larr; Back to modules
            </button>
            <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">
              Sign out
            </button>
          </div>
        </div>

        <div className="border border-border rounded-lg bg-card p-4">
          {listError && (
            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2 mb-3">
              {listError}
            </div>
          )}
          {policies === null ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Loading approved policies...</div>
          ) : policies.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No approved policies on this lab's VeritaPolicy&trade; manuals yet. Ask the lab director.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {policies.map((p) => (
                <button
                  key={p.document_id}
                  type="button"
                  onClick={() => openPolicy(p)}
                  className="w-full text-left py-3 px-2 hover:bg-muted flex items-center justify-between gap-3"
                  data-testid="sp-policies-row"
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium" data-testid="sp-policies-row-title">{p.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.version_number != null && <>Version {p.version_number}{" "}</>}
                      {p.effective_date && <>&middot; Effective {p.effective_date}</>}
                    </div>
                  </div>
                  {p.signed ? (
                    <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-900" data-testid="sp-policies-row-signed">
                      Signed
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-900" data-testid="sp-policies-row-unsigned">
                      Needs your signature
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── StaffPortalInventoryView (Wave K6, 2026-06-08) ────────────────────
// Inline screen behind sp-tile-inventory. Two states:
//   1. List: all inventory items for the lab, with search box. Tapping
//      a row opens the adjust panel.
//   2. Adjust: shows current qty, lets the staff member enter a new
//      qty + optional reason, posts to
//      /api/staff-portal-session/inventory/items/:id/adjust with the
//      active employee_id. Server records the staff_employee_id and
//      employee name in the audit log — better surveyor trail than
//      typed initials.
//
// can_adjust_inventory toggle gates this entire view: the tile won't
// even appear unless the director enabled it. Server double-checks
// (returns 403 if the flag is off).
interface PortalInventoryItem {
  id: number;
  item_name: string;
  catalog_number: string | null;
  lot_number: string | null;
  department: string | null;
  category: string | null;
  quantity_on_hand: number; // usage_unit total stored server-side
  unit: string | null;
  storage_location: string | null;
  barcode_value: string | null;
  expiration_date: string | null;
  // 2026-06-09 count-unit view (set by decorateKioskItem server-side)
  count_unit?: string;
  usage_unit?: string;
  units_per_count_unit?: number;
  count_on_hand?: number;
}

function StaffPortalInventoryView({
  token, employee, labName, onBack, onSignOut,
}: {
  token: string;
  employee: PortalEmployee;
  labName: string;
  onBack: () => void;
  onSignOut: () => void;
}) {
  const [items, setItems] = useState<PortalInventoryItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [active, setActive] = useState<PortalInventoryItem | null>(null);
  const [search, setSearch] = useState("");
  const [newQty, setNewQty] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<{ itemId: number; delta: number } | null>(null);
  // Task #129: scan-first count workflow
  const [showList, setShowList] = useState(false);
  const [countWorkflowOpen, setCountWorkflowOpen] = useState(false);

  function fetchList() {
    setItems(null);
    setListError(null);
    fetch(`/api/staff-portal-session/inventory/items`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setItems(d.items || []))
      .catch((e: any) => setListError(e.message || "Could not load inventory"));
  }

  useEffect(() => { fetchList(); }, [employee.id]);

  function openItem(it: PortalInventoryItem) {
    setActive(it);
    // Prefill with the count-unit view so the staff member is editing
    // "how many boxes" not "how many tests" by default. Falls back to
    // raw qty when the item is at the each level (pack_size = 1).
    setNewQty(String(it.count_on_hand ?? it.quantity_on_hand));
    setReason("");
    setAdjustError(null);
  }

  function closeItem() {
    setActive(null);
    setNewQty("");
    setReason("");
    setAdjustError(null);
  }

  async function submitAdjust() {
    if (!active) return;
    const parsed = Number(newQty);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      setAdjustError("Enter a whole number, 0 or greater.");
      return;
    }
    setAdjusting(true);
    setAdjustError(null);
    try {
      // Send new_count (in count_unit) so the server multiplies by
      // pack_size to derive the usage_unit total. Falls back to
      // new_quantity for items at the each level (pack_size = 1) so the
      // legacy direct path keeps working.
      const isCountUnit = (active.units_per_count_unit ?? 1) > 1 && active.count_unit && active.count_unit !== active.usage_unit;
      const payload: any = {
        employee_id: employee.id,
        reason: reason.trim() || null,
      };
      if (isCountUnit) payload.new_count = parsed;
      else payload.new_quantity = parsed;
      const r = await fetch(`/api/staff-portal-session/inventory/items/${active.id}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      const updated: PortalInventoryItem = data.item;
      setItems((prev) => prev?.map((row) => row.id === updated.id ? updated : row) ?? prev);
      setSavedFlash({ itemId: updated.id, delta: data.adjustment?.delta ?? 0 });
      window.setTimeout(() => setSavedFlash((cur) => (cur?.itemId === updated.id ? null : cur)), 4000);
      closeItem();
    } catch (e: any) {
      setAdjustError(e.message || "Adjustment failed");
    } finally {
      setAdjusting(false);
    }
  }

  const visible = items
    ? items.filter((it) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return [it.item_name, it.catalog_number, it.lot_number, it.barcode_value, it.storage_location]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
    : null;

  // ── Adjust panel ─────────────────────────────────────────────────
  if (active) {
    return (
      <div className="min-h-screen bg-background p-6" data-testid="sp-inventory-adjust">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between mb-4">
            <button onClick={closeItem} className="text-xs text-muted-foreground hover:underline" data-testid="sp-inventory-back-to-list">
              &larr; Back to inventory
            </button>
            <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">
              Sign out
            </button>
          </div>
          <div className="border border-border rounded-lg bg-card p-4 mb-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{labName} &middot; Item</div>
            <div className="font-serif text-xl font-bold" data-testid="sp-inventory-detail-name">{active.item_name}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {active.catalog_number && <>Catalog {active.catalog_number}</>}
              {active.lot_number && <> &middot; Lot {active.lot_number}</>}
              {active.storage_location && <> &middot; {active.storage_location}</>}
            </div>
            {(() => {
              const pack = active.units_per_count_unit ?? 1;
              const countUnit = active.count_unit || active.usage_unit || active.unit || "each";
              const usageUnit = active.usage_unit || active.unit || "each";
              const hasPack = pack > 1 && countUnit !== usageUnit;
              return (
                <div className="text-xs text-muted-foreground mt-1">
                  On hand: <span className="font-mono font-semibold">{active.count_on_hand ?? active.quantity_on_hand}</span>
                  {" "}{countUnit}{(active.count_on_hand ?? active.quantity_on_hand) === 1 ? "" : "s"}
                  {hasPack && <span className="ml-1">({active.quantity_on_hand} {usageUnit}s)</span>}
                </div>
              );
            })()}
          </div>

          <div className="border border-border rounded-lg bg-card p-4">
            {(() => {
              const pack = active.units_per_count_unit ?? 1;
              const countUnit = active.count_unit || active.usage_unit || active.unit || "each";
              const usageUnit = active.usage_unit || active.unit || "each";
              const hasPack = pack > 1 && countUnit !== usageUnit;
              const previewQty = Number(newQty);
              const showPreview = hasPack && Number.isFinite(previewQty) && previewQty >= 0 && Number.isInteger(previewQty);
              return (
                <>
                  <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1" htmlFor="sp-inventory-new-qty">
                    New count ({countUnit}s)
                  </label>
                  <input
                    id="sp-inventory-new-qty"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={newQty}
                    onChange={(e) => setNewQty(e.target.value)}
                    className="w-full border border-border rounded-md p-2 text-lg font-mono text-center bg-background mb-1"
                    data-testid="sp-inventory-new-qty"
                  />
                  {showPreview ? (
                    <div className="text-xs text-muted-foreground mb-3 text-center" data-testid="sp-inventory-new-qty-preview">
                      = {previewQty * pack} {usageUnit}s (pack of {pack})
                    </div>
                  ) : <div className="mb-2" />}
                </>
              );
            })()}
            <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1" htmlFor="sp-inventory-reason">
              Reason (optional)
            </label>
            <input
              id="sp-inventory-reason"
              type="text"
              placeholder="Received shipment / used in run / damaged / ..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full border border-border rounded-md p-2 text-sm bg-background mb-3"
              data-testid="sp-inventory-reason"
            />
            {adjustError && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2 mb-3">
                {adjustError}
              </div>
            )}
            <button
              type="button"
              onClick={submitAdjust}
              disabled={adjusting}
              className="w-full text-white font-semibold py-2 rounded-md disabled:opacity-50"
              style={{ backgroundColor: "#01696F" }}
              data-testid="sp-inventory-save"
            >
              {adjusting ? "Saving..." : "Save adjustment"}
            </button>
            <p className="text-xs text-muted-foreground mt-2">
              Your name, the before / after quantities, and the reason are recorded in the audit trail.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── List screen ───────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background p-6" data-testid="sp-inventory-list">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Adjust Inventory</div>
            <div className="font-serif text-xl font-bold">{labName}</div>
            <div className="text-xs text-muted-foreground">Acting as {employee.first_name} {employee.last_name}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button onClick={onBack} className="text-xs text-muted-foreground hover:underline" data-testid="sp-inventory-back">
              &larr; Back to modules
            </button>
            <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">
              Sign out
            </button>
          </div>
        </div>

        {/* Task #129: scan-first count workflow */}
        <button
          type="button"
          onClick={() => setCountWorkflowOpen(true)}
          className="w-full text-white font-semibold py-3 rounded-md mb-3"
          style={{ backgroundColor: "#01696F" }}
          data-testid="sp-inventory-open-count-workflow"
        >
          Scan to count
        </button>

        <div className="mb-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowList(s => !s)}
            className="text-xs px-3 py-1 rounded border border-border bg-card text-muted-foreground"
            data-testid="sp-inventory-toggle-list"
          >
            {showList ? "Hide list" : "Show item list"}
          </button>
          {showList && (
            <input
              type="text"
              placeholder="Search item name, catalog, lot, location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 border border-border rounded-md p-2 text-sm bg-background"
              data-testid="sp-inventory-search"
            />
          )}
        </div>

        {!showList && (
          <div className="border border-border rounded-lg bg-card p-4 text-xs text-muted-foreground text-center">
            Tap <span className="font-medium">Scan to count</span> above to scan a barcode. Don't have the barcode handy? Tap <span className="font-medium">Show item list</span> to browse.
          </div>
        )}

        {showList && <div className="border border-border rounded-lg bg-card p-4">
          {listError && (
            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2 mb-3">
              {listError}
            </div>
          )}
          {visible === null ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Loading inventory...</div>
          ) : visible.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              {items && items.length === 0
                ? <>No inventory items on this lab yet. Ask the lab director.</>
                : <>No items match "{search}".</>}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visible.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => openItem(it)}
                  className="w-full text-left py-3 px-2 hover:bg-muted flex items-center justify-between gap-3"
                  data-testid="sp-inventory-row"
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium" data-testid="sp-inventory-row-name">{it.item_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {it.catalog_number && <>Catalog {it.catalog_number}{" "}</>}
                      {it.lot_number && <>&middot; Lot {it.lot_number}{" "}</>}
                      {it.storage_location && <>&middot; {it.storage_location}</>}
                    </div>
                    {savedFlash?.itemId === it.id && (
                      <div className="text-xs text-emerald-700 mt-1" data-testid="sp-inventory-row-saved">
                        Saved {savedFlash.delta >= 0 ? "+" : ""}{savedFlash.delta} {it.unit || ""}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    {(() => {
                      const pack = it.units_per_count_unit ?? 1;
                      const countUnit = it.count_unit || it.usage_unit || it.unit || "each";
                      const usageUnit = it.usage_unit || it.unit || "each";
                      const hasPack = pack > 1 && countUnit !== usageUnit;
                      const displayQty = it.count_on_hand ?? it.quantity_on_hand;
                      return (
                        <>
                          <div className="text-base font-mono font-semibold" data-testid="sp-inventory-row-qty">
                            {displayQty}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {countUnit}{displayQty === 1 ? "" : "s"}
                          </div>
                          {hasPack && (
                            <div className="text-[10px] text-muted-foreground">
                              ({it.quantity_on_hand} {usageUnit}s)
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>}

        <InventoryCountWorkflow
          open={countWorkflowOpen}
          onClose={() => {
            setCountWorkflowOpen(false);
            // Refresh the list so any saved adjustments reflect
            fetch(`/api/staff-portal-session/inventory/items`, {
              headers: { Authorization: `Bearer ${token}` },
            })
              .then(r => r.ok ? r.json() : null)
              .then(d => { if (d?.items) setItems(d.items); })
              .catch(() => {});
          }}
          authHeaders={() => ({ Authorization: `Bearer ${token}` })}
          lookupPath={"/api/staff-portal-session/inventory/items/by-barcode"}
          adjustItemBasePath={"/api/staff-portal-session/inventory/items"}
          extraAdjustBody={{ employee_id: employee.id }}
          signerWarning={null}
          onAdjustComplete={(updated: CountItem) => {
            setItems(prev => prev?.map(it => it.id === updated.id ? { ...it, ...updated } as any : it) ?? prev);
          }}
        />
      </div>
    </div>
  );
}

// ── StaffPortalActivityView (Wave K7, 2026-06-08) ─────────────────────
// Self-scoped audit trail behind sp-tile-audit. Shows the active staff
// member their own history: policy signatures + inventory adjustments,
// time-ordered (newest first). Read-only. Server gates on
// can_view_audit = 1, so the toggle is enforced even if the client UI
// is bypassed.
//
// Surveyor utility: a tech can show this screen to a surveyor as
// evidence of their personal compliance footprint with timestamps,
// document titles, and before/after qty deltas. Same audit data the
// director sees in VeritaTrack, scoped to the active employee.
interface PortalActivityEvent {
  kind: "policy_signature" | "inventory_adjustment";
  at: string;
  label: string;
  detail: string;
  document_id?: number;
  item_id?: string;
}

function StaffPortalActivityView({
  token, employee, labName, onBack, onSignOut,
}: {
  token: string;
  employee: PortalEmployee;
  labName: string;
  onBack: () => void;
  onSignOut: () => void;
}) {
  const [events, setEvents] = useState<PortalActivityEvent[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<"all" | "policy_signature" | "inventory_adjustment">("all");

  useEffect(() => {
    setEvents(null);
    setListError(null);
    fetch(`/api/staff-portal-session/my-activity?employee_id=${employee.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setEvents(d.events || []))
      .catch((e: any) => setListError(e.message || "Could not load activity"));
  }, [employee.id]);

  const visible = events
    ? (kindFilter === "all" ? events : events.filter((e) => e.kind === kindFilter))
    : null;

  return (
    <div className="min-h-screen bg-background p-6" data-testid="sp-activity-list">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">View Audit Trail</div>
            <div className="font-serif text-xl font-bold">My Activity</div>
            <div className="text-xs text-muted-foreground">{employee.first_name} {employee.last_name} &middot; {labName}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button onClick={onBack} className="text-xs text-muted-foreground hover:underline" data-testid="sp-activity-back">
              &larr; Back to modules
            </button>
            <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">
              Sign out
            </button>
          </div>
        </div>

        <div className="mb-3 flex gap-2" data-testid="sp-activity-filter">
          <button
            type="button"
            onClick={() => setKindFilter("all")}
            className={"text-xs px-3 py-1 rounded border " + (kindFilter === "all" ? "bg-primary text-white border-primary" : "border-border bg-card")}
            data-testid="sp-activity-filter-all"
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setKindFilter("policy_signature")}
            className={"text-xs px-3 py-1 rounded border " + (kindFilter === "policy_signature" ? "bg-primary text-white border-primary" : "border-border bg-card")}
            data-testid="sp-activity-filter-policies"
          >
            Policy signatures
          </button>
          <button
            type="button"
            onClick={() => setKindFilter("inventory_adjustment")}
            className={"text-xs px-3 py-1 rounded border " + (kindFilter === "inventory_adjustment" ? "bg-primary text-white border-primary" : "border-border bg-card")}
            data-testid="sp-activity-filter-inventory"
          >
            Inventory adjustments
          </button>
        </div>

        <div className="border border-border rounded-lg bg-card p-4">
          {listError && (
            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2 mb-3">
              {listError}
            </div>
          )}
          {visible === null ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Loading activity...</div>
          ) : visible.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center" data-testid="sp-activity-empty">
              {events && events.length === 0
                ? "No recorded activity yet. Sign a policy or make an inventory adjustment to start building your history."
                : "No events match the current filter."}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visible.map((e, idx) => (
                <div key={`${e.kind}-${e.at}-${idx}`} className="py-3 px-2" data-testid="sp-activity-row">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="text-sm font-medium">{e.label}</div>
                      {e.detail && <div className="text-xs text-muted-foreground mt-0.5">{e.detail}</div>}
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={
                          "text-xs px-2 py-1 rounded " +
                          (e.kind === "policy_signature"
                            ? "bg-blue-100 text-blue-900"
                            : "bg-amber-100 text-amber-900")
                        }
                        data-testid={`sp-activity-kind-${e.kind}`}
                      >
                        {e.kind === "policy_signature" ? "Policy" : "Inventory"}
                      </span>
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(e.at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── StaffPortalCompetenciesView (Wave K8, 2026-06-08) ─────────────────
// Inline screen behind sp-tile-competency. Pending VeritaComp
// assessments for the active staff member (resolved via the
// competency_employees.staff_employee_id bridge column). Tapping a
// row opens the detail with the evaluator's verdict + remediation
// plan, then a typed signature input acknowledges the assessment.
// On sign, employee_acknowledged flips to 1 on competency_assessments
// AND a row lands in staff_portal_competency_signoffs for non-
// repudiation receipts.
interface PortalCompetency {
  assessment_id: number;
  program_id: number;
  program_name: string;
  department: string | null;
  assessment_type: string;
  assessment_date: string;
  evaluator_name: string | null;
  evaluator_title: string | null;
  competency_type: string;
  status: string;
  signed: boolean;
  signed_at: string | null;
  typed_signature: string | null;
}

interface PortalCompetencyDetail {
  assessment_id: number;
  program_id: number;
  program_name: string;
  department: string | null;
  assessment_type: string;
  assessment_date: string;
  evaluator_name: string | null;
  evaluator_title: string | null;
  evaluator_initials: string | null;
  competency_type: string;
  status: string;
  remediation_plan: string | null;
  content_hash: string;
  already_acknowledged: boolean;
}

function StaffPortalCompetenciesView({
  token, employee, labName, onBack, onSignOut,
}: {
  token: string;
  employee: PortalEmployee;
  labName: string;
  onBack: () => void;
  onSignOut: () => void;
}) {
  const [list, setList] = useState<PortalCompetency[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<string>("ok");
  const [active, setActive] = useState<PortalCompetency | null>(null);
  const [detail, setDetail] = useState<PortalCompetencyDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [typedName, setTypedName] = useState<string>(`${employee.first_name}${employee.middle_initial ? ` ${employee.middle_initial}.` : ""} ${employee.last_name}`.trim());
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  function fetchList() {
    setList(null);
    setListError(null);
    fetch(`/api/staff-portal-session/competencies?employee_id=${employee.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setList(d.competencies || []);
        setBridgeStatus(d.bridge_status || "ok");
      })
      .catch((e: any) => setListError(e.message || "Could not load competencies"));
  }

  useEffect(() => { fetchList(); }, [employee.id]);

  function openCompetency(c: PortalCompetency) {
    setActive(c);
    setDetail(null);
    setDetailError(null);
    setSignError(null);
    fetch(`/api/staff-portal-session/competencies/${c.assessment_id}?employee_id=${employee.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d: PortalCompetencyDetail) => setDetail(d))
      .catch((e: any) => setDetailError(e.message || "Could not load assessment"));
  }

  function closeCompetency() {
    setActive(null);
    setDetail(null);
    setDetailError(null);
    setSignError(null);
  }

  async function submitSignature() {
    if (!active || !detail) return;
    if (typedName.trim().length < 2) {
      setSignError("Type your full name to acknowledge.");
      return;
    }
    setSigning(true);
    setSignError(null);
    try {
      const r = await fetch(`/api/staff-portal-session/competencies/${active.assessment_id}/sign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          employee_id: employee.id,
          content_hash: detail.content_hash,
          typed_signature: typedName.trim(),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setList((prev) => prev?.map((row) => row.assessment_id === active.assessment_id
        ? { ...row, signed: true, signed_at: data.signed_at, typed_signature: typedName.trim() }
        : row
      ) ?? prev);
      closeCompetency();
    } catch (e: any) {
      setSignError(e.message || "Signature failed");
    } finally {
      setSigning(false);
    }
  }

  function statusChip(s: string) {
    const colour = s === "pass"
      ? "bg-green-100 text-green-900"
      : s === "fail"
        ? "bg-rose-100 text-rose-900"
        : "bg-amber-100 text-amber-900";
    return <span className={`text-xs px-2 py-0.5 rounded ${colour}`}>{s.toUpperCase()}</span>;
  }

  // ── Detail screen ────────────────────────────────────────────────
  if (active) {
    return (
      <div className="min-h-screen bg-background p-6" data-testid="sp-competency-detail">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <button onClick={closeCompetency} className="text-xs text-muted-foreground hover:underline" data-testid="sp-competency-back-to-list">
              &larr; Back to competencies
            </button>
            <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">
              Sign out
            </button>
          </div>
          <div className="border border-border rounded-lg bg-card p-4 mb-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{labName} &middot; Competency</div>
            <div className="font-serif text-xl font-bold" data-testid="sp-competency-detail-title">{active.program_name}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {active.assessment_type} &middot; {active.assessment_date}
              {active.department && <> &middot; {active.department}</>}
            </div>
            <div className="mt-2">{statusChip(active.status)}</div>
          </div>

          <div className="border border-border rounded-lg bg-card p-4 mb-4">
            {detailError && (
              <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2">
                {detailError}
              </div>
            )}
            {!detailError && !detail && (
              <div className="text-sm text-muted-foreground py-6 text-center">Loading assessment...</div>
            )}
            {detail && (
              <div className="space-y-2 text-sm">
                <div><span className="font-medium">Type:</span> {detail.competency_type}</div>
                <div><span className="font-medium">Date:</span> {detail.assessment_date}</div>
                {detail.evaluator_name && (
                  <div>
                    <span className="font-medium">Evaluator:</span> {detail.evaluator_name}
                    {detail.evaluator_title && <> ({detail.evaluator_title})</>}
                    {detail.evaluator_initials && <> &middot; initials: {detail.evaluator_initials}</>}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="font-medium">Verdict:</span> {statusChip(detail.status)}
                </div>
                {detail.remediation_plan && (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded">
                    <div className="text-xs font-semibold text-amber-900 mb-1">Remediation plan</div>
                    <div className="text-sm text-amber-900 whitespace-pre-wrap">{detail.remediation_plan}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {active.signed || detail?.already_acknowledged ? (
            <div className="border border-green-200 bg-green-50 rounded-lg p-4" data-testid="sp-competency-already-signed">
              <div className="text-sm font-medium text-green-900">
                You already acknowledged this assessment
                {active.signed_at && <> on {new Date(active.signed_at).toLocaleString()}</>}.
              </div>
              {active.typed_signature && (
                <div className="text-xs text-green-800 mt-1">Signature on file: {active.typed_signature}</div>
              )}
            </div>
          ) : (
            <div className="border border-border rounded-lg bg-card p-4" data-testid="sp-competency-sign-block">
              <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1" htmlFor="sp-competency-typed-name">
                Type your full name to acknowledge
              </label>
              <input
                id="sp-competency-typed-name"
                type="text"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                className="w-full border border-border rounded-md p-2 text-sm bg-background mb-3"
                data-testid="sp-competency-typed-name"
              />
              {signError && (
                <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2 mb-3">
                  {signError}
                </div>
              )}
              <button
                type="button"
                onClick={submitSignature}
                disabled={signing || !detail}
                className="w-full text-white font-semibold py-2 rounded-md disabled:opacity-50"
                style={{ backgroundColor: "#01696F" }}
                data-testid="sp-competency-sign-submit"
              >
                {signing ? "Signing..." : "I acknowledge this assessment. Sign."}
              </button>
              <p className="text-xs text-muted-foreground mt-2">
                Your typed name, the assessment content hash, IP address, and timestamp are recorded for the surveyor trail per 42 CFR §493.1235.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List screen ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background p-6" data-testid="sp-competency-list">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Sign Competencies</div>
            <div className="font-serif text-xl font-bold">{labName}</div>
            <div className="text-xs text-muted-foreground">Acknowledging as {employee.first_name} {employee.last_name}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button onClick={onBack} className="text-xs text-muted-foreground hover:underline" data-testid="sp-competency-back">
              &larr; Back to modules
            </button>
            <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">
              Sign out
            </button>
          </div>
        </div>

        <div className="border border-border rounded-lg bg-card p-4">
          {listError && (
            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2 mb-3">
              {listError}
            </div>
          )}
          {list === null ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Loading assessments...</div>
          ) : list.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center" data-testid="sp-competency-empty">
              {bridgeStatus === "no_competency_record"
                ? "No VeritaComp™ record bridges to this staff entry yet. Ask the lab director to add a competency assessment for you."
                : "No competency assessments on file. New ones will appear here when your evaluator scores them."}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {list.map((c) => (
                <button
                  key={c.assessment_id}
                  type="button"
                  onClick={() => openCompetency(c)}
                  className="w-full text-left py-3 px-2 hover:bg-muted flex items-center justify-between gap-3"
                  data-testid="sp-competency-row"
                >
                  <div className="flex-1">
                    <div className="text-sm font-medium" data-testid="sp-competency-row-title">{c.program_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.assessment_type} &middot; {c.assessment_date}
                      {c.evaluator_name && <> &middot; {c.evaluator_name}</>}
                    </div>
                    <div className="mt-1">{statusChip(c.status)}</div>
                  </div>
                  {c.signed ? (
                    <span className="text-xs px-2 py-1 rounded bg-green-100 text-green-900" data-testid="sp-competency-row-signed">
                      Signed
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-900" data-testid="sp-competency-row-unsigned">
                      Needs your acknowledgement
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

