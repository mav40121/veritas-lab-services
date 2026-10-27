// MarkExistingStaffDialog
//
// Michael Q19 = 1 (2026-10-27). A lab moving onto VeritaAssure loads its roster, and every testing person with no
// "Recorded as" marking reads as a new hire: "Not cleared for patient testing", then overdue. Production 10/27 had 150
// such people across client labs, fixable only one record at a time. This dialog marks the people the lab chooses as
// Existing staff (already testing before the lab's records were kept here) in one step. Only unmarked people are
// listed; a person the lab already marked keeps it (change that on their own record). Nothing is pre-selected.

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export interface MarkableEmployee {
  id: number;
  first_name: string;
  last_name: string;
  title?: string | null;
  hire_date?: string | null;
  performs_testing?: number;
  competencySchedule?: { recorded_as?: string | null } | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  labId: number | null;
  employees: MarkableEmployee[];
}

export function unmarkedTestingStaff(employees: MarkableEmployee[]): MarkableEmployee[] {
  return employees
    .filter((e) => e.performs_testing === 1 && !e.competencySchedule?.recorded_as)
    .sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));
}

export function MarkExistingStaffDialog({ open, onOpenChange, labId, employees }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const people = useMemo(() => unmarkedTestingStaff(employees), [employees]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function save() {
    if (!labId || picked.size === 0) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}/api/labs/${labId}/staff/competency/recorded-as`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ employeeIds: Array.from(picked), recordedAs: "existing" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      toast({ title: `${j.changed} ${j.changed === 1 ? "person" : "people"} marked existing staff`, description: "They count as cleared for patient testing. Enter each person's most recent competency so their schedule runs from it." });
      await queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).includes("/staff/") });
      setPicked(new Set());
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Could not mark staff", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setPicked(new Set()); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="mark-existing-dialog">
        <DialogHeader>
          <DialogTitle>Mark existing staff</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Check the people who were already testing patient specimens before your lab started keeping competency records here.
            They count as cleared for patient testing, and their schedule runs from the most recent competency you enter for each of them.
            Leave new hires unchecked: they need orientation and an initial competency before patient testing.
          </p>
          {people.length === 0 ? (
            <div className="rounded-md border border-border p-4 text-center text-muted-foreground" data-testid="mark-existing-none">
              Every testing staff member already has a marking.
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{people.length} testing {people.length === 1 ? "person has" : "people have"} no marking</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPicked(new Set(people.map((p) => p.id)))} data-testid="mark-existing-all">Select all</Button>
                  <Button variant="outline" size="sm" onClick={() => setPicked(new Set())}>Clear</Button>
                </div>
              </div>
              <div className="rounded-md border border-border divide-y divide-border max-h-[45vh] overflow-y-auto">
                {people.map((p) => (
                  <label key={p.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40" data-testid={`mark-existing-row-${p.id}`}>
                    <Checkbox checked={picked.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                    <span className="font-medium">{p.last_name}, {p.first_name}</span>
                    {p.title && <span className="text-muted-foreground">{p.title}</span>}
                    <span className="ml-auto text-xs text-muted-foreground">Hired {p.hire_date || "N/A"}</span>
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || picked.size === 0} data-testid="mark-existing-save">
              {saving ? "Saving..." : `Mark ${picked.size} as existing staff`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
