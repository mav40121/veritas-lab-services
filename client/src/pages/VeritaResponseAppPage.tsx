import { useState, useEffect } from "react";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { useMemberships, allowedAccreditorsForMembership } from "@/hooks/useMemberships";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
  CheckCircle2,
  ClipboardList,
  Info,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Link, useLocation } from "wouter";

type Accreditor = "CAP" | "TJC" | "COLA" | "CMS" | "AABB" | "Other";
type FindingStatus = "open" | "drafting" | "submitted" | "accepted" | "rejected_resubmit" | "closed";

const ACCREDITORS: { value: Accreditor; label: string; anchorLabel: string; offsetDays: number | null; deadlineNote: string }[] = [
  { value: "CAP",   label: "CAP",            anchorLabel: "Inspection date",     offsetDays: 30, deadlineNote: "30 days from inspection date." },
  { value: "TJC",   label: "TJC",            anchorLabel: "Final report posted", offsetDays: 60, deadlineNote: "60 days from posted final report." },
  { value: "CMS",   label: "CMS (CLIA-2567)", anchorLabel: "Receipt date",        offsetDays: 10, deadlineNote: "10 days from receipt. Public release at 14 days per CMS QSO-25-19-ALL." },
  { value: "AABB",  label: "AABB",           anchorLabel: "Event date",          offsetDays: 45, deadlineNote: "FDA notification within 45 days for reportable events; lab CAPA timing varies." },
  { value: "COLA",  label: "COLA",           anchorLabel: "Notice date",         offsetDays: 30, deadlineNote: "COLA is consultative; no hard deadline. Soft target of 30 days as a check-in." },
  { value: "Other", label: "Other",          anchorLabel: "Anchor date",         offsetDays: 30, deadlineNote: "Neutral default of 30 days." },
];

