import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle, CheckCircle2, Clock, Plus, Download, Upload,
  ChevronDown, ChevronRight, Pencil, Trash2, CalendarDays, List,
} from "lucide-react";
import { useAuth } from "@/components/AuthContext";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Task {
  id: number;
  name: string;
  category: string;
  instrument?: string | null;
  owner?: string | null;
  frequency: string;
  frequency_months: number;
  map_analyte?: string | null;
  map_field?: string | null;
  notes?: string | null;
  active: number;
  last_signoff?: Signoff | null;
  next_due?: string | null;
  status: "overdue" | "due_soon" | "current" | "not_started";
}

interface Signoff {
  id: number;
  task_id: number;
  completed_date: string;
  initials?: string | null;
  performed_by?: string | null;
  notes?: string | null;
}

interface Dashboard {
  overdue: number;
  dueThisMonth: number;
  dueSoon: number;
  current: number;
  notStarted: number;
  total: number;
  overdueItems: Task[];
  dueThisMonthItems: Task[];
  dueSoonItems: Task[];
}

const CATEGORIES = [
  "Calibration Verification", "Correlation", "Precision Verification",
  "Policy Review", "QC Review", "Water Contamination",
  "Blood Bank Alarm Checks", "Equipment Calibration",
  "Competency", "Quality Assessment", "HIPAA", "Bloodborne Pathogen",
  "Other",
];

