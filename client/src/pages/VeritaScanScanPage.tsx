import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { downloadPdfToken } from "@/lib/utils";
import { saveAs } from "file-saver";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { useToast } from "@/hooks/use-toast";
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
  Link2,
  X,
  ExternalLink,
  Plus,
  Search,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLabRoute } from "@/hooks/useLabRoute";
import { useActiveLabId } from "@/hooks/useActiveLabId";

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

// Global running-tally ordinal map. Iterates DOMAINS in display order,
// then items within each domain in array order, assigning a sequential
// 1-based number. Per operator preference (2026-05-10): users want a
// single running tally across the whole report (e.g. 1..173) rather than
// per-domain ordinals (1..N reset per domain). Computed once at module
// load since SCAN_ITEMS and DOMAINS are static.
const GLOBAL_ORDINALS: Record<number, number> = (() => {
  const map: Record<number, number> = {};
  let n = 0;
  for (const domain of DOMAINS) {
    for (const item of SCAN_ITEMS.filter((i) => i.domain === domain)) {
      n++;
      map[item.id] = n;
    }
  }
  return map;
})();

// Build the initial flat map of all SCAN_ITEMS (count is dynamic).
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
  const denom = SCAN_ITEMS.length - na;
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
// Phase 3.5 (2026-05-01): badges are now gated by the lab's accreditation_choice
// surfaced from /api/account/settings. CFR is always shown (every CLIA lab is
// bound by it). TJC, CAP, AABB, COLA each render only when the lab's choice
// includes that accreditor. "CAP+AABB" -> CAP and AABB both render. "CLIA"
// (no accreditor) -> only CFR renders.
function choiceIncludes(choice: string, body: "TJC" | "CAP" | "AABB" | "COLA"): boolean {
  if (!choice) return false;
  const parts = choice.split("+").map((p) => p.trim().toUpperCase());
  return parts.includes(body);
}

function CitationRow({
  item,
  expanded,
  accreditationChoice,
}: {
  item: ScanItem;
  expanded: boolean;
  accreditationChoice: string;
}) {
  if (!expanded) return null;
  const showTjc = choiceIncludes(accreditationChoice, "TJC") && item.tjc && item.tjc !== "N/A";
  const showCap = choiceIncludes(accreditationChoice, "CAP") && item.cap && item.cap !== "N/A";
  const showAabb = choiceIncludes(accreditationChoice, "AABB") && item.aabb && item.aabb !== "N/A";
  const showCola = choiceIncludes(accreditationChoice, "COLA") && item.cola && item.cola !== "N/A";
  const showCfr = item.cfr && item.cfr !== "N/A";
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {showTjc && (
        <span className="text-[10px] font-mono bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 rounded px-1.5 py-0.5">
          TJC {item.tjc}
        </span>
      )}
      {showCap && (
        <span className="text-[10px] font-mono bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 rounded px-1.5 py-0.5">
          CAP {item.cap}
        </span>
      )}
      {showAabb && (
        <span className="text-[10px] font-mono bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded px-1.5 py-0.5">
          {item.aabb}
        </span>
      )}
      {showCola && (
        <span className="text-[10px] font-mono bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded px-1.5 py-0.5">
          {item.cola}
        </span>
      )}
      {showCfr && (
        <span className="text-[10px] font-mono bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">
          {item.cfr}
        </span>
      )}
    </div>
  );
}

// ─── Evidence-of-compliance linking ─────────────────────────────────────────
// The per-item evidence model already lives server-side: lab_documents (URL
// pointers) + document_checklist_links, with a coverage rollup endpoint. This
// surfaces it on the scan walk so a user sitting on an item can see and attach
// the documents that prove it, instead of only linking from the Library side.
// No new store. Coverage is fetched ONCE for the whole lab (one query, not one
// per row) and sliced by checklist_item_id. Creating a brand-new document
// stays in the Library, where the governed owner / effective-date / review
// fields are collected; here we link documents that already exist.
interface CoverageRow {
  document_id: number;
  title: string;
  display_label: string | null;
  document_type: string;
  external_url: string;
  storage_provider: string | null;
  status: string;
  review_due_date: string | null;
  link_id: number;
  checklist_item_id: number;
  link_notes: string | null;
  linked_at: string;
}

