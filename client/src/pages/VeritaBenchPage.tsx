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
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Lock, Plus, FileDown, Edit2, Trash2, TrendingUp, TrendingDown,
  BarChart3, Users, Activity,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Tooltip as RechartsTooltip, ReferenceLine, ReferenceArea, Legend,
} from "recharts";
import { saveAs } from "file-saver";

interface ProductivityMonth {
  id: number;
  account_id: number;
  year: number;
  month: number;
  billable_tests: number | null;
  productive_hours: number | null;
  non_productive_hours: number | null;
  overtime_hours: number | null;
  total_ftes: number | null;
  facility_type: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const FACILITY_TYPES: Record<string, string> = {
  community: "Community Hospital (200K-500K billables/yr)",
  trauma: "Large Trauma Center (750K-1.5M billables/yr)",
  reference: "Reference Lab (2M+ billables/yr)",
  other: "Other/Unknown",
};

const BENCHMARKS: Record<string, { low: number; high: number }> = {
  community: { low: 0.15, high: 0.22 },
  trauma: { low: 0.09, high: 0.13 },
  reference: { low: 0.06, high: 0.09 },
};

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function ratio(pm: ProductivityMonth): number | null {
  if (!pm.productive_hours || !pm.billable_tests || pm.billable_tests === 0) return null;
  return pm.productive_hours / pm.billable_tests;
}

function otPct(pm: ProductivityMonth): number | null {
  if (!pm.overtime_hours || !pm.productive_hours) return null;
  return (pm.overtime_hours / pm.productive_hours) * 100;
}

function productivePct(pm: ProductivityMonth): number | null {
  if (!pm.productive_hours || pm.non_productive_hours == null) return null;
  return (pm.productive_hours / (pm.productive_hours + pm.non_productive_hours)) * 100;
}

export default function VeritaBenchPage() {
  const { user, isLoggedIn } = useAuth();
  const readOnly = useIsReadOnly("veritabench");
  const { toast } = useToast();
  const [tab, setTab] = useState<"data" | "dashboard">("dashboard");
  const [months, setMonths] = useState<ProductivityMonth[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editRow, setEditRow] = useState<ProductivityMonth | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductivityMonth | null>(null);

  // Form state
  const [fYear, setFYear] = useState<number>(2026);
  const [fMonth, setFMonth] = useState<number>(new Date().getMonth() + 1);
  const [fBillable, setFBillable] = useState<string>("");
  const [fProdHours, setFProdHours] = useState<string>("");
  const [fNonProdHours, setFNonProdHours] = useState<string>("");
  const [fOTHours, setFOTHours] = useState<string>("");
  const [fFTEs, setFFTEs] = useState<string>("");
  const [fFacilityType, setFFacilityType] = useState<string>("community");
  const [fNotes, setFNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const hasPlanAccess = user && ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user.plan);

  async function loadData() {
    try {
      const res = await fetch(`${API_BASE}/api/productivity`, { headers: authHeaders() });
      if (res.ok) setMonths(await res.json());
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess) loadData();
    else setLoading(false);
  }, [isLoggedIn, hasPlanAccess]);

  function openAdd() {
    setEditRow(null);
    setFYear(2026);
    setFMonth(new Date().getMonth() + 1);
    setFBillable("");
    setFProdHours("");
    setFNonProdHours("");
    setFOTHours("");
    setFFTEs("");
    setFFacilityType("community");
    setFNotes("");
    setShowForm(true);
  }

