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
import { ModuleHowToCard } from "@/components/ModuleHowToCard";
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
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useMemberships } from "@/hooks/useMemberships";
import { getUser } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ─────────────────────────────────────────────────────────────────────

type Complexity = "MODERATE" | "HIGH" | "WAIVED";
type Role = "Primary" | "Backup" | "Satellite" | "POC" | "Reference";

interface InstrumentOnTest {
  id: number;
  instrument_name: string;
  role: Role;
  serial_number?: string | null;
  nickname?: string | null;
}

interface CorrelationRecord {
  id: number;
  test_a_id: number;
  test_b_id: number;
  correlation_group_id?: number | null;
  correlation_method?: string | null;
  acceptable_criteria?: string | null;
  actual_bias_or_sd?: string | null;
  pass_fail?: string | null;
  work_performed_date?: string | null;
  signoff_date?: string | null;
  signoff_by_user_id?: number | null;
  signoff_by_name?: string | null;
  next_due?: string | null;
  notes?: string | null;
  partner_test_id: number;
  partner_analyte: string;
  partner_map_id: number;
  partner_map_name: string;
  partner_instrument?: string | null;
  // 1 when test_a_id == test_b_id: an intra-row Pri↔Backup correlation on a
  // single analyte that has multiple methods listed in instrument_source.
  is_self_pair?: 0 | 1;
}

interface TestRecord {
  id: number;
  analyte: string;
  specialty: string;
  complexity: Complexity;
  instruments: InstrumentOnTest[];
  correlations?: CorrelationRecord[];
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
  // Wave A4 provenance: MEC review of critical values (MEC
  // Laboratories values are a starting point; the MEC owns the final values)
  // and director-or-designee attestation per 42 CFR 493.1253, which locks
  // the reference range until an owner/admin unlocks it.
  mec_reviewed_at?: string | null;
  mec_reviewed_by?: string | null;
  ref_attested_at?: string | null;
  ref_attested_by?: string | null;
  ref_attested_title?: string | null;
  ref_locked?: number | null;
  // Age/sex band. An analyte can carry several sets of values, because real labs
  // stratify by age (peds vs adult) and sex. Almost every analyte has exactly one
  // band, the "All ages" default, which is what a row meant before bands existed.
  // These travel with the row, so PUTting the object back addresses its own band.
  age_min_days?: number;
  age_max_days?: number;
  sex?: string;
  band_label?: string | null;
}

// Mirrors ALL_AGES_BAND in server/routes.ts. age_max_days is an UNBOUNDED
// sentinel rather than null because SQLite treats NULLs as DISTINCT inside a
// UNIQUE index (see server/db.ts).
const ALL_AGES = { age_min_days: 0, age_max_days: 999999, sex: "A", band_label: "All ages" };
const isAllAgesBand = (b?: AnalyteValues) =>
  !b || ((b.age_min_days ?? 0) === ALL_AGES.age_min_days && (b.age_max_days ?? ALL_AGES.age_max_days) === ALL_AGES.age_max_days && (b.sex ?? "A") === ALL_AGES.sex);
const sameBand = (a: AnalyteValues, b: AnalyteValues) =>
  (a.age_min_days ?? 0) === (b.age_min_days ?? 0) &&
  (a.age_max_days ?? ALL_AGES.age_max_days) === (b.age_max_days ?? ALL_AGES.age_max_days) &&
  (a.sex ?? "A") === (b.sex ?? "A");
// Display name for a band. Falls back to deriving one so a row written by an
// older client (band_label null) still reads sensibly.
function bandName(b: AnalyteValues): string {
  if (b.band_label) return b.band_label;
  const min = b.age_min_days ?? 0;
  const max = b.age_max_days ?? ALL_AGES.age_max_days;
  const fmt = (d: number) => (d % 365 === 0 ? `${d / 365} y` : `${d} d`);
  let age: string;
  if (min === 0 && max === ALL_AGES.age_max_days) age = "All ages";
  else if (max === ALL_AGES.age_max_days) age = `${fmt(min)} and older`;
  else if (min === 0) age = `0 to ${fmt(max)}`;
  else age = `${fmt(min)} to ${fmt(max)}`;
  const s = b.sex ?? "A";
  return age + (s === "F" ? ", female" : s === "M" ? ", male" : "");
}

