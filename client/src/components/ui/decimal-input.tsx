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
export interface DecimalInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number;
  onChangeNumber: (n: number) => void;
  fallback: number;
}

export function DecimalInput({ value, onChangeNumber, fallback, onFocus, onBlur, ...rest }: DecimalInputProps) {
  const canonical = (v: number) => (v == null || Number.isNaN(v) ? "" : String(v));
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
      inputMode="decimal"
      value={draft}
      onFocus={(e) => { editing.current = true; onFocus?.(e); }}
      onBlur={(e) => { editing.current = false; setDraft(canonical(value)); onBlur?.(e); }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const n = parseFloat(raw);
        onChangeNumber(Number.isNaN(n) ? fallback : n);
      }}
      {...rest}
    />
  );
}
