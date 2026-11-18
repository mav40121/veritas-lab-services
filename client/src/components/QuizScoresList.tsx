// client/src/components/QuizScoresList.tsx
//
// Quiz scores (Michael 2026-11-17, Q347 = 1: "it is difficult to find peoples quiz scores"). Every scored quiz in the lab,
// newest first, from GET /api/labs/:labId/competency/quiz-scores: assigned quizzes taken on a staff login, quizzes given on a
// record, and scores typed on Element 6. Filters by person, quiz, result and date, and Download Excel of the rows shown
// (the server filters with the same shared/quizScores.ts filterQuizScores). Used by the Quiz scores page (the whole lab, or a
// Staff login's own) and the person page (one person: staffEmployeeId, no person filter).
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { API_BASE, responseErrorText } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fmtDate } from "@/lib/competencyElements";
import { labTodayIso } from "@/lib/labDate";
import {
  filterQuizScores, personKey, quizScoreChoices, RESULT_LABEL, SOURCE_LABEL,
  type QuizScoreFilters, type QuizScoreRow,
} from "@shared/quizScores";

const RESULT_CLS: Record<QuizScoreRow["result"], string> = {
  pass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  fail: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  not_marked: "bg-muted text-muted-foreground",
  voided: "bg-muted text-muted-foreground border border-dashed border-muted-foreground/50",
};
const selectCls = "h-8 text-xs rounded-md border bg-background px-2 max-w-full";

