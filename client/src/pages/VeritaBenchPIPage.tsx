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
  Lock, Users, Activity, BarChart3, Save, Plus, Edit2, Trash2,
  ChevronDown, ChevronRight, BookOpen, Library,
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

const SUITE_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"];
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

// -- Main Component -----------------------------------------------------------

export default function VeritaBenchPIPage() {
  const { user, isLoggedIn } = useAuth();
  const readOnly = useIsReadOnly("veritabench");
  const { toast } = useToast();
  const [tab, setTab] = useState<"dashboard" | "data">("dashboard");

  // Data state
  const [departments, setDepartments] = useState<PIDepartment[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>("");
  const [metrics, setMetrics] = useState<PIMetric[]>([]);
  const [entries, setEntries] = useState<PIEntry[]>([]);
  const [dashboardData, setDashboardData] = useState<DashboardMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [entryMonth, setEntryMonth] = useState<number>(new Date().getMonth() + 1);

  // Entry form state (batch editing)
  const [entryValues, setEntryValues] = useState<Record<number, { value: string; volume: string; notes: string }>>({});
  const [saving, setSaving] = useState(false);

  // Metric edit dialog
  const [editMetric, setEditMetric] = useState<PIMetric | null>(null);
  const [metricForm, setMetricForm] = useState({ name: "", unit: "%", direction: "lower_is_better", benchmark_green: "", benchmark_yellow: "", benchmark_red: "" });
  const [showMetricDialog, setShowMetricDialog] = useState(false);
  const [deleteMetricTarget, setDeleteMetricTarget] = useState<PIMetric | null>(null);

  // Library browser dialog
  const [showLibraryDialog, setShowLibraryDialog] = useState(false);
  const [addingFromLibrary, setAddingFromLibrary] = useState(false);

  const hasPlanAccess = user && SUITE_PLANS.includes(user.plan);

  // Whether user has NO departments yet (first-time UX)
  const isFirstTime = !loading && departments.length === 0;

  // -- Load departments -------------------------------------------------------

  async function loadDepartments() {
    try {
      const res = await fetch(`${API_BASE}/api/pi/departments`, { headers: authHeaders() });
      if (res.ok) {
        const depts = await res.json();
        setDepartments(depts);
        if (depts.length > 0 && !selectedDeptId) {
          setSelectedDeptId(String(depts[0].id));
        }
      }
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess) loadDepartments();
    else setLoading(false);
  }, [isLoggedIn, hasPlanAccess]);

  // -- Load metrics + entries when department or year changes ------------------

  useEffect(() => {
    if (!selectedDeptId || !isLoggedIn || !hasPlanAccess) return;
    loadMetrics();
    loadEntries();
    loadDashboard();
  }, [selectedDeptId, year]);

  async function loadMetrics() {
    try {
      const res = await fetch(`${API_BASE}/api/pi/metrics?department_id=${selectedDeptId}`, { headers: authHeaders() });
      if (res.ok) setMetrics(await res.json());
    } catch {}
  }

  async function loadEntries() {
    try {
      const res = await fetch(`${API_BASE}/api/pi/entries?year=${year}&department_id=${selectedDeptId}`, { headers: authHeaders() });
      if (res.ok) setEntries(await res.json());
    } catch {}
  }

  async function loadDashboard() {
    try {
      const res = await fetch(`${API_BASE}/api/pi/dashboard?year=${year}&department_id=${selectedDeptId}`, { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setDashboardData(data.metrics || []);
      }
    } catch {}
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
    try {
      for (const m of metrics) {
        const vals = entryValues[m.id];
        if (!vals) continue;
        if (vals.value === "" && vals.volume === "" && vals.notes === "") continue;
        await fetch(`${API_BASE}/api/pi/entries`, {
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
      }
      toast({ title: "Saved" });
      loadEntries();
      loadDashboard();
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally { setSaving(false); }
  }

  // -- Metric CRUD ------------------------------------------------------------

  function openAddMetric() {
    setEditMetric(null);
    setMetricForm({ name: "", unit: "%", direction: "lower_is_better", benchmark_green: "", benchmark_yellow: "", benchmark_red: "" });
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
      }
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
    setDeleteMetricTarget(null);
  }

  // -- Add selected metrics from starter library ------------------------------

  async function handleAddFromLibrary(selectedMetrics: StarterMetric[]) {
    setAddingFromLibrary(true);
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
            continue;
          }
        }

        for (let i = 0; i < deptMetrics.length; i++) {
          const m = deptMetrics[i];
          await fetch(`${API_BASE}/api/pi/metrics`, {
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
        }
      }

      toast({ title: `Added ${selectedMetrics.length} metric${selectedMetrics.length !== 1 ? "s" : ""}` });
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
        <h2 className="font-serif text-2xl font-bold mb-2">Sign in to access VeritaBench{"\u2122"}</h2>
        <p className="text-muted-foreground mb-6 max-w-md">Track department quality metrics and performance improvement data.</p>
        <Button asChild><Link href="/login">Sign in</Link></Button>
      </div>
    );
  }

  if (!hasPlanAccess) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <Users size={40} className="text-muted-foreground mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">Upgrade to access VeritaBench{"\u2122"}</h2>
        <p className="text-muted-foreground mb-6 max-w-md">VeritaBench{"\u2122"} is included in all VeritaAssure{"\u2122"} suite plans. Subscribe to get started.</p>
        <Button asChild style={{ backgroundColor: "#01696F" }}><Link href="/pricing">View Plans</Link></Button>
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

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        <button onClick={() => setTab("dashboard")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "dashboard" ? "border-[#01696F] text-[#01696F]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <BarChart3 size={14} className="inline mr-1.5" />Dashboard
        </button>
        <button onClick={() => setTab("data")} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === "data" ? "border-[#01696F] text-[#01696F]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
          <Activity size={14} className="inline mr-1.5" />Data Entry
        </button>
      </div>

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
                              type="number"
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
                              type="number"
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
                <Input type="number" step="any" value={metricForm.benchmark_green} onChange={e => setMetricForm(f => ({ ...f, benchmark_green: e.target.value }))} placeholder="-" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: "#964219" }} />
                  Yellow Threshold
                </Label>
                <Input type="number" step="any" value={metricForm.benchmark_yellow} onChange={e => setMetricForm(f => ({ ...f, benchmark_yellow: e.target.value }))} placeholder="-" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: "#A12C7B" }} />
                  Red Threshold
                </Label>
                <Input type="number" step="any" value={metricForm.benchmark_red} onChange={e => setMetricForm(f => ({ ...f, benchmark_red: e.target.value }))} placeholder="-" />
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
