import { useState, useEffect } from "react";
import { labTodayIso } from "@/lib/labDate";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly, useCanRecord } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { AssignStaffButton } from "@/components/InstrumentStaffAssignDialog";
import { useLabRoute } from "@/hooks/useLabRoute";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DecimalInput } from "@/components/ui/decimal-input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Wrench, Lock, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TemperatureLogsPanel } from "@/components/TemperatureLogsPanel";
import { MonthlyRecordReviewPanel } from "@/components/MonthlyRecordReviewPanel";
import { StainLogPanel } from "@/components/StainLogPanel";
import { DocumentPicker, DueBadge, equipmentApi, sendJson, type Equipment } from "@/components/equipment/equipmentShared";
import { LogMaintenanceDialog } from "@/components/equipment/LogMaintenanceDialog";
import { EquipmentHistoryDialog } from "@/components/equipment/EquipmentHistoryDialog";
import { DueNowCard, EquipmentSchedulesDialog } from "@/components/equipment/EquipmentSchedulesDialog";
import { frequencyLabel } from "@shared/equipmentSchedules";
import { ContractFields, EquipmentRecordDialog, RetiredList, RetireDialog } from "@/components/equipment/EquipmentRecordDialog";

// An analyzer on the lab's VeritaMap test menu (GET /veritacheck/lab-instruments).
interface MenuInstrument {
  id: number;
  instrument_name: string;
  nickname: string | null;
  serial_number: string | null;
}

function todayIso() { return labTodayIso(); }

// MLC-1 Phase 2: equipment maintenance-due email-reminder settings. The nightly
// engine (server/equipmentReminders.ts) reads this per lab.
function EquipmentRemindersPanel({ apiBase }: { apiBase: string }) {
  // #84 Phase 3: reminder settings are VeritaMaintain setup.
  const remindersReadOnly = useIsReadOnly("veritamaintain");
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
          <div className="text-xs text-muted-foreground mt-0.5">Email a digest of every schedule approaching or past its due date. Overdue items repeat weekly until the maintenance is logged. Sent to the lab owner if no recipients are set; a schedule with its own list goes to that list.</div>
        </div>
        <label className="flex items-center gap-2 text-sm shrink-0"><input type="checkbox" checked={enabled} onChange={e => { setEnabled(e.target.checked); setSaved(false); }} /> Enabled</label>
      </div>
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><Label className="text-xs">Remind within (days before due)</Label><DecimalInput integer min={1} max={90} value={leadDays} fallback={14} onChangeNumber={n => { setLeadDays(Math.max(1, Math.min(90, n))); setSaved(false); }} /></div>
        <div><Label className="text-xs">Recipients (comma-separated emails)</Label><Input value={recipients} onChange={e => { setRecipients(e.target.value); setSaved(false); }} placeholder="Defaults to the lab owner if blank" /></div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={saving || remindersReadOnly}>{saving ? "Saving..." : "Save reminder settings"}</Button>
        {saved && <span className="text-xs text-emerald-600">Saved.</span>}
      </div>
    </div>
  );
}

interface MaintainSettings { require_vendor_report: boolean; review_due_email: boolean; review_due_recipients?: number }

