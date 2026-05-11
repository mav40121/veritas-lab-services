import { useState, useEffect } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
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

export default function VeritaResponseFindingPage() {
  const { user } = useAuth();
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const id = params.id;

  const [finding, setFinding] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const hasPlanAccess = !!user?.plan && user.plan !== "free" && user.plan !== "per_study";

  const fetchFinding = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/findings/${id}`, { headers: authHeaders() });
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
      const res = await fetch(`${API_BASE}/api/findings/${id}`, {
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
    await fetch(`${API_BASE}/api/findings/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    navigate("/veritaresponse");
  };

  const [renderState, setRenderState] = useState<"idle" | "rendering" | "error">("idle");
  const [renderError, setRenderError] = useState<string | null>(null);

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

  // Plan gate
  if (!hasPlanAccess) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h2 className="text-2xl font-bold mb-2">VeritaResponse&trade;</h2>
        <p className="text-muted-foreground mb-6">
          Upgrade to a paid plan to manage findings.
        </p>
        <Button asChild className="bg-[#006064] hover:bg-[#004d50] text-white">
          <Link href="/account/settings">Upgrade Plan</Link>
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
          <Link href="/veritaresponse"><ArrowLeft size={14} className="mr-1.5" />Back to all findings</Link>
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
          <Link href="/veritaresponse"><ArrowLeft size={14} className="mr-1.5" />All findings</Link>
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
                {ACCREDITORS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
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
