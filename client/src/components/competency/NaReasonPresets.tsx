// One-click reasons for a competency element marked N/A (parking lot #95, REQ-050; Michael Q123 = 1, 2026-10-12).
// The reason stays required and editable: a preset only fills the box. Presets name the specific record that does not
// apply, never the whole element (Element 3 also covers intermediate results, PT and preventive-maintenance records).
// Brandy Morgan, Redington-Fairview: "Can you make it so QC is not something that is required for the Bactec FX
// (if you choose N/A it makes you type a reason)? There isn't any to be done after the initial validation."
export const NA_REASON_PRESETS: Record<number, string[]> = {
  3: ["No QC required after initial verification per the manufacturer's instructions"],
  4: ["No operator maintenance or function checks required for this instrument per the manufacturer's instructions"],
};

export function NaReasonPresets({ element, onPick, disabled }: { element: number; onPick: (reason: string) => void; disabled?: boolean }) {
  const presets = NA_REASON_PRESETS[element] || [];
  if (!presets.length || disabled) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5" data-testid={`element-${element}-na-presets`}>
      <span className="text-[10px] text-muted-foreground">Use:</span>
      {presets.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          className="text-[10px] leading-tight px-2 py-1 rounded border border-border bg-background hover:bg-muted text-left text-foreground"
        >
          {p}
        </button>
      ))}
    </div>
  );
}
