// One instrument's record (VeritaMaintain, B9): service dates, vendor and contract, the IFU, time out of service, files, and the move to
// another lab of the same organization. Setup needs VeritaMaintain edit; everyone else reads it. Server: server/equipment.ts.
import { useEffect, useState } from "react";
import { authHeaders } from "@/lib/auth";
import { labDayOf } from "@/lib/labDate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { durationLabel } from "@shared/equipmentPm";
import { ApprovedDocumentDialog } from "./ApprovedDocumentDialog";
import { AttachFile, equipmentApi, FileList, ReasonDialog, sendJson, type EquipFile, type Equipment } from "./equipmentShared";

interface Downtime {
  id: number; down_from: string; down_until: string | null; reason: string; return_note: string | null; minutes: number;
  started_by_name: string | null; ended_by_name: string | null; carried_from_lab_name: string | null;
}
interface RecordData {
  equipment: Equipment; ifu_document: { id: number; title: string | null; doc_number: string | null; readable: boolean } | null; downtime: Downtime[]; files: EquipFile[];
  menu_instrument: { id: number; name: string; map_name: string | null } | null; can_edit: boolean; now_local: string;
}

const at = (v: string | null) => (v ? v.replace("T", " ") : "");

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div><div className="text-sm break-words whitespace-pre-wrap">{children}</div></div>;
}

