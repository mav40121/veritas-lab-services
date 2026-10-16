// client/src/components/PhiGuard.tsx
//
// PHI guard at entry (Q56 item 4, 2026-10-16). Mounted once at the app root. When someone leaves a text box, or
// pastes into one, and the text looks like patient information (shared/phiPatterns.ts: a dash-formatted SSN, or a
// labeled MRN, date of birth or patient name), a warning appears asking them to remove it. It never blocks the save,
// never sends the text anywhere, and warns once per field and finding. Password, email, number and date inputs are
// skipped; an element can opt out with data-phi-guard="off".

import { useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { detectPhi } from "@shared/phiPatterns";

const SKIP_TYPES = new Set(["password", "email", "number", "date", "datetime-local", "time", "month", "week", "hidden", "checkbox", "radio", "file", "color", "range"]);

function textOf(el: EventTarget | null): { el: HTMLElement; text: string } | null {
  if (!(el instanceof HTMLElement)) return null;
  if (el.closest('[data-phi-guard="off"]')) return null;
  if (el instanceof HTMLTextAreaElement) return { el, text: el.value };
  if (el instanceof HTMLInputElement) return SKIP_TYPES.has((el.type || "text").toLowerCase()) ? null : { el, text: el.value };
  if (el.isContentEditable) return { el, text: el.innerText };
  return null;
}

export function PhiGuard() {
  const { toast } = useToast();
  const warned = useRef(new WeakMap<HTMLElement, string>());

  useEffect(() => {
    const warn = (el: HTMLElement, text: string) => {
      const found = detectPhi(text);
      if (!found.length) return;
      const key = found.join("|");
      if (warned.current.get(el) === key) return;
      warned.current.set(el, key);
      toast({
        title: "This looks like patient information",
        description: `It appears to contain a ${found.map((l) => (l.startsWith("Social") ? l : l.charAt(0).toLowerCase() + l.slice(1))).join(" and a ")}. VeritaAssure is not for patient information: please remove it before saving, and refer to cases by an internal number.`,
        variant: "destructive",
        duration: 15000,
      });
    };
    const onFocusOut = (e: FocusEvent) => {
      const t = textOf(e.target);
      if (t) warn(t.el, t.text);
    };
    const onPaste = (e: ClipboardEvent) => {
      const t = textOf(e.target);
      if (!t) return;
      const pasted = e.clipboardData?.getData("text") || "";
      if (pasted) warn(t.el, pasted);
    };
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("paste", onPaste, true);
    return () => {
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("paste", onPaste, true);
    };
  }, [toast]);

  return null;
}
