import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Lock, Plus, FileDown, Trash2, Users, ArrowLeft, BarChart3, Grid3X3,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { saveAs } from "file-saver";

interface StaffingStudy {
  id: number;
  account_id: number;
  name: string;
  department: string;
  start_date: string | null;
  status: string;
  created_at: string;
}

interface HourlyDataItem {
  id?: number;
  study_id: number;
  week_number: number;
  day_of_week: number;
  hour_slot: number;
  metric_type: string;
  value: number;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DEPARTMENTS = ["Core Lab", "Blood Bank", "Microbiology", "AP", "Phlebotomy", "Other"];

function hourLabel(h: number): string {
  if (h === 0) return "12-1 AM";
  if (h < 12) return `${h}-${h + 1} AM`;
  if (h === 12) return "12-1 PM";
  return `${h - 12}-${h - 11} PM`;
}

// ── Study List View ─────────────────────────────────────────────────────────
function StudyListView({ studies, onSelect, onCreate, onDelete, readOnly }: {
  studies: StaffingStudy[];
  onSelect: (s: StaffingStudy) => void;
  onCreate: (name: string, dept: string, startDate: string) => void;
  onDelete: (s: StaffingStudy) => void;
  readOnly: boolean;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [dept, setDept] = useState("Core Lab");
  const [startDate, setStartDate] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<StaffingStudy | null>(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="font-serif text-xl font-bold" style={{ color: "#01696F" }}>Staffing Studies</h2>
          <p className="text-sm text-muted-foreground mt-1">By-hour data collection and demand analysis</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} disabled={readOnly} style={{ backgroundColor: "#01696F" }}>
          <Plus size={14} className="mr-1.5" />New Study
        </Button>
      </div>

      {studies.length === 0 ? (
        <div className="text-center py-12">
          <Grid3X3 size={40} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">No staffing studies yet. Create one to get started.</p>
          <Button onClick={() => setShowCreate(true)} disabled={readOnly} style={{ backgroundColor: "#01696F" }}>
            <Plus size={14} className="mr-1.5" />New Study
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {studies.map(s => (
            <Card key={s.id} className="cursor-pointer hover:border-[#01696F]/40 transition-colors" onClick={() => onSelect(s)}>
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.department} - {s.status === "active" ? "In Progress" : "Complete"}{s.start_date ? ` - Started ${s.start_date}` : ""}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.status === "complete" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>
                    {s.status === "complete" ? "Complete" : "Active"}
                  </span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={e => { e.stopPropagation(); setDeleteTarget(s); }} disabled={readOnly}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New Staffing Study</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Study Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Core Lab Q1 Analysis" />
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button disabled={!name.trim()} onClick={() => { onCreate(name, dept, startDate); setShowCreate(false); setName(""); }} style={{ backgroundColor: "#01696F" }}>Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete study?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `Delete "${deleteTarget.name}" and all associated data? This cannot be undone.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteTarget) onDelete(deleteTarget); setDeleteTarget(null); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Data Grid (Week/Staffing) ───────────────────────────────────────────────
function DataGrid({ studyId, data, onSave, readOnly, weekNum, metricTypes, allData }: {
  studyId: number;
  data: HourlyDataItem[];
  onSave: (items: Omit<HourlyDataItem, "id" | "study_id" | "created_at">[]) => void;
  readOnly: boolean;
  weekNum: number;
  metricTypes: string[];
  allData: HourlyDataItem[];
}) {
  const [grid, setGrid] = useState<Record<string, number>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const g: Record<string, number> = {};
    for (const d of data) {
      g[`${d.metric_type}-${d.day_of_week}-${d.hour_slot}`] = d.value;
    }
    setGrid(g);
  }, [data]);

  const handleChange = useCallback((mt: string, day: number, hour: number, val: string) => {
    const num = val === "" ? 0 : parseFloat(val);
    const key = `${mt}-${day}-${hour}`;
    setGrid(prev => ({ ...prev, [key]: num }));

    // Debounced save
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const items: Omit<HourlyDataItem, "id" | "study_id" | "created_at">[] = [];
      setGrid(current => {
        for (const [k, v] of Object.entries(current)) {
          const [mt2, d, h] = k.split("-");
          items.push({ week_number: weekNum, day_of_week: parseInt(d), hour_slot: parseInt(h), metric_type: mt2, value: v });
        }
        return current;
      });
      if (items.length > 0) onSave(items);
    }, 1500);
  }, [weekNum, onSave]);

  // Compute outliers: check if this cell deviates >50% from avg of other weeks
  const getOutlierFlag = useCallback((mt: string, day: number, hour: number): boolean => {
    const thisVal = grid[`${mt}-${day}-${hour}`] ?? 0;
    if (thisVal === 0) return false;
    const otherWeekVals = allData
      .filter(d => d.metric_type === mt && d.day_of_week === day && d.hour_slot === hour && d.week_number !== weekNum)
      .map(d => d.value);
    if (otherWeekVals.length < 2) return false;
    const avg = otherWeekVals.reduce((s, v) => s + v, 0) / otherWeekVals.length;
    if (avg === 0) return thisVal > 0;
    return Math.abs(thisVal - avg) / avg > 0.5;
  }, [grid, allData, weekNum]);

  return (
    <div className="space-y-6">
      {metricTypes.map(mt => (
        <div key={mt}>
          <h3 className="text-sm font-semibold mb-2 capitalize">
            {mt === "received" ? "Samples Received" : mt === "verified" ? "Samples Verified" : "Staff on Duty"}
          </h3>
          <div className="overflow-x-auto">
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-medium border" style={{ backgroundColor: "#01696F10" }}>Hour</th>
                  {DAY_NAMES.map((d, i) => (
                    <th key={i} className="px-2 py-1 text-center font-medium border min-w-[70px]" style={{ backgroundColor: "#01696F10" }}>{d}</th>
                  ))}
                  <th className="px-2 py-1 text-center font-medium border" style={{ backgroundColor: "#01696F10" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 24 }, (_, h) => {
                  const rowTotal = DAY_NAMES.reduce((s, _, d) => s + (grid[`${mt}-${d}-${h}`] ?? 0), 0);
                  return (
                    <tr key={h}>
                      <td className="px-2 py-0.5 border text-muted-foreground whitespace-nowrap">{hourLabel(h)}</td>
                      {DAY_NAMES.map((_, d) => {
                        const val = grid[`${mt}-${d}-${h}`] ?? 0;
                        const isOutlier = getOutlierFlag(mt, d, h);
                        return (
                          <td key={d} className={`border p-0 ${isOutlier ? "bg-yellow-100 dark:bg-yellow-900/30" : ""}`}>
                            <input
                              type="number"
                              className="w-full px-1.5 py-0.5 text-center bg-transparent border-none outline-none text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              value={val || ""}
                              onChange={e => handleChange(mt, d, h, e.target.value)}
                              disabled={readOnly}
                              min={0}
                            />
                          </td>
                        );
                      })}
                      <td className="px-2 py-0.5 border text-center font-medium">{rowTotal || ""}</td>
                    </tr>
                  );
                })}
                <tr className="font-medium" style={{ backgroundColor: "#01696F10" }}>
                  <td className="px-2 py-1 border">Total</td>
                  {DAY_NAMES.map((_, d) => {
                    const colTotal = Array.from({ length: 24 }, (_, h) => grid[`${mt}-${d}-${h}`] ?? 0).reduce((s, v) => s + v, 0);
                    return <td key={d} className="px-2 py-1 border text-center">{colTotal || ""}</td>;
                  })}
                  <td className="px-2 py-1 border text-center">
                    {Object.entries(grid).filter(([k]) => k.startsWith(`${mt}-`)).reduce((s, [, v]) => s + v, 0) || ""}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Heatmap Component ───────────────────────────────────────────────────────
function Heatmap({ data, title }: { data: number[][]; title: string }) {
  const maxVal = Math.max(1, ...data.flat());
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left border">Hour</th>
              {DAY_NAMES.map(d => <th key={d} className="px-2 py-1 text-center border min-w-[60px]">{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 24 }, (_, h) => (
              <tr key={h}>
                <td className="px-2 py-0.5 border text-muted-foreground whitespace-nowrap">{hourLabel(h)}</td>
                {DAY_NAMES.map((_, d) => {
                  const val = data[h]?.[d] ?? 0;
                  const intensity = val / maxVal;
                  const bg = `rgba(1, 105, 111, ${intensity * 0.8})`;
                  return (
                    <td key={d} className="border text-center px-2 py-0.5" style={{ backgroundColor: bg, color: intensity > 0.5 ? "white" : "inherit" }}>
                      {val > 0 ? val.toFixed(0) : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Analysis View ───────────────────────────────────────────────────────────
function AnalysisView({ data, studyName }: { data: HourlyDataItem[]; studyName: string }) {
  const [throughputRate, setThroughputRate] = useState<number>(20);

  // Compute averages
  const avgReceived = useMemo(() => {
    const grid: number[][] = Array.from({ length: 24 }, () => Array(7).fill(0));
    const counts: number[][] = Array.from({ length: 24 }, () => Array(7).fill(0));
    for (const d of data) {
      if (d.metric_type === "received") {
        grid[d.hour_slot][d.day_of_week] += d.value;
        counts[d.hour_slot][d.day_of_week]++;
      }
    }
    return grid.map((row, h) => row.map((val, d) => counts[h][d] > 0 ? val / counts[h][d] : 0));
  }, [data]);

  const avgVerified = useMemo(() => {
    const grid: number[][] = Array.from({ length: 24 }, () => Array(7).fill(0));
    const counts: number[][] = Array.from({ length: 24 }, () => Array(7).fill(0));
    for (const d of data) {
      if (d.metric_type === "verified") {
        grid[d.hour_slot][d.day_of_week] += d.value;
        counts[d.hour_slot][d.day_of_week]++;
      }
    }
    return grid.map((row, h) => row.map((val, d) => counts[h][d] > 0 ? val / counts[h][d] : 0));
  }, [data]);

  const staffGrid = useMemo(() => {
    const grid: number[][] = Array.from({ length: 24 }, () => Array(7).fill(0));
    for (const d of data) {
      if (d.metric_type === "staffing") {
        grid[d.hour_slot][d.day_of_week] = d.value;
      }
    }
    return grid;
  }, [data]);

  // Summary stats
  const stats = useMemo(() => {
    const allReceived = avgReceived.flat();
    const totalWeekly = allReceived.reduce((s, v) => s + v, 0);
    let peakHour = 0, peakVal = 0, lowHour = 0, lowVal = Infinity;
    const hourTotals = Array(24).fill(0);
    const dayTotals = Array(7).fill(0);
    for (let h = 0; h < 24; h++) {
      for (let d = 0; d < 7; d++) {
        hourTotals[h] += avgReceived[h][d];
        dayTotals[d] += avgReceived[h][d];
      }
      if (hourTotals[h] > peakVal) { peakVal = hourTotals[h]; peakHour = h; }
      if (hourTotals[h] < lowVal && hourTotals[h] > 0) { lowVal = hourTotals[h]; lowHour = h; }
    }
    const peakDay = dayTotals.indexOf(Math.max(...dayTotals));
    const avgDaily = totalWeekly / 7;
    return { totalWeekly, peakHour, lowHour, peakDay, avgDaily };
  }, [avgReceived]);

  // FTE staffing recommendation: volume / throughput rate
  const fteGrid = useMemo(() => {
    const rate = throughputRate > 0 ? throughputRate : 20;
    return avgReceived.map(row => row.map(val => val > 0 ? Math.ceil(val / rate) : 0));
  }, [avgReceived, throughputRate]);

  return (
    <div className="space-y-8">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="pt-4 text-center">
          <div className="text-xs text-muted-foreground">Weekly Volume</div>
          <div className="text-xl font-bold font-mono" style={{ color: "#01696F" }}>{stats.totalWeekly.toFixed(0)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-xs text-muted-foreground">Peak Hour</div>
          <div className="text-xl font-bold font-mono" style={{ color: "#01696F" }}>{hourLabel(stats.peakHour)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-xs text-muted-foreground">Lowest Hour</div>
          <div className="text-xl font-bold font-mono" style={{ color: "#01696F" }}>{hourLabel(stats.lowHour)}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-xs text-muted-foreground">Peak Day</div>
          <div className="text-xl font-bold font-mono" style={{ color: "#01696F" }}>{DAY_NAMES[stats.peakDay]}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <div className="text-xs text-muted-foreground">Avg Daily</div>
          <div className="text-xl font-bold font-mono" style={{ color: "#01696F" }}>{stats.avgDaily.toFixed(0)}</div>
        </CardContent></Card>
      </div>

      {/* Heatmaps */}
      <Heatmap data={avgVerified} title="Average Samples Verified (Heatmap)" />

      {/* Staffing vs Demand */}
      <div>
        <h3 className="text-sm font-semibold mb-2">Staffing vs Demand Comparison</h3>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse w-full">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left border" style={{ backgroundColor: "#01696F10" }}>Hour</th>
                {DAY_NAMES.map(d => (
                  <th key={d} className="px-2 py-1 text-center border min-w-[90px]" style={{ backgroundColor: "#01696F10" }}>{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, h) => (
                <tr key={h}>
                  <td className="px-2 py-0.5 border text-muted-foreground whitespace-nowrap">{hourLabel(h)}</td>
                  {DAY_NAMES.map((_, d) => {
                    const verified = avgVerified[h][d];
                    const staff = staffGrid[h][d];
                    const perStaff = staff > 0 ? (verified / staff).toFixed(1) : "-";
                    let bg = "";
                    if (staff > 0 && verified > 0) {
                      const ratio = verified / staff;
                      if (ratio > 20) bg = "bg-red-100 dark:bg-red-900/30"; // understaffed
                      else if (ratio < 5 && staff > 1) bg = "bg-blue-100 dark:bg-blue-900/30"; // overstaffed
                    }
                    return (
                      <td key={d} className={`px-1 py-0.5 border text-center ${bg}`}>
                        <div className="text-[10px] text-muted-foreground">{verified > 0 ? verified.toFixed(0) : "-"} / {staff || "-"}</div>
                        <div className="font-medium">{perStaff}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-4 mt-2 text-xs">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border" /> Understaffed (high demand)</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-100 border" /> Overstaffed (low demand)</span>
        </div>
      </div>

      {/* Specimen Demand by Hour */}
      <Heatmap data={avgReceived} title="Specimen Demand by Hour (Average Volume)" />

      {/* FTE Staffing Recommendation */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Recommended Staffing (FTEs)</h3>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground whitespace-nowrap">Throughput rate:</label>
            <input
              type="number"
              className="w-16 px-2 py-1 text-xs border rounded text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              value={throughputRate}
              onChange={e => { const v = parseFloat(e.target.value); if (v > 0) setThroughputRate(v); }}
              min={1}
              max={200}
            />
            <span className="text-xs text-muted-foreground whitespace-nowrap">specimens / tech / hour</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="px-2 py-1 text-left border" style={{ backgroundColor: "#01696F10" }}>Hour</th>
                {DAY_NAMES.map(d => <th key={d} className="px-2 py-1 text-center border min-w-[60px]" style={{ backgroundColor: "#01696F10" }}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, h) => (
                <tr key={h}>
                  <td className="px-2 py-0.5 border text-muted-foreground whitespace-nowrap">{hourLabel(h)}</td>
                  {DAY_NAMES.map((_, d) => {
                    const fte = fteGrid[h][d];
                    const curr = staffGrid[h][d];
                    const diff = fte - curr;
                    return (
                      <td key={d} className={`border text-center px-2 py-0.5 ${curr > 0 && diff > 0 ? "bg-red-50 dark:bg-red-900/20" : curr > 0 && diff < 0 ? "bg-emerald-50 dark:bg-emerald-900/20" : ""}`}>
                        {fte > 0 ? fte : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-4 mt-2 text-xs">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-50 border" /> More staff needed than currently scheduled</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-50 border" /> Fewer staff needed than currently scheduled</span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">FTE = specimens per hour / throughput rate, rounded up. Adjust the throughput rate to match your department's processing capacity.</p>
      </div>
    </div>
  );
}

// ── Main Page Component ─────────────────────────────────────────────────────
export default function VeritaBenchStaffingPage() {
  const { user, isLoggedIn } = useAuth();
  const readOnly = useIsReadOnly("veritabench");
  const { toast } = useToast();
  const [studies, setStudies] = useState<StaffingStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStudy, setSelectedStudy] = useState<StaffingStudy | null>(null);
  const [studyData, setStudyData] = useState<HourlyDataItem[]>([]);
  const [activeTab, setActiveTab] = useState<string>("week1");

  const hasPlanAccess = user && ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user.plan);

  async function loadStudies() {
    try {
      const res = await fetch(`${API_BASE}/api/staffing-studies`, { headers: authHeaders() });
      if (res.ok) setStudies(await res.json());
    } catch {} finally { setLoading(false); }
  }

  async function loadStudyData(id: number) {
    try {
      const res = await fetch(`${API_BASE}/api/staffing-studies/${id}`, { headers: authHeaders() });
      if (res.ok) {
        const result = await res.json();
        setStudyData(result.data || []);
      }
    } catch {}
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess) loadStudies();
    else setLoading(false);
  }, [isLoggedIn, hasPlanAccess]);

  useEffect(() => {
    if (selectedStudy) loadStudyData(selectedStudy.id);
  }, [selectedStudy]);

  async function handleCreate(name: string, dept: string, startDate: string) {
    try {
      const res = await fetch(`${API_BASE}/api/staffing-studies`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name, department: dept, start_date: startDate || null }),
      });
      if (res.ok) { toast({ title: "Study created" }); loadStudies(); }
    } catch { toast({ title: "Create failed", variant: "destructive" }); }
  }

  async function handleDelete(s: StaffingStudy) {
    try {
      const res = await fetch(`${API_BASE}/api/staffing-studies/${s.id}`, { method: "DELETE", headers: authHeaders() });
      if (res.ok) {
        toast({ title: "Study deleted" });
        if (selectedStudy?.id === s.id) { setSelectedStudy(null); setStudyData([]); }
        loadStudies();
      }
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  }

  async function handleSaveData(items: Omit<HourlyDataItem, "id" | "study_id" | "created_at">[]) {
    if (!selectedStudy) return;
    try {
      await fetch(`${API_BASE}/api/staffing-studies/${selectedStudy.id}/data`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(items),
      });
    } catch {}
    // Reload data
    loadStudyData(selectedStudy.id);
  }

  async function handleExport() {
    if (!selectedStudy) return;
    try {
      const res = await fetch(`${API_BASE}/api/staffing-studies/${selectedStudy.id}/export`, { headers: authHeaders() });
      if (res.ok) {
        const blob = await res.blob();
        saveAs(blob, `Staffing-Analysis_${selectedStudy.name.replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`);
      }
    } catch { toast({ title: "Export failed", variant: "destructive" }); }
  }

  // Auth gates
  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <Lock size={40} className="text-muted-foreground mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">Sign in to access VeritaShift™</h2>
        <Button asChild><Link href="/login">Sign in</Link></Button>
      </div>
    );
  }
  if (!hasPlanAccess) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <Users size={40} className="text-muted-foreground mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">Upgrade to access VeritaShift™</h2>
        <p className="text-muted-foreground mb-6 max-w-md">VeritaShift{"\u2122"} is included in all VeritaAssure{"\u2122"} suite plans. Subscribe to get started.</p>
        <Button asChild style={{ backgroundColor: "#01696F" }}><Link href="/pricing">View Plans</Link></Button>
      </div>
    );
  }

  // Study detail view
  if (selectedStudy) {
    const weekTabs = ["week1", "week2", "week3", "week4", "week5", "week6", "staffing", "analysis"];
    const weekLabels = ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5", "Week 6", "Staffing", "Analysis"];

    const weekData = (wk: number) => studyData.filter(d => d.week_number === wk);
    const staffData = studyData.filter(d => d.metric_type === "staffing");

    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button variant="ghost" size="icon" onClick={() => { setSelectedStudy(null); setStudyData([]); setActiveTab("week1"); }}>
            <ArrowLeft size={16} />
          </Button>
          <div className="flex-1">
            <h1 className="font-serif text-xl font-bold" style={{ color: "#01696F" }}>{selectedStudy.name}</h1>
            <p className="text-xs text-muted-foreground">{selectedStudy.department} - {selectedStudy.status}</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport}><FileDown size={14} className="mr-1.5" />Export</Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-0.5 mb-6 overflow-x-auto border-b">
          {weekTabs.map((t, i) => (
            <button key={t} onClick={() => setActiveTab(t)} className={`px-3 py-2 text-xs font-medium border-b-2 whitespace-nowrap transition-colors ${activeTab === t ? "border-[#01696F] text-[#01696F]" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {weekLabels[i]}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab.startsWith("week") && activeTab !== "analysis" && (
          <DataGrid
            studyId={selectedStudy.id}
            data={weekData(parseInt(activeTab.replace("week", "")))}
            onSave={handleSaveData}
            readOnly={readOnly}
            weekNum={parseInt(activeTab.replace("week", ""))}
            metricTypes={["received", "verified"]}
            allData={studyData}
          />
        )}

        {activeTab === "staffing" && (
          <DataGrid
            studyId={selectedStudy.id}
            data={staffData}
            onSave={(items) => handleSaveData(items.map(i => ({ ...i, week_number: 0 })))}
            readOnly={readOnly}
            weekNum={0}
            metricTypes={["staffing"]}
            allData={studyData}
          />
        )}

        {activeTab === "analysis" && (
          <AnalysisView data={studyData} studyName={selectedStudy.name} />
        )}
      </div>
    );
  }

  // Study list view
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <StudyListView
        studies={studies}
        onSelect={setSelectedStudy}
        onCreate={handleCreate}
        onDelete={handleDelete}
        readOnly={readOnly}
      />
    </div>
  );
}
