import * as React from "react";
import { Input } from "@/components/ui/input";

// A numeric field that keeps a local string draft so decimals type correctly.
//
// A controlled <input type="text" inputMode="decimal"> (or an <Input> whose parent stores a parsed
// number) wipes a trailing "." on every keystroke: the browser reports "1." as
// "" and parseFloat("1.") is 1, so the value snaps back and you can never build
// "1.07". This wrapper renders type="text" inputMode="decimal" and holds the raw
// text you type; it calls onChangeNumber with the PARSED number (falling back to
// `fallback` on empty/invalid) so the parent's numeric state and every consumer
// stay exactly as they were. On blur it resyncs the draft to the canonical value.
//
// 2026-10-08: the same snap-back hit whole-number fields that stored
// `parseInt(e.target.value) || 1`: clearing the box put the 1 straight back, so
// "Units per Order Unit" could only ever be appended to (1 -> 13, never 2-9).
// `integer` covers those fields; `commitOnBlur` is for fields whose change
// resizes entered data (a specimen count trims rows), so typing "45" over "40"
// never passes through "4" and drops the rows above it.
export interface DecimalInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number;
  onChangeNumber: (n: number) => void;
  fallback: number;
  // Whole numbers only (counts, days): parses with parseInt, numeric keypad.
  integer?: boolean;
  // Report the number once, when the field is left or Enter is pressed,
  // instead of on every keystroke.
  commitOnBlur?: boolean;
}

export function DecimalInput({ value, onChangeNumber, fallback, integer, commitOnBlur, onFocus, onBlur, onKeyDown, ...rest }: DecimalInputProps) {
  const canonical = (v: number) => (v == null || Number.isNaN(v) ? "" : String(v));
  const parse = (raw: string) => {
    const n = integer ? parseInt(raw, 10) : parseFloat(raw);
    return Number.isNaN(n) ? fallback : n;
  };
  const [draft, setDraft] = React.useState<string>(() => canonical(value));
  const editing = React.useRef(false);

  // Resync when the parent's value changes and we are not mid-edit (e.g. a
  // preset button set it, or it was reset).
  React.useEffect(() => {
    if (!editing.current) setDraft(canonical(value));
  }, [value]);

  return (
    <Input
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      value={draft}
      onFocus={(e) => { editing.current = true; onFocus?.(e); }}
      onBlur={(e) => {
        editing.current = false;
        if (commitOnBlur) onChangeNumber(parse(e.currentTarget.value));
        setDraft(canonical(value));
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (commitOnBlur && e.key === "Enter") e.currentTarget.blur();
        onKeyDown?.(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (!commitOnBlur) onChangeNumber(parse(raw));
      }}
      {...rest}
    />
  );
}
