import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { saveAs } from "file-saver";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  Copy,
  Download,
  Edit,
  FlaskConical,
  AlertTriangle,
  CheckCircle2,
  AlertOctagon,
  AlertCircle,
  ChevronRight,
  ChevronDown,
  Filter,
  GitMerge,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type Complexity = "MODERATE" | "HIGH" | "WAIVED";
type Role = "Primary" | "Backup" | "Satellite" | "POC" | "Reference";

interface InstrumentOnTest {
  id: number;
  instrument_name: string;
  role: Role;
  serial_number?: string | null;
}

interface TestRecord {
  analyte: string;
  specialty: string;
  complexity: Complexity;
  instruments: InstrumentOnTest[];
  last_cal_ver?: string | null;
  last_method_comp?: string | null;
  last_precision?: string | null;
  last_sop_review?: string | null;
  notes?: string;
}

interface AnalyteValues {
  ref_range_low?: string | null;
  ref_range_high?: string | null;
  critical_low?: string | null;
  critical_high?: string | null;
  units?: string | null;
}

interface AmrValues {
  [instrumentId: number]: { amr_low?: string | null; amr_high?: string | null };
}

interface MapDetail {
  id: number;
  name: string;
  updated_at: string;
  tests: TestRecord[];
}

interface IntelligenceData {
  correlationsRequired: { analyte: string; instruments: InstrumentOnTest[] }[];
  calVerRequired: number;
  compliantTests: number;
}

// ── CFR mapping ───────────────────────────────────────────────────────────────

const CFR_MAP: Record<string, string> = {
  "General Chemistry": "§493.931",
  "Routine Chemistry": "§493.931",
  Hematology: "§493.941",
  Coagulation: "§493.941",
  "General Immunology": "§493.927",
  Endocrinology: "§493.933",
  Toxicology: "§493.937",
  Immunohematology: "§493.959",
  Urinalysis: "§493.931",
  "Blood Gas": "§493.931",
};

function getCFR(specialty: string): string {
  return CFR_MAP[specialty] ?? "§493.945";
}

// ── Specialty styling ─────────────────────────────────────────────────────────

const SPECIALTY_COLORS: Record<
  string,
  { bg: string; text: string; badge: string }
