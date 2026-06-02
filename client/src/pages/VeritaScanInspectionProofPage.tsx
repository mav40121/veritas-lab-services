// VeritaScan™ Evidence Library — Inspection Proof View (Phase C, 2026-06-02)
//
// Per-accreditor coverage rollup over the static SCAN_ITEMS list. Drives the
// "I am being surveyed by CAP next week, show me which checklist items are
// covered and which still need evidence" workflow.
//
// Data flow:
//   1. Server returns a flat list of all active document<->checklist links
//      for the lab (with document metadata included).
//   2. Client groups by checklist_item_id into a Map.
//   3. The accreditor tabs filter SCAN_ITEMS to rows where that accreditor's
//      citation field is non-empty and not "N/A".
//   4. Each in-scope row gets a color status derived from the link map + the
//      review_due_date on the latest linked doc.
//
// Color status:
//   - Green: at least one active linked doc, all linked docs current
//   - Amber: linked but at least one linked doc has an overdue review_due_date
//   - Red: no linked docs in scope

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { useLabRoute } from "@/hooks/useLabRoute";
import { authHeaders } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  SCAN_ITEMS,
  DOMAINS,
  type ScanItem,
  type ScanDomain,
} from "@/lib/veritaScanData";
import { ArrowLeft, ExternalLink, FileText, Printer, Search } from "lucide-react";

const API_BASE = "";

type Accreditor = "cap" | "tjc" | "cfr" | "aabb" | "cola";

const ACCREDITORS: { key: Accreditor; label: string; fieldName: keyof ScanItem }[] = [
  { key: "cap",  label: "CAP",  fieldName: "cap" },
  { key: "tjc",  label: "TJC",  fieldName: "tjc" },
  { key: "cfr",  label: "CLIA / 42 CFR", fieldName: "cfr" },
  { key: "aabb", label: "AABB", fieldName: "aabb" },
  { key: "cola", label: "COLA", fieldName: "cola" },
];

interface CoverageLink {
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

type CoverageStatus = "green" | "amber" | "red";

function isInScope(item: ScanItem, accreditor: Accreditor): boolean {
  const field = ACCREDITORS.find(a => a.key === accreditor)!.fieldName;
  const value = (item[field] as string) || "";
  return value.trim() !== "" && value.trim().toUpperCase() !== "N/A";
}

function statusOf(links: CoverageLink[] | undefined): CoverageStatus {
  if (!links || links.length === 0) return "red";
  // amber if any active linked doc has an overdue review_due_date
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const link of links) {
    if (!link.review_due_date) continue;
    const due = new Date(link.review_due_date + "T00:00:00");
    if (due.getTime() < today.getTime()) return "amber";
  }
  return "green";
}

function statusBadge(status: CoverageStatus) {
  if (status === "green") return <Badge className="bg-green-500/10 text-green-400 border-green-500/30 border">Covered</Badge>;
  if (status === "amber") return <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/30 border">Review Overdue</Badge>;
  return <Badge variant="outline" className="text-red-400 border-red-500/30 bg-red-500/5">No Evidence Linked</Badge>;
}

