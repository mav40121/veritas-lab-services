import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Download,
  Edit,
  FlaskConical,
  AlertTriangle,
  CheckCircle2,
  AlertOctagon,
  ChevronRight,
  Filter,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

type Complexity = "MODERATE" | "HIGH" | "WAIVED";

interface TestRecord {
  analyte: string;
  specialty: string;
  complexity: Complexity;
  active?: boolean;
  instrument_source?: string;
  last_cal_ver?: string | null;
  last_method_comp?: string | null;
  last_precision?: string | null;
  last_sop_review?: string | null;
  notes?: string;
}

interface MapDetail {
  id: number;
  name: string;
  updated_at: string;
  tests: TestRecord[];
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

const SPECIALTY_COLORS: Record<string, { bg: string; text: string; badge: string }> = {
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
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
  },
  "General Immunology": {
    bg: "bg-purple-50 dark:bg-purple-950/20",
    text: "text-purple-700 dark:text-purple-300",
    badge: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
  },
  Endocrinology: {
    bg: "bg-violet-50 dark:bg-violet-950/20",
    text: "text-violet-700 dark:text-violet-300",
    badge: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  },
  Toxicology: {
    bg: "bg-amber-50 dark:bg-amber-950/20",
    text: "text-amber-700 dark:text-amber-300",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  },
  Immunohematology: {
    bg: "bg-pink-50 dark:bg-pink-950/20",
    text: "text-pink-700 dark:text-pink-300",
    badge: "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
  },
  Urinalysis: {
    bg: "bg-yellow-50 dark:bg-yellow-950/20",
    text: "text-yellow-700 dark:text-yellow-300",
    badge: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300",
  },
  "Blood Gas": {
    bg: "bg-sky-50 dark:bg-sky-950/20",
    text: "text-sky-700 dark:text-sky-300",
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  },
  Microbiology: {
    bg: "bg-green-50 dark:bg-green-950/20",
    text: "text-green-700 dark:text-green-300",
    badge: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
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

// ── Date status logic ─────────────────────────────────────────────────────────

type DateStatus = "ok" | "due-soon" | "overdue" | "missing";

/**
 * @param dateStr ISO date string or null
 * @param maxMonths months before overdue (6 = cal ver / method comp, 24 = SOP)
 * @param warningDays days before expiry to show amber
 */
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
  const maxDays = maxMonths * 30.44 + 20; // +20 days grace for cal ver
  if (diffDays > maxDays) return "overdue";
  if (diffDays > maxDays - warningDays) return "due-soon";
  return "ok";
}

function StatusDot({ status }: { status: DateStatus }) {
  if (status === "ok")
    return (
      <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
    );
  if (status === "due-soon")
    return (
      <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
    );
  if (status === "overdue")
    return (
      <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
    );
  return <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground/40 border border-muted-foreground/30" />;
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
  const status = disabled ? ("ok" as DateStatus) : getDateStatus(value, maxMonths, warningDays);
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
        className={`h-7 text-xs px-1.5 w-[120px] ${borderClass} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}
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

// ── CSV Export ────────────────────────────────────────────────────────────────

function exportCSV(mapName: string, tests: TestRecord[]) {
  const headers = [
    "Analyte",
    "Specialty",
    "Complexity",
    "CFR Section",
    "Last Cal Ver",
    "Cal Ver Status",
    "Last Method Comp",
    "Method Comp Status",
    "Last Precision",
    "Precision Status",
    "Last SOP Review",
    "SOP Review Status",
    "Notes",
  ];

  function statusLabel(s: DateStatus): string {
    return { ok: "Compliant", "due-soon": "Due Soon", overdue: "Overdue", missing: "Missing" }[s];
  }

  const rows = tests.map((t) => {
    const calVerStatus = t.complexity !== "WAIVED" ? statusLabel(getDateStatus(t.last_cal_ver, 6)) : "N/A (Waived)";
    const mcStatus = t.complexity !== "WAIVED" ? statusLabel(getDateStatus(t.last_method_comp, 6)) : "N/A (Waived)";
    const precStatus = t.complexity !== "WAIVED" ? statusLabel(getDateStatus(t.last_precision, 6)) : "N/A (Waived)";
    const sopStatus = statusLabel(getDateStatus(t.last_sop_review, 24));
    return [
      t.analyte,
      t.specialty,
      t.complexity,
      getCFR(t.specialty),
      t.last_cal_ver || "",
      calVerStatus,
      t.last_method_comp || "",
      mcStatus,
      t.last_precision || "",
      precStatus,
      t.last_sop_review || "",
      sopStatus,
      t.notes || "",
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
  });

  const csv = [headers.map((h) => `"${h}"`).join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `VeritaMap_${mapName.replace(/[^a-z0-9]/gi, "_")}_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Compliance score ──────────────────────────────────────────────────────────

function calcCompliance(tests: TestRecord[]): {
  score: number;
  calVerOverdue: number;
  methodCompMissing: number;
  sopOverdue: number;
} {
  const nonWaived = tests.filter((t) => t.complexity !== "WAIVED");
  if (nonWaived.length === 0) return { score: 100, calVerOverdue: 0, methodCompMissing: 0, sopOverdue: 0 };

  let calVerOk = 0;
  let mcOk = 0;
  let calVerOverdue = 0;
  let methodCompMissing = 0;
  let sopOverdue = 0;

  for (const t of nonWaived) {
    const cvStatus = getDateStatus(t.last_cal_ver, 6);
    const mcStatus = getDateStatus(t.last_method_comp, 6);
    const sopStatus = getDateStatus(t.last_sop_review, 24);
    if (cvStatus === "ok") calVerOk++;
    if (cvStatus === "overdue" || cvStatus === "missing") calVerOverdue++;
    if (mcStatus === "ok") mcOk++;
    if (mcStatus === "missing") methodCompMissing++;
    if (sopStatus === "overdue" || sopStatus === "missing") sopOverdue++;
  }

  const bothOk = nonWaived.filter(
    (t) =>
      getDateStatus(t.last_cal_ver, 6) === "ok" &&
      getDateStatus(t.last_method_comp, 6) === "ok"
  ).length;

  const score =
    nonWaived.length > 0 ? Math.round((bothOk / nonWaived.length) * 100) : 100;

  return { score, calVerOverdue, methodCompMissing, sopOverdue };
}

// ── Test row ──────────────────────────────────────────────────────────────────

interface TestRowProps {
  test: TestRecord;
  onChange: (analyte: string, field: string, value: string) => void;
}

function TestRow({ test, onChange }: TestRowProps) {
  const isWaived = test.complexity === "WAIVED";
  const specialtyStyle = getSpecialtyStyle(test.specialty);

  const calVerStatus = isWaived ? ("ok" as DateStatus) : getDateStatus(test.last_cal_ver, 6);
  const mcStatus = isWaived ? ("ok" as DateStatus) : getDateStatus(test.last_method_comp, 6);

  const hasGap =
    !isWaived &&
    (calVerStatus === "overdue" ||
      calVerStatus === "missing" ||
      mcStatus === "overdue" ||
      mcStatus === "missing");

  return (
    <tr
      className={`border-b border-border text-xs group transition-colors hover:bg-muted/30 ${
        hasGap ? "border-l-2 border-l-red-400" : "border-l-2 border-l-transparent"
      }`}
    >
      {/* Analyte */}
      <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap max-w-[220px] truncate">
        {test.analyte}
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

      {/* Cal Ver */}
      <td className="px-3 py-2 whitespace-nowrap">
        <DateCell
          value={test.last_cal_ver}
          onChange={(v) => onChange(test.analyte, "last_cal_ver", v)}
          maxMonths={6}
          warningDays={30}
          disabled={isWaived}
        />
      </td>

      {/* Method Comp */}
      <td className="px-3 py-2 whitespace-nowrap">
        <DateCell
          value={test.last_method_comp}
          onChange={(v) => onChange(test.analyte, "last_method_comp", v)}
          maxMonths={6}
          warningDays={30}
          disabled={isWaived}
        />
      </td>

      {/* Precision */}
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
      <td className="px-3 py-2 min-w-[140px]">
        <Input
          type="text"
          value={test.notes || ""}
          onChange={(e) => onChange(test.analyte, "notes", e.target.value)}
          placeholder="Notes…"
          className="h-7 text-xs px-1.5"
        />
      </td>

      {/* Run Study */}
      <td className="px-3 py-2 whitespace-nowrap">
        <Button
          asChild
          size="sm"
          variant="ghost"
          className="h-7 text-[10px] px-2 text-primary hover:bg-primary/10 hover:text-primary"
        >
          <Link href="/veritacheck">
            <FlaskConical size={11} className="mr-1" />
            Run Study
          </Link>
        </Button>
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VeritaMapMapPage() {
  const [, params] = useRoute("/veritamap-app/:id");
  const mapId = params?.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [localTests, setLocalTests] = useState<TestRecord[]>([]);
  const [filterSpecialty, setFilterSpecialty] = useState<string>("all");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Debounce timer refs keyed by analyte+field
  const debounceTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Fetch map detail
  const { data: mapDetail, isLoading } = useQuery<MapDetail>({
    queryKey: [`/api/veritamap/maps/${mapId}`],
    enabled: !!mapId,
  });

  // Sync local tests from server data on first load
  useEffect(() => {
    if (mapDetail?.tests) {
      setLocalTests(mapDetail.tests);
    }
  }, [mapDetail?.tests]);

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

  // Field change handler with 1.5s debounce
  const handleFieldChange = useCallback(
    (analyte: string, field: string, value: string) => {
      // Update local state immediately
      setLocalTests((prev) =>
        prev.map((t) =>
          t.analyte === analyte ? { ...t, [field]: value || null } : t
        )
      );

      // Debounce API call
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

  // Derived data
  const specialties = useMemo(() => {
    const s = new Set<string>();
    localTests.forEach((t) => s.add(t.specialty));
    return Array.from(s).sort();
  }, [localTests]);

  const filteredTests = useMemo(() => {
    if (filterSpecialty === "all") return localTests;
    return localTests.filter((t) => t.specialty === filterSpecialty);
  }, [localTests, filterSpecialty]);

  const compliance = useMemo(() => calcCompliance(localTests), [localTests]);

  function formatDate(iso: string | null | undefined): string {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "—";
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

  // If map has no tests, redirect to build
  if (localTests.length === 0 && !isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh] flex-col gap-4">
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
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-64px)]">
      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <aside
        className={`lg:sticky lg:top-16 lg:h-[calc(100vh-64px)] lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-border bg-card shrink-0 flex flex-col transition-all ${
          sidebarCollapsed ? "lg:w-12" : "lg:w-56"
        }`}
      >
        {/* Mobile top bar */}
        <div className="flex items-center justify-between px-4 py-3 lg:hidden">
          <span className="font-semibold text-sm truncate">{mapDetail.name}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSidebarCollapsed((v) => !v)}
          >
            <Filter size={13} />
          </Button>
        </div>

        {/* Mobile collapsible content */}
        <div
          className={`${sidebarCollapsed ? "hidden lg:hidden" : "flex flex-col gap-4 px-4 pb-4 lg:px-3 lg:py-4"}`}
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
              Compliance
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

          {/* Actions */}
          <div className="flex flex-col gap-1.5 mt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs justify-start"
              onClick={() => navigate(`/veritamap-app/${mapId}/build`)}
            >
              <Edit size={11} className="mr-1.5" />
              Edit Test Menu
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs justify-start"
              onClick={() => exportCSV(mapDetail.name, localTests)}
            >
              <Download size={11} className="mr-1.5" />
              Download CSV
            </Button>
          </div>

          {/* VeritaCheck CTA */}
          <Button
            asChild
            size="sm"
            className="mt-1 bg-primary hover:bg-primary/90 text-primary-foreground h-8 text-xs"
          >
            <Link href="/veritacheck">
              <FlaskConical size={11} className="mr-1.5" />
              Run Study in VeritaCheck
            </Link>
          </Button>
        </div>
      </aside>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="px-4 sm:px-6 py-5">
          {/* Mobile header */}
          <div className="flex items-center justify-between mb-4 lg:hidden">
            <h1 className="font-bold text-lg">{mapDetail.name}</h1>
          </div>

          {/* Table header info */}
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
          <div className="flex items-center gap-4 mb-3 text-[10px] text-muted-foreground">
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
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/60 border-b border-border">
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Analyte
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
                    Cal Ver
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">
                    Method Comp
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
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredTests.map((test) => (
                  <TestRow
                    key={test.analyte}
                    test={test}
                    onChange={handleFieldChange}
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

          {/* Footer note */}
          <p className="text-[10px] text-muted-foreground mt-3">
            Changes auto-save after 1.5 seconds. Cal Ver and Method Comp are
            required for non-waived tests. SOP review cadence is 2 years per
            CLIA guidance.
          </p>
        </div>
      </div>
    </div>
  );
}
