// InstrumentStaffAssignDialog
//
// Transpose of EmployeeInstrumentsPickerDialog (#48 dual view, 2026-09-24): assign from the instrument side. Manual
// tests are just veritamap_instruments rows, so both are covered. Michael 2026-11-04: an Instruments tab on VeritaStaff
// and a button on the instrument pages so it can be found, and several instruments at once.
//   One instrument: check off who runs it. Save calls PUT /staff/instruments/:id/employees, which rewrites that
//   instrument's list, so people can come off too.
//   Several instruments: the staff ticked go on every one of them and nobody comes off, because each may already have a
//   different list. Save calls POST /staff/instruments-bulk/assign.
// Both emit the same duty-change events (§493.1451(b)(9) / §493.1413(b)(9)) as the per-employee path.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useAuth } from "@/components/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { Users } from "lucide-react";
import { type LabInstrument } from "@/components/EmployeeInstrumentsPickerDialog";
import { hasStaffPlan } from "@/lib/staffPlans";

type StaffRow = { id: number; first_name: string; last_name: string; middle_initial: string | null; title: string | null; assigned?: boolean; on_count?: number };
type PickedInstrument = { id: number; name: string };

function staffName(s: StaffRow): string {
  const mi = s.middle_initial ? ` ${s.middle_initial}` : "";
  return `${s.last_name}, ${s.first_name}${mi}`.trim();
}
// A row is a manual method if it has no serial number or its name starts with
// "Manual " (same heuristic the employee card uses to group these).
function isManual(i: LabInstrument): boolean {
  return (!i.serial_number || i.serial_number.trim() === "") || /^manual\b/i.test(i.instrument_name || "");
}
// Two analyzers of the same model are told apart by nickname or serial number.
function instrumentWithTag(i: LabInstrument): string {
  const tag = (i.nickname || "").trim() || (i.serial_number || "").trim();
  return tag ? `${i.instrument_name} (${tag})` : i.instrument_name;
}

