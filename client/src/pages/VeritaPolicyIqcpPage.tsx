// VeritaPolicyIqcpPage.tsx
//
// IQCP Builder, a document type inside VeritaDC (document control). Guided flow:
//   1. Pre-screen gate (3 questions). All three must be yes or an IQCP is not
//      indicated and the flow stops.
//   2. Pick an eligible test system (nonwaived, non-pathology) from VeritaMap.
//   3. Risk assessment (5 CMS components), Quality Control Plan, Quality
//      Assessment worksheets, seeded from the CMS IQCP workbook question bank.
//   4. Review and mark complete with director approval.
// Backend: /api/iqcp/* (question bank, prescreen) and /api/labs/:labId/iqcp/*.

import { useState, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { VeritaPolicyTabs } from "@/components/VeritaPolicyTabs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Loader2, ShieldCheck, ArrowRight, ArrowLeft, Plus, Trash2, CheckCircle2,
  AlertTriangle, ClipboardList, FlaskConical, Microscope, ListChecks, FileCheck2, Download,
} from "lucide-react";

type Screen = { nonwaived: string; reduce_intent: string; mfr_less_strict: string };
type Gate = { indicated: boolean; reason: string };
type RiskRow = { component: string; phase: string; source_of_error: string; reducible: string; mitigation: string };
type QcpRow = { qc_type: string; frequency: string; acceptability_criteria: string; corrective_action: string };
type QaRow = { activity: string; frequency: string; assessment_method: string };

const PHASES = ["Pre-analytic", "Analytic", "Post-analytic"];
const REDUCIBLE = ["Yes", "No", "N/A"];
const emptyScreen: Screen = { nonwaived: "", reduce_intent: "", mfr_less_strict: "" };

// Textarea that grows to fit its content, so pre-filled CMS text is never clipped.
function AutoTextarea({ value, onChange, className = "", ...props }: any) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => { const el = ref.current; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } };
  useLayoutEffect(() => { resize(); }, [value]);
  return (
    <Textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e: any) => { onChange(e); resize(); }}
      className={`min-h-[38px] resize-none overflow-hidden ${className}`}
      {...props}
    />
  );
}