  function openEdit(pm: ProductivityMonth) {
    setEditRow(pm);
    setFYear(pm.year);
    setFMonth(pm.month);
    setFBillable(pm.billable_tests?.toString() ?? "");
    setFProdHours(pm.productive_hours?.toString() ?? "");
    setFNonProdHours(pm.non_productive_hours?.toString() ?? "");
    setFOTHours(pm.overtime_hours?.toString() ?? "");
    setFFTEs(pm.total_ftes?.toString() ?? "");
    setFFacilityType(pm.facility_type ?? "community");
    setFNotes(pm.notes ?? "");
    setShowForm(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/productivity`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          year: fYear,
          month: fMonth,
          billable_tests: fBillable ? parseInt(fBillable) : null,
          productive_hours: fProdHours ? parseFloat(fProdHours) : null,
          non_productive_hours: fNonProdHours ? parseFloat(fNonProdHours) : null,
          overtime_hours: fOTHours ? parseFloat(fOTHours) : null,
          total_ftes: fFTEs ? parseFloat(fFTEs) : null,
          facility_type: fFacilityType,
          notes: fNotes || null,
        }),
      });
      if (res.ok) {
        toast({ title: "Saved" });
        setShowForm(false);
        loadData();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error, variant: "destructive" });
      }
    } catch { toast({ title: "Save failed", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`${API_BASE}/api/productivity/${deleteTarget.id}`, { method: "DELETE", headers: authHeaders() });
      if (res.ok) { toast({ title: "Deleted" }); loadData(); }
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
    setDeleteTarget(null);
  }

  async function handleExport() {
    try {
      const res = await fetch(`${API_BASE}/api/productivity/export`, { headers: authHeaders() });
      if (res.ok) {
        const blob = await res.blob();
        saveAs(blob, `VeritaBench-Productivity_${new Date().toISOString().split("T")[0]}.xlsx`);
      }
    } catch { toast({ title: "Export failed", variant: "destructive" }); }
  }

  // Dashboard computations
  const sorted = useMemo(() => [...months].sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month)), [months]);
  const currentMonth = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const currentRatio = currentMonth ? ratio(currentMonth) : null;

  const ytdData = useMemo(() => {
    const cy = currentMonth?.year ?? 2026;
    return sorted.filter(m => m.year === cy);
  }, [sorted, currentMonth]);

  const ytdAvg = useMemo(() => {
    const vals = ytdData.map(m => ratio(m)).filter((v): v is number => v != null);
    return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  }, [ytdData]);

  const yoyChange = useMemo(() => {
    if (!currentMonth) return null;
    const cy = currentMonth.year;
    const lastYearData = sorted.filter(m => m.year === cy - 1);
    if (lastYearData.length === 0) return null;
    const lyVals = lastYearData.map(m => ratio(m)).filter((v): v is number => v != null);
    const lyAvg = lyVals.length > 0 ? lyVals.reduce((s, v) => s + v, 0) / lyVals.length : null;
    if (!lyAvg || !ytdAvg) return null;
    return ((ytdAvg - lyAvg) / lyAvg) * 100;
  }, [sorted, currentMonth, ytdAvg]);

  const currentOT = currentMonth ? otPct(currentMonth) : null;

  // Chart data
  const chartData = useMemo(() => {
    return sorted.map(m => ({
      label: `${MONTH_NAMES[m.month]} ${m.year}`,
      ratio: ratio(m),
      otPct: otPct(m),
    }));
  }, [sorted]);

  const facilityBenchmark = currentMonth ? BENCHMARKS[currentMonth.facility_type] : BENCHMARKS.community;

  // Unauthenticated gate
  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <Lock size={40} className="text-muted-foreground mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">Sign in to access VeritaBench{"\u2122"}</h2>
        <p className="text-muted-foreground mb-6 max-w-md">Track your lab's productivity and staffing data over time.</p>
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

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-serif text-2xl font-bold" style={{ color: "#01696F" }}>Productivity Tracker</h1>
          <p className="text-sm text-muted-foreground mt-1">Monthly productivity data entry and trend analysis</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}><FileDown size={14} className="mr-1.5" />Export</Button>
          <Button size="sm" onClick={openAdd} disabled={readOnly} style={{ backgroundColor: "#01696F" }}><Plus size={14} className="mr-1.5" />Add Month</Button>
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

      {tab === "dashboard" && (
        <div className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Current Ratio</div>
                <div className="text-3xl font-bold font-mono mt-1" style={{ color: "#01696F" }}>
                  {currentRatio != null ? currentRatio.toFixed(3) : "-"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {currentMonth ? `${FULL_MONTHS[currentMonth.month]} ${currentMonth.year}` : "No data"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">YTD Average</div>
                <div className="text-3xl font-bold font-mono mt-1" style={{ color: "#01696F" }}>
                  {ytdAvg != null ? ytdAvg.toFixed(3) : "-"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{currentMonth?.year ?? ""} year-to-date</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Year-over-Year</div>
                <div className="text-3xl font-bold font-mono mt-1 flex items-center gap-1" style={{ color: yoyChange != null && yoyChange < 0 ? "#16a34a" : yoyChange != null && yoyChange > 0 ? "#dc2626" : "#01696F" }}>
                  {yoyChange != null ? (
                    <>{yoyChange < 0 ? <TrendingDown size={18} /> : <TrendingUp size={18} />}{Math.abs(yoyChange).toFixed(1)}%</>
                  ) : "-"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {yoyChange != null && yoyChange < 0 ? "Improving (lower is better)" : yoyChange != null ? "Increasing" : "Prior year data needed"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">OT %</div>
                <div className="text-3xl font-bold font-mono mt-1" style={{ color: "#01696F" }}>
                  {currentOT != null ? currentOT.toFixed(1) + "%" : "-"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Overtime as % of productive</div>
              </CardContent>
            </Card>
          </div>

          {/* Chart */}
          {chartData.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Productivity Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={chartData} margin={{ top: 10, right: 30, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={60} />
                    <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                    <RechartsTooltip formatter={(v: number) => v?.toFixed(4)} />
                    <Legend />
                    {facilityBenchmark && (
                      <ReferenceArea y1={facilityBenchmark.low} y2={facilityBenchmark.high} fill="#01696F" fillOpacity={0.08} label={{ value: "Benchmark", fontSize: 10, fill: "#01696F" }} />
                    )}
                    <Line type="monotone" dataKey="ratio" stroke="#01696F" strokeWidth={2} dot={{ r: 4 }} name="Productivity Ratio" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === "data" && (
        <div>
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : months.length === 0 ? (
            <div className="text-center py-12">
              <Activity size={40} className="mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">No productivity data yet. Add your first month to get started.</p>
              <Button onClick={openAdd} style={{ backgroundColor: "#01696F" }}><Plus size={14} className="mr-1.5" />Add Month</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b" style={{ backgroundColor: "#01696F10" }}>
                    <th className="text-left px-3 py-2 font-medium">Period</th>
                    <th className="text-right px-3 py-2 font-medium">Billable Tests</th>
                    <th className="text-right px-3 py-2 font-medium">Prod. Hours</th>
                    <th className="text-right px-3 py-2 font-medium">Ratio</th>
                    <th className="text-right px-3 py-2 font-medium">OT %</th>
                    <th className="text-right px-3 py-2 font-medium">Prod. %</th>
                    <th className="text-right px-3 py-2 font-medium">FTEs</th>
                    <th className="text-left px-3 py-2 font-medium">Notes</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((pm, i) => {
                    const r = ratio(pm);
                    const ot = otPct(pm);
                    const pp = productivePct(pm);
                    return (
                      <tr key={pm.id} className={`border-b hover:bg-muted/30 ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                        <td className="px-3 py-2 font-medium">{FULL_MONTHS[pm.month]} {pm.year}</td>
                        <td className="px-3 py-2 text-right font-mono">{pm.billable_tests?.toLocaleString() ?? "-"}</td>
                        <td className="px-3 py-2 text-right font-mono">{pm.productive_hours?.toLocaleString() ?? "-"}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold" style={{ color: "#01696F" }}>{r != null ? r.toFixed(4) : "-"}</td>
                        <td className="px-3 py-2 text-right font-mono">{ot != null ? ot.toFixed(1) + "%" : "-"}</td>
                        <td className="px-3 py-2 text-right font-mono">{pp != null ? pp.toFixed(1) + "%" : "-"}</td>
                        <td className="px-3 py-2 text-right font-mono">{pm.total_ftes ?? "-"}</td>
                        <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">{pm.notes ?? ""}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(pm)} disabled={readOnly}><Edit2 size={13} /></Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(pm)} disabled={readOnly}><Trash2 size={13} /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Form Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editRow ? "Edit Month" : "Add Month"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Year</Label>
                <Select value={String(fYear)} onValueChange={v => setFYear(parseInt(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[2024, 2025, 2026, 2027].map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Month</Label>
                <Select value={String(fMonth)} onValueChange={v => setFMonth(parseInt(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FULL_MONTHS.slice(1).map((m, i) => <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Billable Tests</Label>
                <Input type="number" value={fBillable} onChange={e => setFBillable(e.target.value)} placeholder="e.g. 36000" />
              </div>
              <div className="space-y-1.5">
                <Label>Productive Hours</Label>
                <Input type="number" value={fProdHours} onChange={e => setFProdHours(e.target.value)} placeholder="e.g. 5200" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Non-Productive Hours</Label>
                <Input type="number" value={fNonProdHours} onChange={e => setFNonProdHours(e.target.value)} placeholder="e.g. 800" />
              </div>
              <div className="space-y-1.5">
                <Label>Overtime Hours</Label>
                <Input type="number" value={fOTHours} onChange={e => setFOTHours(e.target.value)} placeholder="e.g. 400" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Total FTEs</Label>
                <Input type="number" value={fFTEs} onChange={e => setFFTEs(e.target.value)} placeholder="e.g. 15" step={0.5} />
              </div>
              <div className="space-y-1.5">
                <Label>Facility Type</Label>
                <Select value={fFacilityType} onValueChange={setFFacilityType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(FACILITY_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.split("(")[0].trim()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={fNotes} onChange={e => setFNotes(e.target.value)} placeholder="Optional context for this month" rows={2} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving} style={{ backgroundColor: "#01696F" }}>{saving ? "Saving..." : "Save"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `Delete ${FULL_MONTHS[deleteTarget.month]} ${deleteTarget.year} data? This cannot be undone.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
