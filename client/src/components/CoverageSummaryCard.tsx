import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListChecks, ArrowRight, GitCompareArrows, Ruler, CheckCircle2 } from "lucide-react";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";

// Live VeritaCheck Coverage summary, promoted to the top of the dashboard so the
// single most valuable view (what your VeritaMap requires vs. the studies you
// have) is the first thing a lab sees instead of a buried toolbar button. Reads
// the same GET /api/labs/:id/veritacheck/coverage the Coverage page uses.
interface CoverageSummary {
  hasMap: boolean;
  summary?: {
    combos: number;
    instruments: number;
    analytes: number;
    studies: number;
    linearityRequired: number;
    linearityCovered: number;
    linearityMissing: number;
    linearityReview: number;
    methodComparisonsNeeded: number;
    methodComparisonsDone: number;
  };
}

function Stat({ icon, label, done, total, gapLabel }: { icon: React.ReactNode; label: string; done: number; total: number; gapLabel: string }) {
  const gap = Math.max(0, total - done);
  const tone = gap === 0 ? "text-emerald-600" : "text-amber-600";
  return (
    <div className="flex items-start gap-2.5">
      <div className={`mt-0.5 ${gap === 0 ? "text-emerald-600" : "text-primary"}`}>{icon}</div>
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold leading-tight">
          {done}<span className="text-muted-foreground font-normal">/{total}</span>
        </div>
        <div className={`text-xs ${tone}`}>{gap === 0 ? "all covered" : `${gap} ${gapLabel}`}</div>
      </div>
    </div>
  );
}

export function CoverageSummaryCard({ className }: { className?: string }) {
  const labId = useActiveLabId();
  const labRoute = useLabRoute();
  const url = labId ? `/api/labs/${labId}/veritacheck/coverage` : null;
  const { data } = useQuery<CoverageSummary>({ queryKey: [url], enabled: !!url });

  // Only show once the lab has a map to measure against; otherwise there is
  // nothing to cover and the card would read as an empty scold.
  if (!data || !data.hasMap || !data.summary) return null;
  const s = data.summary;
  const mcGap = Math.max(0, s.methodComparisonsNeeded - s.methodComparisonsDone);
  const clGap = s.linearityMissing + s.linearityReview;
  const allClear = mcGap === 0 && clGap === 0;

  return (
    <Card className={`border-primary/30 bg-primary/[0.03] ${className || ""}`} data-testid="card-coverage-summary">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <div className="flex items-start gap-2.5 sm:min-w-[16rem]">
            <ListChecks size={18} className="text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-sm flex items-center gap-2">
                Coverage
                {allClear && <CheckCircle2 size={14} className="text-emerald-600" />}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                What your VeritaMap requires versus the studies you have. {s.analytes} analytes across {s.instruments} instruments.
              </p>
            </div>
          </div>

          <div className="flex flex-1 flex-wrap gap-6">
            <Stat
              icon={<GitCompareArrows size={16} />}
              label="Method comparisons"
              done={s.methodComparisonsDone}
              total={s.methodComparisonsNeeded}
              gapLabel="to correlate"
            />
            <Stat
              icon={<Ruler size={16} />}
              label="Cal-Ver / Linearity"
              done={s.linearityCovered}
              total={s.linearityRequired}
              gapLabel="to review or add"
            />
          </div>

          <Button asChild size="sm" className="shrink-0 gap-1.5" data-testid="button-open-coverage">
            <Link href={labRoute("/veritacheck/coverage")}>
              Open Coverage
              <ArrowRight size={14} />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
