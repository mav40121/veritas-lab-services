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
  const [activeModule, setActiveModule] = useState<"policies" | null>(null);

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

  // ── Module tiles for the picked employee ─────────────────────────────
  // Policies is wired up; competency / inventory / audit show "Ready soon"
  // until their PRs land. Inventory + audit gate on the staff_employees
  // toggle flags so the access model is visible end-to-end.
  const tiles = [
    { key: "policies",    label: "Sign Policies",       available: true,                                ready: true  },
    { key: "competency",  label: "Sign Competencies",   available: true,                                ready: false },
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
          {tiles.map((t) => {
            const clickable = t.available && t.ready;
            const onClick = () => {
              if (!clickable) return;
              if (t.key === "policies") setActiveModule("policies");
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