export function QuizScoresList({ labId, staffEmployeeId, compact = false, heading }: { labId: number; staffEmployeeId?: number; compact?: boolean; heading?: string }) {
  const { toast } = useToast();
  const url = `/api/labs/${labId}/competency/quiz-scores${staffEmployeeId != null ? `?staffEmployeeId=${staffEmployeeId}` : ""}`;
  const { data, isLoading, error } = useQuery<{ own_only: boolean; rows: QuizScoreRow[] }, Error & { status?: number }>({
    queryKey: [url],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) { const e: any = new Error(await responseErrorText(r)); e.status = r.status; throw e; }
      return r.json();
    },
    retry: false,
  });
  const rows = data?.rows || [];
  const ownOnly = !!data?.own_only;
  const onePerson = staffEmployeeId != null || ownOnly;
  const choices = useMemo(() => quizScoreChoices(rows), [rows]);
  const [f, setF] = useState<QuizScoreFilters>({});
  const set = (k: keyof QuizScoreFilters, v: string) => setF((p) => ({ ...p, [k]: v || undefined }));
  const shown = filterQuizScores(rows, f);
  const filtered = shown.length !== rows.length;
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      const qs = new URLSearchParams();
      if (staffEmployeeId != null) qs.set("staffEmployeeId", String(staffEmployeeId));
      for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
      const res = await fetch(`${API_BASE}/api/labs/${labId}/competency/quiz-scores/export.xlsx${qs.toString() ? `?${qs}` : ""}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await responseErrorText(res));
      const blob = await res.blob();
      const named = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1];
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = named || `VeritaComp_Quiz_Scores_${labTodayIso()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (err: any) {
      toast({ title: "Could not download quiz scores", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  }

  // The person page shows its section only to someone who may read it; a view-only seat gets nothing there.
  if (compact && error && (error as any).status === 403) return null;
  const personHref = (r: QuizScoreRow) => (r.staff_employee_id != null ? `/labs/${labId}/veritacomp-app/employee/${r.staff_employee_id}` : null);

  return (
    <div className="space-y-3" data-testid="quiz-scores">
      {heading && <h2 className="text-base font-semibold" data-testid="quiz-scores-heading">{heading}</h2>}
      <div className="flex flex-wrap items-end gap-2" data-testid="quiz-scores-filters">
        {!onePerson && (
          <select className={selectCls} value={f.person || ""} onChange={(e) => set("person", e.target.value)} aria-label="Person" data-testid="quiz-scores-person">
            <option value="">All people</option>
            {choices.people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        )}
        <select className={selectCls} value={f.quiz || ""} onChange={(e) => set("quiz", e.target.value)} aria-label="Quiz" data-testid="quiz-scores-quiz">
          <option value="">All quizzes</option>
          {choices.quizzes.map((q) => <option key={q} value={q}>{q}</option>)}
        </select>
        <select className={selectCls} value={f.result || ""} onChange={(e) => set("result", e.target.value)} aria-label="Result" data-testid="quiz-scores-result">
          <option value="">All results</option>
          {(Object.keys(RESULT_LABEL) as Array<QuizScoreRow["result"]>).map((k) => <option key={k} value={k}>{RESULT_LABEL[k]}</option>)}
        </select>
        <label className="text-[10px] text-muted-foreground flex flex-col">Taken from
          <Input type="date" className="h-8 text-xs w-[140px]" value={f.from || ""} onChange={(e) => set("from", e.target.value)} data-testid="quiz-scores-from" />
        </label>
        <label className="text-[10px] text-muted-foreground flex flex-col">to
          <Input type="date" className="h-8 text-xs w-[140px]" value={f.to || ""} onChange={(e) => set("to", e.target.value)} data-testid="quiz-scores-to" />
        </label>
        <Button size="sm" variant="outline" className="h-8 text-xs ml-auto" onClick={download} disabled={downloading || !data || shown.length === 0} data-testid="quiz-scores-download">
          <Download size={14} className="mr-1" /> {downloading ? "Preparing..." : "Download Excel"}
        </Button>
      </div>

      {isLoading && <div className="text-sm text-muted-foreground py-6 text-center">Loading...</div>}
      {error && <div className="text-sm text-red-600" data-testid="quiz-scores-error">{error.message || "Could not load quiz scores."}</div>}
      {data && (
        <p className="text-xs text-muted-foreground" data-testid="quiz-scores-count">
          {filtered ? `${shown.length} of ${rows.length} quiz scores` : `${rows.length} quiz ${rows.length === 1 ? "score" : "scores"}`}
        </p>
      )}
      {data && rows.length === 0 && (
        <Card><CardContent className="p-5 text-sm text-muted-foreground" data-testid="quiz-scores-empty">
          {onePerson
            ? "No quiz scores yet. A score appears here once a quiz is taken, or once a score is entered on Element 6."
            : "No quiz scores in this lab yet. A score appears here once someone takes an assigned quiz, an evaluator gives a quiz on a record, or a score is entered on Element 6."}
        </CardContent></Card>
      )}

      <div className="space-y-1.5">
        {shown.map((r) => {
          const href = !onePerson ? personHref(r) : null;
          const person = (
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{r.person_name}</div>
              {r.person_title && <div className="text-[11px] text-muted-foreground truncate">{r.person_title}</div>}
            </div>
          );
          return (
            <div key={r.key} data-testid="quiz-score-row" data-person={personKey(r)} data-result={r.result}
              // Fixed tracks (minmax(0, fr) and a set width for the score) so every row's columns line up whatever they hold.
              className={`grid grid-cols-[minmax(0,1fr)_auto] ${onePerson ? "sm:grid-cols-[96px_minmax(0,1.6fr)_minmax(0,1fr)_132px]" : "sm:grid-cols-[96px_minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)_132px]"} items-center gap-x-3 gap-y-0.5 rounded-md border p-3`}>
              <div className="text-xs font-medium order-2 sm:order-none col-span-2 sm:col-span-1 text-muted-foreground sm:text-foreground">{r.date_taken ? fmtDate(r.date_taken) : "No date"}</div>
              {!onePerson && (href
                ? <Link href={href} className="order-1 sm:order-none hover:underline" data-testid="quiz-score-person">{person}</Link>
                : <div className="order-1 sm:order-none">{person}</div>)}
              <div className="min-w-0 order-3 sm:order-none col-span-2 sm:col-span-1">
                <div className="text-sm truncate" data-testid="quiz-score-quiz">{r.quiz_title}</div>
                {r.covers && r.covers !== r.quiz_title && <div className="text-[11px] text-muted-foreground truncate">{r.covers}</div>}
              </div>
              <div className="text-xs text-muted-foreground order-4 sm:order-none col-span-2 sm:col-span-1">
                {SOURCE_LABEL[r.source]}{r.attempt_no != null ? `, attempt ${r.attempt_no}` : ""}
              </div>
              <div className={`flex items-center gap-1.5 justify-end order-1 sm:order-none ${onePerson ? "col-span-2 sm:col-span-1" : ""}`}>
                <span className="text-sm font-semibold tabular-nums" data-testid="quiz-score-score">{r.score != null ? `${r.score}%` : ""}</span>
                <Badge className={`text-[10px] ${RESULT_CLS[r.result]}`} data-testid="quiz-score-result">{RESULT_LABEL[r.result]}</Badge>
              </div>
              {r.result === "voided" && r.void_reason && (
                <div className="text-[11px] text-muted-foreground order-5 sm:order-none col-span-2 sm:col-span-full" data-testid="quiz-score-void-reason">
                  Voided: {r.void_reason}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {data && rows.length > 0 && shown.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="quiz-scores-none-match">No quiz scores match these filters.</p>
      )}
      {!onePerson && data && rows.some((r) => r.source === "assigned") && (
        <p className="text-[11px] text-muted-foreground">The answers given on an assigned quiz are under Results on that quiz.</p>
      )}
    </div>
  );
}
