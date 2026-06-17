// client/src/pages/VeritaStockEnterprisePage.tsx
//
// VeritaStock Enterprise (multi-location) view. PR 2 of the enterprise
// inventory build. Renders the cross-location stock roll-up, a transfer
// panel (warehouse <-> stockroom, down/up/across), and the transfer ledger.
// Wired to the PR 1 endpoints under /api/labs/:labId/veritastock/.
// The roll-up scope is owner + the user's active memberships, enforced
// server-side; this page only renders what those endpoints return.

import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useParams } from "wouter";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useSEO } from "@/hooks/useSEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, ArrowRightLeft, Building2, Truck, RefreshCw, AlertTriangle, Package,
} from "lucide-react";

interface LocCell {
  item_id: number;
  quantity_on_hand: number;
  count_on_hand: number;
  reorder_point: number;
  low: boolean;
}
interface RollupRow {
  key: string;
  item_name: string;
  catalog_number: string | null;
  count_unit: string;
  by_location: Record<string, LocCell>;
  total_usage: number;
}
interface LocationMeta { id: number; name: string; is_warehouse: boolean; }
interface TransferRow {
  id: number;
  from_lab_id: number;
  to_lab_id: number;
  from_lab_name: string | null;
  to_lab_name: string | null;
  item_name: string;
  display_qty: number | null;
  display_unit: string | null;
  initiated_by_name: string | null;
  created_at: string;
  direction: "in" | "out";
}

