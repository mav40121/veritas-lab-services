// PriorYearComparisonDialog
//
// Wave I PR I2 (2026-06-06). Opens from any VeritaComp assessment card.
// Shows the employee's prior assessments for the same program with a
// per-element pass/fail/N-A summary, so a lab director signing off on
// this year's assessment sees the year-over-year delta at the moment
// of sign-off.
//
// Reg context: 42 CFR §493.1235(b) expects the lab director to track
// patterns over time, not just point-in-time. "Element 3 went from Pass
// last year to Fail this year on the same QC instrument" is the kind
// of regression this dialog surfaces inline.

import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";

type ElementStatus = "pass" | "fail" | "na" | "none";

type PriorAssessment = {
  id: number;
  date: string;
  type: string;
  status: string;
  evaluatorName: string | null;
  locked: boolean;
  elements: Record<string, { status: ElementStatus; observer: string | null }>;
};

type ComparisonResponse = {
  current: { id: number; date: string; status: string };
  priors: PriorAssessment[];
};

const ELEMENT_LABELS: Record<string, string> = {
  "1": "E1 (Direct Obs)",
  "2": "E2 (Monitor / Report)",
  "3": "E3 (QC)",
  "4": "E4 (Instrument Obs)",
  "5": "E5 (Blind / PT)",
  "6": "E6 (Problem-solve)",
};

function ElementCell({ status, observer }: { status: ElementStatus; observer: string | null }) {
  if (status === "pass") {
    return <Badge className="text-[10px] border bg-emerald-500/10 text-emerald-700 border-emerald-500/30">Pass{observer ? ` (${observer})` : ""}</Badge>;
  }
  if (status === "fail") {
    return <Badge className="text-[10px] border bg-red-500/10 text-red-700 border-red-500/30">Fail{observer ? ` (${observer})` : ""}</Badge>;
  }
  if (status === "na") {
    return <Badge variant="outline" className="text-[10px] text-muted-foreground">N/A</Badge>;
  }
  return <span className="text-[10px] text-muted-foreground">.</span>;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assessmentId: number;
  labId: number | null;
  employeeName: string;
  programName: string;
}

export function PriorYearComparisonDialog({ open, onOpenChange, assessmentId, labId, employeeName, programName }: Props) {
  const url = (open && labId) ? `/api/labs/${labId}/competency/assessments/${assessmentId}/prior-year-comparison` : null;
  const { data, isLoading } = useQuery<ComparisonResponse>({
    queryKey: [url ?? "no-prior-year"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    enabled: !!url,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Prior-year comparison</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground mb-3">
          {employeeName} on {programName}. Up to 5 prior assessments for the same program.
        </div>
        {isLoading && (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading prior assessments...</div>
        )}
        {!isLoading && data && data.priors.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No prior assessments on file for this employee on this program. This is the baseline.
          </div>
        )}
        {!isLoading && data && data.priors.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3 font-medium">Date</th>
                  <th className="text-left py-2 pr-3 font-medium">Type</th>
                  <th className="text-left py-2 pr-3 font-medium">Result</th>
                  {Object.keys(ELEMENT_LABELS).map(n => (
                    <th key={n} className="text-left py-2 pr-2 font-medium whitespace-nowrap">{ELEMENT_LABELS[n]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.priors.map(p => {
                  const resultBadge = p.status === "pass" ? "text-emerald-700 bg-emerald-500/10 border-emerald-500/30" :
                    p.status === "fail" ? "text-red-700 bg-red-500/10 border-red-500/30" :
                    "text-amber-700 bg-amber-500/10 border-amber-500/30";
                  return (
                    <tr key={p.id} className="border-b border-border/40">
                      <td className="py-2 pr-3 font-mono text-xs">{p.date}</td>
                      <td className="py-2 pr-3 text-xs">{p.type.replace("_", " ")}</td>
                      <td className="py-2 pr-3">
                        <Badge className={`text-[10px] border ${resultBadge}`}>
                          {p.status === "pass" ? "Pass" : p.status === "fail" ? "Fail" : "Remediation"}
                        </Badge>
                      </td>
                      {Object.keys(ELEMENT_LABELS).map(n => {
                        const e = p.elements[n] || { status: "none" as ElementStatus, observer: null };
                        return (
                          <td key={n} className="py-2 pr-2">
                            <ElementCell status={e.status} observer={e.observer} />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="text-[10px] text-muted-foreground mt-3">
              Cite: 42 CFR §493.1235(b) (lab director tracks patterns over time). E1 / E4 cells include the prior observer's initials when recorded.
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