const STATUS_BADGES: Record<FindingStatus, { label: string; cls: string }> = {
  open:                 { label: "Open",        cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  drafting:             { label: "Drafting",    cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  submitted:            { label: "Submitted",   cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  accepted:             { label: "Accepted",    cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  rejected_resubmit:    { label: "Resubmit",    cls: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  closed:               { label: "Closed",      cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400" },
};

function computeDueDate(accreditor: Accreditor, anchorIso: string): string | null {
  if (!anchorIso) return null;
  const cfg = ACCREDITORS.find((a) => a.value === accreditor);
  if (!cfg || cfg.offsetDays == null) return null;
  const d = new Date(anchorIso);
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + cfg.offsetDays);
  return d.toISOString().slice(0, 10);
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (isNaN(target.getTime())) return null;
  const today = new Date();
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const t1 = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  return Math.round((t1 - t0) / (1000 * 60 * 60 * 24));
}

export default function VeritaResponseAppPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [findings, setFindings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  // New finding form state
  // Default to CMS because every lab holds CLIA so CMS is always in the
  // allowed set. The dropdown filters to the active lab's accreditors;
  // if the lab claims CAP/TJC/COLA/AABB, the user can pick those there.
  const [newAccreditor, setNewAccreditor] = useState<Accreditor>("CMS");
  const [newFindingNumber, setNewFindingNumber] = useState("");
  const [newStandardRef, setNewStandardRef] = useState("");
  const [newPhaseOrSeverity, setNewPhaseOrSeverity] = useState("");
  const [newInspectionId, setNewInspectionId] = useState("");
  const [newAnchorDate, setNewAnchorDate] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const hasPlanAccess = !!user?.plan && user.plan !== "free" && user.plan !== "per_study";

  // Multi-Lab Tier 2 Phase 3.10b: lab-scope reads/writes.
  const activeLabId = useActiveLabId();
  const labRoute = useLabRoute();

  // Filter the accreditor picker against the active lab's accreditation flags
  // so a user can only file findings for bodies the lab actually claims. CMS
  // and Other are always available; CAP/TJC/COLA/AABB only if flagged.
  const { data: memberships } = useMemberships();
  const activeMembership = memberships?.find(m => m.labId === activeLabId) ?? null;
  const allowedAccreditorSet = allowedAccreditorsForMembership(activeMembership);
  const visibleAccreditors = ACCREDITORS.filter(a => allowedAccreditorSet.has(a.value));
  const findingsApi = activeLabId
    ? `${API_BASE}/api/labs/${activeLabId}/findings`
    : `${API_BASE}/api/findings`;
  const findingItemUrl = (id: number | string) =>
    activeLabId
      ? `${API_BASE}/api/labs/${activeLabId}/findings/${id}`
      : `${findingsApi}/${id}`;

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${findingsApi}`, { headers: authHeaders() });
      const data = await res.json();
      setFindings(Array.isArray(data) ? data : []);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasPlanAccess) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [hasPlanAccess]);

  const handleCreate = async () => {
    if (!newAccreditor) return;
    setSaving(true);
    try {
      await fetch(`${findingsApi}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          accreditor: newAccreditor,
          inspection_id: newInspectionId.trim() || null,
          finding_number: newFindingNumber.trim() || null,
          standard_ref: newStandardRef.trim() || null,
          phase_or_severity: newPhaseOrSeverity.trim() || null,
          description: newDescription.trim() || null,
          anchor_date: newAnchorDate || null,
          status: "open",
        }),
      });
      setNewAccreditor("CMS");
      setNewFindingNumber("");
      setNewStandardRef("");
      setNewPhaseOrSeverity("");
      setNewInspectionId("");
      setNewAnchorDate("");
      setNewDescription("");
      setShowCreate(false);
      await fetchData();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    await fetch(`${findingsApi}/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    await fetchData();
  };

  // Plan gate
  if (!hasPlanAccess) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <ClipboardList size={48} className="mx-auto mb-4 text-[#006064]" />
        <h2 className="text-2xl font-bold mb-2">VeritaResponse&trade;</h2>
        <p className="text-muted-foreground mb-6">
          Post-survey deficiency response is available on all paid plans. Upgrade to manage findings, due-date clocks, and corrective-action drafting.
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
        Loading findings...
      </div>
    );
  }

  const previewDue = computeDueDate(newAccreditor, newAnchorDate);
  const anchorLabel = ACCREDITORS.find((a) => a.value === newAccreditor)?.anchorLabel ?? "Anchor date";
  const deadlineNote = ACCREDITORS.find((a) => a.value === newAccreditor)?.deadlineNote ?? "";

  const openCount = findings.filter((f) => f.status !== "closed" && f.status !== "accepted").length;
  const overdueCount = findings.filter((f) => {
    if (!f.due_date) return false;
    if (f.status === "closed" || f.status === "accepted") return false;
    const d = daysUntil(f.due_date);
    return d !== null && d < 0;
  }).length;
  const dueSoonCount = findings.filter((f) => {
    if (!f.due_date) return false;
    if (f.status === "closed" || f.status === "accepted") return false;
    const d = daysUntil(f.due_date);
    return d !== null && d >= 0 && d <= 7;
  }).length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">VeritaResponse&trade;</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Post-survey deficiency response tracker</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw size={14} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="bg-[#006064] hover:bg-[#004d50] text-white"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} className="mr-1.5" />
            New Finding
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className={`text-3xl font-bold ${overdueCount > 0 ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
              {overdueCount}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Overdue</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className={`text-3xl font-bold ${dueSoonCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
              {dueSoonCount}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Due within 7 days</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <div className="text-3xl font-bold text-[#006064] dark:text-teal-400">
              {openCount}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Open + In Progress</div>
          </CardContent>
        </Card>
      </div>

      {overdueCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800 p-4">
          <AlertTriangle size={18} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
          <div className="text-sm text-red-800 dark:text-red-300">
            <span className="font-semibold">{overdueCount} finding{overdueCount !== 1 ? "s" : ""} past their deadline.</span>{" "}
            Submit or request an extension. CMS-2567 findings past 10 days from receipt risk escalation under 42 CFR &sect;493.1832.
          </div>
        </div>
      )}

      {/* List */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 700 }}>
              <thead>
                <tr className="text-muted-foreground border-b text-xs bg-muted/30">
                  <th className="text-left py-2.5 px-4">Accreditor</th>
                  <th className="text-left py-2.5 pr-4">Finding #</th>
                  <th className="text-left py-2.5 pr-4">Standard</th>
                  <th className="text-left py-2.5 pr-4">Due</th>
                  <th className="text-left py-2.5 pr-4">Status</th>
                  <th className="py-2.5 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {findings.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-muted-foreground text-sm">
                      No findings yet. Click "New Finding" to record one.
                    </td>
                  </tr>
                )}
                {findings.map((f) => {
                  const d = daysUntil(f.due_date);
                  const dueLabel = !f.due_date
                    ? "No deadline"
                    : d === null
                      ? f.due_date
                      : d < 0
                        ? `${Math.abs(d)}d overdue (${f.due_date})`
                        : d === 0
                          ? `Due today (${f.due_date})`
                          : `In ${d}d (${f.due_date})`;
                  const dueCls = !f.due_date
                    ? "text-muted-foreground"
                    : d !== null && d < 0
                      ? "text-red-700 dark:text-red-400 font-semibold"
                      : d !== null && d <= 7
                        ? "text-amber-700 dark:text-amber-400 font-medium"
                        : "text-muted-foreground";
                  const status = (f.status || "open") as FindingStatus;
                  const badge = STATUS_BADGES[status] ?? STATUS_BADGES.open;
                  return (
                    <tr
                      key={f.id}
                      className="border-b border-border/50 hover:bg-muted/20 cursor-pointer"
                      onClick={() => navigate(labRoute(`/veritaresponse/${f.id}`))}
                    >
                      <td className="py-3 px-4 font-medium">{f.accreditor}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{f.finding_number || "-"}</td>
                      <td className="py-3 pr-4 text-muted-foreground text-xs">{f.standard_ref || "-"}</td>
                      <td className={`py-3 pr-4 text-xs ${dueCls}`}>{dueLabel}</td>
                      <td className="py-3 pr-4">
                        <Badge className={`${badge.cls} text-xs whitespace-nowrap font-medium`}>
                          {status === "accepted" && <CheckCircle2 size={11} className="mr-1" />}
                          {badge.label}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4" onClick={(e) => e.stopPropagation()}>
                        <ConfirmDialog
                          title="Delete Finding?"
                          message="Delete this finding and all its history? This cannot be undone."
                          confirmLabel="Delete"
                          onConfirm={() => handleDelete(f.id)}
                        >
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                          >
                            <Trash2 size={13} />
                          </Button>
                        </ConfirmDialog>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* PHI nudge */}
      <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800 p-4">
        <Info size={16} className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-800 dark:text-amber-300">
          VeritaResponse is a PHI-free zone. Refer to patients or samples by internal case number, not name or MRN. Surveyor portals (CAP e-LAB Solutions Suite, Joint Commission Connect, CMS-2567) have their own secure submission paths for any patient-level evidence required.
        </p>
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Finding</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Accreditor</Label>
                <Select value={newAccreditor} onValueChange={(v) => setNewAccreditor(v as Accreditor)}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleAccreditors.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{anchorLabel}</Label>
                <Input
                  type="date"
                  value={newAnchorDate}
                  onChange={(e) => setNewAnchorDate(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <p className="text-xs text-muted-foreground">{deadlineNote}</p>
                {previewDue && (
                  <p className="text-xs">
                    <span className="font-semibold text-[#006064]">Computed due date:</span>{" "}
                    <span className="font-mono">{previewDue}</span>
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Finding #</Label>
                <Input
                  value={newFindingNumber}
                  onChange={(e) => setNewFindingNumber(e.target.value)}
                  placeholder="e.g. 1 or RFI 03.01.01.01"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Standard or CFR reference</Label>
                <Input
                  value={newStandardRef}
                  onChange={(e) => setNewStandardRef(e.target.value)}
                  placeholder="e.g. GEN.20377 or 42 CFR 493.1251"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phase / Severity</Label>
                <Input
                  value={newPhaseOrSeverity}
                  onChange={(e) => setNewPhaseOrSeverity(e.target.value)}
                  placeholder="e.g. Phase II, Condition-level, NER risk 3"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Inspection ID (optional)</Label>
                <Input
                  value={newInspectionId}
                  onChange={(e) => setNewInspectionId(e.target.value)}
                  placeholder="Internal or accreditor reference"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Description of the deficiency</Label>
                <Textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Narrative only. No patient names or MRNs."
                  className="text-sm min-h-[80px]"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              className="bg-[#006064] hover:bg-[#004d50] text-white"
              onClick={handleCreate}
              disabled={saving || !newAccreditor}
            >
              {saving ? "Saving..." : "Create Finding"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
