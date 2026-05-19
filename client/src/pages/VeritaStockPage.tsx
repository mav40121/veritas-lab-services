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
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Lock, Plus, Edit2, Trash2, AlertTriangle, Package, Clock, AlertCircle, RefreshCw,
  ChevronRight, CalendarClock, BellRing, FileSpreadsheet,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { toCsv, downloadCsv, type CsvColumn } from "@/lib/csvExport";

interface InventoryItem {
  id: number;
  account_id: number;
  item_name: string;
  catalog_number: string | null;
  lot_number: string | null;
  department: string;
  category: string;
  quantity_on_hand: number;
  expiration_date: string | null;
  vendor: string | null;
  storage_location: string | null;
  notes: string | null;
  status: string;
  burn_rate: number;
  order_unit: string;
  usage_unit: string;
  units_per_order_unit: number;
  lead_time_days: number;
  safety_stock_days: number;
  desired_days_of_stock: number;
  standing_order: number;
  standing_order_review_date: string | null;
  // Calculated fields from API
  reorder_point: number;
  order_to_qty: number;
  days_remaining: number | null;
  needs_reorder: boolean;
}

const CATEGORIES = ["Reagent", "Control", "Calibrator", "Consumable", "Supply"];
const DEPARTMENTS = ["Core Lab", "Chemistry", "Hematology", "Blood Bank", "Microbiology", "Urinalysis", "Point of Care"];
const ORDER_UNITS = ["each", "box", "case", "kit", "pack", "bottle", "bag"];
const USAGE_UNITS = ["each", "test", "cartridge", "strip", "slide", "tube", "vial", "tip", "glove", "bottle", "mL", "roll", "set"];

type SortField = "item_name" | "category" | "department" | "quantity_on_hand" | "burn_rate" | "reorder_point" | "days_remaining" | "stock_status" | "expiration_date" | "vendor";
type SortDir = "asc" | "desc";

// Per-user column visibility (Pfizer demo follow-up 2026-05-19).
// Item Name and Actions always show; everything else is user-toggleable.
// Hidden columns are persisted as ui_preferences.veritastock_hidden_columns
// (array of these keys) on the user record.
type ToggleableColumnKey =
  | "category"
  | "department"
  | "quantity_on_hand"
  | "burn_rate"
  | "reorder_point"
  | "days_remaining"
  | "stock_status"
  | "expiration_date"
  | "vendor";

const TOGGLEABLE_COLUMNS: { key: ToggleableColumnKey; label: string }[] = [
  { key: "category",           label: "Category" },
  { key: "department",         label: "Dept" },
  { key: "quantity_on_hand",   label: "On Hand" },
  { key: "burn_rate",          label: "Burn Rate" },
  { key: "reorder_point",      label: "Par Level" },
  { key: "days_remaining",     label: "Days Left" },
  { key: "stock_status",       label: "Stock Status" },
  { key: "expiration_date",    label: "Expiration" },
  { key: "vendor",             label: "Vendor" },
];

function getExpirationStatus(expDate: string | null): { label: string; color: string; priority: number } {
  if (!expDate) return { label: "N/A", color: "gray", priority: 5 };
  const now = new Date();
  const exp = new Date(expDate + "T00:00:00");
  const diffMs = exp.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: "Expired", color: "red", priority: 0 };
  if (diffDays <= 30) return { label: "<30d", color: "darkamber", priority: 1 };
  if (diffDays <= 60) return { label: "<60d", color: "amber", priority: 2 };
  if (diffDays <= 90) return { label: "<90d", color: "yellow", priority: 3 };
  return { label: "OK", color: "green", priority: 4 };
}

function ExpirationBadge({ expDate }: { expDate: string | null }) {
  const status = getExpirationStatus(expDate);
  const colorMap: Record<string, string> = {
    red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    darkamber: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    gray: "bg-gray-100 text-gray-600 dark:bg-gray-800/40 dark:text-gray-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorMap[status.color] ?? colorMap.gray}`}>
      {status.label}
    </span>
  );
}

function StockStatusBadge({ item }: { item: InventoryItem }) {
  if (item.needs_reorder) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
        Reorder Now
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
      OK
    </span>
  );
}

