// client/src/components/CompetencyToSign.tsx
//
// B5 (signatures mock 2, 2026-11-27; shared/competencyObservation.ts): what waits for the signed-in person's own signature in
// VeritaComp™. "Observations to sign": the Element 1 and 4 entries that name them as the observer, signed several at once with
// one signature, each its own signature and audit row (POST /api/labs/:labId/competency/observations/sign). "Methods to sign":
// methods ready for a sign-off they may give; a Staff login reviews the entries and signs here (Q3 = 1), anyone else opens the
// person's page. The server decides who they are from the session (GET /api/labs/:labId/competency/to-sign), never a list
// (client/src/hooks/useCompetencySigner.ts).
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { competencyToSignUrl, getCompetencyJson, refreshCompetencyReads, type CompetencyMe, type CompetencyToSignData, type ObservationToSign } from "@/hooks/useCompetencySigner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ChevronDown, ChevronUp, ChevronRight } from "lucide-react";
import { SignaturePrompt, useSignatureCredential } from "@/components/SignaturePrompt";
import MethodSignOffPanel from "@/components/MethodSignOffPanel";
import SignedEntries from "@/components/SignedEntries";
import { MILESTONE_LABEL } from "@shared/competencySignoff";

const localToday = () => new Date().toLocaleDateString("en-CA");
const EL4_WATCHED = "maintenance and function checks";