export default function VeritaPolicyIqcpPage() {
  const labId = useActiveLabId();
  const jsonMut = async (method: string, url: string, body?: unknown) => {
    const r = await apiRequest(method, url, body);
    return r.json();
  };

  // Static CMS question bank (pre-screen, components + questions, QCP, QA, glossary).
  const { data: bank } = useQuery<any>({ queryKey: ["/api/iqcp/question-bank"] });
  // Plans for this lab.
  const { data: plans, isLoading: plansLoading } = useQuery<any[]>({
    queryKey: [`/api/labs/${labId}/iqcp/plans`], enabled: !!labId,
  });

  const [view, setView] = useState<"list" | "new" | "builder">("list");
  const [planId, setPlanId] = useState<number | null>(null);

  const refreshPlans = () => queryClient.invalidateQueries({ queryKey: [`/api/labs/${labId}/iqcp/plans`] });

  if (!labId) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="text-primary" size={22} />
        <h1 className="text-2xl font-bold text-foreground">IQCP Builder</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Build an Individualized Quality Control Plan for a nonwaived test system. VeritaDC keeps the finished plan as a controlled document with version history and periodic review.
      </p>
      <VeritaPolicyTabs active="iqcp" />

      <div className="mt-6">
        {view === "list" && (
          <PlanList
            plans={plans} loading={plansLoading}
            onNew={() => setView("new")}
            onOpen={(id: number) => { setPlanId(id); setView("builder"); }}
            onDeleted={refreshPlans}
            jsonMut={jsonMut} labId={labId}
          />
        )}
        {view === "new" && bank && (
          <NewPlanFlow
            bank={bank} labId={labId} jsonMut={jsonMut}
            onCancel={() => setView("list")}
            onCreated={(id: number) => { refreshPlans(); setPlanId(id); setView("builder"); }}
            onSavedScreening={() => { refreshPlans(); setView("list"); }}
          />
        )}
        {view === "builder" && planId && bank && (
          <PlanBuilder
            planId={planId} bank={bank} labId={labId} jsonMut={jsonMut}
            onBack={() => { refreshPlans(); setView("list"); }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    complete: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    not_indicated: "bg-muted text-muted-foreground",
    screening: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  };
  const label = status === "not_indicated" ? "Not indicated" : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`text-xs font-medium px-2 py-0.5 rounded ${map[status] || "bg-muted text-muted-foreground"}`}>{label}</span>;
}

function PlanList({ plans, loading, onNew, onOpen, onDeleted, jsonMut, labId }: any) {
  const { toast } = useToast();
  const del = async (id: number) => {
    if (!confirm("Delete this IQCP plan and its worksheets?")) return;
    await jsonMut("DELETE", `/api/labs/${labId}/iqcp/plans/${id}`);
    toast({ title: "Plan deleted" });
    onDeleted();
  };
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">Your IQCPs</h2>
        <Button onClick={onNew} className="gap-2"><Plus size={16} /> Start a new IQCP</Button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="animate-spin" size={16} /> Loading</div>
      ) : !plans || plans.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          No IQCPs yet. An IQCP is only worth building for a nonwaived test where you intend to run less QC than the CLIA default and the manufacturer's instructions allow it. Start one to run the 3-question screen.
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {plans.map((p: any) => (
            <Card key={p.id} className="hover:border-primary/40 transition-colors">
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <button className="text-left flex-1" onClick={() => p.status !== "not_indicated" && onOpen(p.id)}>
                  <div className="font-medium text-foreground">{p.title || p.instrument_name}</div>
                  <div className="text-xs text-muted-foreground">{p.instrument_name}{p.approved_by_name ? ` · Approved by ${p.approved_by_name}` : ""}</div>
                </button>
                <StatusPill status={p.status} />
                <Button variant="ghost" size="sm" onClick={() => del(p.id)} className="text-muted-foreground hover:text-destructive"><Trash2 size={15} /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function NewPlanFlow({ bank, labId, jsonMut, onCancel, onCreated, onSavedScreening }: any) {
  const { toast } = useToast();
  const [screen, setScreen] = useState<Screen>(emptyScreen);
  const [instrument, setInstrument] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const answered = screen.nonwaived && screen.reduce_intent && screen.mfr_less_strict;
  const gate: Gate | null = useMemo(() => {
    if (!answered) return null;
    const yes = (v: string) => v === "yes";
    if (!yes(screen.nonwaived)) return { indicated: false, reason: "Waived tests never require an IQCP. Follow the manufacturer's instructions for the waived test." };
    if (!yes(screen.reduce_intent)) return { indicated: false, reason: "You do not intend to run less QC than the CLIA default, so an IQCP is not needed. Run the CLIA default QC and document it." };
    if (!yes(screen.mfr_less_strict)) return { indicated: false, reason: "The manufacturer's QC instructions are at least as stringent as the CLIA default, so there is no reduction to justify. Follow the manufacturer's instructions." };
    return { indicated: true, reason: "All three screening questions are yes. An IQCP is a valid QC option for this test system. Proceed to the risk assessment." };
  }, [screen, answered]);

  const { data: eligible } = useQuery<any>({
    queryKey: [`/api/labs/${labId}/iqcp/eligible-tests`], enabled: !!labId && !!gate?.indicated,
  });

  const create = async () => {
    if (!gate?.indicated || !instrument) return;
    setBusy(true);
    try {
      const inst = eligible?.eligible?.find((e: any) => String(e.instrumentId) === instrument);
      const plan = await jsonMut("POST", `/api/labs/${labId}/iqcp/plans`, {
        instrumentId: inst?.instrumentId, instrumentName: inst?.instrumentName,
        mapId: inst?.mapId, testScope: (inst?.analytes || []).map((a: any) => a.analyte),
        screen, title: `IQCP: ${inst?.instrumentName}`,
      });
      onCreated(plan.id);
    } finally { setBusy(false); }
  };

  const saveScreening = async () => {
    setBusy(true);
    try {
      await jsonMut("POST", `/api/labs/${labId}/iqcp/plans`, {
        instrumentName: "Screening record", screen,
      });
      toast({ title: "Screening saved", description: "Recorded that an IQCP is not indicated for this test." });
      onSavedScreening();
    } finally { setBusy(false); }
  };

  return (
    <Card><CardContent className="p-6">
      <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-4"><ArrowLeft size={14} /> Back to list</button>
      <h2 className="text-lg font-semibold mb-1 flex items-center gap-2"><ClipboardList size={18} className="text-primary" /> Step 1: Is an IQCP worth it?</h2>
      <p className="text-sm text-muted-foreground mb-5">Answer all three before doing any work. If any answer is not yes, an IQCP is not indicated: run the CLIA default QC and document it.</p>

      <div className="space-y-4">
        {bank.prescreen.questions.map((q: any) => (
          <div key={q.id} className="border border-border rounded-lg p-4">
            <div className="font-medium text-sm mb-1">{q.prompt}</div>
            <div className="text-xs text-muted-foreground mb-2">{q.help}</div>
            <Select value={(screen as any)[q.id]} onValueChange={(v) => setScreen((s) => ({ ...s, [q.id]: v }))}>
              <SelectTrigger className="w-32"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent><SelectItem value="yes">Yes</SelectItem><SelectItem value="no">No</SelectItem></SelectContent>
            </Select>
          </div>
        ))}
      </div>

      {gate && !gate.indicated && (
        <div className="mt-5 border border-amber-500/30 bg-amber-500/10 rounded-lg p-4">
          <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-sm">An IQCP is not indicated.</div>
              <div className="text-sm mt-1 text-foreground">{gate.reason}</div>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={saveScreening} disabled={busy}>Save this screening record</Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          </div>
        </div>
      )}

      {gate?.indicated && (
        <div className="mt-5">
          <div className="border border-green-500/30 bg-green-500/10 rounded-lg p-4 mb-4 flex items-start gap-2 text-green-700 dark:text-green-400">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <div className="text-sm text-foreground">{gate.reason}</div>
          </div>
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2"><Microscope size={16} className="text-primary" /> Step 2: Pick the test system</h3>
          {!eligible ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><Loader2 className="animate-spin" size={14} /> Loading eligible test systems from VeritaMap</div>
          ) : eligible.eligible.length === 0 ? (
            <div className="text-sm text-muted-foreground">{eligible.note || "No eligible (nonwaived, non-pathology) test systems on this lab's VeritaMap."}</div>
          ) : (
            <>
              <Select value={instrument} onValueChange={setInstrument}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose an eligible test system" /></SelectTrigger>
                <SelectContent>
                  {eligible.eligible.map((e: any) => (
                    <SelectItem key={e.instrumentId} value={String(e.instrumentId)} disabled={!!e.existingPlan}>
                      {e.instrumentName} ({e.analytes.length} test{e.analytes.length === 1 ? "" : "s"}){e.existingPlan ? " — IQCP already started" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button className="mt-4 gap-2" onClick={create} disabled={!instrument || busy}>
                {busy ? <Loader2 className="animate-spin" size={16} /> : <ArrowRight size={16} />} Create IQCP and start the risk assessment
              </Button>
            </>
          )}
        </div>
      )}
    </CardContent></Card>
  );
}

// ---------------------------------------------------------------------------
const STEPS = [
  { key: "risk", label: "Risk Assessment", icon: FlaskConical },
  { key: "qcp", label: "Quality Control Plan", icon: ListChecks },
  { key: "qa", label: "Quality Assessment", icon: ShieldCheck },
  { key: "review", label: "Review", icon: FileCheck2 },
] as const;

function PlanBuilder({ planId, bank, labId, jsonMut, onBack }: any) {
  const { toast } = useToast();
  const planUrl = `/api/labs/${labId}/iqcp/plans/${planId}`;
  const { data: plan, isLoading } = useQuery<any>({ queryKey: [planUrl], enabled: !!labId });
  const [step, setStep] = useState<string>("risk");
  const [risk, setRisk] = useState<RiskRow[]>([]);
  const [qcp, setQcp] = useState<QcpRow[]>([]);
  const [qa, setQa] = useState<QaRow[]>([]);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [approver, setApprover] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!plan) return;
    setRisk((plan.riskItems || []).map((r: any) => ({ component: r.component, phase: r.phase || "", source_of_error: r.source_of_error || "", reducible: r.reducible || "", mitigation: r.mitigation || "" })));
    setQcp((plan.qcpItems || []).map((r: any) => ({ qc_type: r.qc_type, frequency: r.frequency || "", acceptability_criteria: r.acceptability_criteria || "", corrective_action: r.corrective_action || "" })));
    setQa((plan.qaItems || []).length
      ? plan.qaItems.map((r: any) => ({ activity: r.activity, frequency: r.frequency || "", assessment_method: r.assessment_method || "" }))
      : bank.qa.activities.map((a: string) => ({ activity: a, frequency: "", assessment_method: "" })));
    setApprover(plan.approved_by_name || "");
    setDirty({});
  }, [plan, bank]);

  const markDirty = (s: string) => setDirty((d) => (d[s] ? d : { ...d, [s]: true }));
  const itemsFor = (s: string) => (s === "risk" ? risk : s === "qcp" ? qcp : qa);

  const save = async (section: "risk" | "qcp" | "qa") => {
    setBusy(true);
    try {
      await jsonMut("PUT", `${planUrl}/${section}-items`, { items: itemsFor(section) });
      setDirty((d) => ({ ...d, [section]: false }));
      queryClient.invalidateQueries({ queryKey: [planUrl] });
      toast({ title: "Saved" });
    } finally { setBusy(false); }
  };

  // Auto-save the current worksheet (if edited) before switching tabs, so work
  // is never silently lost by navigating away.
  const goToStep = async (next: string) => {
    const cur = step;
    if ((cur === "risk" || cur === "qcp" || cur === "qa") && dirty[cur]) {
      try {
        await jsonMut("PUT", `${planUrl}/${cur}-items`, { items: itemsFor(cur) });
        setDirty((d) => ({ ...d, [cur]: false }));
      } catch { /* keep the dirty flag so the user can retry from the tab */ }
    }
    if (next === "review") queryClient.invalidateQueries({ queryKey: [planUrl] });
    setStep(next);
  };

  const complete = async () => {
    setBusy(true);
    try {
      // Persist all three worksheets first so the finished plan reflects everything on screen.
      await jsonMut("PUT", `${planUrl}/risk-items`, { items: risk });
      await jsonMut("PUT", `${planUrl}/qcp-items`, { items: qcp });
      await jsonMut("PUT", `${planUrl}/qa-items`, { items: qa });
      await jsonMut("PATCH", planUrl, { status: "complete", approvedByName: approver || undefined });
      setDirty({});
      queryClient.invalidateQueries({ queryKey: [planUrl] });
      toast({ title: "IQCP marked complete" });
      onBack();
    } finally { setBusy(false); }
  };

  const saveAll = async () => {
    setBusy(true);
    try {
      await jsonMut("PUT", `${planUrl}/risk-items`, { items: risk });
      await jsonMut("PUT", `${planUrl}/qcp-items`, { items: qcp });
      await jsonMut("PUT", `${planUrl}/qa-items`, { items: qa });
      setDirty({});
      queryClient.invalidateQueries({ queryKey: [planUrl] });
      toast({ title: "All worksheets saved" });
    } finally { setBusy(false); }
  };

  const downloadPdf = async () => {
    setBusy(true);
    try {
      const r = await apiRequest("GET", `${planUrl}/pdf`);
      if (!r.ok) throw new Error("PDF generation failed");
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `IQCP-${(plan?.instrument_name || "plan").replace(/[^a-z0-9]+/gi, "-")}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Could not generate PDF", description: e?.message });
    } finally { setBusy(false); }
  };

  if (isLoading || !plan) return <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="animate-spin" size={16} /> Loading plan</div>;

  const savedRisk = plan.riskItems?.length || 0;
  const savedQcp = plan.qcpItems?.length || 0;
  const savedQa = plan.qaItems?.length || 0;
  const unsaved = !!(dirty.risk || dirty.qcp || dirty.qa) || savedRisk !== risk.length || savedQcp !== qcp.length || savedQa !== qa.length;

  return (
    <div>
      <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mb-3"><ArrowLeft size={14} /> Back to list</button>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="font-semibold text-foreground">{plan.title || plan.instrument_name}</div>
          <div className="text-xs text-muted-foreground">{plan.instrument_name}</div>
        </div>
        <StatusPill status={plan.status} />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border mb-5">
        {STEPS.map((s) => {
          const Icon = s.icon;
          const isDirty = !!dirty[s.key as string];
          return (
            <button key={s.key} onClick={() => goToStep(s.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${step === s.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Icon size={14} /> {s.label}
              {isDirty && <span className="ml-1 w-1.5 h-1.5 rounded-full bg-amber-500" title="Unsaved changes (saved automatically when you switch tabs)" />}
            </button>
          );
        })}
      </div>

      {step === "risk" && (
        <RiskSection bank={bank} rows={risk} setRows={setRisk} onDirty={() => markDirty("risk")} onSave={() => save("risk")} busy={busy} />
      )}
      {step === "qcp" && (
        <QcpSection bank={bank} rows={qcp} setRows={setQcp} onDirty={() => markDirty("qcp")} onSave={() => save("qcp")} busy={busy} />
      )}
      {step === "qa" && (
        <QaSection rows={qa} setRows={setQa} onDirty={() => markDirty("qa")} onSave={() => save("qa")} busy={busy} />
      )}
      {step === "review" && (
        <Card><CardContent className="p-6">
          <h3 className="font-semibold mb-3">Review and approve</h3>
          <ul className="text-sm text-muted-foreground space-y-1 mb-4">
            <li>Risk assessment rows saved: <strong className="text-foreground">{savedRisk}</strong></li>
            <li>Quality control plan rows saved: <strong className="text-foreground">{savedQcp}</strong></li>
            <li>Quality assessment activities saved: <strong className="text-foreground">{savedQa}</strong></li>
          </ul>
          {unsaved && (
            <div className="border border-amber-500/30 bg-amber-500/10 rounded-lg p-3 mb-4 flex items-center justify-between gap-3">
              <span className="text-sm text-amber-700 dark:text-amber-400">You have worksheet changes that are not saved yet. Marking complete will save them.</span>
              <Button variant="outline" size="sm" onClick={saveAll} disabled={busy}>Save all worksheets</Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mb-4">{bank.qcp.rule}</p>
          <label className="text-sm font-medium">Laboratory director or designee (approval)</label>
          <Input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="Name of the approving director or designee" className="mt-1 mb-4 max-w-md" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={complete} disabled={busy} className="gap-2">{busy ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />} Mark IQCP complete</Button>
            <Button variant="outline" onClick={downloadPdf} disabled={busy} className="gap-2"><Download size={16} /> Download IQCP PDF</Button>
          </div>
          <p className="text-xs text-muted-foreground mt-3">Final approval and clinical determination must be made by the laboratory director or designee. The PDF reflects the currently saved plan; save your worksheets first.</p>
        </CardContent></Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function RiskSection({ bank, rows, setRows, onSave, onDirty, busy }: any) {
  const addRow = (component: string, source = "") => { setRows((r: RiskRow[]) => [...r, { component, phase: "", source_of_error: source, reducible: "", mitigation: "" }]); onDirty(); };
  const update = (i: number, key: keyof RiskRow, v: string) => { setRows((r: RiskRow[]) => r.map((row, idx) => idx === i ? { ...row, [key]: v } : row)); onDirty(); };
  const remove = (i: number) => { setRows((r: RiskRow[]) => r.filter((_, idx) => idx !== i)); onDirty(); };
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">Identify the potential sources of error across the five components and three phases of testing. Use the questions under each component to prompt your thinking, then record the sources of error you find, whether each is reducible, and how you reduce it.</p>
      {bank.components.map((c: any) => (
        <details key={c.key} className="mb-3 border border-border rounded-lg">
          <summary className="cursor-pointer px-4 py-2 font-medium text-sm flex items-center justify-between">
            <span>{c.label}</span>
            <span className="text-xs text-muted-foreground">{rows.filter((r: RiskRow) => r.component === c.label).length} row(s)</span>
          </summary>
          <div className="px-4 pb-4">
            <div className="text-xs text-muted-foreground mb-3">
              <div className="font-medium mb-1">{c.prompt}</div>
              <ul className="list-disc pl-5 space-y-0.5">
                {c.generalQuestions.slice(0, 6).map((q: string, i: number) => (
                  <li key={i}><button className="text-left hover:text-primary" onClick={() => addRow(c.label, q)}>{q}</button></li>
                ))}
              </ul>
              <div className="mt-1 italic">Click a question to seed it as a source-of-error row.</div>
            </div>
            {rows.map((row: RiskRow, i: number) => row.component === c.label && (
              <div key={i} className="grid grid-cols-12 gap-2 items-start mb-2">
                <AutoTextarea value={row.source_of_error} onChange={(e: any) => update(i, "source_of_error", e.target.value)} placeholder="Source of error" className="col-span-5 text-sm" />
                <Select value={row.phase} onValueChange={(v) => update(i, "phase", v)}>
                  <SelectTrigger className="col-span-2 text-xs"><SelectValue placeholder="Phase" /></SelectTrigger>
                  <SelectContent>{PHASES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={row.reducible} onValueChange={(v) => update(i, "reducible", v)}>
                  <SelectTrigger className="col-span-1 text-xs px-1"><SelectValue placeholder="?" /></SelectTrigger>
                  <SelectContent>{REDUCIBLE.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
                <AutoTextarea value={row.mitigation} onChange={(e: any) => update(i, "mitigation", e.target.value)} placeholder="How you reduce it" className="col-span-3 text-sm" />
                <Button variant="ghost" size="sm" className="col-span-1" onClick={() => remove(i)}><Trash2 size={14} /></Button>
              </div>
            ))}
            <Button variant="outline" size="sm" className="mt-1 gap-1" onClick={() => addRow(c.label)}><Plus size={13} /> Add row</Button>
          </div>
        </details>
      ))}
      <Button onClick={onSave} disabled={busy} className="mt-3 gap-2">{busy ? <Loader2 className="animate-spin" size={16} /> : null} Save risk assessment</Button>
    </div>
  );
}

function QcpSection({ bank, rows, setRows, onSave, onDirty, busy }: any) {
  const add = () => { setRows((r: QcpRow[]) => [...r, { qc_type: "", frequency: "", acceptability_criteria: "", corrective_action: "" }]); onDirty(); };
  const update = (i: number, k: keyof QcpRow, v: string) => { setRows((r: QcpRow[]) => r.map((row, idx) => idx === i ? { ...row, [k]: v } : row)); onDirty(); };
  const remove = (i: number) => { setRows((r: QcpRow[]) => r.filter((_, idx) => idx !== i)); onDirty(); };
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-1">Define the QC that controls the risks you found: the type, frequency, and acceptability criteria, plus the corrective action when QC fails.</p>
      <p className="text-xs text-muted-foreground mb-4 italic">{bank.qcp.rule}</p>
      {rows.map((row: QcpRow, i: number) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-start mb-2">
          <Input value={row.qc_type} onChange={(e) => update(i, "qc_type", e.target.value)} placeholder="Type of QC" className="col-span-3 text-sm" />
          <Input value={row.frequency} onChange={(e) => update(i, "frequency", e.target.value)} placeholder="Frequency" className="col-span-2 text-sm" />
          <AutoTextarea value={row.acceptability_criteria} onChange={(e: any) => update(i, "acceptability_criteria", e.target.value)} placeholder="Acceptability criteria" className="col-span-3 text-sm" />
          <AutoTextarea value={row.corrective_action} onChange={(e: any) => update(i, "corrective_action", e.target.value)} placeholder="Corrective action" className="col-span-3 text-sm" />
          <Button variant="ghost" size="sm" className="col-span-1" onClick={() => remove(i)}><Trash2 size={14} /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="gap-1 mt-1" onClick={add}><Plus size={13} /> Add QC line</Button>
      <div><Button onClick={onSave} disabled={busy} className="mt-3 gap-2">{busy ? <Loader2 className="animate-spin" size={16} /> : null} Save quality control plan</Button></div>
    </div>
  );
}

function QaSection({ rows, setRows, onSave, onDirty, busy }: any) {
  const add = () => { setRows((r: QaRow[]) => [...r, { activity: "", frequency: "", assessment_method: "" }]); onDirty(); };
  const update = (i: number, k: keyof QaRow, v: string) => { setRows((r: QaRow[]) => r.map((row, idx) => idx === i ? { ...row, [k]: v } : row)); onDirty(); };
  const remove = (i: number) => { setRows((r: QaRow[]) => r.filter((_, idx) => idx !== i)); onDirty(); };
  return (
    <div>
      <p className="text-sm text-muted-foreground mb-4">Ongoing monitoring that the QCP is working. These CMS quality assessment activities are pre-filled, so set a frequency for the ones you use and add your own. Without QA, the IQCP is not complete.</p>
      {rows.map((row: QaRow, i: number) => (
        <div key={i} className="grid grid-cols-12 gap-2 items-start mb-2">
          <AutoTextarea value={row.activity} onChange={(e: any) => update(i, "activity", e.target.value)} placeholder="QA activity" className="col-span-6 text-sm" />
          <Input value={row.frequency} onChange={(e) => update(i, "frequency", e.target.value)} placeholder="Frequency" className="col-span-2 text-sm" />
          <AutoTextarea value={row.assessment_method} onChange={(e: any) => update(i, "assessment_method", e.target.value)} placeholder="How it is assessed" className="col-span-3 text-sm" />
          <Button variant="ghost" size="sm" className="col-span-1" onClick={() => remove(i)}><Trash2 size={14} /></Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="gap-1 mt-1" onClick={add}><Plus size={13} /> Add QA activity</Button>
      <div><Button onClick={onSave} disabled={busy} className="mt-3 gap-2">{busy ? <Loader2 className="animate-spin" size={16} /> : null} Save quality assessment</Button></div>
    </div>
  );
}
