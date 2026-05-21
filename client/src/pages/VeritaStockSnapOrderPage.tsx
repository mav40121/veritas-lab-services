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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Search, Zap, FileText, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface InventoryItem {
  id: number;
  item_name: string;
  catalog_number: string | null;
  lot_number: string | null;
  department: string;
  vendor: string | null;
  quantity_on_hand: number;
  unit: string;
  order_unit: string;
  usage_unit: string;
}

const SNAP_UNITS = ["each", "box", "case", "kit", "pack", "bottle", "bag"];

export default function VeritaStockSnapOrderPage() {
  useSEO({
    title: "Snap Order - VeritaStock",
    description: "Generate an emergency manual order PDF, grouped by vendor.",
  });

  const { user, isLoggedIn } = useAuth();
  const readOnly = useIsReadOnly("veritastock");
  const { toast } = useToast();
  const activeLabId = useActiveLabId();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [snap, setSnap] = useState<Record<number, { qty: string; unit: string }>>({});
  const [generating, setGenerating] = useState(false);

  const inventoryListUrl = activeLabId
    ? `${API_BASE}/api/labs/${activeLabId}/inventory`
    : `${API_BASE}/api/inventory`;

  const snapOrderUrl = activeLabId
    ? `${API_BASE}/api/labs/${activeLabId}/inventory/snap-order/pdf`
    : `${API_BASE}/api/inventory/snap-order/pdf`;

  const stockReturnUrl = activeLabId
    ? `/labs/${activeLabId}/veritastock`
    : "/veritastock";

  const hasPlanAccess = user && ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user.plan);

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch(inventoryListUrl, { headers: authHeaders() });
      if (res.ok) setItems(await res.json());
    } catch {}
    finally { setLoading(false); }
  }, [inventoryListUrl]);

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess) loadItems();
    else setLoading(false);
  }, [isLoggedIn, hasPlanAccess, loadItems]);

  const visibleItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.trim().toLowerCase();
    return items.filter((it) =>
      (it.item_name ?? "").toLowerCase().includes(q) ||
      (it.vendor ?? "").toLowerCase().includes(q) ||
      (it.catalog_number ?? "").toLowerCase().includes(q) ||
      (it.department ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  const setQty = (id: number, qty: string, defaultUnit: string) => {
    setSnap((prev) => {
      const next = { ...prev };
      const trimmed = qty.replace(/[^0-9]/g, "");
      if (trimmed === "" || trimmed === "0") {
        delete next[id];
      } else {
        next[id] = { qty: trimmed, unit: prev[id]?.unit || defaultUnit };
      }
      return next;
    });
  };

  const setUnit = (id: number, unit: string) => {
    setSnap((prev) => {
      if (!prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], unit } };
    });
  };

  const orderRows = useMemo(() => {
    return Object.entries(snap)
      .map(([id, v]) => ({ id: Number(id), snap_qty: Number(v.qty), snap_unit: v.unit }))
      .filter((r) => r.snap_qty > 0);
  }, [snap]);

  const totalLines = orderRows.length;
  const totalUnits = orderRows.reduce((s, r) => s + r.snap_qty, 0);

  const generateSnapPdf = async () => {
    if (orderRows.length === 0) {
      toast({ title: "Nothing to order", description: "Enter an Order Qty for at least one item.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch(snapOrderUrl, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ items: orderRows }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Could not generate snap order", description: err.error || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      const { token, totalCount } = await res.json();
      window.open(`${API_BASE}/api/pdf/${token}`, "_blank");
      toast({
        title: `Snap order PDF generated for ${totalCount} item${totalCount === 1 ? "" : "s"}`,
        description: "Review and sign the PDF before sending to vendors.",
      });
    } catch {
      toast({ title: "Could not generate snap order", description: "Network error", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  if (!isLoggedIn || !hasPlanAccess) {
    return (
      <div className="container mx-auto py-12 px-4 max-w-2xl">
        <Card>
          <CardContent className="pt-6 text-center">
            <p>VeritaStock requires a suite subscription.</p>
            <Link href="/pricing"><Button className="mt-4" style={{ backgroundColor: "#01696F" }}>View Plans</Button></Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Link href={stockReturnUrl}>
            <Button variant="outline" size="sm" data-testid="back-to-veritastock">
              <ArrowLeft size={14} className="mr-1.5" />Back to VeritaStock
            </Button>
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: "#92400E" }}>
            <Zap size={22} className="inline-block mr-2 mb-1" />Snap Order
          </h1>
        </div>
        <Button
          size="sm"
          onClick={generateSnapPdf}
          disabled={generating || readOnly || orderRows.length === 0}
          style={{ backgroundColor: "#92400E" }}
          data-testid="generate-snap-order-button"
        >
          <FileText size={14} className="mr-1.5" />
          {generating ? "Generating..." : `Generate Snap Order PDF${totalLines > 0 ? ` (${totalLines})` : ""}`}
        </Button>
      </div>

      {/* Use-case banner */}
      <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 p-3 mb-4">
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-900 dark:text-amber-200">
            <div className="font-semibold">Manual order, bypasses calculated reorder math.</div>
            <div className="text-amber-900/90 dark:text-amber-200/90">
              Use for outbreak surge ordering, supply-chain shocks, or one-off corrections. Enter the Order Qty you want for each item. The PDF groups items by vendor so each vendor section can be sent to its rep.
            </div>
          </div>
        </div>
      </div>

      {/* Search + totals */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search item, vendor, catalog #, department..."
            className="pl-9"
            data-testid="snap-search-input"
          />
        </div>
        <div className="text-sm text-muted-foreground">
          {totalLines === 0
            ? "No items selected yet."
            : `${totalLines} line${totalLines === 1 ? "" : "s"} / ${totalUnits} unit${totalUnits === 1 ? "" : "s"} on this order`}
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading inventory...</div>
          ) : visibleItems.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {items.length === 0 ? "No inventory items yet. Add items in VeritaStock first." : "No items match your search."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Item</th>
                    <th className="text-left px-3 py-2 font-semibold">Vendor</th>
                    <th className="text-left px-3 py-2 font-semibold">Dept</th>
                    <th className="text-right px-3 py-2 font-semibold">On Hand</th>
                    <th className="text-right px-3 py-2 font-semibold">Order Qty</th>
                    <th className="text-left px-3 py-2 font-semibold">Order Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((it, idx) => {
                    const selected = snap[it.id];
                    const defaultUnit = it.order_unit || it.unit || "each";
                    return (
                      <tr
                        key={it.id}
                        className={`border-b ${idx % 2 === 0 ? "" : "bg-muted/20"} ${selected ? "bg-amber-50 dark:bg-amber-900/10" : ""}`}
                        data-testid={`snap-row-${it.id}`}
                      >
                        <td className="px-3 py-2">
                          <div className="font-medium">{it.item_name}</div>
                          {it.catalog_number && <div className="text-xs text-muted-foreground">Cat# {it.catalog_number}</div>}
                        </td>
                        <td className="px-3 py-2">{it.vendor || "-"}</td>
                        <td className="px-3 py-2">{it.department || "-"}</td>
                        <td className="px-3 py-2 text-right font-mono">{it.quantity_on_hand}</td>
                        <td className="px-3 py-2 text-right">
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={selected?.qty ?? ""}
                            onChange={(e) => setQty(it.id, e.target.value, defaultUnit)}
                            placeholder="0"
                            className="w-24 text-right ml-auto"
                            disabled={readOnly}
                            data-testid={`snap-qty-${it.id}`}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            value={selected?.unit ?? defaultUnit}
                            onValueChange={(v) => setUnit(it.id, v)}
                            disabled={!selected || readOnly}
                          >
                            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {SNAP_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sticky-ish footer button (mirrors the top action so a long list doesn't force a scroll back up) */}
      {orderRows.length > 0 && (
        <div className="mt-4 flex justify-end">
          <Button
            onClick={generateSnapPdf}
            disabled={generating || readOnly}
            style={{ backgroundColor: "#92400E" }}
            data-testid="generate-snap-order-button-footer"
          >
            <FileText size={14} className="mr-1.5" />
            {generating ? "Generating..." : `Generate Snap Order PDF (${totalLines})`}
          </Button>
        </div>
      )}
    </div>
  );
}
