import { useSEO } from "@/hooks/useSEO";
import { useState, useEffect, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import { useLocation, useSearch, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PlusCircle, Trash2, FlaskConical, CheckCircle2, DollarSign, Loader2, XCircle, LayoutDashboard, BookOpen, ChevronRight, Shield, Info, HelpCircle, Upload, AlertTriangle, FileSpreadsheet, ClipboardCheck, Activity } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import CLIALookupModal from "@/components/CLIALookupModal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { calculateStudy, calculatePrecision, calculateLotToLot, calculatePTCoag, calculateQCRange, calculateMultiAnalyteCoag, calculateRefInterval, calculateQualitative, calculateSemiQuant, type DataPoint, type PrecisionDataPoint, type LotToLotDataPoint, type QCRangeDataPoint, type RefIntervalDataPoint, calculateINR } from "@/lib/calculations";
import { teaData } from "@/lib/cliaTeaData";
import { useAuth } from "@/components/AuthContext";
import { authHeaders } from "@/lib/auth";
import type { InsertStudy } from "@shared/schema";

const API_BASE = "https://www.veritaslabservices.com";

// CLIA 2025 Proficiency Testing Acceptance Limits (42 CFR Part 493 Subpart K)
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
  { label: "Blood Gas pH (±0.04)",                     value: 0.04,  isPercentage: false, unit: "pH units", cfr: "42 CFR §493.931" },
  { label: "Calcium, Total (±1.0 mg/dL)",              value: 1.0,   isPercentage: false, unit: "mg/dL",    cfr: "42 CFR §493.931" },
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
  { label: "Potassium (±0.3 mmol/L)",                  value: 0.3,   isPercentage: false, unit: "mmol/L",   cfr: "42 CFR §493.931" },
  { label: "PSA, Total (±20% or ±0.2 ng/mL)",         value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "Sodium (±4 mmol/L)",                       value: 4,     isPercentage: false, unit: "mmol/L",   cfr: "42 CFR §493.931" },
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
  "All study types included": "Covers calibration verification/linearity, correlation/method comparison, accuracy & precision, and lot-to-lot verification study types.",
  "CLIA pass/fail evaluation": "Each study is automatically evaluated against CLIA allowable total error (TEa) and returns a clear Pass or Fail result.",
  // Starter
  "Unlimited studies": "Run as many EP studies as your lab needs - no per-study charges.",
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
  "Consulting access": "Direct access to Michael Veri for compliance questions - the same expertise behind 200+ facility inspections as a Joint Commission Surveyor.",
  "Lab Management 101 book included": "Digital copy of Lab Management 101 by Michael Veri included with your subscription.",
};

const plans = [
  { priceType: "perStudy",        name: "Per Study",              price: "$25",    unit: "one-time",  description: "Pay as you go. No subscription required.",                                                                               features: ["Single study run", "Full PDF report", "All study types included", "CLIA pass/fail evaluation"],                                                                                  cta: "Buy a Study",    highlight: false, badge: null },
  { priceType: "veritacheck_only", name: "VeritaCheck™ Unlimited", price: "$299",   unit: "per year",  description: "Single user. Method validation suite only. No CLIA number required.",                                                    features: ["Unlimited studies", "All VeritaCheck study types", "Full PDF reports", "Study history dashboard"],                                                                                                    cta: "Subscribe",      highlight: false, badge: null },
  { priceType: "clinic",          name: "Clinic",                 price: "$499",   unit: "per year",  description: "Certificate of Waiver labs and small clinics.",                                                                           features: ["2 seats included", "Full VeritaAssure™ suite, all modules", "VeritaMap™ regulatory mapping", "VeritaScan™ self-inspection audit", "VeritaComp™ competency management", "CLIA number on all reports"],                                                                                                 cta: "Subscribe",      highlight: false, badge: null },
  { priceType: "community",       name: "Community",              price: "$999",   unit: "per year",  description: "Community hospitals and independent labs.",                                                                              features: ["5 seats included", "Full VeritaAssure™ suite, all modules", "VeritaStaff™ personnel management", "CLIA number on all reports", "Complimentary 1-hour onboarding session via Zoom or Teams with a VeritaAssure™ specialist"],                                                                   cta: "Subscribe",      highlight: true,  badge: "Most Popular" },
  { priceType: "hospital",        name: "Hospital",               price: "$1,999", unit: "per year",  description: "Regional and acute care hospital labs.",                                                                                 features: ["15 seats included", "Everything in Community", "Priority support", "Complimentary 1-hour onboarding session via Zoom or Teams with a VeritaAssure™ specialist"],                                                                                                                             cta: "Subscribe",      highlight: false, badge: null },
  { priceType: "enterprise",      name: "Enterprise",             price: "$2,999", unit: "per year",  description: "Large hospitals, health systems, and reference labs.",                                                                   features: ["25 seats included", "Everything in Hospital", "Priority support", "Consulting access", "Complimentary 1-hour onboarding session via Zoom or Teams with a VeritaAssure™ specialist"],                                                                                                          cta: "Subscribe",      highlight: false, badge: null },
];

