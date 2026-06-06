// AuditTrailDialog
//
// Wave J PR J3 (2026-06-06). Opens from any VeritaComp assessment card.
// Lists the audit_log rows scoped to that assessment with actor,
// action, timestamp, and a compact before/after diff so a surveyor's
// "who modified this assessment after it was signed, and when" question
// gets a one-click answer.
//
// Honest coverage note rendered in the footer: only sign / unlock /
// delete actions are instrumented as of this PR. Create + per-field
// updates land in a follow-up.

import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";

type AuditRow = {
  id: number;
  user_id: number;
  module: string;
  action: string;
  entity_type: string;
  entity_label: string | null;
  before_json: string | null;
  after_json: string | null;
  ip_address: string | null;
  created_at: string;
  actor_email: string | null;
  actor_lab: string | null;
};

function tryParse(s: string | null): any {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function renderDiff(before: any, after: any): string {
  if (!before && !after) return "";
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after || {}),
  ]);
  const lines: string[] = [];
  for (const k of keys) {
    const a = before ? before[k] : undefined;
    const b = after ? after[k] : undefined;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const aStr = a === undefined ? "(unset)" : a === null ? "null" : JSON.stringify(a);
    const bStr = b === undefined ? "(unset)" : b === null ? "null" : JSON.stringify(b);
    lines.push(`${k}: ${aStr} -> ${bStr}`);
  }
  return lines.join("\n");
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assessmentId: number;
  labId: number | null;
  employeeName: string;
  programName: string;
}

export function AuditTrailDialog({ open, onOpenChange, assessmentId, labId, employeeName, programName }: Props) {
  const url = (open && labId)
    ? `/api/labs/${labId}/competency/assessments/${assessmentId}/audit-log`
    : null;
  const { data: rows = [], isLoading } = useQuery<AuditRow[]>({
    queryKey: [url ?? "no-audit"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!url,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Audit trail</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-muted-foreground mb-3">
          {employeeName} on {programName}. Up to 100 most-recent entries.
        </div>
        {isLoading && (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading audit log...</div>
        )}
        {!isLoading && rows.length === 0 && (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No audit entries on file for this assessment. Sign, unlock, and delete actions land in the log as they happen.
          </div>
        )}
        {!isLoading && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map(r => {
              const before = tryParse(r.before_json);
              const after = tryParse(r.after_json);
              const diff = renderDiff(before, after);
              const actor = r.actor_email || `user_id ${r.user_id}`;
              const tag = r.entity_label || r.action;
              const actionTone = r.action === "delete" ? "text-red-700 bg-red-500/10 border-red-500/30" :
                r.action === "update" ? "text-amber-700 bg-amber-500/10 border-amber-500/30" :
                "text-blue-700 bg-blue-500/10 border-blue-500/30";
              return (
                <div key={r.id} className="border border-border rounded-md p-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2">
                      <Badge className={`text-[10px] border ${actionTone}`}>{tag}</Badge>
                      <span className="text-xs font-medium">{actor}</span>
                      {r.ip_address && (
                        <span className="text-[10px] text-muted-foreground font-mono">{r.ip_address}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">{r.created_at.replace("T", " ").split(".")[0]}</span>
                  </div>
                  {diff && (
                    <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap font-mono leading-snug mt-1">{diff}</pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="text-[10px] text-muted-foreground mt-4 border-t border-border pt-2">
          Coverage: sign, unlock, and delete actions are instrumented as of this release. Create and per-field updates land in a follow-up. Reg anchor: 42 CFR §493.1235(b) (lab director documents personnel actions over time).
        </div>
      </DialogContent>
    </Dialog>
  );
}
