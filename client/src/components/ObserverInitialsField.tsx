// ObserverInitialsField
//
// Wave F PR F4 (2026-06-06). Compact inline field for the VeritaComp
// Element 1 (direct observation of routine testing) and Element 4 (direct
// observation of instrument maintenance) observer-initials cell.
//
// Per 42 CFR §493.1235 and TJC HR.01.06.01 EP 18, the direct-observation
// elements must be performed by a Lab Director (or designee), a Technical
// Consultant (moderate complexity), or a Technical Supervisor (high
// complexity). This widget surfaces the lab's qualified observer roster
// as a controlled list while keeping a free-text fallback for paper-first
// labs whose observer signed paper and is being transcribed.
//
// Surveyor-defensibility: if the entered initials do not match any
// qualified observer's computed initials, an inline amber warning fires.
// The warning does NOT block save (paper labs are real), but it makes
// the lab director look twice before the surveyor does.

import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Pencil } from "lucide-react";

export interface QualifiedObserver {
  employeeId: number;
  name: string;
  initials: string;
  roles: string[];
}

interface Props {
  value: string;
  onChange: (initials: string) => void;
  observers: QualifiedObserver[];
  isLoading?: boolean;
  /** Optional override for the surrounding wrapper class. */
  className?: string;
}

export function ObserverInitialsField({ value, onChange, observers, isLoading, className }: Props) {
  // Mode toggle. When the lab has a Select pick we render the dropdown.
  // When they click "Type initials" we expose a raw Input so they can
  // transcribe a paper signature whose owner is not in the staff roster.
  // Edit-time hydration: if the loaded value matches a qualified observer's
  // initials we start in select mode; otherwise we start in input mode.
  const matchedObserver = observers.find((o) => o.initials === value);
  const [mode, setMode] = useState<"select" | "input">(() => {
    if (!value) return "select";
    return matchedObserver ? "select" : "input";
  });

  if (isLoading) {
    return (
      <div className={className}>
        <Input className="text-xs h-7" placeholder="..." disabled value="" />
      </div>
    );
  }

  if (mode === "select" && observers.length > 0) {
    return (
      <div className={className}>
        <Select
          value={matchedObserver ? matchedObserver.initials : "__none"}
          onValueChange={(v) => {
            if (v === "__type") {
              setMode("input");
            } else if (v === "__none") {
              onChange("");
            } else {
              onChange(v);
            }
          }}
        >
          <SelectTrigger className="text-xs h-7"><SelectValue placeholder="Observer" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">(none)</SelectItem>
            {observers.map((o) => (
              <SelectItem key={o.employeeId} value={o.initials}>
                {o.initials} : {o.name} ({o.roles.join("/")})
              </SelectItem>
            ))}
            <SelectItem value="__type">Type initials manually…</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Input mode — explicit free-text. Show inline warning if the typed
  // initials do not match any qualified observer's computed initials.
  const inputValue = value || "";
  const looksUnqualified = inputValue.trim().length > 0 && !matchedObserver;
  return (
    <div className={className}>
      <div className="flex items-center gap-1">
        <Input
          className="text-xs h-7"
          placeholder="Init"
          value={inputValue}
          onChange={(e) => onChange(e.target.value)}
          maxLength={10}
        />
        <button
          type="button"
          onClick={() => setMode("select")}
          className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded border border-border text-muted-foreground hover:border-primary"
          title="Use qualified-observer list"
        >
          <Pencil size={11} />
        </button>
      </div>
      {looksUnqualified && observers.length > 0 && (
        <div className="mt-1 flex items-start gap-1 text-[10px] text-amber-700">
          <AlertTriangle size={10} className="shrink-0 mt-0.5" />
          <span>Not in the lab's LD/TC/TS roster. Surveyors expect Element 1 / 4 observers to hold one of those CLIA roles per §493.1235. Confirm before sign-off.</span>
        </div>
      )}
    </div>
  );
}