export default function VeritaCheckPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { isLoggedIn, user } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<"success" | "cancelled" | null>(null);
  const [discountCode, setDiscountCode] = useState("");
  const [discountApplied, setDiscountApplied] = useState<{ code: string; pct: number; partnerName: string; trialDays?: number } | null>(null);
  const [discountLoading, setDiscountLoading] = useState(false);
  const [discountError, setDiscountError] = useState("");
  const [cliaModalOpen, setCliaModalOpen] = useState(false);
  const [phiBannerDismissed, setPhiBannerDismissed] = useState(false);

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
  const CLIA_REQUIRED_PLANS = new Set(["clinic", "community", "hospital", "enterprise"]);

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
        setDiscountApplied({ code: discountCode.trim().toUpperCase(), pct: data.discountPct, partnerName: data.partnerName, trialDays: data.trialDays });
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
    "ref_interval": "ref_interval",
    "reference_interval": "ref_interval",
    "reportable_range": "cal_ver",
  };
  const rawInitialStudyType = (prePopStudyType && studyTypeMap[prePopStudyType]) || "cal_ver";
  const initialStudyType = rawInitialStudyType;
  const initialInstruments = prePopInst1 && prePopInst2 ? [prePopInst1, prePopInst2] : prePopInst1 ? [prePopInst1, "Instrument 2"] : ["Instrument 1", "Instrument 2"];

  const [studyType, setStudyType] = useState<"cal_ver" | "method_comparison" | "precision" | "lot_to_lot" | "pt_coag" | "qc_range" | "multi_analyte_coag" | "ref_interval">(initialStudyType);
  const [instrumentNames, setInstrumentNames] = useState<string[]>(initialInstruments);
  const [veritaMapInstruments, setVeritaMapInstruments] = useState<{ name: string; category: string }[]>([]);
  const [veritaMapLoaded, setVeritaMapLoaded] = useState(false);

  // Reset PHI banner when study type changes (new study started)
  useEffect(() => { setPhiBannerDismissed(false); }, [studyType]);

  // Fetch VeritaMap instruments for method_comparison smart dropdown
  useEffect(() => {
    if (!isLoggedIn || veritaMapLoaded) return;
    (async () => {
      try {
        const mapsRes = await fetch(`${API_BASE}/api/veritamap/maps`, { headers: authHeaders() });
        if (!mapsRes.ok) { setVeritaMapLoaded(true); return; }
        const maps = await mapsRes.json();
        const allInstruments: { name: string; category: string }[] = [];
        for (const map of maps) {
          try {
            const instRes = await fetch(`${API_BASE}/api/veritamap/maps/${map.id}/instruments`, { headers: authHeaders() });
            if (instRes.ok) {
              const instruments = await instRes.json();
              for (const inst of instruments) {
                if (inst.instrument_name && !allInstruments.some(i => i.name === inst.instrument_name)) {
                  allInstruments.push({ name: inst.instrument_name, category: inst.category || "" });
                }
              }
            }
          } catch { /* skip this map */ }
        }
        setVeritaMapInstruments(allInstruments);
      } catch { /* no VeritaMap data */ }
      setVeritaMapLoaded(true);
    })();
  }, [isLoggedIn, veritaMapLoaded]);

  const [cliaPreset, setCliaPreset] = useState(0);
  const [customClia, setCustomClia] = useState(0.075);
  const [numLevels, setNumLevels] = useState(DEFAULT_LEVELS);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>(makeEmptyPoints(["Instrument 1", "Instrument 2"], DEFAULT_LEVELS));

  // Qualitative / Semi-Quantitative assay type state
  type AssayType = "quantitative" | "qualitative" | "semi_quantitative";
  const [assayType, setAssayType] = useState<AssayType>("quantitative");
  const GRADE_PRESETS: Record<string, string[]> = {
    plus: ["Negative", "1+", "2+", "3+", "4+"],
    urinalysis: ["Negative", "Trace", "Small", "Moderate", "Large"],
  };
  const [gradePreset, setGradePreset] = useState<"plus" | "urinalysis" | "custom">("plus");
  const [customGrades, setCustomGrades] = useState<string[]>(["Negative", "1+", "2+", "3+", "4+"]);
  const [qualCategories, setQualCategories] = useState<string[]>(["Positive", "Negative"]);
  const [qualPassThreshold, setQualPassThreshold] = useState(0.90);
  const [semiQuantPassThreshold, setSemiQuantPassThreshold] = useState(0.80);

  const activeGradeScale = gradePreset === "custom" ? customGrades : GRADE_PRESETS[gradePreset];
  const activeCategories = assayType === "qualitative" ? qualCategories : activeGradeScale;

  // Auto-detect qualitative mode from CLIA TEa selection
  useEffect(() => {
    if (studyType !== "method_comparison") return;
    const preset = CLIA_PRESETS[cliaPreset];
    if (!preset || preset.value === 0) return;
    // Match against teaData qualitative flag
    const matchedAnalyte = teaData.find(a =>
      preset.label.toLowerCase().includes(a.analyte.toLowerCase().split(" ")[0].toLowerCase()) ||
      a.analyte.toLowerCase().includes(preset.label.split(" (")[0].toLowerCase())
    );
    if (matchedAnalyte?.qualitative) {
      const criteria = matchedAnalyte.criteria.toLowerCase();
      if (criteria.includes("graduation") || criteria.includes("semi-quantitative") || criteria.includes("grade")) {
        setAssayType("semi_quantitative");
      } else {
        setAssayType("qualitative");
      }
      // Set pass threshold based on specialty
      if (matchedAnalyte.specialty === "Immunohematology" || criteria.includes("100%")) {
        setQualPassThreshold(1.0);
      } else {
        setQualPassThreshold(0.90);
      }
    }
  }, [cliaPreset, studyType]);

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

  // Reference Range state
  const [refAnalyte, setRefAnalyte] = useState("");
  const [refUnits, setRefUnits] = useState("");
  const [refLow, setRefLow] = useState<number | "">("");
  const [refHigh, setRefHigh] = useState<number | "">("");
  const [refNumSpecimens, setRefNumSpecimens] = useState(20);
  const [refData, setRefData] = useState<RefIntervalDataPoint[]>(
    Array.from({ length: 20 }, (_, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, value: null }))
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

  // CSV Import state
  type CsvImportStep = "upload" | "mapping" | "preview" | "done";
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvStep, setCsvStep] = useState<CsvImportStep>("upload");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [csvMapping, setCsvMapping] = useState<Record<string, string>>({});
  const [csvErrors, setCsvErrors] = useState<string[]>([]);
  const [csvWarnings, setCsvWarnings] = useState<string[]>([]);
  const [csvConfirmReplace, setCsvConfirmReplace] = useState(false);
  const csvFileRef = useRef<HTMLInputElement>(null);

  const processImportedData = (headers: string[], rows: string[][]) => {
      setCsvHeaders(headers);
      setCsvRows(rows);
      setCsvErrors([]);
      setCsvWarnings([]);
      // Auto-detect column mappings
      const autoMap: Record<string, string> = {};
      const lowerHeaders = headers.map(h => h.toLowerCase());
      if (studyType === "method_comparison") {
        const primaryKeys = ["primary", "instrument 1", "method 1", "result 1", "reference"];
        const compKeys = ["comparison", "instrument 2", "method 2", "result 2", "test"];
        const sampleKeys = ["sample", "specimen", "id", "sample id", "specimen id"];
        for (let i = 0; i < lowerHeaders.length; i++) {
          const h = lowerHeaders[i];
          if (!autoMap.primary && primaryKeys.some(k => h.includes(k))) autoMap.primary = headers[i];
          if (!autoMap.comparison && compKeys.some(k => h.includes(k))) autoMap.comparison = headers[i];
          if (!autoMap.sampleId && sampleKeys.some(k => h.includes(k))) autoMap.sampleId = headers[i];
        }
        // Fallback: if columns have "result" or "value", assign first to primary, second to comparison
        if (!autoMap.primary || !autoMap.comparison) {
          const resultCols = headers.filter((_, i) => lowerHeaders[i].includes("result") || lowerHeaders[i].includes("value"));
          if (resultCols.length >= 2) {
            if (!autoMap.primary) autoMap.primary = resultCols[0];
            if (!autoMap.comparison) autoMap.comparison = resultCols[1];
          }
        }
      } else {
        // cal_ver
        const assignedKeys = ["assigned", "expected", "target", "nominal", "known"];
        const measuredKeys = ["measured", "instrument", "result", "observed", "actual"];
        const levelKeys = ["level", "concentration", "tier"];
        for (let i = 0; i < lowerHeaders.length; i++) {
          const h = lowerHeaders[i];
          if (!autoMap.assigned && assignedKeys.some(k => h.includes(k))) autoMap.assigned = headers[i];
          if (!autoMap.measured && measuredKeys.some(k => h.includes(k))) autoMap.measured = headers[i];
          if (!autoMap.levelLabel && levelKeys.some(k => h.includes(k))) autoMap.levelLabel = headers[i];
        }
      }
      setCsvMapping(autoMap);
      setCsvStep("mapping");
  };

  const parseImportFile = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
          if (rawRows.length < 2) {
            setCsvErrors(["File must contain at least a header row and one data row."]);
            return;
          }
          const headers = rawRows[0].map((c: any) => String(c ?? "").trim());
          const rows = rawRows.slice(1)
            .map(r => headers.map((_, i) => String(r[i] ?? "").trim()))
            .filter(r => r.some(c => c));
          processImportedData(headers, rows);
        } catch {
          setCsvErrors(["Could not read this Excel file. Please check the file and try again."]);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // CSV / TSV / TXT
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) {
          setCsvErrors(["File must contain at least a header row and one data row."]);
          return;
        }
        let delimiter = ",";
        const commaCount = (lines[0].match(/,/g) || []).length;
        if (commaCount === 0) {
          const tabCount = (lines[0].match(/\t/g) || []).length;
          if (tabCount > 0) delimiter = "\t";
        }
        const parseLine = (line: string) => {
          const cells: string[] = [];
          let current = "";
          let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
              if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
              else if (ch === '"') { inQuotes = false; }
              else { current += ch; }
            } else {
              if (ch === '"') { inQuotes = true; }
              else if (ch === delimiter) { cells.push(current.trim()); current = ""; }
              else { current += ch; }
            }
          }
          cells.push(current.trim());
          return cells;
        };
        const headers = parseLine(lines[0]);
        const rows = lines.slice(1).map(parseLine).filter(r => r.some(c => c.trim()));
        processImportedData(headers, rows);
      };
      reader.readAsText(file);
    }
  };

  const validateCsvMapping = () => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (studyType === "method_comparison") {
      if (!csvMapping.primary) errors.push("Please select the Primary instrument column.");
      if (!csvMapping.comparison) errors.push("Please select the Comparison instrument column.");
      if (csvMapping.primary && csvMapping.comparison && csvMapping.primary === csvMapping.comparison) {
        errors.push("Primary and Comparison columns must be different.");
      }
    } else {
      if (!csvMapping.assigned) errors.push("Please select the Assigned/Expected value column.");
      if (!csvMapping.measured) errors.push("Please select the Measured/Instrument result column.");
      if (csvMapping.assigned && csvMapping.measured && csvMapping.assigned === csvMapping.measured) {
        errors.push("Assigned and Measured columns must be different.");
      }
    }
    if (errors.length > 0) { setCsvErrors(errors); return false; }
    // Validate data values
    const primaryCol = studyType === "method_comparison" ? csvMapping.primary : csvMapping.assigned;
    const secondCol = studyType === "method_comparison" ? csvMapping.comparison : csvMapping.measured;
    const priIdx = csvHeaders.indexOf(primaryCol!);
    const secIdx = csvHeaders.indexOf(secondCol!);
    let validRows = 0;
    csvRows.forEach((row, rowNum) => {
      const priVal = row[priIdx]?.trim();
      const secVal = row[secIdx]?.trim();
      if (!priVal && !secVal) return; // skip blank rows
      if (!priVal) errors.push(`Row ${rowNum + 2}: Missing ${studyType === "method_comparison" ? "Primary" : "Assigned"} value.`);
      else if (isNaN(parseFloat(priVal))) errors.push(`Row ${rowNum + 2}: "${priVal}" is not a valid number.`);
      else if (parseFloat(priVal) < 0) warnings.push(`Row ${rowNum + 2}: Negative value (${priVal}) in ${studyType === "method_comparison" ? "Primary" : "Assigned"} column.`);
      if (!secVal) errors.push(`Row ${rowNum + 2}: Missing ${studyType === "method_comparison" ? "Comparison" : "Measured"} value.`);
      else if (isNaN(parseFloat(secVal))) errors.push(`Row ${rowNum + 2}: "${secVal}" is not a valid number.`);
      else if (parseFloat(secVal) < 0) warnings.push(`Row ${rowNum + 2}: Negative value (${secVal}) in ${studyType === "method_comparison" ? "Comparison" : "Measured"} column.`);
      if (priVal && secVal && !isNaN(parseFloat(priVal)) && !isNaN(parseFloat(secVal))) validRows++;
    });
    setCsvErrors(errors.slice(0, 10)); // cap at 10 errors
    setCsvWarnings(warnings.slice(0, 5));
    return errors.length === 0 && validRows > 0;
  };

  const getCsvPreviewRows = () => {
    const primaryCol = studyType === "method_comparison" ? csvMapping.primary : csvMapping.assigned;
    const secondCol = studyType === "method_comparison" ? csvMapping.comparison : csvMapping.measured;
    const idCol = studyType === "method_comparison" ? csvMapping.sampleId : csvMapping.levelLabel;
    const priIdx = csvHeaders.indexOf(primaryCol!);
    const secIdx = csvHeaders.indexOf(secondCol!);
    const idIdx = idCol ? csvHeaders.indexOf(idCol) : -1;
    return csvRows.slice(0, 5).map(row => ({
      id: idIdx >= 0 ? row[idIdx] || "" : "",
      primary: row[priIdx] || "",
      secondary: row[secIdx] || "",
    }));
  };

  const getValidCsvRowCount = () => {
    const primaryCol = studyType === "method_comparison" ? csvMapping.primary : csvMapping.assigned;
    const secondCol = studyType === "method_comparison" ? csvMapping.comparison : csvMapping.measured;
    const priIdx = csvHeaders.indexOf(primaryCol!);
    const secIdx = csvHeaders.indexOf(secondCol!);
    return csvRows.filter(row => {
      const p = row[priIdx]?.trim();
      const s = row[secIdx]?.trim();
      return p && s && !isNaN(parseFloat(p)) && !isNaN(parseFloat(s));
    }).length;
  };

  const executeCsvImport = () => {
    const primaryCol = studyType === "method_comparison" ? csvMapping.primary : csvMapping.assigned;
    const secondCol = studyType === "method_comparison" ? csvMapping.comparison : csvMapping.measured;
    const priIdx = csvHeaders.indexOf(primaryCol!);
    const secIdx = csvHeaders.indexOf(secondCol!);
    const validRows = csvRows.filter(row => {
      const p = row[priIdx]?.trim();
      const s = row[secIdx]?.trim();
      return p && s && !isNaN(parseFloat(p)) && !isNaN(parseFloat(s));
    });
    if (studyType === "method_comparison") {
      const inst1 = instrumentNames[0] || "Instrument 1";
      const inst2 = instrumentNames[1] || "Instrument 2";
      const newPoints: DataPoint[] = validRows.map((row, i) => ({
        level: i + 1,
        expectedValue: null,
        instrumentValues: {
          [inst1]: parseFloat(row[priIdx]),
          [inst2]: parseFloat(row[secIdx]),
          ...Object.fromEntries(instrumentNames.slice(2).map(n => [n, null])),
        },
      }));
      // Pad to at least MIN_LEVELS
      while (newPoints.length < MIN_LEVELS) {
        newPoints.push({
          level: newPoints.length + 1,
          expectedValue: null,
          instrumentValues: Object.fromEntries(instrumentNames.map(n => [n, null])),
        });
      }
      setNumLevels(newPoints.length);
      setDataPoints(newPoints);
    } else {
      // cal_ver
      const inst1 = instrumentNames[0] || "Instrument 1";
      const newPoints: DataPoint[] = validRows.map((row, i) => ({
        level: i + 1,
        expectedValue: parseFloat(row[priIdx]),
        instrumentValues: {
          [inst1]: parseFloat(row[secIdx]),
          ...Object.fromEntries(instrumentNames.slice(1).map(n => [n, null])),
        },
      }));
      while (newPoints.length < MIN_LEVELS) {
        newPoints.push({
          level: newPoints.length + 1,
          expectedValue: null,
          instrumentValues: Object.fromEntries(instrumentNames.map(n => [n, null])),
        });
      }
      setNumLevels(newPoints.length);
      setDataPoints(newPoints);
    }
    toast({ title: `${validRows.length} rows imported successfully`, description: "Review the data grid and edit any values as needed." });
    setCsvStep("done");
    setCsvModalOpen(false);
    // Reset for next use
    setCsvConfirmReplace(false);
  };

  const resetCsvState = () => {
    setCsvStep("upload");
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvMapping({});
    setCsvErrors([]);
    setCsvWarnings([]);
    setCsvConfirmReplace(false);
    if (csvFileRef.current) csvFileRef.current.value = "";
  };

  // When switching to method_comparison, default to 20 samples (EP9 minimum)
  useEffect(() => {
    if (studyType === "method_comparison" && numLevels === DEFAULT_LEVELS) {
      setNumLevels(20);
      setDataPoints(prev => resizeDataPoints(prev, instrumentNames, 20));
    }
  }, [studyType]);

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
  const teaIsPercentage = (CLIA_PRESETS[cliaPreset] as any).isPercentage !== false;
  const teaUnit = (CLIA_PRESETS[cliaPreset] as any).unit || '%';

  const handleGridKeyDown = (e: React.KeyboardEvent, row: number, col: number) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    e.stopPropagation();
    const numRows = dataPoints.length;
    const numCols = studyType === "method_comparison" ? instrumentNames.length : instrumentNames.length + 1; // method_comparison has no Expected column
    let nextRow = row;
    let nextCol = col;
    if (e.shiftKey) {
      nextRow = row - 1;
      if (nextRow < 0) { nextRow = numRows - 1; nextCol = col - 1; }
      if (nextCol < 0) return;
    } else {
      nextRow = row + 1;
      if (nextRow >= numRows) { nextRow = 0; nextCol = col + 1; }
      if (nextCol >= numCols) return;
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
    const maxInst = studyType === "method_comparison" ? 5 : 3;
    if (instrumentNames.length >= maxInst) { toast({ title: `Maximum ${maxInst} instruments supported` }); return; }
    const newName = studyType === "method_comparison"
      ? `Comparison ${instrumentNames.length}`
      : `Instrument ${instrumentNames.length + 1}`;
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

  const updateCategoricalDataPoint = (levelIdx: number, field: string, value: string) => {
    setDataPoints(prev => prev.map((dp, i) => {
      if (i !== levelIdx) return dp;
      if (field === "expectedCategory") return { ...dp, expectedCategory: value || null };
      return { ...dp, instrumentCategories: { ...(dp.instrumentCategories || {}), [field]: value || null } };
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
    : studyType === "ref_interval"
    ? refData.filter(dp => dp.value !== null && !isNaN(dp.value as number)).length
    : studyType === "method_comparison" && assayType !== "quantitative"
    ? dataPoints.filter(dp => dp.expectedCategory && instrumentNames.slice(1).some(n => dp.instrumentCategories?.[n])).length
    : studyType === "method_comparison"
    ? dataPoints.filter(dp => instrumentNames.filter(n => dp.instrumentValues[n] !== null).length >= 2).length
    : dataPoints.filter(dp => dp.expectedValue !== null && instrumentNames.some(n => dp.instrumentValues[n] !== null)).length;

  const saveMutation = useMutation({
    mutationFn: async (study: InsertStudy) => {
      const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders() };
      return fetch(`${API_BASE}/api/studies`, { method: "POST", headers, body: JSON.stringify(study) });
    },
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
      const verificationId = prePopParams.get("verificationId");
      const verificationElement = prePopParams.get("element");
      const verificationSlot = prePopParams.get("slotId");
      if (verificationId && verificationElement && verificationSlot) {
        navigate(`/study/${data.id}/results?verificationId=${verificationId}&element=${verificationElement}&slotId=${verificationSlot}&studyPassed=${data.status === "pass" ? "1" : "0"}`);
      } else {
        navigate(`/study/${data.id}/results`);
      }
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
        testName: testName.trim(), instrument: instrumentNames[0] || "-", analyst: analyst.trim() || "-",
        date, studyType: "lot_to_lot", cliaAllowableError: cliaValue,
        teaIsPercentage: teaIsPercentage ? 1 : 0, teaUnit,
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
        testName: testName.trim(), instrument: ptInstrumentName, analyst: analyst.trim() || "-",
        date, studyType: "pt_coag", cliaAllowableError: ptModule2TEa,
        teaIsPercentage: 1, teaUnit: '%',
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
        testName: testName.trim(), instrument: qcAnalyzers.join(", "), analyst: analyst.trim() || "-",
        date, studyType: "qc_range", cliaAllowableError: 0.10,
        teaIsPercentage: 1, teaUnit: '%',
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
        testName: testName.trim(), instrument: maInstrument, analyst: analyst.trim() || "-",
        date, studyType: "multi_analyte_coag", cliaAllowableError: maTeaPT,
        teaIsPercentage: 1, teaUnit: '%',
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

    if (studyType === "ref_interval") {
      if (refLow === "" || refHigh === "") { toast({ title: "Please enter reference range low and high values", variant: "destructive" }); return; }
      const lo = Number(refLow);
      const hi = Number(refHigh);
      if (lo >= hi) { toast({ title: "Reference range low must be less than high", variant: "destructive" }); return; }
      const validData = refData.filter(dp => dp.value !== null && !isNaN(dp.value as number));
      if (validData.length < 20) { toast({ title: `Please enter at least 20 specimen values (${validData.length} entered)`, variant: "destructive" }); return; }
      const results = calculateRefInterval(refData, lo, hi, refAnalyte, refUnits);
      const study: InsertStudy = {
        testName: testName.trim(), instrument: instrumentNames[0] || "-", analyst: analyst.trim() || "-",
        date, studyType: "ref_interval", cliaAllowableError: 0.1,
        teaIsPercentage: 1, teaUnit: '%',
        dataPoints: JSON.stringify({ specimens: refData.map(d => ({ specimenId: d.specimenId, value: d.value })), refLow: lo, refHigh: hi, analyte: refAnalyte, units: refUnits }),
        instruments: JSON.stringify(instrumentNames.slice(0, 1)),
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
        testName: testName.trim(), instrument: instrumentNames[0] || "-", analyst: analyst.trim() || "-",
        date, studyType: "precision", cliaAllowableError: cliaValue,
        teaIsPercentage: teaIsPercentage ? 1 : 0, teaUnit,
        dataPoints: JSON.stringify(precDataPoints),
        instruments: JSON.stringify(instrumentNames.slice(0, 1)),
        status: results.overallPass ? "pass" : "fail",
        createdAt: new Date().toISOString(),
      };
      saveMutation.mutate(study);
      return;
    }
    if (filledLevels < MIN_LEVELS) { toast({ title: "Please enter at least 3 data points", variant: "destructive" }); return; }

    if (studyType === "method_comparison") {
      if (assayType === "qualitative") {
        // Qualitative method comparison: categorical data
        const comparisonNames = instrumentNames.slice(1);
        const mappedPoints: DataPoint[] = dataPoints.map(dp => ({
          level: dp.level, expectedValue: null, instrumentValues: {},
          expectedCategory: dp.expectedCategory ?? null,
          instrumentCategories: Object.fromEntries(comparisonNames.map(n => [n, dp.instrumentCategories?.[n] ?? null])),
        }));
        const results = calculateQualitative(mappedPoints, comparisonNames, qualCategories, qualPassThreshold);
        const study: InsertStudy = {
          testName: testName.trim(), instrument: instrumentNames.join(", "), analyst: analyst.trim() || "---",
          date, studyType: "method_comparison", cliaAllowableError: cliaValue,
          teaIsPercentage: teaIsPercentage ? 1 : 0, teaUnit,
          dataPoints: JSON.stringify({ assayType: "qualitative", categories: qualCategories, passThreshold: qualPassThreshold, points: dataPoints }),
          instruments: JSON.stringify(instrumentNames), status: results.overallPass ? "pass" : "fail",
          createdAt: new Date().toISOString(),
        };
        saveMutation.mutate(study);
        return;
      }
      if (assayType === "semi_quantitative") {
        // Semi-quantitative method comparison: ordinal grades
        const comparisonNames = instrumentNames.slice(1);
        const mappedPoints: DataPoint[] = dataPoints.map(dp => ({
          level: dp.level, expectedValue: null, instrumentValues: {},
          expectedCategory: dp.expectedCategory ?? null,
          instrumentCategories: Object.fromEntries(comparisonNames.map(n => [n, dp.instrumentCategories?.[n] ?? null])),
        }));
        const results = calculateSemiQuant(mappedPoints, comparisonNames, activeGradeScale, semiQuantPassThreshold);
        const study: InsertStudy = {
          testName: testName.trim(), instrument: instrumentNames.join(", "), analyst: analyst.trim() || "---",
          date, studyType: "method_comparison", cliaAllowableError: cliaValue,
          teaIsPercentage: teaIsPercentage ? 1 : 0, teaUnit,
          dataPoints: JSON.stringify({ assayType: "semi_quantitative", gradeScale: activeGradeScale, passThreshold: semiQuantPassThreshold, points: dataPoints }),
          instruments: JSON.stringify(instrumentNames), status: results.overallPass ? "pass" : "fail",
          createdAt: new Date().toISOString(),
        };
        saveMutation.mutate(study);
        return;
      }
      // Quantitative method comparison (existing behavior)
      const primaryName = instrumentNames[0];
      const comparisonNames = instrumentNames.slice(1);
      const mappedPoints: DataPoint[] = dataPoints.map(dp => ({
        level: dp.level,
        expectedValue: dp.instrumentValues[primaryName] ?? null,
        instrumentValues: Object.fromEntries(comparisonNames.map(n => [n, dp.instrumentValues[n] ?? null])),
      }));
      const results = calculateStudy(mappedPoints, comparisonNames, cliaValue, "method_comparison", teaIsPercentage);
      const study: InsertStudy = {
        testName: testName.trim(), instrument: instrumentNames.join(", "), analyst: analyst.trim() || "---",
        date, studyType: "method_comparison", cliaAllowableError: cliaValue,
        teaIsPercentage: teaIsPercentage ? 1 : 0, teaUnit,
        dataPoints: JSON.stringify(dataPoints),
        instruments: JSON.stringify(instrumentNames), status: results.overallPass ? "pass" : "fail",
        createdAt: new Date().toISOString(),
      };
      saveMutation.mutate(study);
      return;
    }

    const results = calculateStudy(dataPoints, instrumentNames, cliaValue, studyType as "cal_ver" | "method_comparison", teaIsPercentage);
    const study: InsertStudy = {
      testName: testName.trim(), instrument: instrumentNames.join(", "), analyst: analyst.trim() || "---",
      date, studyType, cliaAllowableError: cliaValue,
      teaIsPercentage: teaIsPercentage ? 1 : 0, teaUnit,
      dataPoints: JSON.stringify(dataPoints),
      instruments: JSON.stringify(instrumentNames), status: results.overallPass ? "pass" : "fail",
      createdAt: new Date().toISOString(),
    };
    saveMutation.mutate(study);
  };

    useSEO({ title: "VeritaCheck | CLIA Method Validation Software for Clinical Labs", description: "Run EP studies for accuracy, precision, reportable range, and reference ranges. Generates director-signed, survey-ready verification documentation." });
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
                  <h1 className="font-serif text-5xl font-bold mb-3 leading-tight">VeritaCheck{"™"}</h1>
                  <p className="text-xl text-muted-foreground font-medium mb-5">
                    EP Evaluation and Study Management Platform
                  </p>
                  <div className="border-l-4 border-primary pl-4 mb-6">
                    <p className="text-base leading-relaxed italic text-foreground/90">
                      "The studies your lab has already been running, finally documented the way surveyors expect."
                    </p>
                  </div>
                  <p className="text-muted-foreground leading-relaxed mb-4">
                    VeritaCheck automates calibration verification, method comparison, accuracy and precision, lot-to-lot verification, and PT/coag new lot validation. Every study generates a signed, audit-ready PDF report with scatter plots, statistical analysis, and pass/fail evaluation, mapped to 42 CFR Part 493, TJC standards, and CAP checklists.
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
                      <div className="text-xs text-muted-foreground">VeritaCheck&#8482; Unlimited (single user)</div>
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
                        VeritaCheck{"™"}
                      </div>
                      <div className="text-xs text-white/70 text-center space-y-1 mb-4">
                        <div>Calibration Verification / Linearity</div>
                        <div>Correlation / Method Comparison</div>
                        <div>Accuracy and Precision</div>
                        <div>Lot-to-Lot Verification</div>
                        <div>PT/Coag New Lot Validation</div>
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
                Calibration verification, method comparison, and precision studies, automated and browser-based. CLIA-compliant PDF reports with statistical analysis and pass/fail evaluation mapped to 42 CFR Part 493, TJC standards, and CAP checklists.
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
              <Link href="/dashboard/verifications" className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium gap-1.5 hover:bg-background/60 transition-colors">
                <ClipboardCheck size={13} />Instrument Verification
              </Link>
              <Link href="/veritacheck/cumsum" className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium gap-1.5 hover:bg-background/60 transition-colors">
                <Activity size={13} />CUMSUM Monitoring
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
                          <SelectItem value="pt_coag">PT/Coag New Lot Validation</SelectItem>
                          <SelectItem value="qc_range">QC Range Establishment</SelectItem>
                          <SelectItem value="multi_analyte_coag">Multi-Analyte Lot Comparison (Coag)</SelectItem>
                          <SelectItem value="ref_interval">Reference Range Verification</SelectItem>
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
                  {studyType === "method_comparison" ? "Instruments / Methods" : "Instruments / Methods"}
                  <Button variant="outline" size="sm" onClick={addInstrument} disabled={instrumentNames.length >= (studyType === "method_comparison" ? 5 : 3)}><PlusCircle size={13} className="mr-1" />{studyType === "method_comparison" ? "Add Instrument" : "Add"}</Button>
                </CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {studyType === "method_comparison" ? (
                    <>
                      {instrumentNames.map((name, idx) => (
                        <div key={idx} className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <Badge variant={idx === 0 ? "default" : "outline"} className="shrink-0 text-xs px-2">{idx === 0 ? "Primary" : `Comp ${idx}`}</Badge>
                            <Label className="text-xs text-muted-foreground">
                              {idx === 0 ? "Primary Instrument / Method" : `Comparison Instrument / Method ${idx + 1}`}
                            </Label>
                          </div>
                          {idx === 0 && <p className="text-xs text-muted-foreground ml-1">This instrument serves as the reference for all comparisons.</p>}
                          <div className="flex items-center gap-2">
                            {veritaMapInstruments.length > 0 ? (
                              <div className="flex-1 space-y-1.5">
                                <Select value={veritaMapInstruments.some(i => i.name === name) ? name : "__manual__"} onValueChange={v => { if (v !== "__manual__") updateInstrumentName(idx, v); }}>
                                  <SelectTrigger className="h-9"><SelectValue placeholder="Select from VeritaMap..." /></SelectTrigger>
                                  <SelectContent>
                                    {veritaMapInstruments.map(inst => (
                                      <SelectItem key={inst.name} value={inst.name}>
                                        {inst.name}{inst.category ? ` - ${inst.category}` : ""}
                                      </SelectItem>
                                    ))}
                                    <SelectItem value="__manual__">Or enter manually...</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Input value={name} onChange={e => updateInstrumentName(idx, e.target.value)} placeholder="e.g., Beckman Coulter AU5800" className="text-sm" />
                              </div>
                            ) : (
                              <Input value={name} onChange={e => updateInstrumentName(idx, e.target.value)} placeholder="e.g., Beckman Coulter AU5800" className="flex-1" />
                            )}
                            {idx > 0 && instrumentNames.length > 2 && <Button variant="ghost" size="icon" onClick={() => removeInstrument(idx)} className="text-muted-foreground hover:text-destructive shrink-0 w-8 h-8"><Trash2 size={13} /></Button>}
                          </div>
                        </div>
                      ))}
                    </>
                  ) : (
                    instrumentNames.map((name, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Badge variant="outline" className="w-7 justify-center shrink-0 text-xs">{idx + 1}</Badge>
                        <Input value={name} onChange={e => updateInstrumentName(idx, e.target.value)} placeholder={`Instrument ${idx + 1}`} />
                        {instrumentNames.length > 1 && <Button variant="ghost" size="icon" onClick={() => removeInstrument(idx)} className="text-muted-foreground hover:text-destructive shrink-0 w-8 h-8"><Trash2 size={13} /></Button>}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Assay Type selector - only for method_comparison */}
              {studyType === "method_comparison" && (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">Assay Type</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <Select value={assayType} onValueChange={v => setAssayType(v as AssayType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="quantitative">Quantitative (numeric values)</SelectItem>
                        <SelectItem value="qualitative">Qualitative (Pos/Neg, Reactive/Nonreactive)</SelectItem>
                        <SelectItem value="semi_quantitative">Semi-Quantitative (ordinal grades)</SelectItem>
                      </SelectContent>
                    </Select>
                    {assayType === "qualitative" && (
                      <div className="space-y-2">
                        <Label className="text-xs">Categories</Label>
                        <div className="flex items-center gap-2 flex-wrap">
                          {qualCategories.map((cat, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{cat}</Badge>
                          ))}
                        </div>
                        <Select value={qualCategories.join(",")} onValueChange={v => setQualCategories(v.split(","))}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Positive,Negative">Positive / Negative</SelectItem>
                            <SelectItem value="Reactive,Nonreactive">Reactive / Nonreactive</SelectItem>
                            <SelectItem value="Detected,Not Detected">Detected / Not Detected</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-2 mt-2">
                          <Label className="text-xs">Pass threshold:</Label>
                          <Select value={String(qualPassThreshold)} onValueChange={v => setQualPassThreshold(parseFloat(v))}>
                            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0.90">90%</SelectItem>
                              <SelectItem value="0.95">95%</SelectItem>
                              <SelectItem value="1.00">100% (Blood Bank)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                    {assayType === "semi_quantitative" && (
                      <div className="space-y-2">
                        <Label className="text-xs">Grade Scale Preset</Label>
                        <Select value={gradePreset} onValueChange={v => setGradePreset(v as "plus" | "urinalysis" | "custom")}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="plus">Plus grades (Neg / 1+ / 2+ / 3+ / 4+)</SelectItem>
                            <SelectItem value="urinalysis">Urinalysis (Neg / Trace / Small / Moderate / Large)</SelectItem>
                            <SelectItem value="custom">Custom</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1 flex-wrap">
                          {activeGradeScale.map((g, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{g}</Badge>
                          ))}
                        </div>
                        {gradePreset === "custom" && (
                          <div className="space-y-1">
                            <Label className="text-xs">Custom grades (comma-separated, lowest to highest)</Label>
                            <Input
                              value={customGrades.join(", ")}
                              onChange={e => setCustomGrades(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                              placeholder="Negative, 1+, 2+, 3+, 4+"
                              className="h-8 text-xs"
                            />
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <Label className="text-xs">Pass threshold (+/-1 grade):</Label>
                          <Select value={String(semiQuantPassThreshold)} onValueChange={v => setSemiQuantPassThreshold(parseFloat(v))}>
                            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0.80">80%</SelectItem>
                              <SelectItem value="0.90">90%</SelectItem>
                              <SelectItem value="0.95">95%</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                    {assayType !== "quantitative" && (
                      <div className="flex items-start gap-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                        <Info size={13} className="text-primary shrink-0 mt-0.5" />
                        <span>
                          {assayType === "qualitative"
                            ? "Qualitative mode uses concordance analysis (percent agreement, Cohen's kappa, sensitivity/specificity). Regression and Bland-Altman are not applicable."
                            : "Semi-quantitative mode uses ordinal +/-1 grade acceptance, weighted kappa, and concordance matrix. Regression and Bland-Altman are not applicable."
                          }
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

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
              {!phiBannerDismissed && (
                <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded p-3 text-sm mb-4 flex items-start justify-between gap-3">
                  <span>Reminder: Do not enter patient names, MRNs, dates of birth, or any other protected health information. Use sample IDs only (e.g. S1, S2, or your internal specimen numbering).</span>
                  <button onClick={() => setPhiBannerDismissed(true)} className="shrink-0 text-amber-600 hover:text-amber-900" aria-label="Dismiss">
                    <XCircle size={16} />
                  </button>
                </div>
              )}
              {/* CSV Import Button */}
              <div className="mb-4">
                {(studyType === "method_comparison" || studyType === "cal_ver") ? (
                  <Button variant="outline" size="sm" onClick={() => { resetCsvState(); setCsvModalOpen(true); }}>
                    <Upload size={14} className="mr-1.5" />Import from CSV / Excel
                  </Button>
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0}>
                          <Button variant="outline" size="sm" disabled className="opacity-50">
                            <Upload size={14} className="mr-1.5" />Import from CSV / Excel
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent><p>File import coming soon for this study type.</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
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
                                <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="-" value={dp.currentLot ?? ""} onChange={e => { const d = [...lotData]; d[idx] = { ...d[idx], currentLot: e.target.value === "" ? null : parseFloat(e.target.value) }; setLotData(d); }} className="h-8 text-sm w-28" /></td>
                                <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="-" value={dp.newLot ?? ""} onChange={e => { const d = [...lotData]; d[idx] = { ...d[idx], newLot: e.target.value === "" ? null : parseFloat(e.target.value) }; setLotData(d); }} className="h-8 text-sm w-28" /></td>
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
                                  <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="-" value={dp.currentLot ?? ""} onChange={e => { const d = [...lotDataAbnormal]; d[idx] = { ...d[idx], currentLot: e.target.value === "" ? null : parseFloat(e.target.value) }; setLotDataAbnormal(d); }} className="h-8 text-sm w-28" /></td>
                                  <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="-" value={dp.newLot ?? ""} onChange={e => { const d = [...lotDataAbnormal]; d[idx] = { ...d[idx], newLot: e.target.value === "" ? null : parseFloat(e.target.value) }; setLotDataAbnormal(d); }} className="h-8 text-sm w-28" /></td>
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
                    <CardHeader className="pb-3"><CardTitle className="text-base">Module 1: Normal Patient Mean & Reference Range Verification</CardTitle></CardHeader>
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
                            <Input key={i} type="number" step="any" placeholder="-" value={v ?? ""}
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
                                <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="-" value={dp.x ?? ""} onChange={e => { const d = [...ptModule2Data]; d[idx] = { ...d[idx], x: e.target.value === "" ? null : parseFloat(e.target.value) }; setPtModule2Data(d); }} className="h-8 text-sm w-28" /></td>
                                <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="-" value={dp.y ?? ""} onChange={e => { const d = [...ptModule2Data]; d[idx] = { ...d[idx], y: e.target.value === "" ? null : parseFloat(e.target.value) }; setPtModule2Data(d); }} className="h-8 text-sm w-28" /></td>
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
                                  <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="-" value={dp.x ?? ""} onChange={e => { const d = [...ptModule3Data]; d[idx] = { ...d[idx], x: e.target.value === "" ? null : parseFloat(e.target.value) }; setPtModule3Data(d); }} className="h-8 text-sm w-28" /></td>
                                  <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="-" value={dp.y ?? ""} onChange={e => { const d = [...ptModule3Data]; d[idx] = { ...d[idx], y: e.target.value === "" ? null : parseFloat(e.target.value) }; setPtModule3Data(d); }} className="h-8 text-sm w-28" /></td>
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
                                      <Input key={ri} type="number" step="any" placeholder="-"
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
                                    <Input type="number" step="any" placeholder="-"
                                      value={qcOldLotData[key]?.mean ?? ""}
                                      onChange={e => setQcOldLotData({ ...qcOldLotData, [key]: { ...qcOldLotData[key], mean: e.target.value === "" ? null : parseFloat(e.target.value), sd: qcOldLotData[key]?.sd ?? null } })}
                                      className="h-7 text-xs w-24" />
                                    <div className="text-xs text-muted-foreground">Old lot SD:</div>
                                    <Input type="number" step="any" placeholder="-"
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
                                  <td className="py-1 pr-2"><span className="text-xs font-mono">{ptINR != null ? ptINR.toFixed(2) : "-"}</span></td>
                                  <td className="py-1 pr-2"><Input value={s.ptOld} onChange={e => { const d = [...maSpecimens]; d[idx] = { ...d[idx], ptOld: e.target.value }; setMaSpecimens(d); }} className="h-7 text-xs w-16" /></td>
                                  <td className="py-1 pr-2"><span className={`text-xs font-mono ${ptPct != null && Math.abs(ptPct) > maTeaPT * 100 ? "text-red-500 font-semibold" : ""}`}>{ptPct != null ? ptPct.toFixed(1) + "%" : "-"}</span></td>
                                  <td className="py-1 pr-2"><Input value={s.apttNew} onChange={e => { const d = [...maSpecimens]; d[idx] = { ...d[idx], apttNew: e.target.value }; setMaSpecimens(d); }} className="h-7 text-xs w-16" /></td>
                                  <td className="py-1 pr-2"><Input value={s.apttOld} onChange={e => { const d = [...maSpecimens]; d[idx] = { ...d[idx], apttOld: e.target.value }; setMaSpecimens(d); }} className="h-7 text-xs w-16" /></td>
                                  <td className="py-1 pr-2"><span className={`text-xs font-mono ${apttPct != null && Math.abs(apttPct) > maTeaAPTT * 100 ? "text-red-500 font-semibold" : ""}`}>{apttPct != null ? apttPct.toFixed(1) + "%" : "-"}</span></td>
                                  <td className="py-1 pr-2"><Input value={s.fibNew} onChange={e => { const d = [...maSpecimens]; d[idx] = { ...d[idx], fibNew: e.target.value }; setMaSpecimens(d); }} className="h-7 text-xs w-16" /></td>
                                  <td className="py-1 pr-2"><Input value={s.fibOld} onChange={e => { const d = [...maSpecimens]; d[idx] = { ...d[idx], fibOld: e.target.value }; setMaSpecimens(d); }} className="h-7 text-xs w-16" /></td>
                                  <td className="py-1"><span className={`text-xs font-mono ${fibPct != null && Math.abs(fibPct) > maTeaFib * 100 ? "text-red-500 font-semibold" : ""}`}>{fibPct != null ? fibPct.toFixed(1) + "%" : "-"}</span></td>
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
              ) : studyType === "ref_interval" ? (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">Reference Range Verification Data Entry</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start gap-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                      <Info size={13} className="text-primary shrink-0 mt-0.5" />
                      <span>CLSI EP28-A3c: enter at least 20 reference specimen values. The study passes if no more than 2 of 20 (10%) fall outside the stated reference range.</span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>Analyte Name</Label><Input placeholder="e.g. Sodium" value={refAnalyte} onChange={e => setRefAnalyte(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label>Units</Label><Input placeholder="e.g. mmol/L" value={refUnits} onChange={e => setRefUnits(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label>Reference Range Low *</Label><Input type="number" step="any" placeholder="e.g. 135" value={refLow} onChange={e => setRefLow(e.target.value === "" ? "" : parseFloat(e.target.value))} /></div>
                      <div className="space-y-1.5"><Label>Reference Range High *</Label><Input type="number" step="any" placeholder="e.g. 145" value={refHigh} onChange={e => setRefHigh(e.target.value === "" ? "" : parseFloat(e.target.value))} /></div>
                      <div className="space-y-1.5"><Label>Number of Specimens</Label>
                        <Input type="number" min={20} max={200} value={refNumSpecimens} onChange={e => {
                          const n = Math.max(20, Math.min(200, parseInt(e.target.value) || 20));
                          setRefNumSpecimens(n);
                          setRefData(prev => {
                            if (n > prev.length) return [...prev, ...Array.from({ length: n - prev.length }, (_, i) => ({ specimenId: `S${String(prev.length + i + 1).padStart(3, "0")}`, value: null }))];
                            return prev.slice(0, n);
                          });
                        }} />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Specimen Values</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="border-b border-border">
                            <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium w-24">Specimen ID</th>
                            <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">Result Value</th>
                            <th className="text-left py-2 text-xs text-muted-foreground font-medium">Status</th>
                          </tr></thead>
                          <tbody>
                            {refData.map((dp, idx) => {
                              const val = dp.value;
                              const lo = Number(refLow);
                              const hi = Number(refHigh);
                              const inRange = val !== null && refLow !== "" && refHigh !== "" && val >= lo && val <= hi;
                              const outRange = val !== null && refLow !== "" && refHigh !== "" && (val < lo || val > hi);
                              return (
                                <tr key={idx} className="border-b border-border/50">
                                  <td className="py-1.5 pr-4"><Input value={dp.specimenId} onChange={e => { const d = [...refData]; d[idx] = { ...d[idx], specimenId: e.target.value }; setRefData(d); }} className="h-8 text-sm w-24" /></td>
                                  <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="-" value={dp.value ?? ""} onChange={e => { const d = [...refData]; d[idx] = { ...d[idx], value: e.target.value === "" ? null : parseFloat(e.target.value) }; setRefData(d); }} className="h-8 text-sm w-32" /></td>
                                  <td className="py-1.5">
                                    {inRange && <span className="text-xs text-green-600 dark:text-green-400 font-medium">In range</span>}
                                    {outRange && <span className="text-xs text-red-600 dark:text-red-400 font-medium">Outside</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {refLow !== "" && refHigh !== "" && (() => {
                        const lo = Number(refLow);
                        const hi = Number(refHigh);
                        const filled = refData.filter(d => d.value !== null && !isNaN(d.value as number));
                        const outside = filled.filter(d => (d.value as number) < lo || (d.value as number) > hi).length;
                        const pct = filled.length > 0 ? ((outside / filled.length) * 100).toFixed(1) : "0.0";
                        return filled.length > 0 ? (
                          <div className={`text-xs mt-2 font-medium ${outside / filled.length <= 0.1 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                            {outside} of {filled.length} ({pct}%) outside reference range - EP28-A3c limit: 10%
                          </div>
                        ) : null;
                      })()}
                    </div>
                  </CardContent>
                </Card>
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
                              <Input key={vi} type="number" step="any" placeholder="-"
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
                                        <Input type="number" step="any" placeholder="-"
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
                  <span>{studyType === "method_comparison" ? "Sample Data" : "Data Points"}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-normal">{studyType === "method_comparison" ? "Samples:" : "Levels:"}</span>
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
                    {studyType === "method_comparison" && assayType !== "quantitative" ? (
                      /* Categorical data entry for qualitative / semi-quantitative */
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-border">
                          <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium w-12">Sample</th>
                          <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">
                            <div>{instrumentNames[0]}</div>
                            <div className="text-[10px] text-primary font-normal">(Reference)</div>
                          </th>
                          {instrumentNames.slice(1).map((n) => <th key={n} className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">{n}</th>)}
                        </tr></thead>
                        <tbody>
                          {dataPoints.map((dp, idx) => (
                            <tr key={idx} className="border-b border-border/50">
                              <td className="py-1.5 pr-4"><span className="text-xs text-muted-foreground font-mono">S{dp.level}</span></td>
                              <td className="py-1.5 pr-4">
                                <Select value={dp.expectedCategory || ""} onValueChange={v => updateCategoricalDataPoint(idx, "expectedCategory", v)}>
                                  <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                                  <SelectContent>
                                    {activeCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </td>
                              {instrumentNames.slice(1).map((n) => (
                                <td key={n} className="py-1.5 pr-4">
                                  <Select value={dp.instrumentCategories?.[n] || ""} onValueChange={v => updateCategoricalDataPoint(idx, n, v)}>
                                    <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                                    <SelectContent>
                                      {activeCategories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : studyType === "method_comparison" ? (
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-border">
                          <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium w-12">Sample</th>
                          {instrumentNames.map((n, idx) => <th key={n} className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">
                            <div>{n}</div>
                            {idx === 0 && <div className="text-[10px] text-primary font-normal">(Primary)</div>}
                          </th>)}
                        </tr></thead>
                        <tbody>
                          {dataPoints.map((dp, idx) => (
                            <tr key={idx} className="border-b border-border/50">
                              <td className="py-1.5 pr-4"><span className="text-xs text-muted-foreground font-mono">S{dp.level}</span></td>
                              {instrumentNames.map((n, colIdx) => <td key={n} className="py-1.5 pr-4"><Input type="number" step="any" placeholder="--" value={dp.instrumentValues[n] ?? ""} onChange={e => updateDataPoint(idx, n, e.target.value)} className="h-8 text-sm w-28" ref={setGridRef(idx, colIdx)} onKeyDown={e => handleGridKeyDown(e, idx, colIdx)} /></td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <table className="w-full text-sm">
                        <thead><tr className="border-b border-border">
                          <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium w-12">Lvl</th>
                          <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">Expected</th>
                          {instrumentNames.map(n => <th key={n} className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">{n}</th>)}
                        </tr></thead>
                        <tbody>
                          {dataPoints.map((dp, idx) => (
                            <tr key={idx} className="border-b border-border/50">
                              <td className="py-1.5 pr-4"><span className="text-xs text-muted-foreground font-mono">L{dp.level}</span></td>
                              <td className="py-1.5 pr-4"><Input type="number" step="any" placeholder="--" value={dp.expectedValue ?? ""} onChange={e => updateDataPoint(idx, "expectedValue", e.target.value)} className="h-8 text-sm w-28" ref={setGridRef(idx, 0)} onKeyDown={e => handleGridKeyDown(e, idx, 0)} /></td>
                              {instrumentNames.map((n, colIdx) => <td key={n} className="py-1.5 pr-4"><Input type="number" step="any" placeholder="--" value={dp.instrumentValues[n] ?? ""} onChange={e => updateDataPoint(idx, n, e.target.value)} className="h-8 text-sm w-28" ref={setGridRef(idx, colIdx + 1)} onKeyDown={e => handleGridKeyDown(e, idx, colIdx + 1)} /></td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
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
              {filledLevels >= (studyType === "precision" ? 1 : studyType === "ref_interval" ? 20 : 3) ? <span className="text-green-600 dark:text-green-400">{"✓"} {filledLevels} {studyType === "lot_to_lot" || studyType === "pt_coag" || studyType === "ref_interval" ? "specimen" : studyType === "method_comparison" ? "sample" : "level"}{filledLevels !== 1 ? "s" : ""} ready</span> : <span>{filledLevels} / {studyType === "precision" ? 1 : studyType === "ref_interval" ? 20 : 3} minimum filled</span>}
            </div>
            <Button onClick={handleSubmit} disabled={saveMutation.isPending || filledLevels < (studyType === "ref_interval" ? 20 : 3) || !testName.trim()} size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" data-testid="button-submit-study">
              {saveMutation.isPending ? "Calculating…" : "Run Study & Generate Report"}
            </Button>
          </div>
        </div>
      </section>

      {/* Pricing CTA */}
      <section className="section-padding bg-secondary/20" id="pricing">
        <div className="container-default max-w-2xl text-center">
          <div className="flex items-center justify-center gap-2 mb-3">
            <DollarSign size={18} className="text-primary" />
            <h2 className="font-serif text-2xl font-bold">Ready to Run Unlimited Studies?</h2>
          </div>
          <p className="text-muted-foreground mb-6">
            View our full pricing to find the right plan for your lab.
          </p>

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

          <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
            <Link href="/pricing">
              View Pricing <ChevronRight size={15} className="ml-1" />
            </Link>
          </Button>
        </div>
      </section>
      {/* CSV Import Modal */}
      <Dialog open={csvModalOpen} onOpenChange={(open) => { if (!open) { setCsvModalOpen(false); resetCsvState(); } }}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet size={18} />
              Import from CSV or Excel
            </DialogTitle>
            <DialogDescription>
              {csvStep === "upload" && "Upload a CSV or Excel file exported from your LIS to populate the data entry grid."}
              {csvStep === "mapping" && "Map your file columns to the study fields below."}
              {csvStep === "preview" && "Review the mapped data before importing."}
            </DialogDescription>
          </DialogHeader>

          {/* Step 1: Upload */}
          {csvStep === "upload" && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                onClick={() => csvFileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files[0];
                  if (file && (file.name.endsWith(".csv") || file.name.endsWith(".tsv") || file.name.endsWith(".txt") || file.name.endsWith(".xlsx") || file.name.endsWith(".xls"))) {
                    parseImportFile(file);
                  } else {
                    setCsvErrors(["Please upload a .csv or Excel (.xlsx, .xls) file."]);
                  }
                }}
              >
                <Upload size={32} className="mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm font-medium mb-1">Upload CSV or Excel file</p>
                <p className="text-xs text-muted-foreground">Accepts .csv, .xlsx, and .xls files</p>
              </div>
              <input
                ref={csvFileRef}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls"
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) parseImportFile(file);
                }}
              />
              <div className="bg-muted/50 rounded p-3 text-xs text-muted-foreground space-y-1">
                <p>Export your results from your LIS as a CSV or Excel file (.xlsx, .xls, .csv), then upload it here. Your data will be mapped to the study fields below.</p>
                <p>First row should be column headers. Numeric values only in result columns.</p>
              </div>
              {csvErrors.length > 0 && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded p-3">
                  {csvErrors.map((err, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{err}</p>)}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Column Mapping */}
          {csvStep === "mapping" && (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded p-3 text-xs text-muted-foreground">
                Detected {csvHeaders.length} columns and {csvRows.length} data rows.
              </div>
              <div className="space-y-3">
                {studyType === "method_comparison" ? (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-sm">Which column contains the Primary instrument result?</Label>
                      <Select value={csvMapping.primary || ""} onValueChange={v => setCsvMapping(prev => ({ ...prev, primary: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select column..." /></SelectTrigger>
                        <SelectContent>
                          {csvHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">Which column contains the Comparison instrument result?</Label>
                      <Select value={csvMapping.comparison || ""} onValueChange={v => setCsvMapping(prev => ({ ...prev, comparison: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select column..." /></SelectTrigger>
                        <SelectContent>
                          {csvHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">Which column contains the Sample ID? (optional)</Label>
                      <Select value={csvMapping.sampleId || "_none_"} onValueChange={v => setCsvMapping(prev => ({ ...prev, sampleId: v === "_none_" ? "" : v }))}>
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none_">None</SelectItem>
                          {csvHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-sm">Which column contains the Assigned/Expected value?</Label>
                      <Select value={csvMapping.assigned || ""} onValueChange={v => setCsvMapping(prev => ({ ...prev, assigned: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select column..." /></SelectTrigger>
                        <SelectContent>
                          {csvHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">Which column contains the Measured/Instrument result?</Label>
                      <Select value={csvMapping.measured || ""} onValueChange={v => setCsvMapping(prev => ({ ...prev, measured: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select column..." /></SelectTrigger>
                        <SelectContent>
                          {csvHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-sm">Which column contains the Level label? (optional)</Label>
                      <Select value={csvMapping.levelLabel || "_none_"} onValueChange={v => setCsvMapping(prev => ({ ...prev, levelLabel: v === "_none_" ? "" : v }))}>
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_none_">None</SelectItem>
                          {csvHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </div>
              {csvErrors.length > 0 && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded p-3">
                  {csvErrors.map((err, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{err}</p>)}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => { setCsvStep("upload"); setCsvErrors([]); }}>Back</Button>
                <Button size="sm" onClick={() => { if (validateCsvMapping()) setCsvStep("preview"); }}>
                  Next: Preview
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 3: Preview */}
          {csvStep === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-sm">
                <Badge variant="outline">{getValidCsvRowCount()} valid rows</Badge>
                {csvRows.length > getValidCsvRowCount() && (
                  <span className="text-xs text-amber-600 dark:text-amber-400">{csvRows.length - getValidCsvRowCount()} rows skipped (missing or invalid values)</span>
                )}
              </div>
              <div className="overflow-x-auto border rounded">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      {studyType === "method_comparison" ? (
                        <>
                          {csvMapping.sampleId && <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Sample ID</th>}
                          <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Primary</th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Comparison</th>
                        </>
                      ) : (
                        <>
                          {csvMapping.levelLabel && <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Level</th>}
                          <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Assigned</th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-muted-foreground">Measured</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {getCsvPreviewRows().map((row, i) => (
                      <tr key={i} className="border-b border-border/50">
                        {(studyType === "method_comparison" ? csvMapping.sampleId : csvMapping.levelLabel) && (
                          <td className="py-1.5 px-3 text-xs text-muted-foreground">{row.id || "-"}</td>
                        )}
                        <td className="py-1.5 px-3 text-sm font-mono">{row.primary}</td>
                        <td className="py-1.5 px-3 text-sm font-mono">{row.secondary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {csvRows.length > 5 && (
                <p className="text-xs text-muted-foreground text-center">Showing first 5 of {csvRows.length} rows</p>
              )}
              {csvWarnings.length > 0 && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <AlertTriangle size={13} className="text-amber-600" />
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Warnings</span>
                  </div>
                  {csvWarnings.map((w, i) => <p key={i} className="text-xs text-amber-600 dark:text-amber-400">{w}</p>)}
                </div>
              )}
              {csvErrors.length > 0 && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <XCircle size={13} className="text-red-600" />
                    <span className="text-xs font-medium text-red-700 dark:text-red-400">Errors - fix before importing</span>
                  </div>
                  {csvErrors.map((err, i) => <p key={i} className="text-xs text-red-600 dark:text-red-400">{err}</p>)}
                </div>
              )}
              {/* Replace data warning */}
              {filledLevels > 0 && !csvConfirmReplace && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-3 flex items-start gap-2">
                  <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">This will replace your current data entry.</p>
                    <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={() => setCsvConfirmReplace(true)}>
                      I understand, continue
                    </Button>
                  </div>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => { setCsvStep("mapping"); setCsvErrors([]); setCsvWarnings([]); }}>Back</Button>
                <Button
                  size="sm"
                  disabled={csvErrors.length > 0 || getValidCsvRowCount() === 0 || (filledLevels > 0 && !csvConfirmReplace)}
                  onClick={executeCsvImport}
                >
                  <CheckCircle2 size={14} className="mr-1.5" />
                  Import {getValidCsvRowCount()} rows
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <CLIALookupModal
        open={cliaModalOpen}
        onClose={() => setCliaModalOpen(false)}
        onCheckout={handleCliaCheckout}
        discountCode={discountApplied?.code}
      />
    </div>
  );
}
