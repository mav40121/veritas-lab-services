import { useState, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Lock, Users, Activity, BarChart3, Save, Plus, Edit2, Trash2, FileText,
  ChevronDown, ChevronRight, BookOpen, Library, AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip as RechartsTooltip,
} from "recharts";
import {
  PI_STARTER_LIBRARY, PI_STARTER_DEPARTMENTS, PHASE_LABELS, PHASE_COLORS,
  type StarterMetric,
} from "@/lib/piStarterLibrary";

// -- Types --------------------------------------------------------------------

interface PIDepartment {
  id: number;
  account_id: number;
  name: string;
  sort_order: number;
  active: number;
}

interface PIMetric {
  id: number;
  department_id: number;
  account_id: number;
  name: string;
  unit: string;
  direction: string;
  benchmark_green: number | null;
  benchmark_yellow: number | null;
  benchmark_red: number | null;
  sort_order: number;
  active: number;
  // Wave D2: TAT defensibility.
  measurement_methodology?: string | null;
  is_tat?: number;
  tat_start_event?: string | null;
  tat_end_event?: string | null;
  tat_threshold_minutes?: number | null;
}

interface PIEntry {
  id: number;
  metric_id: number;
  account_id: number;
  year: number;
  month: number;
  value: number | null;
  volume: number | null;
  notes: string | null;
  // Wave D4: VeritaQA root-cause documentation for a missed (red) month.
  root_cause?: string | null;
  corrective_action?: string | null;
  rca_reviewed_by?: string | null;
  rca_reviewed_at?: string | null;
}

interface DashboardMetric {
  metric: PIMetric;
  monthlyValues: Record<number, { value: number | null; volume: number | null; status: string | null }>;
  quarters: Record<string, number | null>;
  ytdAvg: number | null;
  ytdStatus: string | null;
  pyAvg: number | null;
  pyStatus: string | null;
  currentValue: number | null;
  currentMonth: number | null;
  currentStatus: string | null;
  dataPointCount: number;
}

// -- Constants ----------------------------------------------------------------

const SUITE_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "clinic", "community", "hospital", "large_hospital", "enterprise"];
const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BENCHMARK_COLORS: Record<string, string> = { green: "#437A22", yellow: "#964219", red: "#A12C7B" };

function StatusDot({ status }: { status: string | null }) {
  if (!status) return <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-300" title="No benchmark configured" />;
  const color = BENCHMARK_COLORS[status] || "#9ca3af";
  const label = status === "green" ? "Within target" : status === "yellow" ? "Approaching threshold" : "Outside acceptable range";
  return <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} title={label} />;
}

