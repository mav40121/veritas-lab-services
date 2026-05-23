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
import { Checkbox } from "@/components/ui/checkbox";
import { Lock, Plus, Edit2, Trash2, Calculator, FlaskConical, FileText, GitCompare, X as XIcon } from "lucide-react";
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

// First-run defaults (v1.4). Test archetype templates so a brand-new
// user has a starting point to override rather than staring at a blank
// form. Numbers are typical mid-size hospital community lab; user is
// expected to adjust to their actual operation. These are starting
// scaffolds, not benchmarks.
type ArchetypeKey = "custom" | "chemistry" | "hematology" | "manual_diff" | "sendout";

interface Archetype {
  key: ArchetypeKey;
  label: string;
  description: string;
  defaults: Partial<CprtStudy>;
}

const ARCHETYPES: Archetype[] = [
  {
    key: "custom",
    label: "Custom (blank form)",
    description: "Start with empty fields. Pick this when none of the templates fit.",
    defaults: {},
  },
  {
    key: "chemistry",
    label: "Chemistry, high-volume automated",
    description: "Sodium, Potassium, Glucose, BMP-style analytes on a high-throughput analyzer with daily QC.",
    defaults: {
      department: "Chemistry",
      annual_volume: 50000,
      reagent_cost_per_test: 0.30,
      other_supplies_per_test: 0.05,
      calibrator_kit_cost: 200,
      cals_per_year: 12,
      qc_cost_per_run: 5,
      qc_runs_per_year: 365,
      tech_minutes_per_test: 0.5,
      tech_loaded_hourly_rate: 55,
    },
  },
  {
    key: "hematology",
    label: "Hematology CBC",
    description: "Automated CBC with differential, including result-review time and daily QC.",
    defaults: {
      department: "Hematology",
      annual_volume: 20000,
      reagent_cost_per_test: 1.50,
      other_supplies_per_test: 0.10,
      calibrator_kit_cost: 150,
      cals_per_year: 6,
      qc_cost_per_run: 12,
      qc_runs_per_year: 365,
      tech_minutes_per_test: 1.5,
      tech_loaded_hourly_rate: 55,
    },
  },
  {
    key: "manual_diff",
    label: "Manual differential",
    description: "Manual peripheral smear review. Labor-heavy, minimal consumables, no instrument QC.",
    defaults: {
      department: "Hematology",
      annual_volume: 3000,
      reagent_cost_per_test: 0.20,
      other_supplies_per_test: 0.05,
      calibrator_kit_cost: 0,
      cals_per_year: 0,
      qc_cost_per_run: 0,
      qc_runs_per_year: 0,
      tech_minutes_per_test: 8,
      tech_loaded_hourly_rate: 55,
    },
  },
  {
    key: "sendout",
    label: "Send-out (reference lab)",
    description: "Test referred to outside reference lab. Reagent line carries the reference fee; tech time covers packaging, shipping, result tracking.",
    defaults: {
      department: "Core Lab",
      annual_volume: 500,
      reagent_cost_per_test: 45,
      other_supplies_per_test: 2,
      calibrator_kit_cost: 0,
      cals_per_year: 0,
      qc_cost_per_run: 0,
      qc_runs_per_year: 0,
      tech_minutes_per_test: 3,
      tech_loaded_hourly_rate: 55,
    },
  },
];

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
  // v1.4 template picker only shown when creating new, not editing.
  const [archetype, setArchetype] = useState<ArchetypeKey>("custom");

  useEffect(() => {
    if (editStudy) {
      setForm(editStudy);
      setArchetype("custom");
    } else {
      // Default blank-form starting state for a new study; the user can
      // also pick a template from the Start-from dropdown which fills
      // additional fields on top of this.
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
        include_capital: 0,
        instrument_purchase_cost: 0,
        instrument_useful_life_years: 7,
        annual_maintenance_cost: 0,
        include_overhead: 0,
        overhead_method: "flat",
        overhead_value: 0,
        notes: "",
      });
      setArchetype("custom");
    }
  }, [editStudy, open]);

  // Apply an archetype's defaults to the form. Preserves the user's
  // test_name (so they don't lose what they typed) and the L3/L4 toggle
  // state (those are explicit opt-ins, not part of the archetype scaffold).
  const applyArchetype = useCallback((key: ArchetypeKey) => {
    setArchetype(key);
    const arch = ARCHETYPES.find((a) => a.key === key);
    if (!arch || key === "custom") return;
    setForm((prev) => ({
      ...prev,
      ...arch.defaults,
      // Preserve user-typed test name if they already entered one
      test_name: prev.test_name?.trim() ? prev.test_name : "",
    }));
  }, []);

  // Live local preview of CPRT layers as the user types. Mirrors
  // server/veritaops.ts computeCprt() logic exactly. Server is the
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
    const l2 = l1 + labor;
    let l3 = l2;
    if (Number(form.include_capital || 0) === 1) {
      const life = Math.max(1, Number(form.instrument_useful_life_years || 1));
      const annualDep = Number(form.instrument_purchase_cost || 0) / life;
      const capitalPerTest = amortize(annualDep + Number(form.annual_maintenance_cost || 0));
      l3 = l2 + capitalPerTest;
    }
    let l4 = l3;
    if (Number(form.include_overhead || 0) === 1) {
      const base = Number(form.include_capital || 0) === 1 ? l3 : l2;
      if ((form.overhead_method || "flat") === "markup") {
        l4 = base + base * Number(form.overhead_value || 0);
      } else {
        l4 = base + Number(form.overhead_value || 0);
      }
    }
    return { l1, l2, l3, l4 };
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
          {/* Template picker — only for new studies (v1.4) */}
          {!editStudy && (
            <div className="rounded-lg border p-3" style={{ backgroundColor: "#01696F08" }}>
              <Label className="text-xs">Start from a template (optional)</Label>
              <select
                className="border rounded-md h-9 px-2 text-sm w-full bg-background mt-1"
                value={archetype}
                onChange={(e) => applyArchetype(e.target.value as ArchetypeKey)}
                data-testid="archetype-picker"
              >
                {ARCHETYPES.map((a) => (
                  <option key={a.key} value={a.key}>{a.label}</option>
                ))}
              </select>
              {archetype !== "custom" && (
                <p className="text-xs text-muted-foreground mt-2">
                  {ARCHETYPES.find((a) => a.key === archetype)?.description} You will want to adjust these numbers to match your actual operation.
                </p>
              )}
            </div>
          )}

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

          {/* L3 opt-in: Equipment depreciation */}
          <div className="rounded-lg border p-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={Number(form.include_capital || 0) === 1}
                onCheckedChange={(v) => setField("include_capital", v ? 1 : 0)}
                data-testid="toggle-l3-capital"
              />
              <span className="font-semibold text-sm" style={{ color: "#01696F" }}>L3: Equipment depreciation (opt-in)</span>
            </label>
            <p className="text-xs text-muted-foreground mt-1 ml-6">
              Include the instrument purchase cost spread over its useful life, plus annual maintenance contract. Useful for capital justification and CFO budget defense; usually skipped for marginal-cost questions like insource vs send-out.
            </p>
            {Number(form.include_capital || 0) === 1 && (
              <div className="grid grid-cols-3 gap-3 mt-3 ml-6">
                {numericField("instrument_purchase_cost", "Instrument purchase cost ($)", "1")}
                {numericField("instrument_useful_life_years", "Useful life (years)", "1")}
                {numericField("annual_maintenance_cost", "Annual maintenance ($)", "1")}
              </div>
            )}
          </div>

          {/* L4 opt-in: Overhead */}
          <div className="rounded-lg border p-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={Number(form.include_overhead || 0) === 1}
                onCheckedChange={(v) => setField("include_overhead", v ? 1 : 0)}
                data-testid="toggle-l4-overhead"
              />
              <span className="font-semibold text-sm" style={{ color: "#01696F" }}>L4: Overhead (opt-in)</span>
            </label>
            <p className="text-xs text-muted-foreground mt-1 ml-6">
              Indirect costs: facility, QA, IT, admin. Add as a flat dollar amount per test (from finance) or as a percentage markup on the layer below. Used for fully-loaded charge-master pricing.
            </p>
            {Number(form.include_overhead || 0) === 1 && (
              <div className="grid grid-cols-2 gap-3 mt-3 ml-6">
                <div className="space-y-1.5">
                  <Label className="text-xs">Method</Label>
                  <select
                    className="border rounded-md h-9 px-2 text-sm w-full bg-background"
                    value={form.overhead_method ?? "flat"}
                    onChange={(e) => setField("overhead_method", e.target.value)}
                    data-testid="overhead-method-select"
                  >
                    <option value="flat">Flat dollars per test</option>
                    <option value="markup">Percentage markup on L3 (or L2 if L3 off)</option>
                  </select>
                </div>
                {numericField("overhead_value", form.overhead_method === "markup" ? "Markup (e.g. 0.15 for 15%)" : "Overhead ($/test)")}
              </div>
            )}
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
              {Number(form.include_capital || 0) === 1 && (
                <div>
                  <div className="text-xs text-muted-foreground">+ Equipment (L3)</div>
                  <div className="text-2xl font-bold font-mono" style={{ color: "#01696F" }}>{fmtCurrency(preview.l3)}</div>
                </div>
              )}
              {Number(form.include_overhead || 0) === 1 && (
                <div>
                  <div className="text-xs text-muted-foreground">+ Overhead (L4 - fully loaded)</div>
                  <div className="text-2xl font-bold font-mono" style={{ color: "#01696F" }}>{fmtCurrency(preview.l4)}</div>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Server recalculates on save. The number you should be looking at depends on the question you are answering: marginal cost (L1 or L2), capital justification (L3), charge-master pricing (L4).
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

// Side-by-side comparison of two CPRT studies. Build vs buy, vendor A vs
// vendor B, current cost vs send-out quote, etc. Shows all four layers
// per study, the per-layer delta, and the annual cost gap at each study's
// deepest enabled layer. Cheaper side highlighted; user judges which
// layer is the right comparison ground for their decision.
function ComparisonDialog({
  open, onClose, a, b,
}: {
  open: boolean;
  onClose: () => void;
  a: CprtStudy | null;
  b: CprtStudy | null;
}) {
  if (!a || !b) return null;

  const layers: Array<{ key: keyof CprtStudy; label: string; enabledOn: (s: CprtStudy) => boolean }> = [
    { key: "cprt_l1", label: "L1: Reagents and supplies", enabledOn: () => true },
    { key: "cprt_l2", label: "L2: + Direct labor", enabledOn: () => true },
    { key: "cprt_l3", label: "L3: + Equipment depreciation", enabledOn: (s) => s.include_capital === 1 },
    { key: "cprt_l4", label: "L4: + Overhead", enabledOn: (s) => s.include_overhead === 1 },
  ];

  const deepestOf = (s: CprtStudy): number =>
    s.include_overhead === 1 ? s.cprt_l4
    : s.include_capital === 1 ? s.cprt_l3
    : s.cprt_l2;
  const deepestLabelOf = (s: CprtStudy): string =>
    s.include_overhead === 1 ? "L4"
    : s.include_capital === 1 ? "L3"
    : "L2";

  const aAnnual = a.annual_volume > 0 ? deepestOf(a) * a.annual_volume : null;
  const bAnnual = b.annual_volume > 0 ? deepestOf(b) * b.annual_volume : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Compare: {a.test_name} vs {b.test_name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Identity */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="rounded border p-3">
              <div className="font-semibold" style={{ color: "#01696F" }}>{a.test_name}</div>
              <div className="text-xs text-muted-foreground mt-1">{a.department} &nbsp;|&nbsp; {fmtInt(a.annual_volume)} tests/yr</div>
            </div>
            <div className="rounded border p-3">
              <div className="font-semibold" style={{ color: "#01696F" }}>{b.test_name}</div>
              <div className="text-xs text-muted-foreground mt-1">{b.department} &nbsp;|&nbsp; {fmtInt(b.annual_volume)} tests/yr</div>
            </div>
          </div>

          {/* CPRT layer comparison */}
          <div>
            <h4 className="text-sm font-semibold mb-2" style={{ color: "#01696F" }}>CPRT comparison</h4>
            <table className="w-full text-sm border">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Layer</th>
                  <th className="text-right px-3 py-2 font-semibold">{a.test_name}</th>
                  <th className="text-right px-3 py-2 font-semibold">{b.test_name}</th>
                  <th className="text-right px-3 py-2 font-semibold">Difference</th>
                </tr>
              </thead>
              <tbody>
                {layers.map((layer) => {
                  const aOn = layer.enabledOn(a);
                  const bOn = layer.enabledOn(b);
                  const aVal = aOn ? Number(a[layer.key] || 0) : null;
                  const bVal = bOn ? Number(b[layer.key] || 0) : null;
                  let deltaLabel = "—";
                  let aHighlight = false;
                  let bHighlight = false;
                  if (aVal != null && bVal != null) {
                    const delta = aVal - bVal;
                    deltaLabel = (delta >= 0 ? "+" : "") + fmtCurrency(Math.abs(delta)) + (delta === 0 ? " (equal)" : delta > 0 ? " (B cheaper)" : " (A cheaper)");
                    if (delta > 0) bHighlight = true;
                    else if (delta < 0) aHighlight = true;
                  }
                  return (
                    <tr key={String(layer.key)} className="border-t">
                      <td className="px-3 py-2 font-medium">{layer.label}</td>
                      <td className={`px-3 py-2 text-right font-mono ${aHighlight ? "bg-emerald-50 text-emerald-800 font-semibold" : ""}`}>
                        {aVal != null ? fmtCurrency(aVal) : <span className="text-muted-foreground italic">not enabled</span>}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono ${bHighlight ? "bg-emerald-50 text-emerald-800 font-semibold" : ""}`}>
                        {bVal != null ? fmtCurrency(bVal) : <span className="text-muted-foreground italic">not enabled</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                        {deltaLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Annual cost comparison */}
          <div>
            <h4 className="text-sm font-semibold mb-2" style={{ color: "#01696F" }}>Annual cost at deepest enabled layer</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">
                  {a.test_name} at {deepestLabelOf(a)} × {fmtInt(a.annual_volume)} tests
                </div>
                <div className="text-xl font-bold font-mono" style={{ color: "#01696F" }}>
                  {aAnnual != null ? fmtCurrency(aAnnual) : "—"}
                </div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground">
                  {b.test_name} at {deepestLabelOf(b)} × {fmtInt(b.annual_volume)} tests
                </div>
                <div className="text-xl font-bold font-mono" style={{ color: "#01696F" }}>
                  {bAnnual != null ? fmtCurrency(bAnnual) : "—"}
                </div>
              </div>
            </div>
            {aAnnual != null && bAnnual != null && (
              <div className="mt-3 text-sm">
                <strong>Annual delta:</strong>{" "}
                {fmtCurrency(Math.abs(aAnnual - bAnnual))}{" "}
                {aAnnual === bAnnual ? "(equal)" : aAnnual > bAnnual ? `(${b.test_name} is cheaper annually)` : `(${a.test_name} is cheaper annually)`}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              The comparison is only as honest as the layer match. If one side enables L4 and the other does not, you are comparing fully-loaded against partial. Re-run with matching toggles for an apples-to-apples view.
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
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
  // Side-by-side comparison (v1.3). Limit to exactly 2 selections.
  const [selectedForComparison, setSelectedForComparison] = useState<Set<number>>(new Set());
  const [showComparison, setShowComparison] = useState(false);
  const toggleCompare = (id: number) => {
    setSelectedForComparison((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size >= 2) {
        // Replace the oldest selection; keeps the user moving instead of
        // making them deselect first.
        const first = next.values().next().value as number | undefined;
        if (first !== undefined) next.delete(first);
        next.add(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const comparisonStudies = useMemo(() => {
    const ids = Array.from(selectedForComparison);
    const a = ids[0] != null ? studies.find((s) => s.id === ids[0]) ?? null : null;
    const b = ids[1] != null ? studies.find((s) => s.id === ids[1]) ?? null : null;
    return { a, b };
  }, [selectedForComparison, studies]);

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

  const [generatingPdfId, setGeneratingPdfId] = useState<number | null>(null);
  const handleDownloadPdf = async (study: CprtStudy) => {
    setGeneratingPdfId(study.id);
    try {
      const url = `${itemUrl(study.id)}/pdf`;
      const res = await fetch(url, { method: "POST", headers: authHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "PDF generation failed", description: err.error || `HTTP ${res.status}`, variant: "destructive" });
        return;
      }
      const { token } = await res.json();
      // Open via the shared token endpoint so the browser does the GET
      // download directly (avoids Adobe Acrobat blob-URL hijacking).
      window.open(`${API_BASE}/api/pdf/${token}`, "_blank");
      toast({ title: `PDF generated for ${study.test_name}` });
    } catch {
      toast({ title: "PDF generation failed", description: "Network error", variant: "destructive" });
    } finally {
      setGeneratingPdfId(null);
    }
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
        <div className="flex items-center gap-2">
          {selectedForComparison.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={selectedForComparison.size !== 2}
              onClick={() => setShowComparison(true)}
              title={selectedForComparison.size === 2 ? "Open side-by-side comparison" : "Select exactly 2 studies to compare"}
              data-testid="open-cprt-compare"
            >
              <GitCompare size={14} className="mr-1.5" />
              Compare {selectedForComparison.size}/2
            </Button>
          )}
          {selectedForComparison.size > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelectedForComparison(new Set())} title="Clear comparison selection">
              <XIcon size={14} />
            </Button>
          )}
          <Button size="sm" onClick={() => { setEditStudy(null); setShowForm(true); }} disabled={readOnly} style={{ backgroundColor: "#01696F" }} data-testid="add-cprt-study">
            <Plus size={14} className="mr-1.5" />New CPRT Study
          </Button>
        </div>
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
                    <th className="text-center px-2 py-2 font-semibold w-8" title="Select up to 2 to compare"></th>
                    <th className="text-left px-3 py-2 font-semibold">Test</th>
                    <th className="text-left px-3 py-2 font-semibold">Dept</th>
                    <th className="text-right px-3 py-2 font-semibold">Annual volume</th>
                    <th className="text-right px-3 py-2 font-semibold">L1: Reagents</th>
                    <th className="text-right px-3 py-2 font-semibold">L2: + Labor</th>
                    <th className="text-right px-3 py-2 font-semibold">L3: + Equipment</th>
                    <th className="text-right px-3 py-2 font-semibold">L4: + Overhead</th>
                    <th className="text-right px-3 py-2 font-semibold">Annual cost</th>
                    <th className="text-right px-3 py-2 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {studies.map((s, idx) => {
                    // Annual cost uses the deepest enabled layer so the
                    // total reflects what the user chose to include.
                    const deepest = s.include_overhead === 1 ? s.cprt_l4
                      : s.include_capital === 1 ? s.cprt_l3
                      : s.cprt_l2;
                    return (
                      <tr key={s.id} className={`border-b ${idx % 2 === 0 ? "" : "bg-muted/20"} ${selectedForComparison.has(s.id) ? "bg-emerald-50 dark:bg-emerald-900/10" : ""}`} data-testid={`cprt-row-${s.id}`}>
                        <td className="px-2 py-2 text-center">
                          <Checkbox
                            checked={selectedForComparison.has(s.id)}
                            onCheckedChange={() => toggleCompare(s.id)}
                            data-testid={`compare-checkbox-${s.id}`}
                          />
                        </td>
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
                        <td className="px-3 py-2 text-right font-mono">{fmtCurrency(s.cprt_l2)}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {s.include_capital === 1 ? fmtCurrency(s.cprt_l3) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {s.include_overhead === 1 ? fmtCurrency(s.cprt_l4) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: "#01696F" }}>
                          {s.annual_volume > 0 ? fmtCurrency(deepest * s.annual_volume) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" variant="ghost" onClick={() => handleDownloadPdf(s)} disabled={generatingPdfId !== null} title="Download CPRT report PDF" data-testid={`pdf-cprt-${s.id}`}>
                            <FileText size={14} className={generatingPdfId === s.id ? "animate-pulse" : ""} />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditStudy(s); setShowForm(true); }} disabled={readOnly} data-testid={`edit-cprt-${s.id}`}>
                            <Edit2 size={14} />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(s)} disabled={readOnly} data-testid={`delete-cprt-${s.id}`}>
                            <Trash2 size={14} className="text-red-600" />
                          </Button>
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

      {/* What's coming next */}
      <div className="mt-4 text-xs text-muted-foreground">
        <strong>v1 feature-complete:</strong> all four CPRT layers, PDF export, side-by-side comparison, and starter templates are live. Verify script and additional polish ship in subsequent updates.
      </div>

      <StudyDialog
        open={showForm}
        onClose={() => { setShowForm(false); setEditStudy(null); }}
        onSave={handleSave}
        editStudy={editStudy}
      />

      <ComparisonDialog
        open={showComparison}
        onClose={() => setShowComparison(false)}
        a={comparisonStudies.a}
        b={comparisonStudies.b}
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
