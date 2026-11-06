// client/src/components/StaffOwnCompetency.tsx
//
// VeritaComp for a Staff login (Michael Q182 = 1, 2026-11-05): their own name and record, the program names so they can find
// their own records, and nothing about anyone else. The server enforces the limit on every read (server/competencySelfEntry.ts
// staffOwnScope); these screens are what a Staff login sees in place of the evaluator's, so nothing here is a dead link or an
// empty error. Owners, admins, editors and every other seat type never reach this file.
import type { ComponentType } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useStaffOwnScope } from "@/hooks/useStaffLogin";
import { useToast } from "@/hooks/use-toast";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { downloadPdfToken } from "@/lib/utils";
import { fmtDate } from "@/lib/competencyElements";
import { assessmentTypeLabel } from "@shared/competencyEvaluation";
import { useNontechnicalDue, nontechnicalDueText, nontechnicalDueClass } from "@/components/CompetencyNontechnicalFrequencyCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, FileDown, Loader2 } from "lucide-react";

interface OwnRecord { employee: { id: number; name: string; title: string | null }; testSystems: Array<{ signedCurrent?: boolean }> }
interface OwnProgramRow { id: number; name: string; department: string | null; type: string; record_kind?: string | null; myAssessmentCount: number }
interface OwnAssessment { id: number; assessment_type: string; assessment_date: string; evaluator_name: string | null; status: string; locked: number; employee_name?: string }
interface OwnProgram { id: number; name: string; department: string | null; type: string; record_kind?: string | null; assessments: OwnAssessment[] }

