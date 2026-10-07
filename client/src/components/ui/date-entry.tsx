// client/src/components/ui/date-entry.tsx
//
// Shared date entry control (parking lot #78 with #75, 2026-10-07). Replaces
// the native <input type="date"> where it was too clunky at cell size: people
// type MM/DD/YYYY with the slashes inserted for them, paste any common date
// form, pick from a calendar, or hit Today. Values in and out are ISO
// yyyy-mm-dd strings ("" when cleared), exactly what the native control gave,
// so existing save paths are unchanged.
import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ISO_DATE_RE, isoToDisplay, isoToLocalDate, maskDateInput, parseLooseDate, todayLocalISO } from "@/lib/dateEntry";

export interface DateEntryProps {
  value?: string | null;
  onChange: (iso: string) => void;
  disabled?: boolean;
  /** Wrapper classes. */
  className?: string;
  /** Classes on the text input itself (borders, widths). */
  inputClassName?: string;
  /** ISO bounds; a typed or picked date outside them is rejected. */
  min?: string;
  max?: string;
  placeholder?: string;
  size?: "sm" | "md";
  "aria-label"?: string;
  "data-testid"?: string;
}

export function DateEntry({
  value,
  onChange,
  disabled,
  className,
  inputClassName,
  min,
  max,
  placeholder = "MM/DD/YYYY",
  size = "md",
  "aria-label": ariaLabel,
  "data-testid": testId,
}: DateEntryProps) {
  const iso = value && ISO_DATE_RE.test(value) ? value : "";
  const [text, setText] = React.useState(isoToDisplay(iso));
  const [invalid, setInvalid] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const focused = React.useRef(false);

  // Follow the stored value when it changes underneath us (another save, a
  // refetch), but never while the person is mid-edit.
  React.useEffect(() => {
    if (!focused.current) {
      setText(isoToDisplay(iso));
      setInvalid(false);
    }
  }, [iso]);

  const inRange = (candidate: string) => (!min || candidate >= min) && (!max || candidate <= max);

  const apply = (candidate: string) => {
    setInvalid(false);
    setText(isoToDisplay(candidate));
    if (candidate !== iso) onChange(candidate);
  };

  const commit = (raw: string) => {
    const parsed = parseLooseDate(raw);
    if (parsed === null || (parsed && !inRange(parsed))) {
      setInvalid(true);
      return;
    }
    apply(parsed);
  };

  const small = size === "sm";
  const selected = isoToLocalDate(iso);

  return (
    <div className={cn("inline-flex items-center gap-1", className)} data-testid={testId ? `${testId}-wrap` : undefined}>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        title={invalid ? "Enter a date as MM/DD/YYYY" : undefined}
        data-testid={testId ?? "date-entry-input"}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => { setText(maskDateInput(e.target.value)); setInvalid(false); }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text");
          if (!pasted) return;
          e.preventDefault();
          const parsed = parseLooseDate(pasted);
          if (parsed === null || (parsed && !inRange(parsed))) { setText(maskDateInput(pasted)); setInvalid(true); return; }
          apply(parsed);
        }}
        onBlur={(e) => { focused.current = false; commit(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(text); }
          else if (e.key === "Escape") { setText(isoToDisplay(iso)); setInvalid(false); }
        }}
        className={cn(
          small ? "h-7 text-xs px-1.5 w-[106px]" : "h-9 text-sm w-[124px]",
          "tabular-nums",
          invalid && "border-red-400 focus-visible:ring-red-400/30",
          inputClassName,
        )}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            aria-label="Open calendar"
            data-testid={testId ? `${testId}-calendar` : "date-entry-calendar"}
            className={cn(small ? "h-7 w-7" : "h-9 w-9", "shrink-0 text-muted-foreground hover:text-foreground")}
          >
            <CalendarIcon className={small ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" data-testid={testId ? `${testId}-popover` : "date-entry-popover"}>
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            onSelect={(d) => {
              if (d) {
                const candidate = format(d, "yyyy-MM-dd");
                if (inRange(candidate)) apply(candidate);
              }
              setOpen(false);
            }}
            disabled={(d) => !inRange(format(d, "yyyy-MM-dd"))}
            initialFocus
          />
          <div className="flex items-center justify-between border-t px-2 py-1.5">
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" data-testid={testId ? `${testId}-today` : "date-entry-today"}
              onClick={() => { const t = todayLocalISO(); if (inRange(t)) apply(t); setOpen(false); }}>
              Today
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" data-testid={testId ? `${testId}-clear` : "date-entry-clear"}
              onClick={() => { apply(""); setOpen(false); }}>
              Clear
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
