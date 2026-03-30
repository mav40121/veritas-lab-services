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
import { PlusCircle, Trash2, FlaskConical, CheckCircle2, DollarSign, Loader2, XCircle, LayoutDashboard, BookOpen, ChevronRight, Shield, Info, HelpCircle } from "lucide-react";
import CLIALookupModal from "@/components/CLIALookupModal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { calculateStudy, calculatePrecision, calculateLotToLot, calculatePTCoag, calculateQCRange, calculateMultiAnalyteCoag, type DataPoint, type PrecisionDataPoint, type LotToLotDataPoint, type QCRangeDataPoint, calculateINR } from "@/lib/calculations";
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

const featureTooltips: Record<string, string> = {
  // Per Study
  "Single study run": "Run one calibration verification, method comparison, or other EP study. Generates a complete signed PDF report.",
  "Full PDF report": "Audit-ready PDF with scatter plots, statistical analysis, pass/fail verdict, narrative summary, and lab director signature on page 1.",
  "Cal Ver, Method Comp, Precision & Lot-to-Lot": "Covers calibration verification/linearity, correlation/method comparison, accuracy & precision, and lot-to-lot verification study types.",
  "CLIA pass/fail evaluation": "Each study is automatically evaluated against CLIA allowable total error (TEa) and returns a clear Pass or Fail result.",
  // Starter
  "Unlimited studies": "Run as many EP studies as your lab needs — no per-study charges.",
  "All VeritaCheck study types": "Access to all available study types: calibration verification, method comparison, accuracy & precision, lot-to-lot verification, and more.",
  "Full PDF reports": "Every study generates a signed, audit-ready PDF report suitable for surveyor review.",
  "Study history dashboard": "View, search, and re-download all past studies from your personal dashboard.",
  // Professional
  "Everything in Starter": "Includes all features from the Starter plan.",
  "VeritaMap regulatory mapping": "Build your complete test menu map. The intelligence engine identifies every correlation study and calibration verification your instruments require under 42 CFR Part 493.",
  "VeritaScan self-inspection audit": "168-item inspection readiness tracker across 10 compliance domains. Studies completed in VeritaCheck automatically check off corresponding items.",
  "Priority support": "Dedicated email support with same-day responses during business hours.",
  // Lab
  "Everything in Professional": "Includes all features from the Professional plan.",
  "Up to 10 analyst accounts": "Share one account with up to 10 staff members across your department.",
  "Shared study dashboard": "All team members see the same studies, maps, scans, and competency records in a shared workspace.",
  "Lab branding on PDF reports": "Add your laboratory name and logo to all generated PDF reports.",
  // VeritaAssure Complete
  "Everything in Lab": "Includes all features from the Lab plan.",
  "Consulting access": "Direct access to Michael Veri for compliance questions — the same expertise behind 200+ facility inspections as a Joint Commission Surveyor.",
  "Lab Management 101 book included": "Digital copy of Lab Management 101 by Michael Veri included with your subscription.",
};

const plans = [
  { priceType: "perStudy",        name: "Per Study",              price: "$25",    unit: "one-time",  description: "Pay as you go. No subscription required.",                                                                               features: ["Single study run", "Full PDF report", "Cal Ver, Method Comp, Precision & Lot-to-Lot", "CLIA pass/fail evaluation"],                                                                                  cta: "Buy a Study",    highlight: false, badge: null },
  { priceType: "veritacheck_only", name: "VeritaCheck\u2122 Only", price: "$299",   unit: "per year",  description: "Single user. Method validation suite only, no CLIA number required.",                                                    features: ["Unlimited studies", "All VeritaCheck study types", "Full PDF reports", "Study history dashboard"],                                                                                                    cta: "Subscribe",      highlight: false, badge: null },
  { priceType: "waived",          name: "Waived",                 price: "$499",   unit: "per year",  description: "Certificate of Waiver labs. Full VeritaAssure suite.",                                                                   features: ["Everything in VeritaCheck Only", "VeritaMap regulatory mapping", "VeritaScan self-inspection audit", "VeritaComp competency management"],                                                              cta: "Subscribe",      highlight: false, badge: null },
  { priceType: "community",       name: "Community",              price: "$799",   unit: "per year",  description: "1-8 specialties. Full suite for community and physician office labs.",                                                    features: ["Full VeritaAssure suite", "VeritaStaff personnel management", "Named seat support", "CLIA on all reports"],                                                                                           cta: "Subscribe",      highlight: true,  badge: "Most Popular" },
  { priceType: "hospital",        name: "Hospital",               price: "$1,299", unit: "per year",  description: "9-15 specialties. Full suite for hospital laboratories.",                                                                features: ["Everything in Community", "Higher seat capacity", "Priority support"],                                                                                                                                cta: "Subscribe",      highlight: false, badge: null },
  { priceType: "large_hospital",  name: "Large Hospital",         price: "$1,999", unit: "per year",  description: "16+ specialties. Full suite for large hospital and reference labs.",                                                     features: ["Everything in Hospital", "Maximum seat capacity", "Priority support", "Consulting access"],                                                                                                           cta: "Subscribe",      highlight: false, badge: null },
];

