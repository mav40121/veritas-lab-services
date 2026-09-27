// client/src/pages/VeritaCompEmployeePage.tsx
//
// Employee-centric competency view + entry (Phase 1 read + Phase 2 entry).
// Michael's model: click an employee, see their competency by TEST SYSTEM (their
// VeritaStaff-assigned instruments; analytes on one instrument are covered
// together), enter/edit each element's data per test system, saved to one
// current-cycle record per employee.
//   GET /api/labs/:labId/competency/employee/:employeeId
//   PUT /api/labs/:labId/competency/employee/:employeeId/test-system/:instrumentId
import { useState, useEffect } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ChevronLeft, FlaskConical } from "lucide-react";

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
// Which raw fields each element captures (drives the entry inputs).
const ELEMENT_FIELDS: Record<number, Array<{ key: string; label: string; type: "text" | "date" | "number" | "bool" }>> = {
  1: [{ key: "specimenId", label: "Specimen ID observed", type: "text" }, { key: "observerInitials", label: "Observer (LD / TC / TS)", type: "text" }],
  2: [{ key: "evidence", label: "Evidence", type: "text" }, { key: "date", label: "Date", type: "date" }],
  3: [{ key: "qcDate", label: "Date QC was run", type: "date" }],
  4: [{ key: "dateObserved", label: "Date observed", type: "date" }, { key: "observerInitials", label: "Observer (LD / TC / TS)", type: "text" }],
  5: [{ key: "sampleType", label: "Sample type", type: "text" }, { key: "sampleId", label: "Sample ID", type: "text" }, { key: "acceptable", label: "Acceptable", type: "bool" }],
  6: [{ key: "quizId", label: "Quiz ID", type: "text" }, { key: "score", label: "Score", type: "number" }, { key: "dateTaken", label: "Date taken", type: "date" }],
  7: [{ key: "dateObserved", label: "Date observed", type: "date" }, { key: "observerInitials", label: "Observer", type: "text" }],
  8: [{ key: "functionAssessed", label: "Function assessed", type: "text" }, { key: "date", label: "Date", type: "date" }],
};

interface ElementData { num: number; status: string; passed?: boolean; na?: boolean; naJustification?: string; [k: string]: any; }
interface TestSystem {
  instrumentId: number; instrumentName: string; department: string | null; complexity: string;
  analyteCount: number; covered: boolean; hasData: boolean; complete: boolean; elements: ElementData[];
}
interface EmployeeView {
  employee: { id: number; name: string; title: string | null; complexity: string };
  elementCount: number; latestAssessmentId: number | null; testSystems: TestSystem[];
}

function statusBadge(status: string) {
  const cls = status === "pass" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
    : status === "fail" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
    : status === "na" ? "bg-muted text-muted-foreground"
    : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
  const label = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : status === "na" ? "N/A" : "Incomplete";
  return <Badge className={`text-[10px] ${cls}`}>{label}</Badge>;
}

