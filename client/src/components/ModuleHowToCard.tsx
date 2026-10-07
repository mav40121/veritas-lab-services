import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, X, Info, CheckCircle2, Circle } from "lucide-react";
import { stepKeysForModule } from "@/lib/gettingStartedContent";

// Phase B of the in-app Getting Started (parking lot #79, 2026-10-07): the
// module card shows live progress on the system-path steps that belong to the
// module, read from GET /api/labs/:labId/getting-started (same react-query key
// as the dashboard card, so one fetch serves both and they cannot disagree).
interface GettingStartedPayload {
  phases: Array<{ steps: Array<{ key: string; task: string; status: "done" | "todo" | "manual"; detail?: string }> }>;
}

// Maps a module key to its getting-started tutorial video stem in
// /public/tutorials/<stem>.mp4 (same-origin static asset, silent H.264).
// Keep in sync with the files in that folder (identity mapping). The
// productivity module keys as "veritapace" (its page lives at /veritabench).
const TUTORIAL_VIDEO: Record<string, string> = {
  veritamap: "veritamap", veritacheck: "veritacheck", veritascan: "veritascan",
  veritatrack: "veritatrack", veritapt: "veritapt", veritaops: "veritaops",
  veritacomp: "veritacomp", veritapolicy: "veritapolicy", veritastaff: "veritastaff",
  veritalab: "veritalab", veritaqc: "veritaqc", veritastock: "veritastock",
  veritaresponse: "veritaresponse", veritapace: "veritapace",
};

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
  const [videoFailed, setVideoFailed] = useState(false);
  const videoStem = TUTORIAL_VIDEO[moduleKey];
  const hasVideo = !!videoStem && !videoFailed;

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(lsKey) === "1") {
      setDismissed(true);
    }
  }, [lsKey]);

  // Lab-scoped pages carry the lab id in the path; legacy (unscoped) pages
  // render the card without a progress block.
  const labMatch = typeof window !== "undefined" ? window.location.pathname.match(/^\/labs\/(\d+)\//) : null;
  const labId = labMatch ? labMatch[1] : "";
  const stepKeys = stepKeysForModule(moduleKey);
  const gsUrl = labId && stepKeys.length > 0 ? `/api/labs/${labId}/getting-started` : "";
  const { data: gs } = useQuery<GettingStartedPayload>({ queryKey: [gsUrl], enabled: !!gsUrl });
  const progress = gs ? gs.phases.flatMap((p) => p.steps).filter((s) => stepKeys.includes(s.key)) : [];

  if (dismissed) return null;

  const accent = brandColor || "var(--primary, #01696F)";

  return (
    <div
      className="mb-4 rounded-lg border bg-card"
      style={{ borderColor: `${accent}33`, backgroundColor: `${accent}08` }}
      data-testid="module-howto-card"
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
          {hasVideo && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: accent }}>
                Getting started
              </div>
              <video
                controls
                playsInline
                preload="metadata"
                className="w-full rounded-md border"
                style={{ borderColor: `${accent}33` }}
                onError={() => setVideoFailed(true)}
              >
                <source src={`/tutorials/${videoStem}.mp4`} type="video/mp4" />
              </video>
            </div>
          )}
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
          {progress.length > 0 && (
            <div data-testid="module-howto-progress">
              <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: accent }}>
                Your progress
              </div>
              <ul className="space-y-1.5">
                {progress.map((s) => (
                  <li
                    key={s.key}
                    data-testid={`module-howto-step-${s.key}`}
                    data-status={s.status}
                    className="flex items-start gap-2 leading-relaxed"
                  >
                    {s.status === "done" ? (
                      <CheckCircle2 size={14} className="mt-1 shrink-0 text-green-700 dark:text-green-400" aria-label="Done" />
                    ) : (
                      <Circle size={14} className="mt-1 shrink-0 text-muted-foreground" aria-label="To do" />
                    )}
                    <div className="min-w-0">
                      <span className={s.status === "done" ? "text-muted-foreground line-through decoration-muted-foreground/60" : "text-foreground"}>
                        {s.task}
                      </span>
                      {s.detail && <div className="text-xs text-muted-foreground">{s.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
