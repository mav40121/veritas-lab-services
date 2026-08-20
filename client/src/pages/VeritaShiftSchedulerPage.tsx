import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { useSEO } from "@/hooks/useSEO";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarClock, Plus, Trash2, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ShiftDef { id: number; name: string; start_time: string; end_time: string; min_staff: number; sort_order: number; }
interface StaffMember { id: number; name: string; title: string | null; }
interface Period { id: number; start_date: string; end_date: string; status: string; published_at: string | null; }
interface Assignment { id: number; staff_employee_id: number; shift_def_id: number; work_date: string; staff_name: string | null; }
interface CoverageGap { date: string; shift_def_id: number; shift_name: string; assigned: number; required: number; }

const PLAN_ACCESS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"];

function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  let guard = 0;
  while (d.getTime() <= e.getTime() && guard < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
    guard += 1;
  }
  return out;
}
const dow = (ymd: string) => new Date(ymd + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const dayNum = (ymd: string) => ymd.slice(8, 10);

export default function VeritaShiftSchedulerPage() {
  useSEO({ title: "Scheduler - VeritaShift", description: "Build 24/7 lab coverage and see uncovered shifts at a glance." });
  const { user, isLoggedIn } = useAuth();
  const readOnly = useIsReadOnly("veritabench");
  const { toast } = useToast();
  const activeLabId = useActiveLabId();

  const [shifts, setShifts] = useState<ShiftDef[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [period, setPeriod] = useState<Period | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [gaps, setGaps] = useState<CoverageGap[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-shift form
  const [sName, setSName] = useState(""); const [sStart, setSStart] = useState("07:00"); const [sEnd, setSEnd] = useState("15:00"); const [sMin, setSMin] = useState("1");
  // New-period form
  const [pStart, setPStart] = useState(""); const [pEnd, setPEnd] = useState("");

  const base = activeLabId ? `${API_BASE}/api/labs/${activeLabId}/schedule` : null;
  const hasPlanAccess = !!user && PLAN_ACCESS.includes(user.plan);

  const loadBasics = useCallback(async () => {
    if (!base) { setLoading(false); return; }
    try {
      const [sh, st, pe] = await Promise.all([
        fetch(`${base}/shifts`, { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
        fetch(`${base}/staff`, { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
        fetch(`${base}/periods`, { headers: authHeaders() }).then(r => r.ok ? r.json() : []),
      ]);
      setShifts(sh); setStaff(st); setPeriods(pe);
      if (pe.length && selectedPeriodId == null) setSelectedPeriodId(pe[0].id);
    } catch { /* leave empty states */ }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  useEffect(() => { if (isLoggedIn && hasPlanAccess) loadBasics(); else setLoading(false); }, [isLoggedIn, hasPlanAccess, loadBasics]);

  const loadPeriod = useCallback(async (pid: number) => {
    if (!base) return;
    try {
      const res = await fetch(`${base}/periods/${pid}`, { headers: authHeaders() });
      if (!res.ok) return;
      const d = await res.json();
      setPeriod(d.period); setAssignments(d.assignments || []); setGaps(d.coverageGaps || []);
    } catch { /* noop */ }
  }, [base]);

  useEffect(() => { if (selectedPeriodId != null) loadPeriod(selectedPeriodId); }, [selectedPeriodId, loadPeriod]);

  const dates = useMemo(() => period ? datesInRange(period.start_date, period.end_date) : [], [period]);
  const gapSet = useMemo(() => new Set(gaps.map(g => g.date + "|" + g.shift_def_id)), [gaps]);
  const cell = useCallback((date: string, shiftId: number) => assignments.filter(a => a.work_date === date && a.shift_def_id === shiftId), [assignments]);

  const addShift = async () => {
    if (!base || !sName.trim()) { toast({ title: "Name the shift", variant: "destructive" }); return; }
    const res = await fetch(`${base}/shifts`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ name: sName.trim(), start_time: sStart, end_time: sEnd, min_staff: Number(sMin) || 1, sort_order: shifts.length }) });
    if (res.ok) { setSName(""); loadBasics(); toast({ title: "Shift added" }); }
    else toast({ title: "Could not add shift", variant: "destructive" });
  };
  const removeShift = async (id: number) => {
    if (!base) return;
    await fetch(`${base}/shifts/${id}`, { method: "DELETE", headers: authHeaders() });
    loadBasics();
  };
  const createPeriod = async () => {
    if (!base || !pStart || !pEnd) { toast({ title: "Pick start and end dates", variant: "destructive" }); return; }
    const res = await fetch(`${base}/periods`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ start_date: pStart, end_date: pEnd }) });
    if (res.ok) { const { id } = await res.json(); setPStart(""); setPEnd(""); const pe = await fetch(`${base}/periods`, { headers: authHeaders() }).then(r => r.json()); setPeriods(pe); setSelectedPeriodId(id); toast({ title: "Schedule period created" }); }
    else toast({ title: "Could not create period", variant: "destructive" });
  };
  const assign = async (date: string, shiftId: number, staffId: number) => {
    if (!base || !selectedPeriodId || !staffId) return;
    const res = await fetch(`${base}/assignments`, { method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ period_id: selectedPeriodId, staff_employee_id: staffId, shift_def_id: shiftId, work_date: date }) });
    if (res.ok) loadPeriod(selectedPeriodId);
  };
  const unassign = async (id: number) => {
    if (!base || !selectedPeriodId) return;
    await fetch(`${base}/assignments/${id}`, { method: "DELETE", headers: authHeaders() });
    loadPeriod(selectedPeriodId);
  };
  const publish = async () => {
    if (!base || !selectedPeriodId) return;
    const res = await fetch(`${base}/periods/${selectedPeriodId}/publish`, { method: "POST", headers: authHeaders() });
    if (res.ok) { loadPeriod(selectedPeriodId); loadBasics(); toast({ title: "Schedule published" }); }
  };

  if (!isLoggedIn || !hasPlanAccess) {
    return (
      <div className="container mx-auto py-12 px-4 max-w-2xl">
        <Card><CardContent className="pt-6 text-center"><p>VeritaShift requires a suite subscription.</p></CardContent></Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "#01696F" }}>
          <CalendarClock size={22} />Scheduler
        </h1>
        {period && (
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2 py-1 rounded ${period.status === "published" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"}`}>
              {period.status === "published" ? "Published" : "Draft"}
            </span>
            <Button size="sm" onClick={publish} disabled={readOnly || period.status === "published"} style={{ backgroundColor: "#01696F" }} data-testid="publish-schedule">
              <CheckCircle2 size={14} className="mr-1.5" />Publish
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-teal-200 bg-teal-50 dark:border-teal-800 dark:bg-teal-900/20 p-3 mb-4 text-sm text-teal-900 dark:text-teal-200">
        Build coverage for the week, then look for the amber cells: those shifts are below the staff you require. Assign a person to each until the gap count is zero.
      </div>

      {/* Shift blocks */}
      <Card className="mb-4">
        <CardContent className="p-3">
          <div className="text-sm font-semibold mb-2">Shift blocks</div>
          <div className="flex flex-wrap gap-2 mb-3">
            {shifts.length === 0 && <span className="text-sm text-muted-foreground">No shifts yet. Add your Day / Eve / Night blocks below.</span>}
            {shifts.map(s => (
              <span key={s.id} className="inline-flex items-center gap-1.5 text-xs bg-secondary rounded px-2 py-1" data-testid={`shift-chip-${s.id}`}>
                <b>{s.name}</b> {s.start_time}-{s.end_time} · needs {s.min_staff}
                {!readOnly && <button onClick={() => removeShift(s.id)} className="text-muted-foreground hover:text-red-600" aria-label="remove shift"><Trash2 size={12} /></button>}
              </span>
            ))}
          </div>
          {!readOnly && (
            <div className="flex flex-wrap items-end gap-2">
              <div><label className="text-xs text-muted-foreground block mb-1">Name</label><Input value={sName} onChange={e => setSName(e.target.value)} placeholder="Day" className="w-28" data-testid="shift-name" /></div>
              <div><label className="text-xs text-muted-foreground block mb-1">Start</label><Input type="time" value={sStart} onChange={e => setSStart(e.target.value)} className="w-28" data-testid="shift-start" /></div>
              <div><label className="text-xs text-muted-foreground block mb-1">End</label><Input type="time" value={sEnd} onChange={e => setSEnd(e.target.value)} className="w-28" data-testid="shift-end" /></div>
              <div><label className="text-xs text-muted-foreground block mb-1">Needs</label><Input type="text" inputMode="numeric" value={sMin} onChange={e => setSMin(e.target.value.replace(/[^0-9]/g, ""))} className="w-16" data-testid="shift-min" /></div>
              <Button size="sm" variant="outline" onClick={addShift} data-testid="add-shift"><Plus size={14} className="mr-1" />Add shift</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Period selector */}
      <Card className="mb-4">
        <CardContent className="p-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <label className="text-xs text-muted-foreground block mb-1">Schedule week</label>
            <Select value={selectedPeriodId != null ? String(selectedPeriodId) : ""} onValueChange={v => setSelectedPeriodId(Number(v))}>
              <SelectTrigger data-testid="period-select"><SelectValue placeholder="No periods yet" /></SelectTrigger>
              <SelectContent>{periods.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.start_date} to {p.end_date}{p.status === "published" ? " (published)" : ""}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {!readOnly && (
            <div className="flex items-end gap-2">
              <div><label className="text-xs text-muted-foreground block mb-1">New: start</label><Input type="date" value={pStart} onChange={e => setPStart(e.target.value)} className="w-40" data-testid="period-start" /></div>
              <div><label className="text-xs text-muted-foreground block mb-1">end</label><Input type="date" value={pEnd} onChange={e => setPEnd(e.target.value)} className="w-40" data-testid="period-end" /></div>
              <Button size="sm" variant="outline" onClick={createPeriod} data-testid="create-period"><Plus size={14} className="mr-1" />New week</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Coverage gap banner */}
      {period && (
        <div className={`rounded-lg border p-3 mb-3 text-sm flex items-center gap-2 ${gaps.length ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200" : "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20 text-green-900 dark:text-green-200"}`} data-testid="gap-banner">
          {gaps.length ? <><AlertTriangle size={16} /> {gaps.length} coverage gap{gaps.length === 1 ? "" : "s"} this week. Amber cells are below the staff you require.</> : <><CheckCircle2 size={16} /> Every shift is covered for this week.</>}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="p-8 text-center text-muted-foreground">Loading...</div>
      ) : !activeLabId ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">Select a lab in the top switcher to schedule.</CardContent></Card>
      ) : !period ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">Create a schedule week above to start building coverage.</CardContent></Card>
      ) : shifts.length === 0 ? (
        <Card><CardContent className="pt-6 text-center text-muted-foreground">Add at least one shift block above to build the grid.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-muted/40 border-b">
                  <th className="text-left px-3 py-2 font-semibold sticky left-0 bg-muted/40 z-10">Shift</th>
                  {dates.map(d => <th key={d} className="text-center px-2 py-2 font-semibold whitespace-nowrap">{dow(d)}<div className="text-xs text-muted-foreground font-normal">{dayNum(d)}</div></th>)}
                </tr>
              </thead>
              <tbody>
                {shifts.map(s => (
                  <tr key={s.id} className="border-b align-top">
                    <td className="px-3 py-2 font-medium sticky left-0 bg-background z-10 whitespace-nowrap">{s.name}<div className="text-xs text-muted-foreground">{s.start_time}-{s.end_time} · needs {s.min_staff}</div></td>
                    {dates.map(d => {
                      const here = cell(d, s.id);
                      const gap = gapSet.has(d + "|" + s.id);
                      return (
                        <td key={d} className={`px-1.5 py-1.5 min-w-[120px] border-l ${gap ? "bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-700" : ""}`} data-testid={`cell-${s.id}-${d}`}>
                          <div className="flex flex-col gap-1">
                            {here.map(a => (
                              <span key={a.id} className="inline-flex items-center justify-between gap-1 text-xs bg-teal-100 dark:bg-teal-900/40 rounded px-1.5 py-0.5">
                                <span className="truncate">{a.staff_name || `#${a.staff_employee_id}`}</span>
                                {!readOnly && <button onClick={() => unassign(a.id)} className="text-muted-foreground hover:text-red-600 shrink-0" aria-label="remove"><X size={11} /></button>}
                              </span>
                            ))}
                            {!readOnly && period.status !== "published" && (
                              <Select value="" onValueChange={v => assign(d, s.id, Number(v))}>
                                <SelectTrigger className="h-6 text-xs px-1.5" data-testid={`assign-${s.id}-${d}`}><SelectValue placeholder={gap ? "+ needs staff" : "+ add"} /></SelectTrigger>
                                <SelectContent>{staff.map(st => <SelectItem key={st.id} value={String(st.id)}>{st.name}</SelectItem>)}</SelectContent>
                              </Select>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
