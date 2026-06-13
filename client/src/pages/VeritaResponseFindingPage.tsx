import { useState, useEffect } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useMemberships, allowedAccreditorsForMembership } from "@/hooks/useMemberships";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  Info,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";
import { useLabRoute } from "@/hooks/useLabRoute";

type Accreditor = "CAP" | "TJC" | "COLA" | "CMS" | "AABB" | "Other";
type FindingStatus = "open" | "drafting" | "submitted" | "accepted" | "rejected_resubmit" | "closed";

const ACCREDITORS: { value: Accreditor; label: string; anchorLabel: string }[] = [
  { value: "CAP",   label: "CAP",            anchorLabel: "Inspection date" },
  { value: "TJC",   label: "TJC",            anchorLabel: "Final report posted" },
  { value: "CMS",   label: "CMS (CLIA-2567)", anchorLabel: "Receipt date" },
  { value: "AABB",  label: "AABB",           anchorLabel: "Event date" },
  { value: "COLA",  label: "COLA",           anchorLabel: "Notice date" },
  { value: "Other", label: "Other",          anchorLabel: "Anchor date" },
];

const STATUS_OPTIONS: { value: FindingStatus; label: string }[] = [
  { value: "open",              label: "Open" },
  { value: "drafting",          label: "Drafting" },
  { value: "submitted",         label: "Submitted" },
  { value: "accepted",          label: "Accepted" },
  { value: "rejected_resubmit", label: "Rejected (resubmit)" },
  { value: "closed",            label: "Closed" },
];

const STATUS_BADGES: Record<FindingStatus, { label: string; cls: string }> = {
  open:                 { label: "Open",        cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  drafting:             { label: "Drafting",    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  submitted:            { label: "Submitted",   cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  accepted:             { label: "Accepted",    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  rejected_resubmit:    { label: "Resubmit",    cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  closed:               { label: "Closed",      cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (isNaN(target.getTime())) return null;
  const today = new Date();
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const t1 = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((t1 - t0) / (1000 * 60 * 60 * 24));
}

type SaveState = "idle" | "saving" | "saved" | "error";

// Mirror of server-side validateCms2567POC. Drives the in-form POC tile so
// the user sees what's missing as they type, without round-tripping. The
// server still enforces on the render endpoint.
function clientValidateCms2567(finding: any): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!finding) return { ok: false, missing: ["finding"] };
  if (!finding.description || !String(finding.description).trim()) missing.push("Deficiency description");
  if (!finding.corrective_action || !String(finding.corrective_action).trim()) missing.push("Corrective action (POC element 1)");
  if (!finding.preventive_action || !String(finding.preventive_action).trim()) missing.push("Preventive / system-level action (POC elements 2 + 3)");
  if (!finding.monitoring_plan || !String(finding.monitoring_plan).trim()) missing.push("Monitoring plan (POC element 4)");
  if (!finding.completion_date || !String(finding.completion_date).trim()) missing.push("Completion date (POC element 5)");
  return { ok: missing.length === 0, missing };
}

// CAP completeness guard. CAP has no federal-equivalent of CMS's 5-elements
// rule, but per operator's consulting judgment the minimum floor before
// submitting through the CAP e-LAB Solutions Suite is description plus
// corrective action. Mirrors server-side validateCapResponse so a direct
// API call cannot bypass it.
function clientValidateCap(finding: any): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!finding) return { ok: false, missing: ["finding"] };
  if (!finding.description || !String(finding.description).trim()) missing.push("Deficiency description");
  if (!finding.corrective_action || !String(finding.corrective_action).trim()) missing.push("Corrective action");
  return { ok: missing.length === 0, missing };
}

// TJC Evidence of Standards Compliance guard. The May 2024 TJC update
// requires documenting patient-impact factors found during root-cause
// analysis; the findings schema folds that into root_cause. Mirrors
// server-side validateTjcEsc.
function clientValidateTjc(finding: any): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!finding) return { ok: false, missing: ["finding"] };
  if (!finding.description || !String(finding.description).trim()) missing.push("Deficiency description");
  if (!finding.root_cause || !String(finding.root_cause).trim()) missing.push("Root cause analysis (including patient-impact factors)");
  if (!finding.corrective_action || !String(finding.corrective_action).trim()) missing.push("Corrective action");
  return { ok: missing.length === 0, missing };
}

// COLA consultative-narrative guard. COLA has no hard regulatory minimum
// (scoping doc section 4); the only gate is a description floor so the
// PDF doesn't render fully empty. Mirrors server-side validateColaResponse.
function clientValidateCola(finding: any): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!finding) return { ok: false, missing: ["finding"] };
  if (!finding.description || !String(finding.description).trim()) missing.push("Deficiency description");
  return { ok: missing.length === 0, missing };
}

