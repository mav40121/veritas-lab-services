// client/src/pages/StaffPortalPage.tsx
//
// 2026-06-08 (task #131). Unauthenticated Staff Portal landing at
// /staff-access. Mirrors the InventoryKioskPage pattern (Wave K4):
// CLIA + 6-digit PIN → synthetic JWT → employee picker → module tiles.
//
// Modules visible to the staff member depend on the two toggles on
// staff_employees:
//   - Policies + Competencies + Quizzes: universal (always shown)
//   - Inventory: shown only if can_adjust_inventory = 1
//   - Audit view: shown only if can_view_audit = 1
//
// 2026-06-09 PR2: added "Take a Quiz" tile. Director assigns quizzes
// from VeritaComp; tech takes assigned quizzes here, self-administered.
//
// Same operational guards as the inventory kiosk:
// - sessionStorage (not localStorage) so a shared tablet doesn't
//   leak a session across browser restarts.
// - 15-minute idle timeout. 8h JWT TTL is the hard ceiling.
// - No NavBar, no chrome, no links out. Kiosk surface.

import { Fragment, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import DOMPurify from "dompurify";
import { clearAuth } from "@/lib/auth";
import { useAuth } from "@/components/AuthContext";

// 2026-06-09 PR2: shared DOMPurify config (mirrors VeritaCompAppPage).
// Lets quiz prompts marked question_format='html' render inline tables,
// strips script/iframe/img/on*= handlers.
const QUIZ_PROMPT_SANITIZER_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "b", "i", "u", "span",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td",
    "ul", "ol", "li", "code", "pre",
  ],
  ALLOWED_ATTR: ["class", "colspan", "rowspan", "scope"],
  ALLOW_DATA_ATTR: false,
};
function renderPrompt(text: string, format: string | null | undefined) {
  if (format === "html") {
    const clean = DOMPurify.sanitize(text || "", QUIZ_PROMPT_SANITIZER_CONFIG);
    return <span dangerouslySetInnerHTML={{ __html: clean }} />;
  }
  return <>{text}</>;
}

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

// 2026-06-09 PR Option 1: STORAGE_KEY, IDLE_TIMEOUT_MS, readSession,
// writeSession, and fullName were used by the retired CLIA+PIN +
// picker flow. The new auth-unification path goes through the regular
// auth_token in localStorage and doesn't need a separate session
// store or idle timer — the main app's auth lifecycle covers both.