// The lab's VeritaMaintain settings: whether a vendor PM needs its report attached before it counts as complete (B9), and the email when last
// month's record review isn't signed by the 5th (B10). Both off until turned on.
function MaintainSettingsPanel({ labId, settings, readOnly, onChanged }: { labId: number; settings: MaintainSettings; readOnly: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const people = settings.review_due_recipients ?? 0;
  async function set(body: Partial<MaintainSettings>, said: string) {
    setSaving(true);
    try {
      const r = await sendJson(`${API_BASE}/api/labs/${labId}/equipment-settings`, "PUT", body);
      if (!r.ok) { toast({ title: r.data.error || "Could not save", variant: "destructive" }); return; }
      toast({ title: said });
      onChanged();
    } finally { setSaving(false); }
  }
  return (
    <div className="rounded-xl border border-dashed p-4 mb-4" data-testid="maintain-settings">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={settings.require_vendor_report} disabled={saving || readOnly} onChange={(e) => set({ require_vendor_report: e.target.checked }, e.target.checked ? "A vendor PM now needs its report attached" : "A vendor PM no longer needs its report attached")} data-testid="require-vendor-report" />
        <span><span className="font-semibold">Require an attached vendor report</span><span className="block text-xs text-muted-foreground">A PM done by a vendor counts as complete, and moves its due date, only once the vendor report is attached to it. Entries already complete stay as they are.</span></span>
      </label>
      <label className="flex items-start gap-2 text-sm mt-3">
        <input type="checkbox" className="mt-1" checked={settings.review_due_email} disabled={saving || readOnly} onChange={(e) => set({ review_due_email: e.target.checked }, e.target.checked ? "Review emails are on" : "Review emails are off")} data-testid="review-due-email" />
        <span>
          <span className="font-semibold">Email when the monthly review is due</span>
          <span className="block text-xs text-muted-foreground">Sent on the 5th, once, when last month still has a record nobody signed, to the medical director and to each designee named in a signed Letter of Delegation for this review. <span data-testid="review-due-recipients">{people === 0 ? "Nobody on file can be emailed yet." : people === 1 ? "1 person would be emailed." : `${people} people would be emailed.`}</span></span>
        </span>
      </label>
    </div>
  );
}

export default function EquipmentAppPage() {
  const { user, isLoggedIn } = useAuth();
  const isReadOnly = useIsReadOnly("veritamaintain");
  // Logging a maintenance event is recording work, open to every lab member.
  const canRecord = useCanRecord();
  const activeLabId = useActiveLabId();
  const labRoute = useLabRoute();
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
  // 2026-10-08: which analyzer on the test menu this record is, so its
  // calibration and maintenance join that analyzer's QC trail. "" = not linked.
  const [linkId, setLinkId] = useState("");
  const [menuInstruments, setMenuInstruments] = useState<MenuInstrument[]>([]);
  const [eqSaving, setEqSaving] = useState(false);

  // B9: the rest of the equipment record.
  const [placed, setPlaced] = useState("");
  const [vendor, setVendor] = useState("");
  const [contract, setContract] = useState("");
  const [ifuUrl, setIfuUrl] = useState("");
  const [ifuDoc, setIfuDoc] = useState<number | null>(null);
  const [ifuDocName, setIfuDocName] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<Equipment | null>(null);
  const [historyFor, setHistoryFor] = useState<Equipment | null>(null);
  const [recordFor, setRecordFor] = useState<number | null>(null);
  const [retiring, setRetiring] = useState<Equipment | null>(null);
  const [retired, setRetired] = useState<Equipment[]>([]);
  const [showRetired, setShowRetired] = useState(false);
  const [settings, setSettings] = useState<MaintainSettings>({ require_vendor_report: false, review_due_email: false });
  const [schedulesFor, setSchedulesFor] = useState<Equipment | null>(null);

  async function loadSettings() {
    if (!activeLabId) return;
    const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/equipment-settings`, { headers: authHeaders() });
    if (r.ok) setSettings(await r.json());
  }
  async function load() {
    if (!activeLabId) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/equipment`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`equipment ${res.status}`);
      const rows: Equipment[] = await res.json();
      setItems(rows);
      setLoadError(false);
      // An open dialog shows the row as it stands now (its due date may just have moved).
      setHistoryFor(h => (h ? rows.find(r => r.id === h.id) ?? h : h));
      setSchedulesFor(h => (h ? rows.find(r => r.id === h.id) ?? h : h));
      const gone = await fetch(`${API_BASE}/api/labs/${activeLabId}/equipment?retired=1`, { headers: authHeaders() });
      if (gone.ok) setRetired(await gone.json());
    } catch (err) {
      console.error("Failed to load equipment:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess && activeLabId) { load(); loadSettings(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, hasPlanAccess, activeLabId]);

  useEffect(() => {
    if (!isLoggedIn || !activeLabId) return;
    fetch(`${API_BASE}/api/labs/${activeLabId}/veritacheck/lab-instruments`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : []))
      .then((rows: MenuInstrument[]) => setMenuInstruments(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, [isLoggedIn, activeLabId]);

  function resetEqForm() {
    setEditingId(null); setName(""); setMfr(""); setModel(""); setSerial(""); setLocation(""); setInterval_(""); setNextDue(""); setLinkId("");
    setPlaced(""); setVendor(""); setContract(""); setIfuUrl(""); setIfuDoc(null); setIfuDocName(null);
  }
  function openAdd() { resetEqForm(); setEqOpen(true); }
  function openEdit(e: Equipment) {
    setEditingId(e.id); setName(e.instrument_name); setMfr(e.manufacturer || ""); setModel(e.model || "");
    setSerial(e.serial_number || ""); setLocation(e.location || "");
    setInterval_(e.pm_interval_days != null ? String(e.pm_interval_days) : ""); setNextDue(e.next_due_date || "");
    setLinkId(e.map_instrument_id ? String(e.map_instrument_id) : "");
    setPlaced(e.placed_in_service_date || ""); setVendor(e.vendor_name || ""); setContract(e.service_contract || "");
    setIfuUrl(e.ifu_url || ""); setIfuDoc(e.ifu_document_id ?? null); setIfuDocName(null);
    if (e.ifu_document_id && activeLabId) {
      fetch(`${equipmentApi(activeLabId)}/${e.id}/record`, { headers: authHeaders() }).then(r => (r.ok ? r.json() : null))
        .then(j => setIfuDocName(j?.ifu_document ? [j.ifu_document.doc_number, j.ifu_document.title].filter(Boolean).join(" ") : null)).catch(() => {});
    }
    setEqOpen(true);
  }

  async function saveEquipment() {
    if (!activeLabId || !name.trim()) { toast({ title: "Instrument name is required", variant: "destructive" }); return; }
    setEqSaving(true);
    const body = {
      instrument_name: name.trim(), manufacturer: mfr || null, model: model || null,
      serial_number: serial || null, location: location || null,
      pm_interval_days: interval || null, next_due_date: nextDue || null,
      map_instrument_id: linkId ? Number(linkId) : null,
      placed_in_service_date: placed || null, vendor_name: vendor || null, service_contract: contract || null,
      ifu_url: ifuUrl.trim() || null, ifu_document_id: ifuDoc,
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

  async function restore(e: Equipment) {
    if (!activeLabId) return;
    const r = await sendJson(`${equipmentApi(activeLabId)}/${e.id}/restore`, "POST", {});
    if (!r.ok) { toast({ title: r.data.error || "Could not restore it", variant: "destructive" }); return; }
    toast({ title: `Restored ${e.instrument_name}` });
    await load();
  }

  if (!isLoggedIn) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card><CardContent className="py-10 text-center">
          <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
          <h2 className="text-lg font-semibold mb-1">Sign in to use VeritaMaintain&#8482;</h2>
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
          <h2 className="text-lg font-semibold mb-1">VeritaMaintain&#8482; requires a subscription</h2>
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
      <div className="mb-6 flex items-center gap-3">
        <Wrench className="h-6 w-6 text-primary shrink-0" />
        <div>
          <h1 className="text-2xl font-bold leading-tight">VeritaMaintain&#8482;</h1>
          <p className="text-sm text-muted-foreground">Instrument maintenance, function checks, temperature logs and stain logs</p>
        </div>
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

      <DueNowCard labId={Number(activeLabId)} items={items} canRecord={canRecord} requireVendorReport={settings.require_vendor_report} onChanged={load} />

      <EquipmentRemindersPanel apiBase={`${API_BASE}/api/labs/${activeLabId}/equipment`} />
      <MaintainSettingsPanel labId={Number(activeLabId)} settings={settings} readOnly={isReadOnly} onChanged={loadSettings} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Instruments</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowRetired(v => !v)} data-testid="toggle-retired">{showRetired ? "Hide retired" : `Retired (${retired.length})`}</Button>
        </CardHeader>
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
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-sm">
                <thead className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-muted text-left text-xs text-muted-foreground border-b">
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
                        {e.out_of_service && <div className="text-xs font-medium text-amber-800 dark:text-amber-300" data-testid={`equip-out-${e.id}`}>Out of service since {e.out_of_service.down_from.replace("T", " ")}</div>}
                        {e.awaiting_vendor_report ? <div className="text-xs font-medium text-amber-800 dark:text-amber-300" data-testid={`equip-waiting-${e.id}`}>{e.awaiting_vendor_report === 1 ? "A vendor PM is" : `${e.awaiting_vendor_report} vendor PMs are`} waiting for the vendor report</div> : null}
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground">{e.location || "-"}</td>
                      <td className="py-2 pr-2 text-muted-foreground">{(() => { const first = e.schedules?.find(x => x.is_primary); return first && first.frequency !== "manual" ? (first.frequency === "every_n_days" ? `${first.interval_days} d` : frequencyLabel(first.frequency, first.interval_days, first.days_of_week)) : e.pm_interval_days ? `${e.pm_interval_days} d` : "-"; })()}</td>
                      <td className="py-2 pr-2">
                        {e.next_due_date ? <span className="whitespace-nowrap">{e.next_due_date}</span> : <span className="text-muted-foreground">-</span>}
                        {(e.schedules ?? []).filter(x => !x.is_primary).length > 0 && (
                          <div className="text-xs text-muted-foreground mt-0.5" data-testid={`equip-schedules-${e.id}`}>
                            {(e.schedules ?? []).filter(x => !x.is_primary).slice(0, 4).map(x => (
                              <div key={x.id} className={x.status === "overdue" ? "text-red-700 dark:text-red-400" : undefined}>{x.name}: {x.next_due_date || "no date"}</div>
                            ))}
                            {(e.schedules ?? []).filter(x => !x.is_primary).length > 4 && <div>and {(e.schedules ?? []).filter(x => !x.is_primary).length - 4} more</div>}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-2"><DueBadge status={e.maintenance_status} /></td>
                      <td className="py-2 pr-2">
                        <div className="flex flex-wrap gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setLogFor(e)} disabled={!canRecord} data-testid={`equip-log-${e.id}`}>Log maintenance</Button>
                          <Button size="sm" variant="ghost" onClick={() => setSchedulesFor(e)} data-testid={`equip-schedules-open-${e.id}`}>Schedules</Button>
                          <Button size="sm" variant="ghost" onClick={() => setHistoryFor(e)} data-testid={`equip-history-${e.id}`}>History</Button>
                          <Button size="sm" variant="ghost" onClick={() => setRecordFor(e.id)} data-testid={`equip-record-${e.id}`}>Record</Button>
                          {e.map_instrument_id ? (
                            <Button size="sm" variant="ghost" asChild>
                              <Link href={labRoute(`/instruments/${e.map_instrument_id}/trail`)} data-testid={`equip-trail-${e.id}`}>QC trail</Link>
                            </Button>
                          ) : null}
                          {e.map_instrument_id ? <AssignStaffButton instrument={{ id: e.map_instrument_id, name: e.instrument_name }} testId={`equip-assign-staff-${e.id}`} /> : null}
                          <Button size="sm" variant="ghost" onClick={() => openEdit(e)} disabled={isReadOnly} data-testid={`equip-edit-${e.id}`}>Edit</Button>
                          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setRetiring(e)} disabled={isReadOnly} data-testid={`equip-retire-${e.id}`}>Retire</Button>
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

      {showRetired && (
        <Card className="mt-4" data-testid="retired-card">
          <CardHeader><CardTitle className="text-base">Retired instruments</CardTitle></CardHeader>
          <CardContent><RetiredList items={retired} canEdit={!isReadOnly} onRestore={restore} onHistory={setHistoryFor} onRecord={e => setRecordFor(e.id)} /></CardContent>
        </Card>
      )}

      {/* Temperature logs (St. Charles REQ-068): storage units, readings, out-of-range corrective action. */}
      <TemperatureLogsPanel labId={Number(activeLabId)} />
      <StainLogPanel labId={Number(activeLabId)} />
      <MonthlyRecordReviewPanel labId={Number(activeLabId)} />

      {/* Add / edit equipment */}
      <Dialog open={eqOpen} onOpenChange={(o) => { if (!o) resetEqForm(); setEqOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
            <div><Label htmlFor="eq-due">Next PM due date</Label><Input id="eq-due" type="date" value={nextDue} onChange={e => setNextDue(e.target.value)} /></div>
            <ContractFields vendor={vendor} setVendor={setVendor} contract={contract} setContract={setContract} placed={placed} setPlaced={setPlaced} />
            <div className="sm:col-span-2"><Label htmlFor="eq-ifu">IFU web address</Label><Input id="eq-ifu" value={ifuUrl} onChange={e => setIfuUrl(e.target.value)} placeholder="https://" /></div>
            <div className="sm:col-span-2">
              <Label>IFU document in VeritaDC&#8482;</Label>
              <DocumentPicker labId={Number(activeLabId)} value={ifuDoc} valueLabel={ifuDocName} onChange={(id) => setIfuDoc(id)} testId="eq-ifu-doc" />
              <p className="text-[11px] text-muted-foreground mt-1">Opens the document's current approved version from the instrument's record.</p>
            </div>
            {menuInstruments.length > 0 && (
              <div className="sm:col-span-2">
                <Label htmlFor="eq-link">Analyzer on your test menu</Label>
                <Select value={linkId || "none"} onValueChange={(v) => setLinkId(v === "none" ? "" : v)}>
                  <SelectTrigger id="eq-link" data-testid="eq-link-select"><SelectValue placeholder="Not linked" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not linked</SelectItem>
                    {menuInstruments.map(i => (
                      <SelectItem key={i.id} value={String(i.id)}>
                        {i.nickname ? `${i.nickname} (${i.instrument_name})` : i.instrument_name}{i.serial_number ? ` · SN ${i.serial_number}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">Linking puts this instrument's calibration and maintenance on the same trail as its QC failures and corrective actions.</p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => { resetEqForm(); setEqOpen(false); }} disabled={eqSaving}>Cancel</Button>
            <Button onClick={saveEquipment} disabled={eqSaving || !name.trim()}>{eqSaving ? "Saving..." : editingId ? "Save changes" : "Add instrument"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <LogMaintenanceDialog labId={Number(activeLabId)} equipment={logFor} requireVendorReport={settings.require_vendor_report} onClose={() => setLogFor(null)} onSaved={load} />
      <EquipmentHistoryDialog labId={Number(activeLabId)} equipment={historyFor} canEdit={!isReadOnly} canRecord={canRecord} onClose={() => setHistoryFor(null)} onChanged={load} />
      <EquipmentSchedulesDialog labId={Number(activeLabId)} equipment={schedulesFor} canSetup={!isReadOnly} canRecord={canRecord} requireVendorReport={settings.require_vendor_report} onClose={() => setSchedulesFor(null)} onChanged={load} />
      <EquipmentRecordDialog labId={Number(activeLabId)} equipmentId={recordFor} canSetup={!isReadOnly} onClose={() => setRecordFor(null)} onChanged={load} />
      <RetireDialog labId={Number(activeLabId)} equipment={retiring} today={todayIso()} onClose={() => setRetiring(null)} onDone={load} />
    </div>
  );
}
