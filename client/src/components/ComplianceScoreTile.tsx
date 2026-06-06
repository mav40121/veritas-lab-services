// ComplianceScoreTile
//
// Wave J PR J4 (2026-06-06). Headline compliance score for the lab
// shown on the lab-scoped dashboard. Aggregates five signals that
// already ship as individual tiles (competency current, credentials
// current, reassessments resolved, position descriptions on file,
// duty-change events resolved), equal weight, into a single 0-100
// percentage with a colored band.
//
// Click expands an inline drill-down panel showing per-program scores
// ranked worst-first so the lab director sees which program is
// dragging the average.
//
// Reg framing: this is a lab-management aid, not a regulatory verdict.
// Each underlying signal anchors to its own §493 cite via the
// individual tiles; this tile carries no new regulatory claim. The
// footer says so.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Gauge } from "lucide-react";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";

type ScoreResponse = {
  overall: number;
  band: "green" | "amber" | "red";
  signals: {
    competencyCurrent: number;
    credentialsCurrent: number;
    reassessmentsResolved: number;
    positionDescriptionsOnFile: number;
    dutyChangesResolved: number;
  };
  counts: {
    activeTestingEmployees: number;
    trackedCredentials: number;
    evaluatedPairs: number;
    positionDescriptionsOnFile: number;
    dutyChangeEvents: number;
  };
  perProgram: Array<{
    programId: number;
    name: string;
    score: number;
    competencyCurrent: number;
    reassessmentsResolved: number;
  }>;
};

function bandTone(band: "green" | "amber" | "red"): string {
  if (band === "green") return "text-emerald-700 bg-emerald-500/10 border-emerald-500/30";
  if (band === "amber") return "text-amber-700 bg-amber-500/10 border-amber-500/30";
  return "text-red-700 bg-red-500/10 border-red-500/30";
}
function scoreColor(pct: number): string {
  if (pct >= 90) return "text-emerald-700";
  if (pct >= 75) return "text-amber-700";
  return "text-red-700";
}

const SIGNAL_LABELS: Array<{ key: keyof ScoreResponse["signals"]; label: string; reg: string }> = [
  { key: "competencyCurrent", label: "Competency current", reg: "§493.1235(a)" },
  { key: "credentialsCurrent", label: "Credentials current", reg: "TJC HR.01.02.01" },
  { key: "reassessmentsResolved", label: "Reassessments resolved", reg: "§493.1235(b)(7)" },
  { key: "positionDescriptionsOnFile", label: "Position descriptions on file", reg: "§493.1235(b)(7)" },
  { key: "dutyChangesResolved", label: "Duty-change events resolved", reg: "§493.1235(a)" },
];

export function ComplianceScoreTile({ className = "" }: { className?: string }) {
  const activeLabId = useActiveLabId();
  const [expanded, setExpanded] = useState(false);
  const url = activeLabId ? `/api/labs/${activeLabId}/compliance/score` : null;
  const { data, isLoading } = useQuery<ScoreResponse>({
    queryKey: [url ?? "no-compliance-score"],
    queryFn: async () => {
      if (!url) throw new Error("no lab");
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!url,
  });

  if (!activeLabId) return null;
  if (isLoading) return null;
  if (!data) return null;
  // Self-hide when nothing is on file at all (no employees, no
  // credentials, no programs, no PDs, no duty-change events). The
  // headline score would always be 100% on a brand-new lab and the
  // tile would be noise.
  const totalSignal =
    data.counts.activeTestingEmployees +
    data.counts.trackedCredentials +
    data.counts.evaluatedPairs +
    data.counts.positionDescriptionsOnFile +
    data.counts.dutyChangeEvents;
  if (totalSignal === 0) return null;

  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Gauge size={16} className="text-primary" />
            <h3 className="font-semibold">Compliance Score</h3>
            <span className="text-xs text-muted-foreground">equal-weight roll-up of 5 signals</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUp size={12} className="mr-1" /> : <ChevronDown size={12} className="mr-1" />}
            {expanded ? "Hide" : "Drill down"}
          </Button>
        </div>
        <div className="flex items-center gap-4">
          <div className={`rounded-md border px-4 py-3 ${bandTone(data.band)}`}>
            <div className="text-xs font-medium">Overall</div>
            <div className="text-4xl font-bold leading-tight">{data.overall}%</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 flex-1">
            {SIGNAL_LABELS.map(({ key, label }) => {
              const pct = data.signals[key];
              return (
                <div key={key} className="rounded border border-border px-2 py-1.5">
                  <div className="text-[10px] text-muted-foreground truncate">{label}</div>
                  <div className={`text-lg font-bold leading-tight ${scoreColor(pct)}`}>{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>

        {expanded && (
          <div className="mt-4 border-t border-border pt-3 space-y-3">
            {/* Signal cite list */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Signal reg anchors
              </div>
              <ul className="space-y-0.5 text-xs">
                {SIGNAL_LABELS.map(({ key, label, reg }) => (
                  <li key={key} className="flex justify-between gap-2">
                    <span>{label}</span>
                    <span className="text-muted-foreground font-mono">{reg} : {data.signals[key]}%</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Per-program drill-down */}
            {data.perProgram.length > 0 && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                  Per-program (worst-first, A + C only — B/D/E are lab-level)
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-1 pr-2 font-medium">Program</th>
                      <th className="text-right py-1 pr-2 font-medium">Score</th>
                      <th className="text-right py-1 pr-2 font-medium">Competency</th>
                      <th className="text-right py-1 pr-2 font-medium">Reassessment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perProgram.map((p) => (
                      <tr key={p.programId} className="border-b border-border/40">
                        <td className="py-1 pr-2 truncate max-w-[260px]">{p.name}</td>
                        <td className={`py-1 pr-2 text-right font-bold ${scoreColor(p.score)}`}>{p.score}%</td>
                        <td className="py-1 pr-2 text-right">{p.competencyCurrent}%</td>
                        <td className="py-1 pr-2 text-right">{p.reassessmentsResolved}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="text-[10px] text-muted-foreground pt-1">
              Lab-management aid, not a regulatory verdict. Each signal's reg anchor is in the row above; the headline is the simple average of all five.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
