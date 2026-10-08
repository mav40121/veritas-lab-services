import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, ArrowRight } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useToast } from "@/hooks/use-toast";

// In-app Getting Started card (parking lot #72, 2026-10-07, Michael option 1).
// Reads /api/labs/:labId/getting-started: the shared 6-phase system path with
// every step scored live from the lab's own tables (nothing derived is stored).
// The two Phase-5 steps are manual ticks (owner/admin). Auto-hides at 100
// percent, and a dismissed card leaves a one-line "Show getting started" link.

interface ScoredStep { key: string; task: string; who: string; kind: "derived" | "manual"; status: "done" | "todo" | "manual"; checked?: boolean; detail: string; href?: string }
interface Payload { labId: number; phases: Array<{ title: string; steps: ScoredStep[]; done: number; total: number }>; done: number; total: number; percent: number; dismissed: boolean }

export function GettingStartedCard({ className = "" }: { className?: string }) {
  const labId = useActiveLabId();
  const qc = useQueryClient();
  const { toast } = useToast();
  const url = labId ? `/api/labs/${labId}/getting-started` : "";
  const { data, isLoading } = useQuery<Payload>({ queryKey: [url], enabled: !!labId });
  const [openPhase, setOpenPhase] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const tick = useMutation({
    mutationFn: ({ key, checked }: { key: string; checked: boolean }) => apiRequest("POST", `/api/labs/${labId}/getting-started/check`, { key, checked }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [url] }),
    onError: (e: any) => toast({ title: "Could not update", description: e?.message || "Only the lab owner or an admin can tick a step.", variant: "destructive" }),
  });

  if (!labId || isLoading || !data) return null;

  const complete = data.percent >= 100;
  const hidden = (data.dismissed || complete) && !showHidden;
  if (hidden) {
    return (
      <div className={`text-xs text-muted-foreground ${className}`} data-testid="getting-started-hidden">
        {complete ? "Setup checklist complete." : "Getting started checklist hidden."}{" "}
        <button
          type="button"
          className="underline hover:text-foreground"
          onClick={() => {
            setShowHidden(true);
            // "An owner or admin can show it again" (the Hide tooltip): for them
            // this clears the saved dismissal, so the card stays back on the next
            // visit instead of hiding again. Anyone else (the server answers 403)
            // still sees it for this view, with no error toast.
            if (data.dismissed) {
              apiRequest("POST", `/api/labs/${labId}/getting-started/check`, { key: "card.dismissed", checked: false })
                .then(() => qc.invalidateQueries({ queryKey: [url] }))
                .catch(() => {});
            }
          }}
          data-testid="getting-started-show"
        >Show getting started</button>
      </div>
    );
  }

  // Default-open the first phase with something left to do.
  const firstOpen = data.phases.findIndex((p) => p.done < p.total);
  const open = openPhase ?? (firstOpen >= 0 ? firstOpen : 0);

  return (
    <div className={`rounded-lg border bg-card ${className}`} data-testid="getting-started-card">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold" data-testid="getting-started-summary">
            Getting started: {data.done} of {data.total} done
          </div>
          <div className="mt-1.5 h-1.5 w-56 max-w-full rounded bg-muted overflow-hidden" aria-hidden>
            <div className="h-full bg-primary" style={{ width: `${data.percent}%` }} />
          </div>
        </div>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground p-1 ml-2 shrink-0"
          aria-label="Hide the getting started card"
          title="Hide (an owner or admin can show it again)"
          data-testid="getting-started-dismiss"
          onClick={() => { setShowHidden(false); tick.mutate({ key: "card.dismissed", checked: true }); }}
        >
          <X size={14} />
        </button>
      </div>
      <div className="px-4 pb-3 space-y-1">
        {data.phases.map((p, i) => (
          <div key={p.title} className="rounded-md border" data-testid={`getting-started-phase-${i + 1}`}>
            <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-left text-sm" onClick={() => setOpenPhase(open === i ? -1 : i)}>
              <span className="font-medium">{p.title}</span>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {p.done} / {p.total}
                {open === i ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </span>
            </button>
            {open === i && (
              <ul className="px-3 pb-2 space-y-1.5">
                {p.steps.map((s) => {
                  const isDone = s.status === "done" || (s.status === "manual" && s.checked);
                  return (
                    <li key={s.key} className="flex items-start gap-2 text-sm" data-testid={`getting-started-step-${s.key}`} data-status={isDone ? "done" : "todo"}>
                      {s.kind === "manual" ? (
                        <input
                          type="checkbox"
                          className="mt-1 h-3.5 w-3.5"
                          checked={!!s.checked}
                          onChange={(e) => tick.mutate({ key: s.key, checked: e.target.checked })}
                          aria-label={s.task}
                          data-testid={`getting-started-tick-${s.key}`}
                        />
                      ) : isDone ? (
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                      ) : (
                        <Circle size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className={isDone ? "text-muted-foreground line-through" : ""}>{s.task}</div>
                        <div className="text-[11px] text-muted-foreground">{s.who}. {s.detail}</div>
                      </div>
                      {!isDone && s.href && (
                        <Link href={s.href} className="shrink-0 text-xs text-primary inline-flex items-center gap-0.5 hover:underline" data-testid={`getting-started-go-${s.key}`}>
                          Go <ArrowRight size={12} />
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
