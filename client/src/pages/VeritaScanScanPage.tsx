import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SCAN_ITEMS,
  DOMAINS,
  DOMAIN_COLORS,
  STATUS_COLORS,
  type ScanItem,
  type ScanDomain,
  type ScanStatus,
} from "@/lib/veritaScanData";
import {
  ArrowLeft,
  Download,
  FileText,
  FileSpreadsheet,
  Save,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScanMeta {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface ItemState {
  itemId: number;
  status: ScanStatus;
  notes: string;
  owner: string;
  dueDate: string;
  completionSource?: string;
  completionLink?: string;
  completionNote?: string;
}

// Build the initial flat map of all 168 items
function buildInitialItems(): Record<number, ItemState> {
  const map: Record<number, ItemState> = {};
  for (const item of SCAN_ITEMS) {
    map[item.id] = {
      itemId: item.id,
      status: "Not Assessed",
      notes: "",
      owner: "",
      dueDate: "",
    };
  }
  return map;
}

// ─── Score helpers ────────────────────────────────────────────────────────────

function domainStats(
  domain: ScanDomain,
  items: Record<number, ItemState>
): { compliant: number; total: number; na: number; gap: number; notAssessed: number } {
  const domainItems = SCAN_ITEMS.filter((i) => i.domain === domain);
  let compliant = 0, na = 0, gap = 0, notAssessed = 0;
  for (const di of domainItems) {
    const s = items[di.id]?.status ?? "Not Assessed";
    if (s === "Compliant") compliant++;
    else if (s === "N/A") na++;
    else if (s === "Needs Attention" || s === "Immediate Action") gap++;
    else notAssessed++;
  }
  return { compliant, total: domainItems.length, na, gap, notAssessed };
}

function overallScore(items: Record<number, ItemState>): number | null {
  let compliant = 0, na = 0, assessed = 0;
  for (const id in items) {
    const s = items[id].status;
    if (s === "N/A") na++;
    else if (s !== "Not Assessed") {
      assessed++;
      if (s === "Compliant") compliant++;
    }
  }
  const denom = 168 - na;
  if (assessed === 0 || denom === 0) return null;
  return (compliant / denom) * 100;
}

function scoreColor(pct: number | null) {
  if (pct === null) return "text-muted-foreground";
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function scoreBg(pct: number | null) {
  if (pct === null) return "bg-muted";
  if (pct >= 80) return "bg-emerald-500";
  if (pct >= 60) return "bg-amber-500";
  return "bg-red-500";
}

// ─── Row left-border based on status ─────────────────────────────────────────
function rowBorderClass(status: ScanStatus): string {
  switch (status) {
    case "Immediate Action":
      return "border-l-2 border-l-red-400 bg-red-50/30 dark:bg-red-950/10";
    case "Needs Attention":
      return "border-l-2 border-l-amber-400 bg-amber-50/30 dark:bg-amber-950/10";
    case "Compliant":
      return "border-l-2 border-l-emerald-300 opacity-80";
    case "N/A":
      return "border-l-2 border-l-muted-foreground/20 opacity-60";
    default:
      return "border-l-2 border-l-transparent";
  }
}

// ─── Citation badge ───────────────────────────────────────────────────────────
function CitationRow({ item, expanded }: { item: ScanItem; expanded: boolean }) {
  if (!expanded) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {item.tjc !== "N/A" && (
        <span className="text-[10px] font-mono bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5">
          TJC {item.tjc}
        </span>
      )}
      {item.cap && (
        <span className="text-[10px] font-mono bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 rounded px-1.5 py-0.5">
          CAP {item.cap}
        </span>
      )}
      {item.cfr !== "N/A" && (
        <span className="text-[10px] font-mono bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">
          {item.cfr}
        </span>
      )}
    </div>
  );
}

// ─── Single checklist item row ────────────────────────────────────────────────
function ItemRow({
  item,
  state,
  onChange,
}: {
  item: ScanItem;
  state: ItemState;
  onChange: (patch: Partial<ItemState>) => void;
}) {
  const [citExpanded, setCitExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);

  const showDueDate =
    state.status === "Needs Attention" || state.status === "Immediate Action";

  return (
    <div
      className={`px-3 py-2.5 rounded-lg mb-1 transition-colors ${rowBorderClass(state.status)}`}
    >
      <div className="flex items-start gap-2.5">
        {/* Item number */}
        <span className="text-[11px] font-mono text-muted-foreground/60 mt-0.5 shrink-0 w-7 text-right">
          {item.id}
        </span>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Question + citation toggle */}
          <div className="flex items-start gap-1.5">
            <p className="text-sm leading-snug flex-1">{item.question}</p>
            <button
              type="button"
              onClick={() => setCitExpanded((p) => !p)}
              className="text-muted-foreground/50 hover:text-muted-foreground mt-0.5 shrink-0 transition-colors"
              title={citExpanded ? "Hide citations" : "Show citations"}
            >
              {citExpanded ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {/* Citation badges */}
          <CitationRow item={item} expanded={citExpanded} />

          {/* VC auto-completion badge */}
          {state.completionSource === "veritacheck_auto" && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center px-1.5 py-0.5 mt-1 rounded text-[9px] font-bold bg-primary/10 text-primary border border-primary/20 cursor-help">
                    VC
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p className="text-xs font-medium">Auto-completed by VeritaCheck&#8482;</p>
                  {state.completionNote && <p className="text-xs text-muted-foreground mt-0.5">{state.completionNote}</p>}
                  {state.completionLink && (
                    <Link href={state.completionLink} className="text-xs text-primary mt-1 block hover:underline">
                      Click to view study &rarr;
                    </Link>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Controls row */}
          <div className="flex flex-wrap items-start gap-2 mt-2">
            {/* Status */}
            <Select
              value={state.status}
              onValueChange={(v) => onChange({ status: v as ScanStatus })}
            >
              <SelectTrigger
                className={`h-7 text-xs w-40 border ${STATUS_COLORS[state.status]}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "Not Assessed",
                    "Compliant",
                    "Needs Attention",
                    "Immediate Action",
                    "N/A",
                  ] as ScanStatus[]
                ).map((s) => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Owner */}
            <Input
              className="h-7 text-xs w-32 min-w-0"
              placeholder="Owner"
              value={state.owner}
              onChange={(e) => onChange({ owner: e.target.value })}
            />

            {/* Due date — only for gap statuses */}
            {showDueDate && (
              <Input
                type="date"
                className="h-7 text-xs w-36 min-w-0"
                value={state.dueDate}
                onChange={(e) => onChange({ dueDate: e.target.value })}
              />
            )}

            {/* Notes toggle */}
            <button
              type="button"
              onClick={() => setNotesExpanded((p) => !p)}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md bg-background hover:bg-muted transition-colors"
            >
              {notesExpanded ? "Hide notes" : state.notes ? "Notes ●" : "Notes"}
            </button>
          </div>

          {/* Notes textarea */}
          {notesExpanded && (
            <Textarea
              className="mt-2 text-xs min-h-[52px] resize-none"
              placeholder="Add notes, evidence references, or findings…"
              value={state.notes}
              onChange={(e) => onChange({ notes: e.target.value })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Domain section ───────────────────────────────────────────────────────────
function DomainSection({
  domain,
  items,
  onChange,
  sectionRef,
}: {
  domain: ScanDomain;
  items: Record<number, ItemState>;
  onChange: (id: number, patch: Partial<ItemState>) => void;
  sectionRef?: (el: HTMLDivElement | null) => void;
}) {
  const domainItems = SCAN_ITEMS.filter((i) => i.domain === domain);
  const stats = domainStats(domain, items);
  const denom = stats.total - stats.na;
  const pct = denom > 0 && stats.compliant + stats.gap > 0
    ? (stats.compliant / denom) * 100
    : null;

  const colorClass = DOMAIN_COLORS[domain];
  // Extract just the text color class for the badge
  const badgeClasses = colorClass;

  return (
    <div ref={sectionRef} className="mb-10">
      {/* Domain header */}
      <div className="flex items-center gap-3 mb-3">
        <Badge
          variant="outline"
          className={`text-xs font-semibold px-2.5 py-1 ${badgeClasses}`}
        >
          {domain}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {domainItems.length} items
        </span>
        {pct !== null && (
          <span className={`text-xs font-semibold ${scoreColor(pct)}`}>
            {Math.round(pct)}% compliant
          </span>
        )}
        {stats.gap > 0 && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            {stats.gap} gap{stats.gap !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Item rows */}
      <div className="space-y-0.5">
        {domainItems.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            state={items[item.id] ?? {
              itemId: item.id,
              status: "Not Assessed",
              notes: "",
              owner: "",
              dueDate: "",
            }}
            onChange={(patch) => onChange(item.id, patch)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Sidebar mini domain row ──────────────────────────────────────────────────
function SidebarDomainRow({
  domain,
  items,
  onClick,
}: {
  domain: ScanDomain;
  items: Record<number, ItemState>;
  onClick: () => void;
}) {
  const stats = domainStats(domain, items);
  const denom = stats.total - stats.na;
  const pct =
    denom > 0 && stats.compliant + stats.gap > 0
      ? (stats.compliant / denom) * 100
      : null;

  const colorClass = DOMAIN_COLORS[domain];

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left group px-2 py-1.5 rounded-lg hover:bg-muted/70 transition-colors"
    >
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <span className="text-xs font-medium leading-snug truncate group-hover:text-primary transition-colors">
          {domain}
        </span>
        {pct !== null && (
          <span className={`text-[10px] font-semibold tabular-nums shrink-0 ${scoreColor(pct)}`}>
            {Math.round(pct)}%
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <div className="flex-1 bg-muted rounded-full h-1 overflow-hidden">
          {pct !== null && (
            <div
              className={`h-full rounded-full transition-all ${scoreBg(pct)}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          )}
        </div>
        <span className="text-[9px] text-muted-foreground tabular-nums shrink-0">
          {stats.compliant}/{stats.total - stats.na > 0 ? stats.total - stats.na : stats.total}
        </span>
      </div>
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function VeritaScanScanPage() {
  const params = useParams<{ id: string }>();
  const scanId = Number(params.id);
  useAuth();
  const qc = useQueryClient();
  const readOnly = useIsReadOnly('veritascan');

  // Local item state
  const [items, setItems] = useState<Record<number, ItemState>>(buildInitialItems);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [pdfLoading, setPdfLoading] = useState<"executive" | "full" | null>(null);
  const [excelLoading, setExcelLoading] = useState(false);

  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // ── Fetch scan meta ─────────────────────────────────────────────────────
  const { data: scanMeta, isLoading: metaLoading } = useQuery<ScanMeta>({
    queryKey: [`/api/veritascan/scans/${scanId}`],
    enabled: !isNaN(scanId),
  });

  // ── Fetch scan items ────────────────────────────────────────────────────
  const { isLoading: itemsLoading } = useQuery<ItemState[]>({
    queryKey: [`/api/veritascan/scans/${scanId}/items`],
    enabled: !isNaN(scanId),
    staleTime: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (data: any) => data,
    // @ts-ignore — using onSuccess via select + useEffect below
  });

  // Watch the raw query data and merge into local state
  const rawItemData = qc.getQueryData<ItemState[]>([
    `/api/veritascan/scans/${scanId}/items`,
  ]);
  useEffect(() => {
    if (!rawItemData) return;
    setItems((prev) => {
      const next = { ...prev };
      for (const apiItem of rawItemData) {
        const id = (apiItem as any).item_id ?? apiItem.itemId;
        if (!id) continue;
        next[id] = {
          itemId: id,
          status: (apiItem.status as ScanStatus) || "Not Assessed",
          notes: apiItem.notes || (apiItem as any).notes || "",
          owner: apiItem.owner || (apiItem as any).owner || "",
          dueDate: apiItem.dueDate || (apiItem as any).due_date || "",
          completionSource: (apiItem as any).completion_source || (apiItem as any).completionSource || undefined,
          completionLink: (apiItem as any).completion_link || (apiItem as any).completionLink || undefined,
          completionNote: (apiItem as any).completion_note || (apiItem as any).completionNote || undefined,
        };
      }
      return next;
    });
  }, [rawItemData]);

  // ── Auto-save logic ─────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (itemsToSave: ItemState[]) => {
      const res = await fetch(
        `${API_BASE}/api/veritascan/scans/${scanId}/items`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ items: itemsToSave }),
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Save failed");
      }
      return res.json();
    },
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      setSaveStatus("saved");
      dirtyRef.current = false;
      setTimeout(() => setSaveStatus("idle"), 2500);
    },
    onError: () => setSaveStatus("idle"),
  });

  const scheduleAutoSave = useCallback(
    (currentItems: Record<number, ItemState>) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus("saving");
      saveTimerRef.current = setTimeout(() => {
        const itemsArray = Object.values(currentItems);
        saveMutation.mutate(itemsArray);
      }, 1500);
    },
    [saveMutation]
  );

  // ── Item change handler ─────────────────────────────────────────────────
  const handleItemChange = useCallback(
    (id: number, patch: Partial<ItemState>) => {
      setItems((prev) => {
        const next = {
          ...prev,
          [id]: { ...prev[id], ...patch },
        };
        dirtyRef.current = true;
        scheduleAutoSave(next);
        return next;
      });
    },
    [scheduleAutoSave]
  );

  // Manual save
  const handleManualSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveMutation.mutate(Object.values(items));
  };

  // ── PDF download ────────────────────────────────────────────────────────
  const downloadPdf = async (type: "executive" | "full") => {
    setPdfLoading(type);
    try {
      const referenceItems = SCAN_ITEMS.map((item) => ({
        id: item.id,
        domain: item.domain,
        question: item.question,
        tjc: item.tjc,
        cap: item.cap,
        cfr: item.cfr,
      }));
      const res = await fetch(
        `${API_BASE}/api/veritascan/pdf/${scanId}/${type}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ referenceItems }),
        }
      );
      if (!res.ok) throw new Error("PDF generation failed");
      const { token: pdfToken } = await res.json();
      const a = document.createElement("a");
      const date = new Date().toISOString().split("T")[0];
      const safeName = (scanMeta?.name ?? "Scan").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      a.href = `/api/pdf/${pdfToken}`;
      a.download =
        type === "executive"
          ? `VeritaScan_Executive_${safeName}_${date}.pdf`
          : `VeritaScan_Full_${safeName}_${date}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) {
      // fail silently — server may not be ready
      console.error("PDF error:", e);
    } finally {
      setPdfLoading(null);
    }
  };

  // ── Excel download ───────────────────────────────────────────────────────
  const downloadExcel = async () => {
    setExcelLoading(true);
    try {
      const referenceItems = SCAN_ITEMS.map((item) => ({
        id: item.id,
        domain: item.domain,
        question: item.question,
        tjc: item.tjc,
        cap: item.cap,
        cfr: item.cfr,
      }));
      const res = await fetch(
        `${API_BASE}/api/veritascan/excel/${scanId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...authHeaders(),
          },
          body: JSON.stringify({ referenceItems }),
        }
      );
      if (!res.ok) throw new Error("Excel generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().split("T")[0];
      const safeName = (scanMeta?.name ?? "Scan").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      a.download = `VeritaScan_${safeName}_${date}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Excel error:", e);
    } finally {
      setExcelLoading(false);
    }
  };

  // ── Scroll to domain ────────────────────────────────────────────────────
  const scrollToDomain = (domain: ScanDomain) => {
    const el = sectionRefs.current[domain];
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  // ── Overall score ───────────────────────────────────────────────────────
  const score = overallScore(items);

  // Total assessed
  const totalAssessed = Object.values(items).filter(
    (i) => i.status !== "Not Assessed"
  ).length;

  const dateStr = scanMeta
    ? new Date(scanMeta.updatedAt || scanMeta.createdAt).toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric", year: "numeric" }
      )
    : "";

  const isLoading = metaLoading || itemsLoading;

  // ── Loading state ───────────────────────────────────────────────────────
  if (isLoading && !scanMeta) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex gap-0 relative">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="hidden lg:flex flex-col gap-0 w-60 shrink-0 sticky top-0 h-screen overflow-y-auto border-r border-border bg-card/50 pt-4 pb-6">
        <div className="px-3 mb-4">
          {/* Back */}
          <Link
            href="/veritascan-app"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All Scans
          </Link>

          {/* Scan name */}
          <div className="font-semibold text-sm leading-snug mb-0.5 truncate" title={scanMeta?.name}>
            {scanMeta?.name ?? "Loading…"}
          </div>
          {dateStr && (
            <p className="text-[11px] text-muted-foreground">{dateStr}</p>
          )}

          {/* Overall score */}
          <div className="mt-3 rounded-xl bg-muted/50 p-3 text-center">
            <div
              className={`text-3xl font-bold tabular-nums ${scoreColor(score)}`}
            >
              {score !== null ? `${Math.round(score)}%` : "-"}
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Overall Readiness
            </div>
            <div className="text-[10px] text-muted-foreground">
              {totalAssessed}/168 assessed
            </div>
          </div>
        </div>

        {/* Domain list */}
        <div className="px-1.5 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 px-2 mb-1.5">
            Domains
          </p>
          {DOMAINS.map((domain) => (
            <SidebarDomainRow
              key={domain}
              domain={domain}
              items={items}
              onClick={() => scrollToDomain(domain)}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="px-3 mt-4 space-y-2">
          {/* Save status */}
          <div className="flex items-center justify-between">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5"
              onClick={handleManualSave}
              disabled={saveMutation.isPending}
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {saveStatus === "saving" && (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving…
                </span>
              )}
              {saveStatus === "saved" && (
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3 w-3" />
                  Saved
                </span>
              )}
            </span>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="w-full h-8 text-xs gap-1.5"
            onClick={() => downloadPdf("executive")}
            disabled={pdfLoading !== null}
          >
            {pdfLoading === "executive" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Executive Report
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="w-full h-8 text-xs gap-1.5"
            onClick={() => downloadPdf("full")}
            disabled={pdfLoading !== null}
          >
            {pdfLoading === "full" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            Full Report
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="w-full h-8 text-xs gap-1.5"
            onClick={downloadExcel}
            disabled={excelLoading}
          >
            {excelLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" />
            )}
            Excel Export
          </Button>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 px-4 sm:px-6 py-6">
        {/* Mobile header */}
        <div className="flex items-center justify-between gap-3 mb-6 lg:hidden">
          <div className="flex items-center gap-2">
            <Link
              href="/veritascan-app"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <div className="font-semibold text-sm truncate max-w-[180px]">
                {scanMeta?.name ?? "Loading…"}
              </div>
              {dateStr && (
                <p className="text-xs text-muted-foreground">{dateStr}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-lg font-bold ${scoreColor(score)}`}>
              {score !== null ? `${Math.round(score)}%` : "-"}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={handleManualSave}
              disabled={saveMutation.isPending}
            >
              {saveStatus === "saving" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saveStatus === "saved" ? (
                <Check className="h-3.5 w-3.5 text-emerald-600" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Mobile download buttons */}
        <div className="flex gap-2 mb-4 lg:hidden flex-wrap">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs h-8 gap-1.5"
            onClick={() => downloadPdf("executive")}
            disabled={pdfLoading !== null}
          >
            <Download className="h-3.5 w-3.5" />
            Executive PDF
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs h-8 gap-1.5"
            onClick={() => downloadPdf("full")}
            disabled={pdfLoading !== null}
          >
            <FileText className="h-3.5 w-3.5" />
            Full PDF
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 text-xs h-8 gap-1.5"
            onClick={downloadExcel}
            disabled={excelLoading}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Excel
          </Button>
        </div>

        {/* Desktop page title (visible in main content when sidebar present) */}
        <div className="hidden lg:block mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold truncate">
              {scanMeta?.name ?? "Loading…"}
            </h1>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <span>{totalAssessed}/168 assessed</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {saveStatus === "saving" && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving…
                </span>
              )}
              {saveStatus === "saved" && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Check className="h-3 w-3" />
                  Saved
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Status changes save automatically. Click a domain in the sidebar to
            navigate.
          </p>
        </div>

        {/* Domain sections */}
        {DOMAINS.map((domain) => (
          <DomainSection
            key={domain}
            domain={domain}
            items={items}
            onChange={handleItemChange}
            sectionRef={(el) => {
              sectionRefs.current[domain] = el;
            }}
          />
        ))}
      </div>
    </div>
  );
}
