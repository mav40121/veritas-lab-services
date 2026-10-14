// VeritaMaintain temperature logs (St. Charles REQ-068, 2026-10-14). Storage units with the lab's own
// acceptable range; staff record readings with their initials; an out-of-range reading requires the
// corrective action taken (42 CFR 493.1252(b): temperature conditions defined, monitored and documented).
// Server: server/temperatureLogs.ts. Setup (add / edit / retire a unit) needs VeritaMaintain edit rights;
// recording a reading is open to every lab member.
import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useIsReadOnly, useCanRecord } from "@/components/SubscriptionBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Thermometer } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type TempUnit = {
  id: number; name: string; unit_type: string; location: string | null;
  min_value: number | null; max_value: number | null; scale: "C" | "F"; readings_per_day: number; active: number;
  today_count?: number; today_out_of_range?: number;
  last_reading?: TempReading | null;
};
type TempReading = {
  id: number; unit_id: number; reading_date: string; reading_time: string | null; value: number; in_range: number;
  initials: string | null; recorded_by_name: string | null; corrective_action: string | null;
};

const UNIT_TYPES: { value: string; label: string }[] = [
  { value: "refrigerator", label: "Refrigerator" },
  { value: "freezer", label: "Freezer" },
  { value: "incubator", label: "Incubator" },
  { value: "platelet_incubator", label: "Platelet incubator" },
  { value: "room", label: "Room" },
  { value: "water_bath", label: "Water bath" },
  { value: "heat_block", label: "Heat block" },
  { value: "other", label: "Other" },
];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(UNIT_TYPES.map((t) => [t.value, t.label]));

const todayLocal = () => new Date().toLocaleDateString("en-CA");
const nowHhMm = () => new Date().toTimeString().slice(0, 5);
const parseTemp = (s: string): number | null => { const t = s.trim(); if (!t) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const fmtRange = (u: TempUnit) => `${u.min_value ?? "?"} to ${u.max_value ?? "?"} °${u.scale}`;
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
};