export default function VeritaScanInspectionProofPage() {
  const labId = useActiveLabId();
  const labRoute = useLabRoute();
  const [accreditor, setAccreditor] = useState<Accreditor>("cap");
  const [statusFilter, setStatusFilter] = useState<"all" | CoverageStatus>("all");
  const [searchQ, setSearchQ] = useState("");

  const coverageQuery = useQuery<CoverageLink[]>({
    queryKey: [`/api/labs/${labId}/veritascan/coverage`],
    enabled: !!labId,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritascan/coverage`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Failed to load coverage (${res.status})`);
      return res.json();
    },
  });

  // Build the per-item link map once
  const linksByItem = useMemo(() => {
    const map = new Map<number, CoverageLink[]>();
    for (const link of coverageQuery.data || []) {
      const arr = map.get(link.checklist_item_id) || [];
      arr.push(link);
      map.set(link.checklist_item_id, arr);
    }
    return map;
  }, [coverageQuery.data]);

  // Filter SCAN_ITEMS to in-scope rows for the selected accreditor, sorted by
  // domain (in DOMAINS order) then by id within domain.
  const inScopeItems = useMemo(() => {
    const filtered = SCAN_ITEMS.filter(it => isInScope(it, accreditor));
    const lower = searchQ.trim().toLowerCase();
    const matchSearch = (it: ScanItem) => {
      if (!lower) return true;
      return it.question.toLowerCase().includes(lower) ||
        String(it.id).includes(lower) ||
        (it[ACCREDITORS.find(a => a.key === accreditor)!.fieldName] as string).toLowerCase().includes(lower);
    };
    const matchStatus = (it: ScanItem) => {
      if (statusFilter === "all") return true;
      const status = statusOf(linksByItem.get(it.id));
      return status === statusFilter;
    };
    return filtered.filter(it => matchSearch(it) && matchStatus(it));
  }, [accreditor, searchQ, statusFilter, linksByItem]);

  // Per-status counts for the dashboard tiles
  const counts = useMemo(() => {
    const all = SCAN_ITEMS.filter(it => isInScope(it, accreditor));
    let green = 0, amber = 0, red = 0;
    for (const it of all) {
      const s = statusOf(linksByItem.get(it.id));
      if (s === "green") green++;
      else if (s === "amber") amber++;
      else red++;
    }
    return { total: all.length, green, amber, red };
  }, [accreditor, linksByItem]);

  const accreditorMeta = ACCREDITORS.find(a => a.key === accreditor)!;

  // Group displayed items by domain for rendering
  const grouped = useMemo(() => {
    const m = new Map<ScanDomain, ScanItem[]>();
    for (const it of inScopeItems) {
      const arr = m.get(it.domain) || [];
      arr.push(it);
      m.set(it.domain, arr);
    }
    return m;
  }, [inScopeItems]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 inspection-proof-page">
      <style>{`
        @media print {
          .inspection-proof-page .no-print { display: none !important; }
          .inspection-proof-page table { font-size: 9pt; }
          .inspection-proof-page .max-w-7xl { max-width: none !important; padding: 0 !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="flex items-start justify-between gap-3 mb-6 no-print">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-2">
              <Link href={labRoute("/veritascan/documents")}>
                <ArrowLeft size={14} className="mr-1" />Document Library
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl font-bold">Inspection Proof View</h1>
          <p className="text-sm text-muted-foreground mt-1">
            See which checklist items are covered by linked evidence for the upcoming survey. Pick an accreditor and review your coverage.
          </p>
        </div>
        <Button variant="outline" onClick={() => window.print()} data-testid="button-print">
          <Printer size={14} className="mr-1.5" />Print
        </Button>
      </div>

      <Tabs value={accreditor} onValueChange={(v) => setAccreditor(v as Accreditor)}>
        <TabsList className="no-print">
          {ACCREDITORS.map(a => (
            <TabsTrigger key={a.key} value={a.key} data-testid={`tab-${a.key}`}>{a.label}</TabsTrigger>
          ))}
        </TabsList>

        {ACCREDITORS.map(a => (
          <TabsContent key={a.key} value={a.key} className="mt-4 space-y-4">
            <h2 className="text-lg font-semibold print:block hidden">
              {a.label} Inspection Coverage
            </h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card><CardContent className="p-4">
                <div className="text-2xl font-bold">{counts.total}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Items in Scope</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-2xl font-bold text-green-400">{counts.green}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Covered</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-2xl font-bold text-amber-400">{counts.amber}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Review Overdue</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-2xl font-bold text-red-400">{counts.red}</div>
                <div className="text-xs text-muted-foreground mt-0.5">No Evidence Linked</div>
              </CardContent></Card>
            </div>

            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex flex-wrap items-center gap-3 no-print">
                  <div className="flex items-center gap-1.5">
                    <Search size={14} className="text-muted-foreground" />
                    <Input
                      placeholder="Search items"
                      value={searchQ}
                      onChange={e => setSearchQ(e.target.value)}
                      className="h-9 w-64"
                      data-testid="input-search-items"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">Status:</span>
                    {([
                      { v: "all", label: "All" },
                      { v: "green", label: "Covered" },
                      { v: "amber", label: "Overdue" },
                      { v: "red", label: "No Evidence" },
                    ] as const).map(opt => (
                      <Button
                        key={opt.v}
                        variant={statusFilter === opt.v ? "default" : "outline"}
                        size="sm"
                        onClick={() => setStatusFilter(opt.v as any)}
                        className="h-7 text-xs"
                        data-testid={`filter-${opt.v}`}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {coverageQuery.isLoading && (
                  <div className="text-sm text-muted-foreground py-8 text-center">Loading coverage...</div>
                )}
                {!coverageQuery.isLoading && inScopeItems.length === 0 && (
                  <div className="text-sm text-muted-foreground py-8 text-center">No items match your filter.</div>
                )}

                {DOMAINS.map(dom => {
                  const items = grouped.get(dom);
                  if (!items || items.length === 0) return null;
                  return (
                    <div key={dom} className="space-y-1">
                      <h3 className="text-sm font-semibold border-b pb-1">{dom}</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground border-b">
                              <th className="text-left py-1 pr-3 w-12">#</th>
                              <th className="text-left py-1 pr-3">Item</th>
                              <th className="text-left py-1 pr-3 w-44">{accreditorMeta.label} Citation</th>
                              <th className="text-left py-1 pr-3 w-44">Status</th>
                              <th className="text-left py-1 pr-3 w-72">Linked Evidence</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map(it => {
                              const links = linksByItem.get(it.id);
                              const status = statusOf(links);
                              const citation = it[accreditorMeta.fieldName] as string;
                              return (
                                <tr key={it.id} className="border-b border-border/40 align-top" data-testid={`row-item-${it.id}`}>
                                  <td className="py-2 pr-3 font-mono">{it.id}</td>
                                  <td className="py-2 pr-3">{it.question}</td>
                                  <td className="py-2 pr-3 text-muted-foreground">{citation}</td>
                                  <td className="py-2 pr-3">{statusBadge(status)}</td>
                                  <td className="py-2 pr-3">
                                    {!links || links.length === 0 ? (
                                      <span className="text-muted-foreground italic">No documents linked yet</span>
                                    ) : (
                                      <ul className="space-y-0.5">
                                        {links.map(link => (
                                          <li key={link.link_id} className="flex items-center gap-2">
                                            <FileText size={11} className="text-muted-foreground" />
                                            <a
                                              href={link.external_url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="text-primary hover:underline"
                                            >
                                              {link.display_label || link.title}
                                              <ExternalLink size={9} className="inline ml-1" />
                                            </a>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