function MiniSparkline({ data }: { data: { month: number; value: number | null }[] }) {
  const filtered = data.filter(d => d.value != null);
  if (filtered.length < 2) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <ResponsiveContainer width={120} height={32}>
      <LineChart data={data.filter(d => d.value != null)} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <Line type="monotone" dataKey="value" stroke="#01696F" strokeWidth={1.5} dot={false} />
        <RechartsTooltip
          contentStyle={{ fontSize: 10, padding: "2px 6px" }}
          formatter={(v: number) => v?.toFixed(2)}
          labelFormatter={(l: number) => MONTH_NAMES[l] || ""}
        />
        <XAxis dataKey="month" hide />
        <YAxis hide domain={["auto", "auto"]} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function PhaseBadge({ phase }: { phase: string }) {
  const color = PHASE_COLORS[phase] || "#6b7280";
  const label = PHASE_LABELS[phase] || phase;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight"
      style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}30` }}
    >
      {label}
    </span>
  );
}

// -- Starter Library Picker ---------------------------------------------------

function StarterLibraryPicker({
  onAddSelected,
  adding,
  existingMetricNames,
}: {
  onAddSelected: (selected: StarterMetric[]) => void;
  adding: boolean;
  existingMetricNames?: Set<string>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState("");

  const metricsByDept = useMemo(() => {
    const map: Record<string, { metric: StarterMetric; index: number }[]> = {};
    PI_STARTER_LIBRARY.forEach((m, i) => {
      if (!map[m.department]) map[m.department] = [];
      map[m.department].push({ metric: m, index: i });
    });
    return map;
  }, []);

  const filteredByDept = useMemo(() => {
    if (!searchFilter.trim()) return metricsByDept;
    const q = searchFilter.toLowerCase();
    const result: Record<string, { metric: StarterMetric; index: number }[]> = {};
    for (const [dept, items] of Object.entries(metricsByDept)) {
      const matched = items.filter(
        ({ metric }) =>
          metric.name.toLowerCase().includes(q) ||
          metric.phase.toLowerCase().includes(q) ||
          metric.unit.toLowerCase().includes(q) ||
          dept.toLowerCase().includes(q)
      );
      if (matched.length > 0) result[dept] = matched;
    }
    return result;
  }, [metricsByDept, searchFilter]);

  function toggleDept(dept: string) {
    setExpandedDepts(prev => {
      const next = new Set(prev);
      if (next.has(dept)) next.delete(dept);
      else next.add(dept);
      return next;
    });
  }

  function toggleMetric(index: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleAllInDept(dept: string) {
    const items = filteredByDept[dept] || [];
    const selectableItems = items.filter(({ metric }) => !existingMetricNames?.has(metric.name));
    const allSelected = selectableItems.every(({ index }) => selected.has(index));
    setSelected(prev => {
      const next = new Set(prev);
      for (const { index } of selectableItems) {
        if (allSelected) next.delete(index);
        else next.add(index);
      }
      return next;
    });
  }

  const selectedMetrics = Array.from(selected).map(i => PI_STARTER_LIBRARY[i]);
  const deptOrder = PI_STARTER_DEPARTMENTS.filter(d => d in filteredByDept);

  return (
    <div className="space-y-4">
      {/* Search */}
      <Input
        placeholder="Filter metrics by name, phase, or department..."
        value={searchFilter}
        onChange={e => setSearchFilter(e.target.value)}
        className="h-9"
      />

      {/* Department sections */}
      <div className="border rounded-lg overflow-hidden max-h-[60vh] overflow-y-auto">
        {deptOrder.map(dept => {
          const items = filteredByDept[dept] || [];
          const isExpanded = expandedDepts.has(dept);
          const selectableItems = items.filter(({ metric }) => !existingMetricNames?.has(metric.name));
          const selectedInDept = selectableItems.filter(({ index }) => selected.has(index)).length;

          return (
            <div key={dept} className="border-b last:border-b-0">
              {/* Department header */}
              <button
                onClick={() => toggleDept(dept)}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
                style={{ backgroundColor: isExpanded ? "#01696F08" : undefined }}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="font-medium text-sm flex-1">{dept}</span>
                <span className="text-xs text-muted-foreground">
                  {items.length} metric{items.length !== 1 ? "s" : ""}
                </span>
                {selectedInDept > 0 && (
                  <span
                    className="text-xs font-medium px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: "#01696F18", color: "#01696F" }}
                  >
                    {selectedInDept} selected
                  </span>
                )}
              </button>

              {/* Metrics list */}
              {isExpanded && (
                <div>
                  {/* Select All row */}
                  <div className="flex items-center gap-2 px-3 py-1.5 border-t border-b bg-muted/20">
                    <Checkbox
                      checked={selectableItems.length > 0 && selectableItems.every(({ index }) => selected.has(index))}
                      onCheckedChange={() => toggleAllInDept(dept)}
                      disabled={selectableItems.length === 0}
                    />
                    <span className="text-xs font-medium text-muted-foreground">Select all</span>
                  </div>
                  {items.map(({ metric, index }) => {
                    const alreadyAdded = existingMetricNames?.has(metric.name);
                    return (
                      <label
                        key={index}
                        className={`flex items-start gap-2 px-3 py-2 border-t hover:bg-muted/20 cursor-pointer transition-colors ${
                          alreadyAdded ? "opacity-50" : ""
                        }`}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(index)}
                          onCheckedChange={() => toggleMetric(index)}
                          disabled={alreadyAdded}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{metric.name}</span>
                            <PhaseBadge phase={metric.phase} />
                            {alreadyAdded && (
                              <span className="text-[10px] text-muted-foreground italic">Already added</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {metric.unit} | {metric.direction === "lower_is_better" ? "Lower is better" : "Higher is better"}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            Benchmark: {metric.benchmark}
                          </div>
                          <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                            Source: {metric.source}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between pt-2">
        <span className="text-sm text-muted-foreground">
          {selected.size} metric{selected.size !== 1 ? "s" : ""} selected
        </span>
        <Button
          onClick={() => onAddSelected(selectedMetrics)}
          disabled={selected.size === 0 || adding}
          style={{ backgroundColor: "#01696F" }}
        >
          {adding ? "Adding..." : `Add Selected Metric${selected.size !== 1 ? "s" : ""}`}
        </Button>
      </div>
    </div>
  );
}

// -- PI Plan tab (Phase 1: program plan + improvement priorities + annual
//    leadership review). Backend: GET/PUT /api/pi/plan, POST/PUT/DELETE
//    /api/pi/plan/priorities, POST /api/pi/plan/reviews (server/veritabench.ts).
//    Account-scoped (no lab_id), so no lab-switching logic here.

interface PIPlan {
  id: number; title: string | null; effective_year: number | null;
  program_scope: string | null; measurement_methods: string | null;
  analysis_methods: string | null; remediation_methods: string | null;
  monitor_sustain_methods: string | null;
}
interface PIPriority {
  id: number; plan_id: number; process_name: string;
  stakeholder_requirements: string | null; goal: string | null;
  improvement_activities: string | null; linked_metric_id: number | null;
  linked_department_id: number | null; sort_order: number;
}
interface PIReview {
  id: number; reviewed_by: string; reviewer_title: string | null;
  review_date: string; changes_summary: string | null; next_review_due: string | null;
}
interface PIReviewStatus {
  never_reviewed: boolean; last_review_date: string | null;
  next_review_due: string | null; overdue: boolean;
}
interface PlanMetricOpt { id: number; name: string; department_id: number; }

function PlanTextarea({ label, value, onChange, disabled, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <textarea
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-h-[64px] rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-60"
      />
    </div>
  );
}

function PIPlanTab({ readOnly, departments }: { readOnly: boolean; departments: PIDepartment[] }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<PIPlan | null>(null);
  const [priorities, setPriorities] = useState<PIPriority[]>([]);
  const [reviews, setReviews] = useState<PIReview[]>([]);
  const [reviewStatus, setReviewStatus] = useState<PIReviewStatus | null>(null);
  const [allMetrics, setAllMetrics] = useState<PlanMetricOpt[]>([]);

  const [planForm, setPlanForm] = useState({
    title: "", effective_year: String(new Date().getFullYear()), program_scope: "",
    measurement_methods: "", analysis_methods: "", remediation_methods: "", monitor_sustain_methods: "",
  });
  const [savingPlan, setSavingPlan] = useState(false);

  const [prioOpen, setPrioOpen] = useState(false);
  const [prioEdit, setPrioEdit] = useState<PIPriority | null>(null);
  const [prioForm, setPrioForm] = useState({ process_name: "", stakeholder_requirements: "", goal: "", improvement_activities: "", linked_department_id: "", linked_metric_id: "", sort_order: "0" });
  const [savingPrio, setSavingPrio] = useState(false);
  const [deletePrio, setDeletePrio] = useState<PIPriority | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewForm, setReviewForm] = useState({ reviewed_by: "", reviewer_title: "", review_date: today, changes_summary: "" });
  const [savingReview, setSavingReview] = useState(false);

  async function loadPlan() {
    try {
      const res = await fetch(`${API_BASE}/api/pi/plan`, { headers: authHeaders() });
      if (res.ok) {
        const d = await res.json();
        setPlan(d.plan);
        setPriorities(d.priorities || []);
        setReviews(d.reviews || []);
        setReviewStatus(d.review_status);
        if (d.plan) {
          setPlanForm({
            title: d.plan.title || "",
            effective_year: d.plan.effective_year != null ? String(d.plan.effective_year) : String(new Date().getFullYear()),
            program_scope: d.plan.program_scope || "",
            measurement_methods: d.plan.measurement_methods || "",
            analysis_methods: d.plan.analysis_methods || "",
            remediation_methods: d.plan.remediation_methods || "",
            monitor_sustain_methods: d.plan.monitor_sustain_methods || "",
          });
        }
      }
    } catch { /* surfaced via empty state */ } finally { setLoading(false); }
  }

  async function loadAllMetrics() {
    try {
      const lists = await Promise.all((departments || []).map(async (dept) => {
        const res = await fetch(`${API_BASE}/api/pi/metrics?department_id=${dept.id}`, { headers: authHeaders() });
        if (!res.ok) return [] as PlanMetricOpt[];
        const ms = await res.json();
        return (ms as any[]).map((m) => ({ id: m.id, name: m.name, department_id: dept.id }));
      }));
      setAllMetrics(lists.flat());
    } catch { /* metric linkage is optional */ }
  }

  useEffect(() => { loadPlan(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { if (departments && departments.length) loadAllMetrics(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [departments]);

  async function savePlan() {
    setSavingPlan(true);
    try {
      const res = await fetch(`${API_BASE}/api/pi/plan`, {
        method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          title: planForm.title.trim() || null,
          effective_year: planForm.effective_year ? Number(planForm.effective_year) : null,
          program_scope: planForm.program_scope.trim() || null,
          measurement_methods: planForm.measurement_methods.trim() || null,
          analysis_methods: planForm.analysis_methods.trim() || null,
          remediation_methods: planForm.remediation_methods.trim() || null,
          monitor_sustain_methods: planForm.monitor_sustain_methods.trim() || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { toast({ title: "PI plan saved" }); await loadPlan(); }
      else toast({ title: "Error", description: d.error || "Save failed", variant: "destructive" });
    } finally { setSavingPlan(false); }
  }

  function openAddPrio() {
    setPrioEdit(null);
    setPrioForm({ process_name: "", stakeholder_requirements: "", goal: "", improvement_activities: "", linked_department_id: "", linked_metric_id: "", sort_order: String(priorities.length) });
    setPrioOpen(true);
  }
  function openEditPrio(p: PIPriority) {
    setPrioEdit(p);
    setPrioForm({
      process_name: p.process_name || "", stakeholder_requirements: p.stakeholder_requirements || "",
      goal: p.goal || "", improvement_activities: p.improvement_activities || "",
      linked_department_id: p.linked_department_id != null ? String(p.linked_department_id) : "",
      linked_metric_id: p.linked_metric_id != null ? String(p.linked_metric_id) : "",
      sort_order: String(p.sort_order ?? 0),
    });
    setPrioOpen(true);
  }
  async function savePrio() {
    if (!plan) return;
    if (!prioForm.process_name.trim()) { toast({ title: "Process name is required", variant: "destructive" }); return; }
    setSavingPrio(true);
    try {
      const body = {
        plan_id: plan.id, process_name: prioForm.process_name.trim(),
        stakeholder_requirements: prioForm.stakeholder_requirements.trim() || null,
        goal: prioForm.goal.trim() || null,
        improvement_activities: prioForm.improvement_activities.trim() || null,
        linked_department_id: prioForm.linked_department_id ? Number(prioForm.linked_department_id) : null,
        linked_metric_id: prioForm.linked_metric_id ? Number(prioForm.linked_metric_id) : null,
        sort_order: prioForm.sort_order ? Number(prioForm.sort_order) : 0,
      };
      const url = prioEdit ? `${API_BASE}/api/pi/plan/priorities/${prioEdit.id}` : `${API_BASE}/api/pi/plan/priorities`;
      const res = await fetch(url, { method: prioEdit ? "PUT" : "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { toast({ title: prioEdit ? "Priority updated" : "Priority added" }); setPrioOpen(false); await loadPlan(); }
      else toast({ title: "Error", description: d.error || "Save failed", variant: "destructive" });
    } finally { setSavingPrio(false); }
  }
  async function confirmDeletePrio() {
    if (!deletePrio) return;
    try {
      const res = await fetch(`${API_BASE}/api/pi/plan/priorities/${deletePrio.id}`, { method: "DELETE", headers: authHeaders() });
      if (res.ok) { toast({ title: "Priority removed" }); setDeletePrio(null); await loadPlan(); }
      else { const d = await res.json().catch(() => ({})); toast({ title: "Error", description: d.error, variant: "destructive" }); }
    } catch { toast({ title: "Error", variant: "destructive" }); }
  }
  async function saveReview() {
    if (!plan) return;
    if (!reviewForm.reviewed_by.trim() || !reviewForm.review_date) { toast({ title: "Reviewer and date are required", variant: "destructive" }); return; }
    setSavingReview(true);
    try {
      const res = await fetch(`${API_BASE}/api/pi/plan/reviews`, {
        method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: plan.id, reviewed_by: reviewForm.reviewed_by.trim(),
          reviewer_title: reviewForm.reviewer_title.trim() || null,
          review_date: reviewForm.review_date, changes_summary: reviewForm.changes_summary.trim() || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { toast({ title: "Leadership review recorded" }); setReviewOpen(false); setReviewForm({ reviewed_by: "", reviewer_title: "", review_date: today, changes_summary: "" }); await loadPlan(); }
      else toast({ title: "Error", description: d.error || "Save failed", variant: "destructive" });
    } finally { setSavingReview(false); }
  }

  const deptName = (id: number | null) => departments.find((d) => d.id === id)?.name || "";
  const metricName = (id: number | null) => allMetrics.find((m) => m.id === id)?.name || "";

  if (loading) return <div className="text-center py-12 text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6" data-testid="pi-plan-tab">
      {plan && reviewStatus && (
        <div className={`rounded-lg border px-4 py-3 text-sm flex items-center gap-2 ${reviewStatus.overdue ? "border-[#A12C7B] bg-[#A12C7B]/5 text-[#A12C7B]" : "border-[#437A22] bg-[#437A22]/5 text-[#437A22]"}`} data-testid="pi-plan-review-banner">
          <AlertTriangle size={16} className="shrink-0" />
          <span>
            {reviewStatus.never_reviewed
              ? "No leadership review on record yet. The PI plan should be reviewed by leadership at least annually."
              : reviewStatus.overdue
              ? `Annual leadership review is overdue (was due ${reviewStatus.next_review_due}).`
              : `Last reviewed ${reviewStatus.last_review_date}. Next leadership review due ${reviewStatus.next_review_due}.`}
          </span>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Performance Improvement Program Plan</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!plan && <p className="text-sm text-muted-foreground">No PI plan yet. Fill this in and save to create your program plan.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <Label className="text-xs">Plan title</Label>
              <Input value={planForm.title} disabled={readOnly} onChange={(e) => setPlanForm({ ...planForm, title: e.target.value })} placeholder="Laboratory Performance Improvement Plan" />
            </div>
            <div>
              <Label className="text-xs">Effective year</Label>
              <Input type="text" inputMode="decimal" value={planForm.effective_year} disabled={readOnly} onChange={(e) => setPlanForm({ ...planForm, effective_year: e.target.value })} />
            </div>
          </div>
          <PlanTextarea label="Program scope" value={planForm.program_scope} disabled={readOnly} onChange={(v) => setPlanForm({ ...planForm, program_scope: v })} placeholder="Which departments, processes, and populations the PI program covers." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PlanTextarea label="Measurement methods" value={planForm.measurement_methods} disabled={readOnly} onChange={(v) => setPlanForm({ ...planForm, measurement_methods: v })} placeholder="How performance is measured: metrics, data sources, frequency." />
            <PlanTextarea label="Analysis methods" value={planForm.analysis_methods} disabled={readOnly} onChange={(v) => setPlanForm({ ...planForm, analysis_methods: v })} placeholder="How data is analyzed and compared to targets or benchmarks." />
            <PlanTextarea label="Remediation methods" value={planForm.remediation_methods} disabled={readOnly} onChange={(v) => setPlanForm({ ...planForm, remediation_methods: v })} placeholder="How improvement actions are taken when a target is missed." />
            <PlanTextarea label="Monitor and sustain methods" value={planForm.monitor_sustain_methods} disabled={readOnly} onChange={(v) => setPlanForm({ ...planForm, monitor_sustain_methods: v })} placeholder="How gains are monitored and sustained over time." />
          </div>
          {!readOnly && (
            <div className="flex justify-end">
              <Button onClick={savePlan} disabled={savingPlan}><Save size={14} className="mr-1.5" />{savingPlan ? "Saving..." : "Save plan"}</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Improvement Priorities</CardTitle>
          {!readOnly && plan && <Button size="sm" onClick={openAddPrio}><Plus size={14} className="mr-1.5" />Add priority</Button>}
        </CardHeader>
        <CardContent>
          {!plan ? (
            <p className="text-sm text-muted-foreground">Save the program plan first to add improvement priorities.</p>
          ) : priorities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No priorities yet. Add the processes leadership has prioritized for improvement.</p>
          ) : (
            <div className="space-y-3">
              {priorities.map((p) => (
                <div key={p.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium">{p.process_name}</div>
                    {!readOnly && (
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => openEditPrio(p)}><Edit2 size={13} /></Button>
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeletePrio(p)}><Trash2 size={13} /></Button>
                      </div>
                    )}
                  </div>
                  {p.goal && <div className="text-sm mt-1"><span className="text-muted-foreground">Goal:</span> {p.goal}</div>}
                  {p.stakeholder_requirements && <div className="text-sm mt-1"><span className="text-muted-foreground">Stakeholder requirements:</span> {p.stakeholder_requirements}</div>}
                  {p.improvement_activities && <div className="text-sm mt-1"><span className="text-muted-foreground">Activities:</span> {p.improvement_activities}</div>}
                  {(p.linked_department_id || p.linked_metric_id) ? (
                    <div className="text-xs text-muted-foreground mt-2 flex gap-3 flex-wrap">
                      {p.linked_department_id ? <span>Dept: {deptName(p.linked_department_id)}</span> : null}
                      {p.linked_metric_id ? <span>Metric: {metricName(p.linked_metric_id)}</span> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Annual Leadership Review</CardTitle>
          {!readOnly && plan && <Button size="sm" onClick={() => setReviewOpen(true)}><Plus size={14} className="mr-1.5" />Record review</Button>}
        </CardHeader>
        <CardContent>
          {!plan ? (
            <p className="text-sm text-muted-foreground">Save the program plan first to record a leadership review.</p>
          ) : reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leadership reviews recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Reviewed by</th><th className="py-2 pr-3">Title</th><th className="py-2 pr-3">Changes</th><th className="py-2 pr-3">Next due</th>
                  </tr>
                </thead>
                <tbody>
                  {reviews.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3 whitespace-nowrap">{r.review_date}</td>
                      <td className="py-2 pr-3">{r.reviewed_by}</td>
                      <td className="py-2 pr-3">{r.reviewer_title || "—"}</td>
                      <td className="py-2 pr-3">{r.changes_summary || "—"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{r.next_review_due || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={prioOpen} onOpenChange={setPrioOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{prioEdit ? "Edit priority" : "Add improvement priority"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">Process name</Label><Input value={prioForm.process_name} onChange={(e) => setPrioForm({ ...prioForm, process_name: e.target.value })} placeholder="e.g., Critical value notification" /></div>
            <PlanTextarea label="Stakeholder requirements" value={prioForm.stakeholder_requirements} onChange={(v) => setPrioForm({ ...prioForm, stakeholder_requirements: v })} />
            <PlanTextarea label="Goal" value={prioForm.goal} onChange={(v) => setPrioForm({ ...prioForm, goal: v })} />
            <PlanTextarea label="Improvement activities" value={prioForm.improvement_activities} onChange={(v) => setPrioForm({ ...prioForm, improvement_activities: v })} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Linked department</Label>
                <Select value={prioForm.linked_department_id || "none"} onValueChange={(v) => setPrioForm({ ...prioForm, linked_department_id: v === "none" ? "" : v, linked_metric_id: "" })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {departments.map((d) => <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Linked metric</Label>
                <Select value={prioForm.linked_metric_id || "none"} onValueChange={(v) => setPrioForm({ ...prioForm, linked_metric_id: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {allMetrics.filter((m) => !prioForm.linked_department_id || m.department_id === Number(prioForm.linked_department_id)).map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setPrioOpen(false)}>Cancel</Button>
            <Button onClick={savePrio} disabled={savingPrio}>{savingPrio ? "Saving..." : (prioEdit ? "Save" : "Add")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record leadership review</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="text-xs">Reviewed by</Label><Input value={reviewForm.reviewed_by} onChange={(e) => setReviewForm({ ...reviewForm, reviewed_by: e.target.value })} /></div>
              <div><Label className="text-xs">Reviewer title</Label><Input value={reviewForm.reviewer_title} onChange={(e) => setReviewForm({ ...reviewForm, reviewer_title: e.target.value })} placeholder="Medical Director" /></div>
            </div>
            <div><Label className="text-xs">Review date</Label><Input type="date" value={reviewForm.review_date} onChange={(e) => setReviewForm({ ...reviewForm, review_date: e.target.value })} /></div>
            <PlanTextarea label="Changes summary" value={reviewForm.changes_summary} onChange={(v) => setReviewForm({ ...reviewForm, changes_summary: v })} placeholder="What leadership reviewed and any changes made to the plan." />
            <p className="text-xs text-muted-foreground">The next review is automatically stamped 12 months out.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button onClick={saveReview} disabled={savingReview}>{savingReview ? "Saving..." : "Record"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletePrio} onOpenChange={(o) => !o && setDeletePrio(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this priority?</AlertDialogTitle>
            <AlertDialogDescription>{deletePrio?.process_name} will be removed from the plan. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeletePrio} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// -- Main Component -----------------------------------------------------------

export default function VeritaBenchPIPage() {
  const { user, isLoggedIn } = useAuth();
  const readOnly = useIsReadOnly("veritabench");
  const { toast } = useToast();
  const [tab, setTab] = useState<"dashboard" | "data" | "plan">("dashboard");

  // Data state
  const [departments, setDepartments] = useState<PIDepartment[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>("");
  const [metrics, setMetrics] = useState<PIMetric[]>([]);
  const [entries, setEntries] = useState<PIEntry[]>([]);
  const [dashboardData, setDashboardData] = useState<DashboardMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [entryMonth, setEntryMonth] = useState<number>(new Date().getMonth() + 1);

  // Entry form state (batch editing)
  const [entryValues, setEntryValues] = useState<Record<number, { value: string; volume: string; notes: string }>>({});
  const [saving, setSaving] = useState(false);
  // Wave D4: root-cause documentation dialog state.
  const [rcaEntry, setRcaEntry] = useState<PIEntry | null>(null);
  const [rcaMetricName, setRcaMetricName] = useState("");
  const [rcaForm, setRcaForm] = useState({ root_cause: "", corrective_action: "", reviewed_by: "" });
  const [rcaSaving, setRcaSaving] = useState(false);

  function openRca(metric: PIMetric) {
    const entry = entries.find(e => e.metric_id === metric.id && e.month === entryMonth) || null;
    if (!entry) { toast({ title: "Save the value first", description: "Enter and save this month's value before documenting a root cause." }); return; }
    setRcaEntry(entry);
    setRcaMetricName(metric.name);
    setRcaForm({ root_cause: entry.root_cause || "", corrective_action: entry.corrective_action || "", reviewed_by: entry.rca_reviewed_by || "" });
  }

  async function saveRca(clear = false) {
    if (!rcaEntry) return;
    setRcaSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/pi/entries/${rcaEntry.id}/rca`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(clear ? { clear: true } : rcaForm),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { toast({ title: clear ? "Root cause cleared" : "Root cause documented" }); setRcaEntry(null); loadMetrics(); }
      else toast({ title: "Error", description: data.error, variant: "destructive" });
    } finally { setRcaSaving(false); }
  }

  // Metric edit dialog
  const [editMetric, setEditMetric] = useState<PIMetric | null>(null);
  const [metricForm, setMetricForm] = useState({ name: "", unit: "%", direction: "lower_is_better", benchmark_green: "", benchmark_yellow: "", benchmark_red: "", is_tat: false, tat_start_event: "", tat_end_event: "", tat_threshold_minutes: "", measurement_methodology: "" });
  const [showMetricDialog, setShowMetricDialog] = useState(false);
  const [deleteMetricTarget, setDeleteMetricTarget] = useState<PIMetric | null>(null);
  const [reportingId, setReportingId] = useState<number | null>(null);

  async function handlePiReport(m: PIMetric) {
    setReportingId(m.id);
    try {
      const res = await fetch(`${API_BASE}/api/pi/metrics/${m.id}/report?year=${year}`, {
        method: "POST", headers: authHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Report failed", description: err.error || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      const { token } = await res.json();
      const win = window.open(`${API_BASE}/api/pdf/${token}`, "_blank");
      if (win) {
        toast({ title: `Report generated for ${m.name}` });
      } else {
        toast({ title: "Popup blocked", description: "Allow popups for this site, then click the report button again.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Report failed", description: "Network error", variant: "destructive" });
    } finally {
      setReportingId(null);
    }
  }

  // Library browser dialog
  const [showLibraryDialog, setShowLibraryDialog] = useState(false);
  const [addingFromLibrary, setAddingFromLibrary] = useState(false);

  const hasPlanAccess = user && SUITE_PLANS.includes(user.plan);

  // Whether user has NO departments yet (first-time UX).
  // #3: a failed load must NOT be mistaken for a brand-new account, or a surveyor's
  // PI program would appear to vanish behind the setup wizard.
  const isFirstTime = !loading && !loadError && departments.length === 0;

  // -- Load departments -------------------------------------------------------

  async function loadDepartments() {
    setLoadError(false);
    try {
      const res = await fetch(`${API_BASE}/api/pi/departments`, { headers: authHeaders() });
      if (res.ok) {
        const depts = await res.json();
        setDepartments(depts);
        if (depts.length > 0 && !selectedDeptId) {
          setSelectedDeptId(String(depts[0].id));
        }
      } else { setLoadError(true); }
    } catch { setLoadError(true); } finally { setLoading(false); }
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess) loadDepartments();
    else setLoading(false);
  }, [isLoggedIn, hasPlanAccess]);

  // -- Load metrics + entries when department or year changes ------------------
  // #19: re-set loading around the switch so the previous department's data is
  // not shown under the newly-selected department's header while the new data
  // is still in flight.
  useEffect(() => {
    if (!selectedDeptId || !isLoggedIn || !hasPlanAccess) return;
    setLoading(true);
    setLoadError(false);
    Promise.all([loadMetrics(), loadEntries(), loadDashboard()]).finally(() => setLoading(false));
  }, [selectedDeptId, year]);

  function retryAll() {
    setLoadError(false);
    setLoading(true);
    if (selectedDeptId) {
      Promise.all([loadMetrics(), loadEntries(), loadDashboard()]).finally(() => setLoading(false));
    } else {
      loadDepartments();
    }
  }

  async function loadMetrics() {
    try {
      const res = await fetch(`${API_BASE}/api/pi/metrics?department_id=${selectedDeptId}`, { headers: authHeaders() });
      if (res.ok) setMetrics(await res.json());
      else setLoadError(true);
    } catch { setLoadError(true); }
  }

  async function loadEntries() {
    try {
      const res = await fetch(`${API_BASE}/api/pi/entries?year=${year}&department_id=${selectedDeptId}`, { headers: authHeaders() });
      if (res.ok) setEntries(await res.json());
      else setLoadError(true);
    } catch { setLoadError(true); }
  }

  async function loadDashboard() {
    try {
      const res = await fetch(`${API_BASE}/api/pi/dashboard?year=${year}&department_id=${selectedDeptId}`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setDashboardData(data.metrics || []);
      } else { setLoadError(true); }
    } catch { setLoadError(true); }
  }

  // -- Populate entry form when month/metrics/entries change ------------------

  useEffect(() => {
    const newValues: Record<number, { value: string; volume: string; notes: string }> = {};
    for (const m of metrics) {
      const entry = entries.find(e => e.metric_id === m.id && e.month === entryMonth);
      newValues[m.id] = {
        value: entry?.value != null ? String(entry.value) : "",
        volume: entry?.volume != null ? String(entry.volume) : "",
        notes: entry?.notes ?? "",
      };
    }
    setEntryValues(newValues);
  }, [metrics, entries, entryMonth]);

  // -- Save all entries for selected month ------------------------------------

  async function handleSaveAll() {
    setSaving(true);
    // #16: the batch save POSTed each entry and ignored every response, then
    // always toasted "Saved". Count failures so a rejected entry (validation,
    // permission, network) is reported instead of silently dropped, and keep the
    // typed values on screen on partial failure rather than reloading over them.
    let attempted = 0, failed = 0;
    try {
      for (const m of metrics) {
        const vals = entryValues[m.id];
        if (!vals) continue;
        if (vals.value === "" && vals.volume === "" && vals.notes === "") continue;
        attempted++;
        const res = await fetch(`${API_BASE}/api/pi/entries`, {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            metric_id: m.id,
            year,
            month: entryMonth,
            value: vals.value !== "" ? parseFloat(vals.value) : null,
            volume: vals.volume !== "" ? parseInt(vals.volume) : null,
            notes: vals.notes || null,
          }),
        });
        if (!res.ok) failed++;
      }
      if (failed === 0) {
        toast({ title: attempted > 0 ? "Saved" : "Nothing to save" });
        loadEntries();
        loadDashboard();
      } else {
        toast({
          title: `Saved ${attempted - failed} of ${attempted}`,
          description: `${failed} ${failed === 1 ? "entry" : "entries"} did not save. Your values remain on screen; press Save All to retry.`,
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Save failed", description: "Your values remain on screen; press Save All to retry.", variant: "destructive" });
    } finally { setSaving(false); }
  }

  // -- Metric CRUD ------------------------------------------------------------

  function openAddMetric() {
    setEditMetric(null);
    setMetricForm({ name: "", unit: "%", direction: "lower_is_better", benchmark_green: "", benchmark_yellow: "", benchmark_red: "", is_tat: false, tat_start_event: "", tat_end_event: "", tat_threshold_minutes: "", measurement_methodology: "" });
    setShowMetricDialog(true);
  }

  function openEditMetric(m: PIMetric) {
    setEditMetric(m);
    setMetricForm({
      name: m.name,
      unit: m.unit,
      direction: m.direction,
      benchmark_green: m.benchmark_green != null ? String(m.benchmark_green) : "",
      benchmark_yellow: m.benchmark_yellow != null ? String(m.benchmark_yellow) : "",
      benchmark_red: m.benchmark_red != null ? String(m.benchmark_red) : "",
      is_tat: !!m.is_tat,
      tat_start_event: m.tat_start_event ?? "",
      tat_end_event: m.tat_end_event ?? "",
      tat_threshold_minutes: m.tat_threshold_minutes != null ? String(m.tat_threshold_minutes) : "",
      measurement_methodology: m.measurement_methodology ?? "",
    });
    setShowMetricDialog(true);
  }

  async function handleSaveMetric() {
    const payload = {
      department_id: parseInt(selectedDeptId),
      name: metricForm.name,
      unit: metricForm.unit,
      direction: metricForm.direction,
      benchmark_green: metricForm.benchmark_green !== "" ? parseFloat(metricForm.benchmark_green) : null,
      benchmark_yellow: metricForm.benchmark_yellow !== "" ? parseFloat(metricForm.benchmark_yellow) : null,
      benchmark_red: metricForm.benchmark_red !== "" ? parseFloat(metricForm.benchmark_red) : null,
      is_tat: metricForm.is_tat,
      tat_start_event: metricForm.is_tat ? (metricForm.tat_start_event || null) : null,
      tat_end_event: metricForm.is_tat ? (metricForm.tat_end_event || null) : null,
      tat_threshold_minutes: metricForm.is_tat && metricForm.tat_threshold_minutes !== "" ? parseFloat(metricForm.tat_threshold_minutes) : null,
      measurement_methodology: metricForm.measurement_methodology || null,
    };
    try {
      const url = editMetric ? `${API_BASE}/api/pi/metrics/${editMetric.id}` : `${API_BASE}/api/pi/metrics`;
      const method = editMetric ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        toast({ title: editMetric ? "Updated" : "Created" });
        setShowMetricDialog(false);
        loadMetrics();
        loadDashboard();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error, variant: "destructive" });
      }
    } catch { toast({ title: "Save failed", variant: "destructive" }); }
  }

  async function handleDeleteMetric() {
    if (!deleteMetricTarget) return;
    try {
      const res = await fetch(`${API_BASE}/api/pi/metrics/${deleteMetricTarget.id}`, { method: "DELETE", headers: authHeaders() });
      if (res.ok) {
        toast({ title: "Deleted" });
        loadMetrics();
        loadEntries();
        loadDashboard();
      } else { const e = await res.json().catch(() => ({})); toast({ title: "Delete failed", description: e.error, variant: "destructive" }); }
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
    setDeleteMetricTarget(null);
  }

  // -- Add selected metrics from starter library ------------------------------

  async function handleAddFromLibrary(selectedMetrics: StarterMetric[]) {
    setAddingFromLibrary(true);
    // #18: the department- and metric-create calls ignored their responses, so a
    // rejected create was silently dropped while the toast still claimed success.
    // Count what actually landed and report accurately.
    let added = 0, failed = 0;
    try {
      // Group by department
      const byDept: Record<string, StarterMetric[]> = {};
      for (const m of selectedMetrics) {
        if (!byDept[m.department]) byDept[m.department] = [];
        byDept[m.department].push(m);
      }

      // Create departments as needed, then metrics
      const existingDeptNames = new Set(departments.map(d => d.name));
      const deptIdMap: Record<string, number> = {};
      for (const d of departments) {
        deptIdMap[d.name] = d.id;
      }

      for (const [deptName, deptMetrics] of Object.entries(byDept)) {
        let deptId = deptIdMap[deptName];
        if (!existingDeptNames.has(deptName)) {
          const res = await fetch(`${API_BASE}/api/pi/departments`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ name: deptName, sort_order: PI_STARTER_DEPARTMENTS.indexOf(deptName as any) }),
          });
          if (res.ok) {
            const newDept = await res.json();
            deptId = newDept.id;
            deptIdMap[deptName] = deptId;
            existingDeptNames.add(deptName);
          } else {
            // The whole department (and its metrics) could not be created.
            failed += deptMetrics.length;
            continue;
          }
        }

        for (let i = 0; i < deptMetrics.length; i++) {
          const m = deptMetrics[i];
          const res = await fetch(`${API_BASE}/api/pi/metrics`, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({
              department_id: deptId,
              name: m.name,
              unit: m.unit,
              direction: m.direction,
              sort_order: i,
            }),
          });
          if (res.ok) added++; else failed++;
        }
      }

      if (failed === 0) {
        toast({ title: `Added ${added} metric${added !== 1 ? "s" : ""}` });
      } else {
        toast({
          title: `Added ${added} of ${added + failed}`,
          description: `${failed} metric${failed !== 1 ? "s" : ""} could not be added. Try again for the remainder.`,
          variant: added > 0 ? "default" : "destructive",
        });
      }
      setShowLibraryDialog(false);
      // Reload everything
      await loadDepartments();
      if (selectedDeptId) {
        loadMetrics();
        loadEntries();
        loadDashboard();
      }
    } catch {
      toast({ title: "Failed to add metrics", variant: "destructive" });
    } finally {
      setAddingFromLibrary(false);
    }
  }

  // -- Computed dashboard values ----------------------------------------------

  const summaryStats = useMemo(() => {
    const total = dashboardData.length;
    const greenCount = dashboardData.filter(d => d.currentStatus === "green").length;
    const yellowRedCount = dashboardData.filter(d => d.currentStatus === "yellow" || d.currentStatus === "red").length;
    const withData = dashboardData.filter(d => d.dataPointCount > 0).length;
    const completeness = total > 0 ? Math.round((withData / total) * 100) : 0;
    return { total, greenCount, yellowRedCount, completeness };
  }, [dashboardData]);

  function getBenchmarkStatusForValue(value: number | null, metric: PIMetric): string | null {
    if (value == null) return null;
    if (metric.benchmark_green == null && metric.benchmark_yellow == null) return null;
    if (metric.direction === "lower_is_better") {
      if (metric.benchmark_green != null && value <= metric.benchmark_green) return "green";
      if (metric.benchmark_yellow != null && value <= metric.benchmark_yellow) return "yellow";
      return "red";
    } else {
      if (metric.benchmark_green != null && value >= metric.benchmark_green) return "green";
      if (metric.benchmark_yellow != null && value >= metric.benchmark_yellow) return "yellow";
      return "red";
    }
  }

  // Set of existing metric names (for duplicate detection in library browser)
  const existingMetricNames = useMemo(() => new Set(metrics.map(m => m.name)), [metrics]);

  // -- Auth gates -------------------------------------------------------------

  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <Lock size={40} className="text-muted-foreground mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">Sign in to access VeritaQA{"\u2122"}</h2>
        <p className="text-muted-foreground mb-6 max-w-md">Track department quality metrics and performance improvement data.</p>
        <Button asChild><Link href="/login">Sign in</Link></Button>
      </div>
    );
  }

  if (!hasPlanAccess) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <Users size={40} className="text-muted-foreground mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">Upgrade to access VeritaQA{"\u2122"}</h2>
        <p className="text-muted-foreground mb-6 max-w-md">VeritaQA{"\u2122"} is included in all VeritaAssure{"\u2122"} suite plans. Subscribe to get started.</p>
        <Button asChild style={{ backgroundColor: "#01696F" }}><Link href="/pricing">View Plans</Link></Button>
      </div>
    );
  }

  // -- Load-error view (nothing loaded) ---------------------------------------

  if (loadError && !loading && departments.length === 0) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>Couldn't load your PI program. This is a load error, not a new or empty account, and your saved metrics are not affected.</span>
          <Button variant="outline" size="sm" onClick={retryAll} className="border-red-300 text-red-800 hover:bg-red-100 shrink-0">Retry</Button>
        </div>
      </div>
    );
  }

  // -- First-time Setup View --------------------------------------------------

  if (isFirstTime) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="text-center mb-8">
          <Library size={40} className="mx-auto mb-4" style={{ color: "#01696F" }} />
          <h1 className="font-serif text-2xl font-bold mb-2" style={{ color: "#01696F" }}>
            Set Up Your PI Program
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Select the metrics that matter to your laboratory. You can customize names, units, and benchmark thresholds after selection.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BookOpen size={16} style={{ color: "#01696F" }} />
              PI Metric Starter Library
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              161 metrics across 11 departments, drawn from CAP Q-Probes/Q-Tracks, AABB, CLSI, CLIA, TJC, and ISO 15189.
            </p>
          </CardHeader>
          <CardContent>
            <StarterLibraryPicker
              onAddSelected={handleAddFromLibrary}
              adding={addingFromLibrary}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // -- Normal Dashboard/Data View ---------------------------------------------

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-serif text-2xl font-bold" style={{ color: "#01696F" }}>VeritaQA™</h1>
          <p className="text-sm text-muted-foreground mt-1">Department quality metrics and performance improvement tracking</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select department" />
            </SelectTrigger>
            <SelectContent>
              {departments.map(d => (
                <SelectItem key={d.id} value={String(d.id)}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={v => setYear(parseInt(v))}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2024, 2025, 2026, 2027].map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* #3: partial load failure (some data loaded) reads as an error, not empty data. */}
      {loadError && (
        <div role="alert" className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <span>Some PI data couldn't be loaded. Figures below may be incomplete; this is a load error, not empty data.</span>
          <Button variant="outline" size="sm" onClick={retryAll} className="border-red-300 text-red-800 hover:bg-red-100 shrink-0">Retry</Button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        <button onClick={() => setTab("dashboard")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "dashboard" ? "border-[#01696F] text-[#01696F]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <BarChart3 size={14} className="inline mr-1.5" />Dashboard
        </button>
        <button onClick={() => setTab("data")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "data" ? "border-[#01696F] text-[#01696F]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <Activity size={14} className="inline mr-1.5" />Data Entry
        </button>
        <button onClick={() => setTab("plan")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "plan" ? "border-[#01696F] text-[#01696F]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <BookOpen size={14} className="inline mr-1.5" />Plan
        </button>
      </div>

      {tab === "plan" && <PIPlanTab readOnly={readOnly} departments={departments} />}

      {/* -- Dashboard Tab -------------------------------------------------- */}
      {tab === "dashboard" && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Metrics Tracked</div>
                <div className="text-3xl font-bold font-mono mt-1" style={{ color: "#01696F" }}>
                  {summaryStats.total}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Active metrics</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">In Green</div>
                <div className="text-3xl font-bold font-mono mt-1" style={{ color: "#437A22" }}>
                  {summaryStats.greenCount}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Within target</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Yellow/Red</div>
                <div className="text-3xl font-bold font-mono mt-1" style={{ color: summaryStats.yellowRedCount > 0 ? "#A12C7B" : "#01696F" }}>
                  {summaryStats.yellowRedCount}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Need attention</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Data Completeness</div>
                <div className="text-3xl font-bold font-mono mt-1" style={{ color: "#01696F" }}>
                  {summaryStats.completeness}%
                </div>
                <div className="text-xs text-muted-foreground mt-1">Metrics with data</div>
              </CardContent>
            </Card>
          </div>

          {/* Metric Cards */}
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : dashboardData.length === 0 ? (
            <div className="text-center py-12">
              <Activity size={40} className="mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-2">No metrics found for this department.</p>
              <p className="text-xs text-muted-foreground">Switch to the Data Entry tab to add metrics and enter values.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {dashboardData.map(dm => {
                const sparkData = Array.from({ length: 12 }, (_, i) => ({
                  month: i + 1,
                  value: dm.monthlyValues[i + 1]?.value ?? null,
                }));

                return (
                  <Card key={dm.metric.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-sm font-medium">{dm.metric.name}</CardTitle>
                          <div className="text-xs text-muted-foreground">{dm.metric.unit}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusDot status={dm.currentStatus} />
                          <span className="text-lg font-bold font-mono" style={{ color: "#01696F" }}>
                            {dm.currentValue != null ? dm.currentValue.toFixed(2) : "-"}
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="mb-3">
                        <MiniSparkline data={sparkData} />
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">YTD Avg</span>
                          <span className="font-mono font-medium flex items-center gap-1">
                            {dm.ytdAvg != null ? dm.ytdAvg.toFixed(2) : "-"}
                            {dm.ytdStatus && <StatusDot status={dm.ytdStatus} />}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Prior Year</span>
                          <span className="font-mono font-medium flex items-center gap-1">
                            {dm.pyAvg != null ? dm.pyAvg.toFixed(2) : "-"}
                            {dm.pyStatus && <StatusDot status={dm.pyStatus} />}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Q1</span>
                          <span className="font-mono">{dm.quarters.Q1 != null ? dm.quarters.Q1.toFixed(2) : "-"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Q2</span>
                          <span className="font-mono">{dm.quarters.Q2 != null ? dm.quarters.Q2.toFixed(2) : "-"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Q3</span>
                          <span className="font-mono">{dm.quarters.Q3 != null ? dm.quarters.Q3.toFixed(2) : "-"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Q4</span>
                          <span className="font-mono">{dm.quarters.Q4 != null ? dm.quarters.Q4.toFixed(2) : "-"}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Benchmark Legend */}
          {dashboardData.length > 0 && (
            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2">
              <span className="font-medium">Benchmark:</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#437A22" }} /> Green = within target</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#964219" }} /> Yellow = approaching threshold</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#A12C7B" }} /> Red = outside acceptable range</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-300" /> Gray = no benchmark set</span>
            </div>
          )}
        </div>
      )}

      {/* -- Data Entry Tab ------------------------------------------------- */}
      {tab === "data" && (
        <div className="space-y-6">
          {/* Month selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={String(entryMonth)} onValueChange={v => setEntryMonth(parseInt(v))}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FULL_MONTHS.slice(1).map((m, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">{year}</span>
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLibraryDialog(true)}
                disabled={readOnly}
              >
                <BookOpen size={14} className="mr-1.5" />Browse Metric Library
              </Button>
              <Button variant="outline" size="sm" onClick={openAddMetric} disabled={readOnly || !selectedDeptId}>
                <Plus size={14} className="mr-1.5" />Add Metric
              </Button>
            </div>
          </div>

          {/* Data table */}
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : metrics.length === 0 ? (
            <div className="text-center py-12">
              <Activity size={40} className="mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">No metrics configured for this department.</p>
              <div className="flex gap-2 justify-center">
                <Button
                  variant="outline"
                  onClick={() => setShowLibraryDialog(true)}
                  disabled={readOnly}
                >
                  <BookOpen size={14} className="mr-1.5" />Browse Metric Library
                </Button>
                <Button onClick={openAddMetric} disabled={readOnly || !selectedDeptId} style={{ backgroundColor: "#01696F" }}>
                  <Plus size={14} className="mr-1.5" />Add Metric
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b" style={{ backgroundColor: "#01696F10" }}>
                      <th className="text-left px-3 py-2 font-medium">Metric Name</th>
                      <th className="text-right px-3 py-2 font-medium w-[120px]">Value</th>
                      <th className="text-right px-3 py-2 font-medium w-[120px]">Volume</th>
                      <th className="text-center px-3 py-2 font-medium w-[60px]">Status</th>
                      <th className="text-left px-3 py-2 font-medium">Notes</th>
                      <th className="px-3 py-2 w-[80px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((m, i) => {
                      const vals = entryValues[m.id] || { value: "", volume: "", notes: "" };
                      const parsedVal = vals.value !== "" ? parseFloat(vals.value) : null;
                      const status = getBenchmarkStatusForValue(parsedVal, m);
                      return (
                        <tr key={m.id} className={`border-b hover:bg-muted/30 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                          <td className="px-3 py-2">
                            <div className="font-medium">{m.name}</div>
                            <div className="text-xs text-muted-foreground">{m.unit}</div>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="text" inputMode="decimal"
                              step="any"
                              className="text-right font-mono h-8"
                              value={vals.value}
                              onChange={e => setEntryValues(prev => ({ ...prev, [m.id]: { ...prev[m.id], value: e.target.value } }))}
                              disabled={readOnly}
                              placeholder="-"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="text" inputMode="decimal"
                              className="text-right font-mono h-8"
                              value={vals.volume}
                              onChange={e => setEntryValues(prev => ({ ...prev, [m.id]: { ...prev[m.id], volume: e.target.value } }))}
                              disabled={readOnly}
                              placeholder="-"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <StatusDot status={status} />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              className="h-8 text-xs"
                              value={vals.notes}
                              onChange={e => setEntryValues(prev => ({ ...prev, [m.id]: { ...prev[m.id], notes: e.target.value } }))}
                              disabled={readOnly}
                              placeholder="Optional notes"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              {(status === "red" || status === "yellow") && (() => {
                                const entry = entries.find(e => e.metric_id === m.id && e.month === entryMonth);
                                const hasRca = !!(entry && entry.rca_reviewed_at);
                                return (
                                  <Button
                                    variant="ghost" size="icon"
                                    className={`h-7 w-7 ${hasRca ? "text-emerald-600" : "text-amber-600"}`}
                                    title={hasRca ? "Root cause documented (edit)" : "Document root cause and corrective action"}
                                    onClick={() => openRca(m)} disabled={readOnly}
                                  >
                                    <AlertTriangle size={13} />
                                  </Button>
                                );
                              })()}
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePiReport(m)} disabled={reportingId === m.id} title="Print monthly report (PDF)" data-testid={`pi-report-${m.id}`}>
                                <FileText size={13} className={reportingId === m.id ? "animate-pulse" : ""} />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditMetric(m)} disabled={readOnly}>
                                <Edit2 size={13} />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteMetricTarget(m)} disabled={readOnly}>
                                <Trash2 size={13} />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Save All */}
              <div className="flex justify-end pt-2">
                <Button onClick={handleSaveAll} disabled={saving || readOnly} style={{ backgroundColor: "#01696F" }}>
                  <Save size={14} className="mr-1.5" />{saving ? "Saving..." : "Save All"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {/* -- Metric Add/Edit Dialog ----------------------------------------- */}
      <Dialog open={showMetricDialog} onOpenChange={setShowMetricDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editMetric ? "Edit Metric" : "Add Metric"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Metric Name</Label>
              <Input value={metricForm.name} onChange={e => setMetricForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Blood Culture Contamination Rate" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Unit</Label>
                <Input value={metricForm.unit} onChange={e => setMetricForm(f => ({ ...f, unit: e.target.value }))} placeholder="e.g. %, min, ratio" />
              </div>
              <div className="space-y-1.5">
                <Label>Direction</Label>
                <Select value={metricForm.direction} onValueChange={v => setMetricForm(f => ({ ...f, direction: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lower_is_better">Lower is better</SelectItem>
                    <SelectItem value="higher_is_better">Higher is better</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: "#437A22" }} />
                  Green Threshold
                </Label>
                <Input type="text" inputMode="decimal" step="any" value={metricForm.benchmark_green} onChange={e => setMetricForm(f => ({ ...f, benchmark_green: e.target.value }))} placeholder="-" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: "#964219" }} />
                  Yellow Threshold
                </Label>
                <Input type="text" inputMode="decimal" step="any" value={metricForm.benchmark_yellow} onChange={e => setMetricForm(f => ({ ...f, benchmark_yellow: e.target.value }))} placeholder="-" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: "#A12C7B" }} />
                  Red Threshold
                </Label>
                <Input type="text" inputMode="decimal" step="any" value={metricForm.benchmark_red} onChange={e => setMetricForm(f => ({ ...f, benchmark_red: e.target.value }))} placeholder="-" />
              </div>
            </div>

            {/* Wave D2: TAT defensibility. A turnaround-time indicator needs a
                documented measurement methodology to survive a survey. */}
            <div className="rounded-md border p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={metricForm.is_tat} onChange={e => setMetricForm(f => ({ ...f, is_tat: e.target.checked }))} />
                This is a turnaround time (TAT) indicator
              </label>
              {metricForm.is_tat && (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    CLIA has no single TAT definition, so a surveyor reviews the methodology you document. Define the two clock events and the goal so the indicator is defensible.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Start event (clock starts)</Label>
                      <Select value={metricForm.tat_start_event || undefined} onValueChange={v => setMetricForm(f => ({ ...f, tat_start_event: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="collection">Specimen collection</SelectItem>
                          <SelectItem value="receipt">Lab receipt / accession</SelectItem>
                          <SelectItem value="order">Order placed</SelectItem>
                          <SelectItem value="registration">Patient registration</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>End event (clock stops)</Label>
                      <Select value={metricForm.tat_end_event || undefined} onValueChange={v => setMetricForm(f => ({ ...f, tat_end_event: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="result_verified">Result verified</SelectItem>
                          <SelectItem value="result_reported">Result reported / released</SelectItem>
                          <SelectItem value="critical_called">Critical value called</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Goal threshold (minutes)</Label>
                    <Input type="text" inputMode="decimal" step="any" value={metricForm.tat_threshold_minutes} onChange={e => setMetricForm(f => ({ ...f, tat_threshold_minutes: e.target.value }))} placeholder="e.g. 60" />
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Measurement methodology and data source</Label>
                <textarea
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px]"
                  value={metricForm.measurement_methodology}
                  onChange={e => setMetricForm(f => ({ ...f, measurement_methodology: e.target.value }))}
                  placeholder="How this indicator is measured: data source (LIS order-to-verify timestamps), exclusions (add-on tests, send-outs), and any sampling. This is the surveyor-facing answer to how do you measure this."
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowMetricDialog(false)}>Cancel</Button>
              <Button onClick={handleSaveMetric} disabled={!metricForm.name.trim()} style={{ backgroundColor: "#01696F" }}>
                {editMetric ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* -- Wave D4: Root-cause documentation dialog ----------------------- */}
      <Dialog open={!!rcaEntry} onOpenChange={(o) => { if (!o) setRcaEntry(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Root cause and corrective action</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {rcaMetricName} missed its benchmark this period. The QA review is defensible when the lab documents why and what was done, not just the number.
            </p>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Root cause</label>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px]"
                value={rcaForm.root_cause}
                onChange={e => setRcaForm(f => ({ ...f, root_cause: e.target.value }))}
                placeholder="Why the indicator missed. Address the system, not the person."
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Corrective action</label>
              <textarea
                className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px]"
                value={rcaForm.corrective_action}
                onChange={e => setRcaForm(f => ({ ...f, corrective_action: e.target.value }))}
                placeholder="What changed: process, staffing, training, vendor. Include a follow-up check if applicable."
              />
            </div>
            <input
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={rcaForm.reviewed_by}
              onChange={e => setRcaForm(f => ({ ...f, reviewed_by: e.target.value }))}
              placeholder="Reviewed by (name)"
            />
            <div className="flex justify-end gap-2 pt-1">
              {rcaEntry?.rca_reviewed_at && <Button variant="outline" size="sm" disabled={rcaSaving} onClick={() => saveRca(true)}>Clear</Button>}
              <Button size="sm" disabled={rcaSaving || (!rcaForm.root_cause.trim() && !rcaForm.corrective_action.trim())} onClick={() => saveRca(false)} style={{ backgroundColor: "#01696F" }}>
                {rcaSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* -- Delete Metric Confirm ------------------------------------------ */}
      <AlertDialog open={!!deleteMetricTarget} onOpenChange={() => setDeleteMetricTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete metric?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteMetricTarget ? `Delete "${deleteMetricTarget.name}" and all its entries? This cannot be undone.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteMetric} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* -- Browse Metric Library Dialog ----------------------------------- */}
      <Dialog open={showLibraryDialog} onOpenChange={setShowLibraryDialog}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen size={18} style={{ color: "#01696F" }} />
              PI Metric Starter Library
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              Select metrics to add to your PI program. Already-added metrics are grayed out.
            </p>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            <StarterLibraryPicker
              onAddSelected={handleAddFromLibrary}
              adding={addingFromLibrary}
              existingMetricNames={existingMetricNames}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
