// client/src/components/CompetencyNontechnicalFrequencyCard.tsx
//
// VeritaComp "Non-technical competency frequency" (Michael 2026-11-04, "The sites shoudl be able to set frequency", go Q216 = 1,
// 2026-11-06). One setting per lab. Blank is what every lab has today: non-technical records have no due date. Set, each person on
// each non-technical program comes due that many months after their last signed, passing record, and the reminder emails follow.
// Only the lab's owner or an admin can change it; everyone else who opens this page sees it read-only.
//   GET/PUT /api/labs/:labId/competency/nontechnical-frequency, GET /api/labs/:labId/competency/nontechnical-due
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { fmtDate } from "@/lib/competencyElements";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarClock, Loader2 } from "lucide-react";
import {
  NONTECHNICAL_FREQUENCY_MONTHS, NONTECHNICAL_FREQUENCY_NOT_SET, nontechnicalFrequencyLabel,
  type NontechnicalDueItem, type NontechnicalDueResponse,
} from "@shared/competencyNontechnicalFrequency";

const getJson = async (url: string) => {
  const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

export function useNontechnicalFrequency(enabled = true) {
  const activeLabId = useActiveLabId();
  const url = activeLabId ? `/api/labs/${activeLabId}/competency/nontechnical-frequency` : null;
  return useQuery<{ months: number | null; canEdit: boolean }>({ queryKey: [url ?? "no-nt-frequency"], enabled: enabled && !!url, queryFn: () => getJson(url!) });
}

export function useNontechnicalDue(enabled = true) {
  const activeLabId = useActiveLabId();
  const url = activeLabId ? `/api/labs/${activeLabId}/competency/nontechnical-due` : null;
  return useQuery<NontechnicalDueResponse>({ queryKey: [url ?? "no-nt-due"], enabled: enabled && !!url, queryFn: () => getJson(url!) });
}

/** The words for one person's due date, on this card, a program's roster and a Staff login's own page. */
export function nontechnicalDueText(i: NontechnicalDueItem): string {
  if (i.remediationOpen) return "Reassessment due";
  return i.bucket === "overdue" ? `Overdue, due ${fmtDate(i.nextDue)}` : `Due ${fmtDate(i.nextDue)}`;
}
export const nontechnicalDueClass = (i: NontechnicalDueItem): string =>
  i.bucket === "overdue" ? "text-rose-700 dark:text-rose-300" : i.bucket === "compliant" ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300";

function DueList({ due }: { due: NontechnicalDueResponse }) {
  const activeLabId = useActiveLabId();
  const { items, counts } = due;
  const soon = items.filter((i) => i.bucket !== "compliant");
  if (!items.length) {
    return <p className="text-xs text-muted-foreground" data-testid="nt-due-none">No signed, passing non-technical record is on file yet, so nobody has a due date.</p>;
  }
  return (
    <div className="space-y-2 pt-1" data-testid="nt-due-list">
      <p className="text-xs" data-testid="nt-due-counts">
        <span className={counts.overdue ? "font-medium text-rose-700 dark:text-rose-300" : "text-muted-foreground"}>{counts.overdue} overdue</span>
        <span className="text-muted-foreground"> {"·"} </span>
        <span className={counts.dueSoon ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>{counts.dueSoon} due in the next 90 days</span>
        <span className="text-muted-foreground"> {"·"} {counts.current} current</span>
      </p>
      {soon.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {soon.map((i) => (
            <Link key={`${i.programId}:${i.employeeId}`} href={activeLabId ? `/labs/${activeLabId}/veritacomp-app/${i.programId}` : `/veritacomp-app/${i.programId}`}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-2 hover:bg-muted/40 transition-colors" data-testid="nt-due-row">
              <span className="min-w-0 text-xs">
                <span className="font-medium">{i.name}</span>
                <span className="text-muted-foreground"> {"·"} {i.programName}</span>
              </span>
              <span className={`text-xs shrink-0 ${nontechnicalDueClass(i)}`}>{nontechnicalDueText(i)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function CompetencyNontechnicalFrequencyCard() {
  const activeLabId = useActiveLabId();
  const readOnly = useIsReadOnly("veritacomp");
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useNontechnicalFrequency();
  const { data: due } = useNontechnicalDue();
  const url = activeLabId ? `/api/labs/${activeLabId}/competency/nontechnical-frequency` : null;
  const [months, setMonths] = useState<string>("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { setMonths(data?.months ? String(data.months) : ""); }, [data?.months]);
  const dirty = (data?.months ? String(data.months) : "") !== months;
  const canChange = !!data?.canEdit && !readOnly;

  const save = async () => {
    if (!url) return;
    setSaving(true);
    try {
      const r = await fetch(`${API_BASE}${url}`, {
        method: "PUT", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ months: months ? Number(months) : null }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      toast({
        title: d.months ? `Non-technical competency: ${nontechnicalFrequencyLabel(d.months).toLowerCase()}` : "Non-technical frequency cleared",
        description: d.months
          ? `${d.counts.overdue} overdue, ${d.counts.dueSoon} due in the next 90 days. No record was changed.`
          : "Non-technical records have no due date. No record was changed.",
      });
      qc.invalidateQueries();
    } catch (e: any) {
      toast({ title: "Could not save", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card data-testid="nt-frequency-card">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-primary shrink-0" />
            <span className="font-semibold text-sm">Non-technical competency frequency</span>
            <span className="text-xs text-muted-foreground">(optional)</span>
          </div>
          {canChange ? (
            <div className="flex items-center gap-2">
              <select className="h-8 text-xs rounded-md border bg-background px-2" value={months} onChange={(e) => setMonths(e.target.value)} data-testid="nt-frequency-select" aria-label="Non-technical competency frequency">
                <option value="">{NONTECHNICAL_FREQUENCY_NOT_SET}</option>
                {NONTECHNICAL_FREQUENCY_MONTHS.map((m) => <option key={m} value={String(m)}>{nontechnicalFrequencyLabel(m)}</option>)}
              </select>
              <Button size="sm" onClick={save} disabled={!dirty || saving} data-testid="nt-frequency-save">
                {saving && <Loader2 className="animate-spin mr-1" size={12} />} Save
              </Button>
            </div>
          ) : (
            data && <span className="text-xs font-medium" data-testid="nt-frequency-value">{nontechnicalFrequencyLabel(data.months)}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed" data-testid="nt-frequency-help">
          Your laboratory sets how often non-technical competency comes due. The current TJC standard requires non-technical competency
          every 2 years; other accrediting bodies do not. Each person's due date runs from their last signed, passing record on each
          non-technical program, and reminders follow it. No record on file is changed. Technical and waived competency timing and new-hire
          evaluations do not change.
        </p>
        {data && !data.canEdit && (
          <p className="text-xs text-muted-foreground" data-testid="nt-frequency-readonly">Only the lab's owner or an admin can change this.</p>
        )}
        {data?.months && due ? <DueList due={due} /> : null}
      </CardContent>
    </Card>
  );
}
