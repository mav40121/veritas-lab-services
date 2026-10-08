// client/src/pages/InstrumentTrailPage.tsx
//
// One analyzer's QC trail (2026-10-08, St. Charles: "show us how an auditor or
// inspector could trace a QC failure, corrective action, and resolution for a
// specific analyzer"). Reads GET /api/labs/:labId/instruments/:id/trail: every
// QC run on the analyzer that tripped a Westgard rule, the corrective actions
// filed on it, how and when each was closed out, any VeritaResponse finding it
// was escalated to, and the calibration / maintenance logged on the equipment
// record linked to the same analyzer, newest first. Read-only.

import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Wrench, Printer, ClipboardList } from "lucide-react";

interface Violation { id: number; rule_code: string; severity: "warning" | "rejection"; detail: string | null }
interface Finding { id: number; status?: string; signed_by?: string | null; signed_at?: string | null; completion_date?: string | null }
interface CorrectiveAction {
  id: number;
  action_taken: string;
  taken_at: string;
  taken_by_name: string | null;
  status: string;
  follow_up_notes: string | null;
  resolution_notes: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  finding: Finding | null;
}
interface Note { id: number; note: string; author_name: string; created_at: string }
interface Failure {
  id: number;
  result_date: string;
  run_time: string | null;
  result_value: number;
  analyte: string;
  level: string;
  lot_number: string;
  operator_name: string | null;
  accepted_for_reporting: number;
  voided_at: string | null;
  void_reason: string | null;
  matched_by: "linked" | "name";
  violations: Violation[];
  has_rejection: boolean;
  corrective_actions: CorrectiveAction[];
  notes: Note[];
}
interface MaintEvent {
  id: number;
  event_type: string;
  event_date: string;
  performed_by: string | null;
  next_due_date: string | null;
  notes: string | null;
  instrument_name: string;
}
interface Trail {
  instrument: { id: number; instrument_name: string; nickname: string | null; serial_number: string | null; map_name: string | null };
  period: { since: string; days: number };
  summary: {
    runs: number; runs_with_flags: number; rejections: number; rejections_without_action: number;
    corrective_actions: number; corrective_actions_open: number; corrective_actions_closed: number; maintenance_events: number;
  };
  failures: Failure[];
  equipment: { id: number; instrument_name: string }[];
  maintenance: MaintEvent[];
}

const EVENT_LABEL: Record<string, string> = {
  calibration: "Calibration",
  preventive_maintenance: "Preventive maintenance",
  pm: "Preventive maintenance",
  service: "Service",
  repair: "Repair",
  function_check: "Function check",
};

function Tile({ label, value, tone }: { label: string; value: number; tone?: "bad" | "good" | "warn" }) {
  const color = tone === "bad" && value > 0 ? "text-red-700 dark:text-red-400"
    : tone === "warn" && value > 0 ? "text-amber-700 dark:text-amber-400"
    : tone === "good" ? "text-emerald-700 dark:text-emerald-400" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}

