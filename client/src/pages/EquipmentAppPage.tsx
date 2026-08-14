import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Wrench, Lock, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Equipment {
  id: number;
  instrument_name: string;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  location: string | null;
  pm_interval_days: number | null;
  next_due_date: string | null;
  status: string;
  notes: string | null;
  maintenance_status: "overdue" | "due_soon" | "ok" | "none";
}

interface MaintEvent {
  id: number;
  event_type: string;
  event_date: string;
  performed_by: string | null;
  next_due_date: string | null;
  notes: string | null;
}

const EVENT_TYPES: { value: string; label: string }[] = [
  { value: "calibration", label: "Calibration" },
  { value: "preventive_maintenance", label: "Preventive maintenance" },
  { value: "function_check", label: "Function check" },
  { value: "service", label: "Service" },
  { value: "repair", label: "Repair" },
];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(EVENT_TYPES.map(t => [t.value, t.label]));

function todayIso() { return new Date().toISOString().slice(0, 10); }

function statusBadge(s: string) {
  if (s === "overdue") return <Badge variant="outline" className="bg-red-500/10 text-red-700 border-red-500/20">Overdue</Badge>;
  if (s === "due_soon") return <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-500/20">Due soon</Badge>;
  if (s === "ok") return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-500/20">On schedule</Badge>;
  return <Badge variant="outline" className="text-muted-foreground">No schedule</Badge>;
}

// MLC-1 Phase 2: equipment maintenance-due email-reminder settings. The nightly
// engine (server/equipmentReminders.ts) reads this per lab.
function EquipmentRemindersPanel({ apiBase }: { apiBase: string }) {
  const [enabled, setEnabled] = useState(false);
  const [leadDays, setLeadDays] = useState(14);
  const [recipients, setRecipients] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await fetch(`${apiBase}/reminder-config`, { headers: authHeaders() });
        if (r.ok && live) {
          const d = await r.json();
          setEnabled(!!d.enabled); setLeadDays(d.lead_days ?? 14);
          setRecipients((d.recipients || []).map((x: any) => x.email).join(", "));
        }
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [apiBase]);

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      const recips = recipients.split(",").map(s => s.trim()).filter(Boolean).map(email => ({ email }));
      const r = await fetch(`${apiBase}/reminder-config`, {
        method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, lead_days: leadDays, overdue_cadence_days: 7, recipients: recips }),
      });
      if (r.ok) setSaved(true);
    } finally { setSaving(false); }
  };

  if (loading) return null;
  return (
    <div className="rounded-xl border border-dashed p-4 mb-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-sm font-semibold">Maintenance-due email reminders</div>
          <div className="text-xs text-muted-foreground mt-0.5">Email a digest of instruments approaching or overdue their next-due date. Overdue items repeat weekly until the maintenance is logged. Sent to the lab owner if no recipients are set.</div>
        </div>
        <label className="flex items-center gap-2 text-sm shrink-0"><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setSaved(false); }} /> Enabled</label>
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label className="text-xs">Remind within (days before due)</Label><Input type="text" inputMode="decimal" min={1} max={90} value={leadDays} onChange={e => { setLeadDays(Number(e.target.value) || 14); setSaved(false); }} /></div>
        <div><Label className="text-xs">Recipients (comma-separated emails)</Label><Input value={recipients} onChange={e => { setRecipients(e.target.value); setSaved(false); }} placeholder="Defaults to the lab owner if blank" /></div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving..." : "Save reminder settings"}</Button>
        {saved && <span className="text-xs text-emerald-600">Saved.</span>}
      </div>
    </div>
  );
}