export default function VeritaStockEnterprisePage() {
  const params = useParams();
  const labId = (params as any).labId as string | undefined;
  const { toast } = useToast();
  useSEO({
    title: "VeritaStock Enterprise: Multi-Location Inventory",
    description: "Cross-location stock roll-up and transfers for an enterprise's warehouse and stockroom locations.",
  });

  const [locations, setLocations] = useState<LocationMeta[]>([]);
  const [rows, setRows] = useState<RollupRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Transfer form state.
  const [tItemKey, setTItemKey] = useState("");
  const [tFrom, setTFrom] = useState("");
  const [tTo, setTTo] = useState("");
  const [tQty, setTQty] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadAll = useCallback(async () => {
    if (!labId) return;
    setLoading(true);
    setError(null);
    try {
      const [rRes, tRes] = await Promise.all([
        fetch(`${API_BASE}/api/labs/${labId}/veritastock/enterprise/rollup`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/labs/${labId}/veritastock/transfers`, { headers: authHeaders() }),
      ]);
      if (!rRes.ok) {
        const body = await rRes.json().catch(() => ({}));
        throw new Error(body.error || `Roll-up failed (${rRes.status})`);
      }
      const rData = await rRes.json();
      setLocations(rData.locations || []);
      setRows(rData.rows || []);
      if (tRes.ok) {
        const tData = await tRes.json();
        setTransfers(tData.transfers || []);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load enterprise view");
    } finally {
      setLoading(false);
    }
  }, [labId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const selectedRow = useMemo(() => rows.find((r) => r.key === tItemKey) || null, [rows, tItemKey]);
  const fromOptions = useMemo(
    () => (selectedRow ? locations.filter((l) => selectedRow.by_location[l.id]) : []),
    [selectedRow, locations],
  );
  const lowAlerts = useMemo(
    () => rows.reduce((n, r) => n + Object.values(r.by_location).filter((c) => c.low).length, 0),
    [rows],
  );
  const locName = (id: number | string) =>
    locations.find((l) => String(l.id) === String(id))?.name || `Lab ${id}`;

  async function submitTransfer() {
    if (!selectedRow || !tFrom || !tTo || !tQty) {
      toast({ title: "Fill in item, quantity, from, and to", variant: "destructive" });
      return;
    }
    if (tFrom === tTo) {
      toast({ title: "From and to must be different locations", variant: "destructive" });
      return;
    }
    const cell = selectedRow.by_location[tFrom];
    if (!cell) {
      toast({ title: "That item is not stocked at the source location", variant: "destructive" });
      return;
    }
    const qty = Number(tQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({ title: "Quantity must be a positive number", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Endpoint is scoped to the SOURCE lab; membership is validated there.
      const res = await fetch(`${API_BASE}/api/labs/${tFrom}/veritastock/transfer`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ to_lab_id: Number(tTo), item_id: cell.item_id, quantity: qty }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Transfer failed");
      toast({
        title: "Transfer recorded",
        description: `${data.moved_display} of ${data.item_name}, ${locName(tFrom)} to ${locName(tTo)}`,
      });
      setTQty("");
      await loadAll();
    } catch (e: any) {
      toast({ title: "Transfer failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8" data-testid="enterprise-page">
      <Link href={labId ? `/labs/${labId}/veritastock` : "/veritastock"}>
        <Button variant="ghost" size="sm" className="mb-3 -ml-2">
          <ArrowLeft size={14} className="mr-1.5" /> Back to VeritaStock
        </Button>
      </Link>

      <div className="flex items-start gap-3 mb-6">
        <Building2 size={26} className="text-primary shrink-0 mt-1" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Enterprise Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Stock across every location in your enterprise, with transfers between the warehouse and stockrooms.
          </p>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Locations", value: locations.length },
          { label: "Items tracked", value: rows.length },
          { label: "Low-stock alerts", value: lowAlerts, danger: lowAlerts > 0 },
          { label: "Recent transfers", value: transfers.length },
        ].map((t) => (
          <div key={t.label} className="bg-muted/40 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-1">{t.label}</div>
            <div className={`text-2xl font-semibold ${t.danger ? "text-amber-600" : ""}`}>{t.value}</div>
          </div>
        ))}
      </div>

      {error && (
        <Card className="border-amber-300 bg-amber-50 mb-6">
          <CardContent className="p-4 flex items-center gap-2 text-amber-900 text-sm">
            <AlertTriangle size={15} /> {error}
            <Button variant="outline" size="sm" className="ml-auto" onClick={loadAll}>
              <RefreshCw size={13} className="mr-1.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Roll-up grid */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-sm flex items-center gap-1.5"><Package size={15} /> Stock by location</h2>
        <Button variant="ghost" size="sm" onClick={loadAll} disabled={loading}>
          <RefreshCw size={13} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>
      <Card className="mb-8 overflow-x-auto">
        <CardContent className="p-0">
          <table className="w-full text-sm" data-testid="rollup-table">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="text-left font-medium p-3">Item</th>
                {locations.map((l) => (
                  <th key={l.id} className="text-center font-medium p-3 whitespace-nowrap">
                    {l.name}{l.is_warehouse && <Badge variant="outline" className="ml-1.5 text-[10px]">WH</Badge>}
                  </th>
                ))}
                <th className="text-center font-medium p-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading && (
                <tr><td colSpan={locations.length + 2} className="p-6 text-center text-muted-foreground">
                  No items found across your locations.
                </td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.key} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3">
                    <div className="font-medium">{r.item_name}</div>
                    {r.catalog_number && <div className="text-xs text-muted-foreground">{r.catalog_number}</div>}
                  </td>
                  {locations.map((l) => {
                    const c = r.by_location[l.id];
                    return (
                      <td key={l.id} className={`text-center p-3 ${c?.low ? "bg-amber-50 text-amber-700 font-medium" : ""}`}>
                        {c ? `${c.count_on_hand} ${r.count_unit}` : <span className="text-muted-foreground">.</span>}
                      </td>
                    );
                  })}
                  <td className="text-center p-3 text-muted-foreground">
                    {Object.values(r.by_location).reduce((s, c) => s + c.count_on_hand, 0)} {r.count_unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* New transfer */}
      <h2 className="font-semibold text-sm flex items-center gap-1.5 mb-2"><Truck size={15} /> New transfer</h2>
      <Card className="mb-8">
        <CardContent className="p-4">
          {locations.length < 2 ? (
            <p className="text-sm text-muted-foreground">
              Transfers need at least two locations in your enterprise. Add a second location to enable them.
            </p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Item</Label>
                <Select value={tItemKey} onValueChange={(v) => { setTItemKey(v); setTFrom(""); }}>
                  <SelectTrigger data-testid="transfer-item"><SelectValue placeholder="Select an item" /></SelectTrigger>
                  <SelectContent>
                    {rows.map((r) => <SelectItem key={r.key} value={r.key}>{r.item_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Quantity ({selectedRow?.count_unit || "units"})</Label>
                <Input type="number" min="1" value={tQty} onChange={(e) => setTQty(e.target.value)} data-testid="transfer-qty" />
              </div>
              <div>
                <Label className="text-xs">From</Label>
                <Select value={tFrom} onValueChange={setTFrom} disabled={!selectedRow}>
                  <SelectTrigger data-testid="transfer-from"><SelectValue placeholder="Source location" /></SelectTrigger>
                  <SelectContent>
                    {fromOptions.map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>
                        {l.name} ({selectedRow?.by_location[l.id]?.count_on_hand} {selectedRow?.count_unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Select value={tTo} onValueChange={setTTo}>
                  <SelectTrigger data-testid="transfer-to"><SelectValue placeholder="Destination location" /></SelectTrigger>
                  <SelectContent>
                    {locations.filter((l) => String(l.id) !== tFrom).map((l) => (
                      <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 flex items-center justify-between gap-3 pt-1">
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <ArrowRightLeft size={13} /> Moves stock and records a signed ledger entry on both locations.
                </p>
                <Button onClick={submitTransfer} disabled={submitting} data-testid="transfer-submit">
                  <Truck size={14} className="mr-1.5" /> {submitting ? "Transferring." : "Transfer stock"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <h2 className="font-semibold text-sm flex items-center gap-1.5 mb-2"><ArrowRightLeft size={15} /> Transfer history</h2>
      <Card>
        <CardContent className="p-0">
          {transfers.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No transfers yet.</p>
          ) : (
            <ul className="divide-y">
              {transfers.map((t) => (
                <li key={t.id} className="p-3 text-sm flex items-center gap-3">
                  <Badge variant="outline" className={t.direction === "out" ? "text-amber-700" : "text-emerald-700"}>
                    {t.direction === "out" ? "OUT" : "IN"}
                  </Badge>
                  <div className="flex-1">
                    <span className="font-medium">{t.item_name}</span>
                    {t.display_qty != null && <span className="text-muted-foreground"> · {t.display_qty} {t.display_unit}</span>}
                    <div className="text-xs text-muted-foreground">
                      {t.from_lab_name || `Lab ${t.from_lab_id}`} to {t.to_lab_name || `Lab ${t.to_lab_id}`}
                      {t.initiated_by_name && ` · ${t.initiated_by_name}`}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{(t.created_at || "").slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