export function TemperatureLogsPanel({ labId }: { labId: number }) {
  const { toast } = useToast();
  const setupReadOnly = useIsReadOnly("veritamaintain");
  const canRecord = useCanRecord();
  const base = `${API_BASE}/api/labs/${labId}/temp-logs`;
  const [units, setUnits] = useState<TempUnit[]>([]);
  const [loading, setLoading] = useState(true);

  // Unit dialog (add / edit)
  const [unitOpen, setUnitOpen] = useState(false);
  const [editing, setEditing] = useState<TempUnit | null>(null);
  const [uName, setUName] = useState("");
  const [uType, setUType] = useState("refrigerator");
  const [uLoc, setULoc] = useState("");
  const [uMin, setUMin] = useState("");
  const [uMax, setUMax] = useState("");
  const [uScale, setUScale] = useState<"C" | "F">("C");
  const [uPerDay, setUPerDay] = useState(1);
  const [uSaving, setUSaving] = useState(false);

  // Record dialog
  const [recFor, setRecFor] = useState<TempUnit | null>(null);
  const [rDate, setRDate] = useState(todayLocal());
  const [rTime, setRTime] = useState(nowHhMm());
  const [rValue, setRValue] = useState("");
  const [rInitials, setRInitials] = useState("");
  const [rAction, setRAction] = useState("");
  const [rSaving, setRSaving] = useState(false);

  // Log dialog
  const [logFor, setLogFor] = useState<TempUnit | null>(null);
  const [logMonth, setLogMonth] = useState(todayLocal().slice(0, 7));
  const [logRows, setLogRows] = useState<TempReading[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`${base}/units`, { headers: authHeaders() });
      if (r.ok) { const j = await r.json(); setUnits(Array.isArray(j.units) ? j.units : []); }
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [labId]);

  function openAdd() {
    setEditing(null); setUName(""); setUType("refrigerator"); setULoc(""); setUMin(""); setUMax(""); setUScale("C"); setUPerDay(1); setUnitOpen(true);
  }
  function openEdit(u: TempUnit) {
    setEditing(u); setUName(u.name); setUType(u.unit_type); setULoc(u.location || ""); setUMin(u.min_value == null ? "" : String(u.min_value));
    setUMax(u.max_value == null ? "" : String(u.max_value)); setUScale(u.scale); setUPerDay(u.readings_per_day); setUnitOpen(true);
  }
  async function saveUnit() {
    const min = parseTemp(uMin), max = parseTemp(uMax);
    if (!uName.trim()) { toast({ title: "Name the storage unit", variant: "destructive" }); return; }
    if (min === null || max === null) { toast({ title: "Enter the acceptable range (from the manufacturer or your procedure)", variant: "destructive" }); return; }
    if (min >= max) { toast({ title: "The low limit must be below the high limit", variant: "destructive" }); return; }
    setUSaving(true);
    try {
      const r = await fetch(editing ? `${base}/units/${editing.id}` : `${base}/units`, {
        method: editing ? "PUT" : "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: uName.trim(), unit_type: uType, location: uLoc.trim() || null, min_value: min, max_value: max, scale: uScale, readings_per_day: uPerDay }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); toast({ title: e.error || "Could not save the storage unit", variant: "destructive" }); return; }
      toast({ title: editing ? "Storage unit updated" : "Storage unit added" });
      setUnitOpen(false); await load();
    } finally { setUSaving(false); }
  }
  async function retireUnit(u: TempUnit) {
    if (!window.confirm(`Retire ${u.name}? Its readings stay on file.`)) return;
    const r = await fetch(`${base}/units/${u.id}`, { method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ active: false }) });
    if (!r.ok) { const e = await r.json().catch(() => ({})); toast({ title: e.error || "Could not retire the unit", variant: "destructive" }); return; }
    toast({ title: `${u.name} retired` }); await load();
  }

  function openRecord(u: TempUnit) {
    setRecFor(u); setRDate(todayLocal()); setRTime(nowHhMm()); setRValue(""); setRInitials(""); setRAction("");
  }
  const recValue = parseTemp(rValue);
  const recOut = !!recFor && recValue !== null && ((recFor.min_value !== null && recValue < recFor.min_value) || (recFor.max_value !== null && recValue > recFor.max_value));
  async function saveReading() {
    if (!recFor) return;
    if (recValue === null) { toast({ title: "Enter the temperature you read", variant: "destructive" }); return; }
    if (!rInitials.trim()) { toast({ title: "Enter your initials", variant: "destructive" }); return; }
    if (recOut && !rAction.trim()) { toast({ title: "Out of range: record the corrective action taken", variant: "destructive" }); return; }
    setRSaving(true);
    try {
      const r = await fetch(`${base}/units/${recFor.id}/readings`, {
        method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ reading_date: rDate, reading_time: rTime || null, value: recValue, initials: rInitials.trim(), corrective_action: rAction.trim() || null }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); toast({ title: e.error || "Could not record the reading", variant: "destructive" }); return; }
      toast({ title: recOut ? "Out-of-range reading recorded with its corrective action" : "Reading recorded" });
      setRecFor(null); await load();
    } finally { setRSaving(false); }
  }

  async function loadLog(u: TempUnit, month: string) {
    setLogLoading(true); setLogRows([]);
    try {
      const r = await fetch(`${base}/units/${u.id}/readings?month=${month}`, { headers: authHeaders() });
      if (r.ok) { const j = await r.json(); setLogRows(Array.isArray(j.readings) ? j.readings : []); }
    } finally { setLogLoading(false); }
  }
  function openLog(u: TempUnit) { const m = todayLocal().slice(0, 7); setLogFor(u); setLogMonth(m); loadLog(u, m); }
  function moveLog(delta: number) { if (!logFor) return; const m = shiftMonth(logMonth, delta); setLogMonth(m); loadLog(logFor, m); }

  return (
    <Card className="mt-4" data-testid="temp-logs-panel">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base flex items-center gap-2"><Thermometer className="h-4 w-4 text-primary" /> Temperature logs</CardTitle>
        <Button size="sm" onClick={openAdd} disabled={setupReadOnly} data-testid="temp-add-unit">+ Add storage unit</Button>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">Refrigerators, freezers, incubators, rooms and other storage. Each unit carries your acceptable range; a reading outside it needs the corrective action taken. CLIA 42 CFR 493.1252(b) asks the lab to define, monitor and document storage conditions such as temperature.</p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : units.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="temp-empty">No storage units yet. Add each refrigerator, freezer or incubator you monitor, with its acceptable range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="temp-units-table">
              <thead>
                <tr className="text-left text-xs uppercase text-muted-foreground border-b">
                  <th className="py-2 pr-2">Unit</th>
                  <th className="py-2 pr-2">Range</th>
                  <th className="py-2 pr-2">Today</th>
                  <th className="py-2 pr-2">Last reading</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => {
                  const done = (u.today_count ?? 0) >= u.readings_per_day;
                  const lr = u.last_reading;
                  return (
                    <tr key={u.id} className="border-b last:border-0 align-top">
                      <td className="py-2 pr-2">
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{TYPE_LABEL[u.unit_type] || u.unit_type}{u.location ? ` · ${u.location}` : ""}</div>
                      </td>
                      <td className="py-2 pr-2 whitespace-nowrap">{fmtRange(u)}</td>
                      <td className="py-2 pr-2 whitespace-nowrap" data-testid={`temp-today-${u.id}`}>
                        <Badge variant="outline" className={done ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : "border-amber-500/40 text-amber-700 dark:text-amber-400"}>
                          {u.today_count ?? 0} of {u.readings_per_day}
                        </Badge>
                        {(u.today_out_of_range ?? 0) > 0 && <Badge className="ml-1 bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300">{u.today_out_of_range} out of range</Badge>}
                      </td>
                      <td className="py-2 pr-2 text-xs">
                        {lr ? (
                          <span className={lr.in_range ? "" : "text-red-700 dark:text-red-400 font-medium"}>
                            {lr.value} °{u.scale} on {lr.reading_date}{lr.reading_time ? ` ${lr.reading_time}` : ""}{lr.initials ? ` (${lr.initials})` : ""}
                          </span>
                        ) : <span className="text-muted-foreground">None yet</span>}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1 justify-end">
                          <Button size="sm" variant="outline" onClick={() => openRecord(u)} disabled={!canRecord} data-testid={`temp-record-${u.id}`}>Record reading</Button>
                          <Button size="sm" variant="ghost" onClick={() => openLog(u)} data-testid={`temp-log-${u.id}`}>Log</Button>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(u)} disabled={setupReadOnly}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => retireUnit(u)} disabled={setupReadOnly}>Retire</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Add / edit storage unit */}
      <Dialog open={unitOpen} onOpenChange={setUnitOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit storage unit" : "Add storage unit"}</DialogTitle>
            <DialogDescription>Use the acceptable range from the manufacturer's instructions or your procedure.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><Label htmlFor="tu-name">Name <span className="text-red-600">*</span></Label><Input id="tu-name" value={uName} onChange={(e) => setUName(e.target.value)} placeholder="e.g. Blood bank refrigerator 1" /></div>
            <div>
              <Label htmlFor="tu-type">Type</Label>
              <select id="tu-type" className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={uType} onChange={(e) => setUType(e.target.value)}>
                {UNIT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div><Label htmlFor="tu-loc">Location</Label><Input id="tu-loc" value={uLoc} onChange={(e) => setULoc(e.target.value)} placeholder="e.g. Blood bank, room 112" /></div>
            <div><Label htmlFor="tu-min">Low limit <span className="text-red-600">*</span></Label><Input id="tu-min" inputMode="decimal" value={uMin} onChange={(e) => setUMin(e.target.value)} placeholder="e.g. 1" /></div>
            <div><Label htmlFor="tu-max">High limit <span className="text-red-600">*</span></Label><Input id="tu-max" inputMode="decimal" value={uMax} onChange={(e) => setUMax(e.target.value)} placeholder="e.g. 6" /></div>
            <div>
              <Label htmlFor="tu-scale">Scale</Label>
              <select id="tu-scale" className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={uScale} onChange={(e) => setUScale(e.target.value as "C" | "F")}>
                <option value="C">Celsius (°C)</option>
                <option value="F">Fahrenheit (°F)</option>
              </select>
            </div>
            <div>
              <Label htmlFor="tu-per-day">Readings per day</Label>
              <select id="tu-per-day" className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={uPerDay} onChange={(e) => setUPerDay(Number(e.target.value))}>
                <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setUnitOpen(false)} disabled={uSaving}>Cancel</Button>
            <Button onClick={saveUnit} disabled={uSaving} data-testid="temp-save-unit">{uSaving ? "Saving..." : editing ? "Save changes" : "Add unit"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Record reading */}
      <Dialog open={!!recFor} onOpenChange={(o) => { if (!o) setRecFor(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record reading{recFor ? `: ${recFor.name}` : ""}</DialogTitle>
            <DialogDescription>{recFor ? `Acceptable range ${fmtRange(recFor)}.` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="tr-date">Date</Label><Input id="tr-date" type="date" value={rDate} max={todayLocal()} onChange={(e) => setRDate(e.target.value)} /></div>
            <div><Label htmlFor="tr-time">Time</Label><Input id="tr-time" type="time" value={rTime} onChange={(e) => setRTime(e.target.value)} /></div>
            <div><Label htmlFor="tr-value">Temperature (°{recFor?.scale || "C"}) <span className="text-red-600">*</span></Label><Input id="tr-value" inputMode="decimal" value={rValue} onChange={(e) => setRValue(e.target.value)} data-testid="temp-value" /></div>
            <div><Label htmlFor="tr-init">Initials <span className="text-red-600">*</span></Label><Input id="tr-init" value={rInitials} maxLength={8} onChange={(e) => setRInitials(e.target.value)} data-testid="temp-initials" /></div>
            {recOut && (
              <div className="col-span-2" data-testid="temp-out-of-range">
                <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">Out of range. Record the corrective action taken.</p>
                <Textarea id="tr-action" rows={3} value={rAction} onChange={(e) => setRAction(e.target.value)} placeholder="e.g. Moved contents to backup refrigerator, called facilities, re-checked at 14:30" data-testid="temp-action" />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setRecFor(null)} disabled={rSaving}>Cancel</Button>
            <Button onClick={saveReading} disabled={rSaving} data-testid="temp-save-reading">{rSaving ? "Saving..." : "Record reading"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Month log */}
      <Dialog open={!!logFor} onOpenChange={(o) => { if (!o) setLogFor(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Temperature log{logFor ? `: ${logFor.name}` : ""}</DialogTitle>
            <DialogDescription>{logFor ? `Acceptable range ${fmtRange(logFor)} · ${logFor.readings_per_day} reading${logFor.readings_per_day === 1 ? "" : "s"} a day` : ""}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between mb-2">
            <Button size="sm" variant="outline" onClick={() => moveLog(-1)}>Previous month</Button>
            <span className="text-sm font-medium" data-testid="temp-log-month">{logMonth}</span>
            <Button size="sm" variant="outline" onClick={() => moveLog(1)} disabled={logMonth >= todayLocal().slice(0, 7)}>Next month</Button>
          </div>
          {logLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading...</p>
          ) : logRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No readings recorded this month.</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-sm" data-testid="temp-log-table">
                <thead>
                  <tr className="text-left text-xs uppercase text-muted-foreground border-b">
                    <th className="py-1.5 pr-2">Date</th><th className="py-1.5 pr-2">Time</th><th className="py-1.5 pr-2">Reading</th>
                    <th className="py-1.5 pr-2">Initials</th><th className="py-1.5">Corrective action</th>
                  </tr>
                </thead>
                <tbody>
                  {logRows.map((r) => (
                    <tr key={r.id} className={`border-b last:border-0 ${r.in_range ? "" : "bg-red-50 dark:bg-red-950/30"}`}>
                      <td className="py-1.5 pr-2">{r.reading_date}</td>
                      <td className="py-1.5 pr-2">{r.reading_time || "-"}</td>
                      <td className={`py-1.5 pr-2 font-mono ${r.in_range ? "" : "text-red-700 dark:text-red-400 font-semibold"}`}>{r.value} °{logFor?.scale}{r.in_range ? "" : " (out of range)"}</td>
                      <td className="py-1.5 pr-2" title={r.recorded_by_name || ""}>{r.initials || "-"}</td>
                      <td className="py-1.5 whitespace-pre-wrap">{r.corrective_action || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