export default function EquipmentAppPage() {
  const { user, isLoggedIn } = useAuth();
  const isReadOnly = useIsReadOnly("veritascan");
  const activeLabId = useActiveLabId();
  const { toast } = useToast();

  const hasPlanAccess = !!user && [
    "annual", "professional", "lab", "complete",
    "veritamap", "veritascan", "veritacomp",
    "clinic", "waived", "community", "hospital", "large_hospital", "enterprise",
  ].includes(user.plan);

  const [items, setItems] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Add / edit equipment dialog
  const [eqOpen, setEqOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [mfr, setMfr] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [location, setLocation] = useState("");
  const [interval, setInterval_] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [eqSaving, setEqSaving] = useState(false);

  // Log maintenance event dialog
  const [evOpen, setEvOpen] = useState(false);
  const [evForId, setEvForId] = useState<number | null>(null);
  const [evType, setEvType] = useState("calibration");
  const [evDate, setEvDate] = useState(todayIso());
  const [evBy, setEvBy] = useState("");
  const [evNextDue, setEvNextDue] = useState("");
  const [evNotes, setEvNotes] = useState("");
  const [evSaving, setEvSaving] = useState(false);

  // History dialog
  const [histOpen, setHistOpen] = useState(false);
  const [histName, setHistName] = useState("");
  const [histEvents, setHistEvents] = useState<MaintEvent[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  async function load() {
    if (!activeLabId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/equipment`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`equipment ${res.status}`);
      setItems(await res.json());
      setLoadError(false);
    } catch (err) {
      console.error("Failed to load equipment:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess && activeLabId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, hasPlanAccess, activeLabId]);

  function resetEqForm() {
    setEditingId(null); setName(""); setMfr(""); setModel(""); setSerial(""); setLocation(""); setInterval_(""); setNextDue("");
  }
  function openAdd() { resetEqForm(); setEqOpen(true); }
  function openEdit(e: Equipment) {
    setEditingId(e.id); setName(e.instrument_name); setMfr(e.manufacturer || ""); setModel(e.model || "");
    setSerial(e.serial_number || ""); setLocation(e.location || "");
    setInterval_(e.pm_interval_days != null ? String(e.pm_interval_days) : ""); setNextDue(e.next_due_date || "");
    setEqOpen(true);
  }

  async function saveEquipment() {
    if (!activeLabId || !name.trim()) { toast({ title: "Instrument name is required", variant: "destructive" }); return; }
    setEqSaving(true);
    const body = {
      instrument_name: name.trim(), manufacturer: mfr || null, model: model || null,
      serial_number: serial || null, location: location || null,
      pm_interval_days: interval || null, next_due_date: nextDue || null,
    };
    try {
      const url = editingId
        ? `${API_BASE}/api/labs/${activeLabId}/equipment/${editingId}`
        : `${API_BASE}/api/labs/${activeLabId}/equipment`;
      const res = await fetch(url, { method: editingId ? "PUT" : "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast({ title: e.error || "Could not save", variant: "destructive" }); return; }
      toast({ title: editingId ? "Equipment updated" : `Added ${name.trim()}` });
      resetEqForm(); setEqOpen(false); await load();
    } finally { setEqSaving(false); }
  }

  async function retire(e: Equipment) {
    if (!activeLabId) return;
    const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/equipment/${e.id}`, {
      method: "PUT", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify({ status: "retired" }),
    });
    if (res.ok) { toast({ title: `Retired ${e.instrument_name}` }); await load(); }
  }

  function openLogEvent(e: Equipment) {
    setEvForId(e.id); setEvType("calibration"); setEvDate(todayIso()); setEvBy(""); setEvNextDue(""); setEvNotes(""); setEvOpen(true);
  }
  async function saveEvent() {
    if (!activeLabId || !evForId || !evDate) return;
    setEvSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/equipment/${evForId}/events`, {
        method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ event_type: evType, event_date: evDate, performed_by: evBy || null, next_due_date: evNextDue || null, notes: evNotes || null }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); toast({ title: e.error || "Could not log event", variant: "destructive" }); return; }
      toast({ title: "Maintenance logged", description: "Next-due updated from the entry or the PM interval." });
      setEvOpen(false); await load();
    } finally { setEvSaving(false); }
  }

  async function openHistory(e: Equipment) {
    setHistName(e.instrument_name); setHistEvents([]); setHistOpen(true); setHistLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/equipment/${e.id}/events`, { headers: authHeaders() });
      setHistEvents(res.ok ? await res.json() : []);
    } finally { setHistLoading(false); }
  }

  if (!isLoggedIn) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card><CardContent className="py-10 text-center">
          <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-1">Sign in to use Equipment Maintenance</h2>
          <p className="text-sm text-muted-foreground mb-4">Track per-instrument calibration and preventive maintenance with due dates.</p>
          <Button asChild><Link href="/login">Sign in</Link></Button>
        </CardContent></Card>
      </div>
    );
  }
  if (!hasPlanAccess) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card><CardContent className="py-10 text-center">
          <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-1">Equipment Maintenance requires a subscription</h2>
          <p className="text-sm text-muted-foreground mb-4">Upgrade your plan to track instrument calibration, preventive maintenance, and service history.</p>
          <Button asChild><Link href="/pricing">See plans</Link></Button>
        </CardContent></Card>
      </div>
    );
  }
  if (!activeLabId) {
    return <div className="container max-w-2xl mx-auto py-12 px-4"><Card><CardContent className="py-10 text-center"><p className="text-sm text-muted-foreground">Select a lab to manage equipment.</p></CardContent></Card></div>;
  }

  const overdue = items.filter(i => i.maintenance_status === "overdue");
  const dueSoon = items.filter(i => i.maintenance_status === "due_soon");

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4">
      <div className="mb-6 flex items-center gap-2">
        <Wrench className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Equipment Maintenance</h1>
        <div className="ml-auto">
          <Button size="sm" onClick={openAdd} disabled={isReadOnly}>+ Add instrument</Button>
        </div>
      </div>

      {(overdue.length > 0 || dueSoon.length > 0) && (
        <div className={`rounded-xl border p-4 mb-4 ${overdue.length > 0 ? "border-red-300/60 bg-red-50 dark:bg-red-950/30 dark:border-red-900/40" : "border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/40"}`}>
          <div className={`text-sm font-semibold flex items-center gap-2 ${overdue.length > 0 ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}>
            <AlertTriangle className="h-4 w-4" />
            Maintenance due: {overdue.length} overdue, {dueSoon.length} due within 30 days
          </div>
          <div className="text-xs text-muted-foreground mt-1">Instrument calibration and preventive maintenance support CLIA 42 CFR 493.1254 and competency Element 4. Log the completed maintenance to clear each item.</div>
        </div>
      )}

      <EquipmentRemindersPanel apiBase={`${API_BASE}/api/labs/${activeLabId}/equipment`} />

      <Card>
        <CardHeader><CardTitle className="text-base">Instruments</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : loadError ? (
            <div className="text-sm"><p className="text-destructive font-medium mb-1">Couldn't load equipment.</p><Button size="sm" variant="outline" onClick={load}>Retry</Button></div>
          ) : items.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-muted-foreground mb-3">No instruments yet. Add your analyzers and equipment to start tracking maintenance.</p>
              <Button onClick={openAdd} disabled={isReadOnly}>Add your first instrument</Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground border-b">
                  <tr>
                    <th className="py-2 pr-2">Instrument</th>
                    <th className="py-2 pr-2">Location</th>
                    <th className="py-2 pr-2">Interval</th>
                    <th className="py-2 pr-2">Next due</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(e => (
                    <tr key={e.id} className="border-b last:border-b-0 align-top">
                      <td className="py-2 pr-2">
                        <div className="font-medium">{e.instrument_name}</div>
                        <div className="text-xs text-muted-foreground">{[e.manufacturer, e.model, e.serial_number ? `SN ${e.serial_number}` : ""].filter(Boolean).join(" · ") || "-"}</div>
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground">{e.location || "-"}</td>
                      <td className="py-2 pr-2 text-muted-foreground">{e.pm_interval_days ? `${e.pm_interval_days} d` : "-"}</td>
                      <td className="py-2 pr-2">{e.next_due_date || <span className="text-muted-foreground">-</span>}</td>
                      <td className="py-2 pr-2">{statusBadge(e.maintenance_status)}</td>
                      <td className="py-2 pr-2">
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => openLogEvent(e)} disabled={isReadOnly}>Log maintenance</Button>
                          <Button size="sm" variant="ghost" onClick={() => openHistory(e)}>History</Button>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(e)} disabled={isReadOnly}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => retire(e)} disabled={isReadOnly}>Retire</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / edit equipment */}
      <Dialog open={eqOpen} onOpenChange={(o) => { if (!o) resetEqForm(); setEqOpen(o); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit instrument" : "Add instrument"}</DialogTitle>
            <DialogDescription>Track this instrument's calibration and preventive maintenance. Use the same name as your VeritaMap instrument menu so it stays one source of truth.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label htmlFor="eq-name">Instrument name <span className="text-red-600">*</span></Label>
              <Input id="eq-name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. FREND 1, Sysmex XN-1000" autoFocus />
            </div>
            <div><Label htmlFor="eq-mfr">Manufacturer</Label><Input id="eq-mfr" value={mfr} onChange={e => setMfr(e.target.value)} /></div>
            <div><Label htmlFor="eq-model">Model</Label><Input id="eq-model" value={model} onChange={e => setModel(e.target.value)} /></div>
            <div><Label htmlFor="eq-serial">Serial number</Label><Input id="eq-serial" value={serial} onChange={e => setSerial(e.target.value)} /></div>
            <div><Label htmlFor="eq-loc">Location</Label><Input id="eq-loc" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Main lab bench 2" /></div>
            <div><Label htmlFor="eq-int">PM interval (days)</Label><Input id="eq-int" type="text" inputMode="decimal" min={1} value={interval} onChange={e => setInterval_(e.target.value)} placeholder="e.g. 365" /></div>
            <div><Label htmlFor="eq-due">Next due date</Label><Input id="eq-due" type="date" value={nextDue} onChange={e => setNextDue(e.target.value)} /></div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => { resetEqForm(); setEqOpen(false); }} disabled={eqSaving}>Cancel</Button>
            <Button onClick={saveEquipment} disabled={eqSaving || !name.trim()}>{eqSaving ? "Saving..." : editingId ? "Save changes" : "Add instrument"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Log maintenance event */}
      <Dialog open={evOpen} onOpenChange={setEvOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Log maintenance</DialogTitle>
            <DialogDescription>Record a completed maintenance activity. If you leave "next due" blank and the instrument has a PM interval, the next-due date is computed for you.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ev-type">Type <span className="text-red-600">*</span></Label>
              <Select value={evType} onValueChange={setEvType}>
                <SelectTrigger id="ev-type"><SelectValue /></SelectTrigger>
                <SelectContent>{EVENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="ev-date">Date <span className="text-red-600">*</span></Label><Input id="ev-date" type="date" value={evDate} onChange={e => setEvDate(e.target.value)} /></div>
            <div><Label htmlFor="ev-by">Performed by</Label><Input id="ev-by" value={evBy} onChange={e => setEvBy(e.target.value)} placeholder="Tech or vendor" /></div>
            <div><Label htmlFor="ev-next">Next due (optional)</Label><Input id="ev-next" type="date" value={evNextDue} onChange={e => setEvNextDue(e.target.value)} /></div>
            <div className="sm:col-span-2"><Label htmlFor="ev-notes">Notes</Label><Textarea id="ev-notes" rows={2} value={evNotes} onChange={e => setEvNotes(e.target.value)} placeholder="Work performed, parts, results" /></div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setEvOpen(false)} disabled={evSaving}>Cancel</Button>
            <Button onClick={saveEvent} disabled={evSaving || !evDate}>{evSaving ? "Saving..." : "Log maintenance"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* History */}
      <Dialog open={histOpen} onOpenChange={setHistOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Maintenance history: {histName}</DialogTitle>
            <DialogDescription>Every calibration, preventive maintenance, and service event, newest first.</DialogDescription>
          </DialogHeader>
          {histLoading ? (
            <p className="text-sm text-muted-foreground py-4">Loading...</p>
          ) : histEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No maintenance events logged yet.</p>
          ) : (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground border-b"><tr><th className="py-2 pr-2">Date</th><th className="py-2 pr-2">Type</th><th className="py-2 pr-2">By</th><th className="py-2 pr-2">Next due</th><th className="py-2 pr-2">Notes</th></tr></thead>
                <tbody>
                  {histEvents.map(ev => (
                    <tr key={ev.id} className="border-b last:border-b-0 align-top">
                      <td className="py-2 pr-2 whitespace-nowrap">{ev.event_date}</td>
                      <td className="py-2 pr-2">{TYPE_LABEL[ev.event_type] || ev.event_type}</td>
                      <td className="py-2 pr-2 text-muted-foreground">{ev.performed_by || "-"}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{ev.next_due_date || "-"}</td>
                      <td className="py-2 pr-2 text-muted-foreground">{ev.notes || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