> = {
  "General Chemistry": {
    bg: "bg-blue-50 dark:bg-blue-950/20",
    text: "text-blue-700 dark:text-blue-300",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  "Routine Chemistry": {
    bg: "bg-blue-50 dark:bg-blue-950/20",
    text: "text-blue-700 dark:text-blue-300",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  },
  Hematology: {
    bg: "bg-red-50 dark:bg-red-950/20",
    text: "text-red-700 dark:text-red-300",
    badge: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  },
  Coagulation: {
    bg: "bg-orange-50 dark:bg-orange-950/20",
    text: "text-orange-700 dark:text-orange-300",
    badge:
      "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  },
  "General Immunology": {
    bg: "bg-purple-50 dark:bg-purple-950/20",
    text: "text-purple-700 dark:text-purple-300",
    badge:
      "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
  },
  Endocrinology: {
    bg: "bg-violet-50 dark:bg-violet-950/20",
    text: "text-violet-700 dark:text-violet-300",
    badge:
      "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  },
  Toxicology: {
    bg: "bg-amber-50 dark:bg-amber-950/20",
    text: "text-amber-700 dark:text-amber-300",
    badge:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  Immunohematology: {
    bg: "bg-pink-50 dark:bg-pink-950/20",
    text: "text-pink-700 dark:text-pink-300",
    badge:
      "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
  },
  Urinalysis: {
    bg: "bg-yellow-50 dark:bg-yellow-950/20",
    text: "text-yellow-700 dark:text-yellow-300",
    badge:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300",
  },
  "Blood Gas": {
    bg: "bg-sky-50 dark:bg-sky-950/20",
    text: "text-sky-700 dark:text-sky-300",
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  },
  Microbiology: {
    bg: "bg-green-50 dark:bg-green-950/20",
    text: "text-green-700 dark:text-green-300",
    badge:
      "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
  },
};

function getSpecialtyStyle(specialty: string) {
  return (
    SPECIALTY_COLORS[specialty] ?? {
      bg: "bg-slate-50 dark:bg-slate-950/20",
      text: "text-slate-600 dark:text-slate-300",
      badge: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    }
  );
}

// ── Role badge ────────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<Role, string> = {
  Primary: "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300",
  Backup: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  Satellite: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  Reference: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300",
  POC: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
};

function InstrumentBadge({ instr }: { instr: InstrumentOnTest }) {
  const roleStyle = ROLE_STYLES[instr.role] ?? "bg-muted text-muted-foreground";
  return (
    <span className="inline-flex flex-col mr-1 mb-0.5">
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded border border-border bg-muted/50 whitespace-nowrap">
        <span className="truncate max-w-[90px]">{instr.instrument_name}</span>
        <span className={`ml-1 px-1 py-0 rounded text-[9px] font-semibold ${roleStyle}`}>
          {instr.role}
        </span>
      </span>
      {instr.serial_number && (
        <span className="text-[9px] text-muted-foreground px-1.5">S/N: {instr.serial_number}</span>
      )}
    </span>
  );
}

// ── Date status logic ─────────────────────────────────────────────────────────

type DateStatus = "ok" | "due-soon" | "overdue" | "missing";

function getDateStatus(
  dateStr: string | null | undefined,
  maxMonths: number,
  warningDays = 30
): DateStatus {
  if (!dateStr) return "missing";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "missing";
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  const maxDays = maxMonths * 30.44 + 20;
  if (diffDays > maxDays) return "overdue";
  if (diffDays > maxDays - warningDays) return "due-soon";
  return "ok";
}

function StatusDot({ status }: { status: DateStatus }) {
  if (status === "ok")
    return <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0" />;
  if (status === "due-soon")
    return <span className="inline-block w-2 h-2 rounded-full bg-amber-400 shrink-0" />;
  if (status === "overdue")
    return <span className="inline-block w-2 h-2 rounded-full bg-red-500 shrink-0" />;
  return (
    <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40 border border-muted-foreground/30 shrink-0" />
  );
}

function DateCell({
  value,
  onChange,
  maxMonths,
  warningDays,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  maxMonths: number;
  warningDays?: number;
  disabled?: boolean;
}) {
  const status = disabled
    ? ("ok" as DateStatus)
    : getDateStatus(value, maxMonths, warningDays);
  const borderClass =
    !disabled && status === "overdue"
      ? "border-red-400 focus:ring-red-400/30"
      : !disabled && status === "due-soon"
      ? "border-amber-400 focus:ring-amber-400/30"
      : !disabled && status === "missing"
      ? "border-muted-foreground/20"
      : "border-input";

  return (
    <div className="flex items-center gap-1.5">
      {!disabled && <StatusDot status={status} />}
      <Input
        type="date"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`h-7 text-xs px-1.5 w-[118px] ${borderClass} ${
          disabled ? "opacity-40 cursor-not-allowed" : ""
        }`}
      />
    </div>
  );
}

// ── Complexity badge ──────────────────────────────────────────────────────────

function ComplexityBadge({ complexity }: { complexity: Complexity }) {
  if (complexity === "WAIVED")
    return (
      <Badge className="text-[10px] px-1.5 py-0 border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        WAIVED
      </Badge>
    );
  if (complexity === "HIGH")
    return (
      <Badge className="text-[10px] px-1.5 py-0 border-0 bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300">
        HIGH
      </Badge>
    );
  return (
    <Badge className="text-[10px] px-1.5 py-0 border-0 bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
      MODERATE
    </Badge>
  );
}

// ── Intelligence Banner ───────────────────────────────────────────────────────

function IntelligenceBanner({
  intelligence,
  onAnalyteClick,
}: {
  intelligence: IntelligenceData;
  onAnalyteClick: (analyte: string) => void;
}) {
  const { correlationsRequired, calVerRequired, compliantTests } = intelligence;

  return (
    <div className="rounded-xl border-2 border-red-200 dark:border-red-900/60 bg-gradient-to-br from-red-50 to-amber-50/30 dark:from-red-950/30 dark:to-amber-950/10 overflow-hidden mb-5 shadow-sm">
      {/* Banner header */}
      <div className="px-4 pt-3 pb-2 flex items-center gap-2 border-b border-red-200/60 dark:border-red-900/40">
        <GitMerge size={15} className="text-red-600 dark:text-red-400 shrink-0" />
        <span className="text-sm font-bold text-red-800 dark:text-red-200">
          VeritaMap™ Intelligence
        </span>
        <span className="text-xs text-red-600/70 dark:text-red-400/70 ml-1">
          - Cross-instrument correlation & compliance engine
        </span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-red-200/50 dark:divide-red-900/30">
        {/* Correlations */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" />
            <span className="text-sm font-bold text-red-700 dark:text-red-300">
              {correlationsRequired.length} Correlation
              {correlationsRequired.length !== 1 ? "s" : ""} Required
            </span>
          </div>
          {correlationsRequired.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {correlationsRequired.slice(0, 8).map(({ analyte }) => (
                <button
                  key={analyte}
                  type="button"
                  onClick={() => onAnalyteClick(analyte)}
                  className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/60 transition-colors border border-red-200/60 dark:border-red-800/40"
                >
                  {analyte}
                </button>
              ))}
              {correlationsRequired.length > 8 && (
                <span className="text-[11px] text-red-600/70 dark:text-red-400/70 px-1 py-0.5">
                  +{correlationsRequired.length - 8} more
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              No correlations required
            </p>
          )}
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Click any analyte to jump to its row
          </p>
        </div>

        {/* Cal Ver */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shrink-0" />
            <span className="text-sm font-bold text-amber-700 dark:text-amber-300">
              {calVerRequired} Cal Verification
              {calVerRequired !== 1 ? "s" : ""} Required
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Non-waived tests require cal ver every 6 months.
          </p>
          <p className="text-[10px] text-muted-foreground/70 mt-1">
            42 CFR §493.1255
          </p>
        </div>

        {/* Compliant */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
              {compliantTests} Tests Fully Compliant
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Dates on file and within schedule.
          </p>
          <div className="mt-2">
            {correlationsRequired.length > 0 ? (
              <Link
                href={`/veritacheck?studyType=method_comparison&analyte=${encodeURIComponent(correlationsRequired[0].analyte)}&instrument1=${encodeURIComponent(correlationsRequired[0].instruments[0]?.instrument_name || "")}&instrument2=${encodeURIComponent(correlationsRequired[0].instruments[1]?.instrument_name || "")}`}
                className="inline-flex items-center text-[11px] font-semibold text-primary hover:underline"
              >
                <FlaskConical size={10} className="mr-1" />
                Run Study &rarr;
                <ChevronRight size={10} className="ml-0.5" />
              </Link>
            ) : (
              <Link
                href="/veritacheck"
                className="inline-flex items-center text-[11px] font-semibold text-primary hover:underline"
              >
                <FlaskConical size={10} className="mr-1" />
                Run a Study in VeritaCheck
                <ChevronRight size={10} className="ml-0.5" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Excel Export ──────────────────────────────────────────────────────────────

async function exportExcel(mapId: number, mapName: string): Promise<void> {
  const token = localStorage.getItem("veritas_token");
  const res = await fetch(
    `${API_BASE}/api/veritamap/maps/${mapId}/excel`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );
  if (!res.ok) throw new Error("Excel generation failed");
  const blob = await res.blob();
  const date = new Date().toISOString().split("T")[0];
  const safeName = mapName.replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
  saveAs(blob, `VeritaMap_${safeName}_${date}.xlsx`);
}

// ── Compliance score ──────────────────────────────────────────────────────────

function calcCompliance(tests: TestRecord[]): {
  score: number;
  calVerOverdue: number;
  methodCompMissing: number;
  sopOverdue: number;
} {
  const nonWaived = tests.filter((t) => t.complexity !== "WAIVED");
  if (nonWaived.length === 0)
    return { score: 100, calVerOverdue: 0, methodCompMissing: 0, sopOverdue: 0 };

  let calVerOverdue = 0;
  let methodCompMissing = 0;
  let sopOverdue = 0;

  for (const t of nonWaived) {
    const cvStatus = getDateStatus(t.last_cal_ver, 6);
    const mcStatus = getDateStatus(t.last_method_comp, 6);
    const sopStatus = getDateStatus(t.last_sop_review, 24);
    if (cvStatus === "overdue" || cvStatus === "missing") calVerOverdue++;
    if (mcStatus === "missing") methodCompMissing++;
    if (sopStatus === "overdue" || sopStatus === "missing") sopOverdue++;
  }

  const bothOk = nonWaived.filter(
    (t) =>
      getDateStatus(t.last_cal_ver, 6) === "ok" &&
      getDateStatus(t.last_method_comp, 6) === "ok"
  ).length;

  const score =
    nonWaived.length > 0
      ? Math.round((bothOk / nonWaived.length) * 100)
      : 100;

  return { score, calVerOverdue, methodCompMissing, sopOverdue };
}

// ── Intelligence computation (client-side fallback) ───────────────────────────

function computeIntelligence(tests: TestRecord[]): IntelligenceData {
  const correlationsRequired = tests
    .filter(
      (t) => t.complexity !== "WAIVED" && t.instruments && t.instruments.length >= 2
    )
    .map((t) => ({ analyte: t.analyte, instruments: t.instruments }));

  const calVerRequired = tests.filter(
    (t) => t.complexity !== "WAIVED"
  ).length;

  const compliantTests = tests.filter(
    (t) =>
      t.complexity !== "WAIVED" &&
      getDateStatus(t.last_cal_ver, 6) === "ok" &&
      getDateStatus(t.last_method_comp, 6) === "ok"
  ).length;

  return { correlationsRequired, calVerRequired, compliantTests };
}

// ── Test Row ──────────────────────────────────────────────────────────────────

interface TestRowProps {
  test: TestRecord;
  onChange: (analyte: string, field: string, value: string) => void;
  onRowMount?: (el: HTMLTableRowElement | null) => void;
  analyteValues?: AnalyteValues;
  amrValues?: AmrValues;
  onSaveAnalyteValues?: (analyte: string, values: AnalyteValues) => void;
  onSaveAmrValues?: (analyte: string, instrumentId: number, values: { amr_low: string; amr_high: string }) => void;
  colCount: number;
}

function TestRow({ test, onChange, onRowMount, analyteValues, amrValues, onSaveAnalyteValues, onSaveAmrValues, colCount }: TestRowProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [localAv, setLocalAv] = React.useState<AnalyteValues>(analyteValues || {});
  const [localAmr, setLocalAmr] = React.useState<AmrValues>(amrValues || {});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => { setLocalAv(analyteValues || {}); }, [analyteValues]);
  React.useEffect(() => { setLocalAmr(amrValues || {}); }, [amrValues]);
  const isWaived = test.complexity === "WAIVED";
  const specialtyStyle = getSpecialtyStyle(test.specialty);
  const instruments = test.instruments ?? [];

  const correlationRequired =
    !isWaived && instruments.length >= 2;

  const calVerStatus = isWaived
    ? ("ok" as DateStatus)
    : getDateStatus(test.last_cal_ver, 6);
  const mcStatus = isWaived
    ? ("ok" as DateStatus)
    : getDateStatus(test.last_method_comp, 6);

  // Row border logic
  const correlNoMethodComp =
    correlationRequired &&
    (mcStatus === "missing" || mcStatus === "overdue");
  const calVerOverdue =
    !isWaived &&
    (calVerStatus === "overdue" || calVerStatus === "missing");

  const borderClass = isWaived
    ? "border-l-2 border-l-transparent"
    : correlNoMethodComp
    ? "border-l-2 border-l-red-500"
    : calVerOverdue
    ? "border-l-2 border-l-amber-400"
    : mcStatus === "ok" && calVerStatus === "ok"
    ? "border-l-2 border-l-emerald-400/40"
    : "border-l-2 border-l-transparent";

  return (
    <>
    <tr
      ref={onRowMount}
      className={`border-b border-border text-xs group transition-colors hover:bg-muted/30 ${borderClass}`}
    >
      {/* Analyte */}
      <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap max-w-[180px]">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-muted-foreground hover:text-primary transition-colors shrink-0"
            title={expanded ? "Hide values" : "Enter reference range, critical values, AMR"}
          >
            {expanded
              ? <ChevronDown size={12} />
              : <ChevronRight size={12} />}
          </button>
          <span className="truncate">{test.analyte}</span>
        </div>
      </td>

      {/* Instruments */}
      <td className="px-3 py-2 min-w-[160px] max-w-[220px]">
        <div className="flex flex-wrap">
          {instruments.length > 0 ? (
            instruments.map((instr, i) => (
              <InstrumentBadge key={i} instr={instr} />
            ))
          ) : (
            <span className="text-muted-foreground text-[10px] italic">
              No instruments
            </span>
          )}
        </div>
      </td>

      {/* Specialty */}
      <td className="px-3 py-2 whitespace-nowrap">
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${specialtyStyle.badge}`}
        >
          {test.specialty}
        </span>
      </td>

      {/* Complexity */}
      <td className="px-3 py-2 whitespace-nowrap">
        <ComplexityBadge complexity={test.complexity} />
      </td>

      {/* CFR */}
      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap font-mono text-[10px]">
        {getCFR(test.specialty)}
      </td>

      {/* Correlation Required */}
      <td className="px-3 py-2 whitespace-nowrap">
        {isWaived ? (
          <span className="text-[10px] text-muted-foreground">N/A</span>
        ) : correlationRequired ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="inline-flex items-center gap-1 cursor-help">
                  <Badge className="text-[10px] px-1.5 py-0.5 border-0 bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300 font-semibold">
                    Required
                  </Badge>
                  <Info size={10} className="text-red-500/70" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px] text-xs">
                <p className="font-semibold mb-1">
                  {instruments.length} instruments running this test:
                </p>
                <ul className="space-y-0.5 mb-2">
                  {instruments.map((instr, i) => (
                    <li key={i}>
                      {instr.instrument_name}{" "}
                      <span className="text-muted-foreground">[{instr.role}]</span>
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground">42 CFR §493.1213</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          <span className="text-[10px] text-muted-foreground">Not Required</span>
        )}
      </td>

      {/* Cal Ver */}
      <td className="px-3 py-2 whitespace-nowrap">
        {isWaived ? (
          <span className="text-[10px] text-muted-foreground">Exempt</span>
        ) : (
          <div>
            <DateCell
              value={test.last_cal_ver}
              onChange={(v) => onChange(test.analyte, "last_cal_ver", v)}
              maxMonths={6}
              warningDays={30}
            />
            <div className="text-[9px] text-muted-foreground/70 mt-0.5 pl-3.5">
              Every 6 mo · 42 CFR §493.1255
            </div>
          </div>
        )}
      </td>

      {/* Last Method Comp */}
      <td className="px-3 py-2 whitespace-nowrap">
        <DateCell
          value={test.last_method_comp}
          onChange={(v) => onChange(test.analyte, "last_method_comp", v)}
          maxMonths={6}
          warningDays={30}
          disabled={isWaived}
        />
      </td>

      {/* Last Precision */}
      <td className="px-3 py-2 whitespace-nowrap">
        <DateCell
          value={test.last_precision}
          onChange={(v) => onChange(test.analyte, "last_precision", v)}
          maxMonths={6}
          warningDays={30}
          disabled={isWaived}
        />
      </td>

      {/* SOP Review */}
      <td className="px-3 py-2 whitespace-nowrap">
        <DateCell
          value={test.last_sop_review}
          onChange={(v) => onChange(test.analyte, "last_sop_review", v)}
          maxMonths={24}
          warningDays={60}
        />
      </td>

      {/* Notes */}
      <td className="px-3 py-2 min-w-[130px]">
        <Input
          type="text"
          value={test.notes || ""}
          onChange={(e) => onChange(test.analyte, "notes", e.target.value)}
          placeholder="Notes…"
          className="h-7 text-xs px-1.5"
        />
      </td>

      {/* Actions */}
      <td className="px-3 py-2 whitespace-nowrap">
        <div className="flex flex-col gap-0.5">
          {correlationRequired && (
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="h-7 text-[10px] px-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-700"
            >
              <Link href="/veritacheck">
                <GitMerge size={10} className="mr-1" />
                Run Correlation →
              </Link>
            </Button>
          )}
          {!isWaived && (
            <Button
              asChild
              size="sm"
              variant="ghost"
              className="h-7 text-[10px] px-2 text-primary hover:bg-primary/10 hover:text-primary"
            >
              <Link href="/veritacheck">
                <FlaskConical size={10} className="mr-1" />
                Run Cal Verification →
              </Link>
            </Button>
          )}
        </div>
      </td>
    </tr>
    {expanded && (
      <tr className="bg-muted/20 border-b border-border">
        <td colSpan={colCount} className="px-4 py-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-2 flex items-center gap-2">
            Lab-Established Values for {test.analyte}
            <a
              href="/veritamap-app/resources"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline font-normal normal-case tracking-normal"
            >
              Reference literature
            </a>
            <span className="text-muted-foreground font-normal normal-case tracking-normal">
              - CLIA requires each lab to establish and verify these values independently.
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-3">
            {/* Units */}
            <div>
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">Units of Measure</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. mEq/L"
                value={localAv.units || ""}
                onChange={e => setLocalAv(v => ({ ...v, units: e.target.value }))}
              />
            </div>
            {/* Ref Range */}
            <div>
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">Reference Range Low</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. 136"
                value={localAv.ref_range_low || ""}
                onChange={e => setLocalAv(v => ({ ...v, ref_range_low: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">Reference Range High</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. 145"
                value={localAv.ref_range_high || ""}
                onChange={e => setLocalAv(v => ({ ...v, ref_range_high: e.target.value }))}
              />
            </div>
            {/* Critical Values */}
            <div>
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">Critical Value Low</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. 120"
                value={localAv.critical_low || ""}
                onChange={e => setLocalAv(v => ({ ...v, critical_low: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">Critical Value High</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. 160"
                value={localAv.critical_high || ""}
                onChange={e => setLocalAv(v => ({ ...v, critical_high: e.target.value }))}
              />
            </div>
          </div>
          {/* AMR per instrument */}
          {instruments.length > 0 && (
            <div className="mb-3">
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">AMR (Analytical Measurement Range) - per instrument</label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {instruments.map(inst => (
                  <div key={inst.id} className="flex items-center gap-2 bg-background rounded border border-border px-2 py-1.5">
                    <span className="text-[10px] font-medium min-w-[100px] truncate text-foreground">{inst.instrument_name}</span>
                    <Input
                      className="h-6 text-xs w-20"
                      placeholder="Low"
                      value={localAmr[inst.id]?.amr_low || ""}
                      onChange={e => setLocalAmr(v => ({ ...v, [inst.id]: { ...v[inst.id], amr_low: e.target.value } }))}
                    />
                    <span className="text-[10px] text-muted-foreground">to</span>
                    <Input
                      className="h-6 text-xs w-20"
                      placeholder="High"
                      value={localAmr[inst.id]?.amr_high || ""}
                      onChange={e => setLocalAmr(v => ({ ...v, [inst.id]: { ...v[inst.id], amr_high: e.target.value } }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  if (onSaveAnalyteValues) await onSaveAnalyteValues(test.analyte, localAv);
                  for (const inst of instruments) {
                    if (onSaveAmrValues && localAmr[inst.id]) {
                      await onSaveAmrValues(test.analyte, inst.id, {
                        amr_low: localAmr[inst.id].amr_low || "",
                        amr_high: localAmr[inst.id].amr_high || "",
                      });
                    }
                  }
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving..." : "Save values"}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExpanded(false)}>
              Close
            </Button>
          </div>
        </td>
      </tr>
    )}
  </>
  );
}

// ── Copy-from banner ─────────────────────────────────────────────────────────

function CopyFromBanner({
  instruments,
  onCopy,
  isCopying
}: {
  instruments: Array<{id: number, name: string, testCount?: number}>,
  onCopy: (sourceInstId: number) => void,
  isCopying: boolean
}) {
  const [selected, setSelected] = useState<number | ''>(instruments[0]?.id ?? '');

  return (
    <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-blue-900 mb-1">
            This instrument has no tests yet.
          </p>
          <p className="text-xs text-blue-700 mb-3">
            Copy a test menu from another instrument as a starting point, then adjust as needed.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={selected}
              onChange={e => setSelected(Number(e.target.value))}
              className="text-sm border border-blue-300 rounded-lg px-3 py-1.5 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {instruments.map(inst => (
                <option key={inst.id} value={inst.id}>
                  {inst.name}{inst.testCount ? ` (${inst.testCount} tests)` : ''}
                </option>
              ))}
            </select>
            <button
              onClick={() => selected && onCopy(Number(selected))}
              disabled={isCopying || !selected}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {isCopying ? 'Copying...' : 'Copy Test Menu'}
            </button>
            <span className="text-xs text-blue-600">or</span>
            <span className="text-xs text-blue-600 font-medium">start blank (add tests below)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CopyFromBannerInline({
  targetName,
  targetId,
  sources,
  onCopy,
  isCopying
}: {
  targetName: string,
  targetId: number,
  sources: Array<{id: number, name: string, testCount?: number}>,
  onCopy: (sourceInstId: number) => void,
  isCopying: boolean
}) {
  const [selected, setSelected] = useState<number>(sources[0]?.id ?? 0);

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-2">
      <div className="flex items-center gap-3 flex-wrap">
        <Copy size={14} className="text-blue-600 shrink-0" />
        <span className="text-sm text-blue-900 font-medium">
          {targetName} has no tests.
        </span>
        <span className="text-xs text-blue-700">Copy from:</span>
        <select
          value={selected}
          onChange={e => setSelected(Number(e.target.value))}
          className="text-xs border border-blue-300 rounded-lg px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {sources.map(inst => (
            <option key={inst.id} value={inst.id}>
              {inst.name}{inst.testCount ? ` (${inst.testCount} tests)` : ''}
            </option>
          ))}
        </select>
        <button
          onClick={() => selected && onCopy(selected)}
          disabled={isCopying || !selected}
          className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {isCopying ? 'Copying...' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VeritaMapMapPage() {
  const [, params] = useRoute("/veritamap-app/:id");
  const mapId = params?.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const readOnly = useIsReadOnly('veritamap');

  const [localTests, setLocalTests] = useState<TestRecord[]>([]);
  const [filterSpecialty, setFilterSpecialty] = useState<string>("all");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyFromInstrumentId, setCopyFromInstrumentId] = useState<number | null>(null);
  // Analyte values and AMR values keyed by analyte and instId::analyte respectively
  const [analyteValuesMap, setAnalyteValuesMap] = useState<Record<string, AnalyteValues>>({});
  const [amrValuesMap, setAmrValuesMap] = useState<Record<string, { amr_low?: string; amr_high?: string }>>({});

  // Refs for row scrolling (keyed by analyte)
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  // Debounce timers
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Fetch map detail
  const { data: mapDetail, isLoading } = useQuery<MapDetail>({
    queryKey: [`/api/veritamap/maps/${mapId}`],
    enabled: !!mapId,
    staleTime: 0,
    refetchOnMount: true,
  });

  // Fetch instruments for copy-from feature
  const { data: allInstruments = [] } = useQuery<
    Array<{id: number, instrument_name: string, role: string, category: string, tests?: any[]}>
  >({
    queryKey: [`/api/veritamap/maps/${mapId}/instruments`],
    enabled: !!mapId,
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/veritamap/maps/${mapId}/instruments`,
        { headers: authHeaders() }
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Instruments with test counts for the copy-from UI
  const instrumentsWithCounts = useMemo(() =>
    allInstruments.map(i => ({
      id: i.id,
      name: i.instrument_name,
      // Use total test count (not just active) to determine if instrument has been configured
      testCount: (i.tests ?? []).length,
      activeCount: (i.tests ?? []).filter((t: any) => t.active).length,
    })),
    [allInstruments]
  );

  // Find instruments that have zero tests (candidates for copy-to)
  const emptyInstruments = useMemo(() =>
    instrumentsWithCounts.filter(i => i.testCount === 0),
    [instrumentsWithCounts]
  );

  // Instruments with tests (candidates for copy-from source)
  const instrumentsWithTests = useMemo(() =>
    instrumentsWithCounts.filter(i => i.testCount > 0),
    [instrumentsWithCounts]
  );

  // Current instrument for copy-to (first empty instrument by default)
  const currentInstrumentId = useMemo(() => {
    if (copyFromInstrumentId && emptyInstruments.some(i => i.id === copyFromInstrumentId)) {
      return copyFromInstrumentId;
    }
    return emptyInstruments[0]?.id ?? null;
  }, [copyFromInstrumentId, emptyInstruments]);

  // Copy-from handler
  async function handleCopyFrom(sourceInstId: number) {
    if (!mapId || !currentInstrumentId) return;
    setIsCopying(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/veritamap/maps/${mapId}/instruments/${currentInstrumentId}/copy-from/${sourceInstId}`,
        {
          method: 'POST',
          headers: authHeaders(),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Copy failed', description: data.error, variant: 'destructive' });
      } else {
        toast({ title: 'Test menu copied', description: data.message });
        qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}`] });
        qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}/instruments`] });
        qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}/intelligence`] });
      }
    } catch {
      toast({ title: 'Copy failed', description: 'Network error. Please try again.', variant: 'destructive' });
    } finally {
      setIsCopying(false);
    }
  }

  // Fetch intelligence data
  const { data: intelligenceRaw } = useQuery<IntelligenceData | null>({
    queryKey: [`/api/veritamap/maps/${mapId}/intelligence`],
    enabled: !!mapId,
    staleTime: 0,
    refetchOnMount: true,
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/veritamap/maps/${mapId}/intelligence`,
        { headers: authHeaders() }
      );
      if (!res.ok) return null;
      const data = await res.json();
      // The API returns { intelligence: {...}, correlationCount, calVerCount, totalAnalytes }
      // Transform to IntelligenceData shape expected by components
      if (data?.intelligence && !Array.isArray(data.intelligence)) {
        const byAnalyte = data.intelligence as Record<string, any>;
        const correlationsRequired = Object.entries(byAnalyte)
          .filter(([, v]) => v.correlationRequired)
          .map(([analyte, v]) => ({
            analyte,
            instruments: (v.instruments ?? []).map((i: any) => ({
              id: i.id,
              instrument_name: i.name ?? i.instrument_name,
              role: i.role,
              category: i.category ?? '',
            })),
          }));
        const calVerRequired = Object.values(byAnalyte).filter((v) => v.calVerRequired).length;
        return { correlationsRequired, calVerRequired, compliantTests: 0 } as IntelligenceData;
      }
      return data as IntelligenceData;
    },
  });

  // Sync local tests from server
  useEffect(() => {
    if (mapDetail?.tests) {
      setLocalTests(mapDetail.tests);
    }
  }, [mapDetail?.tests]);

  // Fetch lab-entered analyte values and AMR values
  useEffect(() => {
    if (!mapId) return;
    fetch(`${API_BASE}/api/veritamap/maps/${mapId}/analyte-values`, { headers: authHeaders() })
      .then(r => r.json()).then((rows: any[]) => {
        const m: Record<string, AnalyteValues> = {};
        for (const row of rows) m[row.analyte] = row;
        setAnalyteValuesMap(m);
      }).catch(() => {});
    fetch(`${API_BASE}/api/veritamap/maps/${mapId}/amr-values`, { headers: authHeaders() })
      .then(r => r.json()).then((rows: any[]) => {
        const m: Record<string, { amr_low?: string; amr_high?: string }> = {};
        for (const row of rows) m[`${row.instrument_id}::${row.analyte}`] = row;
        setAmrValuesMap(m);
      }).catch(() => {});
  }, [mapId]);

  // Save analyte values (ref range, critical values, units)
  const handleSaveAnalyteValues = useCallback(async (analyte: string, values: AnalyteValues) => {
    await fetch(`${API_BASE}/api/veritamap/maps/${mapId}/analyte-values/${encodeURIComponent(analyte)}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setAnalyteValuesMap(prev => ({ ...prev, [analyte]: values }));
  }, [mapId]);

  // Save AMR values (per instrument)
  const handleSaveAmrValues = useCallback(async (analyte: string, instrumentId: number, values: { amr_low: string; amr_high: string }) => {
    await fetch(`${API_BASE}/api/veritamap/maps/${mapId}/amr-values/${instrumentId}/${encodeURIComponent(analyte)}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    setAmrValuesMap(prev => ({ ...prev, [`${instrumentId}::${analyte}`]: values }));
  }, [mapId]);

  // Intelligence — use API data or compute client-side from localTests
  const intelligence: IntelligenceData = useMemo(
    () => intelligenceRaw ?? computeIntelligence(localTests),
    [intelligenceRaw, localTests]
  );

  // Auto-save mutation
  const saveMutation = useMutation({
    mutationFn: async ({
      analyte,
      updates,
    }: {
      analyte: string;
      updates: Partial<TestRecord>;
    }) => {
      const encoded = encodeURIComponent(analyte);
      const res = await fetch(
        `${API_BASE}/api/veritamap/maps/${mapId}/tests/${encoded}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(updates),
        }
      );
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onError: () => {
      toast({ title: "Auto-save failed", variant: "destructive" });
    },
  });

  // Field change with 1.5s debounce
  const handleFieldChange = useCallback(
    (analyte: string, field: string, value: string) => {
      setLocalTests((prev) =>
        prev.map((t) =>
          t.analyte === analyte ? { ...t, [field]: value || null } : t
        )
      );
      const key = `${analyte}::${field}`;
      const existing = debounceTimers.current.get(key);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        saveMutation.mutate({ analyte, updates: { [field]: value || null } });
        debounceTimers.current.delete(key);
      }, 1500);
      debounceTimers.current.set(key, timer);
    },
    [saveMutation]
  );

  // Scroll to analyte row
  function scrollToAnalyte(analyte: string) {
    const el = rowRefs.current.get(analyte);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("bg-yellow-50", "dark:bg-yellow-950/20");
      setTimeout(() => {
        el.classList.remove("bg-yellow-50", "dark:bg-yellow-950/20");
      }, 1800);
    }
  }

  // Derived data
  const specialties = useMemo(() => {
    const s = new Set<string>();
    localTests.forEach((t) => s.add(t.specialty));
    return Array.from(s).sort();
  }, [localTests]);

  const filteredTests = useMemo(() => {
    const base = filterSpecialty === "all" ? localTests : localTests.filter((t) => t.specialty === filterSpecialty);
    return [...base].sort((a, b) => a.analyte.localeCompare(b.analyte));
  }, [localTests, filterSpecialty]);

  const compliance = useMemo(() => calcCompliance(localTests), [localTests]);

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return "-";
    try {
      return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "-";
    }
  }

  const scoreColor =
    compliance.score >= 80
      ? "text-emerald-600"
      : compliance.score >= 60
      ? "text-amber-600"
      : "text-red-600";

  const scoreBarColor =
    compliance.score >= 80
      ? "bg-emerald-500"
      : compliance.score >= 60
      ? "bg-amber-400"
      : "bg-red-500";

  // ── Loading / error states ───────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="text-muted-foreground text-sm">Loading map…</div>
      </div>
    );
  }

  if (!mapDetail) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] flex-col gap-3">
        <p className="text-muted-foreground text-sm">Map not found.</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/veritamap-app">
            <ArrowLeft size={13} className="mr-1" />
            Back to Maps
          </Link>
        </Button>
      </div>
    );
  }

  if (localTests.length === 0 && !isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] flex-col gap-4">
        {/* Copy-from banner: show when map has no tests but instruments exist */}
        {instrumentsWithTests.length > 0 && emptyInstruments.length > 0 && (
          <div className="w-full max-w-lg">
            {emptyInstruments.length > 1 && (
              <div className="mb-3">
                <label className="text-xs text-muted-foreground mb-1 block">Copy tests to:</label>
                <select
                  value={currentInstrumentId ?? ''}
                  onChange={e => setCopyFromInstrumentId(Number(e.target.value))}
                  className="text-sm border border-border rounded-lg px-3 py-1.5 bg-background text-foreground w-full"
                >
                  {emptyInstruments.map(inst => (
                    <option key={inst.id} value={inst.id}>{inst.name}</option>
                  ))}
                </select>
              </div>
            )}
            <CopyFromBanner
              instruments={instrumentsWithTests}
              onCopy={handleCopyFrom}
              isCopying={isCopying}
            />
          </div>
        )}
        {instrumentsWithTests.length === 0 && (
          <>
            <p className="text-muted-foreground text-sm">
              This map has no tests yet.
            </p>
            <Button
              onClick={() => navigate(`/veritamap-app/${mapId}/build`)}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Build Test Menu
              <ChevronRight size={13} className="ml-1" />
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-64px)]">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside
        className={`lg:sticky lg:top-16 lg:h-[calc(100vh-64px)] lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-border bg-card shrink-0 flex flex-col transition-all ${
          sidebarOpen ? "lg:w-56" : "lg:w-56"
        }`}
      >
        {/* Mobile top bar */}
        <div className="flex items-center justify-between px-4 py-3 lg:hidden">
          <span className="font-semibold text-sm truncate">{mapDetail.name}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Filter size={13} />
          </Button>
        </div>

        {/* Sidebar content */}
        <div
          className={`${
            !sidebarOpen ? "hidden lg:flex" : "flex"
          } flex-col gap-4 px-4 pb-4 lg:px-3 lg:py-4`}
        >
          {/* Back */}
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="justify-start -ml-1 text-muted-foreground h-8 text-xs px-2"
          >
            <Link href="/veritamap-app">
              <ArrowLeft size={12} className="mr-1" /> All Maps
            </Link>
          </Button>

          {/* Map name + date */}
          <div>
            <div className="font-semibold text-sm leading-tight mb-0.5 break-words">
              {mapDetail.name}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Updated {formatDate(mapDetail.updated_at)}
            </div>
          </div>

          {/* Compliance score */}
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide font-medium">
              Compliance Score
            </div>
            <div className={`text-2xl font-bold tabular-nums ${scoreColor}`}>
              {compliance.score}%
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${scoreBarColor}`}
                style={{ width: `${compliance.score}%` }}
              />
            </div>
            <div className="mt-2 space-y-1">
              {compliance.calVerOverdue > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-red-600">
                  <AlertOctagon size={10} />
                  {compliance.calVerOverdue} cal ver overdue
                </div>
              )}
              {compliance.methodCompMissing > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-amber-600">
                  <AlertTriangle size={10} />
                  {compliance.methodCompMissing} method comp missing
                </div>
              )}
              {compliance.sopOverdue > 0 && (
                <div className="flex items-center gap-1 text-[10px] text-amber-600">
                  <AlertTriangle size={10} />
                  {compliance.sopOverdue} SOP overdue
                </div>
              )}
              {compliance.calVerOverdue === 0 &&
                compliance.methodCompMissing === 0 && (
                  <div className="flex items-center gap-1 text-[10px] text-emerald-600">
                    <CheckCircle2 size={10} />
                    No critical gaps
                  </div>
                )}
            </div>
          </div>

          {/* Edit Instruments */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs justify-start"
            onClick={() => navigate(`/veritamap-app/${mapId}/build`)}
          >
            <Edit size={11} className="mr-1.5" />
            Edit Instruments
          </Button>

          {/* Specialty filter */}
          <div>
            <div className="text-[10px] text-muted-foreground mb-1.5 uppercase tracking-wide font-medium">
              Filter by Specialty
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                className={`text-left text-xs px-2 py-1 rounded transition-colors ${
                  filterSpecialty === "all"
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted"
                }`}
                onClick={() => setFilterSpecialty("all")}
              >
                All ({localTests.length})
              </button>
              {specialties.map((s) => {
                const count = localTests.filter((t) => t.specialty === s).length;
                return (
                  <button
                    key={s}
                    className={`text-left text-xs px-2 py-1 rounded transition-colors truncate ${
                      filterSpecialty === s
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                    onClick={() => setFilterSpecialty(s)}
                  >
                    {s} ({count})
                  </button>
                );
              })}
            </div>
          </div>

          {/* Export Excel */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs justify-start"
            disabled={excelLoading}
            onClick={async () => {
              setExcelLoading(true);
              try {
                await exportExcel(mapDetail.id, mapDetail.name);
              } catch (e) {
                console.error("Excel export error:", e);
                toast({ title: "Export failed", description: "Could not generate Excel file.", variant: "destructive" });
              } finally {
                setExcelLoading(false);
              }
            }}
          >
            <Download size={11} className="mr-1.5" />
            {excelLoading ? "Exporting..." : "Export Excel"}
          </Button>

          {/* VeritaCheck CTA */}
          <Button
            asChild
            size="sm"
            className="mt-1 bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs"
          >
            <Link href="/veritacheck">
              <FlaskConical size={11} className="mr-1.5" />
              Run a Study in VeritaCheck
            </Link>
          </Button>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-4 sm:px-6 py-5">
          {/* Mobile header */}
          <div className="flex items-center justify-between mb-4 lg:hidden">
            <h1 className="font-bold text-lg">{mapDetail.name}</h1>
          </div>

          {/* Intelligence Banner — HERO */}
          <IntelligenceBanner
            intelligence={intelligence}
            onAnalyteClick={scrollToAnalyte}
          />

          {/* Table meta row */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-muted-foreground">
              Showing{" "}
              <span className="font-semibold text-foreground">
                {filteredTests.length}
              </span>{" "}
              of {localTests.length} tests
              {filterSpecialty !== "all" && (
                <span className="ml-1">
                  in{" "}
                  <span className="text-foreground font-medium">
                    {filterSpecialty}
                  </span>
                </span>
              )}
            </div>
            {saveMutation.isPending && (
              <span className="text-[10px] text-muted-foreground animate-pulse">
                Saving…
              </span>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              Compliant
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
              Due within 30 days
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
              Overdue / Missing
            </span>
            <span className="flex items-center gap-1.5 border-l border-border pl-4">
              <span className="inline-block w-0.5 h-3 rounded-full bg-red-500" />
              Correlation gap
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-0.5 h-3 rounded-full bg-amber-400" />
              Cal Verification overdue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-0.5 h-3 rounded-full bg-emerald-400/60" />
              Fully compliant
            </span>
          </div>

          {/* Copy-from banner: show when some instruments have no tests */}
          {emptyInstruments.length > 0 && instrumentsWithTests.length > 0 && (
            <div className="mb-4">
              {emptyInstruments.map(emptyInst => (
                <CopyFromBannerInline
                  key={emptyInst.id}
                  targetName={emptyInst.name}
                  targetId={emptyInst.id}
                  sources={instrumentsWithTests}
                  onCopy={async (sourceId) => {
                    setIsCopying(true);
                    try {
                      const res = await fetch(
                        `${API_BASE}/api/veritamap/maps/${mapId}/instruments/${emptyInst.id}/copy-from/${sourceId}`,
                        { method: 'POST', headers: authHeaders() }
                      );
                      const data = await res.json();
                      if (!res.ok) {
                        toast({ title: 'Copy failed', description: data.error, variant: 'destructive' });
                      } else {
                        toast({ title: 'Test menu copied', description: data.message });
                        qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}`] });
                        qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}/instruments`] });
                        qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}/intelligence`] });
                      }
                    } catch {
                      toast({ title: 'Copy failed', description: 'Network error.', variant: 'destructive' });
                    } finally {
                      setIsCopying(false);
                    }
                  }}
                  isCopying={isCopying}
                />
              ))}
            </div>
          )}

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-border" style={{WebkitOverflowScrolling: 'touch'}}>
            <table className="min-w-full text-xs" style={{minWidth: '1100px'}}>
              <thead>
                <tr className="bg-muted/60 border-b border-border">
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Analyte
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Instruments
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Specialty
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Complexity
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    CFR
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      <AlertCircle size={10} className="text-red-500" />
                      Correlation Req'd
                    </span>
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Cal Verification
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Method Comparison
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Precision
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    SOP Review
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Notes
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTests.map((test) => (
                  <TestRow
                    key={test.analyte}
                    test={test}
                    onChange={handleFieldChange}
                    onRowMount={(el) => {
                      if (el) rowRefs.current.set(test.analyte, el);
                      else rowRefs.current.delete(test.analyte);
                    }}
                    analyteValues={analyteValuesMap[test.analyte]}
                    amrValues={Object.fromEntries(
                      (test.instruments ?? []).map(inst => [
                        inst.id,
                        amrValuesMap[`${inst.id}::${test.analyte}`] || {}
                      ])
                    )}
                    onSaveAnalyteValues={handleSaveAnalyteValues}
                    onSaveAmrValues={handleSaveAmrValues}
                    colCount={12}
                  />
                ))}
              </tbody>
            </table>

            {filteredTests.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No tests in this specialty.
              </div>
            )}
          </div>

          {/* Footer */}
          <p className="text-[10px] text-muted-foreground mt-3">
            Changes auto-save after 1.5 seconds. Calibration Verification and Correlation / Method Comparison required
            for non-waived tests (42 CFR §493.1255). SOP review cadence: 2 years.
            Correlations required when 2+ instruments run the same analyte (42 CFR
            §493.1213).
          </p>
        </div>
      </div>
    </div>
  );
}