export default function InstrumentTrailPage() {
  const params = useParams<{ instrumentId: string }>();
  const activeLabId = useActiveLabId();
  const labRoute = useLabRoute();
  const [days, setDays] = useState("365");
  const [trail, setTrail] = useState<Trail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeLabId || !params.instrumentId) return;
    setLoading(true);
    fetch(`${API_BASE}/api/labs/${activeLabId}/instruments/${params.instrumentId}/trail?days=${days}`, { headers: authHeaders() })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Could not load the trail (${r.status})`);
        setTrail(j); setError(null);
      })
      .catch((e) => { setTrail(null); setError(e.message); })
      .finally(() => setLoading(false));
  }, [activeLabId, params.instrumentId, days]);

  const inst = trail?.instrument;
  const title = inst ? (inst.nickname ? `${inst.nickname} (${inst.instrument_name})` : inst.instrument_name) : "Analyzer";

  // One timeline, newest first: QC failures and maintenance events interleaved by date.
  type Item = { kind: "qc"; date: string; key: string; f: Failure } | { kind: "maint"; date: string; key: string; m: MaintEvent };
  const items: Item[] = trail
    ? [
        ...trail.failures.map((f) => ({ kind: "qc" as const, date: `${f.result_date} ${f.run_time || ""}`, key: `qc-${f.id}`, f })),
        ...trail.maintenance.map((m) => ({ kind: "maint" as const, date: m.event_date, key: `m-${m.id}`, m })),
      ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    : [];

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4" data-testid="instrument-trail-page">
      <div className="flex items-center justify-between gap-2 mb-4 print:hidden">
        <Link href={labRoute("/veritaqc-app")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> VeritaQC
        </Link>
        <div className="flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-40 h-8 text-xs" data-testid="trail-period"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="180">Last 6 months</SelectItem>
              <SelectItem value="365">Last 12 months</SelectItem>
              <SelectItem value="730">Last 2 years</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Print</Button>
        </div>
      </div>

      <h1 className="font-serif text-2xl font-bold" style={{ color: "#01696F" }} data-testid="trail-title">QC trail: {title}</h1>
      {inst && (
        <p className="text-sm text-muted-foreground mt-1">
          {[inst.serial_number ? `SN ${inst.serial_number}` : null, inst.map_name ? `Test menu: ${inst.map_name}` : null, trail ? `Since ${trail.period.since}` : null].filter(Boolean).join(" · ")}
        </p>
      )}

      {loading && <p className="text-sm text-muted-foreground mt-6">Loading the trail...</p>}
      {error && !loading && <p className="text-sm text-red-700 mt-6">{error}</p>}

      {trail && !loading && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5" data-testid="trail-summary">
            <Tile label="QC runs" value={trail.summary.runs} />
            <Tile label="Runs flagged" value={trail.summary.runs_with_flags} tone="warn" />
            <Tile label="Rejections" value={trail.summary.rejections} tone="warn" />
            <Tile label="Rejections with no action" value={trail.summary.rejections_without_action} tone="bad" />
            <Tile label="Corrective actions" value={trail.summary.corrective_actions} />
            <Tile label="Still open" value={trail.summary.corrective_actions_open} tone="bad" />
            <Tile label="Closed out" value={trail.summary.corrective_actions_closed} tone="good" />
            <Tile label="Maintenance events" value={trail.summary.maintenance_events} />
          </div>
          {trail.equipment.length === 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              No equipment record is linked to this analyzer yet, so calibration and maintenance are not shown. Link it in{" "}
              <Link href={labRoute("/equipment-app")} className="underline">VeritaMaintain</Link>.
            </p>
          )}

          <Card className="mt-5">
            <CardHeader className="pb-2"><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="trail-empty">No QC flags or maintenance on this analyzer in the period.</p>
              ) : (
                <ol className="space-y-3" data-testid="trail-timeline">
                  {items.map((it) => it.kind === "qc" ? (
                    <li key={it.key} className={`rounded-lg border p-3 ${it.f.has_rejection ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5"}`} data-testid={`trail-qc-${it.f.id}`}>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <AlertTriangle className={`h-4 w-4 ${it.f.has_rejection ? "text-red-600" : "text-amber-600"}`} />
                        <span className="font-medium">{it.f.result_date}{it.f.run_time ? ` ${it.f.run_time}` : ""}</span>
                        <span>{it.f.analyte} · {it.f.level} · lot {it.f.lot_number}</span>
                        <span className="font-mono">value {it.f.result_value}</span>
                        {it.f.violations.map((v) => (
                          <Badge key={v.id} variant="outline" title={v.detail || ""}
                            className={v.severity === "rejection" ? "bg-red-500/10 text-red-700 border-red-500/30 dark:text-red-400" : "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400"}>
                            {v.rule_code} {v.severity === "rejection" ? "rejection" : "warning"}
                          </Badge>
                        ))}
                        {it.f.matched_by === "name" && (
                          <Badge variant="outline" className="text-muted-foreground" title="Recorded before analyzers were linked; matched on the analyzer name typed with the run">matched by name</Badge>
                        )}
                        {it.f.voided_at && <Badge variant="outline" className="text-muted-foreground">voided{it.f.void_reason ? `: ${it.f.void_reason}` : ""}</Badge>}
                        {!it.f.voided_at && it.f.accepted_for_reporting === 0 && <Badge variant="outline" className="text-muted-foreground">excluded from baseline</Badge>}
                      </div>
                      {it.f.operator_name && <div className="text-xs text-muted-foreground mt-1">Run by {it.f.operator_name}</div>}

                      {it.f.corrective_actions.length === 0 ? (
                        it.f.has_rejection && (
                          <div className="mt-2 text-sm text-red-700 dark:text-red-400 font-medium" data-testid={`trail-missing-ca-${it.f.id}`}>No corrective action filed</div>
                        )
                      ) : (
                        <div className="mt-2 space-y-2">
                          {it.f.corrective_actions.map((c) => (
                            <div key={c.id} className="rounded-md border border-border bg-card p-2 text-sm" data-testid={`trail-ca-${c.id}`}>
                              <div><span className="font-medium">Corrective action</span> <span className="text-xs text-muted-foreground">filed {c.taken_at.slice(0, 16).replace("T", " ")}{c.taken_by_name ? ` by ${c.taken_by_name}` : ""}</span></div>
                              <div className="mt-0.5 whitespace-pre-wrap">{c.action_taken}</div>
                              {c.follow_up_notes && <div className="text-xs text-muted-foreground mt-0.5">Follow-up: {c.follow_up_notes}</div>}
                              {c.resolved_at ? (
                                <div className="mt-1.5 flex items-start gap-1.5 text-emerald-700 dark:text-emerald-400" data-testid={`trail-ca-closed-${c.id}`}>
                                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                                  <div>
                                    <div className="font-medium">Closed out {c.resolved_at.slice(0, 16).replace("T", " ")}{c.resolved_by_name ? ` by ${c.resolved_by_name}` : ""}</div>
                                    {c.resolution_notes && <div className="text-foreground whitespace-pre-wrap">{c.resolution_notes}</div>}
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-1.5 flex items-center gap-1.5 text-amber-700 dark:text-amber-400"><Clock className="h-4 w-4" /> Open</div>
                              )}
                              {c.finding && (
                                <div className="mt-1.5 text-xs flex items-center gap-1.5">
                                  <ClipboardList className="h-3.5 w-3.5 text-teal-700" />
                                  <Link href={labRoute(`/veritaresponse/${c.finding.id}`)} className="text-teal-700 hover:underline">VeritaResponse #{c.finding.id}</Link>
                                  {c.finding.status && <span className="text-muted-foreground">({c.finding.status}{c.finding.signed_by ? `, signed by ${c.finding.signed_by}` : ""})</span>}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {it.f.notes.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {it.f.notes.map((n) => (
                            <li key={n.id} className="text-xs text-muted-foreground">Note, {n.author_name}, {n.created_at.slice(0, 16).replace("T", " ")}: {n.note}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ) : (
                    <li key={it.key} className="rounded-lg border border-border p-3" data-testid={`trail-maint-${it.m.id}`}>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Wrench className="h-4 w-4 text-teal-700" />
                        <span className="font-medium">{it.m.event_date}</span>
                        <span>{EVENT_LABEL[it.m.event_type] || it.m.event_type}</span>
                        {it.m.performed_by && <span className="text-muted-foreground">by {it.m.performed_by}</span>}
                        {it.m.next_due_date && <span className="text-xs text-muted-foreground">next due {it.m.next_due_date}</span>}
                      </div>
                      {it.m.notes && <div className="text-sm mt-1 whitespace-pre-wrap">{it.m.notes}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
