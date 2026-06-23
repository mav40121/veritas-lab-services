// client/src/pages/VeritaStockAuditTrailPage.tsx
//
// VeritaStock Audit Trail: every inventory action across the enterprise's
// locations (receive, adjust, transfer out/accept/reject, write-off, item
// edit), who did it, when, and the before-and-after. Reads the owner-scoped
// /api/labs/:labId/veritastock/audit-log endpoint (backed by the shared
// audit_log table). Surveyor-defensible, filterable by action + search.

import { useState, useEffect, useCallback } from "react";
import { Link, useParams } from "wouter";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useSEO } from "@/hooks/useSEO";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, ScrollText, RefreshCw, Search } from "lucide-react";

interface AuditEntry {
  id: number;
  user_id: number;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
  actor_email: string | null;
  location_name: string | null;
}

const ACTION_LABEL: Record<string, string> = {
  create: "Item created",
  update: "Item edited",
  delete: "Item removed",
  restore: "Item restored",
  transfer_out: "Transfer sent",
  transfer_in: "Transfer accepted",
  transfer_rejected: "Transfer rejected",
};
const actionLabel = (a: string) => ACTION_LABEL[a] || a.replace(/_/g, " ");

// Fallback when an entry has no human label: surface a quantity before -> after.
function fallbackDetail(e: AuditEntry): string {
  try {
    const b = e.before_json ? JSON.parse(e.before_json) : null;
    const a = e.after_json ? JSON.parse(e.after_json) : null;
    if (b && a && "quantity_on_hand" in b && "quantity_on_hand" in a && b.quantity_on_hand !== a.quantity_on_hand) {
      return `On hand ${b.quantity_on_hand} to ${a.quantity_on_hand}`;
    }
  } catch { /* ignore */ }
  return e.entity_type === "inventory_item" ? `Item ${e.entity_id}` : e.entity_type;
}

export default function VeritaStockAuditTrailPage() {
  const params = useParams();
  const routeLabId = (params as any).labId as string | undefined;
  const activeLabId = useActiveLabId();
  const labId = routeLabId || (activeLabId ? String(activeLabId) : undefined);

  useSEO({
    title: "Audit Trail - VeritaStock",
    description: "Every inventory action, who did it, and when, across your locations.",
  });

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("All");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    if (!labId) return;
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (action !== "All") p.set("action", action);
      if (search.trim()) p.set("q", search.trim());
      const qs = p.toString();
      const res = await fetch(`${API_BASE}/api/labs/${labId}/veritastock/audit-log${qs ? `?${qs}` : ""}`, { headers: authHeaders() });
      if (res.ok) {
        const d = await res.json();
        setEntries(d.entries || []);
        if (Array.isArray(d.actions)) setActions(d.actions);
      }
    } catch { /* network error, leave prior state */ } finally {
      setLoading(false);
    }
  }, [labId, action, search]);

  useEffect(() => { load(); }, [load]);

  const backUrl = labId ? `/labs/${labId}/veritastock` : "/veritastock";

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8" data-testid="audit-trail-page">
      <Link href={backUrl}>
        <Button variant="ghost" size="sm" className="mb-3 -ml-2">
          <ArrowLeft size={14} className="mr-1.5" /> Back to VeritaStock
        </Button>
      </Link>

      <div className="flex items-start gap-3 mb-6">
        <ScrollText size={26} className="text-primary shrink-0 mt-1" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Audit Trail</h1>
          <p className="text-sm text-muted-foreground">
            Every inventory action across your locations: who did what, when, and the before-and-after. Receiving,
            adjustments, transfers, and write-offs are all logged automatically.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item, person, or action"
            className="pl-8 h-9"
            data-testid="audit-search"
          />
        </div>
        <div className="min-w-[180px]">
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger data-testid="audit-action-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All actions</SelectItem>
              {actions.map((a) => <SelectItem key={a} value={a}>{actionLabel(a)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw size={13} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm" data-testid="audit-table">
            <thead className="bg-muted/40 border-b">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium whitespace-nowrap">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Detail</th>
                <th className="px-3 py-2 font-medium">Location</th>
              </tr>
            </thead>
            <tbody>
              {loading && entries.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">Loading...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No audit entries yet. Receiving, adjustments, transfers, and write-offs will appear here.</td></tr>
              ) : entries.map((e) => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30" data-testid={`audit-row-${e.id}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">{(e.created_at || "").replace("T", " ").slice(0, 16)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.actor_email || `User ${e.user_id}`}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><Badge variant="outline" className="text-xs font-normal">{actionLabel(e.action)}</Badge></td>
                  <td className="px-3 py-2">{e.entity_label || fallbackDetail(e)}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{e.location_name || "."}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground mt-2">
        Showing the {entries.length} most recent action{entries.length === 1 ? "" : "s"}{action !== "All" ? ` (${actionLabel(action)})` : ""}.
      </p>
    </div>
  );
}
