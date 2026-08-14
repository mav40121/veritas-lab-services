import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Lock, FlaskConical, LineChart } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ModuleHowToCard } from "@/components/ModuleHowToCard";

interface ControlLot {
  id: number;
  analyte: string;
  level: string;
  lot_number: string;
  manufacturer: string | null;
  mfr_mean: number;
  mfr_sd: number;
  mfr_sd_interval: number;
  mfr_range_low: number | null;
  mfr_range_high: number | null;
  expiration_date: string | null;
  opened_date: string | null;
  status: string;
  prior_lot_id: number | null;
  created_at: string;
}

// One point on the continuous cross-lot Levey-Jennings series. SDI is computed
// server-side against the point's OWN lot's mean/SD, so a lot change re-centers.
interface LinePoint {
  id: number;
  control_lot_id: number;
  lot_number: string;
  result_value: number;
  result_date: string;
  mfr_mean: number;
  mfr_sd: number;
  sdi: number;
  is_rejection: boolean;
  accepted_for_reporting: number;
}

interface LineData {
  analyte: string;
  level: string;
  lots: ControlLot[];
  points: LinePoint[];
}

interface ViolationRow {
  id: number;
  qc_result_id: number;
  rule_code: string;
  severity: "warning" | "rejection";
  detail: string | null;
  related_result_ids: string | null;
  evaluated_at: string;
}

interface CorrectiveActionRow {
  id: number;
  qc_result_id: number;
  qc_rule_violation_id: number | null;
  action_taken: string;
  taken_by_user_id: number;
  taken_at: string;
  status: string;
  follow_up_notes: string | null;
  nce_reference: string | null;
}

interface ResultRow {
  id: number;
  control_lot_id: number;
  instrument: string | null;
  result_value: number;
  result_date: string;
  run_time: string | null;
  operator_user_id: number | null;
  comment: string | null;
  voided_at: string | null;
  voided_by_user_id: number | null;
  void_reason: string | null;
  accepted_for_reporting: number;
  created_at: string;
  violations: ViolationRow[];
  corrective_actions: CorrectiveActionRow[];
}

// Submit-time response that surfaces violations + the corrective-action gate
// for the in-the-moment workflow. Mirrors the POST /api/labs/:id/qc/results
// response shape from server/routes.ts Phase 1A.
interface SubmitResponse {
  ok: boolean;
  result_id: number;
  violations: ViolationRow[];
  requires_corrective_action: boolean;
}

function severityColor(severity: string): string {
  return severity === "rejection"
    ? "bg-red-500/10 text-red-700 border-red-500/20"
    : "bg-amber-500/10 text-amber-700 border-amber-500/20";
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// Inline Levey-Jennings chart for the selected control lot. Plots each logged
// result as its SDI (value minus baseline mean, over SD) against the classic
// Westgard zones: green within 2 SD, amber 2 to 3 SD, red beyond 3 SD. Points
// that fired a rejection are drawn red. This is the on-screen companion to the
// month-end PDF chart, so a tech (or a prospect on a demo) watches the chart
// populate live instead of only seeing it after a download.
function LeveyJenningsChart({ mean, sd, results }: { mean: number; sd: number; results: ResultRow[] }) {
  if (!(sd > 0) || results.length === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Log a QC result to see the Levey-Jennings chart.</div>;
  }
  const W = 560, H = 210, PL = 34, PR = 10, PT = 12, PB = 26;
  const innerW = W - PL - PR, innerH = H - PT - PB;
  const pts = [...results].reverse(); // results arrive newest-first; chronological left to right
  const n = pts.length;
  const sdMin = -4, sdMax = 4;
  const yFor = (s: number) => PT + innerH * (1 - (s - sdMin) / (sdMax - sdMin));
  const xFor = (i: number) => PL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const bands = [
    { a: -4, b: -3, fill: "#fde2e2" }, { a: -3, b: -2, fill: "#fef2cc" },
    { a: -2, b: 2, fill: "#e3f2e1" }, { a: 2, b: 3, fill: "#fef2cc" },
    { a: 3, b: 4, fill: "#fde2e2" },
  ];
  const sdis = pts.map(r => (r.result_value - mean) / sd);
  const poly = sdis.map((s, i) => `${xFor(i)},${yFor(s)}`).join(" ");
  // Calculated mean/SD of the plotted values (sample SD, n-1), shown next to the
  // programmed manufacturer mean/SD so the tech can compare the two at a glance.
  const vals = pts.map(r => r.result_value);
  const calcMean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const calcSd = vals.length > 1 ? Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - calcMean, 2), 0) / (vals.length - 1)) : 0;
  const fmtStat = (x: number) => !Number.isFinite(x) ? "-" : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(3);
  return (
    <>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Levey-Jennings chart" className="text-muted-foreground">
      {bands.map((bd, i) => (
        <rect key={i} x={PL} y={yFor(bd.b)} width={innerW} height={yFor(bd.a) - yFor(bd.b)} fill={bd.fill} />
      ))}
      {[-3, -2, -1, 0, 1, 2, 3].map(s => (
        <line key={s} x1={PL} y1={yFor(s)} x2={PL + innerW} y2={yFor(s)} stroke={s === 0 ? "#01696F" : "#a0a0a0"} strokeWidth={s === 0 ? 1.2 : 0.5} strokeDasharray={s === 0 ? undefined : "2,2"} />
      ))}
      {[-3, -2, -1, 0, 1, 2, 3].map(s => (
        <text key={s} x={PL - 4} y={yFor(s) + 3} fontSize="8" fill="currentColor" textAnchor="end">{s > 0 ? `+${s}` : s}</text>
      ))}
      <polyline points={poly} fill="none" stroke="#1a1a1a" strokeWidth={0.8} />
      {sdis.map((s, i) => {
        const rejected = pts[i].violations?.some(v => v.severity === "rejection");
        const color = rejected || Math.abs(s) > 3 ? "#dc2626" : Math.abs(s) > 2 ? "#d97706" : "#16a34a";
        return (
          <circle key={i} cx={xFor(i)} cy={yFor(s)} r={3} fill={color} stroke="#fff" strokeWidth={0.6}>
            <title>{`${pts[i].result_date}: ${pts[i].result_value} (SDI ${s.toFixed(2)})${pts[i].comment ? ` · ${pts[i].comment}` : ""}`}</title>
          </circle>
        );
      })}
      <text x={PL + innerW / 2} y={H - 6} fontSize="8" fill="currentColor" textAnchor="middle">Run sequence (oldest to newest, n={n})</text>
      <text x="9" y={PT + innerH / 2} fontSize="8" fill="currentColor" textAnchor="middle" transform={`rotate(-90,9,${PT + innerH / 2})`}>SDI from mean</text>
    </svg>
    <div className="flex items-start justify-between gap-4 mt-1 px-1 text-xs">
      <div>
        <div className="font-medium text-muted-foreground">Programmed (manufacturer)</div>
        <div className="font-mono text-foreground">Mean {fmtStat(mean)} · SD {fmtStat(sd)}</div>
      </div>
      <div className="text-right">
        <div className="font-medium text-muted-foreground">Calculated (n={n})</div>
        <div className="font-mono text-foreground">Mean {fmtStat(calcMean)} · SD {fmtStat(calcSd)}</div>
      </div>
    </div>
    </>
  );
}

