// VeritaOps Cost-Per-Reportable-Test (CPRT) studies. PARKING_LOT #10.
// v1: L1 (reagents + supplies) and L2 (+ direct labor) defaults-on.
// L3 (capital) and L4 (overhead) UI ships in a later PR; the schema and
// server calculation already support them so they can be exposed without
// data migration when v2 lands.
import { useState, useEffect, useCallback, useMemo } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Lock, Plus, Edit2, Trash2, Calculator, FlaskConical } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CprtStudy {
  id: number;
  test_name: string;
  loinc: string | null;
  department: string;
  annual_volume: number;
  reagent_cost_per_test: number;
  calibrator_kit_cost: number;
  cals_per_year: number;
  qc_cost_per_run: number;
  qc_runs_per_year: number;
  other_supplies_per_test: number;
  tech_minutes_per_test: number;
  tech_loaded_hourly_rate: number;
  include_capital: number;
  instrument_purchase_cost: number;
  instrument_useful_life_years: number;
  annual_maintenance_cost: number;
  include_overhead: number;
  overhead_method: string;
  overhead_value: number;
  cprt_l1: number;
  cprt_l2: number;
  cprt_l3: number;
  cprt_l4: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const DEPARTMENTS = ["Core Lab", "Chemistry", "Hematology", "Blood Bank", "Microbiology", "Urinalysis", "Point of Care", "Molecular"];

function fmtCurrency(n: number | null | undefined): string {
  const v = Number(n || 0);
  return v.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtInt(n: number | null | undefined): string {
  return Number(n || 0).toLocaleString();
}

function StudyDialog({
  open, onClose, onSave, editStudy,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: Partial<CprtStudy>) => void;
  editStudy: CprtStudy | null;
}) {
  const [form, setForm] = useState<Partial<CprtStudy>>({});

  useEffect(() => {
    if (editStudy) {
      setForm(editStudy);
    } else {
      setForm({
        test_name: "",
        department: "Core Lab",
        annual_volume: 0,
        reagent_cost_per_test: 0,
        calibrator_kit_cost: 0,
        cals_per_year: 0,
        qc_cost_per_run: 0,
        qc_runs_per_year: 0,
        other_supplies_per_test: 0,
        tech_minutes_per_test: 0,
        tech_loaded_hourly_rate: 0,
        notes: "",
      });
    }
  }, [editStudy, open]);

  // Live local preview of CPRT L1 and L2 as the user types. Server is the
  // authoritative calculator on save; this just gives instant feedback.
  const preview = useMemo(() => {
    const v = Number(form.annual_volume || 0);
    const amortize = (n: number) => v > 0 ? n / v : 0;
    const l1 =
      Number(form.reagent_cost_per_test || 0) +
      amortize(Number(form.calibrator_kit_cost || 0) * Number(form.cals_per_year || 0)) +
      amortize(Number(form.qc_cost_per_run || 0) * Number(form.qc_runs_per_year || 0)) +
      Number(form.other_supplies_per_test || 0);
    const labor = (Number(form.tech_minutes_per_test || 0) / 60) * Number(form.tech_loaded_hourly_rate || 0);
    return { l1, l2: l1 + labor };
  }, [form]);

  const setField = (k: keyof CprtStudy, v: any) => setForm((prev) => ({ ...prev, [k]: v }));

  const numericField = (k: keyof CprtStudy, label: string, step: string = "0.01") => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step={step}
        value={(form[k] as any) ?? 0}
        onChange={(e) => setField(k, e.target.value === "" ? 0 : Number(e.target.value))}
      />
    </div>
  );

  const handleSubmit = () => {
    if (!form.test_name?.trim()) return;
    onSave(form);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editStudy ? `Edit: ${editStudy.test_name}` : "New CPRT Study"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {/* Identity */}
          <div>
            <h4 className="text-sm font-semibold mb-3" style={{ color: "#01696F" }}>Test identity</h4>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label>Test name *</Label>
                <Input value={form.test_name ?? ""} onChange={(e) => setField("test_name", e.target.value)} placeholder="e.g. Sodium" />
              </div>
              <div className="space-y-1.5">
                <Label>LOINC</Label>
                <Input value={form.loinc ?? ""} onChange={(e) => setField("loinc", e.target.value)} placeholder="optional" />
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <select
                  className="border rounded-md h-9 px-2 text-sm w-full bg-background"
                  value={form.department ?? "Core Lab"}
                  onChange={(e) => setField("department", e.target.value)}
                >
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Annual volume (tests/year)</Label>
                <Input
                  type="number"
                  step="1"
                  value={form.annual_volume ?? 0}
                  onChange={(e) => setField("annual_volume", e.target.value === "" ? 0 : Number(e.target.value))}
                />
              </div>
            </div>
          </div>

          {/* L1 inputs */}
          <div>
            <h4 className="text-sm font-semibold mb-3" style={{ color: "#01696F" }}>L1: Reagents and supplies</h4>
            <div className="grid grid-cols-2 gap-3">
              {numericField("reagent_cost_per_test", "Reagent cost per test ($)")}
              {numericField("other_supplies_per_test", "Other supplies per test ($)")}
              {numericField("calibrator_kit_cost", "Calibrator kit cost ($)")}
              {numericField("cals_per_year", "Calibrations per year", "1")}
              {numericField("qc_cost_per_run", "QC cost per run, all levels ($)")}
              {numericField("qc_runs_per_year", "QC runs per year", "1")}
            </div>
          </div>

          {/* L2 inputs */}
          <div>
            <h4 className="text-sm font-semibold mb-3" style={{ color: "#01696F" }}>L2: Direct labor</h4>
            <div className="grid grid-cols-2 gap-3">
              {numericField("tech_minutes_per_test", "Tech minutes per test")}
              {numericField("tech_loaded_hourly_rate", "Tech loaded hourly rate ($)")}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Loaded rate = base wage + benefits + overhead allocation. Industry typical is 1.3 to 1.4 times base hourly.
            </p>
          </div>

          {/* Live preview */}
          <div className="rounded-lg border p-4" style={{ backgroundColor: "#01696F10", borderColor: "#01696F40" }}>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Live preview</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Reagents and supplies (L1)</div>
                <div className="text-2xl font-bold font-mono" style={{ color: "#01696F" }}>{fmtCurrency(preview.l1)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">+ Staff time (L2)</div>
                <div className="text-2xl font-bold font-mono" style={{ color: "#01696F" }}>{fmtCurrency(preview.l2)}</div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Server recalculates on save. Equipment depreciation (L3) and overhead (L4) layers are present in the data model but the UI for them lands in a follow-up.
            </p>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea value={form.notes ?? ""} onChange={(e) => setField("notes", e.target.value)} rows={3} placeholder="Source of figures, assumptions, dates..." />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={!form.test_name?.trim()} onClick={handleSubmit} style={{ backgroundColor: "#01696F" }}>
              {editStudy ? "Save Changes" : "Create Study"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function VeritaOpsAppPage() {
  useSEO({
    title: "VeritaOps - Cost Per Reportable Test (CPRT)",
    description: "Layered cost-per-reportable-test calculator for clinical laboratories. CLSI GP11-A aligned.",
  });

  const { user, isLoggedIn } = useAuth();
  const readOnly = useIsReadOnly("veritaops");
  const { toast } = useToast();
  const activeLabId = useActiveLabId();

  const [studies, setStudies] = useState<CprtStudy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editStudy, setEditStudy] = useState<CprtStudy | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CprtStudy | null>(null);

  const hasPlanAccess = user && ["annual", "professional", "lab", "complete", "waived", "community", "hospital", "large_hospital", "enterprise"].includes(user.plan);

  const listUrl = activeLabId
    ? `${API_BASE}/api/labs/${activeLabId}/veritaops/studies`
    : `${API_BASE}/api/veritaops/studies`;

  const itemUrl = (id: number) => activeLabId
    ? `${API_BASE}/api/labs/${activeLabId}/veritaops/studies/${id}`
    : `${API_BASE}/api/veritaops/studies/${id}`;

  const loadStudies = useCallback(async () => {
    try {
      const res = await fetch(listUrl, { headers: authHeaders() });
      if (res.ok) setStudies(await res.json());
    } catch {} finally { setLoading(false); }
  }, [listUrl]);

  useEffect(() => {
    if (isLoggedIn && hasPlanAccess) loadStudies();
    else setLoading(false);
  }, [isLoggedIn, hasPlanAccess, loadStudies]);

  const handleSave = async (data: Partial<CprtStudy>) => {
    const isEdit = !!editStudy;
    const url = isEdit ? itemUrl(editStudy!.id) : listUrl;
    const method = isEdit ? "PUT" : "POST";
    try {
      const res = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        toast({ title: isEdit ? "Study updated" : "Study created" });
        setShowForm(false);
        setEditStudy(null);
        loadStudies();
      } else {
        const err = await res.json();
        toast({ title: "Error", description: err.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to save study", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(itemUrl(deleteTarget.id), { method: "DELETE", headers: authHeaders() });
      if (res.ok) {
        toast({ title: "Study deleted" });
        loadStudies();
      }
    } catch {} finally { setDeleteTarget(null); }
  };

  if (!isLoggedIn) {
    return (
      <div className="container mx-auto py-20 px-4 text-center">
        <Lock size={40} className="text-muted-foreground mx-auto mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">Sign in to use VeritaOps</h2>
        <p className="text-muted-foreground">Cost-per-reportable-test studies for your lab menu.</p>
      </div>
    );
  }
  if (!hasPlanAccess) {
    return (
      <div className="container mx-auto py-20 px-4 text-center">
        <Lock size={40} className="text-muted-foreground mx-auto mb-4" />
        <h2 className="font-serif text-2xl font-bold mb-2">VeritaOps requires a paid plan</h2>
        <p className="text-muted-foreground">Upgrade your subscription to use cost-per-test analysis.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl font-bold" style={{ color: "#01696F" }}>VeritaOps{"™"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cost per reportable test (CPRT) studies. Built on CLSI GP11-A cost accounting principles.
          </p>
        </div>
        <Button size="sm" onClick={() => { setEditStudy(null); setShowForm(true); }} disabled={readOnly} style={{ backgroundColor: "#01696F" }} data-testid="add-cprt-study">
          <Plus size={14} className="mr-1.5" />New CPRT Study
        </Button>
      </div>

      {/* Empty / loading / table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Loading studies...</div>
          ) : studies.length === 0 ? (
            <div className="p-12 text-center">
              <Calculator size={40} className="text-muted-foreground mx-auto mb-4" />
              <div className="text-lg font-semibold mb-2">No CPRT studies yet</div>
              <p className="text-sm text-muted-foreground mb-4">Create your first study to calculate cost per reportable test on any assay.</p>
              <Button onClick={() => { setEditStudy(null); setShowForm(true); }} disabled={readOnly} style={{ backgroundColor: "#01696F" }}>
                <Plus size={14} className="mr-1.5" />Start your first study
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Test</th>
                    <th className="text-left px-3 py-2 font-semibold">Dept</th>
                    <th className="text-right px-3 py-2 font-semibold">Annual volume</th>
                    <th className="text-right px-3 py-2 font-semibold">L1: Reagents</th>
                    <th className="text-right px-3 py-2 font-semibold">L2: + Labor</th>
                    <th className="text-right px-3 py-2 font-semibold">Annual L2 cost</th>
                    <th className="text-right px-3 py-2 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {studies.map((s, idx) => (
                    <tr key={s.id} className={`border-b ${idx % 2 === 0 ? "" : "bg-muted/20"}`} data-testid={`cprt-row-${s.id}`}>
                      <td className="px-3 py-2">
                        <div className="font-medium flex items-center gap-2">
                          <FlaskConical size={14} className="text-muted-foreground" />
                          {s.test_name}
                        </div>
                        {s.loinc && <div className="text-xs text-muted-foreground">LOINC {s.loinc}</div>}
                      </td>
                      <td className="px-3 py-2">{s.department}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtInt(s.annual_volume)}</td>
                      <td className="px-3 py-2 text-right font-mono">{fmtCurrency(s.cprt_l1)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: "#01696F" }}>{fmtCurrency(s.cprt_l2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {s.annual_volume > 0 ? fmtCurrency(s.cprt_l2 * s.annual_volume) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => { setEditStudy(s); setShowForm(true); }} disabled={readOnly} data-testid={`edit-cprt-${s.id}`}>
                          <Edit2 size={14} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(s)} disabled={readOnly} data-testid={`delete-cprt-${s.id}`}>
                          <Trash2 size={14} className="text-red-600" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* What's coming next */}
      <div className="mt-4 text-xs text-muted-foreground">
        <strong>v1 ships L1 + L2.</strong> Equipment depreciation (L3) and overhead (L4) layers, PDF export, side-by-side study comparison, and pre-filled defaults based on published cost-mix benchmarks ship in subsequent updates.
      </div>

      <StudyDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditStudy(null); }}
        onSave={handleSave}
        editStudy={editStudy}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete study?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && `This permanently deletes the CPRT study for "${deleteTarget.test_name}". This cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
