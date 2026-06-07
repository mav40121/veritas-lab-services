// CompetencyCohortSignoffDialog
//
// Wave I PR I1 (2026-06-06). One-program × N-employees cohort
// sign-off. Mental model: lab director just finished an in-person
// session and wants to attest, in one action, that everyone who
// attended passed.
//
// Shared across the cohort: program, assessment_type, assessment_date,
// status, evaluator_name. Per-employee element-level notes are NOT
// populated; surveyor PDF falls back to "No data recorded" cleanly.
// To add per-tech notes later, the director unlocks the individual
// assessment, edits, re-locks.
//
// Three-step flow:
//   1. Pick program + shared fields.
//   2. Multi-select employees, preview.
//   3. Commit (locked = 1, completion_date = assessment_date).

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { CheckCircle2, AlertTriangle, XCircle, Users } from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";

type CohortIssue = { field?: string; severity: "error" | "warning"; message: string };
type PerEmployeeRow = {
  employeeId: number;
  employeeName: string;
  status: "ok" | "warning" | "error";
  issues: CohortIssue[];
  duplicateOf: number | null;
};
type CohortPreview = {
  rows: PerEmployeeRow[];
  shared: { programOk: boolean; programName: string | null; typeOk: boolean; statusOk: boolean; dateOk: boolean; evaluatorOk: boolean };
  sharedIssues: CohortIssue[];
  summary: { total: number; ok: number; warning: number; error: number };
  fatal?: string;
};

const ASSESSMENT_TYPES = [
  { value: "initial", label: "Initial" },
  { value: "6month", label: "6-month" },
  { value: "annual", label: "Annual" },
  { value: "reassessment", label: "Reassessment" },
  { value: "orientation", label: "Orientation" },
  { value: "duty_change", label: "Duty change" },
];
const STATUSES = [
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "remediation", label: "Remediation" },
];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  labId: number;
}