// AABB NER guard. AABB uses risk levels 1-5 (stored in phase_or_severity)
// plus a CAPA expectation. Minimum floor: nonconformance description plus
// risk level plus corrective action. Mirrors server-side validateAabbNer.
function clientValidateAabb(finding: any): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!finding) return { ok: false, missing: ["finding"] };
  if (!finding.description || !String(finding.description).trim()) missing.push("Nonconformance description");
  if (!finding.phase_or_severity || !String(finding.phase_or_severity).trim()) missing.push("Risk level (1 through 5)");
  if (!finding.corrective_action || !String(finding.corrective_action).trim()) missing.push("Corrective action");
  return { ok: missing.length === 0, missing };
}

// Wave C3 (2026-06-12): effectiveness monitoring panel. Generates and tracks
// the 30/60/90-day checkpoints that verify a corrective action stayed effective
// after the plan of correction closed. A "not effective" outcome reopens the
// finding, so the parent refetches.
interface EffCheck {
  id: number;
  interval_days: number;
  due_date: string;
  status: "pending" | "effective" | "not_effective";
  outcome_note: string | null;
  verified_at: string | null;
  verified_by: string | null;
}
function EffectivenessPanel({ activeLabId, findingId, completionDate, canEdit, onFindingChange }: {
  activeLabId: number; findingId: string; completionDate: string | null; canEdit: boolean; onFindingChange: () => void;
}) {
  const [checks, setChecks] = useState<EffCheck[] | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `${API_BASE}/api/labs/${activeLabId}/findings/${findingId}/effectiveness-checks`;

  const load = async () => {
    try {
      const r = await fetch(base, { headers: authHeaders() });
      if (r.ok) setChecks(await r.json());
    } catch { /* leave as-is */ }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [findingId, activeLabId]);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${base}/generate`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" } });
      const data = await r.json().catch(() => ({}));
      if (r.ok) setChecks(data.checks || []);
      else alert(data.error || "Could not start effectiveness monitoring.");
    } finally { setBusy(false); }
  };

  const record = async (check: EffCheck, status: "effective" | "not_effective") => {
    const note = window.prompt(
      status === "effective"
        ? `What evidence shows the corrective action held at ${check.interval_days} days?`
        : `What recurred at ${check.interval_days} days? (this reopens the finding)`,
      "",
    );
    if (note === null) return;
    setBusy(true);
    try {
      const r = await fetch(`${base}/${check.id}`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ status, outcome_note: note }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) { await load(); if (data.reopened) onFindingChange(); }
      else alert(data.error || "Could not record checkpoint.");
    } finally { setBusy(false); }
  };

  const hasChecks = checks && checks.length > 0;
  return (
    <Card>
      <CardHeader className="py-3 px-4 border-b">
        <CardTitle className="text-base font-semibold">Effectiveness monitoring</CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          A plan of correction is not finished when it is signed. CLIA and CAP expect the lab to verify the corrective action stayed effective. These 30, 60, and 90 day checkpoints are anchored on the completion date and appear on the VeritaTrack worklist until resolved.
        </p>
        {!hasChecks ? (
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={generate} disabled={busy || !canEdit || !completionDate}>
              Start 30/60/90 day monitoring
            </Button>
            {!completionDate && <span className="text-xs text-amber-700">Set a completion date above first.</span>}
          </div>
        ) : (
          <div className="space-y-2">
            {checks!.map(c => {
              const overdue = c.status === "pending" && new Date(c.due_date) < new Date();
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-md border p-2.5 text-sm">
                  <span className="font-medium w-16 shrink-0">{c.interval_days}-day</span>
                  <span className={`text-xs ${overdue ? "text-red-600 font-medium" : "text-muted-foreground"} w-28 shrink-0`}>Due {c.due_date}</span>
                  <div className="flex-1 min-w-0">
                    {c.status === "pending" ? (
                      <span className={`text-xs ${overdue ? "text-red-600" : "text-muted-foreground"}`}>{overdue ? "Overdue" : "Pending"}</span>
                    ) : (
                      <span className={`text-xs font-medium ${c.status === "effective" ? "text-emerald-700" : "text-red-700"}`}>
                        {c.status === "effective" ? "Verified effective" : "Not effective (finding reopened)"}
                        {c.verified_by ? ` by ${c.verified_by}` : ""}
                        {c.outcome_note ? `: ${c.outcome_note}` : ""}
                      </span>
                    )}
                  </div>
                  {c.status === "pending" && canEdit && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => record(c, "effective")}>Effective</Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs text-red-700" disabled={busy} onClick={() => record(c, "not_effective")}>Not effective</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function VeritaResponseFindingPage() {
  const labRoute = useLabRoute();
  const { user } = useAuth();
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const id = params.id;
  // Multi-Lab Tier 2 Phase 3.10b: lab-scoped finding fetch.
  // Falls back to the legacy /api/findings/:id endpoint (still mounted at
  // routes.ts line 12294) when activeLabId hasn't resolved yet. The prior
  // implementation had `: findingUrl` as the else branch, which is a
  // self-reference to a const that is in the TDZ at that point — every
  // render with a falsy activeLabId threw `Cannot access 'findingUrl'
  // before initialization` and crashed the page. Same class as the PR
  // #534 TDZ on VeritaCheckPage. Customer report 2026-06-04.
  const activeLabId = useActiveLabId();
  const findingUrl = activeLabId
    ? `${API_BASE}/api/labs/${activeLabId}/findings/${id}`
    : `${API_BASE}/api/findings/${id}`;

  // Lab-aware accreditor gating: filter the dropdown to bodies the active
  // lab claims, plus always-allowed CMS/Other, plus the finding's current
  // value (so legacy findings whose accreditor is no longer in the lab's
  // set remain readable and editable in other fields). Same allowedSet
  // also gates whether the CAP renderer card appears.
  const { data: memberships } = useMemberships();
  const activeMembership = memberships?.find(m => m.labId === activeLabId) ?? null;
  const labAllowedAccreditors = allowedAccreditorsForMembership(activeMembership);

  const [finding, setFinding] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const hasPlanAccess = !!user?.plan && user.plan !== "free" && user.plan !== "per_study";

  const fetchFinding = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(findingUrl, { headers: authHeaders() });
      if (!res.ok) {
        setFinding(null);
        return;
      }
      const data = await res.json();
      setFinding(data);
    } catch {
      setFinding(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasPlanAccess) fetchFinding();
    else setLoading(false);
  }, [hasPlanAccess, id]);

  // Single field setter
  const setField = (key: string, value: any) => {
    setFinding((prev: any) => prev ? { ...prev, [key]: value } : prev);
    if (saveState !== "idle") setSaveState("idle");
  };

  const handleSave = async () => {
    if (!finding || !id) return;
    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await fetch(findingUrl, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          accreditor: finding.accreditor,
          inspection_id: finding.inspection_id ?? null,
          finding_number: finding.finding_number ?? null,
          standard_ref: finding.standard_ref ?? null,
          phase_or_severity: finding.phase_or_severity ?? null,
          description: finding.description ?? null,
          surveyor_notes: finding.surveyor_notes ?? null,
          anchor_date: finding.anchor_date ?? null,
          status: finding.status,
          immediate_action: finding.immediate_action ?? null,
          containment: finding.containment ?? null,
          root_cause: finding.root_cause ?? null,
          corrective_action: finding.corrective_action ?? null,
          preventive_action: finding.preventive_action ?? null,
          monitoring_plan: finding.monitoring_plan ?? null,
          completion_date: finding.completion_date ?? null,
          signed_by: finding.signed_by ?? null,
          signed_at: finding.signed_at ?? null,
          external_submission_ref: finding.external_submission_ref ?? null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.error || `Save failed (${res.status})`);
        setSaveState("error");
        return;
      }
      const updated = await res.json();
      setFinding(updated);
      setSaveState("saved");
    } catch (e: any) {
      setSaveError(e?.message || "Network error");
      setSaveState("error");
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    await fetch(findingUrl, {
      method: "DELETE",
      headers: authHeaders(),
    });
    navigate(activeLabId ? `/labs/${activeLabId}/veritaresponse` : "/veritaresponse");
  };

  const [renderState, setRenderState] = useState<"idle" | "rendering" | "error">("idle");
  const [renderError, setRenderError] = useState<string | null>(null);
  const [vcLink, setVcLink] = useState<any>(null);

  // Refetch the VeritaCheck cross-link whenever the finding's standard_ref
  // changes (so saving a new reference updates the link panel without a
  // full page refresh).
  useEffect(() => {
    if (!id || !hasPlanAccess) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/findings/${id}/veritacheck-link`, {
          headers: authHeaders(),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setVcLink(data);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [id, hasPlanAccess, finding?.standard_ref]);

  const handleGenerateCms2567 = async () => {
    if (!id) return;
    setRenderState("rendering");
    setRenderError(null);
    try {
      const res = await fetch(`${API_BASE}/api/findings/${id}/cms-2567-pdf`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.missing && body.missing.length
          ? `Missing: ${body.missing.join("; ")}`
          : body.error || `Render failed (${res.status})`;
        setRenderError(msg);
        setRenderState("error");
        return;
      }
      const data = await res.json();
      if (data.token) {
        window.open(`${API_BASE}/api/pdf/${data.token}`, "_blank");
      }
      setRenderState("idle");
    } catch (e: any) {
      setRenderError(e?.message || "Network error");
      setRenderState("error");
    }
  };

  const handleGenerateCap = async () => {
    if (!id) return;
    setRenderState("rendering");
    setRenderError(null);
    try {
      const res = await fetch(`${API_BASE}/api/findings/${id}/cap-pdf`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.missing && body.missing.length
          ? `Missing: ${body.missing.join("; ")}`
          : body.error || `Render failed (${res.status})`;
        setRenderError(msg);
        setRenderState("error");
        return;
      }
      const data = await res.json();
      if (data.token) {
        window.open(`${API_BASE}/api/pdf/${data.token}`, "_blank");
      }
      setRenderState("idle");
    } catch (e: any) {
      setRenderError(e?.message || "Network error");
      setRenderState("error");
    }
  };

  const handleGenerateTjc = async () => {
    if (!id) return;
    setRenderState("rendering");
    setRenderError(null);
    try {
      const res = await fetch(`${API_BASE}/api/findings/${id}/tjc-pdf`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.missing && body.missing.length
          ? `Missing: ${body.missing.join("; ")}`
          : body.error || `Render failed (${res.status})`;
        setRenderError(msg);
        setRenderState("error");
        return;
      }
      const data = await res.json();
      if (data.token) {
        window.open(`${API_BASE}/api/pdf/${data.token}`, "_blank");
      }
      setRenderState("idle");
    } catch (e: any) {
      setRenderError(e?.message || "Network error");
      setRenderState("error");
    }
  };

  const handleGenerateCola = async () => {
    if (!id) return;
    setRenderState("rendering");
    setRenderError(null);
    try {
      const res = await fetch(`${API_BASE}/api/findings/${id}/cola-pdf`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.missing && body.missing.length
          ? `Missing: ${body.missing.join("; ")}`
          : body.error || `Render failed (${res.status})`;
        setRenderError(msg);
        setRenderState("error");
        return;
      }
      const data = await res.json();
      if (data.token) {
        window.open(`${API_BASE}/api/pdf/${data.token}`, "_blank");
      }
      setRenderState("idle");
    } catch (e: any) {
      setRenderError(e?.message || "Network error");
      setRenderState("error");
    }
  };

  const handleGenerateAabb = async () => {
    if (!id) return;
    setRenderState("rendering");
    setRenderError(null);
    try {
      const res = await fetch(`${API_BASE}/api/findings/${id}/aabb-pdf`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = body.missing && body.missing.length
          ? `Missing: ${body.missing.join("; ")}`
          : body.error || `Render failed (${res.status})`;
        setRenderError(msg);
        setRenderState("error");
        return;
      }
      const data = await res.json();
      if (data.token) {
        window.open(`${API_BASE}/api/pdf/${data.token}`, "_blank");
      }
      setRenderState("idle");
    } catch (e: any) {
      setRenderError(e?.message || "Network error");
      setRenderState("error");
    }
  };

  // Plan gate
  if (!hasPlanAccess) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold mb-2">VeritaResponse&trade;</h2>
        <p className="text-muted-foreground mb-6">
          Upgrade to a paid plan to manage findings.
        </p>
        <Button asChild className="bg-[#006064] hover:bg-[#004d50] text-white">
          <Link href={labRoute("/account/settings")}>Upgrade Plan</Link>
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <RefreshCw size={20} className="animate-spin mr-2" />
        Loading finding...
      </div>
    );
  }

  if (!finding) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold mb-2">Finding not found</h2>
        <p className="text-muted-foreground mb-6">
          This finding may have been deleted, or you do not have access to it.
        </p>
        <Button asChild variant="outline">
          <Link href={activeLabId ? `/labs/${activeLabId}/veritaresponse` : "/veritaresponse"}><ArrowLeft size={14} className="mr-1.5" />Back to all findings</Link>
        </Button>
      </div>
    );
  }

  const status = (finding.status || "open") as FindingStatus;
  const badge = STATUS_BADGES[status] ?? STATUS_BADGES.open;
  const accCfg = ACCREDITORS.find((a) => a.value === finding.accreditor);
  const anchorLabel = accCfg?.anchorLabel ?? "Anchor date";
  const d = daysUntil(finding.due_date);
  const isOverdue = d !== null && d < 0 && status !== "closed" && status !== "accepted";
  const isDueSoon = d !== null && d >= 0 && d <= 7 && status !== "closed" && status !== "accepted";

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={activeLabId ? `/labs/${activeLabId}/veritaresponse` : "/veritaresponse"}><ArrowLeft size={14} className="mr-1.5" />All findings</Link>
        </Button>
        <ConfirmDialog
          title="Delete Finding?"
          message="Delete this finding and all its history? This cannot be undone."
          confirmLabel="Delete"
          onConfirm={handleDelete}
        >
          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700">
            <Trash2 size={14} className="mr-1.5" />Delete
          </Button>
        </ConfirmDialog>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {finding.accreditor} Finding {finding.finding_number || `#${finding.id}`}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {finding.standard_ref || "No standard reference recorded"}
          </p>
        </div>
        <Badge className={`${badge.cls} text-sm whitespace-nowrap font-medium px-3 py-1`}>
          {status === "accepted" && <CheckCircle2 size={12} className="mr-1" />}
          {badge.label}
        </Badge>
      </div>

      {/* Due-date alert */}
      {finding.due_date && (
        <div
          className={`flex items-start gap-3 rounded-lg border p-4 ${
            isOverdue
              ? "border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800"
              : isDueSoon
                ? "border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800"
                : "border-border bg-muted/30"
          }`}
        >
          <AlertTriangle
            size={18}
            className={`mt-0.5 shrink-0 ${
              isOverdue
                ? "text-red-600 dark:text-red-400"
                : isDueSoon
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
            }`}
          />
          <div className="text-sm">
            <span className="font-semibold">
              Due {finding.due_date}
              {d !== null && (
                <>
                  {" "}({d < 0 ? `${Math.abs(d)}d overdue` : d === 0 ? "today" : `in ${d}d`})
                </>
              )}
            </span>
            {accCfg && (
              <span className="text-muted-foreground ml-2">
                anchored on {anchorLabel.toLowerCase()} {finding.anchor_date || "(not set)"}.
              </span>
            )}
          </div>
        </div>
      )}

      {/* POC completeness + CMS-2567 render (CMS findings only) */}
      {finding.accreditor === "CMS" && (() => {
        const poc = clientValidateCms2567(finding);
        const elements = [
          { key: "description", label: "Deficiency description" },
          { key: "corrective_action", label: "Corrective action (POC element 1)" },
          { key: "preventive_action", label: "Preventive / system-level (POC elements 2 + 3)" },
          { key: "monitoring_plan", label: "Monitoring plan (POC element 4)" },
          { key: "completion_date", label: "Completion date (POC element 5)" },
        ];
        return (
          <Card>
            <CardHeader className="py-3 px-4 border-b">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base font-semibold">CMS-2567 Plan of Correction</CardTitle>
                <Button
                  size="sm"
                  className="bg-[#006064] hover:bg-[#004d50] text-white"
                  onClick={handleGenerateCms2567}
                  disabled={!poc.ok || renderState === "rendering"}
                >
                  <Download size={14} className="mr-1.5" />
                  {renderState === "rendering" ? "Rendering..." : "Generate CMS-2567 PDF"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              <div className="text-xs text-muted-foreground">
                CMS form 2567 requires 5 Plan of Correction elements per State Operations Manual section 7314. Save your draft to update this checklist.
              </div>
              <ul className="space-y-1">
                {elements.map((el) => {
                  const val = finding[el.key];
                  const present = !!(val && String(val).trim());
                  return (
                    <li key={el.key} className="flex items-center gap-2 text-sm">
                      {present
                        ? <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        : <XCircle size={14} className="text-red-600 dark:text-red-400 shrink-0" />}
                      <span className={present ? "" : "text-muted-foreground"}>{el.label}</span>
                    </li>
                  );
                })}
              </ul>
              {renderState === "error" && renderError && (
                <div className="text-xs text-red-700 dark:text-red-400 mt-2">{renderError}</div>
              )}
              {!poc.ok && (
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                  Fill in the missing fields below, save, then generate the PDF.
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* CAP response checklist + render (CAP findings only, on a lab
          flagged for CAP). CAP has no equivalent of CMS's 5 POC elements
          rule; the minimum floor is description + corrective action
          (consulting-judgment). Mirrors the CMS-2567 card pattern so the
          UX is uniform per accreditor. Hidden when the lab isn't flagged
          for CAP, even if the finding's accreditor is CAP (legacy data). */}
      {finding.accreditor === "CAP" && labAllowedAccreditors.has("CAP") && (() => {
        const cap = clientValidateCap(finding);
        const elements = [
          { key: "description", label: "Deficiency description" },
          { key: "corrective_action", label: "Corrective action" },
        ];
        return (
          <Card>
            <CardHeader className="py-3 px-4 border-b">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base font-semibold">CAP Plan of Correction Response</CardTitle>
                <Button
                  size="sm"
                  className="bg-[#006064] hover:bg-[#004d50] text-white"
                  onClick={handleGenerateCap}
                  disabled={!cap.ok || renderState === "rendering"}
                >
                  <Download size={14} className="mr-1.5" />
                  {renderState === "rendering" ? "Rendering..." : "Generate CAP PDF"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              <div className="text-xs text-muted-foreground">
                CAP submits one response per checklist item via the e-LAB Solutions Suite. Minimum required: a deficiency description and a corrective action. Optional fields (root cause, preventive action, monitoring, completion date) strengthen the response and are recommended.
              </div>
              <ul className="space-y-1">
                {elements.map((el) => {
                  const val = finding[el.key];
                  const present = !!(val && String(val).trim());
                  return (
                    <li key={el.key} className="flex items-center gap-2 text-sm">
                      {present
                        ? <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        : <XCircle size={14} className="text-red-600 dark:text-red-400 shrink-0" />}
                      <span className={present ? "" : "text-muted-foreground"}>{el.label}</span>
                    </li>
                  );
                })}
              </ul>
              {renderState === "error" && renderError && (
                <div className="text-xs text-red-700 dark:text-red-400 mt-2">{renderError}</div>
              )}
              {!cap.ok && (
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                  Fill in the missing fields below, save, then generate the PDF.
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* TJC Evidence of Standards Compliance checklist + render. TJC
          findings only, on a lab flagged for TJC. The May 2024 TJC update
          requires patient-impact factor documentation; the checklist
          labels root_cause accordingly. Pattern mirrors the CMS-2567 and
          CAP cards so the UX is uniform per accreditor. */}
      {finding.accreditor === "TJC" && labAllowedAccreditors.has("TJC") && (() => {
        const tjc = clientValidateTjc(finding);
        const elements = [
          { key: "description", label: "Deficiency description" },
          { key: "root_cause", label: "Root cause analysis (including patient-impact factors per TJC May 2024 update)" },
          { key: "corrective_action", label: "Corrective action" },
        ];
        return (
          <Card>
            <CardHeader className="py-3 px-4 border-b">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base font-semibold">TJC Evidence of Standards Compliance</CardTitle>
                <Button
                  size="sm"
                  className="bg-[#006064] hover:bg-[#004d50] text-white"
                  onClick={handleGenerateTjc}
                  disabled={!tjc.ok || renderState === "rendering"}
                >
                  <Download size={14} className="mr-1.5" />
                  {renderState === "rendering" ? "Rendering..." : "Generate TJC ESC PDF"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              <div className="text-xs text-muted-foreground">
                TJC submits one ESC per Requirement for Improvement through Joint Commission Connect under the Survey Process post-survey workflow. Required minimum: deficiency description, root cause analysis with patient-impact factors, and a corrective action. Optional fields (immediate action, preventive action, monitoring, completion date) strengthen the response and are recommended.
              </div>
              <ul className="space-y-1">
                {elements.map((el) => {
                  const val = finding[el.key];
                  const present = !!(val && String(val).trim());
                  return (
                    <li key={el.key} className="flex items-center gap-2 text-sm">
                      {present
                        ? <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        : <XCircle size={14} className="text-red-600 dark:text-red-400 shrink-0" />}
                      <span className={present ? "" : "text-muted-foreground"}>{el.label}</span>
                    </li>
                  );
                })}
              </ul>
              {renderState === "error" && renderError && (
                <div className="text-xs text-red-700 dark:text-red-400 mt-2">{renderError}</div>
              )}
              {!tjc.ok && (
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                  Fill in the missing fields below, save, then generate the PDF.
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* COLA consultative-narrative checklist + render. COLA findings only,
          on a lab flagged for COLA. COLA is consultative with no hard
          deadline; the gate is just description (sanity check, not a
          regulatory floor). Body copy explains the "why over what" emphasis
          so users know to draft Root cause / lessons learned before final
          submission to COLA tech support. */}
      {finding.accreditor === "COLA" && labAllowedAccreditors.has("COLA") && (() => {
        const cola = clientValidateCola(finding);
        const elements = [
          { key: "description", label: "Deficiency description" },
        ];
        return (
          <Card>
            <CardHeader className="py-3 px-4 border-b">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base font-semibold">COLA Consultative Response</CardTitle>
                <Button
                  size="sm"
                  className="bg-[#006064] hover:bg-[#004d50] text-white"
                  onClick={handleGenerateCola}
                  disabled={!cola.ok || renderState === "rendering"}
                >
                  <Download size={14} className="mr-1.5" />
                  {renderState === "rendering" ? "Rendering..." : "Generate COLA PDF"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              <div className="text-xs text-muted-foreground">
                COLA uses a consultative accreditation model with no hard deadline. Free technical support is available while you develop the plan. COLA reviewers emphasize "why this happened and what we learned" over a rigid POC template; drafting the Root cause section before sharing with COLA is recommended.
              </div>
              <ul className="space-y-1">
                {elements.map((el) => {
                  const val = finding[el.key];
                  const present = !!(val && String(val).trim());
                  return (
                    <li key={el.key} className="flex items-center gap-2 text-sm">
                      {present
                        ? <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        : <XCircle size={14} className="text-red-600 dark:text-red-400 shrink-0" />}
                      <span className={present ? "" : "text-muted-foreground"}>{el.label}</span>
                    </li>
                  );
                })}
              </ul>
              {renderState === "error" && renderError && (
                <div className="text-xs text-red-700 dark:text-red-400 mt-2">{renderError}</div>
              )}
              {!cola.ok && (
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                  Fill in the missing field below, save, then generate the PDF.
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* AABB NER working-draft checklist + render. AABB findings only,
          on a lab flagged for AABB. AABB has structured Sections A-M in
          the official form; this PDF is framed as a working draft for
          transcription. Required minimum: nonconformance description,
          risk level (1-5), corrective action. */}
      {finding.accreditor === "AABB" && labAllowedAccreditors.has("AABB") && (() => {
        const aabb = clientValidateAabb(finding);
        const elements = [
          { key: "description", label: "Nonconformance description" },
          { key: "phase_or_severity", label: "Risk level (1 through 5)" },
          { key: "corrective_action", label: "Corrective action (CAPA)" },
        ];
        return (
          <Card>
            <CardHeader className="py-3 px-4 border-b">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base font-semibold">AABB Nonconforming Event Report</CardTitle>
                <Button
                  size="sm"
                  className="bg-[#006064] hover:bg-[#004d50] text-white"
                  onClick={handleGenerateAabb}
                  disabled={!aabb.ok || renderState === "rendering"}
                >
                  <Download size={14} className="mr-1.5" />
                  {renderState === "rendering" ? "Rendering..." : "Generate AABB NER PDF"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              <div className="text-xs text-muted-foreground">
                AABB uses a Nonconforming Event Report with Sections A through M. This PDF is a working draft of the response content for transcription into AABB's official form per your facility's procedure. If the event meets FDA reportable-event criteria, separate FDA notification is required within 45 days of discovery.
              </div>
              <ul className="space-y-1">
                {elements.map((el) => {
                  const val = finding[el.key];
                  const present = !!(val && String(val).trim());
                  return (
                    <li key={el.key} className="flex items-center gap-2 text-sm">
                      {present
                        ? <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        : <XCircle size={14} className="text-red-600 dark:text-red-400 shrink-0" />}
                      <span className={present ? "" : "text-muted-foreground"}>{el.label}</span>
                    </li>
                  );
                })}
              </ul>
              {renderState === "error" && renderError && (
                <div className="text-xs text-red-700 dark:text-red-400 mt-2">{renderError}</div>
              )}
              {!aabb.ok && (
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-2">
                  Fill in the missing fields below, save, then generate the PDF.
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* VeritaCheck cross-link (the moat). Shows the lab's most recent
          VeritaCheck study so the user can answer "what had we done about
          this standard?" before the surveyor asks. */}
      {vcLink && (
        <Card>
          <CardHeader className="py-3 px-4 border-b">
            <CardTitle className="text-base font-semibold">
              Most recent VeritaCheck&trade;
              {vcLink.normalizedKey && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">for {vcLink.normalizedKey}</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {vcLink.match ? (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    {vcLink.match.verdict === "pass" && (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs font-medium">
                        <CheckCircle2 size={11} className="mr-1" />
                        Compliant
                      </Badge>
                    )}
                    {vcLink.match.verdict === "fail" && (
                      <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 text-xs font-medium">
                        <XCircle size={11} className="mr-1" />
                        At Risk
                      </Badge>
                    )}
                    {vcLink.match.verdict && vcLink.match.verdict !== "pass" && vcLink.match.verdict !== "fail" && (
                      <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 text-xs font-medium capitalize">
                        {vcLink.match.verdict}
                      </Badge>
                    )}
                    <span className="font-medium">{vcLink.match.testName}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {String(vcLink.match.studyType).replace(/_/g, " ")} on {vcLink.match.date}
                    {vcLink.match.daysAgo !== null && vcLink.match.daysAgo !== undefined && (
                      <> ({vcLink.match.daysAgo}d ago)</>
                    )}
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <a href={vcLink.match.deepLink} target="_blank" rel="noopener noreferrer">
                    Open study&nbsp;&rarr;
                  </a>
                </Button>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <Info size={14} className="mt-0.5 shrink-0" />
                <span>{vcLink.reason || "No matching VeritaCheck study found."}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Identification */}
      <Card>
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-base font-semibold">Identification</CardTitle>
        </CardHeader>
        <CardContent className="p-4 grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Accreditor</Label>
            <Select value={finding.accreditor} onValueChange={(v) => setField("accreditor", v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ACCREDITORS
                  .filter(a => labAllowedAccreditors.has(a.value) || a.value === finding.accreditor)
                  .map((a) => {
                    const isLegacy = !labAllowedAccreditors.has(a.value);
                    return (
                      <SelectItem key={a.value} value={a.value}>
                        {a.label}{isLegacy ? " (legacy, lab no longer flagged)" : ""}
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={(v) => setField("status", v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Finding #</Label>
            <Input value={finding.finding_number || ""} onChange={(e) => setField("finding_number", e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Standard / CFR reference</Label>
            <Input value={finding.standard_ref || ""} onChange={(e) => setField("standard_ref", e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phase / Severity</Label>
            <Input value={finding.phase_or_severity || ""} onChange={(e) => setField("phase_or_severity", e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Inspection ID</Label>
            <Input value={finding.inspection_id || ""} onChange={(e) => setField("inspection_id", e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{anchorLabel}</Label>
            <Input type="date" value={finding.anchor_date || ""} onChange={(e) => setField("anchor_date", e.target.value)} className="h-9 text-sm" />
            <p className="text-xs text-muted-foreground">Due date recomputes on save.</p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">External submission reference</Label>
            <Input value={finding.external_submission_ref || ""} onChange={(e) => setField("external_submission_ref", e.target.value)} className="h-9 text-sm" placeholder="e-LAB ticket / JC Connect ID / CMS-2567 page" />
          </div>
        </CardContent>
      </Card>

      {/* Deficiency narrative */}
      <Card>
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-base font-semibold">Deficiency description</CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Description (no PHI)</Label>
            <Textarea value={finding.description || ""} onChange={(e) => setField("description", e.target.value)} className="text-sm min-h-[90px]" placeholder="What the surveyor cited, in their words where possible. No patient names or MRNs." />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Surveyor notes (optional, no PHI)</Label>
            <Textarea value={finding.surveyor_notes || ""} onChange={(e) => setField("surveyor_notes", e.target.value)} className="text-sm min-h-[60px]" />
          </div>
        </CardContent>
      </Card>

      {/* Plan of correction (the 5 POC elements live in these fields) */}
      <Card>
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-base font-semibold">Plan of correction</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            The CMS Statement of Deficiencies (form CMS-2567) requires 5 elements: corrective action for affected patients or items, identification of others potentially affected, systems to prevent recurrence, ongoing monitoring, and a completion date. The 5-elements coach that blocks submission without all five lands in a later phase.
          </p>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Immediate action</Label>
            <Textarea value={finding.immediate_action || ""} onChange={(e) => setField("immediate_action", e.target.value)} className="text-sm min-h-[60px]" placeholder="What was done the same day the citation was received." />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Containment</Label>
            <Textarea value={finding.containment || ""} onChange={(e) => setField("containment", e.target.value)} className="text-sm min-h-[60px]" placeholder="How affected results, lots, or processes were isolated or recalled." />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Root cause</Label>
            <Textarea value={finding.root_cause || ""} onChange={(e) => setField("root_cause", e.target.value)} className="text-sm min-h-[60px]" placeholder="Why the deficiency occurred. Address the system, not the person." />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Corrective action (POC element 1)</Label>
            <Textarea value={finding.corrective_action || ""} onChange={(e) => setField("corrective_action", e.target.value)} className="text-sm min-h-[60px]" placeholder="What changed: SOP revision, retraining, instrument adjustment, lot rejection." />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Preventive / system-level action (POC elements 2 + 3)</Label>
            <Textarea value={finding.preventive_action || ""} onChange={(e) => setField("preventive_action", e.target.value)} className="text-sm min-h-[60px]" placeholder="Identification of others potentially affected, and the systemic change so it does not recur." />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Monitoring plan (POC element 4)</Label>
            <Textarea value={finding.monitoring_plan || ""} onChange={(e) => setField("monitoring_plan", e.target.value)} className="text-sm min-h-[60px]" placeholder="How effectiveness will be verified at 30/60/90 days." />
          </div>
        </CardContent>
      </Card>

      {/* Sign-off */}
      <Card>
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-base font-semibold">Completion and approval</CardTitle>
        </CardHeader>
        <CardContent className="p-4 grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Completion date (POC element 5)</Label>
            <Input type="date" value={finding.completion_date || ""} onChange={(e) => setField("completion_date", e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Signed by (laboratory director or designee)</Label>
            <Input value={finding.signed_by || ""} onChange={(e) => setField("signed_by", e.target.value)} className="h-9 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Signed at</Label>
            <Input type="datetime-local" value={finding.signed_at ? finding.signed_at.slice(0, 16) : ""} onChange={(e) => setField("signed_at", e.target.value ? e.target.value + ":00" : null)} className="h-9 text-sm" />
          </div>
        </CardContent>
      </Card>

      {/* Wave C3: effectiveness monitoring */}
      {activeLabId && (
        <EffectivenessPanel
          activeLabId={activeLabId}
          findingId={id!}
          completionDate={finding.completion_date}
          canEdit={hasPlanAccess}
          onFindingChange={fetchFinding}
        />
      )}

      {/* PHI nudge */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800 p-4">
        <Info size={16} className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800 dark:text-amber-300">
          VeritaResponse is a PHI-free zone. Refer to patients or samples by internal case number, not by name or MRN. Use the accreditor portal (CAP e-LAB Solutions Suite, Joint Commission Connect, CMS-2567 fax or email) for any patient-level evidence the response requires.
        </p>
      </div>

      {/* Save bar */}
      <div className="sticky bottom-4 bg-background border rounded-lg shadow-sm p-3 flex items-center justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {saveState === "saved" && <span className="text-emerald-700 dark:text-emerald-400 font-medium">Saved.</span>}
          {saveState === "error" && <span className="text-red-700 dark:text-red-400 font-medium">{saveError || "Save failed."}</span>}
          {saveState === "idle" && finding.updated_at && <>Last saved {String(finding.updated_at).slice(0, 16).replace("T", " ")}.</>}
        </div>
        <Button
          className="bg-[#006064] hover:bg-[#004d50] text-white"
          onClick={handleSave}
          disabled={saveState === "saving"}
        >
          <Save size={14} className="mr-1.5" />
          {saveState === "saving" ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