function DaysLeftDisplay({ item }: { item: InventoryItem }) {
  if (item.days_remaining === null) return <span className="text-muted-foreground">-</span>;
  const leadTime = item.lead_time_days || 0;
  const safetyBuffer = leadTime + (item.safety_stock_days || 0);
  let colorClass = "text-emerald-600 dark:text-emerald-400";
  if (item.days_remaining <= leadTime) {
    colorClass = "text-red-600 dark:text-red-400 font-bold";
  } else if (item.days_remaining <= safetyBuffer) {
    colorClass = "text-amber-600 dark:text-amber-400 font-semibold";
  }
  return <span className={`font-mono ${colorClass}`}>{item.days_remaining}d</span>;
}

// ── Add/Edit Modal ───────────────────────────────────────────────────────────

// FIFO matches: same item name, on-hand quantity > 0, earlier expiration date,
// not the same record being edited. Compares item_name case-insensitively.
function findOlderLots(
  form: Partial<InventoryItem>,
  inventory: InventoryItem[],
  editId: number | null,
): InventoryItem[] {
  const name = (form.item_name ?? "").trim().toLowerCase();
  const newExp = form.expiration_date ?? "";
  if (!name || !newExp) return [];
  return inventory.filter((it) => {
    if (it.id === editId) return false;
    if ((it.item_name ?? "").trim().toLowerCase() !== name) return false;
    if ((it.quantity_on_hand ?? 0) <= 0) return false;
    if (!it.expiration_date) return false;
    return it.expiration_date < newExp;
  });
}