interface AmrValues {
  [instrumentId: number]: {
    amr_low?: string | null; amr_high?: string | null;
    amr_attested_at?: string | null; amr_attested_by?: string | null;
    amr_attested_title?: string | null; amr_locked?: number | null;
  };
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

// Mirrors the helper in VeritaMapBuildPage. Blood bank compatibility tests
// are HIGH complexity per 42 CFR 493.17 (transfusion services); the asterisk
// + tooltip signals that the classification depends on the transfusion-use
// context (which is virtually always the case in clinical labs).
const TRANSFUSION_COMPAT_PATTERN = /(^ABO\b|^Rh\b|^Antibody [Ss]creen|^Antibody [Ss]creening|^Antibody [Ii]dentification|[Cc]rossmatch|^DAT\b|[Dd]irect [Aa]ntiglobulin|[Ii]ndirect [Aa]ntiglobulin|^Phenotyping|^Immediate [Ss]pin)/;
const BLOOD_BANK_SPECIALTIES = new Set(["Blood Bank", "Immunohematology"]);
function isTransfusionCompatibilityTest(analyte: string, specialty: string): boolean {
  if (!BLOOD_BANK_SPECIALTIES.has(specialty)) return false;
  return TRANSFUSION_COMPAT_PATTERN.test(analyte);
}
const TRANSFUSION_NOTE = "Classified HIGH complexity when used for transfusion services (the dominant use case in clinical labs). Per 42 CFR 493.17.";

function ComplexityBadge({ complexity, analyte, specialty }: { complexity: Complexity; analyte?: string; specialty?: string }) {
  const isCompat = analyte && specialty && isTransfusionCompatibilityTest(analyte, specialty);
  const title = isCompat ? TRANSFUSION_NOTE : undefined;
  const asterisk = isCompat ? <sup className="ml-0.5">*</sup> : null;
  if (complexity === "WAIVED")
    return (
      <Badge title={title} className="text-[10px] px-1.5 py-0 border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        WAIVED{asterisk}
      </Badge>
    );
  if (complexity === "HIGH")
    return (
      <Badge title={title} className="text-[10px] px-1.5 py-0 border-0 bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300">
        HIGH{asterisk}
      </Badge>
    );
  return (
    <Badge title={title} className="text-[10px] px-1.5 py-0 border-0 bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
      MODERATE{asterisk}
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
                Run a Study in VeritaCheck{"\u2122"}
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

async function exportExcel(mapId: number, mapName: string, activeLabId?: number | null): Promise<void> {
  const token = localStorage.getItem("veritas_token");
  const excelUrl = activeLabId
    ? `${API_BASE}/api/labs/${activeLabId}/veritamap/maps/${mapId}/excel`
    : `${API_BASE}/api/veritamap/maps/${mapId}/excel`;
  const res = await fetch(
    excelUrl,
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
  analyteBands?: AnalyteValues[];
  amrValues?: AmrValues;
  onSaveAnalyteValues?: (analyte: string, values: AnalyteValues) => void;
  onDeleteAnalyteBand?: (analyte: string, band: AnalyteValues) => Promise<void>;
  onSaveAmrValues?: (analyte: string, instrumentId: number, values: { amr_low: string; amr_high: string }) => void;
  onEditCorrelation?: (test: TestRecord, corr: CorrelationRecord | null) => void;
  readOnly?: boolean;
  colCount: number;
  // Wave A4 provenance actions (lab-scoped routes only; undefined on the
  // legacy URL form, which hides the controls). Returns the fresh row.
  onProvenance?: (
    action: "mec-review" | "attest-ref" | "unlock-ref" | "attest-amr" | "unlock-amr",
    analyte: string,
    payload?: Record<string, string>,
    instrumentId?: number,
  ) => Promise<void>;
  // Owner/admin may unlock attested values.
  canUnlock?: boolean;
}

// ── Correlation badges (read-only display on test rows) ─────────────────────

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  // Accept full ISO or YYYY-MM-DD
  const dateOnly = iso.length >= 10 ? iso.slice(0, 10) : iso;
  const [y, m, d] = dateOnly.split("-");
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y.slice(2)}`;
}

function correlationStatusColor(corr: CorrelationRecord): { bg: string; text: string; label: string } {
  if (corr.pass_fail === "Fail") {
    return { bg: "bg-red-100 dark:bg-red-950/40", text: "text-red-700 dark:text-red-300", label: "Fail" };
  }
  if (!corr.signoff_date) {
    return { bg: "bg-slate-100 dark:bg-slate-800/40", text: "text-slate-600 dark:text-slate-400", label: "Not signed" };
  }
  if (corr.next_due) {
    const dueDate = new Date(corr.next_due);
    const now = new Date();
    const daysUntil = (dueDate.getTime() - now.getTime()) / 86400_000;
    if (daysUntil < 0) return { bg: "bg-red-100 dark:bg-red-950/40", text: "text-red-700 dark:text-red-300", label: "Overdue" };
    if (daysUntil < 30) return { bg: "bg-amber-100 dark:bg-amber-950/40", text: "text-amber-700 dark:text-amber-300", label: "Due soon" };
  }
  return { bg: "bg-emerald-100 dark:bg-emerald-950/40", text: "text-emerald-700 dark:text-emerald-300", label: "Current" };
}

function CorrelationBadges({
  correlations,
  onEdit,
  onAdd,
  readOnly,
}: {
  correlations: CorrelationRecord[];
  onEdit?: (corr: CorrelationRecord) => void;
  onAdd?: () => void;
  readOnly?: boolean;
}) {
  const hasAny = correlations && correlations.length > 0;
  if (!hasAny && (readOnly || !onAdd)) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1 items-center">
      {correlations.map((corr) => {
        const status = correlationStatusColor(corr);
        const isSelf = corr.is_self_pair === 1 || corr.test_a_id === corr.test_b_id;
        const partnerLabel = isSelf
          ? `Pri↔Backup (${corr.partner_analyte})`
          : `${corr.partner_analyte} on ${corr.partner_map_name}`;
        const tooltipTitle = isSelf
          ? `Pri↔Backup correlation on ${corr.partner_analyte}`
          : `Correlates with ${corr.partner_analyte}`;
        const tooltipSub = isSelf
          ? (corr.partner_instrument ?? "Multiple methods on this analyte")
          : `on ${corr.partner_map_name}${corr.partner_instrument ? `, ${corr.partner_instrument}` : ""}`;
        const clickable = !!onEdit && !readOnly;
        return (
          <TooltipProvider key={corr.id} delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={clickable ? () => onEdit!(corr) : undefined}
                  onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onEdit!(corr); } } : undefined}
                  className={`inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded border border-border ${status.bg} ${status.text} ${clickable ? "cursor-pointer hover:ring-1 hover:ring-primary/40" : "cursor-default"}`}
                >
                  <GitMerge size={9} className="shrink-0" />
                  <span className="truncate max-w-[160px]">{partnerLabel}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs max-w-[280px]">
                <div className="space-y-1">
                  <div className="font-semibold">{tooltipTitle}</div>
                  <div className="text-muted-foreground">{tooltipSub}</div>
                  {corr.correlation_method && <div><span className="text-muted-foreground">Method:</span> {corr.correlation_method}</div>}
                  {corr.acceptable_criteria && <div><span className="text-muted-foreground">Criteria:</span> {corr.acceptable_criteria}</div>}
                  {corr.actual_bias_or_sd && <div><span className="text-muted-foreground">Result:</span> {corr.actual_bias_or_sd}</div>}
                  {corr.signoff_date && <div><span className="text-muted-foreground">Signed off:</span> {formatShortDate(corr.signoff_date)}{corr.signoff_by_name ? ` by ${corr.signoff_by_name}` : ""}</div>}
                  {corr.work_performed_date && <div><span className="text-muted-foreground">Work performed:</span> {formatShortDate(corr.work_performed_date)}</div>}
                  {corr.next_due && <div><span className="text-muted-foreground">Next due:</span> {formatShortDate(corr.next_due)} ({status.label})</div>}
                  {corr.pass_fail && <div><span className="text-muted-foreground">Status:</span> {corr.pass_fail}</div>}
                  {clickable && <div className="text-muted-foreground italic pt-1">Click to edit</div>}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
      {!readOnly && onAdd && (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-0.5 rounded border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/60"
          title="Add correlation to a test on another map"
        >
          <GitMerge size={9} className="shrink-0" />
          <span>Add</span>
        </button>
      )}
    </div>
  );
}

// ── Correlation edit modal (single-pair) ───────────────────────────────────

interface CandidatePartner {
  id: number;
  analyte: string;
  specialty: string;
  complexity: Complexity;
  instrument_source: string | null;
  map_id: number;
  map_name: string;
}

interface CorrelationEditModalProps {
  open: boolean;
  onClose: () => void;
  sourceTest: TestRecord | null;
  existing: CorrelationRecord | null; // null = new
  mapId: number | null;
  onSaved: () => void;
}

function addMonthsISO(iso: string, months: number): string {
  // iso = YYYY-MM-DD
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function CorrelationEditModal({ open, onClose, sourceTest, existing, mapId, onSaved }: CorrelationEditModalProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!existing;

  // Form state
  const [partnerTestId, setPartnerTestId] = useState<number | null>(
    existing?.partner_test_id ?? null
  );
  const [partnerSearch, setPartnerSearch] = useState("");
  const [method, setMethod] = useState(existing?.correlation_method ?? "");
  const [criteria, setCriteria] = useState(existing?.acceptable_criteria ?? "");
  const [actual, setActual] = useState(existing?.actual_bias_or_sd ?? "");
  const [passFail, setPassFail] = useState(existing?.pass_fail ?? "");
  const [workDate, setWorkDate] = useState(existing?.work_performed_date ?? "");
  const [signoffDate, setSignoffDate] = useState(existing?.signoff_date ?? "");
  const [signoffName, setSignoffName] = useState(existing?.signoff_by_name ?? "");
  const [nextDue, setNextDue] = useState(existing?.next_due ?? "");
  const [nextDueDirty, setNextDueDirty] = useState(false);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset form when opening for a different correlation/test
  useEffect(() => {
    if (!open) return;
    setPartnerTestId(existing?.partner_test_id ?? null);
    setPartnerSearch("");
    setMethod(existing?.correlation_method ?? "");
    setCriteria(existing?.acceptable_criteria ?? "");
    setActual(existing?.actual_bias_or_sd ?? "");
    setPassFail(existing?.pass_fail ?? "");
    setWorkDate(existing?.work_performed_date ?? "");
    setSignoffDate(existing?.signoff_date ?? "");
    setSignoffName(existing?.signoff_by_name ?? "");
    setNextDue(existing?.next_due ?? "");
    setNextDueDirty(false);
    setNotes(existing?.notes ?? "");
  }, [open, existing]);

  // Auto-fill signoff name + auto-calc next_due when signoff_date set
  useEffect(() => {
    if (signoffDate && !signoffName) {
      const u = getUser();
      if (u?.name) setSignoffName(u.name);
    }
    if (signoffDate && !nextDueDirty) {
      setNextDue(addMonthsISO(signoffDate, 6));
    }
  }, [signoffDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Candidate partners (only for new correlations)
  const { data: candidates = [], isLoading: candLoading } = useQuery<CandidatePartner[]>({
    queryKey: [`/api/veritamap/correlations/candidate-partners`, sourceTest?.id, partnerSearch],
    queryFn: async () => {
      if (!sourceTest?.id) return [];
      const params = new URLSearchParams({ test_id: String(sourceTest.id) });
      if (partnerSearch.trim()) params.set("q", partnerSearch.trim());
      const r = await fetch(`${API_BASE}/api/veritamap/correlations/candidate-partners?${params}`, {
        headers: authHeaders(),
      });
      if (!r.ok) throw new Error("Failed to load candidate tests");
      return r.json();
    },
    enabled: open && !isEdit && !!sourceTest?.id,
  });

  async function handleSave() {
    if (!sourceTest) return;
    if (!isEdit && !partnerTestId) {
      toast({ title: "Pick a partner test", description: "Choose the analyte on another map this correlates with.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const u = getUser();
      const body: Record<string, unknown> = {
        test_a_id: sourceTest.id,
        test_b_id: isEdit
          ? (existing!.partner_test_id) // server normalizes a<b
          : partnerTestId,
        correlation_method: method || null,
        acceptable_criteria: criteria || null,
        actual_bias_or_sd: actual || null,
        pass_fail: passFail || null,
        work_performed_date: workDate || null,
        signoff_date: signoffDate || null,
        signoff_by_user_id: signoffDate ? (u?.id ?? null) : null,
        signoff_by_name: signoffDate ? (signoffName || u?.name || null) : null,
        next_due: nextDue || null,
        notes: notes || null,
      };
      const r = await fetch(`${API_BASE}/api/veritamap/correlations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        toast({ title: "Save failed", description: data.error || "Server error", variant: "destructive" });
        return;
      }
      toast({ title: isEdit ? "Correlation updated" : "Correlation added" });
      if (mapId != null) qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).endsWith(`/veritamap/maps/${mapId}`) });
      onSaved();
      onClose();
    } catch {
      toast({ title: "Save failed", description: "Network error. Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!existing) return;
    if (!window.confirm("Remove this correlation? This cannot be undone.")) return;
    setDeleting(true);
    try {
      const r = await fetch(`${API_BASE}/api/veritamap/correlations/${existing.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        toast({ title: "Delete failed", description: data.error || "Server error", variant: "destructive" });
        return;
      }
      toast({ title: "Correlation removed" });
      if (mapId != null) qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).endsWith(`/veritamap/maps/${mapId}`) });
      onSaved();
      onClose();
    } catch {
      toast({ title: "Delete failed", description: "Network error. Please try again.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  if (!sourceTest) return null;

  const partnerLabel = isEdit
    ? `${existing!.partner_analyte} on ${existing!.partner_map_name}${existing!.partner_instrument ? `, ${existing!.partner_instrument}` : ""}`
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit correlation" : "Add correlation"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? `${sourceTest.analyte} <-> ${partnerLabel}`
              : `Pick the analyte on another map that ${sourceTest.analyte} correlates with.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Partner picker (new only) */}
          {!isEdit && (
            <div className="space-y-1">
              <Label>Partner test</Label>
              <Input
                placeholder="Filter by analyte..."
                value={partnerSearch}
                onChange={(e) => setPartnerSearch(e.target.value)}
                className="text-sm"
              />
              <div className="max-h-48 overflow-y-auto border border-border rounded text-sm">
                {candLoading ? (
                  <div className="p-3 text-muted-foreground">Loading...</div>
                ) : candidates.length === 0 ? (
                  <div className="p-3 text-muted-foreground italic">
                    No eligible partner tests in this lab. Either no other map has this analyte, or it is already correlated.
                  </div>
                ) : (
                  candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setPartnerTestId(c.id)}
                      className={`w-full text-left px-3 py-1.5 border-b border-border last:border-0 hover:bg-muted/50 ${partnerTestId === c.id ? "bg-primary/10 ring-1 ring-primary/40" : ""}`}
                    >
                      <div className="font-medium">{c.analyte}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {c.map_name} - {c.specialty}
                        {c.instrument_source ? ` - ${c.instrument_source}` : ""}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Method & criteria */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Correlation method</Label>
              <Input
                placeholder="e.g., Split-sample comparison, n=20"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Acceptable criteria</Label>
              <Input
                placeholder="e.g., Bias <= 10%"
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Actual bias or SD</Label>
              <Input
                placeholder="e.g., Bias 4.2%"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Result</Label>
              <Select value={passFail || "unset"} onValueChange={(v) => setPassFail(v === "unset" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Not set" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">Not set</SelectItem>
                  <SelectItem value="Pass">Pass</SelectItem>
                  <SelectItem value="Fail">Fail</SelectItem>
                  <SelectItem value="Pass with notes">Pass with notes</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>Work performed</Label>
              <Input type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Sign-off date</Label>
              <Input type="date" value={signoffDate} onChange={(e) => setSignoffDate(e.target.value)} />
              <div className="text-[10px] text-muted-foreground">Drives next-due (sign-off + 6 mo).</div>
            </div>
            <div className="space-y-1">
              <Label>Next due</Label>
              <Input
                type="date"
                value={nextDue}
                onChange={(e) => { setNextDue(e.target.value); setNextDueDirty(true); }}
              />
              {signoffDate && !nextDueDirty && (
                <div className="text-[10px] text-muted-foreground">Auto from sign-off. Override if needed.</div>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Signed off by</Label>
            <Input
              placeholder={signoffDate ? "Auto-filled from your account" : "Set sign-off date first"}
              value={signoffName}
              onChange={(e) => setSignoffName(e.target.value)}
              disabled={!signoffDate}
            />
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea
              placeholder="Optional notes about this correlation"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter className="flex flex-row justify-between sm:justify-between gap-2">
          <div>
            {isEdit && (
              <Button variant="destructive" onClick={handleDelete} disabled={deleting || saving}>
                {deleting ? "Removing..." : "Remove"}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving || deleting}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || deleting}>
              {saving ? "Saving..." : isEdit ? "Save changes" : "Add correlation"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TestRow({ test, onChange, onRowMount, analyteBands, amrValues, onSaveAnalyteValues, onDeleteAnalyteBand, onSaveAmrValues, onEditCorrelation, readOnly, colCount, onProvenance, canUnlock }: TestRowProps) {
  const [expanded, setExpanded] = React.useState(false);
  // An analyte can carry several age/sex bands. The row edits ONE at a time; the
  // band picker below only appears once there is more than one, so an analyte
  // with the usual single "All ages" band looks exactly as it always has.
  const bands = React.useMemo<AnalyteValues[]>(
    () => (analyteBands && analyteBands.length ? analyteBands : [{ ...ALL_AGES }]),
    [analyteBands],
  );
  const [activeBandKey, setActiveBandKey] = React.useState<string>("");
  const bandKey = (b: AnalyteValues) => `${b.age_min_days ?? 0}:${b.age_max_days ?? ALL_AGES.age_max_days}:${b.sex ?? "A"}`;
  const activeBand = React.useMemo(
    () => bands.find(b => bandKey(b) === activeBandKey) ?? bands[0],
    [bands, activeBandKey],
  );
  const [addingBand, setAddingBand] = React.useState(false);
  const [newBandMinY, setNewBandMinY] = React.useState("0");
  const [newBandMaxY, setNewBandMaxY] = React.useState("18");
  const [newBandSex, setNewBandSex] = React.useState("A");
  const [bandBusy, setBandBusy] = React.useState(false);
  // TestRow validates the add-band form locally and needs to tell the user why a
  // band was refused, so it needs its own toast; the page-level one is not in scope here.
  const { toast } = useToast();
  const [localAv, setLocalAv] = React.useState<AnalyteValues>(activeBand || {});
  const [localAmr, setLocalAmr] = React.useState<AmrValues>(amrValues || {});
  const [saving, setSaving] = React.useState(false);
  // Wave A4 provenance mini-forms. attestFor: "ref" or an instrument id.
  const [attestFor, setAttestFor] = React.useState<"ref" | number | null>(null);
  const [attestBy, setAttestBy] = React.useState("");
  const [attestTitle, setAttestTitle] = React.useState("");
  const [mecOpen, setMecOpen] = React.useState(false);
  const [mecDate, setMecDate] = React.useState("");
  const [mecBy, setMecBy] = React.useState("");
  const [provBusy, setProvBusy] = React.useState(false);
  const refLocked = !!localAv.ref_locked;
  // For the "Reference literature" link below: preserve active lab in URL so
  // opening it in a new tab doesn't bounce the user to their default lab via
  // the LegacyWorkspaceRedirect middleware (last follow-up from PR #182).
  const testRowActiveLabId = useActiveLabId();

  // Hydrate the editor from the ACTIVE band. Re-running when the active band
  // changes is what makes switching bands swap the values in the inputs. The
  // autosave hydration ref below keeps this from firing a spurious PUT.
  React.useEffect(() => { avHydratedRef.current = false; setLocalAv(activeBand || {}); }, [activeBand]);
  React.useEffect(() => { setLocalAmr(amrValues || {}); }, [amrValues]);

  // Autosave for the analyte-values and AMR-values dialogs. Debounced 1.5s
  // after the user stops typing; mirrors the field-edit autosave pattern at
  // VeritaMapMapPage.tsx:1728. Initial hydration (props arrive after mount,
  // or the user expands a row) sets localAv/localAmr via the effects above;
  // a hydration ref keeps that initial write from triggering an autosave.
  // The explicit "Save values" button still works (forces an immediate save).
  const avAutosaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const amrAutosaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const avHydratedRef = React.useRef(false);
  const amrHydratedRef = React.useRef(false);
  const [autosaveStatus, setAutosaveStatus] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedFadeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const flashSaved = React.useCallback(() => {
    setAutosaveStatus("saved");
    if (savedFadeTimer.current) clearTimeout(savedFadeTimer.current);
    savedFadeTimer.current = setTimeout(() => setAutosaveStatus("idle"), 1500);
  }, []);

  React.useEffect(() => {
    if (!avHydratedRef.current) { avHydratedRef.current = true; return; }
    if (!onSaveAnalyteValues) return;
    if (avAutosaveTimer.current) clearTimeout(avAutosaveTimer.current);
    avAutosaveTimer.current = setTimeout(async () => {
      setAutosaveStatus("saving");
      try {
        await onSaveAnalyteValues(test.analyte, localAv);
        flashSaved();
      } catch (err) {
        console.warn("[veritamap analyte autosave]", err);
        setAutosaveStatus("error");
      }
    }, 1500);
    return () => { if (avAutosaveTimer.current) clearTimeout(avAutosaveTimer.current); };
  }, [localAv, onSaveAnalyteValues, test.analyte, flashSaved]);

  // Resolve current instrument id set so autosave only fires PUTs for
  // instruments the user actually has on this map (instruments is computed
  // below; capture via a closure reference to avoid an ordering issue).
  const amrInstrumentsForEffect = test.instruments ?? [];
  React.useEffect(() => {
    if (!amrHydratedRef.current) { amrHydratedRef.current = true; return; }
    if (!onSaveAmrValues) return;
    if (amrAutosaveTimer.current) clearTimeout(amrAutosaveTimer.current);
    amrAutosaveTimer.current = setTimeout(async () => {
      setAutosaveStatus("saving");
      try {
        for (const inst of amrInstrumentsForEffect) {
          if (localAmr[inst.id]) {
            await onSaveAmrValues(test.analyte, inst.id, {
              amr_low: localAmr[inst.id].amr_low || "",
              amr_high: localAmr[inst.id].amr_high || "",
            });
          }
        }
        flashSaved();
      } catch (err) {
        console.warn("[veritamap AMR autosave]", err);
        setAutosaveStatus("error");
      }
    }, 1500);
    return () => { if (amrAutosaveTimer.current) clearTimeout(amrAutosaveTimer.current); };
  }, [localAmr, onSaveAmrValues, test.analyte, flashSaved]);

  React.useEffect(() => () => {
    if (savedFadeTimer.current) clearTimeout(savedFadeTimer.current);
    if (avAutosaveTimer.current) clearTimeout(avAutosaveTimer.current);
    if (amrAutosaveTimer.current) clearTimeout(amrAutosaveTimer.current);
  }, []);

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
      <td className="px-3 py-2 font-medium text-foreground max-w-[220px]">
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
        <CorrelationBadges
          correlations={test.correlations ?? []}
          onEdit={onEditCorrelation ? (corr) => onEditCorrelation(test, corr) : undefined}
          onAdd={onEditCorrelation ? () => onEditCorrelation(test, null) : undefined}
          readOnly={readOnly}
        />
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
        <ComplexityBadge complexity={test.complexity} analyte={test.analyte} specialty={test.specialty} />
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
              href={testRowActiveLabId ? `/labs/${testRowActiveLabId}/veritamap-app/resources` : "/veritamap-app/resources"}
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
          {/* Age/sex bands. CLIA labs stratify reference ranges and critical
              values by age (peds vs adult) and sex. The picker only appears once
              an analyte actually has more than one band, so the usual
              single-band analyte reads exactly as it did before bands existed.
              Ages are entered in years and stored in days, because neonatal
              bands need finer resolution than years. */}
          {(bands.length > 1 || addingBand || !readOnly) && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {bands.length > 1 && (
                <>
                  {/* Not "Values for": the panel heading above already reads
                      "Lab-Established Values for <analyte>", and two labels
                      opening the same way reads as a repeat. */}
                  <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mr-1">Age / sex band</span>
                  {bands.map(b => {
                    const active = bandKey(b) === bandKey(activeBand);
                    return (
                      <button
                        key={bandKey(b)}
                        type="button"
                        onClick={() => setActiveBandKey(bandKey(b))}
                        className={`text-[11px] rounded-full border px-2 py-0.5 transition-colors ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-secondary"}`}
                      >
                        {bandName(b)}{b.ref_locked ? " (locked)" : ""}
                      </button>
                    );
                  })}
                </>
              )}
              {!readOnly && onSaveAnalyteValues && !addingBand && (
                <button type="button" className="text-[11px] text-primary hover:underline px-1" onClick={() => setAddingBand(true)}>
                  + Add age/sex band
                </button>
              )}
              {!readOnly && onDeleteAnalyteBand && bands.length > 1 && !isAllAgesBand(activeBand) && !activeBand.ref_locked && (
                <button
                  type="button"
                  className="text-[11px] text-destructive hover:underline px-1"
                  disabled={bandBusy}
                  onClick={async () => {
                    setBandBusy(true);
                    try { await onDeleteAnalyteBand(test.analyte, activeBand); setActiveBandKey(""); }
                    catch { /* handler toasts */ }
                    finally { setBandBusy(false); }
                  }}
                >
                  Remove this band
                </button>
              )}
            </div>
          )}
          {addingBand && (
            <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border bg-secondary/40 p-2">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">From age (years)</label>
                <Input className="h-7 text-xs w-24" value={newBandMinY} onChange={e => setNewBandMinY(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">To age (years)</label>
                <Input className="h-7 text-xs w-24" value={newBandMaxY} onChange={e => setNewBandMaxY(e.target.value)} placeholder="blank = no limit" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">Sex</label>
                <select
                  className="h-7 text-xs rounded-md border border-input bg-background px-2"
                  value={newBandSex}
                  onChange={e => setNewBandSex(e.target.value)}
                >
                  <option value="A">Any</option>
                  <option value="F">Female</option>
                  <option value="M">Male</option>
                </select>
              </div>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={bandBusy}
                onClick={async () => {
                  const minY = Number(newBandMinY.trim() === "" ? "0" : newBandMinY);
                  const maxRaw = newBandMaxY.trim();
                  const minD = Math.round(minY * 365);
                  const maxD = maxRaw === "" ? ALL_AGES.age_max_days : Math.round(Number(maxRaw) * 365);
                  if (!Number.isFinite(minD) || !Number.isFinite(maxD) || minD < 0 || minD >= maxD) {
                    toast({ title: "Check the age range", description: "From-age must be a number less than the to-age. Leave the to-age blank for no upper limit.", variant: "destructive" });
                    return;
                  }
                  const candidate: AnalyteValues = { age_min_days: minD, age_max_days: maxD, sex: newBandSex };
                  if (bands.some(b => sameBand(b, candidate))) {
                    toast({ title: "That band already exists", description: `${test.analyte} already has ${bandName(candidate)}.`, variant: "destructive" });
                    return;
                  }
                  setBandBusy(true);
                  try {
                    // Create it empty; the director then types the values into the
                    // grid below, which autosaves against this band.
                    if (onSaveAnalyteValues) await onSaveAnalyteValues(test.analyte, { ...candidate, units: localAv.units ?? null });
                    setActiveBandKey(bandKey(candidate));
                    setAddingBand(false);
                  } catch { /* handler toasts */ }
                  finally { setBandBusy(false); }
                }}
              >
                Add band
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingBand(false)}>Cancel</Button>
            </div>
          )}
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
            {/* Ref Range. Locked once director-attested per 42 CFR 493.1253. */}
            <div>
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">Reference Range Low{refLocked ? " (locked)" : ""}</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. 136"
                value={localAv.ref_range_low || ""}
                disabled={refLocked}
                onChange={e => setLocalAv(v => ({ ...v, ref_range_low: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">Reference Range High{refLocked ? " (locked)" : ""}</label>
              <Input
                className="h-7 text-xs"
                placeholder="e.g. 145"
                value={localAv.ref_range_high || ""}
                disabled={refLocked}
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
          {/* Wave A4 provenance: MEC review on critical values + director
              attestation (42 CFR 493.1253) on the reference range. Controls
              only render on lab-scoped URLs (onProvenance present). */}
          {onProvenance && (
            <div className="mb-3 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                {localAv.mec_reviewed_at ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                    Critical values: MEC reviewed/approved {String(localAv.mec_reviewed_at).slice(0, 10)}{localAv.mec_reviewed_by ? `, recorded by ${localAv.mec_reviewed_by}` : ""}
                  </span>
                ) : (
                  <button type="button" className="text-[10px] underline text-blue-600 hover:text-blue-800" onClick={() => { setMecOpen(o => !o); setAttestFor(null); }}>
                    Record MEC review of critical values
                  </button>
                )}
                {refLocked ? (
                  <>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20">
                      Reference range attested per 42 CFR 493.1253 by {localAv.ref_attested_by}, {localAv.ref_attested_title} on {String(localAv.ref_attested_at).slice(0, 10)}
                    </span>
                    {canUnlock && (
                      <button type="button" className="text-[10px] underline text-amber-700 hover:text-amber-900" disabled={provBusy}
                        onClick={async () => { setProvBusy(true); try { await onProvenance("unlock-ref", test.analyte); } finally { setProvBusy(false); } }}>
                        Unlock
                      </button>
                    )}
                  </>
                ) : (localAv.ref_range_low && localAv.ref_range_high) ? (
                  <button type="button" className="text-[10px] underline text-blue-600 hover:text-blue-800" onClick={() => { setAttestFor(f => f === "ref" ? null : "ref"); setMecOpen(false); }}>
                    Attest reference range (director or designee)
                  </button>
                ) : null}
              </div>
              {mecOpen && !localAv.mec_reviewed_at && (
                <div className="flex flex-wrap items-end gap-2 bg-background border border-border rounded px-2 py-1.5">
                  <div>
                    <label className="text-[10px] text-muted-foreground block">MEC review/approval date</label>
                    <Input type="date" className="h-7 text-xs w-36" value={mecDate} onChange={e => setMecDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block">Recorded by</label>
                    <Input className="h-7 text-xs w-36" placeholder="Name or initials" value={mecBy} onChange={e => setMecBy(e.target.value)} />
                  </div>
                  <Button size="sm" className="h-7 text-xs" disabled={provBusy || !mecDate || !mecBy.trim()}
                    onClick={async () => {
                      setProvBusy(true);
                      try { await onProvenance("mec-review", test.analyte, { reviewed_at: mecDate, recorded_by: mecBy.trim() }); setMecOpen(false); }
                      finally { setProvBusy(false); }
                    }}>
                    Record review
                  </Button>
                  <span className="text-[10px] text-muted-foreground">Requires the MEC-adopted critical values entered above.</span>
                </div>
              )}
              {attestFor !== null && (
                <div className="flex flex-wrap items-end gap-2 bg-background border border-border rounded px-2 py-1.5">
                  <div>
                    <label className="text-[10px] text-muted-foreground block">Attested by (print name)</label>
                    <Input className="h-7 text-xs w-40" placeholder="e.g. M. Veri" value={attestBy} onChange={e => setAttestBy(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block">Title</label>
                    <Input className="h-7 text-xs w-44" placeholder="Medical director or designee" value={attestTitle} onChange={e => setAttestTitle(e.target.value)} />
                  </div>
                  <Button size="sm" className="h-7 text-xs" disabled={provBusy || !attestBy.trim() || !attestTitle.trim()}
                    onClick={async () => {
                      setProvBusy(true);
                      try {
                        if (attestFor === "ref") await onProvenance("attest-ref", test.analyte, { attested_by: attestBy.trim(), attested_title: attestTitle.trim() });
                        else await onProvenance("attest-amr", test.analyte, { attested_by: attestBy.trim(), attested_title: attestTitle.trim() }, attestFor);
                        setAttestFor(null);
                      } finally { setProvBusy(false); }
                    }}>
                    Attest and lock
                  </Button>
                  <span className="text-[10px] text-muted-foreground">Verified per 42 CFR 493.1253. Locks the value; owner or admin can unlock.</span>
                </div>
              )}
            </div>
          )}
          {/* AMR per instrument */}
          {instruments.length > 0 && (
            <div className="mb-3">
              <label className="text-[10px] text-muted-foreground font-medium block mb-1">AMR (Analytical Measurement Range) - per instrument</label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {instruments.map(inst => {
                  const amrLocked = !!localAmr[inst.id]?.amr_locked;
                  return (
                  <div key={inst.id} className="flex items-center gap-2 bg-background rounded border border-border px-2 py-1.5">
                    <span className="text-[10px] font-medium min-w-[100px] truncate text-foreground">{inst.instrument_name}</span>
                    <Input
                      className="h-6 text-xs w-20"
                      placeholder="Low"
                      value={localAmr[inst.id]?.amr_low || ""}
                      disabled={amrLocked}
                      onChange={e => setLocalAmr(v => ({ ...v, [inst.id]: { ...v[inst.id], amr_low: e.target.value } }))}
                    />
                    <span className="text-[10px] text-muted-foreground">to</span>
                    <Input
                      className="h-6 text-xs w-20"
                      placeholder="High"
                      value={localAmr[inst.id]?.amr_high || ""}
                      disabled={amrLocked}
                      onChange={e => setLocalAmr(v => ({ ...v, [inst.id]: { ...v[inst.id], amr_high: e.target.value } }))}
                    />
                    {/* Wave A4: per-instrument AMR attestation per 42 CFR 493.1253 */}
                    {onProvenance && (amrLocked ? (
                      <span className="flex items-center gap-1">
                        <span className="text-[10px] text-emerald-700 dark:text-emerald-400" title={`Attested by ${localAmr[inst.id]?.amr_attested_by}, ${localAmr[inst.id]?.amr_attested_title} on ${String(localAmr[inst.id]?.amr_attested_at).slice(0, 10)}`}>
                          Attested {String(localAmr[inst.id]?.amr_attested_at).slice(0, 10)}
                        </span>
                        {canUnlock && (
                          <button type="button" className="text-[10px] underline text-amber-700 hover:text-amber-900" disabled={provBusy}
                            onClick={async () => { setProvBusy(true); try { await onProvenance("unlock-amr", test.analyte, undefined, inst.id); } finally { setProvBusy(false); } }}>
                            Unlock
                          </button>
                        )}
                      </span>
                    ) : (localAmr[inst.id]?.amr_low && localAmr[inst.id]?.amr_high) ? (
                      <button type="button" className="text-[10px] underline text-blue-600 hover:text-blue-800" onClick={() => { setAttestFor(f => f === inst.id ? null : inst.id); setMecOpen(false); }}>
                        Attest
                      </button>
                    ) : null)}
                  </div>
                  );
                })}
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
                } catch {
                  setAutosaveStatus("error");
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
            {autosaveStatus === "saving" && (
              <span className="text-xs text-muted-foreground ml-1">Autosaving...</span>
            )}
            {autosaveStatus === "saved" && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 ml-1">Saved</span>
            )}
            {autosaveStatus === "error" && (
              <span className="text-xs text-red-600 dark:text-red-400 ml-1">Save failed (will retry on next change)</span>
            )}
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
  // This component is mounted from BOTH the legacy /veritamap-app/:id route
  // and the lab-scoped /labs/:labId/veritamap-app/:id route (see App.tsx
  // Phase 3.3b). Match both patterns so mapId resolves correctly on either
  // URL shape. Without the second match, lab-scoped URLs leave mapId
  // undefined, the detail query gates off, and the page silently renders
  // "Map not found" without ever calling the server.
  const [, legacyParams] = useRoute("/veritamap-app/:id");
  const [, labScopedParams] = useRoute("/labs/:labId/veritamap-app/:id");
  const mapId = labScopedParams?.id ?? legacyParams?.id;
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
  // analyte -> its age/sex bands. Almost always a single "All ages" band.
  const [analyteValuesMap, setAnalyteValuesMap] = useState<Record<string, AnalyteValues[]>>({});
  const [amrValuesMap, setAmrValuesMap] = useState<Record<string, { amr_low?: string; amr_high?: string }>>({});

  // Correlation edit modal state
  const [corrModalOpen, setCorrModalOpen] = useState(false);
  const [corrModalTest, setCorrModalTest] = useState<TestRecord | null>(null);
  const [corrModalExisting, setCorrModalExisting] = useState<CorrelationRecord | null>(null);
  const openCorrModal = (test: TestRecord, corr: CorrelationRecord | null) => {
    setCorrModalTest(test);
    setCorrModalExisting(corr);
    setCorrModalOpen(true);
  };

  // Refs for row scrolling (keyed by analyte)
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  // Debounce timers
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Multi-Lab Tier 2 Phase 3.3b: lab-scope the single-map fetch + every
  // sub-resource (instruments, intelligence, analyte-values, amr-values,
  // tests/:analyte, copy-from) when on /labs/:labId/veritamap-app/:id.
  // The server enforces map.lab_id = activeLabId on each call, so a
  // stale URL from another lab the user is a member of returns 404.
  const activeLabId = useActiveLabId();
  const mapApiBase = activeLabId
    ? `/api/labs/${activeLabId}/veritamap/maps/${mapId}`
    : `/api/veritamap/maps/${mapId}`;
  // Wave A4: owner/admin on the active lab may unlock attested values.
  const { data: provMemberships } = useMemberships();
  const activeRole = provMemberships?.find(m => m.labId === activeLabId)?.role;
  const canUnlockProvenance = activeRole === "owner" || activeRole === "admin";
  const mapDetailUrl = mapApiBase;

  // Fetch map detail
  const { data: mapDetail, isLoading } = useQuery<MapDetail>({
    queryKey: [mapDetailUrl],
    enabled: !!mapId,
    staleTime: 0,
    refetchOnMount: true,
  });

  // Lightweight: count of maps owned by this user (drives toggle visibility).
  // Lab-scoped so multi-lab owners see only the maps for the active lab; the
  // toggle would otherwise reflect the union across every lab the owner has.
  const allMapsUrl = activeLabId
    ? `/api/labs/${activeLabId}/veritamap/maps`
    : `/api/veritamap/maps`;
  const { data: allMaps = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: [allMapsUrl],
  });

  // Fetch instruments for copy-from feature
  const { data: allInstruments = [] } = useQuery<
    Array<{id: number, instrument_name: string, role: string, category: string, tests?: any[]}>
  >({
    queryKey: [`${mapApiBase}/instruments`],
    enabled: !!mapId,
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}${mapApiBase}/instruments`,
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
        `${API_BASE}${mapApiBase}/instruments/${currentInstrumentId}/copy-from/${sourceInstId}`,
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
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).endsWith(`/veritamap/maps/${mapId}`) });
        qc.invalidateQueries({ queryKey: [`${mapApiBase}/instruments`] });
        qc.invalidateQueries({ queryKey: [`${mapApiBase}/intelligence`] });
      }
    } catch {
      toast({ title: 'Copy failed', description: 'Network error. Please try again.', variant: 'destructive' });
    } finally {
      setIsCopying(false);
    }
  }

  // Fetch intelligence data
  const { data: intelligenceRaw } = useQuery<IntelligenceData | null>({
    queryKey: [`${mapApiBase}/intelligence`],
    enabled: !!mapId,
    staleTime: 0,
    refetchOnMount: true,
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}${mapApiBase}/intelligence`,
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
    fetch(`${API_BASE}${mapApiBase}/analyte-values`, { headers: authHeaders() })
      .then(r => r.json()).then((rows: any[]) => {
        // Group by analyte: an analyte can carry several age/sex bands. The old
        // `m[row.analyte] = row` kept only whichever band came back last, which
        // silently hid the rest and was order-dependent. Sorted All-ages first.
        const m: Record<string, AnalyteValues[]> = {};
        for (const row of rows) {
          if (!m[row.analyte]) m[row.analyte] = [];
          m[row.analyte].push(row);
        }
        for (const list of Object.values(m)) {
          list.sort((a, b) => (isAllAgesBand(a) ? -1 : isAllAgesBand(b) ? 1 : (a.age_min_days ?? 0) - (b.age_min_days ?? 0)));
        }
        setAnalyteValuesMap(m);
      }).catch(() => {});
    fetch(`${API_BASE}${mapApiBase}/amr-values`, { headers: authHeaders() })
      .then(r => r.json()).then((rows: any[]) => {
        const m: Record<string, { amr_low?: string; amr_high?: string }> = {};
        for (const row of rows) m[`${row.instrument_id}::${row.analyte}`] = row;
        setAmrValuesMap(m);
      }).catch(() => {});
  }, [mapId, mapApiBase]);

  // Save analyte values (ref range, critical values, units) for ONE band.
  // `values` carries its own band fields, so the PUT addresses that band; a value
  // object with no band fields defaults to All-ages server-side, which is what
  // every row meant before bands existed.
  const handleSaveAnalyteValues = useCallback(async (analyte: string, values: AnalyteValues) => {
    const res = await fetch(`${API_BASE}${mapApiBase}/analyte-values/${encodeURIComponent(analyte)}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const msg = await res.json().then((d: any) => d?.error).catch(() => null);
      toast({ title: "Values not saved", description: msg || "Server error. Please try again.", variant: "destructive" });
      throw new Error(msg || `analyte-values save failed (${res.status})`);
    }
    const saved: AnalyteValues = await res.json().catch(() => values);
    // Replace the matching band only. Replacing the whole analyte would drop the
    // other bands out of local state until a reload.
    setAnalyteValuesMap(prev => {
      const list = prev[analyte] ?? [];
      const idx = list.findIndex(b => sameBand(b, saved));
      const next = idx >= 0 ? list.map((b, i) => (i === idx ? saved : b)) : [...list, saved];
      next.sort((a, b) => (isAllAgesBand(a) ? -1 : isAllAgesBand(b) ? 1 : (a.age_min_days ?? 0) - (b.age_min_days ?? 0)));
      return { ...prev, [analyte]: next };
    });
  }, [mapId, mapApiBase, toast]);

  // Delete one age/sex band off an analyte. The server refuses an attested band
  // (493.1253) and never removes the analyte from the map itself.
  const handleDeleteAnalyteBand = useCallback(async (analyte: string, band: AnalyteValues) => {
    const res = await fetch(`${API_BASE}${mapApiBase}/analyte-values/${encodeURIComponent(analyte)}/band`, {
      method: "DELETE",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ age_min_days: band.age_min_days ?? 0, age_max_days: band.age_max_days ?? ALL_AGES.age_max_days, sex: band.sex ?? "A" }),
    });
    if (!res.ok) {
      const msg = await res.json().then((d: any) => d?.error).catch(() => null);
      toast({ title: "Band not removed", description: msg || "Server error. Please try again.", variant: "destructive" });
      throw new Error(msg || `band delete failed (${res.status})`);
    }
    setAnalyteValuesMap(prev => ({ ...prev, [analyte]: (prev[analyte] ?? []).filter(b => !sameBand(b, band)) }));
    toast({ title: "Band removed", description: `${analyte}: ${bandName(band)}` });
  }, [mapId, mapApiBase, toast]);

  // Save AMR values (per instrument)
  const handleSaveAmrValues = useCallback(async (analyte: string, instrumentId: number, values: { amr_low: string; amr_high: string }) => {
    const res = await fetch(`${API_BASE}${mapApiBase}/amr-values/${instrumentId}/${encodeURIComponent(analyte)}`, {
      method: "PUT",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const msg = await res.json().then((d: any) => d?.error).catch(() => null);
      toast({ title: "AMR not saved", description: msg || "Server error. Please try again.", variant: "destructive" });
      throw new Error(msg || `amr-values save failed (${res.status})`);
    }
    setAmrValuesMap(prev => ({ ...prev, [`${instrumentId}::${analyte}`]: { ...prev[`${instrumentId}::${analyte}`], ...values } }));
  }, [mapId, mapApiBase, toast]);

  // Wave A4 provenance actions: MEC review on critical values, 493.1253
  // attestation + unlock on ref range and per-instrument AMR. Lab-scoped
  // routes only; the prop is undefined on the legacy URL form so the
  // controls do not render there. The server returns the fresh row, which
  // refreshes state so badges/locks update immediately.
  const handleProvenance = useCallback(async (
    action: "mec-review" | "attest-ref" | "unlock-ref" | "attest-amr" | "unlock-amr",
    analyte: string,
    payload?: Record<string, string>,
    instrumentId?: number,
  ) => {
    const enc = encodeURIComponent(analyte);
    const url =
      action === "mec-review" ? `${mapApiBase}/analyte-values/${enc}/mec-review` :
      action === "attest-ref" ? `${mapApiBase}/analyte-values/${enc}/attest-ref` :
      action === "unlock-ref" ? `${mapApiBase}/analyte-values/${enc}/unlock-ref` :
      action === "attest-amr" ? `${mapApiBase}/amr-values/${instrumentId}/${enc}/attest` :
      `${mapApiBase}/amr-values/${instrumentId}/${enc}/unlock`;
    const r = await fetch(`${API_BASE}${url}`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });
    const row = await r.json();
    if (!r.ok) { alert(row?.error || "Action failed"); return; }
    if (action === "attest-amr" || action === "unlock-amr") {
      setAmrValuesMap(prev => ({ ...prev, [`${instrumentId}::${analyte}`]: row }));
    } else {
      setAnalyteValuesMap(prev => ({ ...prev, [analyte]: row }));
    }
  }, [mapApiBase]);

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
        `${API_BASE}${mapApiBase}/tests/${encoded}`,
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

  // Per-column sortable headers. Default sort is Analyte ascending to match
  // the previous always-on behavior; user clicks toggle direction or pick
  // a different column. Sortable fields cover every data column except
  // Actions. Date columns sort missing/null values to the end (descending
  // last) so missing-date rows do not crowd the top.
  type MapSortField =
    | "analyte"
    | "instruments"
    | "specialty"
    | "complexity"
    | "cfr"
    | "correlation_required"
    | "last_cal_ver"
    | "last_method_comp"
    | "last_precision"
    | "last_sop_review"
    | "notes";
  const [sortField, setSortField] = useState<MapSortField>("analyte");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const handleSort = (field: MapSortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  const filteredTests = useMemo(() => {
    const base = filterSpecialty === "all" ? localTests : localTests.filter((t) => t.specialty === filterSpecialty);
    // Pull comparison values per field. Dates use "9999-12-31" sentinel so
    // null sorts to the end on ascending. Booleans coerce to 0/1.
    const valueFor = (t: TestRecord, f: MapSortField): string | number => {
      switch (f) {
        case "analyte":              return t.analyte.toLowerCase();
        case "instruments":          return ((t.instruments ?? [])[0]?.instrument_name ?? "").toLowerCase();
        case "specialty":            return (t.specialty ?? "").toLowerCase();
        case "complexity":           return (t.complexity ?? "").toLowerCase();
        case "cfr":                  return getCFR(t.specialty).toLowerCase();
        case "correlation_required": return ((t.complexity !== "WAIVED") && ((t.instruments ?? []).length >= 2)) ? 0 : 1;
        case "last_cal_ver":         return t.last_cal_ver ?? "9999-12-31";
        case "last_method_comp":     return t.last_method_comp ?? "9999-12-31";
        case "last_precision":       return t.last_precision ?? "9999-12-31";
        case "last_sop_review":      return t.last_sop_review ?? "9999-12-31";
        case "notes":                return (t.notes ?? "").toLowerCase();
      }
    };
    return [...base].sort((a, b) => {
      const av = valueFor(a, sortField);
      const bv = valueFor(b, sortField);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [localTests, filterSpecialty, sortField, sortDir]);

  // Header component — active column shows a teal directional arrow,
  // inactive columns show a muted ↕ as the affordance.
  const SortableHeader = ({ field, children, className }: { field: MapSortField; children: React.ReactNode; className?: string }) => {
    const isActive = sortField === field;
    return (
      <th
        className={`px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap cursor-pointer hover:text-[#01696F] select-none ${className ?? ""}`}
        onClick={() => handleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {isActive ? (
            <span className="text-xs text-[#01696F]">{sortDir === "asc" ? "▲" : "▼"}</span>
          ) : (
            <span className="text-xs text-muted-foreground/40">{"↕"}</span>
          )}
        </span>
      </th>
    );
  };

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
          <Link href={activeLabId ? `/labs/${activeLabId}/veritamap-app` : "/veritamap-app"}>
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
              onClick={() => navigate(activeLabId
                ? `/labs/${activeLabId}/veritamap-app/${mapId}/build`
                : `/veritamap-app/${mapId}/build`)}
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
            <Link href={activeLabId ? `/labs/${activeLabId}/veritamap-app` : "/veritamap-app"}>
              <ArrowLeft size={12} className="mr-1" /> All Maps
            </Link>
          </Button>

          {/* Toggle: This map / Whole lab. PARKING_LOT #19 Phase 1.
              Hidden for single-map labs to avoid clutter. */}
          {allMaps.length > 1 && (
            <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
              <Button
                size="sm"
                className="flex-1 h-7 text-[11px] px-2 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                This map
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="flex-1 h-7 text-[11px] px-2"
                onClick={() => navigate(activeLabId
                  ? `/labs/${activeLabId}/veritamap-app/labwide`
                  : "/veritamap-app/labwide")}
              >
                Whole lab
              </Button>
            </div>
          )}

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
            onClick={() => navigate(activeLabId
              ? `/labs/${activeLabId}/veritamap-app/${mapId}/build`
              : `/veritamap-app/${mapId}/build`)}
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
                await exportExcel(mapDetail.id, mapDetail.name, activeLabId);
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
              Run a Study in VeritaCheck{"\u2122"}
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
      <ModuleHowToCard
        moduleKey="veritamap"
        moduleName="VeritaMap™"
        whatItDoes="VeritaMap is where you build your facility's test menu. Pick the instruments your lab runs, toggle the tests you actually perform on each, and the menu becomes the source of truth that feeds VeritaCheck (study setup), VeritaComp (competency programs), VeritaPT (PT coverage), and VeritaTrack (regulatory calendar). The menu also captures CLIA complexity, specialty, FDA classification, and fields for the critical values, reference intervals, and AMR your lab will verify and enter per 42 CFR 493.1253."
        howToUse={[
          "Add the instruments your lab runs from the database of 190+ FDA-cleared analyzers.",
          "Toggle the tests you actually perform on each instrument; CLIA complexity, specialty, and FDA classification populate automatically.",
          "Record your facility's MEC-adopted critical values for each analyte, if your lab chooses to track them here.",
          "Enter your verified reference intervals and AMR per 42 CFR 493.1253.",
          "Other Verita modules read from this menu automatically; update here whenever you add or retire a test."
        ]}
      />


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
                        `${API_BASE}${mapApiBase}/instruments/${emptyInst.id}/copy-from/${sourceId}`,
                        { method: 'POST', headers: authHeaders() }
                      );
                      const data = await res.json();
                      if (!res.ok) {
                        toast({ title: 'Copy failed', description: data.error, variant: 'destructive' });
                      } else {
                        toast({ title: 'Test menu copied', description: data.message });
                        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).endsWith(`/veritamap/maps/${mapId}`) });
                        qc.invalidateQueries({ queryKey: [`${mapApiBase}/instruments`] });
                        qc.invalidateQueries({ queryKey: [`${mapApiBase}/intelligence`] });
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
                  <SortableHeader field="analyte">Analyte</SortableHeader>
                  <SortableHeader field="instruments">Instruments</SortableHeader>
                  <SortableHeader field="specialty">Specialty</SortableHeader>
                  <SortableHeader field="complexity">Complexity</SortableHeader>
                  <SortableHeader field="cfr">CFR</SortableHeader>
                  <SortableHeader field="correlation_required">
                    <span className="flex items-center gap-1">
                      <AlertCircle size={10} className="text-red-500" />
                      Correlation Req'd
                    </span>
                  </SortableHeader>
                  <SortableHeader field="last_cal_ver">Cal Verification</SortableHeader>
                  <SortableHeader field="last_method_comp">Method Comparison</SortableHeader>
                  <SortableHeader field="last_precision">Precision</SortableHeader>
                  <SortableHeader field="last_sop_review">SOP Review</SortableHeader>
                  <SortableHeader field="notes">Notes</SortableHeader>
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
                    analyteBands={analyteValuesMap[test.analyte]}
                    amrValues={Object.fromEntries(
                      (test.instruments ?? []).map(inst => [
                        inst.id,
                        amrValuesMap[`${inst.id}::${test.analyte}`] || {}
                      ])
                    )}
                    onSaveAnalyteValues={handleSaveAnalyteValues}
                    onDeleteAnalyteBand={handleDeleteAnalyteBand}
                    onSaveAmrValues={handleSaveAmrValues}
                    onProvenance={activeLabId ? handleProvenance : undefined}
                    canUnlock={canUnlockProvenance}
                    onEditCorrelation={openCorrModal}
                    readOnly={readOnly}
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
          {/* Legend for the asterisk that appears on Blood Bank / Immunohematology
              compatibility tests. Hover tooltip is easy to miss (and broken on
              mobile), so the explanation is printed here as the clinical-document
              standard. */}
          <p className="text-[10px] text-muted-foreground mt-1">
            <span className="font-semibold">*</span> Blood Bank / Immunohematology compatibility tests (ABO, Rh, antibody
            screen, crossmatch, DAT, phenotyping) are classified HIGH complexity when used for transfusion services, which
            is the dominant use case in clinical labs. Per 42 CFR §493.17.
          </p>
        </div>
      </div>

      <CorrelationEditModal
        open={corrModalOpen}
        onClose={() => setCorrModalOpen(false)}
        sourceTest={corrModalTest}
        existing={corrModalExisting}
        mapId={mapId ? parseInt(mapId, 10) : null}
        onSaved={() => { /* invalidation handled inside modal */ }}
      />
    </div>
  );
}
