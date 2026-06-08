import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
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
  CheckCircle2, Plus, Download, Upload,
  ChevronDown, ChevronRight, Pencil, Trash2, CalendarDays, List, Settings,
} from "lucide-react";
import { useAuth } from "@/components/AuthContext";
import { ModuleHowToCard } from "@/components/ModuleHowToCard";
import { ConfirmDialog } from "@/components/ConfirmDialog";

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

// ── Default task toggles ─────────────────────────────────────────────────────
const DEFAULT_TOGGLES = [
  { id: "qc_review",       label: "QC Review",                      sub: "Monthly - Chemistry, Hematology, Urinalysis" },
  { id: "pt_review",       label: "Proficiency Testing Review",      sub: "Quarterly - Chemistry, Hematology, Microbiology" },
  { id: "hipaa_training",  label: "HIPAA Training",                  sub: "Annual" },
  { id: "bbp_training",    label: "Bloodborne Pathogen Training",    sub: "Annual" },
  { id: "pipette_cal",     label: "Pipette Calibration",             sub: "Annual" },
  { id: "therm_cal",       label: "Thermometer Calibration",         sub: "Annual" },
  { id: "centrifuge_rpm",  label: "Centrifuge RPM Verification",     sub: "Annual" },
  { id: "timer_verify",    label: "Timer Verification",              sub: "Annual" },
  { id: "blood_bank_alarms", label: "Blood Bank Alarm Checks",       sub: "Quarterly - Refrigerator, Freezer, Platelet Incubator" },
  { id: "water_testing",   label: "Water Contamination Testing",     sub: "Monthly" },
] as const;

type ToggleId = typeof DEFAULT_TOGGLES[number]["id"];

// ── Toggle switch (re-used from VeritaPolicy pattern) ─────────────────────────
function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors
        ${checked ? "bg-primary" : "bg-muted"}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
    >
      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

// ── Status helpers ────────────────────────────────────────────────────────────
const STATUS_ORDER: Record<Task["status"], number> = {
  overdue: 0, due_soon: 1, not_started: 2, current: 3,
};

function worstStatus(tasks: Task[]): Task["status"] {
  if (tasks.some(t => t.status === "overdue"))     return "overdue";
  if (tasks.some(t => t.status === "due_soon"))    return "due_soon";
  if (tasks.some(t => t.status === "not_started")) return "not_started";
  return "current";
}

function statusBg(status: Task["status"]): string {
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

function statusDot(status: Task["status"]): string {
  switch (status) {
    case "overdue":     return "bg-red-500";
    case "due_soon":    return "bg-amber-400";
    case "current":     return "bg-emerald-400";
    case "not_started": return "bg-muted-foreground/40";
  }
}

function fmtDate(d?: string | null): string {
  if (!d) return "-";
  const [y, m, day] = d.split("-");
  return `${m}/${day}/${y}`;
}

function daysLabel(next_due?: string | null): string {
  if (!next_due) return "";
  const diff = Math.floor((new Date(next_due).getTime() - Date.now()) / 86400000);
  if (diff < 0)  return `${-diff}d overdue`;
  if (diff === 0) return "Due today";
  return `in ${diff}d`;
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (so !== 0) return so;
    // Within same status, sort by due date ascending (soonest first)
    const da = a.next_due ? new Date(a.next_due).getTime() : Infinity;
    const db = b.next_due ? new Date(b.next_due).getTime() : Infinity;
    return da - db;
  });
}

