import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, X, Info } from "lucide-react";

// Customer-only onboarding card. Renders at the top of each module app
// page with "What it does" + "How to use it" content. Dismissible per
// (user, module) via localStorage. Defaults expanded on first visit.
// Hidden permanently for users who explicitly dismiss.
//
// Surface: only inside authenticated app pages (e.g., /veritaqc-app).
// Not used on public marketing or /demo pages.

export interface ModuleHowToCardProps {
  moduleKey: string;         // e.g., "veritaqc" — used for localStorage key
  moduleName: string;        // e.g., "VeritaQC™"
  whatItDoes: string;        // 1-3 sentences
  howToUse: string[];        // ordered steps
  brandColor?: string;       // optional accent override
}

export function ModuleHowToCard({
  moduleKey,
  moduleName,
  whatItDoes,
  howToUse,
  brandColor,
}: ModuleHowToCardProps) {
  const lsKey = `module-howto-dismissed-${moduleKey}`;
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(lsKey) === "1") {
      setDismissed(true);
    }
  }, [lsKey]);

  if (dismissed) return null;

  const accent = brandColor || "var(--primary, #01696F)";

  return (
    <div
      className="mb-4 rounded-lg border bg-card"
      style={{ borderColor: `${accent}33`, backgroundColor: `${accent}08` }}
    >
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
        >
          <Info size={14} style={{ color: accent }} className="shrink-0" />
          <span className="text-sm font-semibold truncate" style={{ color: accent }}>
            How {moduleName} works
          </span>
          {expanded ? (
            <ChevronUp size={14} className="text-muted-foreground shrink-0" />
          ) : (
            <ChevronDown size={14} className="text-muted-foreground shrink-0" />
          )}
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            try { localStorage.setItem(lsKey, "1"); } catch {}
            setDismissed(true);
          }}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 ml-2 shrink-0"
          aria-label="Dismiss this card"
          title="Hide permanently for this module"
        >
          <X size={14} />
        </button>
      </div>
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3 text-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: accent }}>
              What it does
            </div>
            <p className="text-foreground leading-relaxed">{whatItDoes}</p>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: accent }}>
              How to use it
            </div>
            <ol className="space-y-1.5 list-decimal list-inside text-foreground marker:text-muted-foreground marker:font-semibold">
              {howToUse.map((step, i) => (
                <li key={i} className="leading-relaxed pl-1">{step}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
