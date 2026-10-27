// ObserverInitialsField
//
// Wave F PR F4 (2026-06-06). Compact inline field for the VeritaComp
// Element 1 (direct observation of routine testing) and Element 4 (direct
// observation of instrument maintenance) observer-initials cell.
//
// Per 42 CFR §493.1235 and TJC HR.01.06.01 EP 18, the direct-observation
// elements must be performed by a Lab Director (or designee), a Technical
// Consultant (moderate complexity), or a Technical Supervisor (high
// complexity).
//
// BUG-075 (Michael Q35 = 1, 2026-10-27): the observer is picked from the
// lab's LD/TC/TS people in VeritaStaff, and the server refuses anyone else
// on a new or changed value (server/competencyObserver.ts). The free-text
// mode is gone. People who have left the lab are listed after current
// staff, so a paper record signed by a former supervisor can still be
// entered once that person is in VeritaStaff with their role. A value saved
// before this check that matches nobody stays on the record and is shown as
// saved earlier; changing it means picking someone from the list.
//
// allowTyped keeps the earlier typed entry (with its warning) for an
// observer field outside the CLIA LD/TC/TS rule (the NYS Element 7 safe
// work practices observer).

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Pencil } from "lucide-react";
import { matchObserver } from "@shared/competencyObserver";

export interface QualifiedObserver {
  employeeId: number;
  name: string;
  initials: string;
  roles: string[];
  /** false for someone who has left the lab (still a valid observer for past entries). */
  active?: boolean;
}

interface Props {
  value: string;
  onChange: (initials: string) => void;
  observers: QualifiedObserver[];
  isLoading?: boolean;
  disabled?: boolean;
  /** Keep typed entry for an observer field the LD/TC/TS rule does not cover. */
  allowTyped?: boolean;
  /** Optional override for the surrounding wrapper class. */
  className?: string;
  /** Size of the trigger: the program dialog uses h-7, the person page h-8. */
  triggerClassName?: string;
  "data-testid"?: string;
}

const SAVED = "__saved";

export function ObserverInitialsField({ value, onChange, observers, isLoading, disabled, allowTyped, className, triggerClassName = "text-xs h-7", ...rest }: Props) {
  const testId = rest["data-testid"];
  const matchedObserver = matchObserver(observers, value);
  const savedUnmatched = !!(value && value.trim()) && !matchedObserver;
  const [mode, setMode] = useState<"select" | "input">(() => (allowTyped && savedUnmatched ? "input" : "select"));

  if (isLoading) {
    return (
      <div className={className}>
        <Input className={triggerClassName} placeholder="..." disabled value="" />
      </div>
    );
  }

  if (allowTyped && (mode === "input" || observers.length === 0)) {
    // Typed entry, only where the LD/TC/TS rule does not apply. Warn when
    // the initials do not match a VeritaStaff LD/TC/TS person.
    const inputValue = value || "";
    return (
      <div className={className}>
        <div className="flex items-center gap-1">
          <Input
            className={triggerClassName}
            placeholder="Init"
            value={inputValue}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            maxLength={10}
            data-testid={testId}
          />
          {observers.length > 0 && (
            <button
              type="button"
              onClick={() => setMode("select")}
              className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded border border-border text-muted-foreground hover:border-primary"
              title="Use qualified-observer list"
            >
              <Pencil size={11} />
            </button>
          )}
        </div>
        {savedUnmatched && observers.length > 0 && (
          <div className="mt-1 flex items-start gap-1 text-[10px] text-amber-700">
            <AlertTriangle size={10} className="shrink-0 mt-0.5" />
            <span>Not in the lab's LD/TC/TS roster.</span>
          </div>
        )}
      </div>
    );
  }

  const current = observers.filter((o) => o.active !== false);
  const former = observers.filter((o) => o.active === false);
  const selectValue = matchedObserver ? matchedObserver.initials : savedUnmatched ? SAVED : "__none";
  const label = (o: QualifiedObserver) => `${o.initials} : ${o.name} (${o.roles.join("/")})`;

  return (
    <div className={className}>
      <Select
        value={selectValue}
        disabled={disabled}
        onValueChange={(v) => {
          if (v === "__type") setMode("input");
          else if (v === "__none") onChange("");
          else if (v !== SAVED) onChange(v);
        }}
      >
        <SelectTrigger className={triggerClassName} data-testid={testId}><SelectValue placeholder="Observer" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">(none)</SelectItem>
          {savedUnmatched && <SelectItem value={SAVED}>{value} (saved earlier)</SelectItem>}
          {current.map((o) => (
            <SelectItem key={o.employeeId} value={o.initials}>{label(o)}</SelectItem>
          ))}
          {former.map((o) => (
            <SelectItem key={o.employeeId} value={o.initials}>{label(o)}, left the lab</SelectItem>
          ))}
          {allowTyped && <SelectItem value="__type">Type initials manually…</SelectItem>}
        </SelectContent>
      </Select>
      {observers.length === 0 && (
        <div className="mt-1 text-[10px] text-muted-foreground" data-testid={testId ? `${testId}-empty` : undefined}>
          No Laboratory Director, Technical Consultant or Technical Supervisor in VeritaStaff yet. Add the observer in VeritaStaff with their role.
        </div>
      )}
      {savedUnmatched && (
        <div className="mt-1 flex items-start gap-1 text-[10px] text-amber-700" data-testid={testId ? `${testId}-saved-note` : undefined}>
          <AlertTriangle size={10} className="shrink-0 mt-0.5" />
          <span>Saved before observers were checked; not an LD/TC/TS in VeritaStaff. To change it, pick someone from the list.</span>
        </div>
      )}
    </div>
  );
}
