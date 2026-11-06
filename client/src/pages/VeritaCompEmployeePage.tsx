// client/src/pages/VeritaCompEmployeePage.tsx
//
// Employee-centric competency view + entry (Phase 1 read + Phase 2 entry).
// Michael's model: click an employee, see their competency by TEST SYSTEM (their
// VeritaStaff-assigned instruments; analytes on one instrument are covered
// together), enter/edit each element's data per test system, saved to one
// current-cycle record per employee.
//   GET /api/labs/:labId/competency/employee/:employeeId
//   PUT /api/labs/:labId/competency/employee/:employeeId/test-system/:instrumentId
// Per-method sign-off (2026-10-13, Michael Q156/Q158): each test system (method) is signed off on its own, so a new
// hire can be signed department by department (MethodSignOffPanel). The whole-record Sign & Complete is retired.
// #91 (2026-10-12): an all-waived test system (glucose meter, urine dipstick reader)
// shows the four waived methods (two required) instead of the six CLIA elements.
// Staff self-entry (2026-11-05, Michael's 2026-09-27 rule): a Staff login on their OWN record (the server says so in
// canEnterOwnData) fills in the factual data and saves through .../my-data. Observer, N/A, Pass, Acceptable, Element 4,
// evaluator initials and sign-off stay disabled, and the server keeps them from the stored row whatever is sent.
import { NaReasonPresets } from "@/components/competency/NaReasonPresets";
import { useState, useEffect } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { downloadPdfToken } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ChevronLeft, FlaskConical, FileDown, Plus, X } from "lucide-react";
import type { El5Sample } from "@shared/competencyEl5Samples";
import MethodSignOffPanel, { signoffSummary, type MethodSignState } from "@/components/MethodSignOffPanel";
import { MILESTONE_LABEL } from "@shared/competencySignoff";
import { ObserverInitialsField, type QualifiedObserver } from "@/components/ObserverInitialsField";
import { WaivedSpecimenRows } from "@/components/WaivedSpecimenRows";
import { WAIVED_BLIND_METHOD, type WaivedSpecimen } from "@shared/competencyWaivedSpecimens";
import { ELEMENT_NAMES, ELEMENT_FIELDS } from "@/lib/competencyElements";
import { SELF_ELEMENT_FIELDS, isSelfEntryField, selfSampleRemovable } from "@shared/competencySelfEntry";
import { NEEDS_REVIEW, NEEDS_REVIEW_LABEL } from "@shared/competencyStatus";
import { useStaffOwnScope } from "@/hooks/useStaffLogin";
import { StaffOwnRefusal } from "@/components/StaffOwnCompetency";

interface ElementData { num: number; status: string; passed?: boolean; na?: boolean; naJustification?: string; [k: string]: any; }
// Element 5 can record more than one blind / PT sample for a test system (Michael Q71 = 1). The edit buffer keeps them
// in `samples`; a record saved before the list existed seeds one row from its single fields.
const BLANK_SAMPLE: El5Sample = { sampleType: "", sampleId: "", acceptable: null };
const samplesOf = (f: any): El5Sample[] =>
  Array.isArray(f?.samples) && f.samples.length ? f.samples
    : [{ sampleType: f?.sampleType ?? "", sampleId: f?.sampleId ?? "", acceptable: f?.acceptable ?? null }];
interface WaivedMethod { num: number; name: string; evidence: string; date: string; initials: string; passed: boolean; status: string; specimens?: WaivedSpecimen[]; }
interface TestSystem extends MethodSignState {
  department: string | null; analyteCount: number; covered: boolean; elements: ElementData[];
  waived?: boolean; waivedRequired?: number; waivedPassed?: number; waivedMethods?: WaivedMethod[];
}
interface EmployeeView {
  employee: { id: number; name: string; title: string | null; complexity: string; hireDate?: string | null };
  elementCount: number; latestAssessmentId: number | null; testSystems: TestSystem[];
  // True only for a Staff login on their own record in a lab that can still take writes. Decided on the server.
  canEnterOwnData?: boolean;
}
const TONE: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  teal: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  muted: "bg-muted text-muted-foreground",
};

// Michael Q179 = 1: an unsigned entry with data and no Pass or N/A reads Needs review, for everyone who sees it. These are working
// rows only; a signed set shows its real result in SignedEntries.
const ReviewBadge = () => <Badge className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" data-testid="needs-review-chip">{NEEDS_REVIEW_LABEL}</Badge>;

