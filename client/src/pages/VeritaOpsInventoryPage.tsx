import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
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
import {
  Lock, Plus, Edit2, Trash2, AlertTriangle, Package, Clock, AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface InventoryItem {
  id: number;
  account_id: number;
  item_name: string;
  catalog_number: string | null;
  lot_number: string | null;
  department: string;
  category: string;
  quantity_on_hand: number;
  reorder_point: number;
  unit: string;
  expiration_date: string | null;
  vendor: string | null;
  storage_location: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = ["Reagent", "Control", "Calibrator", "Consumable", "Supply"];
const DEPARTMENTS = ["Core Lab", "Chemistry", "Hematology", "Blood Bank", "Microbiology", "Urinalysis", "Point of Care"];

type SortField = "item_name" | "category" | "lot_number" | "department" | "quantity_on_hand" | "reorder_point" | "expiration_date" | "vendor";
type SortDir = "asc" | "desc";

function getExpirationStatus(expDate: string | null): { label: string; color: string; priority: number } {
  if (!expDate) return { label: "N/A", color: "gray", priority: 5 };
  const now = new Date();
  const exp = new Date(expDate + "T00:00:00");
  const diffMs = exp.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: "Expired", color: "red", priority: 0 };
  if (diffDays <= 30) return { label: "Expires <30d", color: "darkamber", priority: 1 };
  if (diffDays <= 60) return { label: "Expires <60d", color: "amber", priority: 2 };
  if (diffDays <= 90) return { label: "Expires <90d", color: "yellow", priority: 3 };
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

function ItemFormDialog({ open, onClose, onSave, editItem }: {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<InventoryItem>) => void;
  editItem: InventoryItem | null;
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
        reorder_point: 5,
        unit: "each",
        expiration_date: "",
        vendor: "",
        storage_location: "",
        notes: "",
        status: "active",
      });
    }
  }, [editItem, open]);

  const handleSubmit = () => {
    if (!form.item_name?.trim()) return;
    onSave(form);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editItem ? "Edit Item" : "Add Inventory Item"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label>Item Name *</Label>
              <Input value={form.item_name ?? ""} onChange={(e) => setForm({ ...form, item_name: e.target.value })} placeholder="e.g. Troponin I Reagent Pack" />
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
              <Label>Catalog Number</Label>
              <Input value={form.catalog_number ?? ""} onChange={(e) => setForm({ ...form, catalog_number: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Lot Number</Label>
              <Input value={form.lot_number ?? ""} onChange={(e) => setForm({ ...form, lot_number: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Quantity on Hand</Label>
              <Input type="number" min={0} value={form.quantity_on_hand ?? 0} onChange={(e) => setForm({ ...form, quantity_on_hand: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label>Reorder Point</Label>
              <Input type="number" min={0} value={form.reorder_point ?? 5} onChange={(e) => setForm({ ...form, reorder_point: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="space-y-1.5">
              <Label>Unit</Label>
              <Input value={form.unit ?? "each"} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="e.g. pack, kit, box" />
            </div>
            <div className="space-y-1.5">
              <Label>Expiration Date</Label>
              <Input type="date" value={form.expiration_date ?? ""} onChange={(e) => setForm({ ...form, expiration_date: e.target.value || null })} />
            </div>
            <div className="space-y-1.5">
              <Label>Vendor</Label>
              <Input value={form.vendor ?? ""} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Storage Location</Label>
              <Input value={form.storage_location ?? ""} onChange={(e) => setForm({ ...form, storage_location: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label>Notes</Label>
              <Input value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
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

export default function VeritaOpsInventoryPage() {
  const { user, isLoggedIn } = useAuth();
  const readOnly = useIsReadOnly("veritaops");
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

  // Sort
  const [sortField, setSortField] = useState<SortField>("expiration_date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const hasPlanAccess = user && ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user.plan);

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/inventory`, { headers: authHeaders() });
      if (res.ok) setItems(await res.json());
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess) loadItems();
    else setLoading(false);
  }, [isLoggedIn, hasPlanAccess, loadItems]);

  const handleSave = async (data: Partial<InventoryItem>) => {
    const isEdit = !!editItem;
    const url = isEdit ? `${API_BASE}/api/inventory/${editItem!.id}` : `${API_BASE}/api/inventory`;
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
    const now = new Date();
    let expired = 0, expiringSoon = 0, lowStock = 0;
    for (const item of items) {
      if (item.expiration_date) {
        const exp = new Date(item.expiration_date + "T00:00:00");
        const diffDays = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) expired++;
        else if (diffDays <= 30) expiringSoon++;
      }
      if (item.quantity_on_hand <= item.reorder_point) lowStock++;
    }
    return { total: items.length, expired, expiringSoon, lowStock };
  }, [items]);

  // Filtered and sorted items
  const filteredItems = useMemo(() => {
    let result = [...items];

    if (filterDept !== "All") result = result.filter((i) => i.department === filterDept);
    if (filterCat !== "All") result = result.filter((i) => i.category === filterCat);
    if (filterStatus !== "All") {
      const now = new Date();
      result = result.filter((i) => {
        if (filterStatus === "Expired") {
          if (!i.expiration_date) return false;
          return new Date(i.expiration_date + "T00:00:00") < now;
        }
        if (filterStatus === "Expiring Soon") {
          if (!i.expiration_date) return false;
          const diff = Math.ceil((new Date(i.expiration_date + "T00:00:00").getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          return diff >= 0 && diff <= 30;
        }
        if (filterStatus === "Low Stock") return i.quantity_on_hand <= i.reorder_point;
        if (filterStatus === "OK") {
          const notExpired = !i.expiration_date || new Date(i.expiration_date + "T00:00:00") >= now;
          const notExpiringSoon = !i.expiration_date || Math.ceil((new Date(i.expiration_date + "T00:00:00").getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) > 30;
          const notLow = i.quantity_on_hand > i.reorder_point;
          return notExpired && notExpiringSoon && notLow;
        }
        return true;
      });
    }

    result.sort((a, b) => {
      let aVal: any, bVal: any;
      if (sortField === "expiration_date") {
        aVal = a.expiration_date ?? "9999-12-31";
        bVal = b.expiration_date ?? "9999-12-31";
      } else if (sortField === "quantity_on_hand" || sortField === "reorder_point") {
        aVal = a[sortField];
        bVal = b[sortField];
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

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <th
      className="text-left px-3 py-2 font-medium cursor-pointer hover:text-[#01696F] select-none"
      onClick={() => handleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortField === field && <span className="text-xs">{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>}
      </span>
    </th>
  );

  if (!isLoggedIn) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <Lock size={40} className="mx-auto text-muted-foreground mb-4" />
        <h1 className="font-serif text-2xl font-bold mb-2">Inventory Manager</h1>
        <p className="text-muted-foreground">Please log in to access the VeritaOps Inventory Manager.</p>
      </div>
    );
  }

  if (!hasPlanAccess) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <Lock size={40} className="mx-auto text-muted-foreground mb-4" />
        <h1 className="font-serif text-2xl font-bold mb-2">VeritaOps{"\u2122"} Inventory Manager</h1>
        <p className="text-muted-foreground">VeritaOps requires a suite subscription. Upgrade your plan to access inventory management.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold" style={{ color: "#01696F" }}>Inventory Manager</h1>
          <p className="text-sm text-muted-foreground mt-1">Reagent and supply tracking with expiration alerts</p>
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
        <Card className={stats.expired > 0 ? "border-red-300 dark:border-red-800" : ""}>
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
              <AlertCircle size={20} className="text-red-600 dark:text-red-400" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Expired</div>
              <div className="text-2xl font-bold font-mono text-red-600 dark:text-red-400">{stats.expired}</div>
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
        <Card className={stats.lowStock > 0 ? "border-orange-300 dark:border-orange-800" : ""}>
          <CardContent className="pt-5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
              <AlertTriangle size={20} className="text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Low Stock</div>
              <div className="text-2xl font-bold font-mono text-orange-600 dark:text-orange-400">{stats.lowStock}</div>
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
          <SelectTrigger className="w-[170px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="All">All Statuses</SelectItem>
            <SelectItem value="Expired">Expired</SelectItem>
            <SelectItem value="Expiring Soon">Expiring Soon</SelectItem>
            <SelectItem value="Low Stock">Low Stock</SelectItem>
            <SelectItem value="OK">OK</SelectItem>
          </SelectContent>
        </Select>
        {(filterDept !== "All" || filterCat !== "All" || filterStatus !== "All") && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterDept("All"); setFilterCat("All"); setFilterStatus("All"); }}>
            Clear Filters
          </Button>
        )}
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
                <SortHeader field="category">Category</SortHeader>
                <SortHeader field="lot_number">Lot #</SortHeader>
                <SortHeader field="department">Department</SortHeader>
                <SortHeader field="quantity_on_hand">Qty</SortHeader>
                <SortHeader field="reorder_point">Reorder Pt</SortHeader>
                <SortHeader field="expiration_date">Expiration</SortHeader>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <SortHeader field="vendor">Vendor</SortHeader>
                <th className="text-center px-3 py-2 font-medium w-[80px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item, i) => {
                const isLowStock = item.quantity_on_hand <= item.reorder_point;
                return (
                  <tr key={item.id} className={`border-b ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                    <td className="px-3 py-2 font-medium max-w-[250px]">
                      <div>{item.item_name}</div>
                      {item.notes && <div className="text-xs text-muted-foreground truncate max-w-[230px]">{item.notes}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="text-xs">{item.category}</Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{item.lot_number ?? "-"}</td>
                    <td className="px-3 py-2 text-xs">{item.department}</td>
                    <td className="px-3 py-2 text-center font-mono">
                      <span className="inline-flex items-center gap-1">
                        {item.quantity_on_hand}
                        {isLowStock && <AlertTriangle size={12} className="text-orange-500" />}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-muted-foreground">{item.reorder_point}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="text-xs text-muted-foreground">{item.expiration_date ?? ""}</div>
                      <ExpirationBadge expDate={item.expiration_date} />
                    </td>
                    <td className="px-3 py-2">
                      {isLowStock && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                          Low Stock
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{item.vendor ?? "-"}</td>
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
                );
              })}
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