export function CompetencyCohortSignoffDialog({ open, onOpenChange, labId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [programId, setProgramId] = useState<number | "">("");
  const [assessmentType, setAssessmentType] = useState<string>("annual");
  const [assessmentDate, setAssessmentDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string>("pass");
  const [evaluatorName, setEvaluatorName] = useState<string>("");
  const [employeeIds, setEmployeeIds] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<CohortPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);

  // Programs + employees feed the dropdowns.
  const programsQ = useQuery<Array<{ id: number; name: string }>>({
    queryKey: [`/api/labs/${labId}/competency/programs`],
    enabled: open,
  });
  const employeesQ = useQuery<Array<{ id: number; name: string; status: string }>>({
    queryKey: [`/api/labs/${labId}/competency/employees`],
    enabled: open,
  });

  const activeEmployees = useMemo(
    () => (employeesQ.data || []).filter((e) => e.status === "active").sort((a, b) => a.name.localeCompare(b.name)),
    [employeesQ.data]
  );

  function reset() {
    setProgramId("");
    setAssessmentType("annual");
    setAssessmentDate(new Date().toISOString().slice(0, 10));
    setStatus("pass");
    setEvaluatorName("");
    setEmployeeIds(new Set());
    setPreview(null);
  }

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  function toggleEmployee(id: number) {
    setEmployeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setPreview(null);
  }

  function selectAllActive() {
    setEmployeeIds(new Set(activeEmployees.map((e) => e.id)));
    setPreview(null);
  }

  function clearAll() {
    setEmployeeIds(new Set());
    setPreview(null);
  }

  async function doPreview() {
    if (programId === "" || employeeIds.size === 0) return;
    setPreviewing(true);
    setPreview(null);
    try {
      const r = await fetch(`${API_BASE}/api/labs/${labId}/competency/assessments/cohort-preview`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          programId: Number(programId),
          employeeIds: Array.from(employeeIds),
          assessmentType,
          assessmentDate,
          status,
          evaluatorName: evaluatorName.trim(),
        }),
      });
      const json: CohortPreview = await r.json();
      if (!r.ok) {
        toast({ title: "Preview failed", description: json.fatal || (json as any).error || `HTTP ${r.status}`, variant: "destructive" });
      }
      setPreview(json);
    } catch (err: any) {
      toast({ title: "Preview failed", description: err.message, variant: "destructive" });
    } finally {
      setPreviewing(false);
    }
  }

  async function doCommit() {
    if (!preview) return;
    if (preview.summary.error > 0 || preview.sharedIssues.some((i) => i.severity === "error")) {
      toast({ title: "Fix errors first", description: "Resolve shared-field or row errors before committing.", variant: "destructive" });
      return;
    }
    setCommitting(true);
    try {
      const r = await fetch(`${API_BASE}/api/labs/${labId}/competency/assessments/cohort-commit`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          programId: Number(programId),
          employeeIds: Array.from(employeeIds),
          assessmentType,
          assessmentDate,
          status,
          evaluatorName: evaluatorName.trim(),
        }),
      });
      const json = await r.json();
      if (!r.ok) {
        toast({ title: "Sign-off failed", description: json.message || json.error || `HTTP ${r.status}`, variant: "destructive" });
      } else {
        toast({
          title: "Cohort signed off",
          description: `${json.inserted} assessment(s) created${json.skipped > 0 ? `; ${json.skipped} skipped (same-day duplicate)` : ""}.`,
        });
        await queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).includes("/competency/") });
        onOpenChange(false);
      }
    } catch (err: any) {
      toast({ title: "Sign-off failed", description: err.message, variant: "destructive" });
    } finally {
      setCommitting(false);
    }
  }

  const canPreview = programId !== "" && employeeIds.size > 0 && evaluatorName.trim().length > 0;
  const canCommit = preview != null && preview.summary.error === 0 && !preview.sharedIssues.some((i) => i.severity === "error");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users size={18} />
            Cohort Sign-off
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Sign off N employees for one program with a shared date, result, and evaluator. Each row lands locked (completion_date = assessment_date). To add per-tech element notes later, unlock the individual assessment, edit, re-lock.
          </p>

          {/* Step 1: shared fields */}
          <div className="border border-border rounded-md p-3 space-y-3">
            <div className="text-sm font-medium">Step 1. Shared fields</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Program</Label>
                <select
                  className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background"
                  value={programId === "" ? "" : String(programId)}
                  onChange={(e) => { setProgramId(e.target.value === "" ? "" : Number(e.target.value)); setPreview(null); }}
                >
                  <option value="">Select a program...</option>
                  {(programsQ.data || []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Assessment date</Label>
                <Input
                  type="date"
                  value={assessmentDate}
                  onChange={(e) => { setAssessmentDate(e.target.value); setPreview(null); }}
                />
              </div>
              <div>
                <Label className="text-xs">Assessment type</Label>
                <select
                  className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background"
                  value={assessmentType}
                  onChange={(e) => { setAssessmentType(e.target.value); setPreview(null); }}
                >
                  {ASSESSMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Result</Label>
                <select
                  className="w-full border border-border rounded-md px-2 py-1.5 text-sm bg-background"
                  value={status}
                  onChange={(e) => { setStatus(e.target.value); setPreview(null); }}
                >
                  {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <Label className="text-xs">Evaluator name</Label>
                <Input
                  value={evaluatorName}
                  onChange={(e) => { setEvaluatorName(e.target.value); setPreview(null); }}
                  placeholder="e.g., M. Veri, MLS(ASCP)"
                />
              </div>
            </div>
          </div>

          {/* Step 2: employees */}
          <div className="border border-border rounded-md p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Step 2. Employees ({employeeIds.size} selected)</div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={selectAllActive} disabled={activeEmployees.length === 0}>All active</Button>
                <Button variant="outline" size="sm" onClick={clearAll} disabled={employeeIds.size === 0}>Clear</Button>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto border border-border/40 rounded-md p-2 space-y-1">
              {activeEmployees.length === 0 && (
                <div className="text-xs text-muted-foreground py-3 text-center">No active competency employees in this lab.</div>
              )}
              {activeEmployees.map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/40 px-2 py-1 rounded">
                  <Checkbox
                    checked={employeeIds.has(e.id)}
                    onCheckedChange={() => toggleEmployee(e.id)}
                  />
                  <span>{e.name}</span>
                </label>
              ))}
            </div>
            <Button onClick={doPreview} disabled={!canPreview || previewing}>
              {previewing ? "Validating..." : "Preview"}
            </Button>
          </div>

          {/* Step 3: preview */}
          {preview && (
            <div className="border border-border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">Step 3. Review</div>
                <div className="flex items-center gap-2">
                  <Badge className="text-[10px] border bg-emerald-500/10 text-emerald-700 border-emerald-500/30">{preview.summary.ok} OK</Badge>
                  <Badge className="text-[10px] border bg-amber-500/10 text-amber-700 border-amber-500/30">{preview.summary.warning} warning</Badge>
                  <Badge className="text-[10px] border bg-red-500/10 text-red-700 border-red-500/30">{preview.summary.error} error</Badge>
                </div>
              </div>
              {preview.sharedIssues.length > 0 && (
                <div className="text-xs space-y-1">
                  {preview.sharedIssues.map((i, idx) => (
                    <div key={idx} className={i.severity === "error" ? "text-red-700" : "text-amber-700"}>
                      <strong>{i.severity === "error" ? "Error" : "Warning"}:</strong> {i.message}
                    </div>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto max-h-[40vh]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-1 pr-2 font-medium">Status</th>
                      <th className="text-left py-1 pr-2 font-medium">Employee</th>
                      <th className="text-left py-1 pr-2 font-medium">Issues</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row) => {
                      const Icon = row.status === "ok" ? CheckCircle2 : row.status === "warning" ? AlertTriangle : XCircle;
                      const iconColor = row.status === "ok" ? "text-emerald-600" : row.status === "warning" ? "text-amber-600" : "text-red-600";
                      return (
                        <tr key={row.employeeId} className="border-b border-border/40">
                          <td className="py-1 pr-2"><Icon size={12} className={iconColor} /></td>
                          <td className="py-1 pr-2">{row.employeeName}</td>
                          <td className="py-1 pr-2 text-[10px] text-muted-foreground">
                            {row.issues.length === 0 ? "" : row.issues.map((i) => i.message).join("; ")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setPreview(null); }}>Edit</Button>
              <Button
                onClick={doCommit}
                disabled={!canCommit || committing}
                className="bg-primary hover:bg-primary/90"
              >
                {committing ? "Signing..." : `Sign off ${preview.rows.filter((r) => r.status === "ok" || (r.status === "warning" && r.duplicateOf === null)).length} employee(s)`}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