function waivedBadge(status: string) {
  if (status === "pass") return <Badge className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">PASS</Badge>;
  if (status === NEEDS_REVIEW) return <ReviewBadge />;
  if (status === "fail") return <Badge className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Not passed</Badge>;
  if (status === "incomplete") return <Badge className="text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">Needs date</Badge>;
  return <Badge className="text-[10px] bg-muted text-muted-foreground">Not used</Badge>;
}

function statusBadge(status: string) {
  if (status === NEEDS_REVIEW) return <ReviewBadge />;
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
  const { ownOnly } = useStaffOwnScope(); // Michael Q182 = 1: a Staff login, who can open only their own record
  const { toast } = useToast();
  const qc = useQueryClient();
  const params = useParams();
  const employeeId = Number((params as any).employeeId);
  // ?method=<instrumentId>&signoff=<signoffId> (a row on the Signed competencies list): open that method with that
  // sign-off's entries showing.
  const linked = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const linkedSignoff = Number(linked?.get("signoff")) || null;
  const [activeTs, setActiveTs] = useState<number | null>(() => Number(linked?.get("method")) || null);
  // Edit buffer for the active test system: { [elementNum]: { field: value } }.
  const [form, setForm] = useState<Record<number, any>>({});
  // Waived test system edit buffer: { [methodNum]: { evidence, date, initials, passed } }.
  const [wform, setWform] = useState<Record<number, any>>({});

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
  // Element 1 / 4 observer pick list: the lab's LD/TC/TS people in VeritaStaff, people who have left listed last.
  const observersUrl = activeLabId ? `/api/labs/${activeLabId}/staff/qualified-observers` : null;
  const { data: observers, isLoading: observersLoading } = useQuery<QualifiedObserver[]>({
    queryKey: [observersUrl ?? "no-observers"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}${observersUrl}`, { headers: authHeaders() });
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!observersUrl,
  });

  const testSystems = data?.testSystems || [];
  const current = (activeTs != null ? testSystems.find((t) => t.instrumentId === activeTs) : undefined) ?? testSystems[0];
  const signedCount = testSystems.filter((t) => t.signedCurrent).length;
  const readyCount = testSystems.filter((t) => t.readyToSign).length;
  const reviewCount = testSystems.filter((t) => t.needsReview).length;
  const overdueCount = testSystems.filter((t) => t.overdue).length;
  const refresh = () => { if (url) qc.invalidateQueries({ queryKey: [url] }); };
  // Staff self-entry: evaluator-owned controls are locked and only the listed data fields open up. Everyone else: readOnly decides, as before.
  const selfEntry = !!data?.canEnterOwnData;
  const evaluatorLocked = readOnly || selfEntry;
  const dataLocked = readOnly && !selfEntry;
  const fieldLocked = (element: number, key: string) => (selfEntry ? !isSelfEntryField(element, key) : readOnly);

  // Seed the edit buffer whenever the active test system (or fetched data) changes.
  useEffect(() => {
    if (!current) { setForm({}); setWform({}); return; }
    const seed: Record<number, any> = {};
    for (const el of current.elements) {
      seed[el.num] = { ...el };
    }
    setForm(seed);
    const wseed: Record<number, any> = {};
    for (const m of current.waivedMethods || []) wseed[m.num] = { evidence: m.evidence, date: m.date, initials: m.initials, passed: m.passed, specimens: m.specimens };
    setWform(wseed);
  }, [current?.instrumentId, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (num: number, key: string, value: any) => {
    setForm((prev) => ({ ...prev, [num]: { ...(prev[num] || {}), [key]: value } }));
  };
  const setSamples = (fn: (list: El5Sample[]) => El5Sample[]) => {
    setForm((prev) => {
      const list = fn(samplesOf(prev[5]));
      return { ...prev, 5: { ...(prev[5] || {}), samples: list.length ? list : [{ ...BLANK_SAMPLE }] } };
    });
  };
  const setSample = (i: number, key: keyof El5Sample, value: any) => setSamples((list) => list.map((s, j) => (j === i ? { ...s, [key]: value } : s)));
  const setWField = (num: number, key: string, value: any) => {
    setWform((prev) => ({ ...prev, [num]: { ...(prev[num] || {}), [key]: value } }));
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!current) return;
      const elements = current.elements.map((el) => {
        const f = form[el.num] || {};
        return { num: el.num, ...f };
      });
      const waivedMethods = (current.waivedMethods || []).map((m) => ({ num: m.num, ...(wform[m.num] || {}) }));
      const base = `${API_BASE}/api/labs/${activeLabId}/competency/employee/${employeeId}/test-system/${current.instrumentId}`;
      // A self-entry sends the data fields only. The server would ignore anything else, so this is just honest about what is being saved.
      const selfBody = current.waived
        ? { waivedMethods: waivedMethods.map((m: any) => (m.num === WAIVED_BLIND_METHOD
            ? { num: m.num, specimens: (m.specimens ?? [{ evidence: m.evidence ?? "", date: m.date ?? "" }]).map((s: any) => ({ evidence: s.evidence ?? "", date: s.date ?? "" })) }
            : { num: m.num, evidence: m.evidence ?? "", date: m.date ?? "" })) }
        : { elements: current.elements.filter((el) => SELF_ELEMENT_FIELDS[el.num] && !form[el.num]?.na).map((el) => {
            const f = form[el.num] || {};
            if (el.num === 5) return { num: 5, samples: samplesOf(f).map((s) => ({ sampleType: s.sampleType ?? "", sampleId: s.sampleId ?? "" })) };
            return { num: el.num, ...Object.fromEntries(Object.keys(SELF_ELEMENT_FIELDS[el.num]).map((k) => [k, f[k] ?? ""])) };
          }) };
      const r = await fetch(selfEntry ? `${base}/my-data` : base, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(selfEntry ? selfBody : current.waived ? { waivedMethods } : { elements }),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
      return r.json();
    },
    onSuccess: () => { toast({ title: "Saved", description: `${current?.instrumentName} competency updated.` }); if (url) qc.invalidateQueries({ queryKey: [url] }); },
    onError: (e: any) => toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const pdfMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/labs/${activeLabId}/competency/employee/${employeeId}/record-pdf`, { headers: authHeaders() });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || `HTTP ${r.status}`); }
      const { token } = await r.json();
      const safe = String(data?.employee?.name || "Employee").replace(/[^a-zA-Z0-9_\- ]/g, "").trim() || "Employee";
      downloadPdfToken(token, `VeritaComp_Record_${safe}.pdf`);
    },
    onError: (e: any) => toast({ title: "Download failed", description: String(e?.message || e), variant: "destructive" }),
  });

  const labRoute = (p: string) => (activeLabId ? `/labs/${activeLabId}${p}` : p);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-5">
      <Link href={labRoute("/veritacomp-app")} className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1">
        <ChevronLeft size={14} /> {ownOnly ? <>VeritaComp&trade;</> : "All employees"}
      </Link>

      {isLoading && <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>}
      {error && (ownOnly ? <StaffOwnRefusal employeeId={employeeId} /> : <div className="text-sm text-red-600">Could not load this employee's competency view.</div>)}

      {data && (
        <>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-bold">{data.employee.name}</h1>
                {data.employee.title && <span className="text-sm text-muted-foreground">{data.employee.title}</span>}
                {(testSystems.length === 0 || testSystems.some((t) => !t.waived)) && (
                  <Badge variant="outline" className="text-[10px]">{data.elementCount === 8 ? "NYS CLEP (8 elements)" : "CLIA (6 elements)"}</Badge>
                )}
                {testSystems.some((t) => t.waived) && (
                  <Badge variant="outline" className="text-[10px]" data-testid="waived-badge">Waived testing (2 of 4 methods)</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Competency by test system, from {ownOnly ? "your" : "this person's"} VeritaStaff&trade; instrument assignments. Analytes run the same way on one instrument are covered by a single competency.
              </p>
            </div>
            {testSystems.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => pdfMutation.mutate()} disabled={pdfMutation.isPending} data-testid="download-record-pdf">
                {pdfMutation.isPending ? <Loader2 className="animate-spin mr-1" size={12} /> : <FileDown className="mr-1" size={12} />} Download PDF
              </Button>
            )}
          </div>

          {testSystems.length > 0 && (
            <div className="text-sm text-muted-foreground" data-testid="signoff-summary">
              <span className="font-medium text-foreground">{signedCount} of {testSystems.length} methods signed</span>
              {readyCount > 0 && <span> &middot; {readyCount} ready to sign</span>}
              {reviewCount > 0 && <span data-testid="signoff-summary-review"> &middot; {reviewCount} {reviewCount === 1 ? "needs" : "need"} review</span>}
              {overdueCount > 0 && <span className="text-red-600"> &middot; {overdueCount} overdue</span>}
              <span> &middot; each method is signed off on its own.</span>
            </div>
          )}

          {testSystems.length === 0 ? (
            <Card><CardContent className="p-6 text-sm text-muted-foreground">
              {ownOnly
                ? <>No test systems are assigned to you yet. Your lab director assigns them in VeritaStaff&trade;, and they will appear here.</>
                : <>No test systems assigned yet. Assign this employee to instruments in VeritaStaff&trade;, and they will appear here.</>}
            </CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[minmax(200px,260px)_1fr] gap-4">
              {/* Test-system list */}
              <div className="space-y-1.5" data-testid="test-system-list">
                {testSystems.map((ts) => {
                  const isActive = current?.instrumentId === ts.instrumentId;
                  const sum = signoffSummary(ts);
                  const dot = sum.tone === "green" ? "bg-emerald-500" : sum.tone === "teal" ? "bg-teal-600" : sum.tone === "red" ? "bg-red-500" : sum.tone === "amber" ? "bg-amber-400" : "bg-muted-foreground/40";
                  return (
                    <button key={ts.instrumentId} onClick={() => setActiveTs(ts.instrumentId)} data-testid="test-system-tab"
                      className={`w-full text-left rounded-md border p-2.5 transition-colors ${isActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`}>
                      <div className="flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
                        <span className="text-sm font-medium leading-tight">{ts.instrumentName}</span>
                        {ts.groupMembers?.length ? <Badge className="text-[9px] bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300" data-testid="group-badge">GROUP</Badge> : null}
                      </div>
                      {ts.groupMembers?.length ? <div className="text-[11px] text-muted-foreground">{ts.groupMembers.map((m) => m.name).join(", ")}</div> : null}
                      <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        {ts.department && <span>{ts.department}</span>}
                        <span>{ts.complexity}</span>
                        <span>{ts.analyteCount} analyte{ts.analyteCount === 1 ? "" : "s"}</span>
                      </div>
                      <Badge className={`text-[10px] mt-1 ${TONE[sum.tone]}`} data-testid="method-status">{sum.label}</Badge>
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
                        <Badge className={`text-[10px] ${TONE[signoffSummary(current).tone]}`}>{signoffSummary(current).label}</Badge>
                      </div>
                      <div className="mb-3">
                        <MethodSignOffPanel part="status" labId={activeLabId!} employeeId={employeeId} employeeName={data.employee.name} ts={current} readOnly={evaluatorLocked} onChanged={refresh} openSignoffId={linkedSignoff} />
                      </div>
                      {selfEntry && (
                        <p className="text-xs mb-3 rounded px-2 py-1.5 bg-teal-50 dark:bg-teal-900/20 text-teal-900 dark:text-teal-200" data-testid="self-entry-note">
                          {current.waived
                            ? "You can fill in the evidence and date for each method you performed; your evaluator sets Pass, the evaluator initials and the final sign-off."
                            : "You can fill in your specimen IDs, dates, evidence, sample IDs and quiz details; your evaluator sets the observer, Pass and the final sign-off."}
                        </p>
                      )}
                      {current.groupMembers?.length ? (
                        <p className="text-[11px] mb-2 rounded px-2 py-1.5 bg-teal-50 dark:bg-teal-900/20 text-teal-900 dark:text-teal-200" data-testid="group-note">
                          Grouped by the lab: {current.groupMembers.map((m) => m.name).join(" and ")} need no new or unique skills, so one competency covers {current.groupMembers.length === 2 ? "both" : "all of them"}.
                        </p>
                      ) : null}
                      <p className="text-xs font-medium mb-1" data-testid="working-milestone">{MILESTONE_LABEL[current.nextMilestone]} competency</p>
                      {current.waived ? (
                        <div data-testid="waived-panel">
                          <p className="text-[11px] text-muted-foreground mb-1">
                            Waived test system: record at least {current.waivedRequired ?? 2} of the four methods below, at hire and annually (the accreditor's waived-testing standard). The six CLIA elements apply to moderate and high complexity test systems.
                          </p>
                          <p className="text-xs font-medium mb-3" data-testid="waived-count">
                            {current.waivedPassed ?? 0} of {current.waivedRequired ?? 2} required methods passed
                          </p>
                          <div className="space-y-3">
                            {(current.waivedMethods || []).map((m) => {
                              const w = wform[m.num] || {};
                              return (
                                <div key={m.num} className="border border-border rounded-lg p-3" data-testid={`waived-method-${m.num}`}>
                                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap sm:flex-nowrap">
                                    <div className="text-xs font-semibold">Method {m.num}: {m.name}</div>
                                    <div className="flex items-center gap-3 shrink-0">
                                      {m.num !== WAIVED_BLIND_METHOD && (
                                      <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                                        <input type="checkbox" className="w-3.5 h-3.5" disabled={evaluatorLocked} checked={!!w.passed}
                                          onChange={(e) => setWField(m.num, "passed", e.target.checked)} data-testid={`waived-method-${m.num}-passed`} /> Pass
                                      </label>
                                      )}
                                      {waivedBadge(m.status)}
                                    </div>
                                  </div>
                                  {m.num === WAIVED_BLIND_METHOD ? (
                                    <WaivedSpecimenRows rows={w.specimens ?? [{ evidence: w.evidence ?? "", date: w.date ?? "", initials: w.initials ?? "", passed: !!w.passed }]} onChange={(rows) => setWField(m.num, "specimens", rows)} disabled={dataLocked} evaluatorLocked={selfEntry} testId={`waived-method-${m.num}`} />
                                  ) : (
                                  <div className="flex flex-wrap gap-2">
                                    <div className="flex-[2] min-w-[160px]">
                                      <label className="text-[10px] text-muted-foreground">Evidence</label>
                                      <Input className="text-xs h-8" disabled={dataLocked} value={w.evidence ?? ""}
                                        onChange={(e) => setWField(m.num, "evidence", e.target.value)} data-testid={`waived-method-${m.num}-evidence`} />
                                    </div>
                                    <div className="flex-1 min-w-[120px]">
                                      <label className="text-[10px] text-muted-foreground">Date performed</label>
                                      <Input type="date" className="text-xs h-8" disabled={dataLocked} value={w.date ?? ""}
                                        onChange={(e) => setWField(m.num, "date", e.target.value)} data-testid={`waived-method-${m.num}-date`} />
                                    </div>
                                    <div className="flex-1 min-w-[100px]">
                                      <label className="text-[10px] text-muted-foreground">Evaluator initials</label>
                                      <Input className="text-xs h-8" disabled={evaluatorLocked} value={w.initials ?? ""}
                                        onChange={(e) => setWField(m.num, "initials", e.target.value)} data-testid={`waived-method-${m.num}-initials`} />
                                    </div>
                                  </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                      <>
                      {!selfEntry && <p className="text-[11px] text-muted-foreground mb-3">Enter each element's data, or mark N/A with a reason. Every element needs data or N/A to be complete.</p>}

                      <div className="space-y-3">
                        {current.elements.map((el) => {
                          const f = form[el.num] || {};
                          const fields = ELEMENT_FIELDS[el.num] || [];
                          return (
                            <div key={el.num} className="border border-border rounded-lg p-3" data-testid={`element-${el.num}`}>
                              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap sm:flex-nowrap">
                                <div className="text-xs font-semibold">Element {el.num}: {ELEMENT_NAMES[el.num]}</div>
                                <div className="flex items-center gap-3 shrink-0">
                                  <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                                    <input type="checkbox" className="w-3.5 h-3.5" disabled={evaluatorLocked} checked={!!f.na}
                                      onChange={(e) => setField(el.num, "na", e.target.checked)} data-testid={`element-${el.num}-na`} /> N/A
                                  </label>
                                  {!f.na && (
                                    <label className="flex items-center gap-1 text-[11px] cursor-pointer">
                                      <input type="checkbox" className="w-3.5 h-3.5" disabled={evaluatorLocked} checked={!!f.passed}
                                        onChange={(e) => setField(el.num, "passed", e.target.checked)} data-testid={`element-${el.num}-pass`} /> Pass
                                    </label>
                                  )}
                                  {statusBadge(el.status)}
                                </div>
                              </div>
                              {f.na ? (
                                <>
                                  <Input placeholder="Justification for N/A (required)" className="text-xs h-8 border-amber-400" disabled={evaluatorLocked}
                                    value={f.naJustification || ""} onChange={(e) => setField(el.num, "naJustification", e.target.value)} data-testid={`element-${el.num}-na-just`} />
                                  <NaReasonPresets element={el.num} disabled={evaluatorLocked} onPick={(r) => setField(el.num, "naJustification", r)} />
                                </>
                              ) : el.num === 5 ? (
                                <div className="space-y-2" data-testid="element-5-samples">
                                  {samplesOf(f).map((s, i, all) => (
                                    <div key={i} className="flex flex-wrap items-end gap-2" data-testid={`element-5-sample-${i}`}>
                                      <div className="flex-1 min-w-[120px]">
                                        <label className="text-[10px] text-muted-foreground">{all.length > 1 ? `Sample ${i + 1} type` : "Sample type"}</label>
                                        <Input className="text-xs h-8" disabled={dataLocked} value={s.sampleType ?? ""}
                                          onChange={(e) => setSample(i, "sampleType", e.target.value)} data-testid={`element-5-sampleType-${i}`} />
                                      </div>
                                      <div className="flex-1 min-w-[120px]">
                                        <label className="text-[10px] text-muted-foreground">Sample ID</label>
                                        <Input className="text-xs h-8" disabled={dataLocked} value={s.sampleId ?? ""}
                                          onChange={(e) => setSample(i, "sampleId", e.target.value)} data-testid={`element-5-sampleId-${i}`} />
                                      </div>
                                      <div className="min-w-[90px]">
                                        <label className="text-[10px] text-muted-foreground">Acceptable</label>
                                        <label className="flex items-center gap-1 text-xs h-8">
                                          <input type="checkbox" className="w-3.5 h-3.5" disabled={evaluatorLocked} checked={!!s.acceptable}
                                            onChange={(e) => setSample(i, "acceptable", e.target.checked)} data-testid={`element-5-acceptable-${i}`} /> Yes
                                        </label>
                                      </div>
                                      {!dataLocked && all.length > 1 && (!selfEntry || selfSampleRemovable(all, i)) && (
                                        <Button type="button" variant="ghost" size="sm" className="h-8 px-2" aria-label={`Remove sample ${i + 1}`}
                                          onClick={() => setSamples((list) => list.filter((_, j) => j !== i))} data-testid={`element-5-remove-${i}`}>
                                          <X size={14} />
                                        </Button>
                                      )}
                                    </div>
                                  ))}
                                  {!dataLocked && (
                                    <Button type="button" variant="outline" size="sm" className="h-7 text-xs"
                                      onClick={() => setSamples((list) => [...list, { ...BLANK_SAMPLE }])} data-testid="element-5-add-sample">
                                      <Plus size={12} className="mr-1" /> Add another sample
                                    </Button>
                                  )}
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-2">
                                  {fields.map((fld) => (
                                    <div key={fld.key} className="flex-1 min-w-[120px]">
                                      <label className="text-[10px] text-muted-foreground">{fld.label}</label>
                                      {fld.type === "observer" ? (
                                        <ObserverInitialsField value={f[fld.key] ?? ""} onChange={(v) => setField(el.num, fld.key, v)}
                                          observers={observers || []} isLoading={observersLoading} disabled={evaluatorLocked} hideEmptyNote={ownOnly}
                                          triggerClassName="text-xs h-8" data-testid={`element-${el.num}-${fld.key}`} />
                                      ) : fld.type === "bool" ? (
                                        <label className="flex items-center gap-1 text-xs h-8">
                                          <input type="checkbox" className="w-3.5 h-3.5" disabled={evaluatorLocked} checked={!!f[fld.key]} onChange={(e) => setField(el.num, fld.key, e.target.checked)} /> Yes
                                        </label>
                                      ) : (
                                        <Input type={fld.type === "number" ? "number" : fld.type === "date" ? "date" : "text"} className="text-xs h-8" disabled={fieldLocked(el.num, fld.key)}
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
                      </>
                      )}

                      {!dataLocked && (
                        <div className="flex justify-end mt-3">
                          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="save-test-system">
                            {saveMutation.isPending && <Loader2 className="animate-spin mr-1" size={12} />} Save {current.instrumentName}
                          </Button>
                        </div>
                      )}
                      <div className="mt-3">
                        <MethodSignOffPanel part="sign" labId={activeLabId!} employeeId={employeeId} employeeName={data.employee.name} ts={current} readOnly={evaluatorLocked} onChanged={refresh} />
                      </div>
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
