import { useState, useEffect, useMemo, useCallback } from "react";
import { Link } from "wouter";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { useSEO } from "@/hooks/useSEO";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Search, PackageCheck, QrCode, History, X, AlertTriangle, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import BarcodeScannerModal from "@/components/BarcodeScannerModal";

// Open-PO row: an item with quantity on order not yet received.
interface OpenItem {
  id: number;
  item_name: string;
  vendor: string | null;
  catalog_number: string | null;
  usage_unit: string;
  on_order_qty: number;
  on_order_placed_date: string | null;
  on_order_expected_date: string | null;
  barcode_value: string | null;
}

interface Receipt {
  id: number;
  item_name: string;
  vendor: string | null;
  qty_received: number;
  usage_unit: string | null;
  order_placed_date: string | null;
  expected_date: string | null;
  received_date: string | null;
  note?: string | null;
  programmed_lead_time_days: number | null;
  actual_lead_time_days: number | null;
}

interface LeadFlag {
  item_id: number;
  item_name: string;
  vendor: string | null;
  programmed_lead_time_days: number;
  avg_actual_lead_time_days: number;
  suggested_lead_time_days: number;
  sample_size: number;
  direction: "slower" | "faster";
  delta_days: number;
}

// Lead-time drift threshold: only meaningful once actual deviates from
// programmed by more than a few days. Matches the PR 3 flag direction so the
// history column reads consistently (red = took longer, amber = arrived early).
function leadColor(actual: number | null, programmed: number | null): string {
  if (actual == null || programmed == null) return "text-muted-foreground";
  const tol = Math.max(3, programmed * 0.25);
  if (actual > programmed + tol) return "text-red-600 dark:text-red-400 font-semibold";
  if (actual < programmed - tol) return "text-amber-600 dark:text-amber-500 font-semibold";
  return "text-emerald-700 dark:text-emerald-400";
}