export function EquipmentRecordDialog({ labId, equipmentId, canSetup, onClose, onChanged }: {
  labId: number; equipmentId: number | null; canSetup: boolean; onClose: () => void; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [why, setWhy] = useState("");
  const [until, setUntil] = useState("");
  const [note, setNote] = useState("");
  const [fixing, setFixing] = useState<Downtime | null>(null);
  const [fixFrom, setFixFrom] = useState("");
  const [fixUntil, setFixUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [targets, setTargets] = useState<{ id: number; lab_name: string; clia_number: string | null }[]>([]);
  const [moving, setMoving] = useState(false);
  const [toLab, setToLab] = useState("");

  async function load() {
    if (!equipmentId) return;
    const r = await fetch(`${equipmentApi(labId)}/${equipmentId}/record`, { headers: authHeaders() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error || "Could not load the record"); return; }
    setData(j); setError(null); setFrom(j.now_local); setUntil(j.now_local);
  }
  useEffect(() => {
    setData(null); setError(null); setTargets([]); setWhy(""); setNote("");
    if (!equipmentId) return;
    load();
    if (canSetup) fetch(`${equipmentApi(labId)}/${equipmentId}/move-targets`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : [])).then((j) => setTargets(Array.isArray(j) ? j : [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equipmentId]);
  if (!equipmentId) return null;

  const eq = data?.equipment;
  const base = `${equipmentApi(labId)}/${equipmentId}`;
  const edit = !!data?.can_edit && canSetup && !eq?.moved_to_lab_id;
  const active = eq?.status !== "retired";
  const open = data?.downtime.find((d) => !d.down_until) ?? null;
  const changed = () => { load(); onChanged(); };
  const act = async (url: string, method: string, body: unknown, done: string) => {
    setBusy(true);
    try {
      const r = await sendJson(url, method, body);
      if (!r.ok) { toast({ title: r.data.error || "Could not save", variant: "destructive" }); return false; }
      toast({ title: done }); changed(); return true;
    } finally { setBusy(false); }
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="record-dialog">
          <DialogHeader>
            <DialogTitle>{eq?.instrument_name ?? "Instrument record"}</DialogTitle>
            <DialogDescription>{eq ? [eq.manufacturer, eq.model, eq.serial_number ? `SN ${eq.serial_number}` : "", eq.location].filter(Boolean).join(" · ") || "Instrument record" : "Instrument record"}</DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
          {!data && !error && <p className="text-sm text-muted-foreground py-4">Loading...</p>}
          {data && eq && (
            <div className="space-y-5 min-w-0">
              <div className="flex flex-wrap gap-1.5">
                {eq.status === "retired" ? <Badge variant="outline">{eq.moved_to_lab_name ? `Moved to ${eq.moved_to_lab_name}` : "Retired"}</Badge> : null}
                {open && <Badge variant="outline" className="bg-amber-500/10 text-amber-800 border-amber-500/30 dark:text-amber-300" data-testid="record-out">Out of service since {at(open.down_from)}</Badge>}
              </div>
              {eq.move_note && <p className="text-xs rounded-md border border-dashed p-2" data-testid="record-move-note">{eq.move_note}</p>}

              <section className="grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="record-facts">
                <Fact label="Placed in service">{eq.placed_in_service_date || "Not on file"}</Fact>
                {eq.removed_from_service_date ? <Fact label="Removed from service">{eq.removed_from_service_date}: {eq.removed_from_service_reason}</Fact> : <Fact label="Analyzer on your test menu">{data.menu_instrument ? `${data.menu_instrument.name}${data.menu_instrument.map_name ? ` (${data.menu_instrument.map_name})` : ""}` : "Not linked"}</Fact>}
                <Fact label="Vendor">{eq.vendor_name || "Not on file"}</Fact>
                <Fact label="Service contract">{eq.service_contract || "Not on file"}</Fact>
                <div className="sm:col-span-2">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">IFU</div>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    {eq.ifu_url && <a href={eq.ifu_url} target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1" data-testid="record-ifu-url"><ExternalLink className="h-3.5 w-3.5" />Open the IFU web page</a>}
                    {data.ifu_document && (data.ifu_document.readable
                      ? <button type="button" className="text-primary underline inline-flex items-center gap-1 text-left" onClick={() => setDoc(`${base}/ifu-document`)} data-testid="record-ifu-document"><FileText className="h-3.5 w-3.5" />{[data.ifu_document.doc_number, data.ifu_document.title].filter(Boolean).join(" ")}</button>
                      : <span className="text-muted-foreground">{[data.ifu_document.doc_number, data.ifu_document.title].filter(Boolean).join(" ") || "The linked document"}: no approved version yet</span>)}
                    {!eq.ifu_url && !data.ifu_document && <span>Not on file</span>}
                  </div>
                </div>
              </section>

              <section data-testid="record-downtime">
                <h3 className="text-sm font-semibold mb-1">Out of service</h3>
                {data.downtime.length === 0 ? <p className="text-xs text-muted-foreground">No time out of service on file.</p> : (
                  <ul className="space-y-1.5">
                    {data.downtime.map((d) => (
                      <li key={d.id} className="text-sm rounded-md border p-2" data-testid={`downtime-${d.id}`}>
                        <div className="flex flex-wrap items-center gap-x-2">
                          <span className="font-medium">{at(d.down_from)} to {d.down_until ? at(d.down_until) : "now"}</span>
                          <span className="text-muted-foreground" data-testid={`downtime-length-${d.id}`}>{durationLabel(d.minutes)}</span>
                          {d.carried_from_lab_name && <span className="text-xs text-muted-foreground">recorded at {d.carried_from_lab_name}</span>}
                          {edit && !d.carried_from_lab_name && <button type="button" className="text-xs underline text-muted-foreground" onClick={() => { setFixing(d); setFixFrom(d.down_from); setFixUntil(d.down_until || ""); }} data-testid={`downtime-fix-${d.id}`}>Correct</button>}
                        </div>
                        <div className="text-xs">{d.reason}{d.return_note ? `. Back in service: ${d.return_note}` : ""}</div>
                      </li>
                    ))}
                  </ul>
                )}
                {edit && active && !open && (
                  <div className="grid grid-cols-1 sm:grid-cols-[13rem_1fr_auto] gap-2 items-end mt-2">
                    <div><Label className="text-xs">Out of service from</Label><Input type="datetime-local" value={from} max={data.now_local} onChange={(e) => setFrom(e.target.value)} data-testid="downtime-from" /></div>
                    <div><Label className="text-xs">Why <span className="text-red-600">*</span></Label><Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Probe fault, vendor called" data-testid="downtime-reason" /></div>
                    <Button size="sm" variant="outline" disabled={busy || !why.trim()} onClick={async () => { if (await act(`${base}/downtime`, "POST", { down_from: from, reason: why.trim() }, "Marked out of service")) setWhy(""); }} data-testid="downtime-start">Take out of service</Button>
                  </div>
                )}
                {edit && open && (
                  <div className="grid grid-cols-1 sm:grid-cols-[13rem_1fr_auto] gap-2 items-end mt-2">
                    <div><Label className="text-xs">Back in service</Label><Input type="datetime-local" value={until} min={open.down_from} max={data.now_local} onChange={(e) => setUntil(e.target.value)} data-testid="downtime-until" /></div>
                    <div><Label className="text-xs">What returned it to service</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Probe replaced, QC acceptable" data-testid="downtime-note" /></div>
                    <Button size="sm" disabled={busy} onClick={async () => { if (await act(`${base}/downtime/${open.id}/end`, "POST", { down_until: until, return_note: note.trim() || null }, "Back in service")) setNote(""); }} data-testid="downtime-end">Return to service</Button>
                  </div>
                )}
              </section>

              <section data-testid="record-files">
                <h3 className="text-sm font-semibold mb-1">Files on this record</h3>
                {data.files.length === 0 && <p className="text-xs text-muted-foreground">No files. Files on a maintenance entry are under History.</p>}
                <FileList files={data.files} base={`${base}/files`} canRemove={edit} onChanged={changed} />
                {edit && <div className="mt-2"><AttachFile url={`${base}/files`} defaultKind="calibration_certificate" onSent={changed} testId="record-attach" /></div>}
              </section>

              {edit && active && targets.length > 0 && (
                <section data-testid="record-move">
                  <h3 className="text-sm font-semibold mb-1">Move to another lab</h3>
                  <p className="text-xs text-muted-foreground mb-2">Its history goes along, read-only, and this lab keeps its own record. Its schedules go on there. A VeritaMap® link, a VeritaDC™ document link and a schedule's own reminder list don't go along.</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="h-9 rounded-md border border-border bg-background px-2 text-sm max-w-full" value={toLab} onChange={(e) => setToLab(e.target.value)} data-testid="move-lab">
                      <option value="">Choose a lab</option>
                      {targets.map((t) => <option key={t.id} value={t.id}>{t.lab_name}{t.clia_number ? ` (${t.clia_number})` : ""}</option>)}
                    </select>
                    <Button size="sm" variant="outline" disabled={!toLab} onClick={() => setMoving(true)} data-testid="move-open">Move</Button>
                  </div>
                </section>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <ApprovedDocumentDialog url={doc} label="IFU" onClose={() => setDoc(null)} />
      <ReasonDialog
        open={moving} testId="move-dialog" title={`Move ${eq?.instrument_name ?? "this instrument"}`} confirmLabel="Move instrument"
        description={`It goes to ${targets.find((t) => String(t.id) === toLab)?.lab_name ?? "the other lab"} with its history, read-only. Here it leaves the list and its record stays under Retired.`}
        label="Why is it moving" onClose={() => setMoving(false)}
        onConfirm={async (reason) => {
          const r = await sendJson(`${base}/move`, "POST", { to_lab_id: Number(toLab), reason });
          if (!r.ok) { toast({ title: r.data.error || "Could not move the instrument", variant: "destructive" }); return false; }
          toast({ title: `Moved to ${r.data.to_lab_name}`, description: r.data.note });
          onChanged(); onClose(); return true;
        }}
      />
      <ReasonDialog
        open={!!fixing} testId="downtime-dialog" title="Correct this period" confirmLabel="Save correction" description="The values before stay in the audit trail with your reason."
        label="Why is it being corrected" onClose={() => setFixing(null)}
        onConfirm={async (reason) => {
          const r = await sendJson(`${base}/downtime/${fixing!.id}`, "PUT", { down_from: fixFrom, down_until: fixUntil || null, correction_reason: reason });
          if (!r.ok) { toast({ title: r.data.error || "Could not save the correction", variant: "destructive" }); return false; }
          toast({ title: "Period corrected" }); changed(); return true;
        }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div><Label className="text-xs">From</Label><Input type="datetime-local" value={fixFrom} onChange={(e) => setFixFrom(e.target.value)} /></div>
          <div><Label className="text-xs">Until</Label><Input type="datetime-local" value={fixUntil} onChange={(e) => setFixUntil(e.target.value)} data-testid="downtime-fix-until" /></div>
        </div>
      </ReasonDialog>
    </>
  );
}

/** Retire: a confirmation, the date it left service, and why. The record is kept and can be restored. */
export function RetireDialog({ labId, equipment, today, onClose, onDone }: { labId: number; equipment: Equipment | null; today: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [day, setDay] = useState(today);
  useEffect(() => { setDay(today); }, [equipment?.id, today]);
  return (
    <ReasonDialog
      open={!!equipment} testId="retire-dialog" title={`Retire ${equipment?.instrument_name ?? ""}`} confirmLabel="Retire" destructive
      description="It leaves the instrument list and its reminders stop. Its record and history are kept under Retired, where it can be restored."
      label="Why is it being retired" onClose={onClose}
      onConfirm={async (reason) => {
        const r = await sendJson(`${equipmentApi(labId)}/${equipment!.id}/retire`, "POST", { reason, removed_from_service_date: day });
        if (!r.ok) { toast({ title: r.data.error || "Could not retire it", variant: "destructive" }); return false; }
        toast({ title: `Retired ${equipment!.instrument_name}` }); onDone(); return true;
      }}
    >
      <div><Label>Date removed from service</Label><Input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} data-testid="retire-date" /></div>
    </ReasonDialog>
  );
}

/** The lab's retired instruments: when, why, who, and Restore. A moved one says where it went and stays. */
export function RetiredList({ items, canEdit, onRestore, onHistory, onRecord }: { items: Equipment[]; canEdit: boolean; onRestore: (e: Equipment) => void; onHistory: (e: Equipment) => void; onRecord: (e: Equipment) => void }) {
  if (!items.length) return <p className="text-sm text-muted-foreground" data-testid="retired-empty">No retired instruments.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="retired-table">
        <thead className="text-left text-xs text-muted-foreground border-b"><tr><th className="py-2 pr-2">Instrument</th><th className="py-2 pr-2">Removed from service</th><th className="py-2 pr-2">Why</th><th className="py-2">Actions</th></tr></thead>
        <tbody>
          {items.map((e) => (
            <tr key={e.id} className="border-b last:border-b-0 align-top" data-testid={`retired-row-${e.id}`}>
              <td className="py-2 pr-2"><div className="font-medium">{e.instrument_name}</div><div className="text-xs text-muted-foreground">{[e.manufacturer, e.model, e.serial_number ? `SN ${e.serial_number}` : ""].filter(Boolean).join(" · ")}</div></td>
              <td className="py-2 pr-2 whitespace-nowrap">{e.removed_from_service_date || (e.retired_at ? labDayOf(e.retired_at) : "Not on file")}{e.retired_by_name ? <div className="text-xs text-muted-foreground">by {e.retired_by_name}</div> : null}</td>
              <td className="py-2 pr-2">{e.removed_from_service_reason || "Not on file"}</td>
              <td className="py-2">
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => onHistory(e)}>History</Button>
                  <Button size="sm" variant="ghost" onClick={() => onRecord(e)}>Record</Button>
                  {!e.moved_to_lab_id && <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => onRestore(e)} data-testid={`restore-${e.id}`}>Restore</Button>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The fields B9 adds to the add and edit form. */
export function ContractFields({ vendor, setVendor, contract, setContract, placed, setPlaced }: {
  vendor: string; setVendor: (v: string) => void; contract: string; setContract: (v: string) => void; placed: string; setPlaced: (v: string) => void;
}) {
  return (
    <>
      <div><Label htmlFor="eq-placed">Date placed in service</Label><Input id="eq-placed" type="date" value={placed} onChange={(e) => setPlaced(e.target.value)} /></div>
      <div><Label htmlFor="eq-vendor">Vendor</Label><Input id="eq-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Who services it" /></div>
      <div className="sm:col-span-2"><Label htmlFor="eq-contract">Service contract</Label><Textarea id="eq-contract" rows={2} value={contract} onChange={(e) => setContract(e.target.value)} placeholder="Contract number, what it covers, when it ends, who to call" /></div>
    </>
  );
}
