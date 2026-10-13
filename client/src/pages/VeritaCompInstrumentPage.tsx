// client/src/pages/VeritaCompInstrumentPage.tsx
//
// "By instrument" competency view (2026-10-13, Michael Q154 = 2): the mirror of VeritaCompEmployeePage. Click an
// instrument, then click between the people assigned to it (the way the employee page clicks between test systems).
// READ-ONLY for now: each person's block comes from the same record the employee page edits, so the two views always
// agree; editing happens on the person's page (link below). Not linked from the VeritaComp landing until it is turned on.
//   GET /api/labs/:labId/competency/instrument/:instrumentId
import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, CheckCircle2, ExternalLink } from "lucide-react";

const ELEMENT_NAMES: Record<number, string> = {
  1: "Direct Observation of Routine Patient Test Performance",
  2: "Monitoring, Recording and Reporting of Test Results",
  3: "QC Performance",
  4: "Direct Observation of Instrument Maintenance",
  5: "Blind / PT Sample Performance",
  6: "Problem-Solving Assessment (Quiz)",
  7: "Safe Work Practices (NYS)",
  8: "Delegated Supervisory Functions (NYS)",
};
// The one or two fields worth showing at a glance per element (read-only summary).
const ELEMENT_SUMMARY: Record<number, Array<[string, string]>> = {
  1: [["specimenId", "Specimen"], ["observerInitials", "Observer"]],
  2: [["evidence", "Evidence"], ["date", "Date"]],
  3: [["qcDate", "QC run"]],
  4: [["dateObserved", "Observed"], ["observerInitials", "Observer"]],
  5: [["sampleType", "Sample"], ["sampleId", "ID"]],
  6: [["quizId", "Quiz"], ["score", "Score"], ["dateTaken", "Taken"]],
  7: [["dateObserved", "Observed"], ["observerInitials", "Observer"]],
  8: [["functionAssessed", "Function"], ["date", "Date"]],
};

interface ElementData { num: number; status: string; na?: boolean; naJustification?: string; [k: string]: any; }
interface WaivedMethod { num: number; name: string; evidence: string; date: string; initials: string; passed: boolean; status: string; }
interface TestSystem {
  instrumentId: number; instrumentName: string; department: string | null; complexity: string;
  analyteCount: number; hasData: boolean; complete: boolean; elements: ElementData[];
  waived?: boolean; waivedRequired?: number; waivedPassed?: number; waivedMethods?: WaivedMethod[];
}
interface Person {
  employee: { id: number; name: string; title: string | null };
  record: { locked: boolean; completionDate: string | null; evaluatorName: string | null } | null;
  testSystem: TestSystem;
}
interface InstrumentView { instrument: { id: number; name: string; department: string | null }; elementCount: number; people: Person[]; }

function statusBadge(status: string) {
  const cls = status === "pass" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    : status === "fail" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
    : status === "na" || status === "unused" ? "bg-muted text-muted-foreground"
    : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  const label = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : status === "na" ? "N/A" : status === "unused" ? "Not used"
    : status === "incomplete" ? "Incomplete" : status;
  return <Badge className={`text-[10px] ${cls}`} data-testid="element-status">{label}</Badge>;
}