export default function VeritaCompEmployeePage() {
  const activeLabId = useActiveLabId();
  const readOnly = useIsReadOnly("veritacomp");
  const { toast } = useToast();
  const qc = useQueryClient();
  const params = useParams();
  const employeeId = Number((params as any).employeeId);
  const [activeTs, setActiveTs] = useState<number | null>(null);
  // Edit buffer for the active test system: { [elementNum]: { field: value } }.
  const [form, setForm] = useState<Record<number, any>>({});

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

  const testSystems = data?.testSystems || [];
  const current = activeTs != null ? testSystems.find((t) => t.instrumentId === activeTs) : testSystems[0];

  // Seed the edit buffer whenever the active test system (or fetched data) changes.
  useEffect(() => {
    if (!current) { setForm({}); return; }
    const seed: Record<number, any> = {};
    for (const el of current.elements) {
      seed[el.num] = { ...el };
    }
    setForm(seed);
  }, [current?.instrumentId, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (num: number, key: string, value: any) => {
    setForm((prev) => ({ ...prev, [num]: { ...(prev[num] || {}), [key]: value } }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!current) return;
      const elements = current.elements.map((el) => {
        const f = form[el.num] || {};
        return { num: el.num, ...f };
      });
      const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/competency/employee/${employeeId}/test-system/${current.instrumentId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ elements }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
      return r.json();
    },
    onSuccess: () => { toast({ title: "Saved", description: `${current?.instrumentName} competency updated.` }); if (url) qc.invalidateQueries({ queryKey: [url] }); },
    onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const labRoute = (p: string) => (activeLabId ? `/labs/${activeLabId}${p}` : p);

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
              {/* Test-system list */}
              <div className="space-y-1.5" data-testid="test-system-list">
                {testSystems.map((ts) => {
                  const isActive = current?.instrumentId === ts.instrumentId;
                  const dot = ts.complete ? "bg-emerald-500" : ts.hasData ? "bg-amber-400" : "bg-muted-foreground/40";
                  return (
                    <button key={ts.instrumentId} onClick={() => setActiveTs(ts.instrumentId)} data-testid="test-system-tab"
                      className={`w-full text-left rounded-md border p-2.5 transition-colors ${isActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
                        <span className="text-sm font-medium leading-tight">{ts.instrumentName}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        {ts.department && <span>{ts.department}</span>}
                        <span>{ts.complexity}</span>
                        <span>{ts.analyteCount} analyte{ts.analyteCount === 1 ? "" : "s"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Editable elements for the active test system */}
              <Card>
                <CardContent className="p-4">
                  {current && (
                    <>
                      <div className="flex items-center gap-2 mb-1">
                        <FlaskConical size={16} className="text-primary" />
                        <h3 className="font-semibold">{current.instrumentName}</h3>
                        {current.complete ? <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Complete</Badge>
                          : <Badge className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">In progress</Badge>}
                      </div>
                      <p className="text-[11px] text-muted-foreground mb-3">Enter each element's data, or mark N/A with a reason. Every element needs data or N/A to be complete.</p>

                      <div className="space-y-3">
                        {current.elements.map((el) => {
                          const f = form[el.num] || {};
                          const fields = ELEMENT_FIELDS[el.num] || [];
                          return (
                            <div key={el.num} className="border border-border rounded-lg p-3" data-testid={`element-${el.num}`}>
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <div className="text-xs font-semibold">Element {el.num}: {ELEMENT_NAMES[el.num]}</div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                                    <input type="checkbox" className="w-3.5 h-3.5" disabled={readOnly} checked={!!f.na}
                                      onChange={(e) => setField(el.num, "na", e.target.checked)} /> N/A
                                  </label>
                                  {!f.na && (
                                    <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                                      <input type="checkbox" className="w-3.5 h-3.5" disabled={readOnly} checked={!!f.passed}
                                        onChange={(e) => setField(el.num, "passed", e.target.checked)} /> Pass
                                    </label>
                                  )}
                                  {statusBadge(el.status)}
                                </div>
                              </div>
                              {f.na ? (
                                <Input placeholder="Justification for N/A (required)" className="text-xs h-8 border-amber-400" disabled={readOnly}
                                  value={f.naJustification || ""} onChange={(e) => setField(el.num, "naJustification", e.target.value)} data-testid={`element-${el.num}-na-just`} />
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {fields.map((fld) => (
                                    <div key={fld.key} className="flex-1 min-w-[120px]">
                                      <label className="text-[10px] text-muted-foreground">{fld.label}</label>
                                      {fld.type === "bool" ? (
                                        <label className="flex items-center gap-1 text-xs h-8">
                                          <input type="checkbox" className="w-3.5 h-3.5" disabled={readOnly} checked={!!f[fld.key]} onChange={(e) => setField(el.num, fld.key, e.target.checked)} /> Yes
                                        </label>
                                      ) : (
                                        <Input type={fld.type === "number" ? "number" : fld.type === "date" ? "date" : "text"} className="text-xs h-8" disabled={readOnly}
                                          value={f[fld.key] ?? ""} onChange={(e) => setField(el.num, fld.key, e.target.value)} data-testid={`element-${el.num}-${fld.key}`} />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {!readOnly && (
                        <div className="flex justify-end mt-3">
                          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="save-test-system">
                            {saveMutation.isPending && <Loader2 className="animate-spin mr-1" size={12} />} Save {current.instrumentName}
                          </Button>
                        </div>
                      )}
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