export default function VeritaCheckPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { isLoggedIn, user } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"success" | "cancelled" | null>(null);
  const [discountCode, setDiscountCode] = useState("");
  const [discountApplied, setDiscountApplied] = useState<{ code: string; pct: number; partnerName: string } | null>(null);
  const [discountLoading, setDiscountLoading] = useState(false);
  const [discountError, setDiscountError] = useState("");
  const [cliaModalOpen, setCliaModalOpen] = useState(false);

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

  // Plans that require a CLIA number before checkout
  const CLIA_REQUIRED_PLANS = new Set(["waived", "community", "hospital", "large_hospital"]);

  const handleBuy = async (priceType: string) => {
    if (!isLoggedIn) {
      toast({ title: "Sign in required", description: "Please create a free account to purchase.", variant: "destructive" });
      navigate("/login");
      return;
    }

    // For CLIA-required plans, check if user already has a CLIA number
    if (CLIA_REQUIRED_PLANS.has(priceType) && !user?.cliaNumber) {
      // Show CLIA lookup modal instead of going straight to Stripe
      setCliaModalOpen(true);
      return;
    }

    // For users who already have CLIA set, use their stored tier for CLIA plans
    const checkoutPriceType = CLIA_REQUIRED_PLANS.has(priceType) && user?.cliaTier
      ? user.cliaTier
      : priceType;

    await goToStripeCheckout(checkoutPriceType);
  };

  const goToStripeCheckout = async (priceType: string) => {
    setCheckoutLoading(priceType);
    try {
      const res = await fetch(`${API_BASE}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ priceType, discountCode: discountApplied?.code || undefined }),
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

  const handleCliaCheckout = (tier: string) => {
    setCliaModalOpen(false);
    goToStripeCheckout(tier);
  };

  const applyDiscount = async (priceType: string) => {
    if (!discountCode.trim()) return;
    setDiscountLoading(true);
    setDiscountError("");
    try {
      const res = await fetch(`${API_BASE}/api/discount/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: discountCode.trim(), priceType }),
      });
      const data = await res.json();
      if (data.valid) {
        setDiscountApplied({ code: discountCode.trim().toUpperCase(), pct: data.discountPct, partnerName: data.partnerName });
        setDiscountError("");
      } else {
        setDiscountError(data.message || "Invalid code");
        setDiscountApplied(null);
      }
    } catch {
      setDiscountError("Could not validate code");
    } finally {
      setDiscountLoading(false);
    }
  };

  // VeritaMap pre-population: read URL params
  const prePopParams = new URLSearchParams(search);
  const prePopStudyType = prePopParams.get("studyType");
  const prePopAnalyte = prePopParams.get("analyte");
  const prePopInst1 = prePopParams.get("instrument1");
  const prePopInst2 = prePopParams.get("instrument2");

  const [testName, setTestName] = useState(prePopAnalyte || "");
  const [analyst, setAnalyst] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);

  const studyTypeMap: Record<string, any> = {
    "method_comparison": "method_comparison",
    "method-comparison": "method_comparison",
    "correlation": "method_comparison",
    "cal_ver": "cal_ver",
    "calibration-verification": "cal_ver",
    "precision": "precision",
    "accuracy": "precision",
    "lot_to_lot": "lot_to_lot",
    "lot-to-lot": "lot_to_lot",
    "pt_coag": "pt_coag",
    "pt-coag": "pt_coag",
  };
  const GATED_STUDY_TYPES = new Set(["pt_coag"]); // Coming Soon — pending regulatory review
  const rawInitialStudyType = (prePopStudyType && studyTypeMap[prePopStudyType]) || "cal_ver";
  const initialStudyType = GATED_STUDY_TYPES.has(rawInitialStudyType) ? "cal_ver" : rawInitialStudyType;
  const initialInstruments = prePopInst1 && prePopInst2 ? [prePopInst1, prePopInst2] : prePopInst1 ? [prePopInst1, "Instrument 2"] : ["Instrument 1", "Instrument 2"];

  const [studyType, setStudyType] = useState<"cal_ver" | "method_comparison" | "precision" | "lot_to_lot" | "pt_coag" | "qc_range" | "multi_analyte_coag">(initialStudyType);
  const [instrumentNames, setInstrumentNames] = useState<string[]>(initialInstruments);
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

  // Lot-to-Lot state
  const [lotSampleType, setLotSampleType] = useState<"normal" | "abnormal" | "both">("normal");
  const [lotCurrentLotNum, setLotCurrentLotNum] = useState("");
  const [lotCurrentLotExp, setLotCurrentLotExp] = useState("");
  const [lotNewLotNum, setLotNewLotNum] = useState("");
  const [lotNewLotExp, setLotNewLotExp] = useState("");
  const [lotAnalyte, setLotAnalyte] = useState("");
  const [lotUnits, setLotUnits] = useState("");
  const [lotNumSpecimens, setLotNumSpecimens] = useState(20);
  const [lotData, setLotData] = useState<LotToLotDataPoint[]>(
    Array.from({ length: 20 }, (_, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, currentLot: null, newLot: null, cohort: "Normal" as const }))
  );
  const [lotDataAbnormal, setLotDataAbnormal] = useState<LotToLotDataPoint[]>(
    Array.from({ length: 20 }, (_, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, currentLot: null, newLot: null, cohort: "Abnormal" as const }))
  );

  // PT/Coag state
  const [ptInstrumentName, setPtInstrumentName] = useState("ACL TOP 351");
  const [ptReagentLot, setPtReagentLot] = useState("");
  const [ptReagentExp, setPtReagentExp] = useState("");
  const [ptISI, setPtISI] = useState(0.97);
  const [ptRILow, setPtRILow] = useState(10.0);
  const [ptRIHigh, setPtRIHigh] = useState(14.0);
  const [ptINRRILow, setPtINRRILow] = useState(0.9);
  const [ptINRRIHigh, setPtINRRIHigh] = useState(1.2);
  const [ptModule1Data, setPtModule1Data] = useState<number[]>(Array(20).fill(null));
  // Module 2
  const [ptInstrument2Name, setPtInstrument2Name] = useState("ACL TOP 352");
  const [ptModule2TEa, setPtModule2TEa] = useState(0.20);
  const [ptModule2Data, setPtModule2Data] = useState<{ id: string; x: number | null; y: number | null }[]>(
    Array.from({ length: 20 }, (_, i) => ({ id: `S${String(i + 1).padStart(5, "0")}`, x: null, y: null }))
  );
  // Module 3
  const [ptSkipModule3, setPtSkipModule3] = useState(false);
  const [ptOldLotNum, setPtOldLotNum] = useState("");
  const [ptOldLotExp, setPtOldLotExp] = useState("");
  const [ptModule3TEa, setPtModule3TEa] = useState(0.20);
  const [ptModule3Data, setPtModule3Data] = useState<{ id: string; x: number | null; y: number | null }[]>(
    Array.from({ length: 20 }, (_, i) => ({ id: `S${String(i + 1).padStart(5, "0")}`, x: null, y: null }))
  );

  // QC Range Establishment state
  const [qcAnalytes, setQcAnalytes] = useState<string[]>(["PT", "APTT"]);
  const [qcAnalyteCustom, setQcAnalyteCustom] = useState("");
  const [qcAnalyzers, setQcAnalyzers] = useState<string[]>(["TOP 351"]);
  const [qcLevels, setQcLevels] = useState<string[]>(["Normal", "Abnormal"]);
  const [qcDateStart, setQcDateStart] = useState("");
  const [qcDateEnd, setQcDateEnd] = useState("");
  const [qcRunData, setQcRunData] = useState<Record<string, number[]>>({});
  const [qcOldLotData, setQcOldLotData] = useState<Record<string, { mean: number | null; sd: number | null }>>({});
  const [qcNumRuns, setQcNumRuns] = useState(15);

  // Multi-Analyte Lot Comparison state
  const [maInstrument, setMaInstrument] = useState("ACL TOP 351");
  const [maNewLotPT, setMaNewLotPT] = useState("");
  const [maOldLotPT, setMaOldLotPT] = useState("");
  const [maNewLotAPTT, setMaNewLotAPTT] = useState("");
  const [maOldLotAPTT, setMaOldLotAPTT] = useState("");
  const [maNewLotFib, setMaNewLotFib] = useState("");
  const [maOldLotFib, setMaOldLotFib] = useState("");
  const [maISI, setMaISI] = useState(0.97);
  const [maNormalMeanPT, setMaNormalMeanPT] = useState(12.0);
  const [maSampleType, setMaSampleType] = useState<"normal" | "random">("random");
  const [maTeaPT, setMaTeaPT] = useState(0.20);
  const [maTeaAPTT, setMaTeaAPTT] = useState(0.15);
  const [maTeaFib, setMaTeaFib] = useState(0.20);
  const [maNumSpecimens, setMaNumSpecimens] = useState(20);
  const [maSpecimens, setMaSpecimens] = useState<{ id: string; ptNew: string; ptOld: string; apttNew: string; apttOld: string; fibNew: string; fibOld: string }[]>(
    Array.from({ length: 24 }, (_, i) => ({ id: `S${String(i + 1).padStart(3, "0")}`, ptNew: "", ptOld: "", apttNew: "", apttOld: "", fibNew: "", fibOld: "" }))
  );

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
    : studyType === "lot_to_lot"
    ? lotData.filter(dp => dp.currentLot !== null && dp.newLot !== null).length + (lotSampleType === "both" ? lotDataAbnormal.filter(dp => dp.currentLot !== null && dp.newLot !== null).length : 0)
    : studyType === "pt_coag"
    ? ptModule1Data.filter(v => v !== null && !isNaN(v)).length
    : studyType === "qc_range"
    ? Object.values(qcRunData).filter(arr => arr.filter(v => !isNaN(v)).length >= 3).length
    : studyType === "multi_analyte_coag"
    ? maSpecimens.filter(s => (s.ptNew && s.ptOld) || (s.apttNew && s.apttOld) || (s.fibNew && s.fibOld)).length
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

    if (studyType === "lot_to_lot") {
      const allData = lotSampleType === "both" ? [...lotData, ...lotDataAbnormal] : lotData;
      const validData = allData.filter(dp => dp.currentLot !== null && dp.newLot !== null);
      if (validData.length < 3) { toast({ title: "Please enter at least 3 specimen pairs", variant: "destructive" }); return; }
      const results = calculateLotToLot(allData, cliaValue, lotSampleType);
      const study: InsertStudy = {
        testName: testName.trim(), instrument: instrumentNames[0] || "—", analyst: analyst.trim() || "—",
        date, studyType: "lot_to_lot", cliaAllowableError: cliaValue,
        dataPoints: JSON.stringify({ data: allData, sampleType: lotSampleType, currentLot: lotCurrentLotNum, newLot: lotNewLotNum, analyte: lotAnalyte, units: lotUnits }),
        instruments: JSON.stringify(instrumentNames.slice(0, 1)),
        status: results.overallPass ? "pass" : "fail",
        createdAt: new Date().toISOString(),
      };
      saveMutation.mutate(study);
      return;
    }

    if (studyType === "pt_coag") {
      const m1Valid = ptModule1Data.filter(v => v !== null && !isNaN(v));
      if (m1Valid.length < 3) { toast({ title: "Please enter at least 3 PT values for Module 1", variant: "destructive" }); return; }
      const m2Valid = ptModule2Data.filter(d => d.x !== null && d.y !== null);
      if (m2Valid.length < 3) { toast({ title: "Please enter at least 3 paired values for Module 2", variant: "destructive" }); return; }
      const module3Data = ptSkipModule3 ? null : (() => {
        const m3Valid = ptModule3Data.filter(d => d.x !== null && d.y !== null);
        if (m3Valid.length < 3) return null;
        return {
          xValues: m3Valid.map(d => d.x!), yValues: m3Valid.map(d => d.y!),
          specimenIds: m3Valid.map(d => d.id), tea: ptModule3TEa
        };
      })();
      const results = calculatePTCoag(
        { ptValues: m1Valid, isi: ptISI, ptRI: { low: ptRILow, high: ptRIHigh }, inrRI: { low: ptINRRILow, high: ptINRRIHigh } },
        { xValues: m2Valid.map(d => d.x!), yValues: m2Valid.map(d => d.y!), specimenIds: m2Valid.map(d => d.id), tea: ptModule2TEa },
        module3Data
      );
      const study: InsertStudy = {
        testName: testName.trim(), instrument: ptInstrumentName, analyst: analyst.trim() || "—",
        date, studyType: "pt_coag", cliaAllowableError: ptModule2TEa,
        dataPoints: JSON.stringify({
          module1: { ptValues: m1Valid, isi: ptISI, ptRI: { low: ptRILow, high: ptRIHigh }, inrRI: { low: ptINRRILow, high: ptINRRIHigh } },
          module2: { data: m2Valid, tea: ptModule2TEa, inst1: ptInstrumentName, inst2: ptInstrument2Name },
          module3: ptSkipModule3 ? null : { data: ptModule3Data.filter(d => d.x !== null && d.y !== null), tea: ptModule3TEa, oldLot: ptOldLotNum, newLot: ptReagentLot },
          instrument: ptInstrumentName, reagentLot: ptReagentLot, reagentExp: ptReagentExp
        }),
        instruments: JSON.stringify([ptInstrumentName, ptInstrument2Name]),
        status: results.overallPass ? "pass" : "fail",
        createdAt: new Date().toISOString(),
      };
      saveMutation.mutate(study);
      return;
    }

    if (studyType === "qc_range") {
      const dataPoints: QCRangeDataPoint[] = [];
      for (const analyte of qcAnalytes) {
        for (const level of qcLevels) {
          for (const analyzer of qcAnalyzers) {
            const key = `${analyte}|${level}|${analyzer}`;
            const runs = (qcRunData[key] || []).filter(v => !isNaN(v));
            if (runs.length === 0) continue;
            const old = qcOldLotData[key];
            dataPoints.push({ analyte, level, analyzer, runs, oldMean: old?.mean, oldSD: old?.sd });
          }
        }
      }
      if (dataPoints.length === 0) { toast({ title: "Enter run data for at least one analyte/level", variant: "destructive" }); return; }
      const results = calculateQCRange(dataPoints, { start: qcDateStart, end: qcDateEnd });
      const study: InsertStudy = {
        testName: testName.trim(), instrument: qcAnalyzers.join(", "), analyst: analyst.trim() || "—",
        date, studyType: "qc_range", cliaAllowableError: 0.10,
        dataPoints: JSON.stringify({ dataPoints, analytes: qcAnalytes, analyzers: qcAnalyzers, levels: qcLevels, dateRange: { start: qcDateStart, end: qcDateEnd }, oldLotData: qcOldLotData }),
        instruments: JSON.stringify(qcAnalyzers),
        status: results.overallShiftCount === 0 ? "pass" : "fail",
        createdAt: new Date().toISOString(),
      };
      saveMutation.mutate(study);
      return;
    }

    if (studyType === "multi_analyte_coag") {
      const rawSpecimens = maSpecimens.map(s => ({
        specimenId: s.id,
        ptNew: s.ptNew ? parseFloat(s.ptNew) : null,
        ptOld: s.ptOld ? parseFloat(s.ptOld) : null,
        apttNew: s.apttNew ? parseFloat(s.apttNew) : null,
        apttOld: s.apttOld ? parseFloat(s.apttOld) : null,
        fibNew: s.fibNew ? parseFloat(s.fibNew) : null,
        fibOld: s.fibOld ? parseFloat(s.fibOld) : null,
      })).filter(s => (s.ptNew != null && s.ptOld != null) || (s.apttNew != null && s.apttOld != null) || (s.fibNew != null && s.fibOld != null));
      if (rawSpecimens.length < 3) { toast({ title: "Enter at least 3 specimen pairs", variant: "destructive" }); return; }
      const results = calculateMultiAnalyteCoag(rawSpecimens, maISI, maNormalMeanPT, { pt: maTeaPT, aptt: maTeaAPTT, fib: maTeaFib });
      const study: InsertStudy = {
        testName: testName.trim(), instrument: maInstrument, analyst: analyst.trim() || "—",
        date, studyType: "multi_analyte_coag", cliaAllowableError: maTeaPT,
        dataPoints: JSON.stringify({
          specimens: rawSpecimens, isi: maISI, normalMeanPT: maNormalMeanPT,
          teas: { pt: maTeaPT, aptt: maTeaAPTT, fib: maTeaFib },
          lots: { ptNew: maNewLotPT, ptOld: maOldLotPT, apttNew: maNewLotAPTT, apttOld: maOldLotAPTT, fibNew: maNewLotFib, fibOld: maOldLotFib },
          instrument: maInstrument, sampleType: maSampleType,
        }),
        instruments: JSON.stringify([maInstrument]),
        status: results.overallPass ? "pass" : "fail",
        createdAt: new Date().toISOString(),
      };
      saveMutation.mutate(study);
      return;
    }

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
      {!isLoggedIn ? (
        <>
          {/* Landing Hero for unauthenticated visitors */}
          <section className="border-b border-border bg-primary/5">
            <div className="container-default py-16">
              <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <FlaskConical size={20} className="text-primary" />
                    <Badge className="bg-primary/10 text-primary border-0">New Product</Badge>
                    <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border">Now Live</Badge>
                  </div>
                  <h1 className="font-serif text-5xl font-bold mb-3 leading-tight">VeritaCheck{"\u2122"}</h1>
                  <p className="text-xl text-muted-foreground font-medium mb-5">
                    EP Evaluation and Study Management Platform
                  </p>
                  <div className="border-l-4 border-primary pl-4 mb-6">
                    <p className="text-base leading-relaxed italic text-foreground/90">
                      "The studies your lab has already been running, finally documented the way surveyors expect."
                    </p>
                  </div>
                  <p className="text-muted-foreground leading-relaxed mb-4">
                    VeritaCheck automates calibration verification, method comparison, accuracy and precision, lot-to-lot verification, and PT/coag new lot validation. Every study generates a signed, audit-ready PDF report with scatter plots, statistical analysis, and pass/fail evaluation, mapped to 42 CFR Part 493, TJC CAMLAB 2024, and CAP checklists.
                  </p>
                  <p className="text-muted-foreground leading-relaxed mb-6">
                    Built by a former TJC laboratory surveyor with 200+ inspections. VeritaCheck produces exactly what your surveyors want to see, because it was designed by someone who reviewed these reports for years.
                  </p>

                  {/* Pricing */}
                  <div className="flex flex-wrap gap-3 mb-8">
                    <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                      <div className="text-2xl font-bold text-primary">$25</div>
                      <div className="text-xs text-muted-foreground">Per Study - Pay only when you need it</div>
                    </div>
                    <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                      <div className="text-2xl font-bold text-primary">$299/yr</div>
                      <div className="text-xs text-muted-foreground">VeritaCheck&#8482; Only (single user)</div>
                    </div>
                    <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                      <div className="text-2xl font-bold text-primary">From $499/yr</div>
                      <div className="text-xs text-muted-foreground">Full VeritaAssure&#8482; Suite</div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
                      <Link href="/login">Launch VeritaCheck <ChevronRight size={15} className="ml-1" /></Link>
                    </Button>
                    <Button asChild variant="outline" size="lg">
                      <Link href="/login">Sign In / Create Account</Link>
                    </Button>
                  </div>
                </div>

                {/* Right: teal card */}
                <div className="flex justify-center lg:justify-end">
                  <div className="relative">
                    <div className="w-64 h-80 bg-gradient-to-br from-[#0e8a82] to-[#0a5e58] rounded-lg shadow-2xl flex flex-col items-center justify-center p-8 text-white">
                      <FlaskConical size={40} className="text-white/80 mb-4" />
                      <div className="font-serif text-3xl font-bold text-center leading-tight mb-3">
                        VeritaCheck{"\u2122"}
                      </div>
                      <div className="text-xs text-white/70 text-center space-y-1 mb-4">
                        <div>Calibration Verification / Linearity</div>
                        <div>Correlation / Method Comparison</div>
                        <div>Accuracy and Precision</div>
                        <div>Lot-to-Lot Verification</div>
                        <div className="flex items-center justify-center gap-1">PT/Coag New Lot Validation <span className="inline-flex items-center rounded-full bg-amber-500/30 text-amber-200 px-1.5 py-0 text-[9px] font-semibold leading-4">Soon</span></div>
                      </div>
                      <div className="w-12 h-0.5 bg-white/40 mb-4" />
                      <div className="text-xs text-white/60 text-center">42 CFR {"\u00A7"}493 {"\u00B7"} TJC {"\u00B7"} CAP</div>
                    </div>
                    <div className="absolute -bottom-2 -right-2 w-64 h-80 bg-black/20 rounded-lg -z-10" />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          {/* Hero for logged-in users */}
          <section className="border-b border-border bg-primary/5">
            <div className="container-default py-14">
              <div className="flex items-center gap-2 mb-4">
                <FlaskConical size={20} className="text-primary" />
                <Badge className="bg-primary/10 text-primary border-0">VeritaCheck</Badge>
              </div>
              <h1 className="font-serif text-4xl font-bold mb-3">The studies your lab has always run, finally done right.</h1>
              <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed">
                Calibration verification, method comparison, and precision studies, automated and browser-based. CLIA-compliant PDF reports with statistical analysis and pass/fail evaluation mapped to 42 CFR Part 493, TJC CAMLAB 2024, and CAP checklists.
              </p>
            </div>
          </section>
        </>
      )}

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
                          <SelectItem value="lot_to_lot">Lot-to-Lot Verification</SelectItem>
                          <SelectItem value="pt_coag" disabled className="pointer-events-auto cursor-not-allowed opacity-60" title="PT/Coag New Lot Validation - Coming Soon. Join the newsletter to be notified.">
                            <span className="flex items-center gap-2">PT/Coag New Lot Validation <span className="inline-flex items-center rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30 px-1.5 py-0 text-[10px] font-semibold leading-4">Coming Soon</span></span>
                          </SelectItem>
                          <SelectItem value="qc_range">QC Range Establishment</SelectItem>
                          <SelectItem value="multi_analyte_coag">Multi-Analyte Lot Comparison (Coag)</SelectItem>
                        </SelectContent>
                      </Select>
                      {studyType === "cal_ver" && (
                        <div className="flex items-start gap-2 mt-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                          <Info size={13} className="text-primary shrink-0 mt-0.5" />
                          <span>Calibration verification is required by CLIA even when your analyzer uses manufacturer-assigned calibration. VeritaCheck documents the verification process, not the calibration itself, which is what 42 CFR {"\u00A7"}493.1255 actually requires.</span>
                        </div>
                      )}
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
              {studyType === "lot_to_lot" ? (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">Lot-to-Lot Verification Data Entry</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>Analyte Name</Label><Input placeholder="e.g. Fibrinogen" value={lotAnalyte} onChange={e => setLotAnalyte(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label>Units</Label><Input placeholder="e.g. mg/dL" value={lotUnits} onChange={e => setLotUnits(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label>Current Lot #</Label><Input value={lotCurrentLotNum} onChange={e => setLotCurrentLotNum(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label>Current Lot Expiration</Label><Input type="date" value={lotCurrentLotExp} onChange={e => setLotCurrentLotExp(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label>New Lot #</Label><Input value={lotNewLotNum} onChange={e => setLotNewLotNum(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label>New Lot Expiration</Label><Input type="date" value={lotNewLotExp} onChange={e => setLotNewLotExp(e.target.value)} /></div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>Sample Type</Label>
                        <Select value={lotSampleType} onValueChange={v => setLotSampleType(v as any)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="normal">Normal Only</SelectItem>
                            <SelectItem value="abnormal">Abnormal Only</SelectItem>
                            <SelectItem value="both">Both (Normal + Abnormal)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5"><Label>Number of Specimens</Label>
                        <Input type="number" min={3} max={100} value={lotNumSpecimens} onChange={e => {
                          const n = Math.max(3, Math.min(100, parseInt(e.target.value) || 20));
                          setLotNumSpecimens(n);
                          setLotData(prev => {
                            if (n > prev.length) return [...prev, ...Array.from({ length: n - prev.length }, (_, i) => ({ specimenId: `S${String(prev.length + i + 1).padStart(3, "0")}`, currentLot: null, newLot: null, cohort: "Normal" as const }))];
                            return prev.slice(0, n);
                          });
                          setLotDataAbnormal(prev => {
                            if (n > prev.length) return [...prev, ...Array.from({ length: n - prev.length }, (_, i) => ({ specimenId: `S${String(prev.length + i + 1).padStart(3, "0")}`, currentLot: null, newLot: null, cohort: "Abnormal" as const }))];
                            return prev.slice(0, n);
                          });
                        }} />
                        {lotNumSpecimens < 20 && <p className="text-xs text-amber-500">Minimum 20 specimens recommended</p>}
                      </div>
                    </div>
                    {/* Normal cohort table */}
                    <div className="space-y-2">
                      <div className="text-sm font-medium">{lotSampleType === "both" ? "Normal Cohort" : "Specimen Data"}</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="border-b border-border">
                            <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium w-24">Specimen ID</th>
                            <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">Current Lot</th>
                            <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">New Lot</th>
                          </tr></thead>
                          <tbody>
                            {lotData.map((dp, idx) => (
                              <tr key={idx} className="border-b border-border/50">
                                <td className="py-1.5 pr-4"><Input value={dp.specimenId} onChange={e => { const d = [...lotData]; d[idx] = { ...d[idx], specimenId: e.target.value }; setLotData(d); }} className="h-8 text-sm w-24" /></td>
                                <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="—" value={dp.currentLot ?? ""} onChange={e => { const d = [...lotData]; d[idx] = { ...d[idx], currentLot: e.target.value === "" ? null : parseFloat(e.target.value) }; setLotData(d); }} className="h-8 text-sm w-28" /></td>
                                <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="—" value={dp.newLot ?? ""} onChange={e => { const d = [...lotData]; d[idx] = { ...d[idx], newLot: e.target.value === "" ? null : parseFloat(e.target.value) }; setLotData(d); }} className="h-8 text-sm w-28" /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {lotSampleType === "both" && (
                      <div className="space-y-2">
                        <div className="text-sm font-medium">Abnormal Cohort</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead><tr className="border-b border-border">
                              <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium w-24">Specimen ID</th>
                              <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">Current Lot</th>
                              <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">New Lot</th>
                            </tr></thead>
                            <tbody>
                              {lotDataAbnormal.map((dp, idx) => (
                                <tr key={idx} className="border-b border-border/50">
                                  <td className="py-1.5 pr-4"><Input value={dp.specimenId} onChange={e => { const d = [...lotDataAbnormal]; d[idx] = { ...d[idx], specimenId: e.target.value }; setLotDataAbnormal(d); }} className="h-8 text-sm w-24" /></td>
                                  <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="—" value={dp.currentLot ?? ""} onChange={e => { const d = [...lotDataAbnormal]; d[idx] = { ...d[idx], currentLot: e.target.value === "" ? null : parseFloat(e.target.value) }; setLotDataAbnormal(d); }} className="h-8 text-sm w-28" /></td>
                                  <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="—" value={dp.newLot ?? ""} onChange={e => { const d = [...lotDataAbnormal]; d[idx] = { ...d[idx], newLot: e.target.value === "" ? null : parseFloat(e.target.value) }; setLotDataAbnormal(d); }} className="h-8 text-sm w-28" /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : studyType === "pt_coag" ? (
                <div className="space-y-6">
                  {/* Module 1: Normal Patient Mean */}
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base">Module 1: Normal Patient Mean & Reference Interval Verification</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5"><Label>Instrument</Label><Input value={ptInstrumentName} onChange={e => setPtInstrumentName(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label>Reagent Lot (New)</Label><Input value={ptReagentLot} onChange={e => setPtReagentLot(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label>Reagent Expiration</Label><Input type="date" value={ptReagentExp} onChange={e => setPtReagentExp(e.target.value)} /></div>
                      </div>
                      <div className="grid sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5"><Label>ISI Value</Label><Input type="number" step="0.01" value={ptISI} onChange={e => setPtISI(parseFloat(e.target.value) || 0.97)} /></div>
                        <div className="space-y-1.5"><Label>PT RI Low (sec)</Label><Input type="number" step="0.1" value={ptRILow} onChange={e => setPtRILow(parseFloat(e.target.value) || 10)} /></div>
                        <div className="space-y-1.5"><Label>PT RI High (sec)</Label><Input type="number" step="0.1" value={ptRIHigh} onChange={e => setPtRIHigh(parseFloat(e.target.value) || 14)} /></div>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5"><Label>INR RI Low</Label><Input type="number" step="0.1" value={ptINRRILow} onChange={e => setPtINRRILow(parseFloat(e.target.value) || 0.9)} /></div>
                        <div className="space-y-1.5"><Label>INR RI High</Label><Input type="number" step="0.1" value={ptINRRIHigh} onChange={e => setPtINRRIHigh(parseFloat(e.target.value) || 1.2)} /></div>
                      </div>
                      <div className="space-y-2">
                        <div className="text-sm font-medium">Normal Patient PT Results (seconds)</div>
                        <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
                          {ptModule1Data.map((v, i) => (
                            <Input key={i} type="number" step="any" placeholder="—" value={v ?? ""}
                              onChange={e => { const d = [...ptModule1Data]; d[i] = e.target.value === "" ? null as any : parseFloat(e.target.value); setPtModule1Data(d); }}
                              className="h-8 text-xs text-center" />
                          ))}
                        </div>
                        {ptModule1Data.filter(v => v !== null && !isNaN(v)).length < 20 && <p className="text-xs text-amber-500">Minimum 20 normal specimens recommended</p>}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Module 2: Two-Instrument Comparison */}
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base">Module 2: Two-Instrument Comparison (Deming Regression)</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5"><Label>Instrument 1 (X)</Label><Input value={ptInstrumentName} onChange={e => setPtInstrumentName(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label>Instrument 2 (Y)</Label><Input value={ptInstrument2Name} onChange={e => setPtInstrument2Name(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label>TEa %</Label><Input type="number" step="1" value={(ptModule2TEa * 100)} onChange={e => setPtModule2TEa((parseFloat(e.target.value) || 20) / 100)} /><span className="text-xs text-muted-foreground">Default: 20% for PT</span></div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="border-b border-border">
                            <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium w-24">Specimen ID</th>
                            <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">{ptInstrumentName} PT</th>
                            <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">{ptInstrument2Name} PT</th>
                          </tr></thead>
                          <tbody>
                            {ptModule2Data.map((dp, idx) => (
                              <tr key={idx} className="border-b border-border/50">
                                <td className="py-1.5 pr-4"><span className="text-xs text-muted-foreground font-mono">{dp.id}</span></td>
                                <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="—" value={dp.x ?? ""} onChange={e => { const d = [...ptModule2Data]; d[idx] = { ...d[idx], x: e.target.value === "" ? null : parseFloat(e.target.value) }; setPtModule2Data(d); }} className="h-8 text-sm w-28" /></td>
                                <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="—" value={dp.y ?? ""} onChange={e => { const d = [...ptModule2Data]; d[idx] = { ...d[idx], y: e.target.value === "" ? null : parseFloat(e.target.value) }; setPtModule2Data(d); }} className="h-8 text-sm w-28" /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Module 3: Old Lot vs New Lot */}
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base flex items-center justify-between">
                      <span>Module 3: Old Lot vs New Lot Comparison</span>
                      <label className="flex items-center gap-2 text-sm font-normal cursor-pointer">
                        <input type="checkbox" checked={ptSkipModule3} onChange={e => setPtSkipModule3(e.target.checked)} className="rounded" />
                        Skip (single analyzer lab)
                      </label>
                    </CardTitle></CardHeader>
                    {!ptSkipModule3 && (
                      <CardContent className="space-y-4">
                        <div className="grid sm:grid-cols-3 gap-4">
                          <div className="space-y-1.5"><Label>Old Lot #</Label><Input value={ptOldLotNum} onChange={e => setPtOldLotNum(e.target.value)} /></div>
                          <div className="space-y-1.5"><Label>Old Lot Expiration</Label><Input type="date" value={ptOldLotExp} onChange={e => setPtOldLotExp(e.target.value)} /></div>
                          <div className="space-y-1.5"><Label>TEa %</Label><Input type="number" step="1" value={(ptModule3TEa * 100)} onChange={e => setPtModule3TEa((parseFloat(e.target.value) || 20) / 100)} /></div>
                        </div>
                        <p className="text-xs text-muted-foreground">Run old lot first, then new lot on same specimens sequentially.</p>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead><tr className="border-b border-border">
                              <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium w-24">Specimen ID</th>
                              <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">Old Lot PT</th>
                              <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">New Lot PT</th>
                            </tr></thead>
                            <tbody>
                              {ptModule3Data.map((dp, idx) => (
                                <tr key={idx} className="border-b border-border/50">
                                  <td className="py-1.5 pr-4"><span className="text-xs text-muted-foreground font-mono">{dp.id}</span></td>
                                  <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="—" value={dp.x ?? ""} onChange={e => { const d = [...ptModule3Data]; d[idx] = { ...d[idx], x: e.target.value === "" ? null : parseFloat(e.target.value) }; setPtModule3Data(d); }} className="h-8 text-sm w-28" /></td>
                                  <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="—" value={dp.y ?? ""} onChange={e => { const d = [...ptModule3Data]; d[idx] = { ...d[idx], y: e.target.value === "" ? null : parseFloat(e.target.value) }; setPtModule3Data(d); }} className="h-8 text-sm w-28" /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                </div>
              ) : studyType === "qc_range" ? (
                <div className="space-y-6">
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base">QC Range Establishment Setup</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Analytes</Label>
                        <div className="flex flex-wrap gap-3">
                          {["PT", "APTT", "Fibrinogen"].map(a => (
                            <label key={a} className="flex items-center gap-1.5 text-sm cursor-pointer">
                              <input type="checkbox" checked={qcAnalytes.includes(a)} onChange={e => {
                                setQcAnalytes(prev => e.target.checked ? [...prev, a] : prev.filter(x => x !== a));
                              }} className="rounded" />{a}
                            </label>
                          ))}
                          <div className="flex items-center gap-1.5">
                            <Input placeholder="Other analyte" value={qcAnalyteCustom} onChange={e => setQcAnalyteCustom(e.target.value)} className="h-7 text-xs w-32" />
                            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
                              if (qcAnalyteCustom.trim() && !qcAnalytes.includes(qcAnalyteCustom.trim())) {
                                setQcAnalytes([...qcAnalytes, qcAnalyteCustom.trim()]); setQcAnalyteCustom("");
                              }
                            }}>Add</Button>
                          </div>
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label>Analyzers (up to 4)</Label>
                          {qcAnalyzers.map((az, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <Input value={az} onChange={e => { const a = [...qcAnalyzers]; a[i] = e.target.value; setQcAnalyzers(a); }} className="h-8 text-sm" />
                              {qcAnalyzers.length > 1 && <Button variant="ghost" size="icon" onClick={() => setQcAnalyzers(qcAnalyzers.filter((_, j) => j !== i))} className="w-7 h-7"><Trash2 size={12} /></Button>}
                            </div>
                          ))}
                          {qcAnalyzers.length < 4 && <Button variant="outline" size="sm" onClick={() => setQcAnalyzers([...qcAnalyzers, `TOP ${qcAnalyzers.length + 351}`])}><PlusCircle size={12} className="mr-1" />Add Analyzer</Button>}
                        </div>
                        <div className="space-y-1.5">
                          <Label>Control Levels</Label>
                          {qcLevels.map((lv, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <Input value={lv} onChange={e => { const l = [...qcLevels]; l[i] = e.target.value; setQcLevels(l); }} className="h-8 text-sm" />
                              {qcLevels.length > 1 && <Button variant="ghost" size="icon" onClick={() => setQcLevels(qcLevels.filter((_, j) => j !== i))} className="w-7 h-7"><Trash2 size={12} /></Button>}
                            </div>
                          ))}
                          {qcLevels.length < 6 && <Button variant="outline" size="sm" onClick={() => setQcLevels([...qcLevels, `Level ${qcLevels.length + 1}`])}><PlusCircle size={12} className="mr-1" />Add Level</Button>}
                        </div>
                      </div>
                      <div className="grid sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5"><Label>Date Range Start</Label><Input type="date" value={qcDateStart} onChange={e => setQcDateStart(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label>Date Range End</Label><Input type="date" value={qcDateEnd} onChange={e => setQcDateEnd(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label>Runs per Level</Label><Input type="number" min={5} max={30} value={qcNumRuns} onChange={e => setQcNumRuns(Math.max(5, Math.min(30, parseInt(e.target.value) || 15)))} /></div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Data entry grids per analyte/level/analyzer */}
                  {qcAnalytes.map(analyte => (
                    <Card key={analyte}>
                      <CardHeader className="pb-3"><CardTitle className="text-base">{analyte}: QC Run Data</CardTitle></CardHeader>
                      <CardContent className="space-y-4">
                        {qcLevels.map(level => (
                          <div key={level} className="space-y-2">
                            <div className="text-sm font-medium">{level}</div>
                            {qcAnalyzers.map(analyzer => {
                              const key = `${analyte}|${level}|${analyzer}`;
                              const runs = qcRunData[key] || Array(qcNumRuns).fill(NaN);
                              return (
                                <div key={analyzer} className="space-y-1">
                                  <div className="text-xs text-muted-foreground">{analyzer}</div>
                                  <div className="grid grid-cols-5 sm:grid-cols-10 gap-1">
                                    {Array.from({ length: qcNumRuns }).map((_, ri) => (
                                      <Input key={ri} type="number" step="any" placeholder="—"
                                        value={!isNaN(runs[ri]) ? runs[ri] : ""}
                                        onChange={e => {
                                          const updated = [...(qcRunData[key] || Array(qcNumRuns).fill(NaN))];
                                          updated[ri] = e.target.value === "" ? NaN : parseFloat(e.target.value);
                                          setQcRunData({ ...qcRunData, [key]: updated });
                                        }}
                                        className="h-7 text-xs text-center" />
                                    ))}
                                  </div>
                                  <div className="flex items-center gap-4 mt-1">
                                    <div className="text-xs text-muted-foreground">Old lot mean:</div>
                                    <Input type="number" step="any" placeholder="—"
                                      value={qcOldLotData[key]?.mean ?? ""}
                                      onChange={e => setQcOldLotData({ ...qcOldLotData, [key]: { ...qcOldLotData[key], mean: e.target.value === "" ? null : parseFloat(e.target.value), sd: qcOldLotData[key]?.sd ?? null } })}
                                      className="h-7 text-xs w-24" />
                                    <div className="text-xs text-muted-foreground">Old lot SD:</div>
                                    <Input type="number" step="any" placeholder="—"
                                      value={qcOldLotData[key]?.sd ?? ""}
                                      onChange={e => setQcOldLotData({ ...qcOldLotData, [key]: { ...qcOldLotData[key], sd: e.target.value === "" ? null : parseFloat(e.target.value), mean: qcOldLotData[key]?.mean ?? null } })}
                                      className="h-7 text-xs w-24" />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                        {qcNumRuns < 10 && <p className="text-xs text-amber-500">Minimum 10 runs recommended per level</p>}
                      </CardContent>
                    </Card>
                  ))}
                  <Alert>
                    <Shield size={14} />
                    <AlertDescription className="text-xs">Per policy, SD does not change lot to lot. Use the historical/peer-derived SD for control limits, not the SD calculated here unless it represents a significant change.</AlertDescription>
                  </Alert>
                </div>
              ) : studyType === "multi_analyte_coag" ? (
                <div className="space-y-6">
                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base">Multi-Analyte Lot Comparison Setup</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5"><Label>Instrument</Label><Input value={maInstrument} onChange={e => setMaInstrument(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label>ISI (New Lot)</Label><Input type="number" step="0.01" value={maISI} onChange={e => setMaISI(parseFloat(e.target.value) || 0.97)} /></div>
                        <div className="space-y-1.5"><Label>Normal Patient Mean PT (sec)</Label><Input type="number" step="0.1" value={maNormalMeanPT} onChange={e => setMaNormalMeanPT(parseFloat(e.target.value) || 12)} /></div>
                      </div>
                      <div className="grid sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5"><Label>New PT Lot #</Label><Input value={maNewLotPT} onChange={e => setMaNewLotPT(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label>New APTT Lot #</Label><Input value={maNewLotAPTT} onChange={e => setMaNewLotAPTT(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label>New Fib Lot #</Label><Input value={maNewLotFib} onChange={e => setMaNewLotFib(e.target.value)} /></div>
                      </div>
                      <div className="grid sm:grid-cols-3 gap-4">
                        <div className="space-y-1.5"><Label>Old PT Lot #</Label><Input value={maOldLotPT} onChange={e => setMaOldLotPT(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label>Old APTT Lot #</Label><Input value={maOldLotAPTT} onChange={e => setMaOldLotAPTT(e.target.value)} /></div>
                        <div className="space-y-1.5"><Label>Old Fib Lot #</Label><Input value={maOldLotFib} onChange={e => setMaOldLotFib(e.target.value)} /></div>
                      </div>
                      <div className="grid sm:grid-cols-4 gap-4">
                        <div className="space-y-1.5"><Label>Sample Type</Label>
                          <Select value={maSampleType} onValueChange={v => setMaSampleType(v as any)}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="normal">Normal Specimens</SelectItem>
                              <SelectItem value="random">Random Patients (20+)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5"><Label>PT TEa %</Label><Input type="number" step="1" value={maTeaPT * 100} onChange={e => setMaTeaPT((parseFloat(e.target.value) || 20) / 100)} /></div>
                        <div className="space-y-1.5"><Label>APTT TEa %</Label><Input type="number" step="1" value={maTeaAPTT * 100} onChange={e => setMaTeaAPTT((parseFloat(e.target.value) || 15) / 100)} /></div>
                        <div className="space-y-1.5"><Label>Fib TEa %</Label><Input type="number" step="1" value={maTeaFib * 100} onChange={e => setMaTeaFib((parseFloat(e.target.value) || 20) / 100)} /></div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-3"><CardTitle className="text-base">Specimen Data: PT + APTT + Fibrinogen</CardTitle></CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left py-2 pr-2 text-xs text-muted-foreground font-medium w-16">ID</th>
                              <th className="text-left py-2 pr-2 text-xs text-muted-foreground font-medium">New PT</th>
                              <th className="text-left py-2 pr-2 text-xs text-muted-foreground font-medium">New INR</th>
                              <th className="text-left py-2 pr-2 text-xs text-muted-foreground font-medium">Old PT</th>
                              <th className="text-left py-2 pr-2 text-xs text-muted-foreground font-medium">PT %Diff</th>
                              <th className="text-left py-2 pr-2 text-xs text-muted-foreground font-medium">New APTT</th>
                              <th className="text-left py-2 pr-2 text-xs text-muted-foreground font-medium">Old APTT</th>
                              <th className="text-left py-2 pr-2 text-xs text-muted-foreground font-medium">APTT %Diff</th>
                              <th className="text-left py-2 pr-2 text-xs text-muted-foreground font-medium">New Fib</th>
                              <th className="text-left py-2 pr-2 text-xs text-muted-foreground font-medium">Old Fib</th>
                              <th className="text-left py-2 text-xs text-muted-foreground font-medium">Fib %Diff</th>
                            </tr>
                          </thead>
                          <tbody>
                            {maSpecimens.map((s, idx) => {
                              const ptN = parseFloat(s.ptNew), ptO = parseFloat(s.ptOld);
                              const apttN = parseFloat(s.apttNew), apttO = parseFloat(s.apttOld);
                              const fibN = parseFloat(s.fibNew), fibO = parseFloat(s.fibOld);
                              const ptINR = !isNaN(ptN) && maNormalMeanPT > 0 ? calculateINR(ptN, maNormalMeanPT, maISI) : null;
                              const ptPct = !isNaN(ptN) && !isNaN(ptO) && ptO !== 0 ? ((ptN - ptO) / ptO * 100) : null;
                              const apttPct = !isNaN(apttN) && !isNaN(apttO) && apttO !== 0 ? ((apttN - apttO) / apttO * 100) : null;
                              const fibPct = !isNaN(fibN) && !isNaN(fibO) && fibO !== 0 ? ((fibN - fibO) / fibO * 100) : null;
                              return (
                                <tr key={idx} className="border-b border-border/50">
                                  <td className="py-1 pr-2"><span className="text-xs font-mono text-muted-foreground">{s.id}</span></td>
                                  <td className="py-1 pr-2"><Input value={s.ptNew} onChange={e => { const d = [...maSpecimens]; d[idx] = { ...d[idx], ptNew: e.target.value }; setMaSpecimens(d); }} className="h-7 text-xs w-16" /></td>
                                  <td className="py-1 pr-2"><span className="text-xs font-mono">{ptINR != null ? ptINR.toFixed(2) : "—"}</span></td>
                                  <td className="py-1 pr-2"><Input value={s.ptOld} onChange={e => { const d = [...maSpecimens]; d[idx] = { ...d[idx], ptOld: e.target.value }; setMaSpecimens(d); }} className="h-7 text-xs w-16" /></td>
                                  <td className="py-1 pr-2"><span className={`text-xs font-mono ${ptPct != null && Math.abs(ptPct) > maTeaPT * 100 ? "text-red-500 font-semibold" : ""}`}>{ptPct != null ? ptPct.toFixed(1) + "%" : "—"}</span></td>
                                  <td className="py-1 pr-2"><Input value={s.apttNew} onChange={e => { const d = [...maSpecimens]; d[idx] = { ...d[idx], apttNew: e.target.value }; setMaSpecimens(d); }} className="h-7 text-xs w-16" /></td>
                                  <td className="py-1 pr-2"><Input value={s.apttOld} onChange={e => { const d = [...maSpecimens]; d[idx] = { ...d[idx], apttOld: e.target.value }; setMaSpecimens(d); }} className="h-7 text-xs w-16" /></td>
                                  <td className="py-1 pr-2"><span className={`text-xs font-mono ${apttPct != null && Math.abs(apttPct) > maTeaAPTT * 100 ? "text-red-500 font-semibold" : ""}`}>{apttPct != null ? apttPct.toFixed(1) + "%" : "—"}</span></td>
                                  <td className="py-1 pr-2"><Input value={s.fibNew} onChange={e => { const d = [...maSpecimens]; d[idx] = { ...d[idx], fibNew: e.target.value }; setMaSpecimens(d); }} className="h-7 text-xs w-16" /></td>
                                  <td className="py-1 pr-2"><Input value={s.fibOld} onChange={e => { const d = [...maSpecimens]; d[idx] = { ...d[idx], fibOld: e.target.value }; setMaSpecimens(d); }} className="h-7 text-xs w-16" /></td>
                                  <td className="py-1"><span className={`text-xs font-mono ${fibPct != null && Math.abs(fibPct) > maTeaFib * 100 ? "text-red-500 font-semibold" : ""}`}>{fibPct != null ? fibPct.toFixed(1) + "%" : "—"}</span></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <Button variant="outline" size="sm" className="mt-2" onClick={() => setMaSpecimens([...maSpecimens, { id: `S${String(maSpecimens.length + 1).padStart(3, "0")}`, ptNew: "", ptOld: "", apttNew: "", apttOld: "", fibNew: "", fibOld: "" }])}>
                        <PlusCircle size={12} className="mr-1" />Add Row
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              ) : studyType === "precision" ? (
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
                        <p className="text-xs font-medium">Advanced: EP15 ANOVA</p>
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
              {filledLevels >= (studyType === "precision" ? 1 : 3) ? <span className="text-green-600 dark:text-green-400">✓ {filledLevels} {studyType === "lot_to_lot" || studyType === "pt_coag" ? "specimen" : "level"}{filledLevels !== 1 ? "s" : ""} ready</span> : <span>{filledLevels} / {studyType === "precision" ? 1 : 3} minimum filled</span>}
            </div>
            <Button onClick={handleSubmit} disabled={saveMutation.isPending || filledLevels < 3 || !testName.trim()} size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" data-testid="button-submit-study">
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
          <p className="text-muted-foreground text-center mb-4">No hidden fees. Cancel anytime.</p>

          {/* Payment result banners */}
          {paymentStatus === "success" && (
            <Alert className="mb-6 max-w-2xl mx-auto border-green-500/30 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-700 dark:text-green-400 font-medium">
                Payment successful. Your account has been updated. Thank you!
              </AlertDescription>
            </Alert>
          )}
          {paymentStatus === "cancelled" && (
            <Alert className="mb-6 max-w-2xl mx-auto border-yellow-500/30 bg-yellow-500/10">
              <XCircle className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-yellow-700 dark:text-yellow-400">
                Payment cancelled. No charge was made.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {plans.map(plan => {
              const isLoading = checkoutLoading === plan.priceType;
              return (
                <Card key={plan.name} className={`relative border-2 ${plan.highlight ? "border-primary bg-primary/5" : "border-border"}`}>
                  {plan.badge && <div className="absolute -top-3 left-1/2 -translate-x-1/2"><Badge className="bg-primary text-primary-foreground">{plan.badge}</Badge></div>}
                  <CardContent className="p-6">
                    <h3 className="font-bold text-lg mb-1">{plan.name}</h3>
                    <div className="flex items-baseline gap-1.5 mb-1">
                      <span className="text-3xl font-bold">{plan.price}</span>
                      {plan.unit !== "one-time" && <span className="text-sm text-muted-foreground">/{plan.unit.split("per ")[1]}</span>}
                    </div>
                    {discountApplied && plan.priceType !== "perStudy" && (
                      <p className="text-xs text-green-600 dark:text-green-400 font-semibold mb-1">
                        {discountApplied.pct}% off with code {discountApplied.code}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                    <TooltipProvider delayDuration={150}>
                      <ul className="space-y-2 mb-5">
                        {plan.features.map(f => {
                          const tip = featureTooltips[f];
                          return (
                            <li key={f} className="flex items-center gap-2 text-sm">
                              <CheckCircle2 size={13} className="text-primary shrink-0" />
                              {tip ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="cursor-help border-b border-dotted border-muted-foreground/40 inline-flex items-center gap-1">
                                      {f}
                                      <HelpCircle size={11} className="text-muted-foreground/50 shrink-0" />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    collisionPadding={8}
                                    showArrow
                                    className="max-w-[250px] bg-zinc-900 dark:bg-zinc-800 text-white text-xs leading-relaxed border-zinc-700 px-3 py-2"
                                  >
                                    {tip}
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <span>{f}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </TooltipProvider>
                    <Button
                      className={`w-full ${plan.highlight ? "bg-primary hover:bg-primary/90 text-primary-foreground" : ""}`}
                      variant={plan.highlight ? "default" : "outline"}
                      disabled={isLoading || checkoutLoading !== null}
                      onClick={() => handleBuy(plan.priceType)}
                    >
                      {isLoading ? <><Loader2 size={14} className="mr-2 animate-spin" />Redirecting…</> : plan.cta}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Enterprise callout */}
          <div className="max-w-5xl mx-auto mt-8">
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 flex items-start gap-4">
              <Shield size={20} className="text-primary mt-0.5 shrink-0" />
              <div>
                <div className="font-semibold text-sm mb-1">
                  Enterprise: <span className="text-primary">Custom pricing</span>
                </div>
                <p className="text-sm text-muted-foreground mb-2">
                  Unlimited users, multiple sites. Contact us for a custom quote.
                </p>
                <Link href="/contact" className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium">
                  Contact Us <ChevronRight size={13} />
                </Link>
              </div>
            </div>
          </div>

          {/* Data retention trust signal */}
          <div className="max-w-5xl mx-auto mt-6">
            <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 text-center">
              <p className="text-sm text-emerald-800 dark:text-emerald-200 font-medium">
                All plans include 2 years of read-only data access after cancellation.
              </p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                Your data is always safe. Cancel anytime and keep viewing your studies, maps, scans, and reports.
              </p>
            </div>
          </div>

          {/* Discount code input */}
          <div className="max-w-sm mx-auto mt-6">
            <p className="text-xs text-center text-muted-foreground mb-2">Have a discount code?</p>
            <div className="flex gap-2">
              <Input
                placeholder="Enter code"
                value={discountCode}
                onChange={e => { setDiscountCode(e.target.value.toUpperCase()); setDiscountApplied(null); setDiscountError(""); }}
                className="text-sm uppercase"
                maxLength={20}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={discountLoading || !discountCode.trim()}
                onClick={() => applyDiscount("professional")}
                className="shrink-0"
              >
                {discountLoading ? <Loader2 size={13} className="animate-spin" /> : "Apply"}
              </Button>
            </div>
            {discountApplied && (
              <div className="mt-2 flex items-center gap-1.5 text-green-600 dark:text-green-400 text-sm">
                <CheckCircle2 size={13} />
                <span><strong>{discountApplied.code}</strong>: {discountApplied.pct}% off applied via {discountApplied.partnerName}</span>
              </div>
            )}
            {discountError && (
              <p className="mt-2 text-sm text-red-500">{discountError}</p>
            )}
          </div>

          {/* Suite links */}
          <div className="max-w-5xl mx-auto mt-4 flex justify-center gap-6">
            <Link href="/veritascan" className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium">
              VeritaScan <ChevronRight size={13} />
            </Link>
            <Link href="/veritamap" className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium">
              VeritaMap <ChevronRight size={13} />
            </Link>
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Questions? <a href="/#/contact" className="text-primary hover:underline">Contact us</a> - we're happy to help.
          </p>
        </div>
      </section>
      <CLIALookupModal
        open={cliaModalOpen}
        onClose={() => setCliaModalOpen(false)}
        onCheckout={handleCliaCheckout}
        discountCode={discountApplied?.code}
      />
    </div>
  );
}
