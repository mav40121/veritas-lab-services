// PTSamplePickerDialog
//
// Wave I PR I3 (2026-06-06). Opens from the Element 5 row of the
// VeritaComp New Assessment dialog. Lists the lab's recent pt_events
// filtered loosely by the program's method-group analytes, so the lab
// director picks a real recorded PT event instead of typing the sample
// id, date, and acceptable status by hand.
//
// Schema reality (called out in the PR description too): pt_events are
// NOT attributed per testing personnel — the table has user_id (lab
// owner) but no employee_id. The picker shows lab-level events; the
// director picks which one was run by the employee being assessed.
//
// Reg context: 42 CFR §493.1235(a)(5) is the Element 5 requirement
// (blind / PT sample performance). The PT report is the supporting
// record; the picker just makes recording WHICH event easier.

import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";

export type PTSample = {
  id: number;
  eventId: string | null;
  eventName: string | null;
  eventDate: string;
  analyte: string;
  yourResult: number | null;
  yourMethod: string | null;
  acceptableLow: number | null;
  acceptableHigh: number | null;
  sdi: number | null;
  passFail: string;
  suggestedSampleType: string;
  suggestedSampleId: string;
  suggestedAcceptable: 0 | 1 | null;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  labId: number | null;
  programId: number;
  onSelect: (sample: PTSample) => void;
}

export function PTSamplePickerDialog({ open, onOpenChange, labId, programId, onSelect }: Props) {
  const url = (open && labId) ? `/api/labs/${labId}/veritacomp/programs/${programId}/pt-samples` : null;
  const { data: samples = [], isLoading } = useQuery<PTSample[]>({
    queryKey: [url ?? "no-pt-samples"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!url,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import PT sample from VeritaPT</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground mb-3">
          Recent PT events for this lab, filtered to analytes used by this program. Click Select to populate Element 5 with the chosen event's identifiers. Reg anchor: 42 CFR §493.1235(a)(5).
        </div>
        {isLoading && (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading PT events...</div>
        )}
        {!isLoading && samples.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No matching PT events on file in VeritaPT for this program's analytes (last 18 months). Record PT results in VeritaPT first, or fill Element 5 manually.
          </div>
        )}
        {!isLoading && samples.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 pr-3 font-medium">Date</th>
                  <th className="text-left py-2 pr-3 font-medium">Event</th>
                  <th className="text-left py-2 pr-3 font-medium">Analyte</th>
                  <th className="text-left py-2 pr-3 font-medium">Result</th>
                  <th className="text-left py-2 pr-3 font-medium">Pass / Fail</th>
                  <th className="text-right py-2 pr-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {samples.map(s => {
                  const passBadge = s.passFail === "pass" ? "text-emerald-700 bg-emerald-500/10 border-emerald-500/30" :
                    s.passFail === "fail" ? "text-red-700 bg-red-500/10 border-red-500/30" :
                    "text-amber-700 bg-amber-500/10 border-amber-500/30";
                  return (
                    <tr key={s.id} className="border-b border-border/40">
                      <td className="py-2 pr-3 font-mono">{s.eventDate}</td>
                      <td className="py-2 pr-3">
                        <div className="font-medium truncate max-w-[200px]">{s.eventName || s.eventId || `event #${s.id}`}</div>
                        {s.eventId && s.eventName && (
                          <div className="text-[10px] text-muted-foreground truncate">{s.eventId}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3">{s.analyte}</td>
                      <td className="py-2 pr-3 font-mono text-xs">
                        {s.yourResult != null ? s.yourResult : ""}
                        {s.yourMethod ? <div className="text-[10px] text-muted-foreground">{s.yourMethod}</div> : null}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge className={`text-[10px] border ${passBadge}`}>
                          {s.passFail === "pass" ? "Pass" : s.passFail === "fail" ? "Fail" : s.passFail}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            onSelect(s);
                            onOpenChange(false);
                          }}
                        >
                          Select
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