interface EvidenceCtx {
  byItem: Record<number, CoverageRow[]>;
  labId: number | null;
  readOnly: boolean;
  invalidate: () => void;
}

const SCAN_DOC_TYPE_LABELS: Record<string, string> = {
  policy: "Policy",
  procedure: "Procedure",
  training_record: "Training record",
  competency: "Competency",
  validation_study: "Validation study",
  equipment_log: "Equipment log",
  regulatory_record: "Regulatory record",
  other: "Other",
};
function scanDocTypeLabel(v: string): string {
  return SCAN_DOC_TYPE_LABELS[v] || v;
}

// Picker: attach a document already catalogued in the lab's evidence library.
function EvidencePicker({
  itemId,
  labId,
  alreadyLinkedDocIds,
  onClose,
  onLinked,
}: {
  itemId: number;
  labId: number;
  alreadyLinkedDocIds: Set<number>;
  onClose: () => void;
  onLinked: () => void;
}) {
  const { toast } = useToast();
  const labRoute = useLabRoute();
  const [search, setSearch] = useState("");

  const docsQuery = useQuery<any[]>({
    queryKey: [`/api/labs/${labId}/veritascan/documents`, "evidence-picker"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/documents`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
      return res.json();
    },
  });

  const linkMutation = useMutation({
    mutationFn: async (docId: number) => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/documents/${docId}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ checklist_item_id: itemId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Link failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Evidence linked" });
      onLinked();
      onClose();
    },
    onError: (err: Error) => toast({ title: "Could not link evidence", description: err.message, variant: "destructive" }),
  });

  const docs = (docsQuery.data || []).filter((d: any) => d.status !== "archived" && !alreadyLinkedDocIds.has(d.id));
  const lower = search.toLowerCase();
  const filtered = lower
    ? docs.filter((d: any) =>
        (d.title || "").toLowerCase().includes(lower) ||
        (d.display_label || "").toLowerCase().includes(lower) ||
        scanDocTypeLabel(d.document_type).toLowerCase().includes(lower))
    : docs;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Link evidence to this item</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Attach a document from your VeritaScan&#8482; evidence library. Links point to your file in
            SharePoint, Drive, or OneDrive; VeritaAssure&#8482; stores the pointer, never the file.
          </p>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search the evidence library"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8"
              data-testid="input-evidence-search"
            />
          </div>
          <div className="max-h-[46vh] overflow-y-auto space-y-1">
            {filtered.map((d: any) => (
              <button
                key={d.id}
                type="button"
                onClick={() => linkMutation.mutate(d.id)}
                disabled={linkMutation.isPending}
                className="w-full text-left p-2 rounded border hover:bg-muted/50 transition-colors disabled:opacity-50"
                data-testid={`evidence-pick-${d.id}`}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium">
                  <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="truncate">{d.display_label || d.title}</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {scanDocTypeLabel(d.document_type)}
                  {d.storage_provider ? ` · ${d.storage_provider}` : ""}
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="text-xs text-muted-foreground italic py-6 text-center">
                {docsQuery.isLoading ? "Loading library…" : "No matching documents in the library."}
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="sm:justify-between gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href={labRoute("/veritascan/documents")}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add a new document in the Library
            </Link>
          </Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Per-item evidence chips + an add/remove affordance. Renders nothing on rows
// with no evidence when the user cannot edit (read-only or legacy no-lab route),
// so the walk stays uncluttered.
function ItemEvidence({ itemId, ctx }: { itemId: number; ctx: EvidenceCtx }) {
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const rows = ctx.byItem[itemId] || [];
  const canEdit = !ctx.readOnly && !!ctx.labId;

  const unlinkMutation = useMutation({
    mutationFn: async (row: CoverageRow) => {
      const res = await fetch(
        `${API_BASE}/api/labs/${ctx.labId}/veritascan/documents/${row.document_id}/links/${row.link_id}`,
        { method: "DELETE", headers: authHeaders() },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Remove failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => ctx.invalidate(),
    onError: (err: Error) => toast({ title: "Could not remove evidence", description: err.message, variant: "destructive" }),
  });

  if (rows.length === 0 && !canEdit) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground mr-0.5">
        <Link2 className="h-3 w-3" />
        Evidence
      </span>
      {rows.map((row) => (
        <span
          key={row.link_id}
          className="inline-flex items-center gap-1.5 max-w-full rounded-md border border-primary/20 bg-primary/10 text-primary px-2 py-0.5 text-[11px]"
          title={`${scanDocTypeLabel(row.document_type)}: ${row.title}`}
        >
          <FileText className="h-3 w-3 shrink-0" />
          <a
            href={row.external_url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate max-w-[180px] hover:underline"
            data-testid={`evidence-open-${row.link_id}`}
          >
            {row.display_label || row.title}
          </a>
          <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
          {canEdit && (
            <button
              type="button"
              onClick={() => unlinkMutation.mutate(row)}
              disabled={unlinkMutation.isPending}
              className="ml-0.5 opacity-70 hover:opacity-100"
              title="Remove this evidence link"
              data-testid={`evidence-unlink-${row.link_id}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
          data-testid={`evidence-add-${itemId}`}
        >
          <Plus className="h-3 w-3" />
          {rows.length === 0 ? "Link evidence" : "Add"}
        </button>
      )}
      {pickerOpen && ctx.labId && (
        <EvidencePicker
          itemId={itemId}
          labId={ctx.labId}
          alreadyLinkedDocIds={new Set(rows.map((r) => r.document_id))}
          onClose={() => setPickerOpen(false)}
          onLinked={ctx.invalidate}
        />
      )}
    </div>
  );
}

