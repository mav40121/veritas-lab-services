// EmployeeInstrumentsPickerDialog
//
// PR D of the VeritaComp customer-blockers wave (2026-06-05, item #8).
// Many-to-many assignment between a staff employee and the lab's VeritaMap
// instruments. Picker is a single dialog grouped by map with checkboxes.
// Submit calls PUT which atomically rewrites the join in a transaction.

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export type LabInstrument = {
  id: number;
  instrument_name: string;
  serial_number: string | null;
  nickname: string | null;
  category: string | null;
  map_id: number;
  map_name: string;
};

export function instrumentLabel(i: LabInstrument): string {
  const parts: string[] = [i.instrument_name];
  if (i.nickname) parts.push(`(${i.nickname})`);
  else if (i.serial_number) parts.push(`(S/N ${i.serial_number})`);
  if (i.category) parts.push(`- ${i.category}`);
  return parts.join(" ");
}

export function EmployeeInstrumentsPickerDialog({
  open,
  onOpenChange,
  available,
  initiallySelected,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  available: LabInstrument[];
  initiallySelected: number[];
  onSubmit: (instrumentIds: number[]) => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(initiallySelected));
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected(new Set(initiallySelected));
      setFilter("");
      setError(null);
    }
  }, [open, initiallySelected]);

  const byMap = useMemo(() => {
    const m = new Map<string, { mapName: string; items: LabInstrument[] }>();
    const filterLower = filter.trim().toLowerCase();
    for (const i of available) {
      if (filterLower) {
        const hay = `${i.instrument_name} ${i.nickname ?? ""} ${i.serial_number ?? ""} ${i.category ?? ""} ${i.map_name}`.toLowerCase();
        if (!hay.includes(filterLower)) continue;
      }
      const key = `${i.map_id}::${i.map_name}`;
      if (!m.has(key)) m.set(key, { mapName: i.map_name, items: [] });
      m.get(key)!.items.push(i);
    }
    return Array.from(m.values()).sort((a, b) => a.mapName.localeCompare(b.mapName));
  }, [available, filter]);

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Currently-visible instrument ids (respects the active filter). Used by
  // Select all / Clear so a labe-wide pick on a SCAHC-style facility with
  // 30+ instruments is one click instead of thirty.
  const visibleIds = useMemo(() => byMap.flatMap(g => g.items.map(i => i.id)), [byMap]);
  const allVisibleChecked = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));

  function selectAllVisible() {
    setSelected(prev => {
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }
  function clearAllVisible() {
    setSelected(prev => {
      const next = new Set(prev);
      for (const id of visibleIds) next.delete(id);
      return next;
    });
  }

  async function handleSubmit() {
    setError(null);
    setSaving(true);
    try {
      await onSubmit(Array.from(selected));
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign Instruments</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <p className="text-xs text-muted-foreground">
            Pick the instruments this employee actually runs. The supervisor sees this context when authoring a competency assessment.
          </p>
          <Input placeholder="Filter by name, nickname, S/N, category, map..." value={filter} onChange={e => setFilter(e.target.value)} />
          {visibleIds.length > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={selectAllVisible}
                disabled={allVisibleChecked}
                data-testid="instruments-picker-select-all"
              >
                Select all{filter.trim() ? " filtered" : ""} ({visibleIds.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearAllVisible}
                data-testid="instruments-picker-clear-all"
              >
                Clear{filter.trim() ? " filtered" : ""}
              </Button>
            </div>
          )}
          {byMap.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No instruments match.</p>
          ) : (
            <div className="space-y-3">
              {byMap.map(g => (
                <div key={g.mapName}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{g.mapName}</div>
                  <div className="space-y-1">
                    {g.items.map(i => (
                      <label key={i.id} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-muted/40 rounded px-2 py-1">
                        <Checkbox
                          checked={selected.has(i.id)}
                          onCheckedChange={() => toggle(i.id)}
                          className="mt-0.5"
                        />
                        <span className="flex-1 leading-tight">
                          <span className="font-medium">{i.instrument_name}</span>
                          {i.nickname && <Badge variant="outline" className="ml-1.5 text-[10px]">{i.nickname}</Badge>}
                          {i.serial_number && <span className="ml-1 text-xs text-muted-foreground">S/N {i.serial_number}</span>}
                          {i.category && <span className="ml-1 text-xs text-muted-foreground">- {i.category}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {error && <div className="text-xs text-destructive">{error}</div>}
          <div className="flex justify-end gap-2 pt-2">
            <span className="text-xs text-muted-foreground self-center mr-auto">{selected.size} selected</span>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
