// The specimen list for waived method 1, blind specimen testing: each specimen's evidence, date, initials and pass, with an Add specimen button
// (Cathy Thornton, RFGH, 2026-11-04). The method counts as passed only when every specimen passed.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";
import { WAIVED_MAX_SPECIMENS, type WaivedSpecimen } from "@shared/competencyWaivedSpecimens";
import { selfSpecimenRemovable } from "@shared/competencySelfEntry";

export const BLANK_SPECIMEN: WaivedSpecimen = { evidence: "", date: "", initials: "", passed: false };

// evaluatorLocked: a Staff login on their own record. Evidence and date stay open; Pass and initials are the evaluator's, and
// a row carrying either can't be removed (the server keeps both by position, shared/competencySelfEntry.ts).
export function WaivedSpecimenRows({ rows, onChange, disabled, evaluatorLocked, testId }: { rows: WaivedSpecimen[]; onChange: (rows: WaivedSpecimen[]) => void; disabled?: boolean; evaluatorLocked?: boolean; testId: string }) {
  const list = rows.length ? rows : [BLANK_SPECIMEN];
  const set = (i: number, patch: Partial<WaivedSpecimen>) => onChange(list.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2" data-testid={`${testId}-specimens`}>
      {list.map((r, i) => (
        <div key={i} className="rounded-md border border-border/60 p-2 space-y-1.5" data-testid={`${testId}-specimen-${i}`}>
          <div className="flex flex-wrap items-center gap-2">
            {list.length > 1 && <span className="text-[10px] font-medium text-muted-foreground shrink-0">Specimen {i + 1}</span>}
            <Input className="text-xs h-7 flex-1 min-w-[10rem]" placeholder="Specimen and evidence..." disabled={disabled} value={r.evidence} onChange={(e) => set(i, { evidence: e.target.value })} data-testid={`${testId}-specimen-${i}-evidence`} />
            <label className="flex items-center gap-1 text-[10px] shrink-0">
              <input type="checkbox" disabled={disabled || evaluatorLocked} checked={r.passed} onChange={(e) => set(i, { passed: e.target.checked })} data-testid={`${testId}-specimen-${i}-pass`} />
              Pass
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" className="text-xs h-7 w-36" disabled={disabled} value={r.date} onChange={(e) => set(i, { date: e.target.value })} data-testid={`${testId}-specimen-${i}-date`} />
            <Input className="text-xs h-7 w-20" placeholder="Initials" disabled={disabled || evaluatorLocked} value={r.initials} onChange={(e) => set(i, { initials: e.target.value })} data-testid={`${testId}-specimen-${i}-initials`} />
            {list.length > 1 && !disabled && (!evaluatorLocked || selfSpecimenRemovable(list, i)) && (
              <button type="button" className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground" onClick={(e) => { e.preventDefault(); onChange(list.filter((_, n) => n !== i)); }} data-testid={`${testId}-specimen-${i}-remove`}>
                <X size={11} /> Remove
              </button>
            )}
          </div>
        </div>
      ))}
      {!disabled && list.length < WAIVED_MAX_SPECIMENS && (
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={(e) => { e.preventDefault(); onChange([...list, BLANK_SPECIMEN]); }} data-testid={`${testId}-add-specimen`}>
          <Plus size={12} className="mr-1" /> Add specimen
        </Button>
      )}
    </div>
  );
}