// Continuous cross-lot Levey-Jennings chart. Plots every result of a control
// line (analyte + level) across all its lots in one chronological series. Each
// point's SDI is measured against its OWN lot's mean/SD (computed server-side),
// so a lot change re-centers rather than smearing one baseline across two
// materials. A vertical dashed marker + lot-number label sits at every
// changeover, and each lot's segment gets a faint alternating tint so the "shift"
// from one lot to the next is legible at a glance. This is the surveyor-facing
// proof that QC continuity was maintained through a lot changeover.
function ContinuousLeveyJenningsChart({ points }: { points: LinePoint[] }) {
  if (points.length === 0) {
    return <div className="text-sm text-muted-foreground py-8 text-center">No results across this control line's lots yet.</div>;
  }
  const W = 620, H = 224, PL = 34, PR = 10, PT = 14, PB = 40;
  const innerW = W - PL - PR, innerH = H - PT - PB;
  const n = points.length;
  const sdMin = -4, sdMax = 4;
  const yFor = (s: number) => PT + innerH * (1 - (s - sdMin) / (sdMax - sdMin));
  const xFor = (i: number) => PL + (n === 1 ? innerW / 2 : (innerW * i) / (n - 1));
  const bands = [
    { a: -4, b: -3, fill: "#fde2e2" }, { a: -3, b: -2, fill: "#fef2cc" },
    { a: -2, b: 2, fill: "#e3f2e1" }, { a: 2, b: 3, fill: "#fef2cc" },
    { a: 3, b: 4, fill: "#fde2e2" },
  ];
  // Contiguous runs of the same lot => segments; boundaries between them are the
  // changeover markers.
  const segments: { lotId: number; lotNumber: string; start: number; end: number }[] = [];
  points.forEach((p, i) => {
    const last = segments[segments.length - 1];
    if (last && last.lotId === p.control_lot_id) last.end = i;
    else segments.push({ lotId: p.control_lot_id, lotNumber: p.lot_number, start: i, end: i });
  });
  const lotCount = segments.length;
  const poly = points.map((p, i) => `${xFor(i)},${yFor(p.sdi)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Continuous Levey-Jennings chart across lots" className="text-muted-foreground">
      {bands.map((bd, i) => (
        <rect key={`b${i}`} x={PL} y={yFor(bd.b)} width={innerW} height={yFor(bd.a) - yFor(bd.b)} fill={bd.fill} />
      ))}
      {/* Alternating faint tint per lot segment so the changeover is obvious. */}
      {segments.map((seg, si) => {
        if (si % 2 === 0) return null;
        const x0 = seg.start === 0 ? PL : (xFor(seg.start - 1) + xFor(seg.start)) / 2;
        const x1 = seg.end === n - 1 ? PL + innerW : (xFor(seg.end) + xFor(seg.end + 1)) / 2;
        return <rect key={`seg${si}`} x={x0} y={PT} width={Math.max(0, x1 - x0)} height={innerH} fill="#0f172a" opacity={0.045} />;
      })}
      {[-3, -2, -1, 0, 1, 2, 3].map(s => (
        <line key={`z${s}`} x1={PL} y1={yFor(s)} x2={PL + innerW} y2={yFor(s)} stroke={s === 0 ? "#01696F" : "#a0a0a0"} strokeWidth={s === 0 ? 1.2 : 0.5} strokeDasharray={s === 0 ? undefined : "2,2"} />
      ))}
      {[-3, -2, -1, 0, 1, 2, 3].map(s => (
        <text key={`zl${s}`} x={PL - 4} y={yFor(s) + 3} fontSize="8" fill="currentColor" textAnchor="end">{s > 0 ? `+${s}` : s}</text>
      ))}
      {/* Changeover markers: a vertical dashed rule at each lot boundary. */}
      {segments.slice(1).map((seg, si) => {
        const x = (xFor(seg.start - 1) + xFor(seg.start)) / 2;
        return (
          <g key={`m${si}`}>
            <line x1={x} y1={PT} x2={x} y2={PT + innerH} stroke="#b45309" strokeWidth={1.1} strokeDasharray="3,2" />
            <text x={x} y={PT + 8} fontSize="7.5" fill="#b45309" textAnchor="middle" fontWeight="600">lot change</text>
          </g>
        );
      })}
      <polyline points={poly} fill="none" stroke="#1a1a1a" strokeWidth={0.8} />
      {points.map((p, i) => {
        const s = p.sdi;
        const color = p.is_rejection || Math.abs(s) > 3 ? "#dc2626" : Math.abs(s) > 2 ? "#d97706" : "#16a34a";
        return (
          <circle key={i} cx={xFor(i)} cy={yFor(s)} r={2.6} fill={color} stroke="#fff" strokeWidth={0.6}>
            <title>{`${p.result_date} · Lot ${p.lot_number}: ${p.result_value} (SDI ${s.toFixed(2)})`}</title>
          </circle>
        );
      })}
      {/* Per-lot label centered under each segment. */}
      {segments.map((seg, si) => {
        const cx = (xFor(seg.start) + xFor(seg.end)) / 2;
        return <text key={`sl${si}`} x={cx} y={H - 16} fontSize="7.5" fill="#334155" textAnchor="middle" fontWeight="600">Lot {seg.lotNumber}</text>;
      })}
      <text x={PL + innerW / 2} y={H - 4} fontSize="8" fill="currentColor" textAnchor="middle">Continuous across {lotCount} lot{lotCount === 1 ? "" : "s"} &middot; n={n} (oldest to newest)</text>
      <text x="9" y={PT + innerH / 2} fontSize="8" fill="currentColor" textAnchor="middle" transform={`rotate(-90,9,${PT + innerH / 2})`}>SDI from mean</text>
    </svg>
  );
}

export default function VeritaQCAppPage() {
  const { user, isLoggedIn } = useAuth();
  const isReadOnly = useIsReadOnly("veritaqc");
  const activeLabId = useActiveLabId();
  const { toast } = useToast();

  // Explicit allowlist per CLAUDE.md §8 / VeritaLabAppPage canonical pattern.
  // VeritaQC is part of the VeritaAssure suite; mirror the same plan set.
  const hasPlanAccess = !!user && [
    "annual", "professional", "lab", "complete",
    "veritamap", "veritascan", "veritacomp",
    "clinic", "waived", "community", "hospital", "large_hospital", "enterprise",
  ].includes(user.plan);

  const [lots, setLots] = useState<ControlLot[]>([]);
  const [loadingLots, setLoadingLots] = useState(true);
  const [lotsError, setLotsError] = useState(false);
  const [selectedLotId, setSelectedLotId] = useState<number | null>(null);

  const [results, setResults] = useState<ResultRow[]>([]);
  const [chartPoints, setChartPoints] = useState<string>("30"); // visible LJ points; "all" shows every loaded point
  const [loadingResults, setLoadingResults] = useState(false);
  const [resultsError, setResultsError] = useState(false);

  // Entry form state
  const [formValue, setFormValue] = useState("");
  const [formDate, setFormDate] = useState(todayIsoDate());
  const [formInstrument, setFormInstrument] = useState("");
  const [formRunTime, setFormRunTime] = useState("");
  const [formComment, setFormComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Corrective-action modal state. Driven by the requires_corrective_action
  // flag in the POST response. Modal cannot be dismissed without a CA filed.
  const [caModalOpen, setCaModalOpen] = useState(false);
  const [caForResultId, setCaForResultId] = useState<number | null>(null);
  const [caForViolation, setCaForViolation] = useState<ViolationRow | null>(null);
  const [caActionTaken, setCaActionTaken] = useState("");
  const [caExcludeFromBaseline, setCaExcludeFromBaseline] = useState(true);
  const [caFollowUp, setCaFollowUp] = useState("");
  const [caSubmitting, setCaSubmitting] = useState(false);
  // Audit #13: after repeated CA-save failures, allow the tech to dismiss the
  // (otherwise-forced) modal. The QC result is already persisted; the CA is
  // resolvable from the Daily Review missing-CA action.
  const [caFailCount, setCaFailCount] = useState(0);

  // Add-Control-Lot dialog state. Drives the 8-field form that creates a
  // new entry in qc_control_lots via POST /api/labs/:labId/qc/control-lots.
  // On success the dropdown auto-selects the new lot so the tech can log
  // a result against it immediately.
  const [addLotOpen, setAddLotOpen] = useState(false);
  const [newAnalyte, setNewAnalyte] = useState("");
  const [newLotNumber, setNewLotNumber] = useState("");
  const [newLevel, setNewLevel] = useState<"low" | "mid" | "high">("mid");
  const [newManufacturer, setNewManufacturer] = useState("");
  const [newMfrMean, setNewMfrMean] = useState("");
  const [newMfrSd, setNewMfrSd] = useState("");
  const [newSdInterval, setNewSdInterval] = useState<"2" | "3">("2");
  const [newExpiration, setNewExpiration] = useState("");
  const [newOpened, setNewOpened] = useState("");
  const [addLotSubmitting, setAddLotSubmitting] = useState(false);
  const [retireSubmitting, setRetireSubmitting] = useState(false);

  // Continuous cross-lot ("Span all lots") view state. When on, the chart plots
  // the whole control line (analyte + level) across every lot with a shift
  // marker at each changeover, fetched from GET /qc/line.
  const [spanAllLots, setSpanAllLots] = useState(false);
  const [lineData, setLineData] = useState<LineData | null>(null);
  const [loadingLine, setLoadingLine] = useState(false);
  const [lineError, setLineError] = useState(false);

  // Changeover ("Start new lot") dialog state. Creates a replacement lot on the
  // same control line via POST /qc/control-lots/:id/changeover.
  const [changeoverOpen, setChangeoverOpen] = useState(false);
  const [coLotNumber, setCoLotNumber] = useState("");
  const [coManufacturer, setCoManufacturer] = useState("");
  const [coMean, setCoMean] = useState("");
  const [coSd, setCoSd] = useState("");
  const [coSdInterval, setCoSdInterval] = useState<"2" | "3">("2");
  const [coExpiration, setCoExpiration] = useState("");
  const [coOpened, setCoOpened] = useState(todayIsoDate());
  const [coRetirePrior, setCoRetirePrior] = useState(true);
  const [coSubmitting, setCoSubmitting] = useState(false);

  async function loadLots() {
    if (!activeLabId) return;
    setLoadingLots(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/qc/lots`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`lots ${res.status}`);
      const data = await res.json();
      setLots(data.lots || []);
      if (data.lots && data.lots.length > 0 && selectedLotId === null) {
        const firstActive = data.lots.find((l: ControlLot) => l.status === "active") || data.lots[0];
        setSelectedLotId(firstActive.id);
      }
      setLotsError(false);
    } catch (err) {
      // Audit #8: a failed lot load must not read as "no control lots yet"
      // (which invites re-creating existing lots). Flag the error instead.
      console.error("Failed to load lots:", err);
      setLotsError(true);
    } finally {
      setLoadingLots(false);
    }
  }

  async function loadResults(lotId: number) {
    if (!activeLabId) return;
    setLoadingResults(true);
    // Audit #3: clear stale rows before the fetch so a failed lot-switch does
    // NOT leave the previous lot's results displayed under the new lot's header.
    setResults([]);
    try {
      const res = await fetch(
        `${API_BASE}/api/labs/${activeLabId}/qc/results?control_lot_id=${lotId}&limit=200`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error(`results ${res.status}`);
      const data = await res.json();
      setResults(data.results || []);
      setResultsError(false);
    } catch (err) {
      console.error("Failed to load results:", err);
      setResultsError(true);
    } finally {
      setLoadingResults(false);
    }
  }

  // Void (soft-delete) a QC result: wrong lot, wrong level, mis-keyed run. The
  // row stays in the audit trail but drops off the chart, stats, Westgard, and
  // the monthly review. A reason is required.
  async function voidResult(r: ResultRow) {
    if (!activeLabId) return;
    const reason = window.prompt(
      `Void this QC result?\n\n${r.result_value} on ${r.result_date}\n\nEnter a reason (wrong lot, wrong level, mis-keyed run). It stays in the audit trail but no longer counts toward the chart, statistics, or monthly review.`
    );
    if (reason == null) return; // cancelled
    if (!reason.trim()) {
      toast({ title: "A reason is required to void a result", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/qc/results/${r.id}/void`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) throw new Error(`void ${res.status}`);
      toast({ title: "Result voided" });
      if (selectedLotId) await loadResults(selectedLotId);
    } catch (err) {
      toast({ title: "Void failed", description: String(err), variant: "destructive" });
    }
  }

  async function loadLineResults(analyte: string, level: string) {
    if (!activeLabId) return;
    setLoadingLine(true);
    setLineError(false);
    try {
      const res = await fetch(
        `${API_BASE}/api/labs/${activeLabId}/qc/line?analyte=${encodeURIComponent(analyte)}&level=${encodeURIComponent(level)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error(`line ${res.status}`);
      const data = await res.json();
      setLineData(data);
    } catch (err) {
      console.error("Failed to load line history:", err);
      setLineError(true);
      setLineData(null);
    } finally {
      setLoadingLine(false);
    }
  }

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess && activeLabId) loadLots();
  }, [isLoggedIn, hasPlanAccess, activeLabId]);

  useEffect(() => {
    if (selectedLotId) loadResults(selectedLotId);
  }, [selectedLotId, activeLabId]);

  // When the continuous view is on, (re)load the whole control line for the
  // selected lot's analyte + level. Re-runs on lot switch and after a changeover
  // (which moves selectedLotId to the new lot).
  useEffect(() => {
    const lot = lots.find(l => l.id === selectedLotId);
    if (spanAllLots && lot) loadLineResults(lot.analyte, lot.level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanAllLots, selectedLotId, lots]);

  // Prefill the instrument from the selected lot's analyte when it encodes the
  // analyzer (e.g. "PSA (FREND A)") so the tech does not retype it and it is
  // clear which analyzer the run is for. Analytes with no embedded analyzer
  // get an empty field the tech fills from the dropdown or free text.
  useEffect(() => {
    const lot = lots.find(l => l.id === selectedLotId);
    const m = lot?.analyte.match(/\(([^)]+)\)\s*$/);
    setFormInstrument(m ? m[1].trim() : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLotId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeLabId || !selectedLotId) {
      toast({ title: "Pick a control lot before submitting", variant: "destructive" });
      return;
    }
    const valueNum = Number(formValue);
    if (!formValue || Number.isNaN(valueNum)) {
      toast({ title: "Result value must be a number", variant: "destructive" });
      return;
    }
    if (!formDate) {
      toast({ title: "Result date required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/qc/results`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          control_lot_id: selectedLotId,
          result_value: valueNum,
          result_date: formDate,
          instrument: formInstrument || null,
          run_time: formRunTime || null,
          comment: formComment || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: err.error || "Submit failed", variant: "destructive" });
        return;
      }
      const data: SubmitResponse = await res.json();
      // Clear the form so the tech doesn't re-submit the same value
      setFormValue("");
      setFormComment("");
      // Reload the table so the new row shows up at the top
      await loadResults(selectedLotId);
      // If the continuous view is open, refresh it too so the new point lands.
      if (spanAllLots && selectedLot) loadLineResults(selectedLot.analyte, selectedLot.level);
      if (data.requires_corrective_action) {
        const firstRejection = data.violations.find(v => v.severity === "rejection") || null;
        setCaForResultId(data.result_id);
        setCaForViolation(firstRejection);
        setCaActionTaken("");
        setCaExcludeFromBaseline(true);
        setCaFollowUp("");
        setCaFailCount(0);
        setCaModalOpen(true);
      } else if (data.violations.length > 0) {
        toast({
          title: `Warning: ${data.violations.map(v => v.rule_code).join(", ")}`,
          description: "Logged. Review at monthly attestation.",
        });
      } else {
        toast({ title: "Result logged", description: "No Westgard rules fired." });
      }
    } catch (err: any) {
      toast({ title: err.message || "Submit failed", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCaSubmit() {
    if (!activeLabId || !caForResultId) return;
    if (!caActionTaken.trim()) {
      toast({ title: "Describe the corrective action before saving", variant: "destructive" });
      return;
    }
    setCaSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/qc/corrective-actions`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          qc_result_id: caForResultId,
          qc_rule_violation_id: caForViolation?.id || null,
          action_taken: caActionTaken.trim(),
          follow_up_notes: caFollowUp || null,
          exclude_from_baseline: caExcludeFromBaseline,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: err.error || "Corrective action save failed", variant: "destructive" });
        setCaFailCount(c => c + 1);
        return;
      }
      toast({ title: "Corrective action filed" });
      setCaModalOpen(false);
      setCaForResultId(null);
      setCaForViolation(null);
      setCaFailCount(0);
      if (selectedLotId) await loadResults(selectedLotId);
    } catch (err: any) {
      toast({ title: err.message || "Save failed", variant: "destructive" });
      setCaFailCount(c => c + 1);
    } finally {
      setCaSubmitting(false);
    }
  }

  function resetAddLotForm() {
    setNewAnalyte("");
    setNewLotNumber("");
    setNewLevel("mid");
    setNewManufacturer("");
    setNewMfrMean("");
    setNewMfrSd("");
    setNewSdInterval("2");
    setNewExpiration("");
    setNewOpened("");
  }

  async function handleAddLot() {
    if (!activeLabId) return;
    if (!newAnalyte.trim() || !newLotNumber.trim()) {
      toast({ title: "Analyte and lot number are required", variant: "destructive" });
      return;
    }
    const meanN = Number(newMfrMean);
    const sdN = Number(newMfrSd);
    if (!Number.isFinite(meanN)) {
      toast({ title: "Manufacturer mean must be a number", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(sdN) || sdN <= 0) {
      toast({ title: "Manufacturer SD must be a positive number", variant: "destructive" });
      return;
    }
    setAddLotSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/qc/control-lots`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          analyte: newAnalyte.trim(),
          lot_number: newLotNumber.trim(),
          level: newLevel,
          manufacturer: newManufacturer.trim() || null,
          mfr_mean: meanN,
          mfr_sd: sdN,
          mfr_sd_interval: Number(newSdInterval),
          expiration_date: newExpiration || null,
          opened_date: newOpened || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: res.status === 409 ? "Duplicate lot" : "Could not add control lot",
          description: err.error || `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      const data = await res.json();
      toast({ title: `Added ${data.lot.analyte} lot ${data.lot.lot_number}` });
      resetAddLotForm();
      setAddLotOpen(false);
      await loadLots();
      // Auto-select the new lot so the tech can log a result against it.
      setSelectedLotId(data.lot.id);
    } catch (err: any) {
      toast({ title: err.message || "Could not add control lot", variant: "destructive" });
    } finally {
      setAddLotSubmitting(false);
    }
  }

  async function handleRetireLot(lotId: number, nextStatus: "retired" | "hold" | "active") {
    if (!activeLabId) return;
    setRetireSubmitting(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/labs/${activeLabId}/qc/control-lots/${lotId}`,
        {
          method: "PATCH",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: err.error || "Could not update lot status", variant: "destructive" });
        return;
      }
      const data = await res.json();
      toast({ title: `Lot ${data.lot.lot_number} marked ${data.lot.status}` });
      await loadLots();
      // If we just retired the currently selected lot, slide off it so the
      // tech doesn't accidentally log against a retired lot.
      if (nextStatus !== "active" && selectedLotId === lotId) {
        setSelectedLotId(null);
      }
    } catch (err: any) {
      toast({ title: err.message || "Could not update lot status", variant: "destructive" });
    } finally {
      setRetireSubmitting(false);
    }
  }

  function resetChangeoverForm() {
    setCoLotNumber("");
    setCoManufacturer("");
    setCoMean("");
    setCoSd("");
    setCoSdInterval("2");
    setCoExpiration("");
    setCoOpened(todayIsoDate());
    setCoRetirePrior(true);
  }

  // Open the changeover dialog pre-filled with metadata carried from the prior
  // lot (manufacturer, SD interval). The new mean/SD are intentionally blank:
  // they are the new material's assigned values and must be entered fresh.
  function openChangeover() {
    const lot = lots.find(l => l.id === selectedLotId);
    resetChangeoverForm();
    if (lot) {
      setCoManufacturer(lot.manufacturer || "");
      setCoSdInterval(String(lot.mfr_sd_interval) === "3" ? "3" : "2");
    }
    setChangeoverOpen(true);
  }

  async function handleChangeover() {
    if (!activeLabId || !selectedLotId) return;
    if (!coLotNumber.trim()) {
      toast({ title: "New lot number is required", variant: "destructive" });
      return;
    }
    const meanN = Number(coMean);
    const sdN = Number(coSd);
    if (!Number.isFinite(meanN)) {
      toast({ title: "Manufacturer mean must be a number", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(sdN) || sdN <= 0) {
      toast({ title: "Manufacturer SD must be a positive number", variant: "destructive" });
      return;
    }
    setCoSubmitting(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/labs/${activeLabId}/qc/control-lots/${selectedLotId}/changeover`,
        {
          method: "POST",
          headers: { ...authHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({
            lot_number: coLotNumber.trim(),
            manufacturer: coManufacturer.trim() || null,
            mfr_mean: meanN,
            mfr_sd: sdN,
            mfr_sd_interval: Number(coSdInterval),
            expiration_date: coExpiration || null,
            opened_date: coOpened || null,
            retire_prior: coRetirePrior,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({
          title: res.status === 409 ? "Duplicate lot" : "Could not start new lot",
          description: err.error || `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      const data = await res.json();
      toast({
        title: `Started lot ${data.lot.lot_number}`,
        description: coRetirePrior
          ? `Replaces lot ${data.prior.lot_number} (retired). QC re-baselines onto the new mean/SD.`
          : `New lot active alongside lot ${data.prior.lot_number}.`,
      });
      resetChangeoverForm();
      setChangeoverOpen(false);
      await loadLots();
      // Land on the new lot so the tech logs against it immediately.
      setSelectedLotId(data.lot.id);
      if (spanAllLots) loadLineResults(data.lot.analyte, data.lot.level);
    } catch (err: any) {
      toast({ title: err.message || "Could not start new lot", variant: "destructive" });
    } finally {
      setCoSubmitting(false);
    }
  }

  // ── Render gates ─────────────────────────────────────────────────────
  if (!isLoggedIn) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card>
          <CardContent className="py-10 text-center">
            <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <h2 className="text-lg font-semibold mb-1">Sign in to use VeritaQC&#8482;</h2>
            <p className="text-sm text-muted-foreground mb-4">
              VeritaQC tracks daily quality-control results, evaluates Westgard rules,
              and captures corrective actions in the moment.
            </p>
            <Button asChild><Link href="/login">Sign in</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasPlanAccess) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card>
          <CardContent className="py-10 text-center">
            <Lock className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
            <h2 className="text-lg font-semibold mb-1">VeritaQC&#8482; requires a subscription</h2>
            <p className="text-sm text-muted-foreground mb-4">
              VeritaQC is part of the VeritaAssure suite. Upgrade your plan to log QC
              results, evaluate Westgard rules, and run monthly review attestations.
            </p>
            <Button asChild><Link href="/pricing">See plans</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!activeLabId) {
    return (
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">Select a lab to start logging QC.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedLot = lots.find(l => l.id === selectedLotId) || null;

  // Group lots into control lines (analyte + level). Within a line, order
  // newest-first so the current lot sits at the top of its group. "Current" =
  // the newest active lot of the line (or the newest lot if none are active).
  const lineGroups = (() => {
    const map = new Map<string, ControlLot[]>();
    for (const l of lots) {
      const key = `${l.analyte}|||${l.level}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    const byNewest = (a: ControlLot, b: ControlLot) => {
      const ao = a.opened_date || "", bo = b.opened_date || "";
      if (ao !== bo) return ao < bo ? 1 : -1;
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
      return b.id - a.id;
    };
    const groups = Array.from(map.values()).map(ls => {
      const ordered = [...ls].sort(byNewest);
      const currentId = (ordered.find(l => l.status === "active") || ordered[0]).id;
      return { analyte: ls[0].analyte, level: ls[0].level, lots: ordered, currentId };
    });
    groups.sort((a, b) => a.analyte === b.analyte ? a.level.localeCompare(b.level) : a.analyte.localeCompare(b.analyte));
    return groups;
  })();
  const selectedLine = selectedLot
    ? lineGroups.find(g => g.analyte === selectedLot.analyte && g.level === selectedLot.level) || null
    : null;
  const lineHasMultipleLots = !!selectedLine && selectedLine.lots.length > 1;
  const showContinuous = spanAllLots && lineHasMultipleLots;
  const priorLot = selectedLot?.prior_lot_id
    ? lots.find(l => l.id === selectedLot.prior_lot_id) || null
    : null;

  // Instrument helper: when the analyte name already carries the analyzer
  // (e.g. "PSA (FREND A)"), pull it out to prefill/suggest it. The datalist on
  // the form still allows free text for labs that record a distinct analyzer.
  const instrumentSuggestions = Array.from(new Set(
    [...lots.map(l => l.analyte.match(/\(([^)]+)\)\s*$/)?.[1] || ""), ...results.map(r => r.instrument || "")]
      .map(s => s.trim()).filter(Boolean)
  )).sort();

  return (
    <div className="container max-w-5xl mx-auto py-8 px-4">
      <div className="mb-6 flex items-center gap-2">
        <FlaskConical className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">VeritaQC&#8482;</h1>
        <Badge variant="outline" className="ml-2 text-xs">Phase 1 preview</Badge>
        <div className="ml-auto">
          <Button asChild variant="outline" size="sm">
            <Link href={`/labs/${activeLabId}/veritaqc-app/review`}>Review &amp; Sign-off</Link>
          </Button>
        </div>
      </div>

      <ModuleHowToCard
        moduleKey="veritaqc"
        moduleName="VeritaQC™"
        whatItDoes="VeritaQC replaces the daily QC binder. A technologist logs a control result, the system evaluates Westgard multi-rules (1-2s, 1-3s, 2-2s, R-4s, 4-1s, plus configurable N-x bias and N-T trend) against the lab's cumulative baseline, and either accepts the run or holds it for a required corrective action. The daily review feed surfaces every result across every lot with a triage filter for results that fired a rejection but have no corrective action filed. Month end produces a one-page PDF with the Levey-Jennings chart, the violation log, the corrective actions, and the signature attestation block."
        howToUse={[
          "Add your control lots once: analyte, lot number, manufacturer mean and SD, SD interval.",
          "Each shift, log control results as you run them. The system shows you the Westgard decision in real time.",
          "When a rejection rule fires, file the required corrective action in the same screen before the run is released.",
          "At month end, open the Review & Sign-off page for each lot, generate the monthly PDF, sign the attestation block.",
          "File the PDF in your QC binder or attach to your LIS record. Records retained per 42 CFR 493.1105.",
        ]}
      />

      {/* CUMSUM is a supplementary QC method (relocated here from the VeritaCheck top nav
          on 2026-07-08). The tracker/route/PDF are unchanged; this is just its correct home
          alongside the daily Westgard review. */}
      <Card className="mb-6 border-dashed">
        <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <LineChart className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">CUMSUM monitoring</span>
              <Badge variant="outline" className="text-[10px]">Advanced</Badge>
            </div>
            <p className="text-xs text-muted-foreground max-w-2xl">
              Cumulative-sum tracking for sustained small shifts, e.g. PTT heparin sensitivity across reagent lot changes. A supplementary method to the daily Westgard review above.
            </p>
          </div>
          <Button asChild variant="outline" size="sm" className="shrink-0" data-testid="veritaqc-cumsum-link">
            <Link href={`/labs/${activeLabId}/veritacheck/cumsum`}>Open CUMSUM</Link>
          </Button>
        </CardContent>
      </Card>

      {loadingLots ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading control lots...</CardContent></Card>
      ) : lotsError ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-semibold text-foreground mb-1">Couldn't load control lots</p>
            <p className="text-sm text-muted-foreground mb-3 max-w-md mx-auto">Something went wrong loading this lab's control lots. Your lots were not deleted. Check your connection and try again.</p>
            <Button size="sm" variant="outline" onClick={loadLots}>Retry</Button>
          </CardContent>
        </Card>
      ) : lots.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">No control lots yet for this lab.</p>
            <Button onClick={() => setAddLotOpen(true)} disabled={isReadOnly}>
              Add your first control lot
            </Button>
            <p className="text-xs text-muted-foreground mt-3">
              Need help onboarding multiple analytes at once?{" "}
              <a href="mailto:info@veritaslabservices.com" className="text-primary hover:underline">
                info@veritaslabservices.com
              </a>
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Control lot</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddLotOpen(true)}
                disabled={isReadOnly}
              >
                + Add control lot
              </Button>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedLotId ? String(selectedLotId) : ""}
                onValueChange={(v) => setSelectedLotId(Number(v))}
              >
                <SelectTrigger><SelectValue placeholder="Pick a lot..." /></SelectTrigger>
                <SelectContent>
                  {lineGroups.map(g => (
                    <SelectGroup key={`${g.analyte}|||${g.level}`}>
                      <SelectLabel>{g.analyte} &middot; {g.level}</SelectLabel>
                      {g.lots.map(lot => (
                        <SelectItem key={lot.id} value={String(lot.id)}>
                          Lot {lot.lot_number}
                          {lot.id === g.currentId ? " · current" : ""}
                          {lot.status !== "active" ? ` · ${lot.status}` : ""}
                          {lot.opened_date ? ` · opened ${lot.opened_date}` : ""}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              {selectedLine && selectedLine.lots.length > 1 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {selectedLine.lots.length} lots on this control line. Pick any lot to see its history, or turn on <span className="font-medium text-foreground">Span all lots</span> on the chart to view them continuously with a shift marker at each changeover.
                </p>
              )}
              {selectedLot && (
                <>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted-foreground">
                    <div><span className="font-medium text-foreground">Mfr mean:</span> {selectedLot.mfr_mean}</div>
                    <div><span className="font-medium text-foreground">Mfr SD:</span> {selectedLot.mfr_sd}</div>
                    <div><span className="font-medium text-foreground">SD interval:</span> &plusmn;{selectedLot.mfr_sd_interval}</div>
                    <div>
                      <span className="font-medium text-foreground">Exp:</span>{" "}
                      {selectedLot.expiration_date || "n/a"}
                      {selectedLot.expiration_date && selectedLot.expiration_date < todayIsoDate() && (
                        <span className="ml-1 inline-flex items-center rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">EXPIRED</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {selectedLine && selectedLot.id === selectedLine.currentId && (
                      <Button
                        size="sm"
                        onClick={openChangeover}
                        disabled={isReadOnly || coSubmitting}
                        title="Start a replacement lot on this control line"
                      >
                        Start new lot
                      </Button>
                    )}
                    {selectedLot.status === "active" ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRetireLot(selectedLot.id, "hold")}
                          disabled={isReadOnly || retireSubmitting}
                        >
                          Hold
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRetireLot(selectedLot.id, "retired")}
                          disabled={isReadOnly || retireSubmitting}
                        >
                          Retire
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRetireLot(selectedLot.id, "active")}
                        disabled={isReadOnly || retireSubmitting}
                      >
                        Re-activate
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground">
                      Status: <span className="font-medium text-foreground">{selectedLot.status}</span>
                    </span>
                  </div>
                  {priorLot && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Changeover: replaces lot <span className="font-medium text-foreground">{priorLot.lot_number}</span>{" "}
                      (prior mean {priorLot.mfr_mean}, SD {priorLot.mfr_sd}). QC re-baselines onto this lot's mean/SD.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="text-base">Log a QC result</CardTitle>
            </CardHeader>
            <CardContent>
              {selectedLot ? (
                <div className="mb-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Logging for </span>
                  <span className="font-semibold">{selectedLot.analyte}</span>
                  <span className="text-muted-foreground"> &middot; Lot {selectedLot.lot_number} &middot; {selectedLot.level}</span>
                </div>
              ) : (
                <p className="mb-3 text-xs text-muted-foreground">Select a control lot above to log a result against it.</p>
              )}
              {isReadOnly && (
                <p className="mb-3 text-xs text-amber-700 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5">
                  Read-only access on this lab. Submit is disabled until the
                  subscription is renewed.
                </p>
              )}
              {selectedLot && selectedLot.status !== "active" && (
                <p className="mb-3 text-xs text-red-700 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5">
                  This control lot is {selectedLot.status}. Select an active lot before logging QC.
                </p>
              )}
              {selectedLot && selectedLot.status === "active" && selectedLot.expiration_date && selectedLot.expiration_date < todayIsoDate() && (
                <p className="mb-3 text-xs text-red-700 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5">
                  This control lot expired on {selectedLot.expiration_date}. Confirm this is intended before logging QC.
                </p>
              )}
              <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="qc-value">Result value <span className="text-red-600">*</span></Label>
                  <Input
                    id="qc-value"
                    type="text"
                    inputMode="decimal"
                    value={formValue}
                    onChange={(e) => setFormValue(e.target.value)}
                    placeholder="e.g. 102.3"
                    required
                    disabled={isReadOnly}
                  />
                </div>
                <div>
                  <Label htmlFor="qc-date">Result date <span className="text-red-600">*</span></Label>
                  <Input
                    id="qc-date"
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    required
                    disabled={isReadOnly}
                  />
                </div>
                <div>
                  <Label htmlFor="qc-instrument">Instrument</Label>
                  <Input
                    id="qc-instrument"
                    list="qc-instruments"
                    value={formInstrument}
                    onChange={(e) => setFormInstrument(e.target.value)}
                    placeholder="Select or type the analyzer"
                    disabled={isReadOnly}
                  />
                  <datalist id="qc-instruments">
                    {instrumentSuggestions.map(inst => <option key={inst} value={inst} />)}
                  </datalist>
                </div>
                <div>
                  <Label htmlFor="qc-runtime">Run time</Label>
                  <Input
                    id="qc-runtime"
                    type="time"
                    value={formRunTime}
                    onChange={(e) => setFormRunTime(e.target.value)}
                    disabled={isReadOnly}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="qc-comment">Comment</Label>
                  <Textarea
                    id="qc-comment"
                    value={formComment}
                    onChange={(e) => setFormComment(e.target.value)}
                    placeholder="Optional context (reagent lot, calibrator lot, troubleshooting note)"
                    rows={2}
                    disabled={isReadOnly}
                  />
                </div>
                <div className="sm:col-span-2 flex justify-end">
                  <Button type="submit" disabled={submitting || isReadOnly || (!!selectedLot && selectedLot.status !== "active")}>
                    {submitting ? "Submitting..." : "Submit result"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between space-y-0 gap-2 sm:gap-3">
              <CardTitle className="text-base">
                Levey-Jennings chart{selectedLot ? `: ${selectedLot.analyte} (${selectedLot.level})` : ""}
                {showContinuous ? " · all lots" : selectedLot ? ` · lot ${selectedLot.lot_number}` : ""}
              </CardTitle>
              <div className="flex items-center gap-3 shrink-0">
                {lineHasMultipleLots && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer" title="Plot every lot on this control line as one continuous chart, with a marker at each changeover">
                    <input
                      type="checkbox"
                      checked={spanAllLots}
                      onChange={(e) => setSpanAllLots(e.target.checked)}
                      aria-label="Span all lots (continuous Levey-Jennings across lot changes)"
                    />
                    Span all lots
                  </label>
                )}
                {selectedLot && !showContinuous && results.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Points
                    <input
                      type="text"
                      inputMode="numeric"
                      value={chartPoints}
                      onChange={(e) => setChartPoints(e.target.value)}
                      className="w-16 border border-input rounded-md bg-background px-2 py-1 text-xs"
                      aria-label="Number of Levey-Jennings points to show"
                      title="Points to show (1 to 200)"
                    />
                  </label>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!selectedLot ? (
                <div className="text-sm text-muted-foreground py-8 text-center">Select a control lot to view its Levey-Jennings chart.</div>
              ) : showContinuous ? (
                loadingLine ? (
                  <div className="text-sm text-muted-foreground py-8 text-center">Loading cross-lot history...</div>
                ) : lineError ? (
                  <div className="text-sm py-6 text-center">
                    <p className="text-destructive font-medium mb-1">Couldn't load the cross-lot history.</p>
                    <Button size="sm" variant="outline" onClick={() => loadLineResults(selectedLot.analyte, selectedLot.level)}>Retry</Button>
                  </div>
                ) : lineData && lineData.points.length > 0 ? (
                  <>
                    <ContinuousLeveyJenningsChart points={lineData.points} />
                    <p className="text-xs text-muted-foreground mt-2">
                      Every point is measured against its own lot's mean and SD, so the chart re-centers at a lot change. The dashed marker shows each changeover for {selectedLot.analyte} ({selectedLot.level}).
                    </p>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground py-8 text-center">No results across this control line's lots yet.</div>
                )
              ) : (
                <LeveyJenningsChart mean={selectedLot.mfr_mean} sd={selectedLot.mfr_sd} results={results.filter(r => !r.voided_at).slice(0, Math.max(1, Math.min(200, parseInt(chartPoints, 10) || 30)))} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent results (last 20)</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingResults ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : resultsError ? (
                <div className="text-sm">
                  <p className="text-destructive font-medium mb-1">Couldn't load results for this lot.</p>
                  <p className="text-xs text-muted-foreground mb-2">This does not mean there are none. Check your connection and retry.</p>
                  <Button size="sm" variant="outline" onClick={() => selectedLotId && loadResults(selectedLotId)}>Retry</Button>
                </div>
              ) : results.length === 0 ? (
                <p className="text-sm text-muted-foreground">No results logged for this lot yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground border-b">
                      <tr>
                        <th className="py-2 pr-2">Date</th>
                        <th className="py-2 pr-2">Value</th>
                        <th className="py-2 pr-2">Instrument</th>
                        <th className="py-2 pr-2">Notes</th>
                        <th className="py-2 pr-2">Rules fired</th>
                        <th className="py-2 pr-2">CA filed</th>
                        <th className="py-2 pr-2">Accepted</th>
                        <th className="py-2 pr-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.slice(0, 20).map(r => (
                        <tr key={r.id} className={`border-b last:border-b-0 ${r.voided_at ? "opacity-60" : ""}`}>
                          <td className="py-2 pr-2">{r.result_date}</td>
                          <td className={`py-2 pr-2 font-mono ${r.voided_at ? "line-through" : ""}`}>{r.result_value}</td>
                          <td className="py-2 pr-2 text-muted-foreground">{r.instrument || "-"}</td>
                          <td className="py-2 pr-2 text-xs text-muted-foreground max-w-[16rem] truncate" title={r.comment || undefined}>{r.comment || "-"}</td>
                          <td className="py-2 pr-2">
                            {r.violations.length === 0 ? (
                              <span className="text-xs text-muted-foreground">none</span>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {r.violations.map(v => (
                                  <Badge key={v.id} variant="outline" className={severityColor(v.severity)}>
                                    {v.rule_code}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-xs text-muted-foreground">
                            {r.corrective_actions.length > 0
                              ? `${r.corrective_actions.length} action${r.corrective_actions.length === 1 ? "" : "s"}`
                              : "-"}
                          </td>
                          <td className="py-2 pr-2">
                            {r.accepted_for_reporting === 1 ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="accepted" />
                            ) : (
                              <span className="text-xs text-amber-700">excluded</span>
                            )}
                          </td>
                          <td className="py-2 pr-2 text-right">
                            {r.voided_at ? (
                              <span className="text-xs text-muted-foreground italic" title={r.void_reason ? `Voided: ${r.void_reason}` : "Voided"}>Voided</span>
                            ) : (
                              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 px-2" onClick={() => voidResult(r)} title="Void this result (wrong lot, wrong level, or mis-keyed run)">Void</Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={caModalOpen} onOpenChange={(open) => {
        // Audit #13: normally forced (cannot close without a CA), but after
        // repeated save failures the tech can dismiss. The QC result is already
        // persisted; the CA is resolvable from the Daily Review missing-CA action.
        if (!open && caForResultId && caFailCount < 2) return;
        setCaModalOpen(open);
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              Corrective action required
            </DialogTitle>
            <DialogDescription>
              A Westgard rejection rule fired on this result. Document the action you
              took before this dialog can close.
            </DialogDescription>
          </DialogHeader>
          {caForViolation && (
            <div className="rounded-md border border-red-500/20 bg-red-500/5 p-3 text-sm">
              <div className="font-semibold text-red-700">{caForViolation.rule_code}</div>
              <div className="text-xs text-red-700/80 mt-0.5">{caForViolation.detail}</div>
            </div>
          )}
          <div className="space-y-3">
            <div>
              <Label htmlFor="ca-action">What did you do? <span className="text-red-600">*</span></Label>
              <Textarea
                id="ca-action"
                value={caActionTaken}
                onChange={(e) => setCaActionTaken(e.target.value)}
                placeholder="e.g. Repeated control; same result. Recalibrated and reran; in range. Reagent OK, no maintenance change."
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="ca-followup">Follow-up notes</Label>
              <Textarea
                id="ca-followup"
                value={caFollowUp}
                onChange={(e) => setCaFollowUp(e.target.value)}
                placeholder="Optional: outcome of the action, who reviewed, NCE filed elsewhere"
                rows={2}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={caExcludeFromBaseline}
                onChange={(e) => setCaExcludeFromBaseline(e.target.checked)}
                className="mt-1"
              />
              <span>
                Exclude this run from the QC baseline (recommended when the cause
                was instrument or reagent, not the lot itself; keeps future Westgard
                evaluations clean).
              </span>
            </label>
          </div>
          {caFailCount >= 1 && (
            <p className="text-xs text-amber-700">
              Having trouble saving? The result is already logged. You can close and file the corrective action later from the Daily Review.
            </p>
          )}
          <div className="flex justify-end gap-2">
            {caFailCount >= 2 && (
              <Button
                variant="outline"
                onClick={() => { setCaModalOpen(false); setCaForResultId(null); setCaForViolation(null); }}
                disabled={caSubmitting}
              >
                Close, resolve later
              </Button>
            )}
            <Button onClick={handleCaSubmit} disabled={caSubmitting || !caActionTaken.trim()}>
              {caSubmitting ? "Saving..." : "File corrective action"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Control Lot dialog. 8 fields, 4 required (analyte, lot_number,
          mfr_mean, mfr_sd). The rest are operational metadata that the
          monthly PDF + Westgard evaluator can use but don't gate Phase 1
          functionality. */}
      <Dialog open={addLotOpen} onOpenChange={setAddLotOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add control lot</DialogTitle>
            <DialogDescription>
              New analyte or a new lot of an existing analyte. The dropdown
              auto-selects this lot after it saves so you can log against it
              immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label htmlFor="new-analyte">Analyte <span className="text-red-600">*</span></Label>
              <Input
                id="new-analyte"
                value={newAnalyte}
                onChange={(e) => setNewAnalyte(e.target.value)}
                placeholder="e.g. Glucose, AST, TSH"
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="new-lot-number">Lot number <span className="text-red-600">*</span></Label>
              <Input
                id="new-lot-number"
                value={newLotNumber}
                onChange={(e) => setNewLotNumber(e.target.value)}
                placeholder="e.g. 425671"
              />
            </div>
            <div>
              <Label htmlFor="new-level">Level <span className="text-red-600">*</span></Label>
              <Select value={newLevel} onValueChange={(v) => setNewLevel(v as "low" | "mid" | "high")}>
                <SelectTrigger id="new-level"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="mid">Mid</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="new-manufacturer">Manufacturer</Label>
              <Input
                id="new-manufacturer"
                value={newManufacturer}
                onChange={(e) => setNewManufacturer(e.target.value)}
                placeholder="e.g. Bio-Rad, Roche"
              />
            </div>
            <div>
              <Label htmlFor="new-mean">Mfr mean <span className="text-red-600">*</span></Label>
              <Input
                id="new-mean"
                type="text"
                inputMode="decimal"
                value={newMfrMean}
                onChange={(e) => setNewMfrMean(e.target.value)}
                placeholder="e.g. 102.5"
              />
            </div>
            <div>
              <Label htmlFor="new-sd">Mfr SD <span className="text-red-600">*</span></Label>
              <Input
                id="new-sd"
                type="text"
                inputMode="decimal"
                value={newMfrSd}
                onChange={(e) => setNewMfrSd(e.target.value)}
                placeholder="e.g. 3.2"
              />
            </div>
            <div>
              <Label htmlFor="new-sd-interval">SD interval</Label>
              <Select value={newSdInterval} onValueChange={(v) => setNewSdInterval(v as "2" | "3")}>
                <SelectTrigger id="new-sd-interval"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">&plusmn;2 SD (default)</SelectItem>
                  <SelectItem value="3">&plusmn;3 SD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="new-exp">Expiration date</Label>
              <Input
                id="new-exp"
                type="date"
                value={newExpiration}
                onChange={(e) => setNewExpiration(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="new-opened">Opened date</Label>
              <Input
                id="new-opened"
                type="date"
                value={newOpened}
                onChange={(e) => setNewOpened(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => { resetAddLotForm(); setAddLotOpen(false); }}
              disabled={addLotSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddLot}
              disabled={
                addLotSubmitting ||
                !newAnalyte.trim() ||
                !newLotNumber.trim() ||
                !newMfrMean ||
                !newMfrSd
              }
            >
              {addLotSubmitting ? "Saving..." : "Add control lot"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Changeover dialog: start a replacement lot on the selected control
          line. analyte + level are fixed (carried from the prior lot); the new
          mean/SD are the incoming material's assigned values, entered fresh. */}
      <Dialog open={changeoverOpen} onOpenChange={(o) => { if (!o) resetChangeoverForm(); setChangeoverOpen(o); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Start new lot</DialogTitle>
            <DialogDescription>
              {selectedLot
                ? <>Replacement lot for <span className="font-medium text-foreground">{selectedLot.analyte}</span> &middot; {selectedLot.level}. The new lot becomes current{coRetirePrior ? " and the prior lot is retired" : ""}. QC re-baselines onto the new mean and SD.</>
                : "Select a control lot first."}
            </DialogDescription>
          </DialogHeader>
          {selectedLot && (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              Replacing lot <span className="font-medium text-foreground">{selectedLot.lot_number}</span> (mean {selectedLot.mfr_mean}, SD {selectedLot.mfr_sd}, &plusmn;{selectedLot.mfr_sd_interval} SD). Analyte and level carry forward and cannot change here.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="co-lot-number">New lot number <span className="text-red-600">*</span></Label>
              <Input id="co-lot-number" value={coLotNumber} onChange={(e) => setCoLotNumber(e.target.value)} placeholder="e.g. 303072" autoFocus />
            </div>
            <div>
              <Label htmlFor="co-manufacturer">Manufacturer</Label>
              <Input id="co-manufacturer" value={coManufacturer} onChange={(e) => setCoManufacturer(e.target.value)} placeholder="Carried from prior lot" />
            </div>
            <div>
              <Label htmlFor="co-mean">New mfr mean <span className="text-red-600">*</span></Label>
              <Input id="co-mean" type="text" inputMode="decimal" value={coMean} onChange={(e) => setCoMean(e.target.value)} placeholder="e.g. 4.1" />
            </div>
            <div>
              <Label htmlFor="co-sd">New mfr SD <span className="text-red-600">*</span></Label>
              <Input id="co-sd" type="text" inputMode="decimal" value={coSd} onChange={(e) => setCoSd(e.target.value)} placeholder="e.g. 0.3" />
            </div>
            <div>
              <Label htmlFor="co-sd-interval">SD interval</Label>
              <Select value={coSdInterval} onValueChange={(v) => setCoSdInterval(v as "2" | "3")}>
                <SelectTrigger id="co-sd-interval"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">&plusmn;2 SD (default)</SelectItem>
                  <SelectItem value="3">&plusmn;3 SD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="co-opened">Opened date</Label>
              <Input id="co-opened" type="date" value={coOpened} onChange={(e) => setCoOpened(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="co-exp">Expiration date</Label>
              <Input id="co-exp" type="date" value={coExpiration} onChange={(e) => setCoExpiration(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={coRetirePrior} onChange={(e) => setCoRetirePrior(e.target.checked)} className="mt-1" />
                <span>
                  Retire the prior lot (recommended). Keeps one active lot per control
                  line. Uncheck only to run both lots in parallel during a crossover study.
                </span>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button
              variant="outline"
              onClick={() => { resetChangeoverForm(); setChangeoverOpen(false); }}
              disabled={coSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleChangeover}
              disabled={coSubmitting || !coLotNumber.trim() || !coMean || !coSd}
            >
              {coSubmitting ? "Starting..." : "Start new lot"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