const getJson = async (url: string) => {
  const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
const kindLabel = (type: string, recordKind?: string | null) =>
  recordKind === "evaluation" ? "New-hire evaluation" : type === "technical" ? "Technical" : type === "waived" ? "Waived" : "Non-technical";
const RESULT: Record<string, { label: string; cls: string }> = {
  pass: { label: "Pass", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
  fail: { label: "Fail", cls: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  remediation: { label: "Remediation", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
};
const UNLINKED = "Your login isn't linked to your staff record yet, so there is no competency record to show. Ask your lab director or supervisor to link it.";

const useLabRoutes = () => {
  const labId = useActiveLabId();
  return { labId, labRoute: (p: string) => (labId ? `/labs/${labId}${p}` : p) };
};

export function StaffOwnHome() {
  const { labId, labRoute } = useLabRoutes();
  const { ownEmployeeId } = useStaffOwnScope();
  const recordUrl = labId && ownEmployeeId != null ? `/api/labs/${labId}/competency/employee/${ownEmployeeId}` : null;
  const { data: record, isLoading: recordLoading, error: recordError } = useQuery<OwnRecord>({
    queryKey: [recordUrl ?? "no-own-record"], enabled: !!recordUrl, queryFn: () => getJson(recordUrl!),
  });
  const programsUrl = labId ? `/api/labs/${labId}/competency/programs` : null;
  const { data: programs, error: programsError } = useQuery<OwnProgramRow[]>({
    queryKey: [programsUrl ?? "no-own-programs"], enabled: !!programsUrl, queryFn: () => getJson(programsUrl!),
  });
  const methods = record?.testSystems || [];
  const signed = methods.filter((t) => t.signedCurrent).length;
  // Their own due dates when the lab has set a non-technical frequency (Q216 = 1); the server sends only their own rows.
  const { data: ntDue } = useNontechnicalDue(ownEmployeeId != null);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6" data-testid="staff-own-home">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">VeritaComp{"™"}</h1>
        <p className="text-sm text-muted-foreground mt-1">Your competency record. Your evaluator signs off each method on its own.</p>
      </div>

      {ownEmployeeId == null ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground" data-testid="staff-own-unlinked">{UNLINKED}</CardContent></Card>
      ) : recordLoading ? (
        <div className="h-24 rounded-xl bg-muted/60 animate-pulse" />
      ) : recordError || !record ? (
        <Card><CardContent className="p-5 text-sm text-muted-foreground" data-testid="staff-own-unavailable">Your competency record can't be opened right now. If this keeps happening, ask your lab director or supervisor to check your staff record.</CardContent></Card>
      ) : (
        <Link href={labRoute(`/veritacomp-app/employee/${ownEmployeeId}`)} data-testid="staff-own-record"
          className="flex items-center justify-between gap-3 rounded-lg border border-border p-4 hover:border-primary/40 transition-colors">
          <div className="min-w-0">
            <div className="font-semibold" data-testid="staff-own-name">{record.employee.name}</div>
            {record.employee.title && <div className="text-xs text-muted-foreground">{record.employee.title}</div>}
            <div className="text-sm mt-1" data-testid="staff-own-count">
              {methods.length ? `My competency record: ${signed} of ${methods.length} method${methods.length === 1 ? "" : "s"} signed` : "My competency record: no methods assigned yet"}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </Link>
      )}

      {ownEmployeeId != null && (
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link href={labRoute("/veritacomp-app/signed")} data-testid="staff-own-signed">My signed competencies</Link></Button>
          <Button asChild variant="outline" size="sm"><Link href={labRoute("/my-signoffs")} data-testid="staff-own-signoffs">My sign-offs</Link></Button>
        </div>
      )}

      <div data-testid="staff-own-programs">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Competency programs</h2>
        {programsError ? (
          <p className="text-sm text-muted-foreground" data-testid="staff-own-programs-unavailable">The program list can't be opened right now. Your own record above is not affected.</p>
        ) : programs && programs.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="staff-own-programs-empty">This lab has no competency programs yet.</p>
        ) : (
          <div className="space-y-1.5">
            {(programs || []).map((p) => {
              const due = ntDue?.items.find((i) => i.programId === p.id);
              const body = (
                <>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{p.name}</div>
                    <div className="text-[11px] text-muted-foreground">{[p.department, kindLabel(p.type, p.record_kind)].filter(Boolean).join(" · ")}</div>
                    {due && <div className={`text-[11px] ${nontechnicalDueClass(due)}`} data-testid="staff-own-nt-due">{nontechnicalDueText(due)}</div>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0 text-xs text-muted-foreground" data-testid="staff-own-program-count">
                    {p.myAssessmentCount > 0 ? `${p.myAssessmentCount} record${p.myAssessmentCount === 1 ? "" : "s"} of yours` : "No record of yours"}
                    {p.myAssessmentCount > 0 && <ChevronRight size={14} />}
                  </div>
                </>
              );
              const cls = "flex items-center justify-between gap-3 rounded-md border border-border p-3";
              return p.myAssessmentCount > 0
                ? <Link key={p.id} href={labRoute(`/veritacomp-app/${p.id}`)} data-testid="staff-own-program" className={`${cls} hover:border-primary/40 transition-colors`}>{body}</Link>
                : <div key={p.id} data-testid="staff-own-program" className={cls}>{body}</div>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function StaffOwnProgram({ programId }: { programId: number }) {
  const { labId, labRoute } = useLabRoutes();
  const { toast } = useToast();
  const url = labId ? `/api/labs/${labId}/competency/programs/${programId}` : null;
  const { data, isLoading, error } = useQuery<OwnProgram>({ queryKey: [url ?? "no-own-program"], enabled: !!url, queryFn: () => getJson(url!) });
  const pdf = useMutation({
    mutationFn: async (a: OwnAssessment) => {
      const r = await fetch(`${API_BASE}/api/labs/${labId}/competency/assessments/${a.id}/pdf`, { headers: authHeaders() });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
      const { token } = await r.json();
      downloadPdfToken(token, `VeritaComp_${a.assessment_date}.pdf`);
    },
    onError: (e: any) => toast({ title: "Download failed", description: String(e?.message || e), variant: "destructive" }),
  });
  const records = data?.assessments || [];

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-5" data-testid="staff-own-program-page">
      <Link href={labRoute("/veritacomp-app")} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1" data-testid="staff-own-back">
        <ChevronLeft size={14} /> VeritaComp{"™"}
      </Link>
      {isLoading && <div className="h-32 rounded-xl bg-muted/60 animate-pulse" />}
      {error && <Card><CardContent className="p-5 text-sm text-muted-foreground" data-testid="staff-own-program-missing">This program can't be opened. Your own records are listed on the VeritaComp{"™"} page.</CardContent></Card>}
      {data && (
        <>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="staff-own-program-name">{data.name}</h1>
            <p className="text-sm text-muted-foreground">{[data.department, kindLabel(data.type, data.record_kind)].filter(Boolean).join(" · ")}</p>
          </div>
          {records.length === 0 ? (
            <Card><CardContent className="p-5 text-sm text-muted-foreground" data-testid="staff-own-program-empty">You have no record in this program yet.</CardContent></Card>
          ) : (
            <div className="space-y-1.5">
              {records.map((a) => {
                const res = a.locked ? RESULT[a.status] || RESULT.pass : null;
                return (
                  <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3" data-testid="staff-own-assessment">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{assessmentTypeLabel(a.assessment_type)} {"·"} {fmtDate(a.assessment_date)}</div>
                      {a.evaluator_name && <div className="text-[11px] text-muted-foreground">Evaluator: {a.evaluator_name}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {res ? <Badge className={`text-[10px] ${res.cls}`}>{res.label}</Badge> : <Badge variant="outline" className="text-[10px]">Not signed yet</Badge>}
                      <Button size="sm" variant="outline" onClick={() => pdf.mutate(a)} disabled={pdf.isPending} data-testid="staff-own-assessment-pdf">
                        {pdf.isPending ? <Loader2 className="animate-spin mr-1" size={12} /> : <FileDown className="mr-1" size={12} />} PDF
                      </Button>
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted-foreground pt-1">
                To add your entries or acknowledge a record, open <Link href={labRoute("/my-signoffs")} className="text-primary hover:underline" data-testid="staff-own-program-signoffs">My sign-offs</Link>.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** What a Staff login sees on a person page that isn't theirs, or on their own when it can't be opened. */
export function StaffOwnRefusal({ employeeId }: { employeeId: number }) {
  const { labRoute } = useLabRoutes();
  const { ownEmployeeId } = useStaffOwnScope();
  const onOwn = ownEmployeeId != null && ownEmployeeId === employeeId;
  return (
    <Card data-testid="staff-own-refused">
      <CardContent className="p-6 space-y-3">
        <p className="text-sm">
          {ownEmployeeId == null ? UNLINKED : onOwn ? "Your competency record can't be opened right now. If this keeps happening, ask your lab director or supervisor to check your staff record." : "You can only open your own competency record."}
        </p>
        {ownEmployeeId != null && !onOwn && (
          <Button asChild size="sm"><Link href={labRoute(`/veritacomp-app/employee/${ownEmployeeId}`)} data-testid="staff-own-open-mine">Open my record</Link></Button>
        )}
      </CardContent>
    </Card>
  );
}

// Whole-lab pages (by instrument, method groups): a Staff login lands on their own VeritaComp page instead. Same pattern as
// components/StaffLoginGate.tsx; wrap the route component once and everyone else gets the page unchanged.
export function staffOwnGate<P extends object>(Page: ComponentType<P>): ComponentType<P> {
  function StaffOwnGated(props: P) {
    const { ownOnly, ready } = useStaffOwnScope();
    if (!ready) return null;
    return ownOnly ? <StaffOwnHome /> : <Page {...props} />;
  }
  return StaffOwnGated;
}
