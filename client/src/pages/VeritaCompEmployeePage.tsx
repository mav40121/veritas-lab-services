// client/src/pages/VeritaCompEmployeePage.tsx
//
// Employee-centric competency view (2026-09-27, Phase 1). Michael's model: click
// an employee (from the roster or a coverage-map cell) and see their competency
// organized by TEST SYSTEM (their VeritaStaff-assigned instruments; analytes on
// the same instrument are covered together), with each of the 6 (or 8 NYS)
// elements and any data already entered. Read-only in Phase 1; per-test-system
// data entry lands in Phase 2. Data comes from
//   GET /api/labs/:labId/competency/employee/:employeeId
import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, FlaskConical, Stethoscope, AlertTriangle } from "lucide-react";

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

interface ElementStatus { num: number; status: "pass" | "fail" | "na" | "incomplete"; }
interface TestSystem {
  instrumentId: number;
  instrumentName: string;
  department: string | null;
  complexity: string;
  analyteCount: number;
  covered: boolean;
  hasData: boolean;
  complete: boolean;
  elements: ElementStatus[];
}
interface EmployeeView {
  employee: { id: number; name: string; title: string | null; complexity: string };
  elementCount: number;
  latestAssessmentId: number | null;
  testSystems: TestSystem[];
}

function statusBadge(status: string) {
  const cls =
    status === "pass" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    : status === "fail" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
    : status === "na" ? "bg-muted text-muted-foreground"
    : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"; // incomplete
  const label = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : status === "na" ? "N/A" : "Incomplete";
  return <Badge className={`text-[10px] ${cls}`}>{label}</Badge>;
}

export default function VeritaCompEmployeePage() {
  const activeLabId = useActiveLabId();
  const params = useParams();
  const employeeId = Number((params as any).employeeId);
  const [activeTs, setActiveTs] = useState<number | null>(null);

  const url = activeLabId ? `/api/labs/${activeLabId}/competency/employee/${employeeId}` : null;
  const { data, isLoading, error } = useQuery<EmployeeView>({
    queryKey: [url ?? "no-emp"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${url}`, { headers: authHeaders() });
      if (!r.ok) throw new Error(`Failed to load (${r.status})`);
      return r.json();
    },
    enabled: !!url,
  });

  const labRoute = (p: string) => (activeLabId ? `/labs/${activeLabId}${p}` : p);
  const testSystems = data?.testSystems || [];
  const current = activeTs != null ? testSystems.find((t) => t.instrumentId === activeTs) : testSystems[0];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <Link href={labRoute("/veritacomp-app")} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ChevronLeft size={14} /> All employees
      </Link>

      {isLoading && <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>}
      {error && <div className="text-sm text-red-600">Could not load this employee's competency view.</div>}

      {data && (
        <>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{data.employee.name}</h1>
              {data.employee.title && <span className="text-sm text-muted-foreground">{data.employee.title}</span>}
              <Badge variant="outline" className="text-[10px]">{data.elementCount === 8 ? "NYS CLEP (8 elements)" : "CLIA (6 elements)"}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Competency by test system, from this person's VeritaStaff&trade; instrument assignments. Analytes run the same way on one instrument are covered by a single competency.
            </p>
          </div>

          {testSystems.length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">
              No test systems assigned yet. Assign this employee to instruments in VeritaStaff&trade;, and they will appear here.
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[minmax(200px,260px)_1fr] gap-4">
              {/* Test-system list (tabs) */}
              <div className="space-y-1.5" data-testid="test-system-list">
                {testSystems.map((ts) => {
                  const isActive = (current?.instrumentId === ts.instrumentId);
                  const dot = !ts.covered ? "bg-muted-foreground/40" : ts.complete ? "bg-emerald-500" : "bg-amber-400";
                  return (
                    <button
                      key={ts.instrumentId}
                      onClick={() => setActiveTs(ts.instrumentId)}
                      data-testid="test-system-tab"
                      className={`w-full text-left rounded-md border p-2.5 transition-colors ${isActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
                        <span className="text-sm font-medium leading-tight">{ts.instrumentName}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        {ts.department && <span>{ts.department}</span>}
                        <span>{ts.complexity}</span>
                        <span>{ts.analyteCount} analyte{ts.analyteCount === 1 ? "" : "s"}</span>
                      </div>
                      {!ts.covered && (
                        <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
                          <AlertTriangle size={10} /> No competency covers this yet
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Elements for the active test system */}
              <Card>
                <CardContent className="p-4">
                  {current && (
                    <>
                      <div className="flex items-center gap-2 mb-3">
                        <FlaskConical size={16} className="text-primary" />
                        <h3 className="font-semibold">{current.instrumentName}</h3>
                        {current.complete ? (
                          <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Complete</Badge>
                        ) : (
                          <Badge className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">In progress</Badge>
                        )}
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-muted-foreground border-b text-xs">
                            <th className="text-left py-1 pr-2 w-8">#</th>
                            <th className="text-left py-1 pr-2">Element</th>
                            <th className="text-center py-1">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {current.elements.map((el) => (
                            <tr key={el.num} className="border-b border-border/50">
                              <td className="py-1.5 pr-2 text-muted-foreground">{el.num}</td>
                              <td className="py-1.5 pr-2">{ELEMENT_NAMES[el.num] || `Element ${el.num}`}</td>
                              <td className="py-1.5 text-center">{statusBadge(el.status)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-[11px] text-muted-foreground mt-3 flex items-center gap-1">
                        <Stethoscope size={11} /> Enter or edit this competency's data from the assessment for this employee. Per-test-system entry from this screen is coming next.
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