// ─── Single checklist item row ────────────────────────────────────────────────
function ItemRow({
  item,
  state,
  onChange,
  accreditationChoice,
  displayNumber,
  evidence,
}: {
  item: ScanItem;
  state: ItemState;
  onChange: (patch: Partial<ItemState>) => void;
  accreditationChoice: string;
  // Domain-relative ordinal (1, 2, 3...) for the visible row label.
  // Underlying item.id is still the persistence key; this is rendering only.
  displayNumber: number;
  evidence: EvidenceCtx;
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
        {/* Item number (domain-relative ordinal; persistence still uses item.id) */}
        <span className="text-[11px] font-mono text-muted-foreground/60 mt-0.5 shrink-0 w-7 text-right">
          {displayNumber}
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
          <CitationRow item={item} expanded={citExpanded} accreditationChoice={accreditationChoice} />

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

          {/* Evidence-of-compliance links (VeritaScan document library) */}
          <ItemEvidence itemId={item.id} ctx={evidence} />
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
  accreditationChoice,
  evidence,
}: {
  domain: ScanDomain;
  items: Record<number, ItemState>;
  onChange: (id: number, patch: Partial<ItemState>) => void;
  sectionRef?: (el: HTMLDivElement | null) => void;
  accreditationChoice: string;
  evidence: EvidenceCtx;
}) {
  // Total items in this domain (used for stats); active items exclude N/A
  // because N/A items render in the parked section at the bottom of the
  // report so they do not consume the lab's attention during the scan walk.
  const allDomainItems = SCAN_ITEMS.filter((i) => i.domain === domain);
  const activeDomainItems = allDomainItems.filter(
    (i) => (items[i.id]?.status ?? "Not Assessed") !== "N/A",
  );
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
          {activeDomainItems.length} items
          {stats.na > 0 && (
            <span className="text-muted-foreground/60"> ({stats.na} N/A parked)</span>
          )}
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

      {/* Item rows (N/A items omitted; they render in the Parked section) */}
      <div className="space-y-0.5">
        {activeDomainItems.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            displayNumber={GLOBAL_ORDINALS[item.id]}
            state={items[item.id] ?? {
              itemId: item.id,
              status: "Not Assessed",
              notes: "",
              owner: "",
              dueDate: "",
            }}
            onChange={(patch) => onChange(item.id, patch)}
            accreditationChoice={accreditationChoice}
            evidence={evidence}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Parked (N/A) items section ──────────────────────────────────────────────
// Renders below all the active domain sections. Collects every item the lab
// has marked N/A across every domain, grouped under sub-headers so the
// surveyor narrative ("we excluded these because we don't run them") still
// reads cleanly. Per operator request: keeping N/A items inline in their
// domain pulls attention to work that does not apply to the lab; routing
// them to the bottom keeps the active domains uncluttered.
function ParkedItemsSection({
  items,
  onChange,
  accreditationChoice,
  evidence,
}: {
  items: Record<number, ItemState>;
  onChange: (id: number, patch: Partial<ItemState>) => void;
  accreditationChoice: string;
  evidence: EvidenceCtx;
}) {
  const naByDomain: Partial<Record<ScanDomain, ScanItem[]>> = {};
  for (const domain of DOMAINS) {
    naByDomain[domain] = SCAN_ITEMS.filter(
      (i) => i.domain === domain && items[i.id]?.status === "N/A",
    );
  }
  const totalNa = Object.values(naByDomain).reduce(
    (sum, arr) => sum + (arr?.length ?? 0),
    0,
  );
  if (totalNa === 0) return null;

  return (
    <div className="mt-12 pt-8 border-t border-muted-foreground/20">
      {/* Parked-section header */}
      <div className="flex items-center gap-3 mb-4">
        <Badge
          variant="outline"
          className="text-xs font-semibold px-2.5 py-1 bg-muted/50 text-muted-foreground border-muted-foreground/30"
        >
          N/A Items (parked)
        </Badge>
        <span className="text-xs text-muted-foreground">
          {totalNa} item{totalNa !== 1 ? "s" : ""} not applicable to this lab
        </span>
      </div>

      {/* Per-domain sub-groups (only domains that have N/A items) */}
      {DOMAINS.map((domain) => {
        const naItems = naByDomain[domain] ?? [];
        if (naItems.length === 0) return null;
        return (
          <div key={domain} className="mb-6 opacity-70">
            <div className="flex items-center gap-2 mb-2">
              <Badge
                variant="outline"
                className={`text-[10px] px-2 py-0.5 ${DOMAIN_COLORS[domain]}`}
              >
                {domain}
              </Badge>
              <span className="text-[11px] text-muted-foreground">
                {naItems.length} N/A
              </span>
            </div>
            <div className="space-y-0.5">
              {naItems.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  displayNumber={GLOBAL_ORDINALS[item.id]}
                  state={items[item.id] ?? {
                    itemId: item.id,
                    status: "N/A",
                    notes: "",
                    owner: "",
                    dueDate: "",
                  }}
                  onChange={(patch) => onChange(item.id, patch)}
                  accreditationChoice={accreditationChoice}
                  evidence={evidence}
                />
              ))}
            </div>
          </div>
        );
      })}
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
  const labRoute = useLabRoute();
  const activeLabId = useActiveLabId();
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
  const { toast } = useToast();

  // Lab-scoped URLs for scan-by-id and items. When activeLabId is set, the
  // server enforces "this scan belongs to this lab" via WHERE lab_id = ? so
  // the page 404s instead of silently rendering a scan from another lab.
  const scanMetaUrl = activeLabId
    ? `/api/labs/${activeLabId}/veritascan/scans/${scanId}`
    : `/api/veritascan/scans/${scanId}`;
  const scanItemsUrl = activeLabId
    ? `/api/labs/${activeLabId}/veritascan/scans/${scanId}/items`
    : `/api/veritascan/scans/${scanId}/items`;

  // ── Fetch scan meta ─────────────────────────────────────────────────────
  const { data: scanMeta, isLoading: metaLoading } = useQuery<ScanMeta>({
    queryKey: [scanMetaUrl],
    enabled: !isNaN(scanId),
  });

  // ── Phase 3.5: fetch lab accreditation_choice for per-row badge gating ──
  const { data: accountSettings } = useQuery<{ accreditation_choice?: string }>({
    queryKey: ["/api/account/settings"],
  });
  const accreditationChoice = accountSettings?.accreditation_choice || "CLIA";

  // ── Evidence-of-compliance coverage (VeritaScan document library) ─────────
  // One coverage fetch for the whole lab, sliced per checklist item below, so
  // the walk never fires a request per row. Lab-scoped only; on the legacy
  // non-lab route we skip it and the per-item affordance stays hidden.
  const coverageKey = activeLabId
    ? [`/api/labs/${activeLabId}/veritascan/coverage`]
    : ["veritascan-coverage-disabled"];
  const coverageQuery = useQuery<CoverageRow[]>({
    queryKey: coverageKey,
    enabled: !!activeLabId,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/labs/${activeLabId}/veritascan/coverage`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load evidence coverage (${res.status})`);
      return res.json();
    },
  });
  const evidenceByItem = useMemo(() => {
    const map: Record<number, CoverageRow[]> = {};
    for (const row of coverageQuery.data || []) {
      if (!map[row.checklist_item_id]) map[row.checklist_item_id] = [];
      map[row.checklist_item_id].push(row);
    }
    return map;
  }, [coverageQuery.data]);
  const evidenceCtx: EvidenceCtx = {
    byItem: evidenceByItem,
    labId: activeLabId ?? null,
    readOnly,
    invalidate: () => qc.invalidateQueries({ queryKey: coverageKey }),
  };

  // ── Fetch scan items ────────────────────────────────────────────────────
  const { isLoading: itemsLoading } = useQuery<ItemState[]>({
    queryKey: [scanItemsUrl],
    enabled: !isNaN(scanId),
    staleTime: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (data: any) => data,
    // @ts-ignore — using onSuccess via select + useEffect below
  });

  // Watch the raw query data and merge into local state
  const rawItemData = qc.getQueryData<ItemState[]>([scanItemsUrl]);
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
        `${API_BASE}${scanItemsUrl}`,
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
    onError: () => {
      setSaveStatus("idle");
      toast({ title: "Changes not saved", description: "The save was rejected; your last edits are not stored. Try again.", variant: "destructive" });
    },
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
        aabb: item.aabb,
        cola: item.cola,
      }));
      const pdfUrl = activeLabId
        ? `${API_BASE}/api/labs/${activeLabId}/veritascan/pdf/${scanId}/${type}`
        : `${API_BASE}/api/veritascan/pdf/${scanId}/${type}`;
      const res = await fetch(
        pdfUrl,
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
      const date = new Date().toISOString().split("T")[0];
      const safeName = (scanMeta?.name ?? "Scan").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      const filename = type === "executive"
        ? `VeritaScan_Executive_${safeName}_${date}.pdf`
        : `VeritaScan_Full_${safeName}_${date}.pdf`;
      downloadPdfToken(pdfToken, filename);
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
        aabb: item.aabb,
        cola: item.cola,
      }));
      const excelUrl = activeLabId
        ? `${API_BASE}/api/labs/${activeLabId}/veritascan/excel/${scanId}`
        : `${API_BASE}/api/veritascan/excel/${scanId}`;
      const res = await fetch(
        excelUrl,
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
      const date = new Date().toISOString().split("T")[0];
      const safeName = (scanMeta?.name ?? "Scan").replace(/[^a-zA-Z0-9_\- ]/g, "").trim();
      saveAs(blob, `VeritaScan_${safeName}_${date}.xlsx`);
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
            href={labRoute("/veritascan-app")}
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
              {totalAssessed}/{SCAN_ITEMS.length} assessed
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
              href={labRoute("/veritascan-app")}
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
              <span>{totalAssessed}/{SCAN_ITEMS.length} assessed</span>
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
            accreditationChoice={accreditationChoice}
            evidence={evidenceCtx}
          />
        ))}

        {/* Parked (N/A) items section -- always renders last, below every
            active domain. Lets the lab N/A items they don't apply and have
            them disappear from active work without losing the audit trail. */}
        <ParkedItemsSection
          items={items}
          onChange={handleItemChange}
          accreditationChoice={accreditationChoice}
          evidence={evidenceCtx}
        />
      </div>
    </div>
  );
}