function ItemFormDialog({ open, onClose, onSave, editItem, inventory }: {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<InventoryItem>) => void;
  editItem: InventoryItem | null;
  inventory: InventoryItem[];
}) {
  const [form, setForm] = useState<Partial<InventoryItem>>({});

  useEffect(() => {
    if (editItem) {
      setForm({ ...editItem });
    } else {
      setForm({
        item_name: "",
        catalog_number: "",
        lot_number: "",
        department: "Core Lab",
        category: "Reagent",
        quantity_on_hand: 0,
        order_unit: "each",
        usage_unit: "each",
        units_per_order_unit: 1,
        burn_rate: 0,
        lead_time_days: 5,
        safety_stock_days: 3,
        desired_days_of_stock: 30,
        standing_order: 0,
        standing_order_review_date: "",
        expiration_date: "",
        vendor: "",
        storage_location: "",
        notes: "",
        status: "active",
      });
    }
  }, [editItem, open]);

  // FIFO banner: when the lab adds a new lot of an item that already has older
  // unexpired stock on hand, prompt the user to open older lots first.
  const olderLots = useMemo(
    () => findOlderLots(form, inventory, editItem?.id ?? null),
    [form.item_name, form.expiration_date, inventory, editItem?.id],
  );

  const handleSubmit = () => {
    if (!form.item_name?.trim()) return;
    onSave(form);
  };

  // Calculated preview
  const burnRate = form.burn_rate || 0;
  const leadTime = form.lead_time_days || 0;
  const safetyDays = form.safety_stock_days || 0;
  const desiredDays = form.desired_days_of_stock || 0;
  const calcReorderPoint = Math.round(burnRate * (leadTime + safetyDays));
  const calcOrderToQty = Math.round(burnRate * desiredDays);
  const usageUnit = form.usage_unit || "each";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editItem ? "Edit Item" : "Add Inventory Item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          {/* FIFO rotation prompt: shown when an older unexpired lot of the
              same item already exists on hand. */}
          {olderLots.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 p-3" data-testid="fifo-banner">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <div className="font-semibold text-amber-900 dark:text-amber-200">FIFO reminder: older lot(s) of {form.item_name} still on hand</div>
                  <ul className="mt-1 space-y-0.5 text-amber-900/90 dark:text-amber-200/90">
                    {olderLots.slice(0, 4).map((lot) => (
                      <li key={lot.id}>
                        Lot {lot.lot_number || "(no lot #)"} expires {lot.expiration_date}, {lot.quantity_on_hand} {lot.usage_unit ?? "unit"}{lot.quantity_on_hand === 1 ? "" : "s"} on hand
                      </li>
                    ))}
                    {olderLots.length > 4 && (
                      <li className="italic">and {olderLots.length - 4} more older lot(s)</li>
                    )}
                  </ul>
                  <div className="mt-1 text-amber-800 dark:text-amber-300">Open older lots first before this new lot.</div>
                </div>
              </div>
            </div>
          )}
          {/* Group 1: Item Details */}
          <div>
            <h4 className="text-sm font-semibold mb-3" style={{ color: "#01696F" }}>Item Details</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Item Name *</Label>
                <Input value={form.item_name ?? ""} onChange={(e) => setForm({ ...form, item_name: e.target.value })} placeholder="e.g. Troponin I Reagent Kit" />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.category ?? "Reagent"} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={form.department ?? "Core Lab"} onValueChange={(v) => setForm({ ...form, department: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Catalog #</Label>
                <Input value={form.catalog_number ?? ""} onChange={(e) => setForm({ ...form, catalog_number: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Lot #</Label>
                <Input value={form.lot_number ?? ""} onChange={(e) => setForm({ ...form, lot_number: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Vendor</Label>
                <Input value={form.vendor ?? ""} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Storage Location</Label>
                <Input value={form.storage_location ?? ""} onChange={(e) => setForm({ ...form, storage_location: e.target.value })} />
              </div>
            </div>
          </div>

          {/* Group 2: Unit Configuration */}
          <div>
            <h4 className="text-sm font-semibold mb-3" style={{ color: "#01696F" }}>Unit Configuration</h4>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Order Unit</Label>
                <Select value={form.order_unit ?? "each"} onValueChange={(v) => setForm({ ...form, order_unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ORDER_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Usage Unit</Label>
                <Select value={form.usage_unit ?? "each"} onValueChange={(v) => setForm({ ...form, usage_unit: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{USAGE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Units per Order Unit</Label>
                <Input type="number" min={1} value={form.units_per_order_unit ?? 1} onChange={(e) => setForm({ ...form, units_per_order_unit: parseInt(e.target.value) || 1 })} />
              </div>
            </div>
          </div>

          {/* Group 3: Consumption & Ordering */}
          <div>
            <h4 className="text-sm font-semibold mb-3" style={{ color: "#01696F" }}>Consumption and Ordering</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Burn Rate ({usageUnit}s/day)</Label>
                <Input type="number" min={0} step={0.5} value={form.burn_rate ?? 0} onChange={(e) => setForm({ ...form, burn_rate: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1.5">
                <Label>Lead Time (days)</Label>
                <Input type="number" min={0} value={form.lead_time_days ?? 5} onChange={(e) => setForm({ ...form, lead_time_days: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1.5">
                <Label>Safety Stock (days)</Label>
                <Input type="number" min={0} value={form.safety_stock_days ?? 3} onChange={(e) => setForm({ ...form, safety_stock_days: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1.5">
                <Label>Desired Days of Stock</Label>
                <Input type="number" min={0} value={form.desired_days_of_stock ?? 30} onChange={(e) => setForm({ ...form, desired_days_of_stock: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
            {/* Calculated preview */}
            {burnRate > 0 && (
              <div className="mt-3 p-3 rounded-lg bg-muted/50 text-sm space-y-1">
                <div>Par Level: <strong>{calcReorderPoint} {usageUnit}s</strong></div>
                <div>Order-to Quantity: <strong>{calcOrderToQty} {usageUnit}s</strong></div>
              </div>
            )}
          </div>

          {/* Group 4: Standing Order */}
          <div>
            <h4 className="text-sm font-semibold mb-3" style={{ color: "#01696F" }}>Standing Order</h4>
            <div className="flex items-center gap-3 mb-3">
              <Switch
                checked={!!form.standing_order}
                onCheckedChange={(v) => setForm({ ...form, standing_order: v ? 1 : 0 })}
              />
              <Label className="cursor-pointer" onClick={() => setForm({ ...form, standing_order: form.standing_order ? 0 : 1 })}>
                This item has a standing order
              </Label>
            </div>
            {!!form.standing_order && (
              <div className="space-y-1.5">
                <Label>Next Review Date</Label>
                <Input type="date" value={form.standing_order_review_date ?? ""} onChange={(e) => setForm({ ...form, standing_order_review_date: e.target.value || null })} />
              </div>
            )}
          </div>

          {/* Group 5: Current Status */}
          <div>
            <h4 className="text-sm font-semibold mb-3" style={{ color: "#01696F" }}>Current Status</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Quantity on Hand ({usageUnit}s)</Label>
                <Input type="number" min={0} value={form.quantity_on_hand ?? 0} onChange={(e) => setForm({ ...form, quantity_on_hand: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="space-y-1.5">
                <Label>Expiration Date</Label>
                <Input type="date" value={form.expiration_date ?? ""} onChange={(e) => setForm({ ...form, expiration_date: e.target.value || null })} />
              </div>
            </div>
          </div>

          {/* Group 6: Notes */}
          <div>
            <h4 className="text-sm font-semibold mb-3" style={{ color: "#01696F" }}>Notes</h4>
            <Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!form.item_name?.trim()} onClick={handleSubmit} style={{ backgroundColor: "#01696F" }}>
              {editItem ? "Save Changes" : "Add Item"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function VeritaStockInventoryPage() {
  const { user, isLoggedIn } = useAuth();
  const readOnly = useIsReadOnly("veritastock");
  const { toast } = useToast();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);

  // Filters
  const [filterDept, setFilterDept] = useState("All");
  const [filterCat, setFilterCat] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");

  // Sort - default: needs_reorder first, then days_remaining ascending
  const [sortField, setSortField] = useState<SortField>("days_remaining");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Per-user column visibility. Default to all-visible; hydrate from the
  // server-side ui_preferences blob on mount. Toggling persists immediately
  // so a refresh restores the user's view. Item Name and Actions are not
  // toggleable here (they are required for the table to be usable at all).
  const [hiddenColumns, setHiddenColumns] = useState<Set<ToggleableColumnKey>>(new Set());

  useEffect(() => {
    if (!isLoggedIn) return;
    fetch(`${API_BASE}/api/account/ui-preferences`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : {}))
      .then((prefs) => {
        const hidden = (prefs && Array.isArray(prefs.veritastock_hidden_columns))
          ? prefs.veritastock_hidden_columns
          : [];
        setHiddenColumns(new Set(hidden));
      })
      .catch(() => { /* default to all-visible on any failure */ });
  }, [isLoggedIn]);

  const persistHiddenColumns = useCallback((next: Set<ToggleableColumnKey>) => {
    fetch(`${API_BASE}/api/account/ui-preferences`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ veritastock_hidden_columns: Array.from(next) }),
    }).catch(() => { /* best-effort; local state already reflects the change */ });
  }, []);

  const toggleColumn = useCallback((key: ToggleableColumnKey) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistHiddenColumns(next);
      return next;
    });
  }, [persistHiddenColumns]);

  const isColumnVisible = (key: ToggleableColumnKey): boolean => !hiddenColumns.has(key);

  const hasPlanAccess = user && ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user.plan);

  // Multi-Lab Tier 2 Phase 3.11b: lab-scope inventory reads/writes.
  const activeLabId = useActiveLabId();
  const inventoryListUrl = activeLabId
    ? `${API_BASE}/api/labs/${activeLabId}/inventory`
    : `${API_BASE}/api/inventory`;

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch(inventoryListUrl, { headers: authHeaders() });
      if (res.ok) setItems(await res.json());
    } catch {} finally { setLoading(false); }
  }, [inventoryListUrl]);

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess) loadItems();
    else setLoading(false);
  }, [isLoggedIn, hasPlanAccess, loadItems]);

  const handleSave = async (data: Partial<InventoryItem>) => {
    const isEdit = !!editItem;
    const url = isEdit ? `${API_BASE}/api/inventory/${editItem!.id}` : inventoryListUrl;
    const method = isEdit ? "PUT" : "POST";
    try {
      const res = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        toast({ title: isEdit ? "Item updated" : "Item added" });
        setShowForm(false);
        setEditItem(null);
        loadItems();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to save item", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`${API_BASE}/api/inventory/${deleteTarget.id}`, { method: "DELETE", headers: authHeaders() });
      if (res.ok) {
        toast({ title: "Item deleted" });
        loadItems();
      }
    } catch {
      toast({ title: "Error", description: "Failed to delete item", variant: "destructive" });
    }
    setDeleteTarget(null);
  };

  // Computed stats
  const stats = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const now = new Date();
    let reorderNow = 0, expiringSoon = 0, standingOrdersDue = 0;
    for (const item of items) {
      if (item.needs_reorder) reorderNow++;
      if (item.expiration_date) {
        const exp = new Date(item.expiration_date + "T00:00:00");
        const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays <= 30) expiringSoon++;
      }
      if (item.standing_order === 1 && item.standing_order_review_date && item.standing_order_review_date < today) {
        standingOrdersDue++;
      }
    }
    return { total: items.length, reorderNow, expiringSoon, standingOrdersDue };
  }, [items]);

  // Filtered and sorted items
  const filteredItems = useMemo(() => {
    let result = [...items];
    const today = new Date().toISOString().split("T")[0];
    const now = new Date();

    if (filterDept !== "All") result = result.filter((i) => i.department === filterDept);
    if (filterCat !== "All") result = result.filter((i) => i.category === filterCat);
    if (filterStatus !== "All") {
      result = result.filter((i) => {
        if (filterStatus === "Reorder Now") return i.needs_reorder;
        if (filterStatus === "Expiring Soon") {
          if (!i.expiration_date) return false;
          const diff = Math.ceil((new Date(i.expiration_date + "T00:00:00").getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          return diff >= 0 && diff <= 30;
        }
        if (filterStatus === "Standing Order Due") {
          return i.standing_order === 1 && i.standing_order_review_date != null && i.standing_order_review_date < today;
        }
        if (filterStatus === "OK") return !i.needs_reorder;
        return true;
      });
    }

    // Sort: needs_reorder first, then by selected field
    result.sort((a, b) => {
      // Primary: needs_reorder items first
      if (a.needs_reorder && !b.needs_reorder) return -1;
      if (!a.needs_reorder && b.needs_reorder) return 1;

      let aVal: any, bVal: any;
      if (sortField === "days_remaining") {
        aVal = a.days_remaining ?? 99999;
        bVal = b.days_remaining ?? 99999;
      } else if (sortField === "expiration_date") {
        aVal = a.expiration_date ?? "9999-12-31";
        bVal = b.expiration_date ?? "9999-12-31";
      } else if (sortField === "quantity_on_hand" || sortField === "reorder_point" || sortField === "burn_rate") {
        aVal = a[sortField] ?? 0;
        bVal = b[sortField] ?? 0;
      } else if (sortField === "stock_status") {
        // Reorder Now (needs_reorder=true) before OK (false) on ascending,
        // matching the show-problems-first intent of the rest of the page.
        aVal = a.needs_reorder ? 0 : 1;
        bVal = b.needs_reorder ? 0 : 1;
      } else {
        aVal = (a[sortField] ?? "").toString().toLowerCase();
        bVal = (b[sortField] ?? "").toString().toLowerCase();
      }
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [items, filterDept, filterCat, filterStatus, sortField, sortDir]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const handleExportCsv = useCallback(() => {
    if (filteredItems.length === 0) {
      toast({ title: "Nothing to export", description: "The filtered inventory list is empty.", variant: "destructive" });
      return;
    }
    const cols: CsvColumn<InventoryItem>[] = [
      { key: "item_name", header: "Item Name" },
      { key: "catalog_number", header: "Catalog #" },
      { key: "lot_number", header: "Lot #" },
      { key: "department", header: "Department" },
      { key: "category", header: "Category" },
      { key: "vendor", header: "Vendor" },
      { key: "storage_location", header: "Storage Location" },
      { key: "quantity_on_hand", header: "Quantity On Hand" },
      { key: "order_unit", header: "Order Unit" },
      { key: "usage_unit", header: "Usage Unit" },
      { key: "units_per_order_unit", header: "Units per Order Unit" },
      { key: "burn_rate", header: "Burn Rate (per day)" },
      { key: "lead_time_days", header: "Lead Time (days)" },
      { key: "safety_stock_days", header: "Safety Stock (days)" },
      { key: "desired_days_of_stock", header: "Desired Days of Stock" },
      { key: "reorder_point", header: "Par Level (calculated)" },
      { key: "order_to_qty", header: "Order-to Quantity" },
      { key: "days_remaining", header: "Days Remaining", format: (r) => (r.days_remaining === null ? "" : r.days_remaining) },
      { key: "needs_reorder", header: "Reorder Now", format: (r) => (r.needs_reorder ? "Yes" : "No") },
      { key: "expiration_date", header: "Expiration Date" },
      { key: "standing_order", header: "Standing Order", format: (r) => (r.standing_order ? "Yes" : "No") },
      { key: "standing_order_review_date", header: "Next Standing Order Review" },
      { key: "status", header: "Status" },
      { key: "notes", header: "Notes" },
    ];
    const csv = toCsv(filteredItems as unknown as Record<string, unknown>[], cols as unknown as CsvColumn<Record<string, unknown>>[]);
    const today = new Date().toISOString().split("T")[0];
    downloadCsv(csv, `VeritaStock_Inventory_${today}.csv`);
  }, [filteredItems, toast]);

  // Sort indicator is shown on every column header at all times so users can
  // see which columns are sortable without having to click each one to find
  // out. Inactive columns get a muted up/down arrow; the active column gets
  // a solid directional arrow.
  const SortHeader = ({ field, children, className }: { field: SortField; children: React.ReactNode; className?: string }) => {
    const isActive = sortField === field;
    return (
      <th
        className={`text-left px-3 py-2 font-medium cursor-pointer hover:text-[#01696F] select-none ${className ?? ""}`}
        onClick={() => handleSort(field)}
      >
        <span className="inline-flex items-center gap-1">
          {children}
          {isActive ? (
            <span className="text-xs text-[#01696F]">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>
          ) : (
            <span className="text-xs text-muted-foreground/40">\u2195</span>
          )}
        </span>
      </th>
    );
  };

  useSEO({ title: "VeritaStock\u2122 | Laboratory Inventory & Reagent Management", description: "Track reagent and supply inventory with burn-rate-aware par levels, lead-time-aware reorder alerts, and expiration tracking. Included with VeritaAssure\u2122 Suite plans." });

  if (!isLoggedIn) {
    return (
      <div>
        {/* Landing Hero for unauthenticated visitors */}
        <section className="border-b border-border bg-primary/5">
          <div className="container-default py-16">
            <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Package size={20} className="text-primary" />
                  <Badge className="bg-primary/10 text-primary border-0">Suite Module</Badge>
                  <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border">Included</Badge>
                </div>
                <h1 className="font-serif text-5xl font-bold mb-3 leading-tight">VeritaStock{"\u2122"}</h1>
                <p className="text-xl text-muted-foreground font-medium mb-5">
                  Laboratory Inventory & Reagent Management
                </p>
                <div className="border-l-4 border-primary pl-4 mb-6">
                  <p className="text-base leading-relaxed italic text-foreground/90">
                    "Stop running out of reagents at the worst possible moment."
                  </p>
                </div>
                <p className="text-muted-foreground leading-relaxed mb-4">
                  VeritaStock{"\u2122"} replaces the spreadsheet your lead tech maintains by hand. Track reagents, controls, calibrators, consumables, and supplies across every department with calculated burn rates, lead-time-aware reorder points, and expiration alerts that fire before you have a problem. Built by a former TJC laboratory surveyor with 200+ facility inspections.
                </p>
                <ul className="space-y-2 mb-6 text-sm">
                  <li className="flex items-start gap-2"><BellRing size={16} className="text-primary mt-0.5 shrink-0" /><span>Color-coded status: Reorder Now, Expiring Soon, OK, Standing Order</span></li>
                  <li className="flex items-start gap-2"><CalendarClock size={16} className="text-primary mt-0.5 shrink-0" /><span>Burn-rate calculated days-on-hand and reorder points based on real lead times</span></li>
                  <li className="flex items-start gap-2"><AlertCircle size={16} className="text-primary mt-0.5 shrink-0" /><span>Expiration tracking with configurable warning windows per item</span></li>
                  <li className="flex items-start gap-2"><RefreshCw size={16} className="text-primary mt-0.5 shrink-0" /><span>Standing order management with quarterly review reminders</span></li>
                </ul>

                {/* Pricing */}
                <div className="flex flex-wrap gap-3 mb-8">
                  <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                    <div className="text-2xl font-bold text-primary">From $499/yr</div>
                    <div className="text-xs text-muted-foreground">Included with VeritaAssure{"\u2122"} Suite</div>
                  </div>
                  <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                    <div className="text-2xl font-bold text-primary">All Plans</div>
                    <div className="text-xs text-muted-foreground">Clinic, Community, Hospital, Enterprise</div>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                    <Link href="/login">Launch VeritaStock{"\u2122"} <ChevronRight size={15} className="ml-1" /></Link>
                  </Button>
                  <Button asChild variant="outline" size="lg">
                    <Link href="/login">Sign In / Create Account</Link>
                  </Button>
                </div>
              </div>

              {/* Right: teal product card */}
              <div className="flex justify-center lg:justify-end">
                <div className="relative">
                  <div className="w-64 h-80 bg-gradient-to-br from-[#0e8a82] to-[#0a5e58] rounded-lg shadow-2xl flex flex-col items-center justify-center p-8 text-white">
                    <Package size={40} className="text-white/80 mb-4" />
                    <div className="font-serif text-3xl font-bold text-center leading-tight mb-3">
                      VeritaStock{"\u2122"}
                    </div>
                    <div className="text-xs text-white/70 text-center space-y-1 mb-4">
                      <div>Reagent & Supply Tracking</div>
                      <div>Burn-Rate Par Levels</div>
                      <div>Expiration Alerts</div>
                      <div>Standing Orders</div>
                      <div>Multi-Department</div>
                    </div>
                    <div className="w-12 h-0.5 bg-white/40 mb-4" />
                    <div className="text-xs text-white/60 text-center">VeritaAssure{"\u2122"} Suite Module</div>
                  </div>
                  <div className="absolute -bottom-2 -right-2 w-64 h-80 bg-black/20 rounded-lg -z-10" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (!hasPlanAccess) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <Lock size={40} className="mx-auto text-muted-foreground mb-4" />
        <h1 className="font-serif text-2xl font-bold mb-2">VeritaStock{"\u2122"} Inventory Manager</h1>
        <p className="text-muted-foreground">VeritaStock™ requires a suite subscription. Upgrade your plan to access inventory management.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold" style={{ color: "#01696F" }}>VeritaStock{"™"}</h1>
          <p className="text-sm text-muted-foreground mt-1">Burn-rate tracking, calculated par levels, and standing order management</p>
        </div>
        <Button size="sm" onClick={() => { setEditItem(null); setShowForm(true); }} disabled={readOnly} style={{ backgroundColor: "#01696F" }}>
          <Plus size={14} className="mr-1.5" />Add Item
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ backgroundColor: "#01696F15" }}>
              <Package size={20} style={{ color: "#01696F" }} />
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Total Items</div>
              <div className="text-2xl font-bold font-mono" style={{ color: "#01696F" }}>{stats.total}</div>
            </div>
          </CardContent>
        </Card>
        <Card className={stats.reorderNow > 0 ? "border-red-300 dark:border-red-800" : ""}>
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
              <AlertCircle size={20} className="text-red-600 dark:text-red-400" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Reorder Now</div>
              <div className="text-2xl font-bold font-mono text-red-600 dark:text-red-400">{stats.reorderNow}</div>
            </div>
          </CardContent>
        </Card>
        <Card className={stats.expiringSoon > 0 ? "border-amber-300 dark:border-amber-800" : ""}>
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <Clock size={20} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Expiring &lt;30d</div>
              <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">{stats.expiringSoon}</div>
            </div>
          </CardContent>
        </Card>
        <Card className={stats.standingOrdersDue > 0 ? "border-amber-300 dark:border-amber-800" : ""}>
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <RefreshCw size={20} className="text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Standing Orders Due</div>
              <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400">{stats.standingOrdersDue}</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap gap-3 mb-4">
        <Select value={filterDept} onValueChange={setFilterDept}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Departments</SelectItem>
            {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Categories</SelectItem>
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            <SelectItem value="Reorder Now">Reorder Now</SelectItem>
            <SelectItem value="Expiring Soon">Expiring Soon</SelectItem>
            <SelectItem value="Standing Order Due">Standing Order Due</SelectItem>
            <SelectItem value="OK">OK</SelectItem>
          </SelectContent>
        </Select>
        {(filterDept !== "All" || filterCat !== "All" || filterStatus !== "All") && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterDept("All"); setFilterCat("All"); setFilterStatus("All"); }}>
            Clear Filters
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto border-primary/30 text-primary hover:bg-primary/10"
          onClick={handleExportCsv}
          data-testid="button-stock-export-csv"
        >
          <FileSpreadsheet size={14} className="mr-1.5" />
          Export CSV
        </Button>
      </div>

      {/* Column visibility panel (Pfizer demo follow-up 2026-05-19).
          Always visible per Louise's preference: the checkboxes sit above
          the table at all times so column control is a one-click action,
          not a hidden-behind-a-button workflow. Selections persist per
          user via /api/account/ui-preferences. Item Name and Actions are
          always shown. */}
      <div className="mb-4 p-3 border rounded-lg bg-card/50">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-muted-foreground">
              Show or hide columns. Your selection is saved to your account.
            </div>
            {hiddenColumns.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setHiddenColumns(new Set());
                  persistHiddenColumns(new Set());
                }}
                data-testid="button-stock-columns-reset"
              >
                Show all
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {TOGGLEABLE_COLUMNS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox
                  checked={!hiddenColumns.has(key)}
                  onCheckedChange={() => toggleColumn(key)}
                  data-testid={`checkbox-stock-column-${key}`}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Loading inventory...</div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-12">
          <Package size={40} className="mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground mb-4">
            {items.length === 0 ? "No inventory items yet. Add your first item to get started." : "No items match the current filters."}
          </p>
          {items.length === 0 && (
            <Button onClick={() => { setEditItem(null); setShowForm(true); }} disabled={readOnly} style={{ backgroundColor: "#01696F" }}>
              <Plus size={14} className="mr-1.5" />Add Item
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ backgroundColor: "#01696F10" }}>
                <SortHeader field="item_name">Item Name</SortHeader>
                {isColumnVisible("category") && <SortHeader field="category">Category</SortHeader>}
                {isColumnVisible("department") && <SortHeader field="department" className="hidden md:table-cell">Dept</SortHeader>}
                {isColumnVisible("quantity_on_hand") && <SortHeader field="quantity_on_hand">On Hand</SortHeader>}
                {isColumnVisible("burn_rate") && <SortHeader field="burn_rate">Burn Rate</SortHeader>}
                {isColumnVisible("reorder_point") && <SortHeader field="reorder_point">Par Level</SortHeader>}
                {isColumnVisible("days_remaining") && <SortHeader field="days_remaining">Days Left</SortHeader>}
                {isColumnVisible("stock_status") && <SortHeader field="stock_status">Stock Status</SortHeader>}
                {isColumnVisible("expiration_date") && <SortHeader field="expiration_date">Expiration</SortHeader>}
                {isColumnVisible("vendor") && <SortHeader field="vendor" className="hidden lg:table-cell">Vendor</SortHeader>}
                <th className="text-center px-3 py-2 font-medium w-[80px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item, i) => (
                <tr key={item.id} className={`border-b ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                  <td className="px-3 py-2 font-medium max-w-[220px]">
                    <div>{item.item_name}</div>
                    <div className="text-xs text-muted-foreground">{item.usage_unit}</div>
                  </td>
                  {isColumnVisible("category") && (
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs">{item.category}</Badge>
                    </td>
                  )}
                  {isColumnVisible("department") && (
                    <td className="px-3 py-2 text-xs hidden md:table-cell">{item.department}</td>
                  )}
                  {isColumnVisible("quantity_on_hand") && (
                    <td className="px-3 py-2 font-mono text-sm">
                      {item.quantity_on_hand.toLocaleString()} <span className="text-xs text-muted-foreground">{item.usage_unit}s</span>
                    </td>
                  )}
                  {isColumnVisible("burn_rate") && (
                    <td className="px-3 py-2 font-mono text-sm">
                      {item.burn_rate > 0 ? `${item.burn_rate}/day` : <span className="text-muted-foreground">-</span>}
                    </td>
                  )}
                  {isColumnVisible("reorder_point") && (
                    <td className="px-3 py-2 font-mono text-sm text-center">{item.reorder_point > 0 ? item.reorder_point.toLocaleString() : <span className="text-muted-foreground">-</span>}</td>
                  )}
                  {isColumnVisible("days_remaining") && (
                    <td className="px-3 py-2 text-center"><DaysLeftDisplay item={item} /></td>
                  )}
                  {isColumnVisible("stock_status") && (
                    <td className="px-3 py-2"><StockStatusBadge item={item} /></td>
                  )}
                  {isColumnVisible("expiration_date") && (
                    <td className="px-3 py-2 whitespace-nowrap">
                      <ExpirationBadge expDate={item.expiration_date} />
                    </td>
                  )}
                  {isColumnVisible("vendor") && (
                    <td className="px-3 py-2 text-xs hidden lg:table-cell">{item.vendor ?? "-"}</td>
                  )}
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditItem(item); setShowForm(true); }} disabled={readOnly}>
                        <Edit2 size={13} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(item)} disabled={readOnly}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Showing count */}
      {filteredItems.length > 0 && (
        <div className="text-xs text-muted-foreground mt-2">
          Showing {filteredItems.length} of {items.length} items
        </div>
      )}

      {/* Add/Edit Dialog */}
      <ItemFormDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditItem(null); }}
        onSave={handleSave}
        editItem={editItem}
        inventory={items}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete item?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `Delete "${deleteTarget.item_name}"? This cannot be undone.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