export default function StaffPortalPage() {
  // 2026-06-09 PR Option 1: CLIA + PIN + picker are gone. The page now
  // auto-resolves the logged-in user's Staff Portal identity from their
  // regular auth token. Unauth → /login. No staff identity → friendly
  // "not on roster" message.
  const [session, setSession] = useState<StaffPortalSession | null>(null);
  const [activeEmployee, setActiveEmployee] = useState<PortalEmployee | null>(null);
  const [activeModule, setActiveModule] = useState<"policies" | "audit" | "competency" | "quizzes" | null>(null);
  const [bootstrapState, setBootstrapState] = useState<"loading" | "no-roster" | "no-auth" | "ready">("loading");
  const { user: signedInUser } = useAuth();

  useEffect(() => {
    // 2026-06-09 followup fix: the real localStorage key set by the
    // main /login flow is "veritas_token", NOT "auth_token". The earlier
    // wrong-key guess sent every authenticated visitor to /login on
    // mount. The bell in the NavBar uses authHeaders() which reads
    // through the in-memory _token cache populated from the right key,
    // which is why the bell worked but /staff-access redirected.
    const realToken = (() => {
      try { return localStorage.getItem("veritas_token") || ""; } catch { return ""; }
    })();
    if (!realToken) {
      setBootstrapState("no-auth");
      return;
    }
    fetch("/api/me/staff-portal-employee", { headers: { Authorization: `Bearer ${realToken}` } })
      .then(async (r) => {
        if (r.status === 401) {
          setBootstrapState("no-auth");
          return null;
        }
        if (!r.ok) {
          setBootstrapState("no-roster");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data || !data.employee || !data.lab) return;
        setSession({
          token: realToken,
          lab: { id: data.lab.id, name: data.lab.name, clia_number: data.lab.clia_number || "" },
          expires_in_seconds: 8 * 60 * 60,
        });
        setActiveEmployee({
          id: data.employee.id,
          first_name: data.employee.first_name,
          last_name: data.employee.last_name,
          middle_initial: data.employee.middle_initial,
          title: data.employee.title,
          title_code: data.employee.title_code,
          can_adjust_inventory: !!data.employee.can_adjust_inventory,
          can_view_audit: !!data.employee.can_view_audit,
        });
        setBootstrapState("ready");
      })
      .catch(() => setBootstrapState("no-roster"));
  }, []);

  function signOut() {
    // The portal auth-unified onto the regular localStorage token ("veritas_token",
    // read at line ~87). The old code removed "auth_token" — a key that does not
    // exist — so Sign out was a no-op and the session survived on a shared device.
    // clearAuth() removes the real token + user (lib/auth TOKEN_KEY/USER_KEY).
    try { clearAuth(); } catch { /* noop */ }
    window.location.href = "/login";
  }

  // ── Loading state ────────────────────────────────────────────────────
  if (bootstrapState === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // ── Not signed in ────────────────────────────────────────────────────
  if (bootstrapState === "no-auth") {
    if (typeof window !== "undefined") {
      window.location.href = "/login?dest=/staff-access";
    }
    return null;
  }

  // ── Not a staff login ────────────────────────────────────────────────
  // 2026-10-08: an owner, admin or writer who opens /staff-access used to be
  // bound to the first employee on their roster (server identity bug, fixed
  // with this change). Now the server answers 404 for any account that is not
  // a Staff Portal login, and this neutral screen says so instead of showing
  // anyone's name or lab.
  if (bootstrapState === "no-roster" || !session || !activeEmployee) {
    const who = signedInUser?.name || signedInUser?.email || "";
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6" data-testid="staff-portal-not-staff">
        <div className="w-full max-w-sm border border-border rounded-xl bg-card p-6 shadow-sm text-center">
          <div className="font-serif text-xl font-bold mb-2 text-primary">
            VeritaAssure&trade; Staff Portal
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            This page is for staff logins.{who ? ` You are signed in as ${who}, which is not a staff login.` : ""} If you are a staff member, sign out and sign in with the account from your invitation email.
          </p>
          <a
            href="/dashboard"
            className="block w-full text-white font-semibold py-2 rounded-md mb-2"
            style={{ backgroundColor: "#01696F" }}
            data-testid="staff-portal-go-dashboard"
          >
            Go to my dashboard
          </a>
          <button
            onClick={signOut}
            className="w-full font-semibold py-2 rounded-md border border-border"
            data-testid="staff-portal-sign-out"
          >
            Sign out and sign in as staff
          </button>
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
  if (activeModule === "quizzes") {
    return (
      <StaffPortalQuizzesView
        token={session.token}
        employee={activeEmployee}
        labName={session.lab.name}
        onBack={() => setActiveModule(null)}
        onSignOut={signOut}
      />
    );
  }

  // 2026-06-09 Bugfix: techs land on the tile screen with no signal
  // that one tile has pending work. Fetch the three list endpoints once
  // when the tile screen renders and surface "N pending" badges +
  // a banner so a tech who logs in IMMEDIATELY sees the quiz / policy /
  // competency waiting for them. Inventory + Audit are read/write
  // surfaces with no "pending" concept and stay unbadged.
  return (
    <TileScreenWithPendingCounts
      session={session}
      employee={activeEmployee}
      onPick={(m) => setActiveModule(m)}
      onSignOut={signOut}
    />
  );
}

// ── 2026-06-09 Tile screen w/ pending-count badges ────────────────────
function TileScreenWithPendingCounts({
  session, employee, onPick, onSignOut,
}: {
  session: StaffPortalSession;
  employee: PortalEmployee;
  onPick: (m: "policies" | "competency" | "quizzes" | "audit") => void;
  onSignOut: () => void;
}) {
  const [, navigate] = useLocation();
  const [pending, setPending] = useState<{ quizzes: number; policies: number; competencies: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const h = { Authorization: `Bearer ${session.token}` };
    Promise.all([
      fetch(`/api/staff-portal-session/quizzes?employee_id=${employee.id}`, { headers: h })
        .then(async (r) => r.ok ? r.json() : { quizzes: [] }).catch(() => ({ quizzes: [] })),
      fetch(`/api/staff-portal-session/policies?employee_id=${employee.id}`, { headers: h })
        .then(async (r) => r.ok ? r.json() : { policies: [] }).catch(() => ({ policies: [] })),
      fetch(`/api/staff-portal-session/competencies?employee_id=${employee.id}`, { headers: h })
        .then(async (r) => r.ok ? r.json() : { competencies: [] }).catch(() => ({ competencies: [] })),
    ]).then(([q, p, c]) => {
      if (cancelled) return;
      const quizzes = (q.quizzes || []).filter((x: any) => x.status === "assigned").length;
      const policies = (p.policies || []).filter((x: any) => !x.signed).length;
      const competencies = (c.competencies || []).filter((x: any) => !x.signed).length;
      setPending({ quizzes, policies, competencies });
    }).catch(() => {
      if (cancelled) return;
      setPending({ quizzes: 0, policies: 0, competencies: 0 });
    });
    return () => { cancelled = true; };
  }, [employee.id, session.token]);

  // #84 (2026-10-08): this is "My sign-offs" inside the main app, not a separate
  // site. Sign-offs open here; Record QC and inventory open the same VeritaQC and
  // VeritaStock screens the editors use (staff record there since #1540).
  const labHome = `/labs/${session.lab.id}`;
  const tiles: Array<{ key: string; label: string; available: boolean; pending: number | null; go: () => void; hint?: string }> = [
    { key: "policies",   label: "Sign Policies",     available: true, pending: pending?.policies ?? null,     go: () => onPick("policies") },
    { key: "competency", label: "Sign Competencies", available: true, pending: pending?.competencies ?? null, go: () => onPick("competency") },
    { key: "quizzes",    label: "Take a Quiz",        available: true, pending: pending?.quizzes ?? null,      go: () => onPick("quizzes") },
    { key: "qc",         label: "Record QC",          available: true, pending: null, go: () => navigate(`${labHome}/veritaqc-app`), hint: "Opens VeritaQC." },
    { key: "inventory",  label: "Count Inventory",    available: true, pending: null, go: () => navigate(`${labHome}/veritastock`), hint: "Opens VeritaStock." },
    { key: "audit",      label: "My Activity",        available: !!employee.can_view_audit, pending: null, go: () => onPick("audit") },
  ];
  const totalPending = (pending?.quizzes ?? 0) + (pending?.policies ?? 0) + (pending?.competencies ?? 0);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground" data-testid="sp-heading">My sign-offs</div>
            <div className="font-serif text-xl font-bold">{`${employee.first_name}${employee.middle_initial ? ` ${employee.middle_initial}.` : ""} ${employee.last_name}`}</div>
            <div className="text-xs text-muted-foreground">
              {employee.title || "(no title)"} · {session.lab.name}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">
              Sign out
            </button>
          </div>
        </div>

        {/* 2026-06-09 Bugfix: pending banner. Surfaces total open
            items at a glance so a tech can't miss an assigned quiz on
            login. Disappears when caught up. */}
        {totalPending > 0 && (
          <div
            className="mb-4 rounded-lg border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/20 p-3 flex items-center justify-between gap-3"
            data-testid="sp-pending-banner"
          >
            <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              You have {totalPending} item{totalPending === 1 ? "" : "s"} waiting for you
            </div>
            <div className="text-[11px] text-amber-800 dark:text-amber-300">Tap a tile below to start.</div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="sp-tiles">
          {tiles.map((t) => {
            const clickable = t.available;
            const onClick = () => { if (clickable) t.go(); };
            const pendingCount = t.pending;
            const hasPending = pendingCount != null && pendingCount > 0;
            return (
              <button
                key={t.key}
                type="button"
                disabled={!clickable}
                onClick={onClick}
                className={
                  "border rounded-lg p-4 text-left relative " +
                  (hasPending
                    ? "border-amber-400 border-2 bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 cursor-pointer"
                    : clickable
                      ? "border-primary/40 bg-card hover:bg-muted cursor-pointer"
                      : "border-border bg-muted/30 opacity-60 cursor-not-allowed")
                }
                data-testid={`sp-tile-${t.key}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold">{t.label}</div>
                  {hasPending && (
                    <span
                      className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full text-xs font-bold bg-amber-500 text-white"
                      data-testid={`sp-tile-${t.key}-badge`}
                    >
                      {pendingCount}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {!t.available
                    ? "Not enabled for this staff member."
                    : hasPending
                      ? `${pendingCount} pending. Tap to start.`
                      : t.hint || "Tap to begin."}
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
              No approved policies on this lab's VeritaDC&trade; manuals yet. Ask the lab director.
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
  locked?: boolean;
  items?: Array<{
    id: number;
    method_number: number;
    method_group_id: number | null;
    method_group_name: string | null;
    el1_specimen_id: string | null;
    el2_evidence: string | null;
    el2_date: string | null;
    el3_qc_date: string | null;
    el5_sample_type: string | null;
    el5_sample_id: string | null;
    el6_quiz_id: string | null;
    el6_score: number | null;
    el6_date_taken: string | null;
  }>;
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
  // Employee self-edit of the factual DATA on their own unsigned assessment.
  // Keyed by item id -> the editable fields for that element.
  const [editItems, setEditItems] = useState<Record<number, any>>({});
  const [savingData, setSavingData] = useState(false);
  const [dataMsg, setDataMsg] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  function setItemField(itemId: number, field: string, value: string) {
    setEditItems((prev) => ({ ...prev, [itemId]: { ...(prev[itemId] || {}), [field]: value } }));
  }

  async function saveMyData() {
    if (!active || !detail) return;
    setSavingData(true);
    setDataError(null);
    setDataMsg(null);
    try {
      const items = Object.entries(editItems).map(([id, fields]) => ({ id: Number(id), ...(fields as any) }));
      const r = await fetch(`/api/staff-portal-session/competencies/${active.assessment_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ employee_id: employee.id, items }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setDataMsg("Your information was saved. Review, then sign below.");
    } catch (e: any) {
      setDataError(e.message || "Could not save your information");
    } finally {
      setSavingData(false);
    }
  }

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
      .then((d: PortalCompetencyDetail) => {
        setDetail(d);
        // Seed the editable data fields from the current item values.
        const seed: Record<number, any> = {};
        for (const it of (d.items || [])) {
          seed[it.id] = {
            el1SpecimenId: it.el1_specimen_id || "",
            el2Evidence: it.el2_evidence || "",
            el2Date: it.el2_date || "",
            el3QcDate: it.el3_qc_date || "",
            el5SampleType: it.el5_sample_type || "",
            el5SampleId: it.el5_sample_id || "",
            el6QuizId: it.el6_quiz_id || "",
            el6Score: it.el6_score == null ? "" : String(it.el6_score),
            el6DateTaken: it.el6_date_taken || "",
          };
        }
        setEditItems(seed);
      })
      .catch((e: any) => setDetailError(e.message || "Could not load assessment"));
  }

  function closeCompetency() {
    setActive(null);
    setDetail(null);
    setDetailError(null);
    setSignError(null);
    setEditItems({});
    setDataMsg(null);
    setDataError(null);
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

          {detail && detail.competency_type === "technical" && (detail.items?.length ?? 0) > 0 && !detail.locked && !active.signed && !detail.already_acknowledged && (
            <div className="border border-border rounded-lg bg-card p-4 mb-4" data-testid="sp-competency-myinfo">
              <div className="text-sm font-semibold mb-1">Add my information</div>
              <p className="text-xs text-muted-foreground mb-3">
                Fill in the details from your own testing: the specimen you ran, dates, and evidence. Your evaluator sets the observer and the Pass result and gives the final approval.
              </p>
              <div className="space-y-3">
                {(() => {
                  const groups: Record<string, any[]> = {};
                  for (const it of (detail.items || [])) {
                    const key = it.method_group_name || "General";
                    (groups[key] = groups[key] || []).push(it);
                  }
                  const fieldCls = "w-full border border-border rounded p-1.5 text-sm bg-background";
                  return Object.entries(groups).map(([gname, gitems]) => (
                    <div key={gname} className="border border-border/60 rounded-md p-2">
                      <div className="text-xs font-medium mb-2">{gname}</div>
                      <div className="space-y-2">
                        {gitems.sort((a, b) => a.method_number - b.method_number).map((it) => {
                          const v = editItems[it.id] || {};
                          const el = it.method_number;
                          if (el === 1) return (
                            <div key={it.id}><label className="text-[11px] text-muted-foreground">Element 1 · Specimen ID observed</label>
                              <input className={fieldCls} value={v.el1SpecimenId ?? ""} onChange={(e) => setItemField(it.id, "el1SpecimenId", e.target.value)} data-testid="sp-myinfo-el1-specimen" /></div>
                          );
                          if (el === 2) return (
                            <div key={it.id} className="grid grid-cols-2 gap-2">
                              <div><label className="text-[11px] text-muted-foreground">Element 2 · Evidence</label>
                                <input className={fieldCls} value={v.el2Evidence ?? ""} onChange={(e) => setItemField(it.id, "el2Evidence", e.target.value)} /></div>
                              <div><label className="text-[11px] text-muted-foreground">Date</label>
                                <input type="date" className={fieldCls} value={v.el2Date ?? ""} onChange={(e) => setItemField(it.id, "el2Date", e.target.value)} /></div>
                            </div>
                          );
                          if (el === 3) return (
                            <div key={it.id}><label className="text-[11px] text-muted-foreground">Element 3 · Date you ran QC</label>
                              <input type="date" className={fieldCls} value={v.el3QcDate ?? ""} onChange={(e) => setItemField(it.id, "el3QcDate", e.target.value)} /></div>
                          );
                          if (el === 5) return (
                            <div key={it.id} className="grid grid-cols-2 gap-2">
                              <div><label className="text-[11px] text-muted-foreground">Element 5 · Sample type</label>
                                <input className={fieldCls} value={v.el5SampleType ?? ""} onChange={(e) => setItemField(it.id, "el5SampleType", e.target.value)} /></div>
                              <div><label className="text-[11px] text-muted-foreground">Sample ID</label>
                                <input className={fieldCls} value={v.el5SampleId ?? ""} onChange={(e) => setItemField(it.id, "el5SampleId", e.target.value)} /></div>
                            </div>
                          );
                          if (el === 6) return (
                            <div key={it.id} className="grid grid-cols-3 gap-2">
                              <div><label className="text-[11px] text-muted-foreground">Element 6 · Quiz ID</label>
                                <input className={fieldCls} value={v.el6QuizId ?? ""} onChange={(e) => setItemField(it.id, "el6QuizId", e.target.value)} /></div>
                              <div><label className="text-[11px] text-muted-foreground">Score</label>
                                <input className={fieldCls} value={v.el6Score ?? ""} onChange={(e) => setItemField(it.id, "el6Score", e.target.value)} /></div>
                              <div><label className="text-[11px] text-muted-foreground">Date taken</label>
                                <input type="date" className={fieldCls} value={v.el6DateTaken ?? ""} onChange={(e) => setItemField(it.id, "el6DateTaken", e.target.value)} /></div>
                            </div>
                          );
                          return null; // Element 4 (maintenance observation) is the evaluator's.
                        })}
                      </div>
                    </div>
                  ));
                })()}
              </div>
              {dataError && <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2 mt-3">{dataError}</div>}
              {dataMsg && <div className="text-xs text-green-800 bg-green-50 border border-green-200 rounded p-2 mt-3" data-testid="sp-myinfo-saved">{dataMsg}</div>}
              <button type="button" onClick={saveMyData} disabled={savingData} className="mt-3 text-white font-semibold py-2 px-4 rounded-md disabled:opacity-50" style={{ backgroundColor: "#01696F" }} data-testid="sp-myinfo-save">
                {savingData ? "Saving..." : "Save my information"}
              </button>
            </div>
          )}

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

// ── StaffPortalQuizzesView (2026-06-09 PR2) ───────────────────────────
// Inline screen behind sp-tile-quizzes. Three states:
//   1. List: assigned quizzes for the active employee, with status
//      chips (assigned / completed). Completed rows show the score.
//   2. Take: one question at a time, radio per option, Next/Previous,
//      Submit. If the quiz has question_format='html', prompts render
//      through DOMPurify so reaction tables display inline.
//   3. Result: score + pass/fail + per-question review (selected vs
//      correct + explanation), with a Done button back to the list.
//
// Lifecycle: tech logs in via CLIA+PIN -> picks their name -> "Take a
// Quiz" tile -> sees only quizzes the director assigned to them. Submit
// flips the assignment to status='completed' and posts a result row.
interface PortalQuiz {
  assignment_id: number;
  quiz_id: number;
  title: string;
  due_date: string | null;
  status: "assigned" | "completed";
  assigned_at: string;
  completed_at: string | null;
  score: number | null;
  passed: number | null;
}
interface PortalQuizTakePayload {
  assignment_id: number;
  quiz_id: number;
  title: string;
  question_format: string;
  randomize_questions: number;
  status: "assigned" | "completed";
  questions: Array<{ id: string; question: string; type?: string; options: string[] }>;
}
interface PortalQuizResultPayload {
  id: number;
  score: number;
  passed: boolean;
  date_taken: string;
  question_format: string;
  already_completed: boolean;
  questions: Array<{
    id: string;
    question: string;
    options: string[];
    correct_answer: string;
    explanation?: string;
    selected_answer?: string;
    was_correct?: boolean;
  }>;
}

function StaffPortalQuizzesView({
  token, employee, labName, onBack, onSignOut,
}: {
  token: string;
  employee: PortalEmployee;
  labName: string;
  onBack: () => void;
  onSignOut: () => void;
}) {
  const [quizzes, setQuizzes] = useState<PortalQuiz[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [taking, setTaking] = useState<PortalQuizTakePayload | null>(null);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [signature, setSignature] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<PortalQuizResultPayload | null>(null);

  function fetchList() {
    setQuizzes(null);
    setListError(null);
    fetch(`/api/staff-portal-session/quizzes?employee_id=${employee.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setQuizzes(d.quizzes || []))
      .catch((e: any) => setListError(e.message || "Could not load quizzes"));
  }
  useEffect(() => { fetchList(); }, [employee.id]);

  function openQuiz(q: PortalQuiz) {
    setTaking(null);
    setResult(null);
    setCurrentQ(0);
    setAnswers({});
    setSignature(`${employee.first_name}${employee.middle_initial ? ` ${employee.middle_initial}.` : ""} ${employee.last_name}`.trim());
    setSubmitError(null);
    fetch(`/api/staff-portal-session/quizzes/${q.assignment_id}?employee_id=${employee.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        return r.json();
      })
      .then((payload: PortalQuizTakePayload) => setTaking(payload))
      .catch((e: any) => setListError(e.message || "Could not load quiz"));
  }

  async function submitAttempt() {
    if (!taking) return;
    if (!signature.trim()) { setSubmitError("Type your name to sign before submitting."); return; }
    if (taking.questions.some(q => !answers[q.id])) {
      setSubmitError("Answer every question before submitting.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await fetch(`/api/staff-portal-session/quizzes/${taking.assignment_id}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          employee_id: employee.id,
          answers: taking.questions.map(q => ({ question_id: q.id, selected_answer: answers[q.id] })),
          typed_signature: signature.trim(),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setResult(data);
      setTaking(null);
    } catch (e: any) {
      setSubmitError(e.message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  function backToList() {
    setTaking(null);
    setResult(null);
    setAnswers({});
    setCurrentQ(0);
    fetchList();
  }

  // ── Result screen ──────────────────────────────────────────────────
  if (result) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <button onClick={backToList} className="text-xs text-muted-foreground hover:underline" data-testid="sp-quizzes-back-from-result">
              {"<- Back to quizzes"}
            </button>
            <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">
              Sign out
            </button>
          </div>
          <div className={`rounded-lg border p-4 mb-4 ${result.passed ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20" : "border-red-300 bg-red-50 dark:bg-red-950/20"}`}>
            <div className="text-sm font-semibold">
              Score: {result.score}%, {result.passed ? "PASS" : "Not passed"}
            </div>
            {result.already_completed && (
              <div className="text-xs text-muted-foreground mt-1 italic">
                This quiz was already on record; the prior attempt is shown.
              </div>
            )}
          </div>
          <div className="space-y-3">
            {result.questions.map((q, qi) => (
              <div key={q.id} className="border border-border rounded p-3 bg-card">
                <div className="text-xs font-semibold mb-1">Q{qi + 1}: {renderPrompt(q.question, result.question_format)}</div>
                <div className="space-y-0.5 text-xs">
                  {q.options.map((opt) => {
                    const letter = opt.charAt(0);
                    const isSel = q.selected_answer === letter;
                    const isCorrect = q.correct_answer === letter;
                    return (
                      <div key={opt} className={`px-1 py-0.5 rounded ${isSel && isCorrect ? "bg-emerald-100 dark:bg-emerald-900/30" : isSel ? "bg-red-100 dark:bg-red-900/30" : isCorrect ? "bg-emerald-50 dark:bg-emerald-950/20" : ""}`}>
                        {isSel ? "●" : "○"} {opt}
                        {isCorrect && <span className="text-emerald-600 font-semibold ml-1">{"✓"}</span>}
                        {isSel && !isCorrect && <span className="text-red-600 font-semibold ml-1">{"✗"}</span>}
                      </div>
                    );
                  })}
                </div>
                {q.explanation && (
                  <div className="text-[10px] text-muted-foreground italic mt-2">{q.explanation}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Take-quiz screen ───────────────────────────────────────────────
  if (taking) {
    const q = taking.questions[currentQ];
    const allAnswered = taking.questions.every(qq => !!answers[qq.id]);
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setTaking(null)} className="text-xs text-muted-foreground hover:underline" data-testid="sp-quizzes-back-from-take">
              {"<- Cancel"}
            </button>
            <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">
              Sign out
            </button>
          </div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Take a Quiz</div>
          <h2 className="font-serif text-lg font-bold mb-4">{taking.title}</h2>

          <div className="border border-border rounded-lg bg-card p-4 mb-3" data-testid="sp-quiz-question">
            <div className="text-xs text-muted-foreground mb-2">Question {currentQ + 1} of {taking.questions.length}</div>
            <div className="text-sm font-medium mb-3">{renderPrompt(q.question, taking.question_format)}</div>
            <div className="space-y-2">
              {q.options.map((opt) => {
                const letter = opt.charAt(0);
                const checked = answers[q.id] === letter;
                return (
                  <label key={opt} className={`flex items-center gap-2 text-sm cursor-pointer p-2 rounded border ${checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
                    <input
                      type="radio"
                      name={`quiz-${q.id}`}
                      checked={checked}
                      onChange={() => setAnswers(prev => ({ ...prev, [q.id]: letter }))}
                      data-testid={`sp-quiz-option-${letter}`}
                    />
                    {opt}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              disabled={currentQ === 0}
              onClick={() => setCurrentQ(p => p - 1)}
              className="text-xs px-3 py-1.5 border border-border rounded disabled:opacity-40"
              data-testid="sp-quiz-prev"
            >
              {"<- Previous"}
            </button>
            {currentQ < taking.questions.length - 1 ? (
              <button
                type="button"
                disabled={!answers[q.id]}
                onClick={() => setCurrentQ(p => p + 1)}
                className="text-xs px-3 py-1.5 text-white rounded disabled:opacity-40"
                style={{ backgroundColor: "#01696F" }}
                data-testid="sp-quiz-next"
              >
                {"Next ->"}
              </button>
            ) : (
              <span className="text-[11px] text-muted-foreground">
                {allAnswered ? "All answered. Sign and submit below." : "Answer every question to enable Submit."}
              </span>
            )}
          </div>

          {currentQ === taking.questions.length - 1 && (
            <div className="border border-border rounded-lg bg-card p-4 space-y-3">
              <div className="text-xs font-semibold">Sign and submit</div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1" htmlFor="sp-quiz-signature">
                  Type your name to certify you completed this quiz yourself
                </label>
                <input
                  id="sp-quiz-signature"
                  type="text"
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  className="w-full border border-border rounded-md p-2 text-sm bg-background"
                  data-testid="sp-quiz-signature"
                />
              </div>
              {submitError && (
                <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2">
                  {submitError}
                </div>
              )}
              <button
                type="button"
                disabled={submitting || !allAnswered || !signature.trim()}
                onClick={submitAttempt}
                className="w-full text-white font-semibold py-2 rounded-md disabled:opacity-50"
                style={{ backgroundColor: "#01696F" }}
                data-testid="sp-quiz-submit"
              >
                {submitting ? "Scoring..." : "Submit quiz"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── List screen ────────────────────────────────────────────────────
  const pending = (quizzes || []).filter(q => q.status === "assigned");
  const completed = (quizzes || []).filter(q => q.status === "completed");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="text-xs text-muted-foreground hover:underline" data-testid="sp-quizzes-back">
            {"<- Back to tiles"}
          </button>
          <button onClick={onSignOut} className="text-xs text-muted-foreground hover:underline">
            Sign out
          </button>
        </div>
        <div className="mb-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Take a Quiz</div>
          <div className="font-serif text-xl font-bold">{employee.first_name} {employee.last_name}</div>
          <div className="text-xs text-muted-foreground">{labName}</div>
        </div>
        {listError && (
          <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-2 mb-3">
            {listError}
          </div>
        )}
        {quizzes === null ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading quizzes...</div>
        ) : quizzes.length === 0 ? (
          <div className="border border-border rounded-lg bg-card p-6 text-center text-sm text-muted-foreground" data-testid="sp-quizzes-empty">
            No quizzes assigned to you yet. The lab director assigns quizzes from VeritaComp.
          </div>
        ) : (
          <div className="space-y-4">
            {pending.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-2">Pending ({pending.length})</div>
                <div className="space-y-2" data-testid="sp-quizzes-pending">
                  {pending.map((q) => {
                    const overdue = q.due_date && q.due_date < today;
                    return (
                      <button
                        key={q.assignment_id}
                        type="button"
                        onClick={() => openQuiz(q)}
                        className="w-full text-left border border-border rounded-lg bg-card hover:bg-muted/40 p-3 flex items-center justify-between gap-3"
                        data-testid={`sp-quiz-card-${q.assignment_id}`}
                      >
                        <div>
                          <div className="text-sm font-medium">{q.title}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {q.due_date ? `Due ${q.due_date}` : "No due date"}
                            {overdue ? <span className="ml-2 text-red-600 font-semibold">Overdue</span> : null}
                          </div>
                        </div>
                        <span className="text-xs text-teal-700 font-medium">{"Start ->"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {completed.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted-foreground mb-2">Completed ({completed.length})</div>
                <div className="space-y-1.5" data-testid="sp-quizzes-completed">
                  {completed.map((q) => (
                    <div
                      key={q.assignment_id}
                      className="border border-border rounded-lg bg-muted/30 p-3 flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-sm font-medium">{q.title}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {q.completed_at ? `Completed ${q.completed_at.split("T")[0]}` : ""}
                          {q.score != null ? <span className="ml-2">Score: <span className="font-semibold">{q.score}%</span></span> : null}
                        </div>
                      </div>
                      <span className={`text-xs font-semibold ${q.passed ? "text-emerald-700" : "text-amber-700"}`}>
                        {q.passed ? "Passed" : "Recorded"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