const FREQUENCIES = [
  { label: "Monthly",   value: "Monthly",   months: 1  },
  { label: "Quarterly", value: "Quarterly", months: 3  },
  { label: "Biannual",  value: "Biannual",  months: 6  },
  { label: "Annual",    value: "Annual",    months: 12 },
  { label: "Biennial",  value: "Biennial",  months: 24 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusColor(status: Task["status"]): string {
  switch (status) {
    case "overdue":     return "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300";
    case "due_soon":    return "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300";
    case "current":     return "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300";
    case "not_started": return "bg-muted text-muted-foreground";
  }
}

function statusLabel(status: Task["status"]): string {
  switch (status) {
    case "overdue":     return "Overdue";
    case "due_soon":    return "Due Soon";
    case "current":     return "Current";
    case "not_started": return "Not Started";
  }
}

function statusIcon(status: Task["status"]) {
  switch (status) {
    case "overdue":     return <AlertTriangle size={12} className="text-red-500" />;
    case "due_soon":    return <Clock size={12} className="text-amber-500" />;
    case "current":     return <CheckCircle2 size={12} className="text-emerald-500" />;
    case "not_started": return <Clock size={12} className="text-muted-foreground" />;
  }
}

function fmtDate(d?: string | null): string {
  if (!d) return "-";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

function daysUntilLabel(next_due?: string | null): string {
  if (!next_due) return "";
  const diff = Math.floor((new Date(next_due).getTime() - Date.now()) / 86400000);
  if (diff < 0) return `${-diff}d overdue`;
  if (diff === 0) return "Due today";
  return `${diff}d`;
}

// ── Sign-off dialog ───────────────────────────────────────────────────────────
function SignoffDialog({ task, onDone }: { task: Task; onDone: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [initials, setInitials] = useState("");
  const [performer, setPerformer] = useState("");
  const [notes, setNotes] = useState("");

  const mut = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/veritatrack/tasks/${task.id}/signoff`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ completed_date: date, initials, performed_by: performer, notes }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/veritatrack/tasks"] });
      qc.invalidateQueries({ queryKey: ["/api/veritatrack/dashboard"] });
      setOpen(false);
      onDone();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-7 text-xs">
          <CheckCircle2 size={11} className="mr-1" />
          Sign Off
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Sign Off: {task.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <label className="text-xs text-muted-foreground font-medium block mb-1">Completion Date *</label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium block mb-1">Initials</label>
            <Input placeholder="e.g. MV" value={initials} onChange={e => setInitials(e.target.value)} className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium block mb-1">Performed By</label>
            <Input placeholder="Name" value={performer} onChange={e => setPerformer(e.target.value)} className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium block mb-1">Notes</label>
            <Input placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} className="h-8 text-sm" />
          </div>
          <Button
            className="w-full"
            disabled={!date || mut.isPending}
            onClick={() => mut.mutate()}
          >
            {mut.isPending ? "Saving..." : "Save Sign-Off"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Task form dialog ──────────────────────────────────────────────────────────
function TaskFormDialog({
  trigger,
  existing,
  onDone,
}: {
  trigger: React.ReactNode;
  existing?: Task;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(existing?.name || "");
  const [category, setCategory] = useState(existing?.category || "Other");
  const [instrument, setInstrument] = useState(existing?.instrument || "");
  const [owner, setOwner] = useState(existing?.owner || "");
  const [frequency, setFrequency] = useState(existing?.frequency || "Monthly");
  const [notes, setNotes] = useState(existing?.notes || "");

  const mut = useMutation({
    mutationFn: async () => {
      const url = existing
        ? `${API_BASE}/api/veritatrack/tasks/${existing.id}`
        : `${API_BASE}/api/veritatrack/tasks`;
      const method = existing ? "PUT" : "POST";
      const r = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, instrument: instrument || null, owner: owner || null, frequency, notes: notes || null }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/veritatrack/tasks"] });
      qc.invalidateQueries({ queryKey: ["/api/veritatrack/dashboard"] });
      setOpen(false);
      onDone();
    },
  });

  return (
    <Dialog open={open} onOpenChange={o => {
      setOpen(o);
      if (o && existing) {
        setName(existing.name); setCategory(existing.category);
        setInstrument(existing.instrument || ""); setOwner(existing.owner || "");
        setFrequency(existing.frequency); setNotes(existing.notes || "");
      }
    }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">{existing ? "Edit Task" : "New Task"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <label className="text-xs text-muted-foreground font-medium block mb-1">Task Name *</label>
            <Input placeholder="e.g. Cal Ver - Sodium" value={name} onChange={e => setName(e.target.value)} className="h-8 text-sm" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium block mb-1">Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground font-medium block mb-1">Instrument / Area</label>
              <Input placeholder="e.g. Vista 1" value={instrument} onChange={e => setInstrument(e.target.value)} className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-medium block mb-1">Owner</label>
              <Input placeholder="e.g. Chem Sup" value={owner} onChange={e => setOwner(e.target.value)} className="h-8 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium block mb-1">Frequency</label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-medium block mb-1">Notes</label>
            <Input placeholder="Optional" value={notes} onChange={e => setNotes(e.target.value)} className="h-8 text-sm" />
          </div>
          <Button className="w-full" disabled={!name || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Saving..." : existing ? "Save Changes" : "Add Task"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Calendar view ─────────────────────────────────────────────────────────────
function CalendarView({ tasks }: { tasks: Task[] }) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Build a map of month -> tasks due that month
  const byMonth = useMemo(() => {
    const m: Record<number, Task[]> = {};
    for (let i = 0; i < 12; i++) m[i] = [];
    for (const t of tasks) {
      if (!t.next_due) continue;
      const d = new Date(t.next_due);
      if (d.getFullYear() === viewYear) {
        m[d.getMonth()].push(t);
      }
    }
    return m;
  }, [tasks, viewYear]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setViewYear(y => y - 1)}>
          &larr;
        </Button>
        <span className="font-semibold text-sm">{viewYear}</span>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setViewYear(y => y + 1)}>
          &rarr;
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {MONTHS.map((month, idx) => {
          const monthTasks = byMonth[idx] || [];
          const isCurrentMonth = idx === now.getMonth() && viewYear === now.getFullYear();
          const overdueCt = monthTasks.filter(t => t.status === "overdue").length;
          const dueSoonCt = monthTasks.filter(t => t.status === "due_soon").length;
          return (
            <div
              key={month}
              className={`rounded-xl border p-3 ${isCurrentMonth ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-semibold ${isCurrentMonth ? "text-primary" : "text-foreground"}`}>{month}</span>
                {monthTasks.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">{monthTasks.length} task{monthTasks.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              {monthTasks.length === 0 ? (
                <p className="text-[10px] text-muted-foreground italic">Nothing due</p>
              ) : (
                <div className="space-y-1">
                  {overdueCt > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                      <span className="text-[10px] text-red-600 dark:text-red-400">{overdueCt} overdue</span>
                    </div>
                  )}
                  {dueSoonCt > 0 && (
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                      <span className="text-[10px] text-amber-700 dark:text-amber-300">{dueSoonCt} due soon</span>
                    </div>
                  )}
                  {monthTasks.slice(0, 4).map(t => (
                    <div key={t.id} className="flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        t.status === "overdue" ? "bg-red-500" :
                        t.status === "due_soon" ? "bg-amber-400" : "bg-emerald-400"
                      }`} />
                      <span className="text-[10px] text-muted-foreground truncate">{t.name}</span>
                    </div>
                  ))}
                  {monthTasks.length > 4 && (
                    <span className="text-[10px] text-muted-foreground">+{monthTasks.length - 4} more</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Task row ──────────────────────────────────────────────────────────────────
function TaskRow({ task, onRefresh }: { task: Task; onRefresh: () => void }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);

  const { data: detail } = useQuery<Task>({
    queryKey: [`/api/veritatrack/tasks/${task.id}`],
    enabled: expanded,
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/veritatrack/tasks/${task.id}`, { headers: authHeaders() });
      return r.json();
    },
  });

  const deleteTask = useMutation({
    mutationFn: async () => {
      await fetch(`${API_BASE}/api/veritatrack/tasks/${task.id}`, { method: "DELETE", headers: authHeaders() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/veritatrack/tasks"] });
      qc.invalidateQueries({ queryKey: ["/api/veritatrack/dashboard"] });
    },
  });

  return (
    <div className="border border-border rounded-xl bg-card overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button onClick={() => setExpanded(e => !e)} className="text-muted-foreground hover:text-primary shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-foreground truncate">{task.name}</span>
            {task.map_analyte && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                Map linked
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-[11px] text-muted-foreground">{task.category}</span>
            {task.instrument && <span className="text-[11px] text-muted-foreground">{task.instrument}</span>}
            {task.owner && <span className="text-[11px] text-muted-foreground">Owner: {task.owner}</span>}
            <span className="text-[11px] text-muted-foreground">{task.frequency}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <div className="text-[11px] text-muted-foreground">
              {task.next_due ? `Due ${fmtDate(task.next_due)}` : "Not started"}
            </div>
            <div className="text-[10px] text-muted-foreground">{daysUntilLabel(task.next_due)}</div>
          </div>

          <div className="flex items-center gap-1">
            {statusIcon(task.status)}
            <Badge className={`text-[10px] px-1.5 py-0 border-0 ${statusColor(task.status)}`}>
              {statusLabel(task.status)}
            </Badge>
          </div>

          <SignoffDialog task={task} onDone={onRefresh} />

          <TaskFormDialog
            trigger={<Button size="sm" variant="ghost" className="h-7 w-7 p-0"><Pencil size={11} /></Button>}
            existing={task}
            onDone={onRefresh}
          />

          <Button
            size="sm" variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-red-500"
            onClick={() => { if (confirm(`Delete "${task.name}"?`)) deleteTask.mutate(); }}
          >
            <Trash2 size={11} />
          </Button>
        </div>
      </div>

      {/* Expanded sign-off history */}
      {expanded && detail && (
        <div className="border-t border-border bg-muted/20 px-4 py-3">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Sign-off History</p>
          {((detail as any).signoffs || []).length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No sign-offs recorded yet.</p>
          ) : (
            <div className="space-y-1">
              {((detail as any).signoffs || []).map((s: Signoff) => (
                <div key={s.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{fmtDate(s.completed_date)}</span>
                    {s.initials && <span className="text-muted-foreground">Initials: {s.initials}</span>}
                    {s.performed_by && <span className="text-muted-foreground">{s.performed_by}</span>}
                    {s.notes && <span className="text-muted-foreground italic">{s.notes}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function VeritaTrackAppPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "calendar">("list");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number } | null>(null);

  const hasPlanAccess = ["annual","professional","lab","complete","waived","community","hospital","large_hospital","enterprise"].includes(user?.plan || "");

  const { data: tasks = [], isLoading, refetch } = useQuery<Task[]>({
    queryKey: ["/api/veritatrack/tasks"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/veritatrack/tasks`, { headers: authHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: hasPlanAccess,
  });

  const { data: dashboard } = useQuery<Dashboard>({
    queryKey: ["/api/veritatrack/dashboard"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/veritatrack/dashboard`, { headers: authHeaders() });
      return r.json();
    },
    enabled: hasPlanAccess,
  });

  const categories = useMemo(() => {
    const cats = Array.from(new Set(tasks.map(t => t.category))).sort();
    return ["all", ...cats];
  }, [tasks]);

  const filtered = useMemo(() => tasks.filter(t =>
    (filterCategory === "all" || t.category === filterCategory) &&
    (filterStatus === "all" || t.status === filterStatus)
  ), [tasks, filterCategory, filterStatus]);

  const grouped = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of filtered) {
      if (!map[t.category]) map[t.category] = [];
      map[t.category].push(t);
    }
    return map;
  }, [filtered]);

  const handleImport = async () => {
    setImportLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/veritatrack/import-from-map`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
      });
      const data = await r.json();
      if (r.ok) {
        setImportResult({ created: data.created, skipped: data.skipped });
        qc.invalidateQueries({ queryKey: ["/api/veritatrack/tasks"] });
        qc.invalidateQueries({ queryKey: ["/api/veritatrack/dashboard"] });
      }
    } finally {
      setImportLoading(false);
    }
  };

  const handleExcelExport = async () => {
    const r = await fetch(`${API_BASE}/api/veritatrack/export/excel`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
    });
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `VeritaTrack_${new Date().getFullYear()}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
  };

  if (!hasPlanAccess) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <CalendarDays size={40} className="mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-bold mb-2">VeritaTrack™</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Regulatory compliance calendar with automated due-date tracking, sign-off logging, and VeritaMap integration.
          Available on all full-suite plans.
        </p>
        <Button asChild>
          <a href="/pricing">View Plans</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CalendarDays size={22} className="text-primary" />
            VeritaTrack™
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Regulatory compliance calendar. Track every timed task, sign off completions, and never miss a due date.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm" variant="outline"
            className="h-8 text-xs gap-1"
            onClick={handleImport}
            disabled={importLoading}
            title="Import calibration verification, method comparison, precision, and SOP review schedules from your VeritaMap"
          >
            <Upload size={12} />
            {importLoading ? "Importing..." : "Import from VeritaMap"}
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={handleExcelExport}>
            <Download size={12} />
            Export Excel
          </Button>
          <TaskFormDialog
            trigger={
              <Button size="sm" className="h-8 text-xs gap-1">
                <Plus size={12} />
                Add Task
              </Button>
            }
            onDone={() => refetch()}
          />
        </div>
      </div>

      {/* Import result banner */}
      {importResult && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-sm flex items-center justify-between">
          <span className="text-emerald-800 dark:text-emerald-200">
            Imported {importResult.created} tasks from VeritaMap.
            {importResult.skipped > 0 && ` ${importResult.skipped} already existed and were skipped.`}
          </span>
          <button onClick={() => setImportResult(null)} className="text-emerald-600 hover:text-emerald-800 text-xs">Dismiss</button>
        </div>
      )}

      {/* Dashboard summary cards */}
      {dashboard && dashboard.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Overdue",       val: dashboard.overdue,      color: "text-red-600 dark:text-red-400",    bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" },
            { label: "Due This Month", val: dashboard.dueThisMonth, color: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" },
            { label: "Due Soon (30d)", val: dashboard.dueSoon,      color: "text-primary",                       bg: "bg-primary/5 border-primary/20" },
            { label: "Current",        val: dashboard.current,      color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800" },
          ].map(card => (
            <div key={card.label} className={`rounded-xl border px-4 py-3 ${card.bg}`}>
              <div className={`text-2xl font-bold ${card.color}`}>{card.val}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* View toggle + filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setView("list")}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            <List size={12} /> List
          </button>
          <button
            onClick={() => setView("calendar")}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${view === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            <CalendarDays size={12} /> Calendar
          </button>
        </div>

        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="h-8 text-xs w-44">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.filter(c => c !== "all").map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 text-xs w-36">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="due_soon">Due Soon</SelectItem>
            <SelectItem value="current">Current</SelectItem>
            <SelectItem value="not_started">Not Started</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} task{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Empty state */}
      {!isLoading && tasks.length === 0 && (
        <div className="text-center py-16 border border-dashed border-border rounded-2xl">
          <CalendarDays size={36} className="mx-auto text-muted-foreground mb-3" />
          <h3 className="font-semibold text-foreground mb-1">No tasks yet</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
            Add tasks manually or import your calibration, correlation, and SOP schedule from VeritaMap.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button size="sm" variant="outline" onClick={handleImport} disabled={importLoading}>
              <Upload size={12} className="mr-1" />
              Import from VeritaMap
            </Button>
            <TaskFormDialog trigger={<Button size="sm"><Plus size={12} className="mr-1" />Add Task</Button>} onDone={() => refetch()} />
          </div>
        </div>
      )}

      {/* Calendar view */}
      {view === "calendar" && tasks.length > 0 && <CalendarView tasks={filtered} />}

      {/* List view */}
      {view === "list" && tasks.length > 0 && (
        <div className="space-y-6">
          {Object.entries(grouped).sort().map(([cat, catTasks]) => (
            <div key={cat}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-2">
                {cat}
                <span className="font-normal">({catTasks.length})</span>
              </h3>
              <div className="space-y-2">
                {catTasks
                  .sort((a, b) => {
                    const order = { overdue: 0, due_soon: 1, not_started: 2, current: 3 };
                    return (order[a.status] ?? 4) - (order[b.status] ?? 4);
                  })
                  .map(t => <TaskRow key={t.id} task={t} onRefresh={() => refetch()} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