// ── Sign-off dialog ───────────────────────────────────────────────────────────
// Multi-Lab Tier 2 (2026-06-07 hotfix): tasksKey + dashKey passed in from
// the page-level scope so the cache invalidation on success refreshes
// the actual lab-scoped list query, not the unscoped legacy key.
function SignoffDialog({ task, onDone, tasksKey, dashKey }: {
  task: Task; onDone: () => void; tasksKey: string; dashKey: string;
}) {
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
      qc.invalidateQueries({ queryKey: [tasksKey] });
      qc.invalidateQueries({ queryKey: [dashKey] });
      setOpen(false);
      onDone();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-6 text-[11px] px-2 shrink-0">
          <CheckCircle2 size={10} className="mr-1" />
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
          <Button className="w-full" disabled={!date || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Saving..." : "Save Sign-Off"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Task form dialog ──────────────────────────────────────────────────────────
// Multi-Lab Tier 2 (2026-06-07 hotfix): trackApi + tasksKey + dashKey passed
// from the page-level scope. New tasks are POSTed to the LAB-SCOPED endpoint
// when activeLabId is set so the row lands with lab_id=activeLabId. The
// unscoped POST (with no labId) used to write lab_id = users.lab_id, which
// silently sent the new task to the user's primary lab even when they were
// viewing a secondary lab. The cache invalidation also targets the
// lab-scoped query key now so the list actually refreshes.
function TaskFormDialog({ trigger, existing, onDone, trackApi, tasksKey, dashKey }: {
  trigger: React.ReactNode; existing?: Task; onDone: () => void;
  trackApi: string; tasksKey: string; dashKey: string;
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
      // PUT for edit still hits the unscoped endpoint (no scoped PUT exists
      // server-side yet). The unscoped PUT updates by task id and is
      // safe because existing tasks already carry the right lab_id.
      const url = existing
        ? `${API_BASE}/api/veritatrack/tasks/${existing.id}`
        : `${trackApi}/tasks`;
      const r = await fetch(url, {
        method: existing ? "PUT" : "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, instrument: instrument || null, owner: owner || null, frequency, notes: notes || null }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [tasksKey] });
      qc.invalidateQueries({ queryKey: [dashKey] });
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
              <label className="text-xs text-muted-foreground font-medium block mb-1">Instrument / Serial</label>
              <Input placeholder="e.g. Vista 1 - SN12345" value={instrument} onChange={e => setInstrument(e.target.value)} className="h-8 text-sm" />
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

// ── Compact task row (inside accordion) ───────────────────────────────────────
function CompactTaskRow({ task, onRefresh, trackApi, tasksKey, dashKey }: {
  task: Task; onRefresh: () => void; trackApi: string; tasksKey: string; dashKey: string;
}) {
  const qc = useQueryClient();

  const deleteTask = useMutation({
    mutationFn: async () => {
      await fetch(`${API_BASE}/api/veritatrack/tasks/${task.id}`, { method: "DELETE", headers: authHeaders() });
    },
    onSuccess: () => {
      // Multi-Lab hotfix (2026-06-07): invalidate the scoped keys so the
      // active lab's list/dashboard refresh, not just the legacy unscoped key.
      qc.invalidateQueries({ queryKey: [tasksKey] });
      qc.invalidateQueries({ queryKey: [dashKey] });
    },
  });

  const isOverdue = task.status === "overdue";
  const isDueSoon = task.status === "due_soon";

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 border-b border-border/50 last:border-0 text-xs group
      ${isOverdue ? "bg-red-50/50 dark:bg-red-950/10" : isDueSoon ? "bg-amber-50/50 dark:bg-amber-950/10" : ""}`}>

      {/* Status dot */}
      <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(task.status)}`} />

      {/* Task name + instrument */}
      <div className="flex-1 min-w-0">
        <span className="font-medium text-foreground truncate block">{task.name}</span>
        {task.instrument && (
          <span className="text-[10px] text-muted-foreground">{task.instrument}</span>
        )}
      </div>

      {/* Last performed */}
      <div className="text-right w-24 shrink-0">
        <div className="text-[10px] text-muted-foreground">Last performed</div>
        <div className={`font-medium ${isOverdue ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
          {fmtDate(task.last_signoff?.completed_date)}
        </div>
      </div>

      {/* Due next */}
      <div className="text-right w-24 shrink-0">
        <div className="text-[10px] text-muted-foreground">Due next</div>
        <div className={`font-medium ${isOverdue ? "text-red-600 dark:text-red-400" : isDueSoon ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
          {task.next_due ? fmtDate(task.next_due) : "-"}
        </div>
        {task.next_due && (
          <div className={`text-[10px] ${isOverdue ? "text-red-500" : isDueSoon ? "text-amber-500" : "text-muted-foreground"}`}>
            {daysLabel(task.next_due)}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <SignoffDialog task={task} onDone={onRefresh} tasksKey={tasksKey} dashKey={dashKey} />
        <TaskFormDialog
          trigger={<Button size="sm" variant="ghost" className="h-6 w-6 p-0"><Pencil size={10} /></Button>}
          existing={task}
          onDone={onRefresh}
          trackApi={trackApi}
          tasksKey={tasksKey}
          dashKey={dashKey}
        />
        <ConfirmDialog
          title="Delete Task?"
          message={`Delete "${task.name}"? This will remove all sign-off history for this task.`}
          confirmLabel="Delete"
          onConfirm={() => deleteTask.mutate()}
        >
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-500">
            <Trash2 size={10} />
          </Button>
        </ConfirmDialog>
      </div>

      {/* Sign off always visible on overdue/due_soon */}
      {(isOverdue || isDueSoon) && (
        <div className="shrink-0 group-hover:hidden">
          <SignoffDialog task={task} onDone={onRefresh} tasksKey={tasksKey} dashKey={dashKey} />
        </div>
      )}
    </div>
  );
}

// ── Group accordion ───────────────────────────────────────────────────────────
function GroupAccordion({ category, tasks, onRefresh, defaultOpen, trackApi, tasksKey, dashKey }: {
  category: string;
  tasks: Task[];
  onRefresh: () => void;
  defaultOpen?: boolean;
  trackApi: string;
  tasksKey: string;
  dashKey: string;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const sorted = useMemo(() => sortTasks(tasks), [tasks]);
  const worst = worstStatus(tasks);
  const overdueCt  = tasks.filter(t => t.status === "overdue").length;
  const dueSoonCt  = tasks.filter(t => t.status === "due_soon").length;
  const notStarted = tasks.filter(t => t.status === "not_started").length;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Group header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={14} className="text-muted-foreground shrink-0" /> : <ChevronRight size={14} className="text-muted-foreground shrink-0" />}

        <span className="font-semibold text-sm text-foreground flex-1">{category}</span>

        {/* Summary chips */}
        <div className="flex items-center gap-2 text-[11px]">
          {overdueCt > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300 font-semibold">
              {overdueCt} overdue
            </span>
          )}
          {dueSoonCt > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 font-semibold">
              {dueSoonCt} due soon
            </span>
          )}
          {notStarted > 0 && overdueCt === 0 && dueSoonCt === 0 && (
            <span className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {notStarted} not started
            </span>
          )}
          {overdueCt === 0 && dueSoonCt === 0 && notStarted === 0 && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 font-semibold">
              All current
            </span>
          )}
          <span className="text-muted-foreground">{tasks.length} task{tasks.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Worst status badge */}
        <Badge className={`text-[10px] px-2 py-0 border-0 shrink-0 ${statusBg(worst)}`}>
          {statusLabel(worst)}
        </Badge>
      </button>

      {/* Task rows */}
      {open && (
        <div className="border-t border-border">
          {/* Column headers */}
          <div className="flex items-center gap-3 px-4 py-1.5 bg-muted/30 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest border-b border-border/50">
            <span className="w-2 shrink-0" />
            <span className="flex-1">Task</span>
            <span className="w-24 text-right shrink-0">Last Performed</span>
            <span className="w-24 text-right shrink-0">Due Next</span>
            <span className="w-24 shrink-0" />
          </div>
          {sorted.map(t => (
            <CompactTaskRow key={t.id} task={t} onRefresh={onRefresh} trackApi={trackApi} tasksKey={tasksKey} dashKey={dashKey} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Calendar view ─────────────────────────────────────────────────────────────
function CalendarView({ tasks }: { tasks: Task[] }) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const byMonth = useMemo(() => {
    const m: Record<number, Task[]> = {};
    for (let i = 0; i < 12; i++) m[i] = [];
    for (const t of tasks) {
      if (!t.next_due) continue;
      const d = new Date(t.next_due);
      if (d.getFullYear() === viewYear) m[d.getMonth()].push(t);
    }
    return m;
  }, [tasks, viewYear]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setViewYear(y => y - 1)}>&larr;</Button>
        <span className="font-semibold text-sm">{viewYear}</span>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setViewYear(y => y + 1)}>&rarr;</Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {MONTHS.map((month, idx) => {
          const monthTasks = byMonth[idx] || [];
          const isCurrentMonth = idx === now.getMonth() && viewYear === now.getFullYear();
          const overdueCt = monthTasks.filter(t => t.status === "overdue").length;
          const dueSoonCt = monthTasks.filter(t => t.status === "due_soon").length;
          return (
            <div key={month} className={`rounded-xl border p-3 ${isCurrentMonth ? "border-primary/50 bg-primary/5" : "border-border bg-card"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm font-semibold ${isCurrentMonth ? "text-primary" : "text-foreground"}`}>{month}</span>
                {monthTasks.length > 0 && <span className="text-[10px] text-muted-foreground">{monthTasks.length}</span>}
              </div>
              {monthTasks.length === 0 ? (
                <p className="text-[10px] text-muted-foreground italic">Nothing due</p>
              ) : (
                <div className="space-y-1">
                  {overdueCt > 0 && <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 shrink-0" /><span className="text-[10px] text-red-600 dark:text-red-400">{overdueCt} overdue</span></div>}
                  {dueSoonCt > 0 && <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" /><span className="text-[10px] text-amber-700 dark:text-amber-300">{dueSoonCt} due soon</span></div>}
                  {monthTasks.slice(0, 3).map(t => (
                    <div key={t.id} className="flex items-center gap-1">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(t.status)}`} />
                      <span className="text-[10px] text-muted-foreground truncate">{t.name}</span>
                    </div>
                  ))}
                  {monthTasks.length > 3 && <span className="text-[10px] text-muted-foreground">+{monthTasks.length - 3} more</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
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

  // Default task panel state
  const [setupOpen, setSetupOpen] = useState(false);
  const [selectedToggles, setSelectedToggles] = useState<Set<ToggleId>>(new Set(
    DEFAULT_TOGGLES.map(t => t.id) // all on by default
  ));
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<{ created: number; skipped: number } | null>(null);

  const hasPlanAccess = ["annual","professional","lab","complete","waived","community","hospital","large_hospital","enterprise"].includes(user?.plan || "");

  // Multi-Lab Tier 2 Phase 3.7b: route reads/writes through the active lab.
  const activeLabId = useActiveLabId();
  const trackApi = activeLabId
    ? `${API_BASE}/api/labs/${activeLabId}/veritatrack`
    : `${API_BASE}/api/veritatrack`;
  const tasksKey = activeLabId
    ? `/api/labs/${activeLabId}/veritatrack/tasks`
    : `/api/veritatrack/tasks`;
  const dashKey = activeLabId
    ? `/api/labs/${activeLabId}/veritatrack/dashboard`
    : `/api/veritatrack/dashboard`;

  const { data: tasks = [], isLoading, refetch } = useQuery<Task[]>({
    queryKey: [tasksKey],
    queryFn: async () => {
      const r = await fetch(`${trackApi}/tasks`, { headers: authHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: hasPlanAccess,
  });

  const { data: dashboard } = useQuery<Dashboard>({
    queryKey: [dashKey],
    queryFn: async () => {
      const r = await fetch(`${trackApi}/dashboard`, { headers: authHeaders() });
      return r.json();
    },
    enabled: hasPlanAccess,
  });

  // VeritaTrack 3-element framework Wave B1 (move-1, 2026-06-07):
  // pre-bucketed worklist so the dashboard tile renders without
  // client-side date math. Lab-scoped endpoint; falls back to nothing
  // when no activeLabId so the tile self-hides on legacy single-lab
  // boots before the lab switcher resolves.
  const { data: worklist } = useQuery<{
    today: string;
    counts: { overdue: number; due_today: number; due_this_week: number; due_next_30: number; cross_module?: number };
    buckets: {
      overdue: Task[];
      due_today: Task[];
      due_this_week: Task[];
      due_next_30: Task[];
    };
    cross_module?: Array<{ source: string; source_id: number; label: string; due_date: string; link: string }>;
  }>({
    queryKey: activeLabId ? [`/api/labs/${activeLabId}/veritatrack/worklist`] : ["no-worklist"],
    queryFn: async () => {
      if (!activeLabId) throw new Error("no lab");
      const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/veritatrack/worklist`, { headers: authHeaders() });
      if (!r.ok) throw new Error("worklist failed");
      return r.json();
    },
    enabled: hasPlanAccess && !!activeLabId,
  });

  const filtered = useMemo(() => tasks.filter(t =>
    (filterCategory === "all" || t.category === filterCategory) &&
    (filterStatus === "all" || t.status === filterStatus)
  ), [tasks, filterCategory, filterStatus]);

  // Group by category, sorted so worst-status groups appear first
  const grouped = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of filtered) {
      if (!map[t.category]) map[t.category] = [];
      map[t.category].push(t);
    }
    // Sort groups: worst status group first, then alphabetically
    return Object.entries(map).sort(([, a], [, b]) => {
      const wa = STATUS_ORDER[worstStatus(a)];
      const wb = STATUS_ORDER[worstStatus(b)];
      if (wa !== wb) return wa - wb;
      return 0;
    });
  }, [filtered]);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(tasks.map(t => t.category))).sort();
    return cats;
  }, [tasks]);

  // Auto-open setup panel when no tasks exist
  useEffect(() => {
    if (!isLoading && tasks.length === 0) {
      setSetupOpen(true);
    }
  }, [isLoading, tasks.length]);

  const handleSeedDefaults = async () => {
    if (selectedToggles.size === 0) return;
    setSeeding(true);
    setSeedResult(null);
    try {
      const r = await fetch(`${API_BASE}/api/veritatrack/seed-defaults`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ categories: Array.from(selectedToggles) }),
      });
      const data = await r.json();
      if (r.ok) {
        setSeedResult({ created: data.created, skipped: data.skipped });
        // Multi-Lab hotfix (2026-06-07): invalidate the scoped query keys
        // so the active lab's list/dashboard refresh, not just the legacy
        // unscoped key (which was the only one this used to hit).
        qc.invalidateQueries({ queryKey: [tasksKey] });
        qc.invalidateQueries({ queryKey: [dashKey] });
      }
    } finally {
      setSeeding(false);
    }
  };

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
        // Multi-Lab hotfix (2026-06-07): invalidate the scoped query keys
        // so the active lab's list/dashboard refresh, not just the legacy
        // unscoped key (which was the only one this used to hit).
        qc.invalidateQueries({ queryKey: [tasksKey] });
        qc.invalidateQueries({ queryKey: [dashKey] });
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
          Regulatory compliance calendar with automated due-date tracking, sign-off logging, and VeritaMap™ integration.
          Available on all full-suite plans.
        </p>
        <Button asChild><a href="/pricing">View Plans</a></Button>
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
      <ModuleHowToCard
        moduleKey="veritatrack"
        moduleName="VeritaTrack™"
        whatItDoes="VeritaTrack is the regulatory calendar. Every timed task in one place: calibration verification, correlations, competency, equipment maintenance, QC review, PT enrollment, license renewal. Auto-imports schedules from VeritaMap so adding a new instrument creates its cal-ver cadence automatically."
        howToUse={[
          "Set up your test menu in VeritaMap; tasks auto-create here at their CLIA cadence.",
          "Add ad-hoc tasks (equipment service, contract renewals, accreditor application deadlines).",
          "Sign off tasks as complete with initials, date, and reviewer name.",
          "Export to Excel in the regulatory-calendar format your lab already uses.",
          "Review the calendar weekly; track overdue items to closure with the medical director or designee."
        ]}
      />

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm" variant="outline"
            className={`h-8 text-xs gap-1 ${setupOpen ? "border-primary text-primary" : ""}`}
            onClick={() => setSetupOpen(o => !o)}
            title="Quick-add common lab tasks"
          >
            <Settings size={12} />
            Quick Setup
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={handleImport} disabled={importLoading}
            title="Import cal ver, method comparison, precision, and SOP schedules from VeritaMap™">
            <Upload size={12} />
            {importLoading ? "Importing..." : "Import from VeritaMap™"}
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={handleExcelExport}>
            <Download size={12} />
            Export Excel
          </Button>
          <TaskFormDialog
            trigger={<Button size="sm" className="h-8 text-xs gap-1"><Plus size={12} />Add Task</Button>}
            onDone={() => refetch()}
            trackApi={trackApi}
            tasksKey={tasksKey}
            dashKey={dashKey}
          />
        </div>
      </div>

      {/* VeritaTrack Wave B1 (move-1): today's worklist tile. Shows
          overdue + due-today + due-this-week + due-next-30 counts so
          the director sees what needs action without scrolling the
          full task list. Self-hides when no activeLabId. */}
      {worklist && (worklist.counts.overdue + worklist.counts.due_today + worklist.counts.due_this_week + worklist.counts.due_next_30 + (worklist.counts.cross_module ?? 0)) > 0 && (
        <div className="mb-6 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <CalendarDays size={16} className="text-primary" />
            <h3 className="font-semibold text-sm">Today's Worklist</h3>
            <span className="text-xs text-muted-foreground">as of {worklist.today}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={`rounded-lg p-3 ${worklist.counts.overdue > 0 ? "bg-red-50 dark:bg-red-950/30 border border-red-200/50 dark:border-red-900/40" : "bg-muted/40"}`}>
              <div className={`text-xs uppercase ${worklist.counts.overdue > 0 ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>Overdue</div>
              <div className={`text-2xl font-bold ${worklist.counts.overdue > 0 ? "text-red-700 dark:text-red-300" : "text-foreground"}`}>{worklist.counts.overdue}</div>
            </div>
            <div className={`rounded-lg p-3 ${worklist.counts.due_today > 0 ? "bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-900/40" : "bg-muted/40"}`}>
              <div className={`text-xs uppercase ${worklist.counts.due_today > 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>Due Today</div>
              <div className={`text-2xl font-bold ${worklist.counts.due_today > 0 ? "text-amber-700 dark:text-amber-300" : "text-foreground"}`}>{worklist.counts.due_today}</div>
            </div>
            <div className="rounded-lg p-3 bg-muted/40">
              <div className="text-xs uppercase text-muted-foreground">This Week</div>
              <div className="text-2xl font-bold">{worklist.counts.due_this_week}</div>
            </div>
            <div className="rounded-lg p-3 bg-muted/40">
              <div className="text-xs uppercase text-muted-foreground">Next 30 Days</div>
              <div className="text-2xl font-bold">{worklist.counts.due_next_30}</div>
            </div>
          </div>

          {/* Wave B2 (move-3): cross-module seam list. Surfaces VeritaLab
              cert renewals (90-day horizon) + VeritaPolicy overdue
              reviews (30-day horizon) so they appear next to formal
              VeritaTrack tasks. Read-only links; conversion to a real
              task happens in the source module. */}
          {worklist.cross_module && worklist.cross_module.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border/50">
              <div className="text-xs uppercase text-muted-foreground mb-2">From other modules</div>
              <ul className="space-y-1.5">
                {worklist.cross_module.slice(0, 8).map((item, idx) => (
                  <li key={`${item.source}-${item.source_id}-${idx}`} className="flex items-center gap-2 text-xs">
                    <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] uppercase font-medium">{item.source.replace("verita", "")}</span>
                    <a href={item.link} className="text-foreground hover:text-primary truncate flex-1">{item.label}</a>
                    <span className="text-muted-foreground shrink-0">{item.due_date}</span>
                  </li>
                ))}
              </ul>
              {worklist.cross_module.length > 8 && (
                <div className="text-[11px] text-muted-foreground mt-2">
                  Showing 8 of {worklist.cross_module.length}.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Quick Setup panel */}
      {setupOpen && (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b border-border">
            <div>
              <span className="text-sm font-semibold text-foreground">Quick Setup</span>
              <span className="text-xs text-muted-foreground ml-2">Select categories to add common tasks automatically</span>
            </div>
            <button onClick={() => setSetupOpen(false)} className="text-muted-foreground hover:text-foreground text-xs px-2">Done</button>
          </div>
          <div className="px-4 py-4 bg-card">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {DEFAULT_TOGGLES.map(toggle => (
                <div key={toggle.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-foreground">{toggle.label}</div>
                    <div className="text-[11px] text-muted-foreground">{toggle.sub}</div>
                  </div>
                  <Toggle
                    checked={selectedToggles.has(toggle.id)}
                    onChange={v => setSelectedToggles(prev => {
                      const next = new Set(prev);
                      v ? next.add(toggle.id) : next.delete(toggle.id);
                      return next;
                    })}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 pt-1 border-t border-border">
              <Button
                size="sm"
                disabled={selectedToggles.size === 0 || seeding}
                onClick={handleSeedDefaults}
                className="h-8 text-xs"
              >
                {seeding ? "Adding tasks..." : `Apply (${selectedToggles.size} selected)`}
              </Button>
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedToggles(new Set(DEFAULT_TOGGLES.map(t => t.id)))}
              >
                Select all
              </button>
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setSelectedToggles(new Set())}
              >
                Clear all
              </button>
              {seedResult && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 ml-auto">
                  Added {seedResult.created} task{seedResult.created !== 1 ? "s" : ""}
                  {seedResult.skipped > 0 ? ` (${seedResult.skipped} already existed)` : ""}
                </span>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              Turning off a toggle does not delete existing tasks. Use this panel anytime to add new categories.
            </p>
          </div>
        </div>
      )}

      {/* Import result banner */}
      {importResult && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-sm flex items-center justify-between">
          <span className="text-emerald-800 dark:text-emerald-200">
            Imported {importResult.created} tasks from VeritaMap™.
            {importResult.skipped > 0 && ` ${importResult.skipped} already existed and were skipped.`}
          </span>
          <button onClick={() => setImportResult(null)} className="text-emerald-600 hover:text-emerald-800 text-xs">Dismiss</button>
        </div>
      )}

      {/* Dashboard summary cards */}
      {dashboard && dashboard.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Overdue",        val: dashboard.overdue,      color: "text-red-600 dark:text-red-400",         bg: "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" },
            { label: "Due This Month", val: dashboard.dueThisMonth, color: "text-amber-600 dark:text-amber-400",     bg: "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" },
            { label: "Due Soon (30d)", val: dashboard.dueSoon,      color: "text-primary",                           bg: "bg-primary/5 border-primary/20" },
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
          <button onClick={() => setView("list")}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
            <List size={12} /> List
          </button>
          <button onClick={() => setView("calendar")}
            className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium transition-colors ${view === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
            <CalendarDays size={12} /> Calendar
          </button>
        </div>

        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="h-8 text-xs w-48">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
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
            Add tasks manually or import your calibration, correlation, and SOP schedule from VeritaMap™.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button size="sm" variant="outline" onClick={handleImport} disabled={importLoading}>
              <Upload size={12} className="mr-1" />Import from VeritaMap™
            </Button>
            <TaskFormDialog trigger={<Button size="sm"><Plus size={12} className="mr-1" />Add Task</Button>} onDone={() => refetch()} trackApi={trackApi} tasksKey={tasksKey} dashKey={dashKey} />
          </div>
        </div>
      )}

      {/* Calendar view */}
      {view === "calendar" && tasks.length > 0 && <CalendarView tasks={filtered} />}

      {/* Grouped accordion list view */}
      {view === "list" && tasks.length > 0 && (
        <div className="space-y-3">
          {grouped.map(([cat, catTasks]) => (
            <GroupAccordion
              key={cat}
              category={cat}
              tasks={catTasks}
              onRefresh={() => refetch()}
              defaultOpen={worstStatus(catTasks) === "overdue" || worstStatus(catTasks) === "due_soon"}
              trackApi={trackApi}
              tasksKey={tasksKey}
              dashKey={dashKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}