export default function VeritaCompInstrumentPage() {
  const activeLabId = useActiveLabId();
  const params = useParams();
  const instrumentId = Number((params as any).instrumentId);
  const [activeEmp, setActiveEmp] = useState<number | null>(null);
  const url = activeLabId ? `/api/labs/${activeLabId}/competency/instrument/${instrumentId}` : null;
  const { data, isLoading, error } = useQuery<InstrumentView>({
    queryKey: [url ?? "no-inst"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`Failed to load (${r.status})`);
      return r.json();
    },
    enabled: !!url,
  });
  const labRoute = (p: string) => (activeLabId ? `/labs/${activeLabId}${p}` : p);
  const people = data?.people || [];
  const current = activeEmp != null ? people.find((p) => p.employee.id === activeEmp) : people[0];
  const ts = current?.testSystem;
  const completeCount = people.filter((p) => p.testSystem.complete).length;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <Link href={labRoute("/veritacomp-app/instruments")} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ChevronLeft size={14} /> All instruments
      </Link>
      {isLoading && <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>}
      {error && <div className="text-sm text-red-600">Could not load this instrument's competency view.</div>}
      {data && (
        <>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold" data-testid="instrument-name">{data.instrument.name}</h1>
              {data.instrument.department && <span className="text-sm text-muted-foreground">{data.instrument.department}</span>}
              {ts && <Badge variant="outline" className="text-[10px]">{ts.complexity}</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-1" data-testid="instrument-summary">
              {people.length === 0 ? "No one is assigned to this instrument yet."
                : `${completeCount} of ${people.length} assigned ${people.length === 1 ? "person" : "people"} complete for this cycle.`}
            </p>
          </div>

          {people.length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground" data-testid="instrument-empty">
              Assign people to this instrument in VeritaStaff&trade;, and they will appear here.
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[minmax(200px,260px)_1fr] gap-4">
              <div className="space-y-1.5" data-testid="person-list">
                {people.map((p) => {
                  const isActive = current?.employee.id === p.employee.id;
                  const dot = p.testSystem.complete ? "bg-emerald-500" : p.testSystem.hasData ? "bg-amber-400" : "bg-muted-foreground/40";
                  return (
                    <button key={p.employee.id} onClick={() => setActiveEmp(p.employee.id)} data-testid="person-tab"
                      className={`w-full text-left rounded-md border p-2.5 transition-colors ${isActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
                        <span className="text-sm font-medium leading-tight">{p.employee.name}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        {p.employee.title && <span>{p.employee.title}</span>}
                        {p.record?.locked && <span className="text-emerald-700 dark:text-emerald-400">Signed</span>}
                      </div>
                    </button>
                  );
                })}
              </div>

              {current && ts && (
                <Card>
                  <CardContent className="p-4 space-y-3" data-testid="person-panel">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <div className="font-semibold">{current.employee.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {ts.waived ? `Waived testing: ${ts.waivedPassed ?? 0} of ${ts.waivedRequired ?? 2} methods passed`
                            : ts.complete ? "All elements complete" : "Elements still open"}
                        </div>
                      </div>
                      <Link href={labRoute(`/veritacomp-app/employee/${current.employee.id}`)} data-testid="open-person-record"
                        className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                        Open {current.employee.name.split(" ")[0]}'s record to edit <ExternalLink size={12} />
                      </Link>
                    </div>
                    {current.record?.locked && (
                      <div className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 size={14} /> Signed{current.record.evaluatorName ? ` by ${current.record.evaluatorName}` : ""}
                        {current.record.completionDate ? ` on ${new Date(current.record.completionDate).toLocaleDateString()}` : ""}
                      </div>
                    )}
                    {ts.waived ? (
                      <div className="space-y-2">
                        {(ts.waivedMethods || []).map((m) => (
                          <div key={m.num} className="rounded-md border p-2.5 flex items-start justify-between gap-3" data-testid="element-row">
                            <div className="text-sm">
                              <div className="font-medium">{m.name}</div>
                              {(m.date || m.evidence) && <div className="text-[11px] text-muted-foreground">{[m.date, m.evidence].filter(Boolean).join(" · ")}</div>}
                            </div>
                            {statusBadge(m.status)}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {ts.elements.map((el) => {
                          const facts = (ELEMENT_SUMMARY[el.num] || []).map(([k, label]) => (el[k] !== undefined && el[k] !== "" && el[k] !== null ? `${label}: ${el[k]}` : null)).filter(Boolean);
                          return (
                            <div key={el.num} className="rounded-md border p-2.5 flex items-start justify-between gap-3" data-testid="element-row">
                              <div className="text-sm">
                                <div className="font-medium">Element {el.num}: {ELEMENT_NAMES[el.num]}</div>
                                {el.na ? <div className="text-[11px] text-muted-foreground">N/A{el.naJustification ? `: ${el.naJustification}` : ""}</div>
                                  : facts.length > 0 && <div className="text-[11px] text-muted-foreground">{facts.join(" · ")}</div>}
                              </div>
                              {statusBadge(el.na ? "na" : el.status)}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