export function InstrumentStaffAssignDialog({
  open,
  onOpenChange,
  labId,
  instruments,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  labId: number | null;
  instruments: PickedInstrument[];
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const many = instruments.length > 1;

  // Always read fresh: Save rewrites a whole list for one instrument, so a cached copy would undo a change made from the person's side.
  const url = !open || !labId || instruments.length === 0 ? null
    : many ? `/api/labs/${labId}/staff/instruments-bulk/employees?ids=${instruments.map((i) => i.id).join(",")}`
    : `/api/labs/${labId}/staff/instruments/${instruments[0].id}/employees`;
  const { data, isLoading, isError } = useQuery<{ employees: StaffRow[] }>({
    queryKey: [url ?? "no-staff"],
    enabled: !!url,
    staleTime: 0,
    gcTime: 0,
    queryFn: async () => { const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() }); if (!r.ok) throw new Error(`Failed to load staff (${r.status})`); return r.json(); },
  });
  useEffect(() => { if (open) setFilter(""); }, [open]);
  useEffect(() => {
    setSelected(new Set(many ? [] : (data?.employees ?? []).filter((e) => e.assigned).map((e) => e.id)));
  }, [data, many]);

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (data?.employees ?? []).filter((e) => !f || `${staffName(e)} ${e.title ?? ""}`.toLowerCase().includes(f));
  }, [data, filter]);
  const allVisibleChecked = visible.length > 0 && visible.every((e) => selected.has(e.id));

  function toggle(id: number) {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectAllVisible() {
    setSelected((prev) => { const n = new Set(prev); for (const e of visible) n.add(e.id); return n; });
  }
  function clearVisible() {
    setSelected((prev) => { const n = new Set(prev); for (const e of visible) n.delete(e.id); return n; });
  }

  async function save() {
    if (!url) return;
    setSaving(true);
    try {
      const r = many
        ? await fetch(`${API_BASE}/api/labs/${labId}/staff/instruments-bulk/assign`, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ instrumentIds: instruments.map((i) => i.id), employeeIds: Array.from(selected) }) })
        : await fetch(`${API_BASE}${url}`, { method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify({ employeeIds: Array.from(selected) }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e?.error || `Save failed (${r.status})`); }
      const result = await r.json().catch(() => ({}));
      const flagged = result.dutyChangeEventsCreated ? ` · ${result.dutyChangeEventsCreated} reassessment${result.dutyChangeEventsCreated === 1 ? "" : "s"} flagged` : "";
      toast({
        title: "Assignment saved",
        description: many
          ? `${selected.size} staff on ${instruments.length} instruments: ${result.added} new, ${result.alreadyAssigned} already in place${flagged}`
          : `${instruments[0].name}: ${selected.size} staff${flagged}`,
      });
      // Refresh both views' data + the coverage map.
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && typeof q.queryKey[0] === "string" && ((q.queryKey[0] as string).includes("/staff/employees") || (q.queryKey[0] as string).includes("/competency/owed") || (q.queryKey[0] as string).includes("/veritamap/instruments-flat")) });
      onSaved?.();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: "Could not save", description: err?.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{many ? `Assign staff to ${instruments.length} instruments` : "Assign by Instrument"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          {many ? (
            <>
              <p className="text-sm max-h-16 overflow-y-auto" data-testid="instrument-assign-names">{instruments.map((i) => i.name).join(", ")}</p>
              <p className="text-xs text-muted-foreground">The staff you tick go on all {instruments.length}. Nobody comes off: anyone already assigned stays assigned.</p>
            </>
          ) : (
            <p className="text-sm">Who runs <span className="font-semibold">{instruments[0]?.name}</span>?</p>
          )}
          {isLoading ? (
            <p className="text-xs text-muted-foreground">Loading staff...</p>
          ) : isError ? (
            <p className="text-xs text-destructive">Could not load the staff list. Close this and try again.</p>
          ) : (data?.employees?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground italic">No active testing staff on this lab.</p>
          ) : (
            <>
              <Input placeholder="Filter by name or title..." value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="instrument-assign-staff-filter" />
              <div className="flex items-center gap-2 text-xs">
                <Button type="button" size="sm" variant="outline" onClick={selectAllVisible} disabled={allVisibleChecked || visible.length === 0} data-testid="instrument-assign-select-all">
                  Select all{filter.trim() ? " filtered" : ""} ({visible.length})
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={clearVisible} data-testid="instrument-assign-clear">
                  Clear{filter.trim() ? " filtered" : ""}
                </Button>
              </div>
              <div className="space-y-1 max-h-[36vh] overflow-y-auto">
                {visible.map((e) => (
                  <label key={e.id} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-2 py-1">
                    <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggle(e.id)} className="mt-0.5" data-testid={`instrument-assign-staff-${e.id}`} />
                    <span className="flex-1 leading-tight">
                      <span className="font-medium">{staffName(e)}</span>{e.title && <span className="ml-1 text-xs text-muted-foreground">- {e.title}</span>}
                      {many && !!e.on_count && <span className="block text-xs text-muted-foreground" data-testid={`instrument-assign-on-${e.id}`}>Already on {e.on_count === instruments.length ? `all ${instruments.length}` : `${e.on_count} of ${instruments.length}`}</span>}
                    </span>
                  </label>
                ))}
                {visible.length === 0 && <p className="text-xs text-muted-foreground italic">No staff match.</p>}
              </div>
            </>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <span className="text-xs text-muted-foreground self-center mr-auto" data-testid="instrument-assign-count">{selected.size} selected</span>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving || !data || (many && selected.size === 0)} data-testid="instrument-assign-save">{saving ? "Saving..." : "Save"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// An "Assign staff" button for a page that shows one instrument. Shows only to someone who can change VeritaStaff on a plan that has it.
export function AssignStaffButton({ instrument, testId, className }: { instrument: PickedInstrument; testId?: string; className?: string }) {
  const { user, isLoggedIn } = useAuth();
  const labId = useActiveLabId();
  const readOnly = useIsReadOnly("veritastaff");
  const [open, setOpen] = useState(false);
  if (!labId || readOnly || !isLoggedIn || !hasStaffPlan(user?.plan)) return null;
  return (
    <>
      <Button type="button" size="sm" variant="ghost" className={className} onClick={(e) => { e.stopPropagation(); setOpen(true); }} data-testid={testId ?? `assign-staff-${instrument.id}`}>
        <Users size={13} className="mr-1" /> Assign staff
      </Button>
      {open && <InstrumentStaffAssignDialog open={open} onOpenChange={setOpen} labId={labId} instruments={[instrument]} />}
    </>
  );
}

// The Instruments tab on VeritaStaff: every test system and manual test with how many staff run it. Tick several to put
// the same staff on all of them, or use a row's button for that one instrument.
export function InstrumentStaffPanel({ labId, readOnly }: { labId: number | null; readOnly: boolean }) {
  const [filter, setFilter] = useState("");
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<PickedInstrument[] | null>(null);
  const url = labId ? `/api/labs/${labId}/veritamap/instruments-flat` : null;
  const { data: instruments = [], isLoading, isError } = useQuery<(LabInstrument & { assigned_count?: number })[]>({
    queryKey: [url ?? "no-inst", "instrument-staff-panel"],
    enabled: !!url,
    staleTime: 0,
    queryFn: async () => { const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() }); if (!r.ok) throw new Error(`Failed to load instruments (${r.status})`); return r.json(); },
  });
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const shown = instruments.filter((i) => !f || `${i.instrument_name} ${i.nickname ?? ""} ${i.serial_number ?? ""} ${i.category ?? ""} ${i.map_name}`.toLowerCase().includes(f));
    const byName = (a: LabInstrument, b: LabInstrument) => a.instrument_name.localeCompare(b.instrument_name);
    return [
      { label: "Test systems", items: shown.filter((i) => !isManual(i)).sort(byName) },
      { label: "Manual tests", items: shown.filter((i) => isManual(i)).sort(byName) },
    ];
  }, [instruments, filter]);
  const visibleIds = groups.flatMap((g) => g.items.map((i) => i.id));
  const allVisibleTicked = visibleIds.length > 0 && visibleIds.every((id) => ticked.has(id));
  const noOne = instruments.filter((i) => !i.assigned_count).length;

  function toggle(id: number) {
    setTicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading instruments...</p>;
  if (isError) return <p className="text-sm text-destructive">Could not load the instruments. Reload this page and try again.</p>;
  if (instruments.length === 0) return <p className="text-sm text-muted-foreground" data-testid="instrument-panel-empty">No instruments yet. Instruments come from your VeritaMap{"®"} maps. Add them there and they show here.</p>;
  return (
    <div className="space-y-4" data-testid="instrument-panel">
      <p className="text-sm text-muted-foreground">
        Tick the instruments and manual tests, then pick the staff who run them. The staff you pick go on every one you ticked. This is the same assignment as the Assigned Instruments list on each person's page.
        {noOne > 0 && <span className="font-medium text-foreground" data-testid="instrument-panel-gap"> {noOne} of {instruments.length} have no one assigned.</span>}
      </p>
      <Input placeholder="Filter by name, nickname, S/N, category, map..." value={filter} onChange={(e) => setFilter(e.target.value)} className="max-w-md" data-testid="instrument-panel-filter" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={readOnly || allVisibleTicked || visibleIds.length === 0} onClick={() => setTicked((prev) => { const n = new Set(prev); for (const id of visibleIds) n.add(id); return n; })} data-testid="instrument-panel-select-all">
          Select all{filter.trim() ? " filtered" : ""} ({visibleIds.length})
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={readOnly} onClick={() => setTicked((prev) => { const n = new Set(prev); for (const id of visibleIds) n.delete(id); return n; })} data-testid="instrument-panel-clear">
          Clear{filter.trim() ? " filtered" : ""}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={readOnly || ticked.size === 0}
          onClick={() => setTarget(instruments.filter((i) => ticked.has(i.id)).map((i) => ({ id: i.id, name: instrumentWithTag(i) })))}
          data-testid="instrument-panel-assign-ticked"
        >
          <Users size={13} className="mr-1" /> Assign staff to {ticked.size} selected
        </Button>
      </div>
      {groups.map((g) => g.items.length > 0 && (
        <div key={g.label}>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{g.label} ({g.items.length})</div>
          <div className="divide-y divide-border border border-border rounded-lg">
            {g.items.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <label className="flex items-start gap-2 flex-1 min-w-[12rem] cursor-pointer">
                  <Checkbox checked={ticked.has(i.id)} onCheckedChange={() => toggle(i.id)} disabled={readOnly} className="mt-0.5" data-testid={`instrument-panel-tick-${i.id}`} />
                  <span className="text-sm leading-tight">
                    <span className="font-medium">{i.instrument_name}</span>{i.nickname && <Badge variant="outline" className="ml-1.5 text-[10px]">{i.nickname}</Badge>}{i.serial_number && <span className="ml-1 text-xs text-muted-foreground">S/N {i.serial_number}</span>}{i.category && <span className="ml-1 text-xs text-muted-foreground">- {i.category}</span>}
                    <span className="block text-xs text-muted-foreground">{i.map_name}</span>
                  </span>
                </label>
                <span className={`text-xs ${i.assigned_count ? "text-muted-foreground" : "font-medium text-foreground"}`} data-testid={`instrument-panel-count-${i.id}`}>{i.assigned_count ? `${i.assigned_count} staff` : "No one assigned"}</span>
                <Button type="button" size="sm" variant="ghost" disabled={readOnly} onClick={() => setTarget([{ id: i.id, name: instrumentWithTag(i) }])} data-testid={`instrument-panel-assign-${i.id}`}><Users size={13} className="mr-1" /> Assign staff</Button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {visibleIds.length === 0 && <p className="text-xs text-muted-foreground italic">No instruments match.</p>}
      {target && <InstrumentStaffAssignDialog open onOpenChange={(v) => { if (!v) setTarget(null); }} labId={labId} instruments={target} onSaved={() => { if (target.length > 1) setTicked(new Set()); }} />}
    </div>
  );
}
