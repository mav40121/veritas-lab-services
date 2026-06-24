// client/src/pages/VeritaStockEnterprisePage.tsx
//
// VeritaStock Enterprise (multi-location) view. Cross-location stock roll-up
// plus a multi-item transfer: pick From and To once, type quantities inline
// on the grid (search + low-stock filter to find what to move), review the
// running list, and submit it all as one atomic batch. Wired to the
// /api/labs/:labId/veritastock/ endpoints. Roll-up scope is owner + the
// user's active memberships, enforced server-side.

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
  ArrowLeft, ArrowRightLeft, Building2, Truck, RefreshCw, AlertTriangle, Package, Search, X, Check,
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
  direction?: "in" | "out";
  status?: string | null;
  batch_id?: string | null;
  accepted_by_name?: string | null;
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

  // Transfer state: one From and one To for the whole batch, plus a map of
  // item key -> typed quantity (count_unit). Filled rows become the batch.
  const [fromLab, setFromLab] = useState("");
  const [toLab, setToLab] = useState("");
  const [qtyByKey, setQtyByKey] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [incoming, setIncoming] = useState<TransferRow[]>([]);
  const [decidingBatch, setDecidingBatch] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!labId) return;
    setLoading(true);
    setError(null);
    try {
      const [rRes, tRes, iRes] = await Promise.all([
        fetch(`${API_BASE}/api/labs/${labId}/veritastock/enterprise/rollup`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/labs/${labId}/veritastock/transfers`, { headers: authHeaders() }),
        fetch(`${API_BASE}/api/labs/${labId}/veritastock/transfers/incoming`, { headers: authHeaders() }),
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
      if (iRes.ok) {
        const iData = await iRes.json();
        setIncoming(iData.incoming || []);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load enterprise view");
    } finally {
      setLoading(false);
    }
  }, [labId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const locName = (id: number | string) =>
    locations.find((l) => String(l.id) === String(id))?.name || `Lab ${id}`;

  const transferReady = !!(fromLab && toLab && fromLab !== toLab);

  // Column order for the roll-up grid: when a transfer is set up, the source
  // (From) location is leftmost, the destination (To) is next, then any other
  // locations. Keeps the grid reading left-to-right in the direction stock
  // moves. Display-only: the transfer logic keys off fromLab, not column index.
  const orderedLocations = useMemo(() => {
    if (!transferReady) return locations;
    const src = locations.find((l) => String(l.id) === fromLab);
    const dst = locations.find((l) => String(l.id) === toLab);
    const rest = locations.filter(
      (l) => String(l.id) !== fromLab && String(l.id) !== toLab,
    );
    return [src, dst, ...rest].filter(Boolean) as LocationMeta[];
  }, [locations, fromLab, toLab, transferReady]);

  // Filtered rows for display (the typed quantities persist regardless).
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !(`${r.item_name} ${r.catalog_number || ""}`.toLowerCase().includes(q))) return false;
      if (lowOnly && !Object.values(r.by_location).some((c) => c.low)) return false;
      return true;
    });
  }, [rows, search, lowOnly]);

  // The lines the batch will carry: any row with a positive typed quantity
  // that is actually stocked at the chosen source.
  const pendingLines = useMemo(() => {
    if (!transferReady) return [] as Array<{ key: string; item_name: string; count_unit: string; qty: number; itemId: number; sourceCount: number; over: boolean }>;
    const out: Array<{ key: string; item_name: string; count_unit: string; qty: number; itemId: number; sourceCount: number; over: boolean }> = [];
    for (const r of rows) {
      const raw = qtyByKey[r.key];
      const qty = Number(raw);
      const cell = r.by_location[fromLab];
      if (!cell || !raw || !Number.isFinite(qty) || qty <= 0) continue;
      out.push({
        key: r.key, item_name: r.item_name, count_unit: r.count_unit, qty,
        itemId: cell.item_id, sourceCount: cell.count_on_hand, over: qty > cell.count_on_hand,
      });
    }
    return out;
  }, [rows, qtyByKey, fromLab, transferReady]);

  const anyOver = pendingLines.some((l) => l.over);

  function setQty(key: string, val: string) {
    setQtyByKey((m) => ({ ...m, [key]: val }));
  }
  function clearAll() { setQtyByKey({}); }

  async function submitBatch() {
    if (!transferReady) { toast({ title: "Pick a From and a To location first", variant: "destructive" }); return; }
    if (pendingLines.length === 0) { toast({ title: "Type a quantity on at least one item", variant: "destructive" }); return; }
    if (anyOver) { toast({ title: "One or more quantities exceed what the source has", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/labs/${fromLab}/veritastock/transfer-batch`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ to_lab_id: Number(toLab), lines: pendingLines.map((l) => ({ item_id: l.itemId, quantity: l.qty })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data.error === "batch_invalid" && Array.isArray(data.errors)
          ? data.errors.map((e: any) => e.error).join(", ")
          : (data.error || "Transfer failed");
        throw new Error(msg);
      }
      toast({ title: "Transfer sent", description: `${data.sent} item(s) to ${locName(toLab)}, awaiting acceptance` });
      clearAll();
      await loadAll();
    } catch (e: any) {
      toast({ title: "Transfer failed", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  // Pending incoming shipments grouped by batch_id, so a multi-item shipment is
  // accepted or rejected as one unit (mirrors how it was sent).
  const incomingBatches = useMemo(() => {
    const groups = new Map<string, {
      batch_id: string; from_lab_name: string; to_lab_name: string;
      initiated_by_name: string | null; created_at: string; items: TransferRow[];
    }>();
    for (const t of incoming) {
      const bid = t.batch_id || `t${t.id}`;
      let g = groups.get(bid);
      if (!g) {
        g = {
          batch_id: bid,
          from_lab_name: t.from_lab_name || `Lab ${t.from_lab_id}`,
          to_lab_name: t.to_lab_name || `Lab ${t.to_lab_id}`,
          initiated_by_name: t.initiated_by_name,
          created_at: t.created_at,
          items: [],
        };
        groups.set(bid, g);
      }
      g.items.push(t);
    }
    return Array.from(groups.values());
  }, [incoming]);

  // When arriving via the main-page "Incoming" badge/banner (href ...#incoming),
  // scroll the Accept/Reject panel into view once it has rendered, so the
  // destination user lands directly on what they came to do.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#incoming") return;
    if (incomingBatches.length === 0) return;
    const el = document.getElementById("incoming");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [incomingBatches.length]);

  // Destination accepts (lands the stock) or rejects (returns it to source) a
  // whole pending shipment by its batch_id.
  async function decideBatch(batchId: string, action: "accept" | "reject") {
    if (!labId) return;
    let reason: string | undefined;
    if (action === "reject") {
      const r = window.prompt("Reason for rejecting this shipment (optional): damaged, wrong item, out of temp...");
      if (r === null) return; // cancelled
      reason = r.trim() || undefined;
    }
    setDecidingBatch(batchId);
    try {
      // Literal accept/reject suffix (not an interpolated segment) so the
      // lab-scoped write-route guard can match the server route statically.
      const url = action === "accept"
        ? `${API_BASE}/api/labs/${labId}/veritastock/transfers/${batchId}/accept`
        : `${API_BASE}/api/labs/${labId}/veritastock/transfers/${batchId}/reject`;
      const res = await fetch(url, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(action === "reject" ? { reason } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      toast({
        title: action === "accept" ? "Transfer accepted" : "Transfer rejected",
        description: action === "accept"
          ? `${data.accepted} item(s) added to ${locName(data.to_lab_id)}`
          : `${data.rejected} item(s) returned to the source`,
      });
      await loadAll();
    } catch (e: any) {
      toast({ title: `Could not ${action} transfer`, description: e.message, variant: "destructive" });
    } finally {
      setDecidingBatch(null);
    }
  }

  const lowAlerts = useMemo(
    () => rows.reduce((n, r) => n + Object.values(r.by_location).filter((c) => c.low).length, 0),
    [rows],
  );

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
            Stock across every location in your enterprise, with multi-item transfers between the warehouse and stockrooms.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Locations", value: locations.length },
          { label: "Items tracked", value: rows.length },
          { label: "Low-stock alerts", value: lowAlerts, danger: lowAlerts > 0 },
          { label: "Incoming to accept", value: incomingBatches.length, danger: incomingBatches.length > 0 },
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

      {/* Incoming transfers: pending shipments this enterprise must Accept
          (land the stock) or Reject (return it to the source). */}
      {incomingBatches.length > 0 && (
        <Card id="incoming" className="mb-4 border-emerald-300 bg-emerald-50/40 scroll-mt-20" data-testid="incoming-transfers">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Truck size={15} className="text-emerald-600" />
              <span className="font-semibold text-sm">Incoming transfers to accept</span>
              <Badge variant="outline" className="text-emerald-700">{incomingBatches.length}</Badge>
            </div>
            <ul className="space-y-3">
              {incomingBatches.map((b) => (
                <li key={b.batch_id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="text-sm font-medium">{b.from_lab_name} to {b.to_lab_name}</div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{(b.created_at || "").slice(0, 10)}</span>
                  </div>
                  <ul className="text-sm text-muted-foreground mb-2 space-y-0.5">
                    {b.items.map((it) => (
                      <li key={it.id}>{it.item_name}{it.display_qty != null ? ` · ${it.display_qty} ${it.display_unit}` : ""}</li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{b.initiated_by_name ? `Sent by ${b.initiated_by_name}` : "In transit"}</span>
                    <div className="flex gap-2">
                      <Button
                        size="sm" variant="outline"
                        onClick={() => decideBatch(b.batch_id, "reject")}
                        disabled={decidingBatch === b.batch_id}
                        data-testid="reject-transfer"
                      >
                        <X size={13} className="mr-1" /> Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => decideBatch(b.batch_id, "accept")}
                        disabled={decidingBatch === b.batch_id}
                        data-testid="accept-transfer"
                      >
                        <Check size={13} className="mr-1" /> {decidingBatch === b.batch_id ? "Working." : "Accept"}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Transfer setup: pick From and To once for the whole batch */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3"><Truck size={15} className="text-primary" /><span className="font-semibold text-sm">Build a transfer</span></div>
          {locations.length < 2 ? (
            <p className="text-sm text-muted-foreground">Transfers need at least two locations in your enterprise.</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">From (source)</Label>
                <Select value={fromLab} onValueChange={(v) => { setFromLab(v); clearAll(); }}>
                  <SelectTrigger data-testid="transfer-from"><SelectValue placeholder="Source location" /></SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">To (destination)</Label>
                <Select value={toLab} onValueChange={setToLab}>
                  <SelectTrigger data-testid="transfer-to"><SelectValue placeholder="Destination location" /></SelectTrigger>
                  <SelectContent>
                    {locations.filter((l) => String(l.id) !== fromLab).map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          {!transferReady && locations.length >= 2 && (
            <p className="text-xs text-muted-foreground mt-3">Pick a source and destination, then type quantities in the Transfer column below.</p>
          )}
        </CardContent>
      </Card>

      {/* Toolbar: search + low-stock filter */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search items" className="pl-8 h-9" data-testid="enterprise-search" />
        </div>
        <Button variant={lowOnly ? "default" : "outline"} size="sm" onClick={() => setLowOnly((v) => !v)}>
          <AlertTriangle size={13} className="mr-1.5" /> Low stock only
        </Button>
        <Button variant="ghost" size="sm" onClick={loadAll} disabled={loading}>
          <RefreshCw size={13} className={`mr-1.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Roll-up grid with inline transfer quantity column */}
      <Card className="mb-6">
        <CardContent className="p-0 max-h-[70vh] overflow-auto">
          <table className="w-full text-sm" data-testid="rollup-table">
            <thead>
              {/* Sticky header: pins to the top of the scroll pane so the column
                  labels stay visible while the item list scrolls. Each th carries
                  its own opaque bg + bottom border so rows do not bleed through. */}
              <tr className="text-muted-foreground text-xs">
                <th className="sticky top-0 z-20 bg-card border-b text-left font-medium p-3">Item</th>
                {orderedLocations.map((l) => (
                  <th key={l.id} className="sticky top-0 z-20 bg-card border-b text-center font-medium p-3 whitespace-nowrap">
                    {l.name}{l.is_warehouse && <Badge variant="outline" className="ml-1.5 text-[10px]">WH</Badge>}
                  </th>
                ))}
                <th className="sticky top-0 z-20 bg-card border-b text-center font-medium p-3">Total</th>
                <th className="sticky top-0 z-20 bg-card border-b text-center font-medium p-3 whitespace-nowrap">Transfer{transferReady ? ` (${locName(fromLab).split(" ")[0]} to ${locName(toLab).split(" ")[0]})` : ""}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && !loading && (
                <tr><td colSpan={locations.length + 3} className="p-6 text-center text-muted-foreground">No items match.</td></tr>
              )}
              {filteredRows.map((r) => {
                const srcCell = transferReady ? r.by_location[fromLab] : undefined;
                const raw = qtyByKey[r.key] || "";
                const over = srcCell && raw !== "" && Number(raw) > srcCell.count_on_hand;
                return (
                  <tr key={r.key} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="p-3">
                      <div className="font-medium">{r.item_name}</div>
                      {r.catalog_number && <div className="text-xs text-muted-foreground">{r.catalog_number}</div>}
                    </td>
                    {orderedLocations.map((l) => {
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
                    <td className="text-center p-2">
                      {transferReady && srcCell ? (
                        <Input
                          type="number" min="0" max={srcCell.count_on_hand} value={raw}
                          onChange={(e) => setQty(r.key, e.target.value)}
                          className={`h-8 w-20 mx-auto text-center ${over ? "border-red-400 text-red-600" : ""}`}
                          placeholder="0"
                          aria-label={`Transfer quantity for ${r.item_name}`}
                        />
                      ) : (
                        <span className="text-muted-foreground text-xs">.</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Review tray: the pending batch */}
      {transferReady && (
        <Card className="mb-8 border-primary/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ArrowRightLeft size={15} className="text-primary" />
                Pending transfer: {locName(fromLab)} to {locName(toLab)}
              </div>
              {pendingLines.length > 0 && (
                <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground">Clear all</Button>
              )}
            </div>
            {pendingLines.length === 0 ? (
              <p className="text-sm text-muted-foreground">Type quantities in the Transfer column above to build the batch.</p>
            ) : (
              <>
                <ul className="divide-y mb-3">
                  {pendingLines.map((l) => (
                    <li key={l.key} className="py-2 flex items-center gap-3 text-sm">
                      <span className="flex-1">{l.item_name}</span>
                      <span className={l.over ? "text-red-600 font-medium" : ""}>
                        {l.qty} {l.count_unit}{l.over ? ` (only ${l.sourceCount} available)` : ""}
                      </span>
                      <button onClick={() => setQty(l.key, "")} aria-label={`Remove ${l.item_name}`} className="text-muted-foreground hover:text-foreground">
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">{pendingLines.length} item(s). Stock leaves the source now and lands at {locName(toLab)} once it is accepted there, all or nothing.</p>
                  <Button onClick={submitBatch} disabled={submitting || anyOver} data-testid="transfer-submit">
                    <Truck size={14} className="mr-1.5" /> {submitting ? "Sending." : `Send ${pendingLines.length} item(s)`}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

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
                    {t.status && t.status !== "completed" && (
                      <Badge
                        variant="outline"
                        className={`ml-2 text-[10px] ${t.status === "pending" ? "text-amber-700 border-amber-300" : t.status === "accepted" ? "text-emerald-700 border-emerald-300" : "text-red-600 border-red-300"}`}
                      >
                        {t.status}
                      </Badge>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {t.from_lab_name || `Lab ${t.from_lab_id}`} to {t.to_lab_name || `Lab ${t.to_lab_id}`}
                      {t.initiated_by_name && ` · ${t.initiated_by_name}`}
                      {t.accepted_by_name && t.status === "accepted" && ` · accepted by ${t.accepted_by_name}`}
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