export default function VeritaStockReceivingPage() {
  useSEO({
    title: "Receiving - VeritaStock",
    description: "Receive open purchase orders and document received dates to verify lead times.",
  });

  const { isLoggedIn } = useAuth();
  const readOnly = useIsReadOnly("veritastock");
  const { toast } = useToast();
  const activeLabId = useActiveLabId();

  const [items, setItems] = useState<OpenItem[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [flags, setFlags] = useState<LeadFlag[]>([]);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [receiveQ, setReceiveQ] = useState<Record<number, string>>({});
  const [receiveNote, setReceiveNote] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const inventoryListUrl = activeLabId ? `${API_BASE}/api/labs/${activeLabId}/inventory` : `${API_BASE}/api/inventory`;
  const receiptsUrl = activeLabId ? `${API_BASE}/api/labs/${activeLabId}/veritastock/receipts` : null;
  const flagsUrl = activeLabId ? `${API_BASE}/api/labs/${activeLabId}/veritastock/lead-time-flags` : null;
  const stockReturnUrl = activeLabId ? `/labs/${activeLabId}/veritastock` : "/veritastock";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const invRes = await fetch(inventoryListUrl, { headers: authHeaders() });
      const inv = invRes.ok ? await invRes.json() : [];
      setItems((inv as any[]).filter((i) => (i.on_order_qty || 0) > 0));
      if (receiptsUrl) {
        const rRes = await fetch(receiptsUrl, { headers: authHeaders() });
        setReceipts(rRes.ok ? await rRes.json() : []);
      }
      if (flagsUrl) {
        const fRes = await fetch(flagsUrl, { headers: authHeaders() });
        setFlags(fRes.ok ? await fRes.json() : []);
      }
    } catch {
      toast({ title: "Could not load receiving data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [inventoryListUrl, receiptsUrl, flagsUrl, toast]);

  const applyLeadTime = async (f: LeadFlag) => {
    setApplyingId(f.item_id);
    try {
      const res = await fetch(`${API_BASE}/api/inventory/${f.item_id}/lead-time`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ lead_time_days: f.suggested_lead_time_days }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast({ title: "Could not update lead time", description: e.error || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      toast({ title: `${f.item_name}: programmed lead time updated to ${f.suggested_lead_time_days} days`, description: "Reorder point recalculated." });
      await load();
    } finally {
      setApplyingId(null);
    }
  };

  useEffect(() => { if (isLoggedIn) load(); }, [isLoggedIn, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) =>
      i.item_name.toLowerCase().includes(q) ||
      (i.vendor || "").toLowerCase().includes(q) ||
      (i.catalog_number || "").toLowerCase().includes(q) ||
      (i.barcode_value || "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const handleReceive = async (item: OpenItem) => {
    const raw = receiveQ[item.id];
    const qty = raw === undefined || raw === "" ? item.on_order_qty : Number(raw);
    if (!Number.isFinite(qty) || qty <= 0) { toast({ title: "Enter a quantity to receive", variant: "destructive" }); return; }
    setBusyId(item.id);
    try {
      const res = await fetch(`${API_BASE}/api/inventory/${item.id}/receive`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ received_qty: qty, note: (receiveNote[item.id] || "").trim() || undefined }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        toast({ title: "Receive failed", description: e.error || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      const body = await res.json();
      const lead = body.receipt?.actual_lead_time_days;
      toast({
        title: `Received ${qty} ${item.usage_unit}${qty === 1 ? "" : "s"} of ${item.item_name}`,
        description: lead != null ? `Logged. Actual lead time: ${lead} days (programmed ${body.receipt.programmed_lead_time_days ?? "n/a"}).` : "Receipt logged.",
      });
      setReceiveQ((p) => { const n = { ...p }; delete n[item.id]; return n; });
      setReceiveNote((p) => { const n = { ...p }; delete n[item.id]; return n; });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  if (!isLoggedIn) {
    return <div className="max-w-3xl mx-auto px-4 py-10 text-center text-muted-foreground">Please log in to use Receiving.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <Link href={stockReturnUrl}>
        <Button variant="ghost" size="sm" className="mb-3"><ArrowLeft size={14} className="mr-1.5" />Back to Inventory</Button>
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><PackageCheck size={20} style={{ color: "#01696F" }} />Receiving</h1>
          <p className="text-sm text-muted-foreground">Receive open purchase orders. Every receipt is documented with the order-placed and received dates so you can verify your programmed lead times.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 w-64"
              placeholder="Scan or search item, vendor, barcode"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              data-testid="receiving-search"
            />
            {search && (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" onClick={() => setSearch("")} aria-label="Clear"><X size={14} /></button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setScanOpen(true)} data-testid="receiving-scan-button">
            <QrCode size={14} className="mr-1.5" />Scan
          </Button>
        </div>
      </div>

      {/* Open purchase orders */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[55vh]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10">Item</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10">Vendor</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10 text-right">On Order</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10">Order Placed</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10">Expected</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10 text-right">Receive Qty</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Loading...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground" data-testid="receiving-empty">
                    {items.length === 0 ? "Nothing is on order right now. Items show here once a purchase order is placed (set an On Order quantity on the item)." : "No open orders match your search."}
                  </td></tr>
                ) : filtered.map((it) => (
                  <tr key={it.id} className="border-b hover:bg-muted/40" data-testid={`receiving-row-${it.id}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{it.item_name}</div>
                      {it.catalog_number && <div className="text-xs text-muted-foreground">{it.catalog_number}</div>}
                    </td>
                    <td className="px-3 py-2">{it.vendor || <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-3 py-2 text-right font-mono">{it.on_order_qty.toLocaleString()} {it.usage_unit}s</td>
                    <td className="px-3 py-2">{it.on_order_placed_date || <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-3 py-2">{it.on_order_expected_date || <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-3 py-2 text-right">
                      <Input
                        type="number" min={0} className="w-24 h-8 text-right ml-auto"
                        placeholder={String(it.on_order_qty)}
                        value={receiveQ[it.id] ?? ""}
                        onChange={(e) => setReceiveQ((p) => ({ ...p, [it.id]: e.target.value }))}
                        data-testid={`receiving-qty-${it.id}`}
                        disabled={readOnly}
                      />
                      <Input
                        type="text"
                        className="w-40 h-7 mt-1 text-xs ml-auto"
                        placeholder="Note (optional)"
                        value={receiveNote[it.id] ?? ""}
                        onChange={(e) => setReceiveNote((p) => ({ ...p, [it.id]: e.target.value }))}
                        data-testid={`receiving-note-${it.id}`}
                        disabled={readOnly}
                        title="Optional: partial shipment, damaged, received out of temperature, etc."
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" onClick={() => handleReceive(it)} disabled={readOnly || busyId === it.id} data-testid={`receiving-receive-${it.id}`} style={{ backgroundColor: "#01696F" }}>
                        <PackageCheck size={14} className="mr-1.5" />{busyId === it.id ? "..." : "Receive"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Lead-time drift: items whose actual lead time consistently differs from
          the programmed value that drives their reorder point. Slower = stockout
          risk; faster = over-buffered safety stock. One-click apply the actual. */}
      {flags.length > 0 && (
        <div className="mt-8" data-testid="leadtime-drift-panel">
          <h2 className="text-base font-semibold mb-2 flex items-center gap-2"><Clock size={16} />Lead-time check</h2>
          <p className="text-xs text-muted-foreground mb-2">These items consistently arrive on a different schedule than their programmed lead time, so their reorder points may be off. Review and apply the observed lead time.</p>
          <div className="space-y-2">
            {flags.map((f) => {
              const slower = f.direction === "slower";
              return (
                <div key={f.item_id} className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${slower ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30" : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"}`} data-testid={`leadtime-flag-${f.item_id}`}>
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={18} className={`mt-0.5 shrink-0 ${slower ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-500"}`} />
                    <div className="text-sm">
                      <div className="font-semibold">{f.item_name}{f.vendor ? ` (${f.vendor})` : ""}</div>
                      <div className={slower ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300"}>
                        Programmed lead time {f.programmed_lead_time_days} days, but the last {f.sample_size} receipts averaged {f.avg_actual_lead_time_days} days
                        {slower ? ` (${f.delta_days} days slower, stockout risk).` : ` (${Math.abs(f.delta_days)} days faster, over-buffered).`}
                      </div>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" disabled={readOnly || applyingId === f.item_id} onClick={() => applyLeadTime(f)} data-testid={`leadtime-apply-${f.item_id}`}>
                    {applyingId === f.item_id ? "..." : `Update to ${f.suggested_lead_time_days} days`}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Receipt history */}
      <h2 className="text-base font-semibold mt-8 mb-2 flex items-center gap-2"><History size={16} />Receipt history</h2>
      <p className="text-xs text-muted-foreground mb-2">Every received order, with the actual lead time (received minus placed) against your programmed lead time. Red took longer than programmed; amber arrived early.</p>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[45vh]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10">Received</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10">Item</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10">Vendor</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10 text-right">Qty</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10">Placed</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10 text-right">Programmed</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10 text-right">Actual lead</th>
                  <th className="px-3 py-2 font-medium sticky top-0 bg-muted z-10">Note</th>
                </tr>
              </thead>
              <tbody>
                {receipts.length === 0 ? (
                  <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground" data-testid="receipts-empty">No receipts logged yet. Receiving an order above records it here.</td></tr>
                ) : receipts.map((r) => (
                  <tr key={r.id} className="border-b" data-testid={`receipt-row-${r.id}`}>
                    <td className="px-3 py-2">{r.received_date || "-"}</td>
                    <td className="px-3 py-2">{r.item_name}</td>
                    <td className="px-3 py-2">{r.vendor || <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-3 py-2 text-right font-mono">{(r.qty_received || 0).toLocaleString()} {r.usage_unit || ""}</td>
                    <td className="px-3 py-2">{r.order_placed_date || <span className="text-muted-foreground">-</span>}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.programmed_lead_time_days != null ? `${r.programmed_lead_time_days}d` : "-"}</td>
                    <td className={`px-3 py-2 text-right font-mono ${leadColor(r.actual_lead_time_days, r.programmed_lead_time_days)}`}>
                      {r.actual_lead_time_days != null ? `${r.actual_lead_time_days}d` : "-"}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.note || <span className="text-muted-foreground">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Scan to receive: capture a barcode and drop it into the search so the
          matching open PO surfaces. Uses the existing scanner in bind mode. */}
      <BarcodeScannerModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        mode="bind"
        apiBase={API_BASE}
        authHeaders={authHeaders}
        inventory={items.map((i) => ({ id: i.id, item_name: i.item_name, barcode_value: i.barcode_value }))}
        activeLabId={activeLabId}
        onBindComplete={(value) => { setSearch(value); setScanOpen(false); }}
      />
    </div>
  );
}
