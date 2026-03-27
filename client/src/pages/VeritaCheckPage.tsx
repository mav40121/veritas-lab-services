import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useSearch, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PlusCircle, Trash2, FlaskConical, CheckCircle2, DollarSign, Loader2, XCircle, LayoutDashboard, BookOpen, ChevronRight } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { calculateStudy, calculatePrecision, type DataPoint, type PrecisionDataPoint } from "@/lib/calculations";
import { useAuth } from "@/components/AuthContext";
import { authHeaders } from "@/lib/auth";
import type { InsertStudy } from "@shared/schema";

const API_BASE = "https://www.veritaslabservices.com";

// CLIA 2025 Proficiency Testing Acceptance Limits (42 CFR Part 493 Subpart I)
const CLIA_PRESETS = [
  // ── Routine Chemistry §493.931 ──────────────────────────────────────────
  { label: "ALT/SGPT (±15% or ±6 U/L)",              value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Albumin (±8%)",                            value: 0.08,  cfr: "42 CFR §493.931" },
  { label: "Alkaline Phosphatase (±20%)",              value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "Amylase (±20%)",                           value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "AST (±15% or ±6 U/L)",                    value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Bilirubin, Total (±20% or ±0.4 mg/dL)",   value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "BNP (±30%)",                               value: 0.30,  cfr: "42 CFR §493.931" },
  { label: "proBNP (±30%)",                            value: 0.30,  cfr: "42 CFR §493.931" },
  { label: "Blood Gas pCO2 (±8%)",                     value: 0.08,  cfr: "42 CFR §493.931" },
  { label: "Blood Gas pO2 (±15%)",                     value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Blood Gas pH (±0.04)",                     value: 0.04,  cfr: "42 CFR §493.931" },
  { label: "Calcium, Total (±1.0 mg/dL)",              value: 0.10,  cfr: "42 CFR §493.931" },
  { label: "Carbon Dioxide (±20%)",                    value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "Chloride (±5%)",                           value: 0.05,  cfr: "42 CFR §493.931" },
  { label: "Cholesterol, Total (±10%)",                value: 0.10,  cfr: "42 CFR §493.931" },
  { label: "Cholesterol, HDL (±20% or ±6 mg/dL)",     value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "Cholesterol, LDL Direct (±20%)",           value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "CK (±20%)",                                value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "CK-MB (±25% or ±3 ng/mL)",                value: 0.25,  cfr: "42 CFR §493.931" },
  { label: "Creatinine (±10% or ±0.2 mg/dL)",         value: 0.10,  cfr: "42 CFR §493.931" },
  { label: "Ferritin (±20%)",                          value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "GGT (±15% or ±5 U/L)",                    value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Glucose (±8% or ±6 mg/dL)",               value: 0.08,  cfr: "42 CFR §493.931" },
  { label: "Hemoglobin A1c (±8%)",                     value: 0.08,  cfr: "42 CFR §493.931" },
  { label: "Iron, Total (±15%)",                       value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "LDH (±15%)",                               value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Magnesium (±15%)",                         value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Phosphorus (±10% or ±0.3 mg/dL)",         value: 0.10,  cfr: "42 CFR §493.931" },
  { label: "Potassium (±0.3 mmol/L)",                  value: 0.05,  cfr: "42 CFR §493.931" },
  { label: "PSA, Total (±20% or ±0.2 ng/mL)",         value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "Sodium (±4 mmol/L)",                       value: 0.04,  cfr: "42 CFR §493.931" },
  { label: "TIBC Direct (±20%)",                       value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "Total Protein (±8%)",                      value: 0.08,  cfr: "42 CFR §493.931" },
  { label: "Triglycerides (±15%)",                     value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Troponin I (±30% or ±0.9 ng/mL)",         value: 0.30,  cfr: "42 CFR §493.931" },
  { label: "Troponin T (±30% or ±0.2 ng/mL)",         value: 0.30,  cfr: "42 CFR §493.931" },
  { label: "Urea Nitrogen/BUN (±9% or ±2 mg/dL)",     value: 0.09,  cfr: "42 CFR §493.931" },
  { label: "Uric Acid (±10%)",                         value: 0.10,  cfr: "42 CFR §493.931" },
  // ── Endocrinology §493.933 ───────────────────────────────────────────────
  { label: "CA-125 (±20%)",                            value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "CEA (±15% or ±1 ng/dL)",                  value: 0.15,  cfr: "42 CFR §493.933" },
  { label: "Cortisol (±20%)",                          value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "Estradiol (±30%)",                         value: 0.30,  cfr: "42 CFR §493.933" },
  { label: "Folate, Serum (±30% or ±1 ng/mL)",        value: 0.30,  cfr: "42 CFR §493.933" },
  { label: "FSH (±18% or ±2 IU/L)",                   value: 0.18,  cfr: "42 CFR §493.933" },
  { label: "Free T4 (±15% or ±0.3 ng/dL)",            value: 0.15,  cfr: "42 CFR §493.933" },
  { label: "hCG (±18% or ±3 mIU/mL)",                 value: 0.18,  cfr: "42 CFR §493.933" },
  { label: "LH (±20%)",                                value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "Parathyroid Hormone (±30%)",               value: 0.30,  cfr: "42 CFR §493.933" },
  { label: "Progesterone (±25%)",                      value: 0.25,  cfr: "42 CFR §493.933" },
  { label: "Prolactin (±20%)",                         value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "Testosterone (±30% or ±20 ng/dL)",        value: 0.30,  cfr: "42 CFR §493.933" },
  { label: "T3 Uptake (±18%)",                         value: 0.18,  cfr: "42 CFR §493.933" },
  { label: "T3, Total (±30%)",                         value: 0.30,  cfr: "42 CFR §493.933" },
  { label: "TSH (±20% or ±0.2 mIU/L)",                value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "T4, Thyroxine (±20% or ±1.0 mcg/dL)",    value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "Vitamin B12 (±25% or ±30 pg/mL)",         value: 0.25,  cfr: "42 CFR §493.933" },
  // ── Toxicology §493.935 ──────────────────────────────────────────────────
  { label: "Acetaminophen (±15% or ±3 mcg/mL)",       value: 0.15,  cfr: "42 CFR §493.935" },
  { label: "Alcohol, Blood (±20%)",                    value: 0.20,  cfr: "42 CFR §493.935" },
  { label: "Blood Lead (±10% or ±2 mcg/dL)",          value: 0.10,  cfr: "42 CFR §493.935" },
  { label: "Carbamazepine (±20% or ±1.0 mcg/mL)",     value: 0.20,  cfr: "42 CFR §493.935" },
  { label: "Digoxin (±15% or ±0.2 ng/mL)",            value: 0.15,  cfr: "42 CFR §493.935" },
  { label: "Gentamicin (±25%)",                        value: 0.25,  cfr: "42 CFR §493.935" },
  { label: "Lithium (±15% or ±0.3 mmol/L)",           value: 0.15,  cfr: "42 CFR §493.935" },
  { label: "Phenobarbital (±15% or ±2 mcg/mL)",       value: 0.15,  cfr: "42 CFR §493.935" },
  { label: "Phenytoin (±15% or ±2 mcg/mL)",           value: 0.15,  cfr: "42 CFR §493.935" },
  { label: "Salicylate (±15% or ±2 mcg/mL)",          value: 0.15,  cfr: "42 CFR §493.935" },
  { label: "Theophylline (±20%)",                      value: 0.20,  cfr: "42 CFR §493.935" },
  // ── Hematology §493.941 ──────────────────────────────────────────────────
  { label: "Erythrocyte Count / RBC (±4%)",            value: 0.04,  cfr: "42 CFR §493.941" },
  { label: "Fibrinogen (±20%)",                        value: 0.20,  cfr: "42 CFR §493.941" },
  { label: "Hematocrit (±4%)",                         value: 0.04,  cfr: "42 CFR §493.941" },
  { label: "Hemoglobin (±4%)",                         value: 0.04,  cfr: "42 CFR §493.941" },
  { label: "Leukocyte Count / WBC (±10%)",             value: 0.10,  cfr: "42 CFR §493.941" },
  { label: "Partial Thromboplastin Time (±15%)",       value: 0.15,  cfr: "42 CFR §493.941" },
  { label: "Platelet Count (±25%)",                    value: 0.25,  cfr: "42 CFR §493.941" },
  { label: "Prothrombin Time / PT (±15%)",             value: 0.15,  cfr: "42 CFR §493.941" },
  // ── Custom ───────────────────────────────────────────────────────────────
  { label: "Custom", value: 0, cfr: "" },
];
const MIN_LEVELS = 3;
const MAX_LEVELS = 40;
const DEFAULT_LEVELS = 10;

function makeEmptyPoints(instruments: string[], count: number): DataPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    level: i + 1,
    expectedValue: null,
    instrumentValues: Object.fromEntries(instruments.map(n => [n, null])),
  }));
}

function resizeDataPoints(prev: DataPoint[], instruments: string[], newCount: number): DataPoint[] {
  if (newCount > prev.length) {
    // Add empty rows at the end
    const extras = Array.from({ length: newCount - prev.length }, (_, i) => ({
      level: prev.length + i + 1,
      expectedValue: null,
      instrumentValues: Object.fromEntries(instruments.map(n => [n, null])),
    }));
    return [...prev, ...extras];
  }
  // Trim rows from the end, renumber
  return prev.slice(0, newCount).map((dp, i) => ({ ...dp, level: i + 1 }));
}

const plans = [
  { priceType: "perStudy", name: "Per Study",       price: "$9",   unit: "per report", description: "Pay only when you need a study.",                     features: ["Single study run", "Full PDF report", "Cal Ver + Method Comparison", "CLIA pass/fail evaluation"],                                                         cta: "Buy a Study",             highlight: false, badge: null },
  { priceType: "annual",   name: "Individual",      price: "$149", unit: "per year",   description: "Unlimited studies for one analyst.",                 features: ["Unlimited studies", "All PDF reports", "Multi-instrument comparison", "Study history dashboard", "Priority support"],                                  cta: "Subscribe",               highlight: false, badge: null },
  { priceType: "lab",      name: "Lab Account",     price: "$499", unit: "per year",   description: "Unlimited studies for your entire lab — up to 5 analysts.", features: ["Everything in Individual", "Up to 5 analyst accounts", "Shared study dashboard", "All PDF reports", "Priority support", "Best value for labs"], cta: "Subscribe — Best Value",   highlight: true,  badge: "Best Value" },
];

export default function VeritaCheckPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { isLoggedIn } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"success" | "cancelled" | null>(null);

  // Check URL params for payment result after Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(search);
    const payment = params.get("payment");
    if (payment === "success") {
      setPaymentStatus("success");
      // Refresh user data to pick up new plan/credits
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } else if (payment === "cancelled") {
      setPaymentStatus("cancelled");
    }
  }, [search]);

  const handleBuy = async (priceType: "perStudy" | "annual" | "lab") => {
    if (!isLoggedIn) {
      toast({ title: "Sign in required", description: "Please create a free account to purchase.", variant: "destructive" });
      navigate("/login");
      return;
    }
    setCheckoutLoading(priceType);
    try {
      const res = await fetch(`${API_BASE}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ priceType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Checkout failed");
      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } catch (err: any) {
      toast({ title: "Payment error", description: err.message, variant: "destructive" });
      setCheckoutLoading(null);
    }
  };

  const [testName, setTestName] = useState("");
  const [analyst, setAnalyst] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [studyType, setStudyType] = useState<"cal_ver" | "method_comparison" | "precision">("cal_ver");
  const [instrumentNames, setInstrumentNames] = useState<string[]>(["Instrument 1", "Instrument 2"]);
  const [cliaPreset, setCliaPreset] = useState(0);
  const [customClia, setCustomClia] = useState(0.075);
  const [numLevels, setNumLevels] = useState(DEFAULT_LEVELS);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>(makeEmptyPoints(["Instrument 1", "Instrument 2"], DEFAULT_LEVELS));

  // Precision study state
  const [precisionMode, setPrecisionMode] = useState<"simple" | "advanced">("simple");
  const [precisionLevels, setPrecisionLevels] = useState(2);
  const [precisionLevelNames, setPrecisionLevelNames] = useState<string[]>(["Level 1 (Low)", "Level 2 (High)", "Level 3 (Mid)"]);
  const [precisionValues, setPrecisionValues] = useState<number[][]>([[], [], []]);
  const [precisionReps, setPrecisionReps] = useState(20);
  // Advanced mode
  const [precisionDays, setPrecisionDays] = useState(5);
  const [precisionRunsPerDay, setPrecisionRunsPerDay] = useState(1);
  const [precisionReplicatesPerRun, setPrecisionReplicatesPerRun] = useState(2);
  const [precisionAdvancedData, setPrecisionAdvancedData] = useState<number[][][]>([[], [], []]);

  const handleNumLevelsChange = (val: string) => {
    const n = parseInt(val);
    setNumLevels(n);
    setDataPoints(prev => resizeDataPoints(prev, instrumentNames, n));
  };

  // Ref map: gridRefs[row][col] → the actual <input> DOM element
  const gridRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const setGridRef = useCallback((row: number, col: number) => (el: HTMLInputElement | null) => {
    const key = `${row}-${col}`;
    if (el) gridRefs.current.set(key, el);
    else gridRefs.current.delete(key);
  }, []);

  const cliaValue = CLIA_PRESETS[cliaPreset].value !== 0 ? CLIA_PRESETS[cliaPreset].value : customClia;

  const handleGridKeyDown = (e: React.KeyboardEvent, row: number, col: number) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    e.stopPropagation();
    const numRows = dataPoints.length;
    const numCols = instrumentNames.length + 1; // +1 for Expected
    let nextRow = row;
    let nextCol = col;
    if (e.shiftKey) {
      // Shift+Tab: go up
      nextRow = row - 1;
      if (nextRow < 0) { nextRow = numRows - 1; nextCol = col - 1; }
      if (nextCol < 0) return; // exit grid
    } else {
      // Tab: go down
      nextRow = row + 1;
      if (nextRow >= numRows) { nextRow = 0; nextCol = col + 1; }
      if (nextCol >= numCols) return; // exit grid
    }
    const next = gridRefs.current.get(`${nextRow}-${nextCol}`);
    next?.focus();
  };

  const updateInstrumentName = (idx: number, name: string) => {
    const oldName = instrumentNames[idx];
    const newNames = [...instrumentNames]; newNames[idx] = name; setInstrumentNames(newNames);
    setDataPoints(prev => prev.map(dp => { const vals = { ...dp.instrumentValues }; vals[name] = vals[oldName] ?? null; delete vals[oldName]; return { ...dp, instrumentValues: vals }; }));
  };

  const addInstrument = () => {
    if (instrumentNames.length >= 3) { toast({ title: "Maximum 3 instruments supported" }); return; }
    const newName = `Instrument ${instrumentNames.length + 1}`;
    setInstrumentNames([...instrumentNames, newName]);
    setDataPoints(prev => prev.map(dp => ({ ...dp, instrumentValues: { ...dp.instrumentValues, [newName]: null } })));
  };

  const addLevel = () => {
    if (dataPoints.length >= MAX_LEVELS) return;
    const n = dataPoints.length + 1;
    setNumLevels(n);
    setDataPoints(prev => [...prev, { level: n, expectedValue: null, instrumentValues: Object.fromEntries(instrumentNames.map(name => [name, null])) }]);
  };

  const removeLastLevel = () => {
    if (dataPoints.length <= MIN_LEVELS) return;
    const n = dataPoints.length - 1;
    setNumLevels(n);
    setDataPoints(prev => prev.slice(0, n));
  };

  const removeInstrument = (idx: number) => {
    if (instrumentNames.length <= 1) return;
    const name = instrumentNames[idx];
    setInstrumentNames(instrumentNames.filter((_, i) => i !== idx));
    setDataPoints(prev => prev.map(dp => { const vals = { ...dp.instrumentValues }; delete vals[name]; return { ...dp, instrumentValues: vals }; }));
  };

  const updateDataPoint = (levelIdx: number, field: string, value: string) => {
    const num = value === "" ? null : parseFloat(value);
    setDataPoints(prev => prev.map((dp, i) => {
      if (i !== levelIdx) return dp;
      if (field === "expectedValue") return { ...dp, expectedValue: num };
      return { ...dp, instrumentValues: { ...dp.instrumentValues, [field]: num } };
    }));
  };

  const filledLevels = studyType === "precision"
    ? (precisionMode === "simple"
      ? precisionValues.slice(0, precisionLevels).filter(arr => (arr || []).filter(v => v !== undefined && v !== null && !isNaN(v)).length >= 3).length
      : precisionAdvancedData.slice(0, precisionLevels).filter(days => (days || []).flat().filter(v => v !== undefined && v !== null && !isNaN(v)).length >= 3).length)
    : dataPoints.filter(dp => dp.expectedValue !== null && instrumentNames.some(n => dp.instrumentValues[n] !== null)).length;

  const saveMutation = useMutation({
    mutationFn: async (study: InsertStudy) => {
      const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders() };
      return fetch(`${API_BASE}/api/studies`, { method: "POST", headers, body: JSON.stringify(study) });
    },
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
      navigate(`/study/${data.id}/results`);
    },
    onError: () => toast({ title: "Failed to save study", variant: "destructive" }),
  });

  const handleSubmit = () => {
    if (!testName.trim()) { toast({ title: "Please enter a test name", variant: "destructive" }); return; }
    if (studyType === "precision") {
      if (filledLevels < 1) { toast({ title: "Please enter at least 3 measurements for one level", variant: "destructive" }); return; }
      const precDataPoints: PrecisionDataPoint[] = precisionLevelNames.slice(0, precisionLevels).map((name, i) => {
        if (precisionMode === "simple") {
          return { level: i + 1, levelName: name, values: (precisionValues[i] || []).filter(v => v !== undefined && v !== null && !isNaN(v)) };
        } else {
          return {
            level: i + 1, levelName: name,
            days: precisionAdvancedData[i] || [],
            numDays: precisionDays, runsPerDay: precisionRunsPerDay, replicatesPerRun: precisionReplicatesPerRun,
            values: (precisionAdvancedData[i] || []).flat().filter(v => v !== undefined && v !== null && !isNaN(v))
          };
        }
      });
      const results = calculatePrecision(precDataPoints, cliaValue, precisionMode);
      const study: InsertStudy = {
        testName: testName.trim(), instrument: instrumentNames[0] || "—", analyst: analyst.trim() || "—",
        date, studyType: "precision", cliaAllowableError: cliaValue,
        dataPoints: JSON.stringify(precDataPoints),
        instruments: JSON.stringify(instrumentNames.slice(0, 1)),
        status: results.overallPass ? "pass" : "fail",
        createdAt: new Date().toISOString(),
      };
      saveMutation.mutate(study);
      return;
    }
    if (filledLevels < MIN_LEVELS) { toast({ title: "Please enter at least 3 data points", variant: "destructive" }); return; }
    const results = calculateStudy(dataPoints, instrumentNames, cliaValue, studyType as "cal_ver" | "method_comparison");
    const study: InsertStudy = {
      testName: testName.trim(), instrument: instrumentNames.join(", "), analyst: analyst.trim() || "—",
      date, studyType, cliaAllowableError: cliaValue, dataPoints: JSON.stringify(dataPoints),
      instruments: JSON.stringify(instrumentNames), status: results.overallPass ? "pass" : "fail",
      createdAt: new Date().toISOString(),
    };
    saveMutation.mutate(study);
  };

  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-14">
          <div className="flex items-center gap-2 mb-4">
            <FlaskConical size={20} className="text-primary" />
            <Badge className="bg-primary/10 text-primary border-0">VeritaCheck</Badge>
          </div>
          <h1 className="font-serif text-4xl font-bold mb-3">The studies your lab has always run — finally done right.</h1>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed">
            Calibration verification, method comparison, and precision studies — automated and browser-based. CLIA-compliant PDF reports with statistical analysis and pass/fail evaluation — no desktop software required.
          </p>

        </div>
      </section>

      {/* Study Tool */}
      <section className="section-padding border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between mb-6">
            <div className="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
              <span className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium bg-background text-foreground shadow">
                New Study
              </span>
              <Link href="/dashboard" className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium gap-1.5 hover:bg-background/60 transition-colors">
                <LayoutDashboard size={13} />My Studies
              </Link>
            </div>
            <Link href="/study-guide" className="inline-flex items-center gap-1.5 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors">
              <BookOpen size={14} />
              Study Guide: Which study do I need?
              <ChevronRight size={13} />
            </Link>
          </div>

          <Tabs defaultValue="setup" className="space-y-6">
            <TabsList className="grid grid-cols-2 w-full max-w-xs">
              <TabsTrigger value="setup">Setup</TabsTrigger>
              <TabsTrigger value="data">Data Entry</TabsTrigger>
            </TabsList>

            <TabsContent value="setup" className="space-y-5">
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">Study Information</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5"><Label>Test Name *</Label><Input placeholder="e.g. GC1 CREAT" value={testName} onChange={e => setTestName(e.target.value)} data-testid="input-test-name" /></div>
                    <div className="space-y-1.5"><Label>Analyst</Label><Input placeholder="Name or initials" value={analyst} onChange={e => setAnalyst(e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Study Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
                    <div className="space-y-1.5"><Label>Study Type</Label>
                      <Select value={studyType} onValueChange={v => setStudyType(v as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cal_ver">Calibration Verification / Linearity</SelectItem>
                          <SelectItem value="method_comparison">Correlation / Method Comparison</SelectItem>
                          <SelectItem value="precision">Precision Verification (EP15)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base flex items-center justify-between">
                  Instruments / Methods
                  <Button variant="outline" size="sm" onClick={addInstrument} disabled={instrumentNames.length >= 3}><PlusCircle size={13} className="mr-1" />Add</Button>
                </CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {instrumentNames.map((name, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Badge variant="outline" className="w-7 justify-center shrink-0 text-xs">{idx + 1}</Badge>
                      <Input value={name} onChange={e => updateInstrumentName(idx, e.target.value)} placeholder={`Instrument ${idx + 1}`} />
                      {instrumentNames.length > 1 && <Button variant="ghost" size="icon" onClick={() => removeInstrument(idx)} className="text-muted-foreground hover:text-destructive shrink-0 w-8 h-8"><Trash2 size={13} /></Button>}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">{studyType === "precision" ? "CLIA Allowable Imprecision (CV%)" : "CLIA Total Allowable Error"}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <Select value={String(cliaPreset)} onValueChange={v => setCliaPreset(parseInt(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup><SelectLabel className="text-xs text-muted-foreground">Routine Chemistry §493.931</SelectLabel>
                        {CLIA_PRESETS.slice(0, 37).map((p, i) => <SelectItem key={i} value={String(i)}>{p.label}</SelectItem>)}
                      </SelectGroup>
                      <SelectGroup><SelectLabel className="text-xs text-muted-foreground">Endocrinology §493.933</SelectLabel>
                        {CLIA_PRESETS.slice(37, 55).map((p, i) => <SelectItem key={37+i} value={String(37+i)}>{p.label}</SelectItem>)}
                      </SelectGroup>
                      <SelectGroup><SelectLabel className="text-xs text-muted-foreground">Toxicology §493.935</SelectLabel>
                        {CLIA_PRESETS.slice(55, 66).map((p, i) => <SelectItem key={55+i} value={String(55+i)}>{p.label}</SelectItem>)}
                      </SelectGroup>
                      <SelectGroup><SelectLabel className="text-xs text-muted-foreground">Hematology §493.941</SelectLabel>
                        {CLIA_PRESETS.slice(66, 74).map((p, i) => <SelectItem key={66+i} value={String(66+i)}>{p.label}</SelectItem>)}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectItem key={74} value={String(74)}>Custom</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {CLIA_PRESETS[cliaPreset].value === 0 && (
                    <div className="flex items-center gap-2">
                      <Input type="number" step="0.005" min="0.01" max="0.5" value={customClia} onChange={e => setCustomClia(parseFloat(e.target.value) || 0.075)} className="max-w-[120px]" />
                      <span className="text-sm text-muted-foreground">= {(customClia * 100).toFixed(1)}% allowable error</span>
                    </div>
                  )}
                  {CLIA_PRESETS[cliaPreset].cfr && <p className="text-xs text-muted-foreground">Reference: {CLIA_PRESETS[cliaPreset].cfr}</p>}
                  <div className="rounded-md bg-primary/5 border border-primary/20 p-3">
                    <p className="text-xs text-primary font-medium">Active TEa: ±{(cliaValue * 100).toFixed(1)}% ({cliaValue.toFixed(4)})</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="data">
              {studyType === "precision" ? (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base flex items-center justify-between">
                    <span>Precision Data Entry</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground font-normal">Mode:</span>
                      <Select value={precisionMode} onValueChange={v => setPrecisionMode(v as "simple" | "advanced")}>
                        <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="simple">Simple</SelectItem>
                          <SelectItem value="advanced">Advanced (EP15)</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="text-xs text-muted-foreground font-normal">Levels:</span>
                      <Select value={String(precisionLevels)} onValueChange={v => setPrecisionLevels(parseInt(v))}>
                        <SelectTrigger className="h-7 w-14 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1</SelectItem>
                          <SelectItem value="2">2</SelectItem>
                          <SelectItem value="3">3</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </CardTitle></CardHeader>
                  <CardContent className="space-y-6">
                    {precisionMode === "advanced" && (
                      <div className="rounded-md bg-muted/50 border p-3 space-y-3">
                        <p className="text-xs font-medium">Advanced — EP15 ANOVA</p>
                        <p className="text-xs text-muted-foreground">For structured multi-day precision studies per CLSI EP15. Specify days, runs per day, and replicates per run.</p>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1"><Label className="text-xs">Days</Label>
                            <Input type="number" min={1} max={20} value={precisionDays} onChange={e => setPrecisionDays(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))} className="h-8 text-sm" />
                          </div>
                          <div className="space-y-1"><Label className="text-xs">Runs / Day</Label>
                            <Input type="number" min={1} max={3} value={precisionRunsPerDay} onChange={e => setPrecisionRunsPerDay(Math.max(1, Math.min(3, parseInt(e.target.value) || 1)))} className="h-8 text-sm" />
                          </div>
                          <div className="space-y-1"><Label className="text-xs">Replicates / Run</Label>
                            <Input type="number" min={1} max={5} value={precisionReplicatesPerRun} onChange={e => setPrecisionReplicatesPerRun(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))} className="h-8 text-sm" />
                          </div>
                        </div>
                      </div>
                    )}
                    {precisionMode === "simple" && (
                      <div className="flex items-center gap-3">
                        <Label className="text-xs whitespace-nowrap">Replicates per level:</Label>
                        <Select value={String(precisionReps)} onValueChange={v => setPrecisionReps(parseInt(v))}>
                          <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[5,10,15,20,25,30,35,40].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {Array.from({ length: precisionLevels }).map((_, li) => (
                      <div key={li} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="shrink-0 text-xs">{li + 1}</Badge>
                          <Input value={precisionLevelNames[li] || ""} onChange={e => {
                            const names = [...precisionLevelNames]; names[li] = e.target.value; setPrecisionLevelNames(names);
                          }} placeholder={`Level ${li + 1}`} className="h-8 text-sm max-w-xs" />
                        </div>

                        {precisionMode === "simple" ? (
                          <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
                            {Array.from({ length: precisionReps }).map((_, vi) => (
                              <Input key={vi} type="number" step="any" placeholder="—"
                                value={precisionValues[li]?.[vi] ?? ""}
                                onChange={e => {
                                  const vals = [...precisionValues];
                                  if (!vals[li]) vals[li] = [];
                                  vals[li] = [...vals[li]];
                                  vals[li][vi] = e.target.value === "" ? (undefined as any) : parseFloat(e.target.value);
                                  setPrecisionValues(vals);
                                }}
                                className="h-8 text-xs text-center"
                              />
                            ))}
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead><tr className="border-b border-border">
                                <th className="text-left py-1 pr-2 text-xs text-muted-foreground font-medium w-16">Day</th>
                                {Array.from({ length: precisionRunsPerDay }).flatMap((_, ri) =>
                                  Array.from({ length: precisionReplicatesPerRun }).map((_, repi) => (
                                    <th key={`${ri}-${repi}`} className="text-center py-1 px-1 text-xs text-muted-foreground font-medium">
                                      R{ri + 1}-{repi + 1}
                                    </th>
                                  ))
                                )}
                              </tr></thead>
                              <tbody>
                                {Array.from({ length: precisionDays }).map((_, di) => (
                                  <tr key={di} className="border-b border-border/50">
                                    <td className="py-1 pr-2 text-xs text-muted-foreground font-mono">Day {di + 1}</td>
                                    {Array.from({ length: precisionRunsPerDay * precisionReplicatesPerRun }).map((_, ci) => (
                                      <td key={ci} className="py-1 px-1">
                                        <Input type="number" step="any" placeholder="—"
                                          value={precisionAdvancedData[li]?.[di]?.[ci] ?? ""}
                                          onChange={e => {
                                            const data = [...precisionAdvancedData];
                                            if (!data[li]) data[li] = [];
                                            data[li] = [...data[li]];
                                            if (!data[li][di]) data[li][di] = [];
                                            data[li][di] = [...data[li][di]];
                                            data[li][di][ci] = e.target.value === "" ? (undefined as any) : parseFloat(e.target.value);
                                            setPrecisionAdvancedData(data);
                                          }}
                                          className="h-7 text-xs text-center w-20"
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : (
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base flex items-center justify-between">
                  <span>Data Points</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-normal">Levels:</span>
                    <Select value={String(numLevels)} onValueChange={handleNumLevelsChange}>
                      <SelectTrigger className="h-7 w-20 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: MAX_LEVELS - MIN_LEVELS + 1 }, (_, i) => i + MIN_LEVELS).map(n => (
                          <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={removeLastLevel} disabled={dataPoints.length <= MIN_LEVELS} title="Remove last level">
                      <span className="text-base leading-none">−</span>
                    </Button>
                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={addLevel} disabled={dataPoints.length >= MAX_LEVELS} title="Add level">
                      <PlusCircle size={13} />
                    </Button>
                    <Badge variant="outline">{filledLevels} / {dataPoints.length} filled</Badge>
                  </div>
                </CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-border">
                        <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium w-12">Lvl</th>
                        <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">{studyType === "method_comparison" ? "Reference" : "Expected"}</th>
                        {instrumentNames.map(n => <th key={n} className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">{n}</th>)}
                      </tr></thead>
                      <tbody>
                        {dataPoints.map((dp, idx) => (
                          <tr key={idx} className="border-b border-border/50">
                            <td className="py-1.5 pr-4"><span className="text-xs text-muted-foreground font-mono">L{dp.level}</span></td>
                            <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="—" value={dp.expectedValue ?? ""} onChange={e => updateDataPoint(idx, "expectedValue", e.target.value)} className="h-8 text-sm w-28" ref={setGridRef(idx, 0)} onKeyDown={e => handleGridKeyDown(e, idx, 0)} /></td>
                            {instrumentNames.map((n, colIdx) => <td key={n} className="py-1.5 pr-4"><Input type="number" step="any" placeholder="—" value={dp.instrumentValues[n] ?? ""} onChange={e => updateDataPoint(idx, n, e.target.value)} className="h-8 text-sm w-28" ref={setGridRef(idx, colIdx + 1)} onKeyDown={e => handleGridKeyDown(e, idx, colIdx + 1)} /></td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
              )}
              <div className="mt-4 flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => {
                  setTestName("GC1 CREAT"); setAnalyst("SED"); setDate("2025-02-06");
                  const names = ["ATELLICA 2 Run 1", "ATELLICA 2 Run 2"]; setInstrumentNames(names); setCliaPreset(0);
                const demoData = [
                    { level: 1, expectedValue: 0.3, instrumentValues: { "ATELLICA 2 Run 1": 0.31, "ATELLICA 2 Run 2": 0.29 } },
                    { level: 2, expectedValue: 7.0, instrumentValues: { "ATELLICA 2 Run 1": 7.37, "ATELLICA 2 Run 2": 7.37 } },
                    { level: 3, expectedValue: 13.8, instrumentValues: { "ATELLICA 2 Run 1": 14.25, "ATELLICA 2 Run 2": 14.21 } },
                    { level: 4, expectedValue: 20.5, instrumentValues: { "ATELLICA 2 Run 1": 20.88, "ATELLICA 2 Run 2": 20.91 } },
                    { level: 5, expectedValue: 27.3, instrumentValues: { "ATELLICA 2 Run 1": 27.22, "ATELLICA 2 Run 2": 27.11 } },
                    ...Array.from({ length: 5 }, (_, i) => ({ level: i + 6, expectedValue: null, instrumentValues: { "ATELLICA 2 Run 1": null, "ATELLICA 2 Run 2": null } })),
                  ];
                  setNumLevels(10);
                  setDataPoints(demoData);
                }}>
                  <FlaskConical size={13} className="mr-1.5" />Load Demo Data
                </Button>
                <span className="text-xs text-muted-foreground">Milford creatinine calibration verification example</span>
              </div>
            </TabsContent>
          </Tabs>

          <div className="mt-8 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {filledLevels >= (studyType === "precision" ? 1 : 3) ? <span className="text-green-600 dark:text-green-400">✓ {filledLevels} level{filledLevels !== 1 ? "s" : ""} ready</span> : <span>{filledLevels} / {studyType === "precision" ? 1 : 3} minimum levels filled</span>}
            </div>
            <Button onClick={handleSubmit} disabled={saveMutation.isPending || filledLevels < (studyType === "precision" ? 1 : 3) || !testName.trim()} size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" data-testid="button-submit-study">
              {saveMutation.isPending ? "Calculating…" : "Run Study & Generate Report"}
            </Button>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="section-padding bg-secondary/20" id="pricing">
        <div className="container-default max-w-4xl">
          <div className="flex items-center justify-center gap-2 mb-3">
            <DollarSign size={18} className="text-primary" />
            <h2 className="font-serif text-2xl font-bold">Simple Pricing</h2>
          </div>
          <p className="text-muted-foreground text-center mb-6">No hidden fees. Cancel anytime.</p>

          {/* Payment result banners */}
          {paymentStatus === "success" && (
            <Alert className="mb-6 max-w-2xl mx-auto border-green-500/30 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-700 dark:text-green-400 font-medium">
                Payment successful — your account has been updated. Thank you!
              </AlertDescription>
            </Alert>
          )}
          {paymentStatus === "cancelled" && (
            <Alert className="mb-6 max-w-2xl mx-auto border-yellow-500/30 bg-yellow-500/10">
              <XCircle className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-yellow-700 dark:text-yellow-400">
                Payment cancelled — no charge was made.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid sm:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map(plan => {
              const isLoading = checkoutLoading === plan.priceType;
              return (
                <Card key={plan.name} className={`relative border-2 ${plan.highlight ? "border-primary bg-primary/5" : "border-border"}`}>
                  {plan.badge && <div className="absolute -top-3 left-1/2 -translate-x-1/2"><Badge className="bg-primary text-primary-foreground">{plan.badge}</Badge></div>}
                  <CardContent className="p-6">
                    <h3 className="font-bold text-lg mb-1">{plan.name}</h3>
                    <div className="flex items-baseline gap-1 mb-2">
                      <span className="text-3xl font-bold">{plan.price}</span>
                      <span className="text-sm text-muted-foreground">/{plan.unit.split("per ")[1]}</span>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                    <ul className="space-y-2 mb-5">
                      {plan.features.map(f => <li key={f} className="flex items-center gap-2 text-sm"><CheckCircle2 size={13} className="text-primary shrink-0" />{f}</li>)}
                    </ul>
                    <Button
                      className={`w-full ${plan.highlight ? "bg-primary hover:bg-primary/90 text-primary-foreground" : ""}`}
                      variant={plan.highlight ? "default" : "outline"}
                      disabled={isLoading || checkoutLoading !== null}
                      onClick={() => handleBuy(plan.priceType as "perStudy" | "annual" | "lab")}
                    >
                      {isLoading ? <><Loader2 size={14} className="mr-2 animate-spin" />Redirecting…</> : plan.cta}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="text-center text-xs text-muted-foreground mt-6">
            Questions? <a href="/#/contact" className="text-primary hover:underline">Contact us</a> — we're happy to help.
          </p>
        </div>
      </section>
    </div>
  );
}