function ObservationsToSign({ labId, me, rows }: { labId: number | string; me: CompetencyMe; rows: ObservationToSign[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const cred = useSignatureCredential("competency_observation");
  const [typedName, setTypedName] = useState("");
  const [ticked, setTicked] = useState<Record<number, boolean>>({});
  const [dates, setDates] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, "pass" | "fail" | null>>({});
  const [refusals, setRefusals] = useState<Array<{ itemId: number; message: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setTicked(Object.fromEntries(rows.map((r) => [r.itemId, true])));
    setDates(Object.fromEntries(rows.map((r) => [r.itemId, r.dateObserved || ""])));
    setResults(Object.fromEntries(rows.map((r) => [r.itemId, r.result])));
  }, [rows.map((r) => r.itemId).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = rows.filter((r) => ticked[r.itemId]);
  const people = Array.from(new Set(chosen.map((r) => r.employeeName)));
  const missing = chosen.some((r) => !dates[r.itemId] || !results[r.itemId]);
  const sign = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/labs/${labId}/competency/observations/sign`, {
        method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ typedName, ...cred.body(), items: chosen.map((x) => ({ itemId: x.itemId, dateObserved: dates[x.itemId], result: results[x.itemId] })) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      return d as { signed: number; refused: number; results: Array<{ itemId: number; ok: boolean; message: string | null }> };
    },
    onSuccess: (d) => {
      setError(null);
      setRefusals(d.results.filter((x) => !x.ok).map((x) => ({ itemId: x.itemId, message: x.message || "Not signed." })));
      if (d.signed) toast({ title: `Signed ${d.signed} observation${d.signed === 1 ? "" : "s"}`, description: d.refused ? `${d.refused} not signed; the reason is shown.` : "Each has its own signature and audit row." });
      cred.reset();
      setTypedName("");
      refreshCompetencyReads(qc);
    },
    onError: (e: any) => { setError(String(e?.message || e)); cred.setPassword(""); },
  });
  const allTicked = rows.length > 0 && rows.every((r) => ticked[r.itemId]);
  return (
    <section className="space-y-3" data-testid="observations-to-sign">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold">Observations to sign</h3>
          <p className="text-xs text-muted-foreground">Signed in as {me.name}. You are the observer named on these.</p>
        </div>
        <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300" data-testid="observations-waiting">{rows.length} waiting</Badge>
      </div>
      <div className="rounded-md border divide-y" role="list">
        <label className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <input type="checkbox" className="w-4 h-4" checked={allTicked} onChange={(e) => setTicked(Object.fromEntries(rows.map((r) => [r.itemId, e.target.checked])))} data-testid="observations-tick-all" />
          Tick all
        </label>
        {rows.map((r) => (
          <div key={r.itemId} role="listitem" className="px-3 py-2.5 grid gap-2 grid-cols-[auto_1fr] sm:grid-cols-[auto_1.3fr_1.2fr_auto_auto] sm:items-center" data-testid="observation-row">
            <input type="checkbox" className="w-4 h-4 mt-0.5 sm:mt-0" aria-label={`Sign ${r.employeeName}, ${r.methodName}, Element ${r.element}`} checked={!!ticked[r.itemId]}
              onChange={(e) => setTicked((t) => ({ ...t, [r.itemId]: e.target.checked }))} data-testid="observation-tick" />
            <div className="min-w-0">
              <div className="text-sm font-medium break-words">{r.employeeName}</div>
              <div className="text-xs text-muted-foreground break-words">{r.methodName}</div>
            </div>
            <div className="col-start-2 sm:col-start-auto text-xs min-w-0 break-words">
              <span className="font-medium">El {r.element}</span>, {r.element === 1 ? (r.watched || "no specimen ID") : EL4_WATCHED}
              {r.changedAfterSigning && <div className="text-amber-700 dark:text-amber-400">Changed after you signed. Sign again.</div>}
            </div>
            <div className="col-start-2 sm:col-start-auto">
              <label className="sr-only" htmlFor={`obs-date-${r.itemId}`}>Date observed</label>
              <Input id={`obs-date-${r.itemId}`} type="date" className="h-8 text-xs w-[9.5rem]" max={localToday()} value={dates[r.itemId] || ""}
                onChange={(e) => setDates((d) => ({ ...d, [r.itemId]: e.target.value }))} data-testid="observation-date" />
            </div>
            <div className="col-start-2 sm:col-start-auto inline-flex rounded-md border overflow-hidden text-xs w-fit" role="group" aria-label="Result">
              {(["pass", "fail"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={results[r.itemId] === v} onClick={() => setResults((x) => ({ ...x, [r.itemId]: v }))}
                  className={`px-3 h-8 ${results[r.itemId] === v ? (v === "pass" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 font-semibold" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-semibold") : "bg-background text-muted-foreground"}`}
                  data-testid={`observation-${v}`}>{v === "pass" ? "Pass" : "Fail"}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-md border p-3 space-y-3 bg-muted/20">
        <p className="text-sm" data-testid="observations-statement">
          {people.length ? `I watched ${people.join(" and ")} do each of these on the date shown.` : "Tick the observations you watched."}
        </p>
        <SignaturePrompt cred={cred} typedName={typedName} onTypedName={setTypedName} layout="grid"
          labels={{ name: "Full name", password: "Your password" }} ids={{ name: "obs-sign-name", password: "obs-sign-password" }}
          testIds={{ name: "observations-sign-name", password: "observations-sign-password", hospital: "observations-sign-hospital" }} />
        <Button className="w-full sm:w-auto" onClick={() => sign.mutate()} disabled={sign.isPending || !chosen.length || missing || typedName.trim().length < 2 || !cred.ready} data-testid="observations-sign">
          {sign.isPending && <Loader2 className="animate-spin mr-1" size={14} />} Sign {chosen.length} observation{chosen.length === 1 ? "" : "s"}
        </Button>
        {missing && chosen.length > 0 && <p className="text-xs text-muted-foreground">Enter the date observed and Pass or Fail on each one ticked.</p>}
        <p className="text-xs text-muted-foreground">One password for the ones ticked. Each gets its own signature and audit row. Only the named observer can sign; nobody signs their own.</p>
      </div>
      {error && <p role="alert" className="text-sm rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 px-3 py-2" data-testid="observations-error">{error}</p>}
      {refusals.map((x) => (
        <p key={x.itemId} role="alert" className="text-sm rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 px-3 py-2" data-testid="observation-refusal">{x.message}</p>
      ))}
    </section>
  );
}

function MethodsToSign({ labId, rows, staffView }: { labId: number | string; rows: CompetencyToSignData["methods"]; staffView: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="space-y-2" data-testid="methods-to-sign">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold">Methods to sign</h3>
        <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300">{rows.length} ready</Badge>
      </div>
      <div className="space-y-2">
        {rows.map(({ employee, testSystem: ts }) => {
          const key = `${employee.id}:${ts.instrumentId}`;
          const isOpen = open === key;
          const title = `${employee.name}, ${ts.instrumentName}: ${MILESTONE_LABEL[ts.nextMilestone]}`;
          return (
            <div key={key} className="rounded-md border" data-testid="method-to-sign">
              <div className="flex items-center justify-between gap-2 p-3 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium break-words">{title}</div>
                  <div className="text-xs text-muted-foreground">{[ts.complexity, (ts as any).department].filter(Boolean).join(" · ")}{ts.observersWaiting?.length ? " · waiting for the observer" : ""}</div>
                </div>
                {staffView ? (
                  <Button size="sm" variant="outline" onClick={() => setOpen(isOpen ? null : key)} aria-expanded={isOpen} data-testid="method-to-sign-open">
                    {isOpen ? <ChevronUp size={14} className="mr-1" /> : <ChevronDown size={14} className="mr-1" />} Review and sign
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/labs/${labId}/veritacomp-app/employee/${employee.id}?method=${ts.instrumentId}`} data-testid="method-to-sign-link">Open <ChevronRight size={14} className="ml-1" /></Link>
                  </Button>
                )}
              </div>
              {staffView && isOpen && (
                <div className="border-t p-3 space-y-3">
                  <SignedEntries caption="Entries to review (read only). You can't change them; ask the evaluator who entered them."
                    signoff={{ id: null, legacy: false, milestone: null, signedDate: null, signerName: null, signerRole: null, signerInitials: null, documentation: null,
                      elements: ts.elements as any, waivedMethods: ts.waivedMethods as any, hasEntries: true }} waived={ts.waived} />
                  <MethodSignOffPanel part="sign" labId={labId} employeeId={employee.id} employeeName={employee.name} ts={ts} readOnly onChanged={() => { setOpen(null); refreshCompetencyReads(qc); }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function CompetencyToSign({ labId, staffView = false }: { labId: number | string | null | undefined; staffView?: boolean }) {
  const url = labId ? competencyToSignUrl(labId, false) : null;
  const { data } = useQuery<CompetencyToSignData>({ queryKey: [url ?? "no-to-sign"], enabled: !!url, queryFn: () => getCompetencyJson(url!) });
  const observations = useMemo(() => data?.observations || [], [data]);
  const methods = useMemo(() => data?.methods || [], [data]);
  if (!labId || !data?.me || (!observations.length && !methods.length)) return null;
  return (
    <Card data-testid="competency-to-sign">
      <CardContent className="p-4 space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Waiting for your signature</h2>
          <p className="text-xs text-muted-foreground">You sign as yourself, {data.me.name}, with your own name and password.</p>
        </div>
        {observations.length > 0 && <ObservationsToSign labId={labId} me={data.me} rows={observations} />}
        {methods.length > 0 && <MethodsToSign labId={labId} rows={methods} staffView={staffView} />}
      </CardContent>
    </Card>
  );
}
