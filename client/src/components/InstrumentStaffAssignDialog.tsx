// InstrumentStaffAssignDialog
//
// Transpose of EmployeeInstrumentsPickerDialog (#48 dual view, 2026-09-24): assign
// from the instrument side. Pick a test system or manual test, then check off which
// staff run it. Manual tests are just veritamap_instruments rows, so both are
// covered. Save calls PUT /staff/instruments/:id/employees, which rewrites the join
// for that instrument and emits the same §493.1235(a) duty-change events as the
// per-employee path.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft } from "lucide-react";
import { type LabInstrument } from "@/components/EmployeeInstrumentsPickerDialog";

type StaffRow = { id: number; first_name: string; last_name: string; middle_initial: string | null; title: string | null; assigned: boolean };

function staffName(s: StaffRow): string {
  const mi = s.middle_initial ? ` ${s.middle_initial}` : "";
  return `${s.last_name}, ${s.first_name}${mi}`.trim();
}
// A row is a manual method if it has no serial number or its name starts with
// "Manual " (same heuristic the employee card uses to group these).
function isManual(i: LabInstrument): boolean {
  return (!i.serial_number || i.serial_number.trim() === "") || /^manual\b/i.test(i.instrument_name || "");
}

export function InstrumentStaffAssignDialog({
  open,
  onOpenChange,
  labId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  labId: number | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [pickedName, setPickedName] = useState<string>("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) { setPickedId(null); setPickedName(""); setFilter(""); setSelected(new Set()); } }, [open]);

  const instUrl = labId ? `/api/labs/${labId}/veritamap/instruments-flat` : null;
  const { data: instruments = [] } = useQuery<LabInstrument[]>({
    queryKey: [instUrl ?? "no-inst", "assign-by-instrument"],
    enabled: !!instUrl && open,
    queryFn: async () => { const r = await fetch(`${API_BASE}${instUrl}`, { headers: authHeaders() }); if (!r.ok) throw new Error(`Failed to load instruments (${r.status})`); return r.json(); },
  });

  const empUrl = labId && pickedId ? `/api/labs/${labId}/staff/instruments/${pickedId}/employees` : null;
  const { data: empData, isLoading: empLoading } = useQuery<{ employees: StaffRow[] }>({
    queryKey: [empUrl ?? "no-emp"],
    enabled: !!empUrl,
    queryFn: async () => { const r = await fetch(`${API_BASE}${empUrl}`, { headers: authHeaders() }); if (!r.ok) throw new Error(`Failed to load staff (${r.status})`); return r.json(); },
  });
  useEffect(() => {
    if (empData?.employees) setSelected(new Set(empData.employees.filter((e) => e.assigned).map((e) => e.id)));
  }, [empData]);

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const match = (i: LabInstrument) => !f || `${i.instrument_name} ${i.nickname ?? ""} ${i.serial_number ?? ""} ${i.category ?? ""} ${i.map_name}`.toLowerCase().includes(f);
    const systems = instruments.filter((i) => !isManual(i) && match(i)).sort((a, b) => a.instrument_name.localeCompare(b.instrument_name));
    const manuals = instruments.filter((i) => isManual(i) && match(i)).sort((a, b) => a.instrument_name.localeCompare(b.instrument_name));
    return { systems, manuals };
  }, [instruments, filter]);

  function toggle(id: number) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function save() {
    if (!empUrl) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}${empUrl}`, { method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ employeeIds: Array.from(selected) }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.error || `Save failed (${r.status})`); }
      const data = await r.json().catch(() => ({}));
      toast({ title: "Assignment saved", description: `${pickedName}: ${selected.size} staff${data.dutyChangeEventsCreated ? ` · ${data.dutyChangeEventsCreated} reassessment${data.dutyChangeEventsCreated === 1 ? "" : "s"} flagged` : ""}` });
      // Refresh both views' data + the coverage map.
      qc.invalidateQueries({ queryKey: [empUrl] });
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && typeof q.queryKey[0] === "string" && ((q.queryKey[0] as string).includes("/staff/employees") || (q.queryKey[0] as string).includes("/competency/owed")) });
      setPickedId(null); setPickedName("");
    } catch (err: any) {
      toast({ title: "Could not save", description: err?.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  const InstrumentList = () => (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Pick a test system or manual test, then choose the staff who run it. This is the same assignment as the per-employee view, from the instrument side.</p>
      <Input placeholder="Filter by name, nickname, S/N, category, map..." value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="instrument-assign-filter" />
      {[{ label: "Test systems", items: grouped.systems }, { label: "Manual tests", items: grouped.manuals }].map((grp) => grp.items.length > 0 && (
        <div key={grp.label}>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{grp.label} ({grp.items.length})</div>
          <div className="space-y-1">
            {grp.items.map((i) => (
              <button key={i.id} type="button" onClick={() => { setPickedId(i.id); setPickedName(i.instrument_name); }} className="w-full text-left rounded px-2 py-1.5 hover:bg-muted/50 flex items-center gap-2" data-testid={`instrument-pick-${i.id}`}>
                <span className="flex-1 text-sm"><span className="font-medium">{i.instrument_name}</span>{i.nickname && <Badge variant="outline" className="ml-1.5 text-[10px]">{i.nickname}</Badge>}{i.category && <span className="ml-1 text-xs text-muted-foreground">- {i.category}</span>}</span>
                <span className="text-xs text-muted-foreground">{i.map_name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {grouped.systems.length === 0 && grouped.manuals.length === 0 && <p className="text-xs text-muted-foreground italic">No instruments match.</p>}
    </div>
  );

  const StaffList = () => (
    <div className="space-y-3">
      <button type="button" onClick={() => { setPickedId(null); setPickedName(""); }} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft size={13} /> All instruments</button>
      <p className="text-sm">Who runs <span className="font-semibold">{pickedName}</span>?</p>
      {empLoading ? (
        <p className="text-xs text-muted-foreground">Loading staff...</p>
      ) : (empData?.employees?.length ?? 0) === 0 ? (
        <p className="text-xs text-muted-foreground italic">No active testing staff on this lab.</p>
      ) : (
        <div className="space-y-1 max-h-[46vh] overflow-y-auto">
          {empData!.employees.map((e) => (
            <label key={e.id} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-2 py-1">
              <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggle(e.id)} className="mt-0.5" data-testid={`instrument-assign-staff-${e.id}`} />
              <span className="flex-1 leading-tight"><span className="font-medium">{staffName(e)}</span>{e.title && <span className="ml-1 text-xs text-muted-foreground">- {e.title}</span>}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <span className="text-xs text-muted-foreground self-center mr-auto">{selected.size} selected</span>
        <Button variant="outline" onClick={() => { setPickedId(null); setPickedName(""); }} disabled={saving}>Back</Button>
        <Button onClick={save} disabled={saving} data-testid="instrument-assign-save">{saving ? "Saving..." : "Save"}</Button>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign by Instrument</DialogTitle>
        </DialogHeader>
        <div className="pt-2">{pickedId ? <StaffList /> : <InstrumentList />}</div>
      </DialogContent>
    </Dialog>
  );
}
