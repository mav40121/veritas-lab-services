import { useSEO } from "@/hooks/useSEO";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
// .xlsx parsing uses ExcelJS via dynamic import (CLAUDE.md §6: ExcelJS only).
// ExcelJS handles .xlsx (Office Open XML). The legacy .xls (BIFF binary)
// format is not supported and will surface the existing parse-error message.
import { useLocation, useSearch, useRoute, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PlusCircle, Trash2, FlaskConical, CheckCircle2, DollarSign, Loader2, XCircle, LayoutDashboard, BookOpen, ChevronRight, Shield, Info, HelpCircle, Upload, AlertTriangle, FileSpreadsheet, ClipboardCheck, Activity, Tag } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import CLIALookupModal from "@/components/CLIALookupModal";
import { VeritaQcImportModal, type VeritaQcImportPayload } from "@/components/VeritaQcImportModal";
import { VeritaQcBulkImportModal, type VeritaQcBulkImportPayload } from "@/components/VeritaQcBulkImportModal";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { calculateStudy, calculatePrecision, calculateLotToLot, calculatePTCoag, calculateQCRange, calculateMultiAnalyteCoag, calculateRefInterval, calculateQualitative, calculateSemiQuant, calculateSensitivity, type DataPoint, type PrecisionDataPoint, type LotToLotDataPoint, type QCRangeDataPoint, type RefIntervalDataPoint, type SensitivityInput, calculateINR } from "@/lib/calculations";
import { teaData } from "@/lib/cliaTeaData";
import { useAuth } from "@/components/AuthContext";
import { authHeaders } from "@/lib/auth";
import { trackEvent } from "@/lib/analytics";
import { useActiveLabId } from "@/hooks/useActiveLabId";
import type { InsertStudy } from "@shared/schema";
import fdaData from "@/lib/fdaInstrumentData.json";
import { useLabRoute } from "@/hooks/useLabRoute";

const API_BASE = "https://www.veritaslabservices.com";
// Retained for potential future use; VeritaCheck picker no longer renders this catalog.
const FDA_MODEL_NAMES = Object.keys(fdaData).sort();

// CLIA 2025 Proficiency Testing Acceptance Limits (42 CFR Part 493 Subpart K)
const CLIA_PRESETS = [
  // ── Routine Chemistry §493.931 ──────────────────────────────────────────
  { label: "ALT/SGPT (±15% or ±6 U/L)",              value: 0.15,  absoluteFloor: 6, absoluteUnit: "U/L", cfr: "42 CFR §493.931" },
  { label: "Albumin (±8%)",                            value: 0.08,  cfr: "42 CFR §493.931" },
  { label: "Alkaline Phosphatase (±20%)",              value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "Amylase (±20%)",                           value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "AST (±15% or ±6 U/L)",                    value: 0.15,  absoluteFloor: 6, absoluteUnit: "U/L", cfr: "42 CFR §493.931" },
  { label: "Bilirubin, Total (±20% or ±0.4 mg/dL)",   value: 0.20,  absoluteFloor: 0.4, absoluteUnit: "mg/dL", cfr: "42 CFR §493.931" },
  { label: "BNP (±30%)",                               value: 0.30,  cfr: "42 CFR §493.931" },
  { label: "proBNP (±30%)",                            value: 0.30,  cfr: "42 CFR §493.931" },
  // CO2/Bicarbonate sits above pCO2 by intent: bench vernacular for the chemistry
  // analyte is "CO2," and the first CO2-shaped entry a user scans hits is the
  // one they typically want. Keeping the chemistry entry first eliminates the
  // muscle-memory crosswire path that the earlier "Blood Gas pCO2 first" order
  // produced. Index-stability: this swap only affects positions 8-12; the demo
  // button at the bottom of the page targets index 19 (Creatinine), which sits
  // below this block and is unaffected. (2026-06-03)
  { label: "Carbon Dioxide / Serum CO2 / Bicarbonate (±20%)", value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "pCO2, Blood Gas Analyzer (±8% or ±5 mm Hg)", value: 0.08,  absoluteFloor: 5, absoluteUnit: "mm Hg", cfr: "42 CFR §493.931" },
  { label: "Blood Gas pO2 (±15% or ±15 mmHg)",         value: 0.15,  absoluteFloor: 15, absoluteUnit: "mmHg", cfr: "42 CFR §493.931" },
  { label: "Blood Gas pH (±0.04)",                     value: 0.04,  isPercentage: false, unit: "pH units", cfr: "42 CFR §493.931" },
  { label: "Calcium, Total (±1.0 mg/dL)",              value: 1.0,   isPercentage: false, unit: "mg/dL",    cfr: "42 CFR §493.931" },
  { label: "Chloride (±5%)",                           value: 0.05,  cfr: "42 CFR §493.931" },
  { label: "Cholesterol, Total (±10%)",                value: 0.10,  cfr: "42 CFR §493.931" },
  { label: "Cholesterol, HDL (±20% or ±6 mg/dL)",     value: 0.20,  absoluteFloor: 6, absoluteUnit: "mg/dL", cfr: "42 CFR §493.931" },
  { label: "Cholesterol, LDL Direct (±20%)",           value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "CK (±20%)",                                value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "CK-MB (±25% or ±3 ng/mL)",                value: 0.25,  absoluteFloor: 3, absoluteUnit: "ng/mL", cfr: "42 CFR §493.931" },
  { label: "Creatinine (±10% or ±0.2 mg/dL)",         value: 0.10,  absoluteFloor: 0.2, absoluteUnit: "mg/dL", cfr: "42 CFR §493.931" },
  { label: "Ferritin (±20%)",                          value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "GGT (±15% or ±5 U/L)",                    value: 0.15,  absoluteFloor: 5, absoluteUnit: "U/L", cfr: "42 CFR §493.931" },
  { label: "Glucose (±8% or ±6 mg/dL)",               value: 0.08,  absoluteFloor: 6, absoluteUnit: "mg/dL", cfr: "42 CFR §493.931" },
  { label: "Hemoglobin A1c (±8%)",                     value: 0.08,  cfr: "42 CFR §493.931" },
  { label: "Iron, Total (±15%)",                       value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "LDH (±15%)",                               value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Magnesium (±15%)",                         value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Phosphorus (±10% or ±0.3 mg/dL)",         value: 0.10,  absoluteFloor: 0.3, absoluteUnit: "mg/dL", cfr: "42 CFR §493.931" },
  { label: "Potassium (±0.3 mmol/L)",                  value: 0.3,   isPercentage: false, unit: "mmol/L",   cfr: "42 CFR §493.931" },
  { label: "PSA, Total (±20% or ±0.2 ng/mL)",         value: 0.20,  absoluteFloor: 0.2, absoluteUnit: "ng/mL", cfr: "42 CFR §493.931" },
  { label: "Sodium (±4 mmol/L)",                       value: 4,     isPercentage: false, unit: "mmol/L",   cfr: "42 CFR §493.931" },
  { label: "TIBC Direct (±20%)",                       value: 0.20,  cfr: "42 CFR §493.931" },
  { label: "Total Protein (±8%)",                      value: 0.08,  cfr: "42 CFR §493.931" },
  { label: "Triglycerides (±15%)",                     value: 0.15,  cfr: "42 CFR §493.931" },
  { label: "Troponin I (±30% or ±0.9 ng/mL)",         value: 0.30,  absoluteFloor: 0.9, absoluteUnit: "ng/mL", cfr: "42 CFR §493.931" },
  { label: "Troponin T (±30% or ±0.2 ng/mL)",         value: 0.30,  absoluteFloor: 0.2, absoluteUnit: "ng/mL", cfr: "42 CFR §493.931" },
  { label: "Urea Nitrogen/BUN (±9% or ±2 mg/dL)",     value: 0.09,  absoluteFloor: 2, absoluteUnit: "mg/dL", cfr: "42 CFR §493.931" },
  { label: "Uric Acid (±10%)",                         value: 0.10,  cfr: "42 CFR §493.931" },
  // ── Endocrinology §493.933 ───────────────────────────────────────────────
  { label: "CA-125 (±20%)",                            value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "CEA (±15% or ±1 ng/dL)",                  value: 0.15,  absoluteFloor: 1, absoluteUnit: "ng/dL", cfr: "42 CFR §493.933" },
  { label: "Cortisol (±20%)",                          value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "Estradiol (±30%)",                         value: 0.30,  cfr: "42 CFR §493.933" },
  { label: "Folate, Serum (±30% or ±1 ng/mL)",        value: 0.30,  absoluteFloor: 1, absoluteUnit: "ng/mL", cfr: "42 CFR §493.933" },
  { label: "FSH (±18% or ±2 IU/L)",                   value: 0.18,  absoluteFloor: 2, absoluteUnit: "IU/L", cfr: "42 CFR §493.933" },
  { label: "Free T4 (±15% or ±0.3 ng/dL)",            value: 0.15,  absoluteFloor: 0.3, absoluteUnit: "ng/dL", cfr: "42 CFR §493.933" },
  { label: "hCG (±18% or ±3 mIU/mL)",                 value: 0.18,  absoluteFloor: 3, absoluteUnit: "mIU/mL", cfr: "42 CFR §493.933" },
  { label: "LH (±20%)",                                value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "Parathyroid Hormone (±30%)",               value: 0.30,  cfr: "42 CFR §493.933" },
  { label: "Progesterone (±25%)",                      value: 0.25,  cfr: "42 CFR §493.933" },
  { label: "Prolactin (±20%)",                         value: 0.20,  cfr: "42 CFR §493.933" },
  { label: "Testosterone (±30% or ±20 ng/dL)",        value: 0.30,  absoluteFloor: 20, absoluteUnit: "ng/dL", cfr: "42 CFR §493.933" },
  { label: "T3 Uptake (±18%)",                         value: 0.18,  cfr: "42 CFR §493.933" },
  { label: "T3, Total (±30%)",                         value: 0.30,  cfr: "42 CFR §493.933" },
  { label: "TSH (±20% or ±0.2 mIU/L)",                value: 0.20,  absoluteFloor: 0.2, absoluteUnit: "mIU/L", cfr: "42 CFR §493.933" },
  { label: "T4, Thyroxine (±20% or ±1.0 mcg/dL)",    value: 0.20,  absoluteFloor: 1.0, absoluteUnit: "mcg/dL", cfr: "42 CFR §493.933" },
  { label: "Vitamin B12 (±25% or ±30 pg/mL)",         value: 0.25,  absoluteFloor: 30, absoluteUnit: "pg/mL", cfr: "42 CFR §493.933" },
  // ── Toxicology §493.935 ──────────────────────────────────────────────────
  { label: "Acetaminophen (±15% or ±3 mcg/mL)",       value: 0.15,  absoluteFloor: 3, absoluteUnit: "mcg/mL", cfr: "42 CFR §493.935" },
  { label: "Alcohol, Blood (±20%)",                    value: 0.20,  cfr: "42 CFR §493.935" },
  { label: "Blood Lead (±10% or ±2 mcg/dL)",          value: 0.10,  absoluteFloor: 2, absoluteUnit: "mcg/dL", cfr: "42 CFR §493.935" },
  { label: "Carbamazepine (±20% or ±1.0 mcg/mL)",     value: 0.20,  absoluteFloor: 1.0, absoluteUnit: "mcg/mL", cfr: "42 CFR §493.935" },
  { label: "Digoxin (±15% or ±0.2 ng/mL)",            value: 0.15,  absoluteFloor: 0.2, absoluteUnit: "ng/mL", cfr: "42 CFR §493.935" },
  { label: "Gentamicin (±25%)",                        value: 0.25,  cfr: "42 CFR §493.935" },
  { label: "Lithium (±15% or ±0.3 mmol/L)",           value: 0.15,  absoluteFloor: 0.3, absoluteUnit: "mmol/L", cfr: "42 CFR §493.935" },
  { label: "Phenobarbital (±15% or ±2 mcg/mL)",       value: 0.15,  absoluteFloor: 2, absoluteUnit: "mcg/mL", cfr: "42 CFR §493.935" },
  { label: "Phenytoin (±15% or ±2 mcg/mL)",           value: 0.15,  absoluteFloor: 2, absoluteUnit: "mcg/mL", cfr: "42 CFR §493.935" },
  { label: "Salicylate (±15% or ±2 mcg/mL)",          value: 0.15,  absoluteFloor: 2, absoluteUnit: "mcg/mL", cfr: "42 CFR §493.935" },
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
  // ── Lab-Set Internal Goal - no CLIA TEa ─────────────────────────────────
  // Common analytes that have no canonical 42 CFR §493 PT criterion. Picking
  // one auto-flips the form to custom-input mode (value: 0 triggers the
  // Custom number field) and the form omits the §493 reference line so the
  // resulting study does not falsely cite a regulation that does not list
  // these analytes. Parking-lot #1.
  { label: "Lipase",                                   value: 0, cfr: "" },
  { label: "Bilirubin, Direct",                        value: 0, cfr: "" },
  { label: "Bilirubin, Unbound",                       value: 0, cfr: "" },
  { label: "Iron Saturation",                          value: 0, cfr: "" },
  { label: "Vitamin D, 25-Hydroxy",                    value: 0, cfr: "" },
  { label: "Procalcitonin",                            value: 0, cfr: "" },
  // ── Custom ───────────────────────────────────────────────────────────────
  { label: "Custom", value: 0, cfr: "" },
];
const MIN_LEVELS = 3;
const MAX_LEVELS = 40;
const DEFAULT_LEVELS = 10;

// Build display label for a VeritaMap lab instrument in the picker
function labInstrumentLabel(inst: { instrument_name: string; nickname?: string | null; serial_number?: string | null; category?: string | null }): string {
  const sn = inst.serial_number ? `S/N ${inst.serial_number}` : "";
  const section = inst.category || "";
  const suffix = [sn, section].filter(Boolean).join(", ");
  if (inst.nickname) {
    return suffix ? `${inst.nickname}, ${inst.instrument_name} (${suffix})` : `${inst.nickname}, ${inst.instrument_name}`;
  }
  return suffix ? `${inst.instrument_name} (${suffix})` : inst.instrument_name;
}

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
  "All VeritaCheck™ study types": "Access to all available study types: calibration verification, method comparison, accuracy & precision, lot-to-lot verification, and more.",
  "Full PDF reports": "Every study generates a signed, audit-ready PDF report suitable for surveyor review.",
  "Study history dashboard": "View, search, and re-download all past studies from your personal dashboard.",
  // Professional
  "Everything in Starter": "Includes all features from the Starter plan.",
  "VeritaMap™ regulatory mapping": "Build your complete test menu map. The intelligence engine identifies every correlation study and calibration verification your instruments require under 42 CFR Part 493.",
  "VeritaScan™ self-inspection audit": "168-item inspection readiness tracker across 10 compliance domains. Studies completed in VeritaCheck™ automatically check off corresponding items.",
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
  { priceType: "veritacheck_only", name: "VeritaCheck™ Unlimited", price: "$299",   unit: "per year",  description: "Single user. Performance verification suite only. No CLIA number required.",                                                    features: ["Unlimited studies", "All VeritaCheck study types", "Full PDF reports", "Study history dashboard"],                                                                                                    cta: "Subscribe",      highlight: false, badge: null },
  { priceType: "clinic",          name: "Clinic",                 price: "$499",   unit: "per year",  description: "Certificate of Waiver labs and small clinics.",                                                                           features: ["2 seats included", "Full VeritaAssure™ suite, all modules", "VeritaMap™ regulatory mapping", "VeritaScan™ self-inspection audit", "VeritaComp™ competency management", "CLIA number on all reports", "Complimentary 1-hour onboarding session via Zoom or Teams with a VeritaAssure™ specialist"],                                                                                                 cta: "Subscribe",      highlight: false, badge: null },
  { priceType: "community",       name: "Community",              price: "$999",   unit: "per year",  description: "Community hospitals and independent labs.",                                                                              features: ["5 seats included", "Full VeritaAssure™ suite, all modules", "VeritaStaff™ personnel management", "CLIA number on all reports", "Complimentary 1-hour onboarding session via Zoom or Teams with a VeritaAssure™ specialist"],                                                                   cta: "Subscribe",      highlight: true,  badge: "Most Popular" },
  { priceType: "hospital",        name: "Hospital",               price: "$1,999", unit: "per year",  description: "Regional and acute care hospital labs.",                                                                                 features: ["15 seats included", "Everything in Community", "Priority support", "Complimentary 2-hour onboarding session via Zoom or Teams with a VeritaAssure™ specialist"],                                                                                                                             cta: "Subscribe",      highlight: false, badge: null },
  { priceType: "enterprise",      name: "Enterprise",             price: "$2,999", unit: "per year",  description: "Large hospitals, health systems, and reference labs.",                                                                   features: ["25 seats included", "Everything in Hospital", "Priority support", "Consulting access", "Custom onboarding included"],                                                                                                          cta: "Subscribe",      highlight: false, badge: null },
];

export default function VeritaCheckPage() {
  const labRoute = useLabRoute();
  const [, navigate] = useLocation();
  const search = useSearch();
  // Edit-existing-study mode. The page is mounted from both legacy
  // /study/:id/edit and lab-scoped /labs/:labId/study/:id/edit; match
  // either so editId resolves on any URL shape (parallel to the
  // VeritaMapMapPage Phase 3.3b dual-useRoute fix).
  const [, legacyEditParams] = useRoute("/study/:id/edit");
  const [, labScopedEditParams] = useRoute("/labs/:labId/study/:id/edit");
  const editId = labScopedEditParams?.id ?? legacyEditParams?.id ?? null;
  const isEditing = !!editId;
  // useActiveLabId is also called below at the saveMutation site (line ~1003)
  // and pulls from the URL; declaring once at the top for use by both the
  // pre-populate fetch (below) and the saveMutation (below).
  const editingLabId = useActiveLabId();
  // Read uses the lab-scoped path only. The legacy unprefixed /api/studies/:id
  // fallback was removed alongside the POST fallback (see saveMutation below)
  // because /veritacheck is lab-scopable, so activeLabId is always resolved on
  // any flow that legitimately renders this page in edit mode.
  const editStudyUrl = isEditing && editingLabId
    ? `/api/labs/${editingLabId}/studies/${editId}`
    : null;
  const { data: editStudy } = useQuery<any>({
    queryKey: editStudyUrl ? [editStudyUrl] : ["__skip_edit_fetch__"],
    enabled: !!editStudyUrl,
  });
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

      // Fire GA4 purchase event
      const type = params.get("type") || "unknown";
      const priceMap: Record<string, number> = {
        per_study: 25,
        unlimited: 299,
        clinic: 499,
        community: 999,
        hospital: 1999,
        enterprise: 2999,
      };
      trackEvent("purchase", {
        currency: "USD",
        value: priceMap[type] ?? 0,
        transaction_id: `vc_${Date.now()}`,
        items: [
          {
            item_id: type,
            item_name: type.replace(/_/g, " "),
            price: priceMap[type] ?? 0,
            quantity: 1,
          },
        ],
      });

      // Strip query string so reloads don't double-count
      window.history.replaceState({}, "", "/veritacheck");
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
    "lot_to_lot": "lot_to_lot",
    "lot-to-lot": "lot_to_lot",
    "pt_coag": "pt_coag",
    "pt-coag": "pt_coag",
    "ref_interval": "ref_interval",
    "reference_interval": "ref_interval",
    "carryover": "carryover",
    "accuracy_bias": "accuracy_bias",
    "accuracy": "accuracy_bias",
    "linearity": "linearity",
    "reportable_range": "reportable_range",
  };
  const rawInitialStudyType = (prePopStudyType && studyTypeMap[prePopStudyType]) || "cal_ver";
  const initialStudyType = rawInitialStudyType;
  const initialInstruments = prePopInst1 && prePopInst2 ? [prePopInst1, prePopInst2] : prePopInst1 ? [prePopInst1, "Instrument 2"] : ["Instrument 1", "Instrument 2"];

  const [studyType, setStudyType] = useState<"cal_ver" | "method_comparison" | "precision" | "lot_to_lot" | "pt_coag" | "qc_range" | "multi_analyte_coag" | "ref_interval" | "sensitivity" | "carryover" | "accuracy_bias" | "linearity" | "reportable_range">(initialStudyType);
  const [instrumentNames, setInstrumentNames] = useState<string[]>(initialInstruments);
  interface LabInstrument { id: number; instrument_name: string; serial_number?: string | null; nickname?: string | null; role?: string; category?: string; map_id?: number; map_name?: string }
  const [veritaMapInstruments, setVeritaMapInstruments] = useState<LabInstrument[]>([]);
  const [veritaMapLoaded, setVeritaMapLoaded] = useState(false);
  // Track which instrument slots are linked to a VeritaMap instrument (by veritamap instrument id)
  const [linkedInstruments, setLinkedInstruments] = useState<Record<number, LabInstrument | null>>({});

  // Reset PHI banner when study type changes (new study started)
  useEffect(() => { setPhiBannerDismissed(false); }, [studyType]);

  // Reset the VeritaMap instruments load gate when the active lab changes so
  // the next render refetches against the new lab's lab-scoped endpoint.
  // Uses `editingLabId` (declared at the top of the function at line 231),
  // NOT the `activeLabId` const declared ~1,000 lines below; both call
  // useActiveLabId() and return the same value, but referencing the
  // later-declared binding here puts us in the TDZ on first render and
  // throws ReferenceError on EVERY mount of this page. PR #534 made that
  // mistake and was reverted in PR #535.
  useEffect(() => {
    setVeritaMapLoaded(false);
    setVeritaMapInstruments([]);
  }, [editingLabId]);

  // Fetch VeritaMap instruments for instrument picker dropdown.
  // Lab-scoped URL when editingLabId is known. The legacy user-scoped
  // endpoint misses instruments under maps whose user_id does not match
  // the requester (multi-lab bleed class, customer-reported 2026-06-04 on
  // San Carlos after a redundant map was deleted).
  useEffect(() => {
    if (!isLoggedIn || veritaMapLoaded) return;
    (async () => {
      try {
        const url = editingLabId
          ? `${API_BASE}/api/labs/${editingLabId}/veritacheck/lab-instruments`
          : `${API_BASE}/api/veritacheck/lab-instruments`;
        const res = await fetch(url, { headers: authHeaders() });
        if (!res.ok) { setVeritaMapLoaded(true); return; }
        const instruments: LabInstrument[] = await res.json();
        setVeritaMapInstruments(instruments);
      } catch { /* no VeritaMap data */ }
      setVeritaMapLoaded(true);
    })();
  }, [isLoggedIn, veritaMapLoaded, editingLabId]);

  // Group instruments by VeritaMap map for the picker dropdown.
  // Large hospitals can keep separate maps (Chemistry, Hematology, etc.); the
  // picker should show those groups distinctly. When a model name appears more
  // than once across all maps and a row has no nickname, the label includes
  // the map name so the user can tell rows apart.
  const groupedInstruments = useMemo(() => {
    if (veritaMapInstruments.length === 0) return [] as { mapId: number | string; mapName: string; items: LabInstrument[] }[];
    const modelCounts = new Map<string, number>();
    veritaMapInstruments.forEach(i => {
      const k = i.instrument_name || "";
      modelCounts.set(k, (modelCounts.get(k) || 0) + 1);
    });
    const byMap = new Map<string, { mapId: number | string; mapName: string; items: LabInstrument[] }>();
    veritaMapInstruments.forEach(i => {
      const key = String(i.map_id ?? "_unknown");
      if (!byMap.has(key)) {
        byMap.set(key, { mapId: i.map_id ?? "_unknown", mapName: i.map_name || "My Lab", items: [] });
      }
      byMap.get(key)!.items.push(i);
    });
    // Stable order: alphabetical by map name
    return Array.from(byMap.values()).sort((a, b) => a.mapName.localeCompare(b.mapName));
  }, [veritaMapInstruments]);

  // Detect ambiguous duplicates: same model, same map, no nickname on either row.
  // When this happens no UI label can distinguish them; surface a hint.
  const hasAmbiguousDuplicates = useMemo(() => {
    const seen = new Map<string, number>();
    for (const i of veritaMapInstruments) {
      if (i.nickname) continue;
      const k = `${i.map_id}::${i.instrument_name}`;
      seen.set(k, (seen.get(k) || 0) + 1);
      if ((seen.get(k) || 0) > 1) return true;
    }
    return false;
  }, [veritaMapInstruments]);

  // Multi-map disambiguation: if same model appears in 2+ different maps and
  // has no nickname/serial, append the map name to the label so it is unique.
  const labInstrumentLabelWithContext = (inst: LabInstrument): string => {
    const base = labInstrumentLabel(inst);
    if (inst.nickname || inst.serial_number) return base;
    const sameModelCount = veritaMapInstruments.filter(x => x.instrument_name === inst.instrument_name).length;
    if (sameModelCount > 1 && inst.map_name) {
      // Replace trailing "(category)" with "(map_name, category)" or append map_name.
      const cat = inst.category || "";
      if (cat && base.endsWith(`(${cat})`)) {
        return base.replace(`(${cat})`, `(${inst.map_name}, ${cat})`);
      }
      return `${base} (${inst.map_name})`;
    }
    return base;
  };

  const [cliaPreset, setCliaPreset] = useState(0);
  // Remembers the most recent non-custom analyte preset so unchecking the "Use custom TEa" box
  // restores the user's prior selection rather than dropping them at the default (ALT/SGPT).
  const prevAnalytePresetRef = useRef(0);
  const [customClia, setCustomClia] = useState(0.15);
  const [numLevels, setNumLevels] = useState(DEFAULT_LEVELS);
  const [dataPoints, setDataPoints] = useState<DataPoint[]>(makeEmptyPoints(["Instrument 1", "Instrument 2"], DEFAULT_LEVELS));

  // When editing, pre-populate form state from the fetched study. Runs once
  // when editStudy first resolves. Uses a hydrated ref so editing toggles
  // don't keep resetting state if the user changes values after load.
  const editHydratedRef = useRef(false);
  useEffect(() => {
    if (!editStudy || editHydratedRef.current) return;
    try {
      setTestName(editStudy.test_name ?? editStudy.testName ?? "");
      setAnalyst(editStudy.analyst ?? "");
      if (editStudy.date) setDate(String(editStudy.date).slice(0, 10));
      if (editStudy.study_type ?? editStudy.studyType) {
        setStudyType((editStudy.study_type ?? editStudy.studyType) as any);
      }
      const instrumentsRaw = editStudy.instruments;
      const instrumentsParsed = typeof instrumentsRaw === "string" ? JSON.parse(instrumentsRaw || "[]") : (instrumentsRaw ?? []);
      if (Array.isArray(instrumentsParsed) && instrumentsParsed.length > 0) {
        setInstrumentNames(instrumentsParsed);
      }
      const dpRaw = editStudy.data_points ?? editStudy.dataPoints;
      const dpParsed = typeof dpRaw === "string" ? JSON.parse(dpRaw || "[]") : (dpRaw ?? []);
      if (Array.isArray(dpParsed) && dpParsed.length > 0) {
        setDataPoints(dpParsed);
      }
      const tea = editStudy.clia_allowable_error ?? editStudy.cliaAllowableError;
      if (typeof tea === "number") setCustomClia(tea);
      // Carryover-specific rehydration. The generic Array.isArray() guard
      // above skips because carryover's data_points is an OBJECT shape
      // { specimens, units }. Without this block, reopening a saved carryover
      // study would silently land the user on an empty data-entry form.
      const studyTypeForHydrate = editStudy.study_type ?? editStudy.studyType;
      if (studyTypeForHydrate === "carryover" && dpParsed && typeof dpParsed === "object" && Array.isArray((dpParsed as any).specimens)) {
        const persistedSpecs = (dpParsed as any).specimens as Array<{ sequence: number; sample_type: "L" | "H"; value: number | null }>;
        if (persistedSpecs.length > 0) {
          setCoData(persistedSpecs.map(s => ({
            sequence: typeof s.sequence === "number" ? s.sequence : 0,
            sample_type: s.sample_type === "H" ? "H" : "L",
            value: s.value === null || s.value === undefined ? null : Number(s.value),
          })));
        }
        if (typeof (dpParsed as any).units === "string") setCoUnits((dpParsed as any).units);
      }
      // Accuracy / Bias (EP15-A3) rehydration. Persisted shape is
      // { analyte, units, levels: [{ name, assigned_value, replicates }] }.
      if (studyTypeForHydrate === "accuracy_bias" && dpParsed && typeof dpParsed === "object" && Array.isArray((dpParsed as any).levels)) {
        const a = (dpParsed as any).analyte;
        const u = (dpParsed as any).units;
        if (typeof a === "string") setAbAnalyte(a);
        if (typeof u === "string") setAbUnits(u);
        const persistedLevels = (dpParsed as any).levels as Array<{ name?: string; assigned_value?: number | null; replicates?: number[] }>;
        if (persistedLevels.length > 0) {
          setAbLevels(persistedLevels.map((lv, i) => ({
            name: typeof lv.name === "string" && lv.name ? lv.name : `Level ${i + 1}`,
            assignedValue: lv.assigned_value === null || lv.assigned_value === undefined ? null : Number(lv.assigned_value),
          })));
          const repMap: Record<string, number[]> = {};
          let maxReps = 0;
          for (const lv of persistedLevels) {
            const name = typeof lv.name === "string" && lv.name ? lv.name : "";
            const reps = Array.isArray(lv.replicates) ? lv.replicates.map(v => Number(v)) : [];
            if (name) repMap[name] = reps;
            if (reps.length > maxReps) maxReps = reps.length;
          }
          setAbRunData(repMap);
          if (maxReps > 0) setAbReplicatesPerLevel(maxReps);
        }
      }
      // Linearity (EP06) rehydration. Same persisted shape as accuracy_bias:
      // { analyte, units, levels: [{ name, assigned_value, replicates }] }.
      if (studyTypeForHydrate === "linearity" && dpParsed && typeof dpParsed === "object" && Array.isArray((dpParsed as any).levels)) {
        const a = (dpParsed as any).analyte;
        const u = (dpParsed as any).units;
        if (typeof a === "string") setLinAnalyte(a);
        if (typeof u === "string") setLinUnits(u);
        const persistedLevels = (dpParsed as any).levels as Array<{ name?: string; assigned_value?: number | null; replicates?: number[] }>;
        if (persistedLevels.length > 0) {
          setLinLevels(persistedLevels.map((lv, i) => ({
            name: typeof lv.name === "string" && lv.name ? lv.name : `Level ${i + 1}`,
            assignedValue: lv.assigned_value === null || lv.assigned_value === undefined ? null : Number(lv.assigned_value),
          })));
          const repMap: Record<string, number[]> = {};
          let maxReps = 0;
          for (const lv of persistedLevels) {
            const name = typeof lv.name === "string" && lv.name ? lv.name : "";
            const reps = Array.isArray(lv.replicates) ? lv.replicates.map(v => Number(v)) : [];
            if (name) repMap[name] = reps;
            if (reps.length > maxReps) maxReps = reps.length;
          }
          setLinRunData(repMap);
          if (maxReps > 0) setLinReplicatesPerLevel(maxReps);
        }
      }
      // Reportable Range rehydration. Persisted shape adds claimed_range_low
      // and claimed_range_high alongside the standard analyte/units/levels.
      if (studyTypeForHydrate === "reportable_range" && dpParsed && typeof dpParsed === "object" && Array.isArray((dpParsed as any).levels)) {
        const a = (dpParsed as any).analyte;
        const u = (dpParsed as any).units;
        const cl = (dpParsed as any).claimed_range_low;
        const ch = (dpParsed as any).claimed_range_high;
        if (typeof a === "string") setRrAnalyte(a);
        if (typeof u === "string") setRrUnits(u);
        if (typeof cl === "number") setRrClaimedLow(cl);
        if (typeof ch === "number") setRrClaimedHigh(ch);
        const persistedLevels = (dpParsed as any).levels as Array<{ name?: string; assigned_value?: number | null; replicates?: number[] }>;
        if (persistedLevels.length > 0) {
          setRrLevels(persistedLevels.map((lv, i) => ({
            name: typeof lv.name === "string" && lv.name ? lv.name : `Level ${i + 1}`,
            assignedValue: lv.assigned_value === null || lv.assigned_value === undefined ? null : Number(lv.assigned_value),
          })));
          const repMap: Record<string, number[]> = {};
          let maxReps = 0;
          for (const lv of persistedLevels) {
            const name = typeof lv.name === "string" && lv.name ? lv.name : "";
            const reps = Array.isArray(lv.replicates) ? lv.replicates.map(v => Number(v)) : [];
            if (name) repMap[name] = reps;
            if (reps.length > maxReps) maxReps = reps.length;
          }
          setRrRunData(repMap);
          if (maxReps > 0) setRrReplicatesPerLevel(maxReps);
        }
      }
      editHydratedRef.current = true;
    } catch (err) {
      console.warn("[veritacheck edit] hydrate failed", err);
    }
  }, [editStudy]);

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
  // Phase 3 simple-precision parity (2026-05-20): optional EE-style inputs.
  // All four are stored as strings (text inputs) and parsed at save time so
  // an empty box stays "" rather than NaN. The calculator + PDF only render
  // related fields when these are non-empty + numeric.
  const [precisionVendorSd, setPrecisionVendorSd] = useState("");
  const [precisionVendorSdConc, setPrecisionVendorSdConc] = useState("");
  const [precisionTargetMean, setPrecisionTargetMean] = useState("");
  const [precisionTargetCv, setPrecisionTargetCv] = useState("");
  // EE Day 2 QC traceability inputs (optional, stored as strings; empty -> null).
  const [precisionControlLot, setPrecisionControlLot] = useState("");
  const [precisionReagentLot, setPrecisionReagentLot] = useState("");
  const [precisionComment, setPrecisionComment] = useState("");
  const [precisionResultUnits, setPrecisionResultUnits] = useState("");

  // VeritaQC → VeritaCheck Verification Import (Phase A: Precision).
  // The modal opens when the tech clicks "Import from VeritaQC…" on the
  // Precision Data Entry card. On import, we fan the payload into the
  // existing precision state vars + stash the audit metadata in
  // `precisionImportSource` for persistence at save time (decision #5).
  const [qcImportOpen, setQcImportOpen] = useState(false);
  const [qcImportMode, setQcImportMode] = useState<"precision" | "accuracy_bias" | "linearity" | "reportable_range">("precision");
  const [precisionImportSource, setPrecisionImportSource] = useState<any | null>(null);
  const [accuracyBiasImportSource, setAccuracyBiasImportSource] = useState<any | null>(null);
  const [linearityImportSource, setLinearityImportSource] = useState<any | null>(null);
  const [reportableRangeImportSource, setReportableRangeImportSource] = useState<any | null>(null);
  // Phase D-2: QC Lot Verification bulk import (separate modal, separate
  // handler, because the cube shape is structurally different from the
  // flat-list precision/accuracy/linearity/reportable-range path).
  const [qcBulkImportOpen, setQcBulkImportOpen] = useState(false);
  const [qcBulkImportAnalyte, setQcBulkImportAnalyte] = useState<string>("");
  const [qcRangeImportSource, setQcRangeImportSource] = useState<any | null>(null);

  function handleVeritaQcBulkImport(payload: VeritaQcBulkImportPayload) {
    const { analyte, cells, routing, import_source, westgard_flag_summary } = payload;
    if (!cells || cells.length === 0) return;
    // Append-if-missing: grow qcAnalytes, qcLevels, qcAnalyzers so the parent
    // grid surfaces every imported cell. User can rename labels post-import.
    if (analyte && !qcAnalytes.includes(analyte)) {
      setQcAnalytes(prev => prev.includes(analyte) ? prev : [...prev, analyte]);
    }
    const newLevels = Array.from(new Set(cells.map(c => c.qc_level)));
    const newInstruments = Array.from(new Set(cells.map(c => c.instrument)));
    setQcLevels(prev => {
      const next = [...prev];
      for (const lvl of newLevels) if (!next.includes(lvl)) next.push(lvl);
      return next;
    });
    setQcAnalyzers(prev => {
      const next = [...prev];
      for (const inst of newInstruments) if (!next.includes(inst)) next.push(inst);
      return next;
    });
    // Merge replicates into the right grid. Replace-by-key: re-importing the
    // same cell overwrites the prior values rather than appending, so the
    // grid stays bounded at qcNumRuns cells per analyte/level/analyzer.
    const updates: Record<string, number[]> = {};
    for (const cell of cells) {
      const key = `${analyte}|${cell.qc_level}|${cell.instrument}`;
      updates[key] = cell.values.slice(0, qcNumRuns);
    }
    if (routing === "prior_lot") {
      setQcPriorLotRuns(prev => ({ ...prev, ...updates }));
      setQcShowPriorLot(true);
    } else {
      setQcRunData(prev => ({ ...prev, ...updates }));
    }
    setQcRangeImportSource(import_source);
    if (analyte && !testName.trim()) setTestName(analyte);
    const excluded = westgard_flag_summary.excluded ?? 0;
    toast({
      title: `Imported ${cells.length} cell${cells.length === 1 ? "" : "s"} from VeritaQC™`,
      description: payload.exclude_westgard_flagged && excluded > 0
        ? `Excluded ${excluded} Westgard-flagged replicate${excluded === 1 ? "" : "s"}; routed to ${routing === "prior_lot" ? "prior-lot grid" : "new-lot grid"}.`
        : westgard_flag_summary.flagged > 0
          ? `${westgard_flag_summary.flagged} of ${westgard_flag_summary.total} replicates were Westgard-flagged in VeritaQC; director reviews.`
          : `Routed to ${routing === "prior_lot" ? "prior-lot grid" : "new-lot grid"}.`,
    });
  }

  function handleVeritaQcImport(payload: VeritaQcImportPayload) {
    const { level, import_source } = payload;
    // Phase B + C: study types that take a per-level assigned value share
    // the same import shape. They differ only in which state vars the
    // payload lands in.
    if (qcImportMode === "accuracy_bias" || qcImportMode === "linearity" || qcImportMode === "reportable_range") {
      const assigned = typeof level.assigned_value === "number" && Number.isFinite(level.assigned_value)
        ? level.assigned_value : null;
      // Helper closes over the level/assigned/import_source vars and applies
      // the shared replace-or-append logic to whichever {levels, runData}
      // state pair the caller passes.
      const mergeLevels = (prev: { name: string; assignedValue: number | null }[]) => {
        const idx = prev.findIndex(p => p.name === level.name);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { name: level.name, assignedValue: assigned };
          return next;
        }
        const firstIsBlank = prev.length > 0 && prev[0].assignedValue === null && /^(QC (Low|Mid|High)|Level \d+( \(.*\))?)$/.test(prev[0].name);
        if (firstIsBlank) {
          const next = [...prev];
          next[0] = { name: level.name, assignedValue: assigned };
          return next;
        }
        return [...prev, { name: level.name, assignedValue: assigned }];
      };
      if (qcImportMode === "accuracy_bias") {
        if (payload.analyte) setAbAnalyte(payload.analyte);
        setAbLevels(mergeLevels);
        setAbRunData(prev => ({ ...prev, [level.name]: level.values }));
        setAccuracyBiasImportSource(import_source);
      } else if (qcImportMode === "linearity") {
        if (payload.analyte) setLinAnalyte(payload.analyte);
        setLinLevels(mergeLevels);
        setLinRunData(prev => ({ ...prev, [level.name]: level.values }));
        setLinearityImportSource(import_source);
      } else {
        // reportable_range
        if (payload.analyte) setRrAnalyte(payload.analyte);
        setRrLevels(mergeLevels);
        setRrRunData(prev => ({ ...prev, [level.name]: level.values }));
        setReportableRangeImportSource(import_source);
      }
      if (payload.analyte && !testName.trim()) setTestName(payload.analyte);
    } else {
      // Phase A: precision import.
      setPrecisionMode("simple");
      setPrecisionLevels(1);
      setPrecisionLevelNames([level.name, "Level 2 (High)", "Level 3 (Mid)"]);
      setPrecisionValues([level.values, [], []]);
      setPrecisionReps(level.values.length);
      if (level.control_lot) setPrecisionControlLot(level.control_lot);
      setPrecisionImportSource(import_source);
      if (payload.analyte && !testName.trim()) setTestName(payload.analyte);
    }
    toast({
      title: `Imported ${level.values.length} replicates from VeritaQC™`,
      description: payload.westgard_flag_summary.flagged > 0
        ? `${payload.westgard_flag_summary.flagged} of ${payload.westgard_flag_summary.total} flagged in VeritaQC; director reviews.`
        : `Level "${level.name}", control lot ${level.control_lot}`,
    });
  }

  // Sensitivity (EP17) state. Two paste-friendly textareas hold the blank and low-level
  // replicate values respectively; one value per line, optional ",lot" suffix per line for
  // per-lot LoB breakdown. LoQ levels are a dynamic list (expected concentration plus a
  // replicate textarea per level). Establishment vs Verification toggles whether mfg-claim
  // inputs are surfaced.
  const [sensMode, setSensMode] = useState<"establishment" | "verification">("establishment");
  const [sensAnalyteName, setSensAnalyteName] = useState("");
  const [sensUnits, setSensUnits] = useState("");
  const [sensBlanksText, setSensBlanksText] = useState("");
  const [sensLowLevelText, setSensLowLevelText] = useState("");
  const [sensLoqLevels, setSensLoqLevels] = useState<{ expectedConcentration: string; repsText: string }[]>([]);
  const [sensCvThreshold, setSensCvThreshold] = useState(20);
  const [sensBiasThreshold, setSensBiasThreshold] = useState(25);
  const [sensMfgLob, setSensMfgLob] = useState("");
  const [sensMfgLod, setSensMfgLod] = useState("");
  const [sensMfgLoq, setSensMfgLoq] = useState("");

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

  // Carryover state (CLSI EP10-A3). Standard 21-specimen pattern:
  // L,L,H,H,L,L,H,L,H,H,L,L,L,L,H,H,L,L,H,L,L
  const CARRYOVER_DEFAULT_PATTERN: ("L" | "H")[] = ["L","L","H","H","L","L","H","L","H","H","L","L","L","L","H","H","L","L","H","L","L"];
  const [coUnits, setCoUnits] = useState("");
  const [coData, setCoData] = useState<{ sequence: number; sample_type: "L" | "H"; value: number | null }[]>(
    CARRYOVER_DEFAULT_PATTERN.map((t, i) => ({ sequence: i + 1, sample_type: t, value: null }))
  );

  // Accuracy / Bias (CLSI EP15-A3 §6) state. First study type in the
  // cal_ver architectural split. Per-level replicate model: each level has
  // a name + assigned value (the QC material's certified target); replicates
  // are entered per level in a qc_range-style input grid. EP15-A3 §6 calls
  // for at least 10 replicates per level across at least 2 levels.
  const [abAnalyte, setAbAnalyte] = useState("");
  const [abUnits, setAbUnits] = useState("");
  const [abLevels, setAbLevels] = useState<{ name: string; assignedValue: number | null }[]>([
    { name: "QC Low",  assignedValue: null },
    { name: "QC High", assignedValue: null },
  ]);
  const [abReplicatesPerLevel, setAbReplicatesPerLevel] = useState(10);
  const [abRunData, setAbRunData] = useState<Record<string, number[]>>({});

  // Linearity state (CLSI EP06). Per Longstreth's email: N=3 replicates per
  // level, typically 4 levels spanning the AMR. Same data shape as
  // accuracy_bias (analyte, units, per-level name + assigned + replicates)
  // but different defaults and a different evaluator (OLS regression with
  // slope / intercept / r² acceptance versus per-level bias).
  const [linAnalyte, setLinAnalyte] = useState("");
  const [linUnits, setLinUnits] = useState("");
  // Optional manufacturer claimed AMR. When present, the Linearity PDF gains
  // a Coverage Summary block surfacing verified range vs claimed AMR + the
  // unverified gap, so the director's adjudication on coverage adequacy is
  // visible on the page they sign. Per the Longstreth/COPCP feedback thread
  // 2026-06-03: CLIA does not require fail-by-default on coverage gaps; the
  // director resolves the gap. This block makes the gap impossible to miss.
  const [linClaimedLow, setLinClaimedLow] = useState<number | "">("");
  const [linClaimedHigh, setLinClaimedHigh] = useState<number | "">("");
  const [linLevels, setLinLevels] = useState<{ name: string; assignedValue: number | null }[]>([
    { name: "Level 1", assignedValue: null },
    { name: "Level 2", assignedValue: null },
    { name: "Level 3", assignedValue: null },
    { name: "Level 4", assignedValue: null },
  ]);
  const [linReplicatesPerLevel, setLinReplicatesPerLevel] = useState(3);
  const [linRunData, setLinRunData] = useState<Record<string, number[]>>({});

  // Reportable Range state (CLIA 493.1255 AMR verification). Per Longstreth
  // (item 9): the lab must be able to type in their CLAIMED reportable range
  // so it lands on the report. Per his practice: N=2 replicates per level,
  // 3 levels spanning the claimed range (low / mid / high).
  const [rrAnalyte, setRrAnalyte] = useState("");
  const [rrUnits, setRrUnits] = useState("");
  const [rrClaimedLow, setRrClaimedLow] = useState<number | "">("");
  const [rrClaimedHigh, setRrClaimedHigh] = useState<number | "">("");
  const [rrLevels, setRrLevels] = useState<{ name: string; assignedValue: number | null }[]>([
    { name: "Low end",  assignedValue: null },
    { name: "Mid",      assignedValue: null },
    { name: "High end", assignedValue: null },
  ]);
  const [rrReplicatesPerLevel, setRrReplicatesPerLevel] = useState(2);
  const [rrRunData, setRrRunData] = useState<Record<string, number[]>>({});

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

  // QC Lot Verification state. Default to empty so a fresh study reads as
  // analyte-agnostic; the user adds whatever analyte(s) apply (chemistry,
  // hematology, immunoassay, coagulation, urinalysis). Default analyzer
  // label is generic ("Instrument 1") rather than the prior Stago-coag-
  // specific "TOP 351" to match the broadened scope.
  const [qcAnalytes, setQcAnalytes] = useState<string[]>([]);
  const [qcAnalyteCustom, setQcAnalyteCustom] = useState("");
  const [qcAnalyzers, setQcAnalyzers] = useState<string[]>(["Instrument 1"]);
  const [qcLevels, setQcLevels] = useState<string[]>(["Normal", "Abnormal"]);
  const [qcDateStart, setQcDateStart] = useState("");
  const [qcDateEnd, setQcDateEnd] = useState("");
  const [qcRunData, setQcRunData] = useState<Record<string, number[]>>({});
  // Legacy summary-style prior-lot fields. Kept in state so studies saved
  // before the prior-lot replicate grid landed continue to round-trip
  // cleanly. New studies use qcPriorLotRuns instead and leave this map
  // empty.
  const [qcOldLotData, setQcOldLotData] = useState<Record<string, { mean: number | null; sd: number | null }>>({});
  // Prior-lot replicate grid keyed identically to qcRunData
  // ("${analyte}|${level}|${analyzer}" -> number[]). Parallel runs collected
  // during the crossover establishment window. Empty until the user opts in.
  const [qcPriorLotRuns, setQcPriorLotRuns] = useState<Record<string, number[]>>({});
  // Vendor (package-insert assayed) values per analyte+level. Method-agnostic
  // by industry convention, so keyed without the analyzer.
  const [qcVendorValues, setQcVendorValues] = useState<Record<string, { mean: number | null; sd: number | null }>>({});
  // Section toggles: the crossover bias check and the vendor SDI are
  // opt-in. Range establishment (the run grid above) is always required.
  const [qcShowPriorLot, setQcShowPriorLot] = useState(false);
  const [qcShowVendor, setQcShowVendor] = useState(false);
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
      reader.onload = async (e) => {
        try {
          const arrayBuffer = e.target?.result as ArrayBuffer;
          const { default: ExcelJS } = await import("exceljs");
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(arrayBuffer);
          const sheet = workbook.worksheets[0];
          if (!sheet) {
            setCsvErrors(["Excel file contains no sheets."]);
            return;
          }
          // ExcelJS row.values is 1-indexed; slot 0 is undefined. Slice it off.
          const rawRows: any[][] = [];
          sheet.eachRow({ includeEmpty: false }, (row) => {
            const values = row.values as any[];
            rawRows.push(values.slice(1).map((v) => (v == null ? "" : v)));
          });
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
          setCsvErrors([
            "Could not read this Excel file. If it has a .xls extension, please re-save it as .xlsx in Excel and try again."
          ]);
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
  const cliaAbsoluteFloor: number | null = (CLIA_PRESETS[cliaPreset] as any).absoluteFloor ?? null;
  const cliaAbsoluteUnit: string | null = (CLIA_PRESETS[cliaPreset] as any).absoluteUnit ?? null;
  // The picked CLIA preset label, frozen at study-save time. Travels with the
  // study so the report (PDF and on-screen) can show
  // "CLIA TEa: 8% or 5 mm Hg (pCO2, Blood Gas Analyzer)" and any
  // adjacency-slip mistake at preset-select time becomes visible at
  // report-review time. "Lab-defined" when the user chose the Custom branch.
  // Customer report 2026-06-04.
  const cliaPresetLabel: string = CLIA_PRESETS[cliaPreset].value !== 0
    ? (CLIA_PRESETS[cliaPreset] as any).label
    : "Lab-defined";

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
    // Clear VeritaMap link when manually typing
    setLinkedInstruments(prev => { const next = { ...prev }; delete next[idx]; return next; });
  };

  const selectLabInstrument = (idx: number, inst: LabInstrument) => {
    const displayName = inst.nickname ? `${inst.nickname}, ${inst.instrument_name}` : inst.instrument_name;
    updateInstrumentName(idx, displayName);
    setLinkedInstruments(prev => ({ ...prev, [idx]: inst }));
  };

  const addInstrument = () => {
    const maxInst = studyType === "method_comparison" ? 10 : 5;
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
    : studyType === "sensitivity"
    ? sensBlanksText.split(/\r?\n/).map(l => parseFloat(l.split(/[,\t]/)[0])).filter(v => !isNaN(v)).length
    : studyType === "carryover"
    ? coData.filter(dp => dp.value !== null && !isNaN(dp.value as number)).length
    : studyType === "accuracy_bias"
    ? abLevels.filter(lv => {
        const reps = abRunData[lv.name] || [];
        return lv.assignedValue !== null && reps.filter(v => v !== undefined && v !== null && !isNaN(v)).length >= 5;
      }).length
    : studyType === "linearity"
    ? linLevels.filter(lv => {
        const reps = linRunData[lv.name] || [];
        return lv.assignedValue !== null && reps.filter(v => v !== undefined && v !== null && !isNaN(v)).length >= 2;
      }).length
    : studyType === "reportable_range"
    ? rrLevels.filter(lv => {
        const reps = rrRunData[lv.name] || [];
        return lv.assignedValue !== null && reps.filter(v => v !== undefined && v !== null && !isNaN(v)).length >= 2;
      }).length
    : studyType === "method_comparison" && assayType !== "quantitative"
    ? dataPoints.filter(dp => dp.expectedCategory && instrumentNames.slice(1).some(n => dp.instrumentCategories?.[n])).length
    : studyType === "method_comparison"
    ? dataPoints.filter(dp => instrumentNames.filter(n => dp.instrumentValues[n] !== null).length >= 2).length
    : dataPoints.filter(dp => dp.expectedValue !== null && instrumentNames.some(n => dp.instrumentValues[n] !== null)).length;

  // Multi-Lab Tier 2 Phase 3: post to lab-scoped endpoint when we are on a
  // /labs/:labId/study/new URL. Legacy /api/studies POST is dual-write
  // (server backfills lab_id from the user's record), so unprefixed POSTs
  // still land on the right lab.
  const activeLabId = useActiveLabId();

  const saveMutation = useMutation({
    mutationFn: async (study: InsertStudy) => {
      // Attach linked VeritaMap instrument metadata
      const hasLinks = Object.values(linkedInstruments).some(v => v != null);
      if (hasLinks) {
        const meta: Record<string, { instrument_id: number; model: string; nickname: string | null; serial_number: string | null }> = {};
        for (const [idx, inst] of Object.entries(linkedInstruments)) {
          if (inst) {
            meta[idx] = { instrument_id: inst.id, model: inst.instrument_name, nickname: inst.nickname || null, serial_number: inst.serial_number || null };
          }
        }
        study = { ...study, instrumentMeta: JSON.stringify(meta) };
      }
      const headers: Record<string, string> = { "Content-Type": "application/json", ...authHeaders() };
      // PUT when editing an existing study (draft or completed) so we update
      // the row instead of creating a duplicate. POST when new.
      //
      // Multi-Lab Tier 2 Phase 3 cleanup (2026-06-02): the legacy unprefixed
      // /api/studies path is GONE from this code path. The previous fallback
      // (`activeLabId ? lab-scoped : /api/studies`) was a transitional dual-
      // write that relied on the server backfilling lab_id from the user
      // record. For multi-lab owners that backfill could route a study to
      // the wrong lab. With /veritacheck now in LAB_SCOPABLE_PATHS (PR #483),
      // activeLabId is always resolved on legitimate flows; if it ever is
      // not, fail loudly so the bug is visible instead of silently writing
      // to whichever lab the server backfill picks.
      if (!activeLabId) {
        throw new Error(
          "Active lab not resolved — cannot save study. Pick a lab in the NavBar switcher and retry."
        );
      }
      const url = isEditing
        ? `${API_BASE}/api/labs/${activeLabId}/studies/${editId}`
        : `${API_BASE}/api/labs/${activeLabId}/studies`;
      // Surface non-2xx responses as errors so React Query routes them to
      // onError (toast). Previously we returned the raw Response, which made
      // any 4xx/5xx silently fall through to onSuccess, where data.id was
      // undefined and the redirect built /labs/<id>/study/undefined/results.
      const response = await fetch(url, { method: isEditing ? "PUT" : "POST", headers, body: JSON.stringify(study) });
      if (!response.ok) {
        let serverMessage = `Server returned ${response.status}`;
        try {
          const errBody = await response.json();
          if (errBody?.error) {
            serverMessage = typeof errBody.error === "string" ? errBody.error : JSON.stringify(errBody.error);
          }
        } catch {
          // response had no JSON body; fall back to the status code message
        }
        throw new Error(serverMessage);
      }
      return response;
    },
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/studies"] });
      if (activeLabId) {
        queryClient.invalidateQueries({ queryKey: [`/api/labs/${activeLabId}/studies`] });
      }
      // Drafts skip navigation to results; return to the dashboard so the
      // user sees the draft listed and can resume later.
      if (data.status === "draft") {
        toast({ title: "Draft saved" });
        navigate(activeLabId ? `/labs/${activeLabId}/dashboard` : "/dashboard");
        return;
      }
      const verificationId = prePopParams.get("verificationId");
      const verificationElement = prePopParams.get("element");
      const verificationSlot = prePopParams.get("slotId");
      // Preserve active-lab context across the navigation so a user creating
      // a study in /labs/15/study/new lands on /labs/15/study/:id/results,
      // not bounced to their primary lab by LegacyWorkspaceRedirect.
      const resultsBase = activeLabId
        ? `/labs/${activeLabId}/study/${data.id}/results`
        : `/study/${data.id}/results`;
      if (verificationId && verificationElement && verificationSlot) {
        navigate(`${resultsBase}?verificationId=${verificationId}&element=${verificationElement}&slotId=${verificationSlot}&studyPassed=${data.status === "pass" ? "1" : "0"}`);
      } else {
        navigate(resultsBase);
      }
    },
    onError: (err: any) => {
      const msg = err?.message || "Failed to save study";
      toast({ title: msg, variant: "destructive" });
    },
  });

  // Save as draft: bypass the strict client validation in handleSubmit and
  // send the current form state to the server marked as a draft. Requires
  // at least a test name. Server-side mirrors the same minimum-fields gate.
  const handleSaveDraft = () => {
    if (!testName.trim()) {
      toast({ title: "Add a test name before saving a draft", variant: "destructive" });
      return;
    }
    const draft: any = {
      testName: testName.trim(),
      instrument: instrumentNames[0] || "",
      analyst: analyst.trim() || "",
      date,
      studyType,
      cliaAllowableError: cliaValue,
      dataPoints,
      instruments: instrumentNames,
      teaIsPercentage: 1,
      teaUnit: "%",
      cliaPresetLabel,
      status: "draft",
    };
    saveMutation.mutate(draft as InsertStudy);
  };

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
        teaIsPercentage: teaIsPercentage ? 1 : 0, teaUnit, cliaAbsoluteFloor, cliaAbsoluteUnit, cliaPresetLabel,
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
        teaIsPercentage: 1, teaUnit: '%', cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel,
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
            // Crossover bias check: parallel prior-lot replicates keyed
            // identically to the new-lot grid; only attached when the
            // section is opted in and the grid has values.
            const priorRuns = qcShowPriorLot
              ? (qcPriorLotRuns[key] || []).filter(v => !isNaN(v))
              : [];
            // Vendor SDI: method-agnostic key (analyte+level only) so
            // the same vendor mean/SD applies across all analyzers.
            const vendorKey = `${analyte}|${level}`;
            const vendor = qcShowVendor ? qcVendorValues[vendorKey] : undefined;
            dataPoints.push({
              analyte, level, analyzer, runs,
              oldMean: old?.mean, oldSD: old?.sd,
              priorLotRuns: priorRuns.length > 0 ? priorRuns : undefined,
              vendorMean: vendor?.mean ?? undefined,
              vendorSD: vendor?.sd ?? undefined,
            });
          }
        }
      }
      if (dataPoints.length === 0) { toast({ title: "Enter run data for at least one analyte/level", variant: "destructive" }); return; }
      const results = calculateQCRange(dataPoints, { start: qcDateStart, end: qcDateEnd });
      const study: InsertStudy = {
        testName: testName.trim(), instrument: qcAnalyzers.join(", "), analyst: analyst.trim() || "-",
        date, studyType: "qc_range", cliaAllowableError: 0.10,
        teaIsPercentage: 1, teaUnit: '%', cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel,
        dataPoints: JSON.stringify({
          dataPoints, analytes: qcAnalytes, analyzers: qcAnalyzers, levels: qcLevels,
          dateRange: { start: qcDateStart, end: qcDateEnd },
          oldLotData: qcOldLotData,
          priorLotRuns: qcPriorLotRuns,
          vendorValues: qcVendorValues,
          showPriorLot: qcShowPriorLot, showVendor: qcShowVendor,
          importedFromVeritaqc: !!qcRangeImportSource,
          importSource: qcRangeImportSource,
        }),
        instruments: JSON.stringify(qcAnalyzers),
        status: results.overallPass ? "pass" : "fail",
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
        teaIsPercentage: 1, teaUnit: '%', cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel,
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
        teaIsPercentage: 1, teaUnit: '%', cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel,
        dataPoints: JSON.stringify({ specimens: refData.map(d => ({ specimenId: d.specimenId, value: d.value })), refLow: lo, refHigh: hi, analyte: refAnalyte, units: refUnits }),
        instruments: JSON.stringify(instrumentNames.slice(0, 1)),
        status: results.overallPass ? "pass" : "fail",
        createdAt: new Date().toISOString(),
      };
      saveMutation.mutate(study);
      return;
    }

    if (studyType === "carryover") {
      const valid = coData.filter(dp => dp.value !== null && !isNaN(dp.value as number));
      if (valid.length < 12) { toast({ title: `Please enter at least 12 specimen values (${valid.length} entered). EP10-A3 standard is 21.`, variant: "destructive" }); return; }
      const lValues = valid.filter(d => d.sample_type === "L").map(d => d.value as number);
      const hValues = valid.filter(d => d.sample_type === "H").map(d => d.value as number);
      const ll: number[] = [], lh: number[] = [];
      const classifications: string[] = [];
      for (let i = 0; i < valid.length; i++) {
        const dp = valid[i];
        let cls = "";
        if (i > 0) {
          const prev = valid[i - 1];
          if (dp.sample_type === "L") {
            if (prev.sample_type === "L") { ll.push(dp.value as number); cls = "L-after-L"; }
            else { lh.push(dp.value as number); cls = "L-after-H"; }
          } else {
            cls = prev.sample_type === "H" ? "H-after-H" : "H-after-L";
          }
        }
        classifications.push(cls);
      }
      if (ll.length < 2 || lh.length < 1) { toast({ title: `Need at least 2 L-after-L and 1 L-after-H specimens to compute carryover (have LL=${ll.length}, LH=${lh.length})`, variant: "destructive" }); return; }
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
      const sd = (a: number[]) => {
        if (a.length < 2) return 0;
        const m = mean(a);
        return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
      };
      const meanL = lValues.length ? mean(lValues) : 0;
      const meanH = hValues.length ? mean(hValues) : 0;
      const meanLL = mean(ll), meanLH = mean(lh);
      const sdLL = sd(ll), sdLH = sd(lh);
      const carryoverAbs = Math.abs(meanLH - meanLL);
      const carryoverPct = (meanH - meanL) !== 0 ? ((meanLH - meanLL) / (meanH - meanL)) * 100 : null;
      const errorLimit = 3 * sdLL;
      const overallPass = carryoverAbs <= errorLimit;
      const results = {
        type: "carryover",
        analyte: testName.trim(),
        units: coUnits,
        specimens: valid.map((d, i) => ({ sequence: d.sequence, sample_type: d.sample_type, value: d.value, classification: classifications[i] })),
        mean_L: meanL, mean_H: meanH,
        n_LL: ll.length, n_LH: lh.length,
        mean_LL: meanLL, mean_LH: meanLH,
        sd_LL: sdLL, sd_LH: sdLH,
        carryover_absolute: carryoverAbs,
        carryover_pct: carryoverPct,
        error_limit: errorLimit,
        overallPass,
        summary: overallPass
          ? `Absolute carryover ${carryoverAbs.toFixed(3)} ${coUnits} did not exceed the Error Limit of ${errorLimit.toFixed(3)} ${coUnits} (3 x SD of L-after-L specimens). Carryover is within the noise floor.`
          : `Absolute carryover ${carryoverAbs.toFixed(3)} ${coUnits} exceeded the Error Limit of ${errorLimit.toFixed(3)} ${coUnits} (3 x SD of L-after-L specimens). Investigate sampling system contamination.`,
      };
      const study: InsertStudy = {
        testName: testName.trim(), instrument: instrumentNames[0] || "-", analyst: analyst.trim() || "-",
        date, studyType: "carryover", cliaAllowableError: 0.01,
        teaIsPercentage: 1, teaUnit: '%', cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel,
        dataPoints: JSON.stringify({
          specimens: valid.map(d => ({ sequence: d.sequence, sample_type: d.sample_type, value: d.value })),
          units: coUnits,
        }),
        instruments: JSON.stringify(instrumentNames.slice(0, 1)),
        status: overallPass ? "pass" : "fail",
        createdAt: new Date().toISOString(),
      };
      saveMutation.mutate(study);
      return;
    }

    if (studyType === "accuracy_bias") {
      if (!abAnalyte.trim()) { toast({ title: "Enter the analyte name", variant: "destructive" }); return; }
      const selectedPreset = CLIA_PRESETS[cliaPreset];
      const tea = selectedPreset?.value && selectedPreset.value !== 0 ? selectedPreset.value : customClia;
      // Dual-criterion S493: when the selected CLIA preset carries an absolute
      // floor (e.g. Sodium ±4 mmol/L, ALT/SGPT ±15% or ±6 U/L), persist it so
      // the server evaluator + screen render + PDF can apply
      // max(percent_allowance, absolute_floor) at every level.
      const presetIsPercentage = (selectedPreset as any)?.isPercentage !== false;
      const presetAbsFloor: number | null = presetIsPercentage ? ((selectedPreset as any)?.absoluteFloor ?? null) : null;
      const presetAbsUnit: string | null = presetIsPercentage ? ((selectedPreset as any)?.absoluteUnit ?? null) : null;
      const FP_EPS = 1e-9;
      const builtLevels = abLevels.map(lv => {
        const reps = (abRunData[lv.name] || []).filter(v => v !== undefined && v !== null && !isNaN(v));
        return { name: lv.name, assigned_value: lv.assignedValue, replicates: reps };
      });
      const usableLevels = builtLevels.filter(lv => lv.assigned_value !== null && lv.replicates.length >= 5);
      if (usableLevels.length < 2) {
        toast({ title: `Need at least 2 levels with assigned value and 5+ replicates each (have ${usableLevels.length})`, variant: "destructive" });
        return;
      }
      let allPass = true;
      const perLevel = builtLevels.map(lv => {
        const reps = lv.replicates;
        const n = reps.length;
        const assigned = lv.assigned_value;
        if (n === 0 || assigned === null || assigned === 0) {
          return { name: lv.name, assigned_value: assigned, n, mean: null as number | null, sd: null as number | null, pctRecovery: null as number | null, absBiasPct: null as number | null, absBias: null as number | null, allowance: null as number | null, verdict: "incomplete" as const };
        }
        const mean = reps.reduce((s, v) => s + v, 0) / n;
        const variance = n > 1 ? reps.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
        const sdv = Math.sqrt(variance);
        const pctRecovery = (mean / assigned) * 100;
        const absBias = Math.abs(mean - assigned);
        const absBiasPct = absBias / Math.abs(assigned) * 100;
        const pctAllowance = presetIsPercentage ? Math.abs(assigned) * tea : 0;
        const absAllowance = presetIsPercentage ? (presetAbsFloor ?? 0) : tea;
        const allowance = Math.max(pctAllowance, absAllowance);
        const pass = absBias <= allowance + FP_EPS;
        if (!pass) allPass = false;
        return { name: lv.name, assigned_value: assigned, n, mean, sd: sdv, pctRecovery, absBiasPct, absBias, allowance, verdict: pass ? "pass" as const : "fail" as const };
      });
      const teaTxt = presetIsPercentage ? `${(tea * 100).toFixed(1)}%` : `${tea} ${presetAbsUnit || ""}`.trim();
      const floorTxt = presetIsPercentage && presetAbsFloor ? ` or ${presetAbsFloor} ${presetAbsUnit || ""}, whichever is greater` : "";
      const results = {
        type: "accuracy_bias",
        analyte: abAnalyte.trim(),
        units: abUnits.trim(),
        tea,
        teaIsPercentage: presetIsPercentage,
        absoluteFloor: presetAbsFloor,
        absoluteUnit: presetAbsUnit,
        levels: perLevel,
        overallPass: allPass,
        summary: allPass
          ? `All levels met the CLIA total allowable error criterion of ${teaTxt}${floorTxt} for ${abAnalyte.trim()}.`
          : `One or more levels exceeded the CLIA total allowable error criterion of ${teaTxt}${floorTxt} for ${abAnalyte.trim()}.`,
      };
      const study: InsertStudy = {
        testName: testName.trim() || abAnalyte.trim(),
        instrument: instrumentNames[0] || "-",
        analyst: analyst.trim() || "-",
        date,
        studyType: "accuracy_bias",
        cliaAllowableError: tea,
        teaIsPercentage: presetIsPercentage ? 1 : 0,
        teaUnit: presetIsPercentage ? '%' : (presetAbsUnit || abUnits.trim() || null),
        cliaAbsoluteFloor: presetAbsFloor,
        cliaAbsoluteUnit: presetAbsUnit,
        cliaPresetLabel,
        dataPoints: JSON.stringify({
          analyte: abAnalyte.trim(),
          units: abUnits.trim(),
          levels: builtLevels,
          // Phase B audit trail: when the user populated the form via the
          // VeritaQC import modal, persist the provenance object so the
          // director-review surface and any future inspection-export can
          // surface it. Calculator + PDF builder ignore unknown keys.
          ...(accuracyBiasImportSource ? {
            importedFromVeritaqc: true,
            importSource: accuracyBiasImportSource,
          } : {}),
        }),
        instruments: JSON.stringify(instrumentNames.slice(0, 1)),
        status: allPass ? "pass" : "fail",
        createdAt: new Date().toISOString(),
      };
      saveMutation.mutate(study);
      return;
    }

    if (studyType === "linearity") {
      if (!linAnalyte.trim()) { toast({ title: "Enter the analyte name", variant: "destructive" }); return; }
      const selectedPreset = CLIA_PRESETS[cliaPreset];
      const tea = selectedPreset?.value && selectedPreset.value !== 0 ? selectedPreset.value : customClia;
      const presetIsPercentage = (selectedPreset as any)?.isPercentage !== false;
      const presetAbsFloor: number | null = presetIsPercentage ? ((selectedPreset as any)?.absoluteFloor ?? null) : null;
      const presetAbsUnit: string | null = presetIsPercentage ? ((selectedPreset as any)?.absoluteUnit ?? null) : null;
      const FP_EPS = 1e-9;
      const builtLevels = linLevels.map(lv => {
        const reps = (linRunData[lv.name] || []).filter(v => v !== undefined && v !== null && !isNaN(v));
        return { name: lv.name, assigned_value: lv.assignedValue, replicates: reps };
      });
      const usableLevels = builtLevels.filter(lv => lv.assigned_value !== null && lv.replicates.length >= 2);
      if (usableLevels.length < 3) {
        toast({ title: `Need at least 3 levels with assigned value and 2+ replicates each (have ${usableLevels.length})`, variant: "destructive" });
        return;
      }
      // OLS regression on per-level means
      const pts = usableLevels.map(lv => ({
        x: lv.assigned_value as number,
        y: (lv.replicates.reduce((s, v) => s + v, 0) / lv.replicates.length),
      }));
      const n = pts.length;
      const meanX = pts.reduce((s, p) => s + p.x, 0) / n;
      const meanY = pts.reduce((s, p) => s + p.y, 0) / n;
      const ssXX = pts.reduce((s, p) => s + (p.x - meanX) ** 2, 0);
      const ssYY = pts.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
      const ssXY = pts.reduce((s, p) => s + (p.x - meanX) * (p.y - meanY), 0);
      const slope = ssXX > 0 ? ssXY / ssXX : 0;
      const intercept = meanY - slope * meanX;
      const r2 = (ssXX > 0 && ssYY > 0) ? (ssXY * ssXY) / (ssXX * ssYY) : 0;
      const slopeBiasPct = Math.abs(slope - 1) * 100;
      const teaPct = presetIsPercentage ? tea * 100 : 100;
      const slopePass = slopeBiasPct <= teaPct + FP_EPS;
      const r2Pass = r2 >= 0.95 - FP_EPS;
      const overallPass = slopePass && r2Pass;
      // Per-level rows: mean, SD, %recovery, individual verdict against TEa
      const perLevel = builtLevels.map(lv => {
        const reps = lv.replicates;
        const nReps = reps.length;
        const assigned = lv.assigned_value;
        if (nReps === 0 || assigned === null || assigned === 0) {
          return { name: lv.name, assigned_value: assigned, n: nReps, mean: null as number | null, sd: null as number | null, pctRecovery: null as number | null, absBias: null as number | null, allowance: null as number | null, verdict: "incomplete" as const };
        }
        const meanV = reps.reduce((s, v) => s + v, 0) / nReps;
        const variance = nReps > 1 ? reps.reduce((s, v) => s + (v - meanV) ** 2, 0) / (nReps - 1) : 0;
        const sdv = Math.sqrt(variance);
        const pctRecovery = (meanV / assigned) * 100;
        const absBias = Math.abs(meanV - assigned);
        const pctAllowance = presetIsPercentage ? Math.abs(assigned) * tea : 0;
        const absAllowance = presetIsPercentage ? (presetAbsFloor ?? 0) : tea;
        const allowance = Math.max(pctAllowance, absAllowance);
        const pass = absBias <= allowance + FP_EPS;
        return { name: lv.name, assigned_value: assigned, n: nReps, mean: meanV, sd: sdv, pctRecovery, absBias, allowance, verdict: pass ? "pass" as const : "fail" as const };
      });
      const teaTxt = presetIsPercentage ? `${(tea * 100).toFixed(1)}%` : `${tea} ${presetAbsUnit || ""}`.trim();
      // Coverage Summary computation (only when both bounds present). Verdict
      // logic is untouched -- this is informational only, surfacing the gap
      // between the verified range and the manufacturer's claimed AMR so the
      // director's adjudication on coverage adequacy is visible on the PDF.
      const linCL: number | null = linClaimedLow === "" ? null : Number(linClaimedLow);
      const linCH: number | null = linClaimedHigh === "" ? null : Number(linClaimedHigh);
      let coverage: any = null;
      if (linCL !== null && linCH !== null && linCH > linCL) {
        const verifiedAssigned = usableLevels
          .map(lv => lv.assigned_value as number)
          .filter(v => Number.isFinite(v));
        if (verifiedAssigned.length >= 2) {
          const verifiedLow = Math.min(...verifiedAssigned);
          const verifiedHigh = Math.max(...verifiedAssigned);
          const claimedSpan = linCH - linCL;
          // Negative gap = calibrators reached past the claimed bound; clamp to 0.
          const upperGapAbs = Math.max(0, linCH - verifiedHigh);
          const lowerGapAbs = Math.max(0, verifiedLow - linCL);
          const upperGapPct = (upperGapAbs / claimedSpan) * 100;
          const lowerGapPct = (lowerGapAbs / claimedSpan) * 100;
          const verifiedCoveragePct = Math.max(0, 100 - upperGapPct - lowerGapPct);
          coverage = {
            claimed_low: linCL,
            claimed_high: linCH,
            verified_low: verifiedLow,
            verified_high: verifiedHigh,
            upper_gap_abs: upperGapAbs,
            lower_gap_abs: lowerGapAbs,
            upper_gap_pct: upperGapPct,
            lower_gap_pct: lowerGapPct,
            verified_coverage_pct: verifiedCoveragePct,
          };
        }
      }
      const results = {
        type: "linearity",
        analyte: linAnalyte.trim(),
        units: linUnits.trim(),
        tea,
        teaIsPercentage: presetIsPercentage,
        absoluteFloor: presetAbsFloor,
        absoluteUnit: presetAbsUnit,
        slope,
        intercept,
        r2,
        slopeBiasPct,
        levels: perLevel,
        overallPass,
        claimed_range_low: linCL,
        claimed_range_high: linCH,
        coverage,
        summary: overallPass
          ? `Linearity verified across ${pts.length} levels: |slope - 1| × 100 = ${slopeBiasPct.toFixed(2)}% (within TEa ${teaTxt}) and r² = ${r2.toFixed(4)} (≥ 0.95).`
          : `Linearity not verified: |slope - 1| × 100 = ${slopeBiasPct.toFixed(2)}% ${slopePass ? "within" : "exceeds"} TEa ${teaTxt}; r² = ${r2.toFixed(4)} ${r2Pass ? "meets" : "below"} 0.95.`,
      };
      const study: InsertStudy = {
        testName: testName.trim() || linAnalyte.trim(),
        instrument: instrumentNames[0] || "-",
        analyst: analyst.trim() || "-",
        date,
        studyType: "linearity",
        cliaAllowableError: tea,
        teaIsPercentage: presetIsPercentage ? 1 : 0,
        teaUnit: presetIsPercentage ? '%' : (presetAbsUnit || linUnits.trim() || null),
        cliaAbsoluteFloor: presetAbsFloor,
        cliaAbsoluteUnit: presetAbsUnit,
        cliaPresetLabel,
        dataPoints: JSON.stringify({
          analyte: linAnalyte.trim(),
          units: linUnits.trim(),
          levels: builtLevels,
          claimed_range_low: linCL,
          claimed_range_high: linCH,
          coverage,
          // Phase C audit trail: persist VeritaQC provenance when the import
          // path was used. Calculator + PDF ignore unknown keys.
          ...(linearityImportSource ? {
            importedFromVeritaqc: true,
            importSource: linearityImportSource,
          } : {}),
        }),
        instruments: JSON.stringify(instrumentNames.slice(0, 1)),
        status: overallPass ? "pass" : "fail",
        createdAt: new Date().toISOString(),
      };
      saveMutation.mutate(study);
      return;
    }

    if (studyType === "reportable_range") {
      if (!rrAnalyte.trim()) { toast({ title: "Enter the analyte name", variant: "destructive" }); return; }
      const selectedPreset = CLIA_PRESETS[cliaPreset];
      const tea = selectedPreset?.value && selectedPreset.value !== 0 ? selectedPreset.value : customClia;
      const presetIsPercentage = (selectedPreset as any)?.isPercentage !== false;
      const presetAbsFloor: number | null = presetIsPercentage ? ((selectedPreset as any)?.absoluteFloor ?? null) : null;
      const presetAbsUnit: string | null = presetIsPercentage ? ((selectedPreset as any)?.absoluteUnit ?? null) : null;
      const FP_EPS = 1e-9;
      const builtLevels = rrLevels.map(lv => {
        const reps = (rrRunData[lv.name] || []).filter(v => v !== undefined && v !== null && !isNaN(v));
        return { name: lv.name, assigned_value: lv.assignedValue, replicates: reps };
      });
      const usableLevels = builtLevels.filter(lv => lv.assigned_value !== null && lv.replicates.length >= 2);
      if (usableLevels.length < 2) {
        toast({ title: `Need at least 2 levels with assigned value and 2+ replicates each (have ${usableLevels.length})`, variant: "destructive" });
        return;
      }
      let allPass = true;
      const perLevel = builtLevels.map(lv => {
        const reps = lv.replicates;
        const n = reps.length;
        const assigned = lv.assigned_value;
        if (n === 0 || assigned === null || assigned === 0) {
          return { name: lv.name, assigned_value: assigned, n, mean: null as number | null, sd: null as number | null, pctRecovery: null as number | null, absBiasPct: null as number | null, absBias: null as number | null, allowance: null as number | null, verdict: "incomplete" as const };
        }
        const mean = reps.reduce((s, v) => s + v, 0) / n;
        const variance = n > 1 ? reps.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
        const sdv = Math.sqrt(variance);
        const pctRecovery = (mean / assigned) * 100;
        const absBias = Math.abs(mean - assigned);
        const absBiasPct = absBias / Math.abs(assigned) * 100;
        const pctAllowance = presetIsPercentage ? Math.abs(assigned) * tea : 0;
        const absAllowance = presetIsPercentage ? (presetAbsFloor ?? 0) : tea;
        const allowance = Math.max(pctAllowance, absAllowance);
        const pass = absBias <= allowance + FP_EPS;
        if (!pass) allPass = false;
        return { name: lv.name, assigned_value: assigned, n, mean, sd: sdv, pctRecovery, absBiasPct, absBias, allowance, verdict: pass ? "pass" as const : "fail" as const };
      });
      const teaTxt = presetIsPercentage ? `${(tea * 100).toFixed(1)}%` : `${tea} ${presetAbsUnit || ""}`.trim();
      const floorTxt = presetIsPercentage && presetAbsFloor ? ` or ${presetAbsFloor} ${presetAbsUnit || ""}, whichever is greater` : "";
      const cl: number | null = rrClaimedLow === "" ? null : Number(rrClaimedLow);
      const ch: number | null = rrClaimedHigh === "" ? null : Number(rrClaimedHigh);
      const rangeTxt = (cl !== null && ch !== null) ? ` for a claimed reportable range of ${cl} to ${ch} ${rrUnits.trim() || "units"}` : "";
      const results = {
        type: "reportable_range",
        analyte: rrAnalyte.trim(),
        units: rrUnits.trim(),
        tea,
        teaIsPercentage: presetIsPercentage,
        absoluteFloor: presetAbsFloor,
        absoluteUnit: presetAbsUnit,
        claimed_range_low: cl,
        claimed_range_high: ch,
        levels: perLevel,
        overallPass: allPass,
        summary: allPass
          ? `All ${perLevel.length} levels met the CLIA total allowable error criterion of ${teaTxt}${floorTxt} for ${rrAnalyte.trim()}${rangeTxt}.`
          : `One or more levels exceeded the CLIA total allowable error criterion of ${teaTxt}${floorTxt} for ${rrAnalyte.trim()}${rangeTxt}.`,
      };
      const study: InsertStudy = {
        testName: testName.trim() || rrAnalyte.trim(),
        instrument: instrumentNames[0] || "-",
        analyst: analyst.trim() || "-",
        date,
        studyType: "reportable_range",
        cliaAllowableError: tea,
        teaIsPercentage: presetIsPercentage ? 1 : 0,
        teaUnit: presetIsPercentage ? '%' : (presetAbsUnit || rrUnits.trim() || null),
        cliaAbsoluteFloor: presetAbsFloor,
        cliaAbsoluteUnit: presetAbsUnit,
        cliaPresetLabel,
        dataPoints: JSON.stringify({
          analyte: rrAnalyte.trim(),
          units: rrUnits.trim(),
          claimed_range_low: cl,
          claimed_range_high: ch,
          levels: builtLevels,
          // Phase C audit trail: persist VeritaQC provenance when the import
          // path was used. Calculator + PDF ignore unknown keys.
          ...(reportableRangeImportSource ? {
            importedFromVeritaqc: true,
            importSource: reportableRangeImportSource,
          } : {}),
        }),
        instruments: JSON.stringify(instrumentNames.slice(0, 1)),
        status: allPass ? "pass" : "fail",
        createdAt: new Date().toISOString(),
      };
      saveMutation.mutate(study);
      return;
    }

    if (studyType === "sensitivity") {
      // Parse a sensitivity textarea: one replicate per line, "value" or "value,lot".
      const parseSens = (text: string): { value: number; lot?: string }[] =>
        text.split(/\r?\n/).map(line => {
          const parts = line.split(/[,\t]/).map(p => p.trim()).filter(p => p.length > 0);
          if (parts.length === 0) return null;
          const val = parseFloat(parts[0]);
          if (isNaN(val)) return null;
          return { value: val, lot: parts[1] || undefined };
        }).filter((x): x is { value: number; lot?: string } => x !== null);

      const blanks = parseSens(sensBlanksText);
      const lowLevel = parseSens(sensLowLevelText);
      if (blanks.length < 5) { toast({ title: "Enter at least 5 blank replicates", variant: "destructive" }); return; }
      if (lowLevel.length < 5) { toast({ title: "Enter at least 5 low-level replicates", variant: "destructive" }); return; }

      const loqLevels = sensLoqLevels
        .map(lvl => ({ expectedConcentration: parseFloat(lvl.expectedConcentration), replicates: parseSens(lvl.repsText) }))
        .filter(g => !isNaN(g.expectedConcentration) && g.replicates.length > 0);

      const mfgClaim = sensMode === "verification" ? {
        lob: sensMfgLob !== "" ? parseFloat(sensMfgLob) : undefined,
        lod: sensMfgLod !== "" ? parseFloat(sensMfgLod) : undefined,
        loq: sensMfgLoq !== "" ? parseFloat(sensMfgLoq) : undefined,
      } : undefined;

      const input: SensitivityInput = {
        mode: sensMode,
        blanks,
        lowLevel,
        loqLevels: loqLevels.length > 0 ? loqLevels : undefined,
        cvThreshold: sensCvThreshold / 100,
        biasThreshold: sensBiasThreshold / 100,
        manufacturerClaim: mfgClaim,
      };
      const results = calculateSensitivity(input);
      const study: InsertStudy = {
        testName: testName.trim() || sensAnalyteName || "Sensitivity Study",
        instrument: instrumentNames[0] || "-",
        analyst: analyst.trim() || "-",
        date,
        studyType: "sensitivity",
        cliaAllowableError: 0,
        teaIsPercentage: 0,
        teaUnit: sensUnits || null,
        cliaAbsoluteFloor: null,
        cliaAbsoluteUnit: sensUnits || null,
        cliaPresetLabel,
        dataPoints: JSON.stringify({ input, results }),
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
      // VeritaQC Import audit trail (design doc v2 decision #5). When the
      // tech ran "Import from VeritaQC…" earlier in this session, augment
      // level 0 of the persisted precDataPoints with importedFromVeritaqc +
      // importSource. The calculator and PDF builder ignore these extra
      // keys; the director-review surface and any future inspection-export
      // can read them off data_points. Drops to no-op if the user typed the
      // values by hand (no import was run).
      if (precisionImportSource && precDataPoints.length > 0) {
        (precDataPoints[0] as any).importedFromVeritaqc = true;
        (precDataPoints[0] as any).importSource = precisionImportSource;
      }
      // Phase 3 simple-precision parity: parse optional EE-style inputs from
      // text state, omit any empty / non-numeric field so the calculator
      // skips that branch (e.g. no targetMean -> no bias / %bias output).
      const numOrNull = (s: string) => {
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : null;
      };
      const vendorSdNum = numOrNull(precisionVendorSd);
      const vendorSdConcNum = numOrNull(precisionVendorSdConc);
      const targetMeanNum = numOrNull(precisionTargetMean);
      const targetCvNum = numOrNull(precisionTargetCv);
      const results = calculatePrecision(precDataPoints, cliaValue, precisionMode, {
        vendorSD: vendorSdNum ?? undefined,
        vendorSDConcentration: vendorSdConcNum ?? undefined,
        targetMean: targetMeanNum ?? undefined,
        targetCV: targetCvNum ?? undefined,
      });
      // EE Day 2 QC traceability: trim each, omit empties.
      const trimOrNull = (s: string) => {
        const t = s.trim();
        return t.length > 0 ? t : null;
      };
      const study: InsertStudy = {
        testName: testName.trim(), instrument: instrumentNames[0] || "-", analyst: analyst.trim() || "-",
        date, studyType: "precision", cliaAllowableError: cliaValue,
        teaIsPercentage: teaIsPercentage ? 1 : 0, teaUnit, cliaAbsoluteFloor, cliaAbsoluteUnit, cliaPresetLabel,
        dataPoints: JSON.stringify(precDataPoints),
        instruments: JSON.stringify(instrumentNames.slice(0, 1)),
        status: results.overallPass ? "pass" : "fail",
        createdAt: new Date().toISOString(),
        // Persist the optional simple-precision inputs alongside the study so
        // the server-side PDF builder can render User's Specifications and
        // the on-screen view can re-derive CIs / bias / vendor verdict.
        vendorSd: vendorSdNum,
        vendorSdConcentration: vendorSdConcNum,
        targetMean: targetMeanNum,
        targetCv: targetCvNum,
        // EE Day 2 QC traceability fields.
        controlLot: trimOrNull(precisionControlLot),
        reagentLot: trimOrNull(precisionReagentLot),
        comment: trimOrNull(precisionComment),
        resultUnits: trimOrNull(precisionResultUnits),
      } as InsertStudy;
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
          teaIsPercentage: teaIsPercentage ? 1 : 0, teaUnit, cliaAbsoluteFloor, cliaAbsoluteUnit, cliaPresetLabel,
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
          teaIsPercentage: teaIsPercentage ? 1 : 0, teaUnit, cliaAbsoluteFloor, cliaAbsoluteUnit, cliaPresetLabel,
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
        teaIsPercentage: teaIsPercentage ? 1 : 0, teaUnit, cliaAbsoluteFloor, cliaAbsoluteUnit, cliaPresetLabel,
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
      teaIsPercentage: teaIsPercentage ? 1 : 0, teaUnit, cliaAbsoluteFloor, cliaAbsoluteUnit, cliaPresetLabel,
      dataPoints: JSON.stringify(dataPoints),
      instruments: JSON.stringify(instrumentNames), status: results.overallPass ? "pass" : "fail",
      createdAt: new Date().toISOString(),
    };
    saveMutation.mutate(study);
  };

    useSEO({ title: "VeritaCheck™ | CLIA Performance Verification Software for Clinical Labs", description: "Run EP studies for accuracy, precision, reportable range, and reference ranges. Generates director-signed, survey-ready verification documentation." });
return (
    <div>
      {activeLabId ? (
        <VeritaQcImportModal
          open={qcImportOpen}
          onOpenChange={setQcImportOpen}
          labId={activeLabId}
          defaultAnalyte={(
            qcImportMode === "accuracy_bias" ? abAnalyte.trim()
            : qcImportMode === "linearity" ? linAnalyte.trim()
            : qcImportMode === "reportable_range" ? rrAnalyte.trim()
            : testName.trim()
          ) || undefined}
          studyMode={qcImportMode}
          onImport={handleVeritaQcImport}
        />
      ) : null}
      {activeLabId ? (
        <VeritaQcBulkImportModal
          open={qcBulkImportOpen}
          onOpenChange={setQcBulkImportOpen}
          labId={activeLabId}
          defaultAnalyte={qcBulkImportAnalyte || undefined}
          onImport={handleVeritaQcBulkImport}
        />
      ) : null}
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
                    CLIA Performance Verification and EP Study Platform
                  </p>
                  <div className="border-l-4 border-primary pl-4 mb-6">
                    <p className="text-base leading-relaxed italic text-foreground/90">
                      "The studies your lab has already been running, finally documented the way surveyors expect."
                    </p>
                  </div>
                  <p className="text-muted-foreground leading-relaxed mb-4">
                    VeritaCheck{"\u2122"} automates calibration verification, method comparison, accuracy and precision, lot-to-lot verification, and PT/coag new lot validation. Every study generates a signed, audit-ready PDF report with scatter plots, statistical analysis, and pass/fail evaluation, mapped to 42 CFR Part 493, TJC standards, and CAP checklists.
                  </p>
                  <p className="text-muted-foreground leading-relaxed mb-6">
                    Built by a former TJC laboratory surveyor with 200+ inspections. VeritaCheck{"\u2122"} produces exactly what your surveyors want to see, because it was designed by someone who reviewed these reports for years.
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
                      <Link href="/login">Launch VeritaCheck{"\u2122"} <ChevronRight size={15} className="ml-1" /></Link>
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
                        <div>Reagent Lot Verification (EP26-A)</div>
                        <div>PT/INR Geometric Mean Calculator</div>
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
                <Badge className="bg-primary/10 text-primary border-0">VeritaCheck{"\u2122"}</Badge>
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
              <Link href={labRoute("/dashboard")} className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium gap-1.5 hover:bg-background/60 transition-colors">
                <LayoutDashboard size={13} />My Studies
              </Link>
              <Link href={labRoute("/dashboard/verifications")} className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium gap-1.5 hover:bg-background/60 transition-colors">
                <ClipboardCheck size={13} />Instrument Verification
              </Link>
              <Link href={labRoute("/veritacheck/cumsum")} className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium gap-1.5 hover:bg-background/60 transition-colors">
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
                          <SelectItem value="cal_ver">Calibration Verification (CLSI EP06)</SelectItem>
                          <SelectItem value="method_comparison">Method Comparison: Multi-Instrument Correlation (CLSI EP09 + EP15-A3)</SelectItem>
                          <SelectItem value="precision">Precision Verification (CLSI EP15-A3)</SelectItem>
                          <SelectItem value="lot_to_lot">Reagent Lot Verification (CLSI EP26-A)</SelectItem>
                          <SelectItem value="pt_coag">PT/INR Geometric Mean Calculator (CLSI H47)</SelectItem>
                          <SelectItem value="qc_range">QC Lot Verification (CLSI C24-Ed4)</SelectItem>
                          <SelectItem value="multi_analyte_coag">Multi-Analyte Lot Comparison, Coag (CLSI EP26-A)</SelectItem>
                          <SelectItem value="ref_interval">Reference Range Verification (CLSI EP28)</SelectItem>
                          <SelectItem value="sensitivity">Sensitivity Verification (CLSI EP17-A2)</SelectItem>
                          <SelectItem value="carryover">Carryover Verification (CLSI EP10-A3)</SelectItem>
                          <SelectItem value="accuracy_bias">Accuracy / Bias: Single Instrument vs Target (CLSI EP15-A3)</SelectItem>
                          <SelectItem value="linearity">Linearity (CLSI EP06)</SelectItem>
                          <SelectItem value="reportable_range">Reportable Range / AMR Verification (CLIA §493.1255)</SelectItem>
                        </SelectContent>
                      </Select>
                      {studyType === "cal_ver" && (
                        <div className="flex items-start gap-2 mt-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                          <Info size={13} className="text-primary shrink-0 mt-0.5" />
                          <span>Calibration verification is required by CLIA even when your analyzer uses manufacturer-assigned calibration. VeritaCheck documents the verification process, not the calibration itself, which is what 42 CFR {"\u00A7"}493.1255 actually requires.</span>
                        </div>
                      )}
                      {studyType === "accuracy_bias" && (
                        <div className="flex items-start gap-2 mt-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                          <Info size={13} className="text-primary shrink-0 mt-0.5" />
                          <span>Use this study type when verifying a single instrument against known target values per CLSI EP15-A3. Replicates at multiple levels are compared to assigned values from QC material, proficiency testing samples, or certified reference material. For comparing one instrument to a reference method or another analyzer, pick Method Comparison instead.</span>
                        </div>
                      )}
                      {studyType === "method_comparison" && (
                        <div className="flex items-start gap-2 mt-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                          <Info size={13} className="text-primary shrink-0 mt-0.5" />
                          <span>Use this study type when comparing a new instrument to a reference method or comparing multiple instruments to a Gold Standard per CLSI EP09. Paired patient samples are analyzed for correlation, slope, intercept, and bias. For single-instrument accuracy against assigned target values, pick Accuracy / Bias instead.</span>
                        </div>
                      )}
                      {(studyType === "precision" || studyType === "accuracy_bias" || studyType === "linearity" || studyType === "reportable_range") && activeLabId ? (
                        <div className="flex items-center justify-between gap-2 mt-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs leading-relaxed">
                          <span className="text-muted-foreground">
                            Already running daily QC for this analyte? Skip manual entry and pull replicates from VeritaQC{"\u2122"}.
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs shrink-0"
                            onClick={() => {
                              const mode = studyType === "accuracy_bias" ? "accuracy_bias"
                                : studyType === "linearity" ? "linearity"
                                : studyType === "reportable_range" ? "reportable_range"
                                : "precision";
                              setQcImportMode(mode);
                              setQcImportOpen(true);
                            }}
                            data-testid="button-veritaqc-import-setup"
                          >
                            Start from VeritaQC{"\u2122\u2026"}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base flex items-center justify-between">
                  {studyType === "method_comparison" ? "Instruments / Methods" : "Instruments / Methods"}
                  <Button variant="outline" size="sm" onClick={addInstrument} disabled={instrumentNames.length >= (studyType === "method_comparison" ? 10 : 5)}><PlusCircle size={13} className="mr-1" />{studyType === "method_comparison" ? "Add Instrument" : "Add"}</Button>
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
                            <div className="flex-1 space-y-1.5">
                              <Select
                                value={linkedInstruments[idx] ? `__lab_${linkedInstruments[idx]!.id}` : "__manual__"}
                                onValueChange={v => {
                                  if (v === "__manual__") { setLinkedInstruments(prev => { const next = { ...prev }; delete next[idx]; return next; }); return; }
                                  if (v.startsWith("__lab_")) {
                                    const instId = parseInt(v.slice(6));
                                    const inst = veritaMapInstruments.find(i => i.id === instId);
                                    if (inst) selectLabInstrument(idx, inst);
                                  }
                                }}
                              >
                                <SelectTrigger className="h-9"><SelectValue placeholder="Select instrument..." /></SelectTrigger>
                                <SelectContent>
                                  {groupedInstruments.map(group => (
                                    <SelectGroup key={`mc-grp-${group.mapId}`}>
                                      <SelectLabel>{group.mapName}</SelectLabel>
                                      {group.items.map(inst => (
                                        <SelectItem key={`lab-${inst.id}`} value={`__lab_${inst.id}`}>
                                          {labInstrumentLabelWithContext(inst)}
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  ))}
                                  <SelectItem value="__manual__">Or enter manually...</SelectItem>
                                </SelectContent>
                              </Select>
                              {idx === 0 && hasAmbiguousDuplicates && (
                                <p className="text-xs text-amber-700 dark:text-amber-400 ml-1">Some instruments share the same model in one map. Add nicknames in VeritaMap{"\u2122"} to tell them apart.</p>
                              )}
                              {linkedInstruments[idx] && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1">
                                  <CheckCircle2 size={11} className="text-emerald-600 shrink-0" />
                                  <span>Linked to VeritaMap{"\u2122"}</span>
                                  {linkedInstruments[idx]!.serial_number && <span className="font-mono">S/N {linkedInstruments[idx]!.serial_number}</span>}
                                </div>
                              )}
                              {!linkedInstruments[idx] && (
                                <Input value={name} onChange={e => updateInstrumentName(idx, e.target.value)} placeholder="e.g., Beckman Coulter AU5800" className="text-sm" />
                              )}
                            </div>
                            {idx > 0 && instrumentNames.length > 2 && <Button variant="ghost" size="icon" onClick={() => removeInstrument(idx)} className="text-muted-foreground hover:text-destructive shrink-0 w-8 h-8"><Trash2 size={13} /></Button>}
                          </div>
                        </div>
                      ))}
                    </>
                  ) : (
                    instrumentNames.map((name, idx) => (
                      <div key={idx} className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="w-7 justify-center shrink-0 text-xs">{idx + 1}</Badge>
                          <div className="flex-1 space-y-1.5">
                            <Select
                              value={linkedInstruments[idx] ? `__lab_${linkedInstruments[idx]!.id}` : "__manual__"}
                              onValueChange={v => {
                                if (v === "__manual__") { setLinkedInstruments(prev => { const next = { ...prev }; delete next[idx]; return next; }); return; }
                                if (v.startsWith("__lab_")) {
                                  const instId = parseInt(v.slice(6));
                                  const inst = veritaMapInstruments.find(i => i.id === instId);
                                  if (inst) selectLabInstrument(idx, inst);
                                }
                              }}
                            >
                              <SelectTrigger className="h-9"><SelectValue placeholder="Select instrument..." /></SelectTrigger>
                              <SelectContent>
                                {groupedInstruments.map(group => (
                                  <SelectGroup key={`gen-grp-${group.mapId}`}>
                                    <SelectLabel>{group.mapName}</SelectLabel>
                                    {group.items.map(inst => (
                                      <SelectItem key={`lab-${inst.id}`} value={`__lab_${inst.id}`}>
                                        {labInstrumentLabelWithContext(inst)}
                                      </SelectItem>
                                    ))}
                                  </SelectGroup>
                                ))}
                                <SelectItem value="__manual__">Or enter manually...</SelectItem>
                              </SelectContent>
                            </Select>
                            {idx === 0 && hasAmbiguousDuplicates && (
                              <p className="text-xs text-amber-700 dark:text-amber-400 ml-1">Some instruments share the same model in one map. Add nicknames in VeritaMap{"\u2122"} to tell them apart.</p>
                            )}
                            {linkedInstruments[idx] && (
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground ml-1">
                                <CheckCircle2 size={11} className="text-emerald-600 shrink-0" />
                                <span>Linked to VeritaMap{"\u2122"}</span>
                                {linkedInstruments[idx]!.serial_number && <span className="font-mono">S/N {linkedInstruments[idx]!.serial_number}</span>}
                              </div>
                            )}
                            {!linkedInstruments[idx] && (
                              <Input value={name} onChange={e => updateInstrumentName(idx, e.target.value)} placeholder={`Instrument ${idx + 1}`} className="text-sm" />
                            )}
                          </div>
                          {instrumentNames.length > 1 && <Button variant="ghost" size="icon" onClick={() => removeInstrument(idx)} className="text-muted-foreground hover:text-destructive shrink-0 w-8 h-8"><Trash2 size={13} /></Button>}
                        </div>
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

              {studyType === "sensitivity" && (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">Analytical Sensitivity Setup (CLSI EP17-A2)</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start gap-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                      <Info size={13} className="text-primary shrink-0 mt-0.5" />
                      <span>EP17-A2 establishes Limit of Blank, Limit of Detection, and Limit of Quantitation. Establishment mode is used for modified or in-house tests (42 CFR {"§"}493.1253(b)(2)(iii)). Verification mode confirms a manufacturer's published claim (42 CFR {"§"}493.1253(b)(1)). Establishment requires ~60 blank and ~60 low-level replicates across multiple reagent lots and days for full EP17-A2 compliance.</span>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>Study Mode</Label>
                        <Select value={sensMode} onValueChange={v => setSensMode(v as "establishment" | "verification")}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="establishment">Establishment (full EP17-A2 study)</SelectItem>
                            <SelectItem value="verification">Verification (confirm manufacturer claim)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5"><Label>Analyte Name</Label><Input placeholder="e.g. Troponin I" value={sensAnalyteName} onChange={e => setSensAnalyteName(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label>Units</Label><Input placeholder="e.g. ng/mL" value={sensUnits} onChange={e => setSensUnits(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label>LoQ CV Threshold (%)</Label><Input type="number" step="any" min={1} max={50} value={sensCvThreshold} onChange={e => setSensCvThreshold(parseFloat(e.target.value) || 20)} /></div>
                      <div className="space-y-1.5"><Label>LoQ |Bias| Threshold (%)</Label><Input type="number" step="any" min={1} max={50} value={sensBiasThreshold} onChange={e => setSensBiasThreshold(parseFloat(e.target.value) || 25)} /></div>
                    </div>
                    {sensMode === "verification" && (
                      <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 p-3 space-y-3">
                        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">Manufacturer's Published Claims</p>
                        <div className="grid sm:grid-cols-3 gap-3">
                          <div className="space-y-1.5"><Label className="text-xs">Claimed LoB</Label><Input type="number" step="any" placeholder="e.g. 0.010" value={sensMfgLob} onChange={e => setSensMfgLob(e.target.value)} /></div>
                          <div className="space-y-1.5"><Label className="text-xs">Claimed LoD</Label><Input type="number" step="any" placeholder="e.g. 0.020" value={sensMfgLod} onChange={e => setSensMfgLod(e.target.value)} /></div>
                          <div className="space-y-1.5"><Label className="text-xs">Claimed LoQ</Label><Input type="number" step="any" placeholder="e.g. 0.040" value={sensMfgLoq} onChange={e => setSensMfgLoq(e.target.value)} /></div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {studyType !== "sensitivity" && (
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base">{studyType === "precision" ? "Adopted Precision Acceptance Criterion (CV%)" : "Adopted Acceptance Criterion (TEa)"}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {(() => {
                    // customMode is derived from cliaPreset (the Custom preset lives at the last index of
                    // CLIA_PRESETS). The "previous analyte" ref remembers the last non-custom selection so
                    // unchecking the box returns the user to their prior analyte rather than dropping them
                    // at the default.
                    const customIdx = CLIA_PRESETS.length - 1;
                    const customMode = cliaPreset === customIdx;
                    return (
                      <>
                        <Select
                          value={String(cliaPreset)}
                          onValueChange={v => { const i = parseInt(v); prevAnalytePresetRef.current = i; setCliaPreset(i); }}
                          disabled={customMode}
                        >
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
                            <SelectGroup><SelectLabel className="text-xs text-muted-foreground">Lab-Set Internal Goal (no CLIA TEa)</SelectLabel>
                              {CLIA_PRESETS.slice(75, 81).map((p, i) => <SelectItem key={75+i} value={String(75+i)}>{p.label}</SelectItem>)}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700/50 px-3 py-2.5">
                          <p className="text-sm text-amber-900 dark:text-amber-200 leading-snug">
                            <strong>Don&apos;t see your analyte?</strong> CLIA has no defined TEa for it. Check the box below and enter your lab-defined goal.
                          </p>
                        </div>
                        <div className="flex items-center gap-2 pl-1">
                          <Checkbox
                            id="use-custom-tea"
                            checked={customMode}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                if (cliaPreset !== customIdx) prevAnalytePresetRef.current = cliaPreset;
                                setCliaPreset(customIdx);
                              } else {
                                const restore = prevAnalytePresetRef.current === customIdx ? 0 : prevAnalytePresetRef.current;
                                setCliaPreset(restore);
                              }
                            }}
                          />
                          <Label htmlFor="use-custom-tea" className="text-sm font-medium cursor-pointer">
                            Use custom TEa (enter lab-defined goal)
                          </Label>
                        </div>
                        {customMode && (
                          <div className="flex items-center gap-2">
                            <Input type="number" step="0.005" min="0.01" max="0.5" value={customClia} onChange={e => setCustomClia(parseFloat(e.target.value) || 0.15)} className="max-w-[120px]" />
                            <span className="text-sm text-muted-foreground">= {(customClia * 100).toFixed(1)}% allowable error</span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                  {CLIA_PRESETS[cliaPreset].cfr && <p className="text-xs text-muted-foreground">Reference: {CLIA_PRESETS[cliaPreset].cfr}</p>}
                  <div className="rounded-md bg-primary/5 border border-primary/20 p-3">
                    <p className="text-xs text-primary font-medium">Active TEa: {teaIsPercentage ? `\u00B1${(cliaValue * 100).toFixed(1)}%` : `\u00B1${cliaValue} ${teaUnit}`}{cliaAbsoluteFloor != null ? ` or \u00B1${cliaAbsoluteFloor} ${cliaAbsoluteUnit} (greater)` : ''}</p>
                  </div>
                </CardContent>
              </Card>
              )}
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
                  <CardHeader className="pb-3"><CardTitle className="text-base">Reagent Lot Verification (CLSI EP26-A) Data Entry</CardTitle></CardHeader>
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
                    <CardHeader className="pb-3"><CardTitle className="text-base">QC Lot Verification (CLSI C24-Ed4) Setup</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Analytes</Label>
                        <div className="flex flex-wrap items-center gap-2">
                          {qcAnalytes.map(a => (
                            <Badge key={a} variant="outline" className="text-xs flex items-center gap-1.5 py-1 px-2">
                              {a}
                              <button
                                type="button"
                                onClick={() => setQcAnalytes(qcAnalytes.filter(x => x !== a))}
                                className="text-muted-foreground hover:text-destructive ml-0.5"
                                aria-label={`Remove ${a}`}
                              >
                                <Trash2 size={11} />
                              </button>
                            </Badge>
                          ))}
                          <div className="flex items-center gap-1.5">
                            <Input
                              placeholder="Analyte name (e.g. Glucose, Hemoglobin A1c, PT)"
                              value={qcAnalyteCustom}
                              onChange={e => setQcAnalyteCustom(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter" && qcAnalyteCustom.trim() && !qcAnalytes.includes(qcAnalyteCustom.trim())) {
                                  e.preventDefault();
                                  setQcAnalytes([...qcAnalytes, qcAnalyteCustom.trim()]);
                                  setQcAnalyteCustom("");
                                }
                              }}
                              className="h-7 text-xs w-72"
                            />
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => {
                                if (qcAnalyteCustom.trim() && !qcAnalytes.includes(qcAnalyteCustom.trim())) {
                                  setQcAnalytes([...qcAnalytes, qcAnalyteCustom.trim()]);
                                  setQcAnalyteCustom("");
                                }
                              }}
                            >
                              Add
                            </Button>
                          </div>
                        </div>
                        {qcAnalytes.length === 0 && (
                          <p className="text-xs text-muted-foreground">Add at least one analyte to begin. This study works for any quantitative test (chemistry, hematology, immunoassay, coagulation, urinalysis).</p>
                        )}
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
                          {qcAnalyzers.length < 4 && <Button variant="outline" size="sm" onClick={() => setQcAnalyzers([...qcAnalyzers, `Instrument ${qcAnalyzers.length + 1}`])}><PlusCircle size={12} className="mr-1" />Add Analyzer</Button>}
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
                      {/* Opt-in sections per the lot-change family redesign:
                          crossover bias check (CLSI C24-Ed4 accelerated path)
                          and vendor SDI comparison (Westgard convention,
                          informational only per CLIA §493.1256). */}
                      <div className="space-y-2 pt-3 border-t border-border">
                        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Optional sections</div>
                        <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
                          <Checkbox
                            checked={qcShowPriorLot}
                            onCheckedChange={v => setQcShowPriorLot(!!v)}
                            data-testid="checkbox-qc-prior-lot"
                            className="mt-0.5"
                          />
                          <div className="space-y-0.5">
                            <div>Include crossover bias check (parallel prior-lot replicates)</div>
                            <div className="text-xs text-muted-foreground">Enter the retiring lot's replicate runs alongside the new lot to detect any analytical drift during the changeover. Bias verdict uses pooled SD: accept &lt; 1 SD, caution 1 to 2 SD, fail at or above 2 SD.</div>
                          </div>
                        </label>
                        <label className="flex items-start gap-2 text-sm cursor-pointer select-none">
                          <Checkbox
                            checked={qcShowVendor}
                            onCheckedChange={v => setQcShowVendor(!!v)}
                            data-testid="checkbox-qc-vendor"
                            className="mt-0.5"
                          />
                          <div className="space-y-0.5">
                            <div>Include vendor SDI comparison (assayed QC only)</div>
                            <div className="text-xs text-muted-foreground">Enter the package-insert mean and SD per level for an assayed QC product. Computes Standard Deviation Index per Westgard. Informational only; the lab uses its own calculated SD on the chart per CLIA §493.1256.</div>
                          </div>
                        </label>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Data entry grids per analyte/level/analyzer */}
                  {qcAnalytes.map(analyte => (
                    <Card key={analyte}>
                      <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3">
                        <CardTitle className="text-base">{analyte}: QC Run Data</CardTitle>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => { setQcBulkImportAnalyte(analyte); setQcBulkImportOpen(true); }}
                          data-testid={`button-veritaqc-bulk-import-${analyte}`}
                        >
                          <Upload size={12} className="mr-1" /> Import from VeritaQC{"™"}...
                        </Button>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {qcLevels.map(level => {
                          const vendorKey = `${analyte}|${level}`;
                          const vendor = qcVendorValues[vendorKey];
                          return (
                          <div key={level} className="space-y-2">
                            <div className="text-sm font-medium">{level}</div>
                            {qcShowVendor && (
                              <div className="flex items-center gap-3 p-2 rounded bg-muted/30 border border-border/50">
                                <div className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Vendor (package insert)</div>
                                <Label className="text-xs">Mean:</Label>
                                <Input
                                  type="number" step="any" placeholder="-"
                                  value={vendor?.mean ?? ""}
                                  onChange={e => setQcVendorValues({
                                    ...qcVendorValues,
                                    [vendorKey]: {
                                      mean: e.target.value === "" ? null : parseFloat(e.target.value),
                                      sd: vendor?.sd ?? null,
                                    },
                                  })}
                                  className="h-7 text-xs w-24"
                                />
                                <Label className="text-xs">SD:</Label>
                                <Input
                                  type="number" step="any" placeholder="-"
                                  value={vendor?.sd ?? ""}
                                  onChange={e => setQcVendorValues({
                                    ...qcVendorValues,
                                    [vendorKey]: {
                                      mean: vendor?.mean ?? null,
                                      sd: e.target.value === "" ? null : parseFloat(e.target.value),
                                    },
                                  })}
                                  className="h-7 text-xs w-24"
                                />
                                <span className="text-xs text-muted-foreground italic">applied across all analyzers for this level</span>
                              </div>
                            )}
                            {qcAnalyzers.map(analyzer => {
                              const key = `${analyte}|${level}|${analyzer}`;
                              const runs = qcRunData[key] || Array(qcNumRuns).fill(NaN);
                              const priorRuns = qcPriorLotRuns[key] || Array(qcNumRuns).fill(NaN);
                              const legacyOld = qcOldLotData[key];
                              const hasLegacy = legacyOld && (legacyOld.mean != null || legacyOld.sd != null);
                              return (
                                <div key={analyzer} className="space-y-1">
                                  <div className="text-xs text-muted-foreground">{analyzer}</div>
                                  <div className="space-y-0.5">
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide">New lot</div>
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
                                  </div>
                                  {qcShowPriorLot && (
                                    <div className="space-y-0.5 pt-1">
                                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Prior lot (crossover)</div>
                                      <div className="grid grid-cols-5 sm:grid-cols-10 gap-1">
                                        {Array.from({ length: qcNumRuns }).map((_, ri) => (
                                          <Input key={ri} type="number" step="any" placeholder="-"
                                            value={!isNaN(priorRuns[ri]) ? priorRuns[ri] : ""}
                                            onChange={e => {
                                              const updated = [...(qcPriorLotRuns[key] || Array(qcNumRuns).fill(NaN))];
                                              updated[ri] = e.target.value === "" ? NaN : parseFloat(e.target.value);
                                              setQcPriorLotRuns({ ...qcPriorLotRuns, [key]: updated });
                                            }}
                                            className="h-7 text-xs text-center bg-muted/20" />
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {hasLegacy && !qcShowPriorLot && (
                                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground italic">
                                      <span>Legacy prior-lot summary:</span>
                                      <span>mean {legacyOld!.mean ?? "-"}</span>
                                      <span>SD {legacyOld!.sd ?? "-"}</span>
                                      <span className="text-[10px]">(enable crossover bias check above to enter parallel replicates)</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          );
                        })}
                        {qcNumRuns < 10 && <p className="text-xs text-amber-500">Minimum 10 runs recommended per level</p>}
                      </CardContent>
                    </Card>
                  ))}
                  <Alert>
                    <Shield size={14} />
                    <AlertDescription className="text-xs">Per CLIA 42 CFR §493.1256, the laboratory must determine its own mean and SD for the QC materials it uses. The lab's calculated mean and SD from this study become the operating values on the Levey-Jennings chart. Vendor (package-insert) SD is reference only.</AlertDescription>
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
              ) : studyType === "carryover" ? (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">Carryover Verification Data Entry (CLSI EP10-A3)</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start gap-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                      <Info size={13} className="text-primary shrink-0 mt-0.5" />
                      <span>CLSI EP10-A3: run a defined alternating sequence of Low and High material specimens. The pattern is pre-loaded with the standard 21-specimen EP10 sequence; you can override the Material column on any row. The study passes when absolute carryover (|mean L-after-H minus mean L-after-L|) does not exceed the Error Limit (3 x SD of L-after-L specimens).</span>
                    </div>
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="space-y-1.5"><Label>Analyte Name</Label><Input placeholder="e.g. Glucose" value={testName} onChange={e => setTestName(e.target.value)} /></div>
                      <div className="space-y-1.5"><Label>Units</Label><Input placeholder="e.g. mg/dL" value={coUnits} onChange={e => setCoUnits(e.target.value)} /></div>
                      <div className="space-y-1.5 flex flex-col"><Label>Specimens Pre-loaded</Label><span className="text-xs text-muted-foreground pt-2">{CARRYOVER_DEFAULT_PATTERN.length} rows (EP10-A3 standard pattern)</span></div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Specimen Sequence</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="border-b border-border">
                            <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium w-12">#</th>
                            <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium w-24">Material</th>
                            <th className="text-left py-2 pr-4 text-xs text-muted-foreground font-medium">Measured Value</th>
                            <th className="text-left py-2 text-xs text-muted-foreground font-medium">Classification</th>
                          </tr></thead>
                          <tbody>
                            {coData.map((dp, idx) => {
                              const prev = idx > 0 ? coData[idx - 1] : null;
                              let cls = "";
                              if (dp.sample_type === "L" && prev) cls = prev.sample_type === "L" ? "L-after-L" : "L-after-H";
                              else if (dp.sample_type === "H" && prev) cls = prev.sample_type === "H" ? "H-after-H" : "H-after-L";
                              return (
                                <tr key={idx} className="border-b border-border/50">
                                  <td className="py-1.5 pr-4 font-mono text-xs">{dp.sequence}</td>
                                  <td className="py-1.5 pr-4">
                                    <Select
                                      value={dp.sample_type}
                                      onValueChange={v => { const d = [...coData]; d[idx] = { ...d[idx], sample_type: v as "L" | "H" }; setCoData(d); }}
                                    >
                                      <SelectTrigger className="h-8 w-20 text-sm"><SelectValue /></SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="L">Low</SelectItem>
                                        <SelectItem value="H">High</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </td>
                                  <td className="py-1.5 pr-4">
                                    <Input
                                      type="number"
                                      step="any"
                                      placeholder="-"
                                      value={dp.value ?? ""}
                                      onChange={e => { const d = [...coData]; d[idx] = { ...d[idx], value: e.target.value === "" ? null : parseFloat(e.target.value) }; setCoData(d); }}
                                      className="h-8 text-sm w-32"
                                    />
                                  </td>
                                  <td className="py-1.5 text-xs text-muted-foreground">{cls}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {(() => {
                        const valid = coData.filter(d => d.value !== null && !isNaN(d.value as number));
                        const ll: number[] = [], lh: number[] = [];
                        for (let i = 1; i < valid.length; i++) {
                          if (valid[i].sample_type !== "L") continue;
                          const prev = valid[i - 1];
                          if (prev.sample_type === "L") ll.push(valid[i].value as number);
                          else if (prev.sample_type === "H") lh.push(valid[i].value as number);
                        }
                        if (ll.length < 2 || lh.length < 1) {
                          return <div className="text-xs text-muted-foreground italic mt-2">Need at least 2 L-after-L and 1 L-after-H specimen values to compute carryover. Currently: LL={ll.length}, LH={lh.length}.</div>;
                        }
                        const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
                        const sd = (a: number[]) => {
                          if (a.length < 2) return 0;
                          const m = mean(a);
                          return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
                        };
                        const meanLL = mean(ll), meanLH = mean(lh), sdLL = sd(ll);
                        const co = Math.abs(meanLH - meanLL);
                        const errorLimit = 3 * sdLL;
                        const pass = co <= errorLimit;
                        return (
                          <div className={`text-xs mt-2 font-medium ${pass ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                            Carryover (absolute) = {co.toFixed(3)} {coUnits} | Error Limit (3 x SD-LL) = {errorLimit.toFixed(3)} {coUnits} | {pass ? "PASS" : "FAIL"}
                          </div>
                        );
                      })()}
                    </div>
                  </CardContent>
                </Card>
              ) : studyType === "accuracy_bias" ? (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base flex items-center justify-between">
                    <span>Accuracy / Bias Data Entry (CLSI EP15-A3)</span>
                    {activeLabId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setQcImportMode("accuracy_bias");
                          setQcImportOpen(true);
                        }}
                        data-testid="button-veritaqc-import-ab"
                      >
                        Import from VeritaQC{"™…"}
                      </Button>
                    ) : null}
                  </CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start gap-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                      <Info size={13} className="text-primary shrink-0 mt-0.5" />
                      <span>CLSI EP15-A3 §6: measure material with a known assigned value (commercial control, PT specimen with consensus mean, or reference material) at 2-3 levels, 5 replicates per level minimum. The study passes when the percent absolute bias (|mean - assigned| / assigned) does not exceed the CLIA total allowable error at every level.</span>
                    </div>
                    <div className="grid sm:grid-cols-4 gap-4">
                      <div className="space-y-1.5"><Label>Analyte Name</Label><Input placeholder="e.g. Glucose" value={abAnalyte} onChange={e => setAbAnalyte(e.target.value)} data-testid="input-ab-analyte" /></div>
                      <div className="space-y-1.5"><Label>Units</Label><Input placeholder="e.g. mg/dL" value={abUnits} onChange={e => setAbUnits(e.target.value)} data-testid="input-ab-units" /></div>
                      <div className="space-y-1.5"><Label>Levels</Label>
                        <Select value={String(abLevels.length)} onValueChange={v => {
                          const n = parseInt(v);
                          setAbLevels(prev => {
                            if (n === prev.length) return prev;
                            if (n > prev.length) {
                              const additions = Array.from({ length: n - prev.length }, (_, i) => ({ name: `Level ${prev.length + i + 1}`, assignedValue: null as number | null }));
                              return [...prev, ...additions];
                            }
                            return prev.slice(0, n);
                          });
                        }}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2">2</SelectItem>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="4">4</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5"><Label>Replicates / Level</Label>
                        <Select value={String(abReplicatesPerLevel)} onValueChange={v => setAbReplicatesPerLevel(parseInt(v))}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="5">5</SelectItem>
                            <SelectItem value="10">10</SelectItem>
                            <SelectItem value="20">20</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {abLevels.map((lv, levelIdx) => {
                        const reps = abRunData[lv.name] || [];
                        const filled = reps.filter(v => v !== undefined && v !== null && !isNaN(v));
                        return (
                          <div key={levelIdx} className="rounded-md border border-border p-3 space-y-2">
                            <div className="grid sm:grid-cols-3 gap-3 items-end">
                              <div className="space-y-1"><Label className="text-xs">Level Name</Label>
                                <Input
                                  value={lv.name}
                                  onChange={e => {
                                    const newName = e.target.value;
                                    const oldName = lv.name;
                                    setAbLevels(prev => prev.map((p, i) => i === levelIdx ? { ...p, name: newName } : p));
                                    if (oldName !== newName) {
                                      setAbRunData(prev => {
                                        if (!(oldName in prev)) return prev;
                                        const { [oldName]: arr, ...rest } = prev;
                                        return { ...rest, [newName]: arr };
                                      });
                                    }
                                  }}
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="space-y-1"><Label className="text-xs">Assigned Value ({abUnits || "units"})</Label>
                                <Input
                                  type="number"
                                  step="any"
                                  value={lv.assignedValue ?? ""}
                                  onChange={e => {
                                    const num = e.target.value === "" ? null : parseFloat(e.target.value);
                                    setAbLevels(prev => prev.map((p, i) => i === levelIdx ? { ...p, assignedValue: num } : p));
                                  }}
                                  placeholder="e.g. 100"
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="text-xs text-muted-foreground pb-2">{filled.length} / {abReplicatesPerLevel} replicates entered</div>
                            </div>
                            <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
                              {Array.from({ length: abReplicatesPerLevel }).map((_, repIdx) => {
                                const val = reps[repIdx];
                                return (
                                  <Input
                                    key={repIdx}
                                    type="number"
                                    step="any"
                                    placeholder={`#${repIdx + 1}`}
                                    value={val === undefined || val === null || isNaN(val) ? "" : val}
                                    onChange={e => {
                                      const raw = e.target.value;
                                      const num = raw === "" ? NaN : parseFloat(raw);
                                      setAbRunData(prev => {
                                        const existing = prev[lv.name] ? [...prev[lv.name]] : [];
                                        while (existing.length <= repIdx) existing.push(NaN);
                                        existing[repIdx] = num;
                                        return { ...prev, [lv.name]: existing };
                                      });
                                    }}
                                    className="h-9 text-sm font-mono"
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ) : studyType === "linearity" ? (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base flex items-center justify-between">
                    <span>Linearity Data Entry (CLSI EP06)</span>
                    {activeLabId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setQcImportMode("linearity");
                          setQcImportOpen(true);
                        }}
                        data-testid="button-veritaqc-import-lin"
                      >
                        Import from VeritaQC{"™…"}
                      </Button>
                    ) : null}
                  </CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start gap-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                      <Info size={13} className="text-primary shrink-0 mt-0.5" />
                      <span>CLSI EP06: run 3-5 levels across the reportable range with at least 2-3 replicates per level. The study passes when |slope - 1| × 100 does not exceed the CLIA total allowable error AND r² is at least 0.95 over the per-level means.</span>
                    </div>
                    <div className="grid sm:grid-cols-4 gap-4">
                      <div className="space-y-1.5"><Label>Analyte Name</Label><Input placeholder="e.g. Glucose" value={linAnalyte} onChange={e => setLinAnalyte(e.target.value)} data-testid="input-lin-analyte" /></div>
                      <div className="space-y-1.5"><Label>Units</Label><Input placeholder="e.g. mg/dL" value={linUnits} onChange={e => setLinUnits(e.target.value)} data-testid="input-lin-units" /></div>
                      <div className="space-y-1.5"><Label>Levels</Label>
                        <Select value={String(linLevels.length)} onValueChange={v => {
                          const n = parseInt(v);
                          setLinLevels(prev => {
                            if (n === prev.length) return prev;
                            if (n > prev.length) {
                              const additions = Array.from({ length: n - prev.length }, (_, i) => ({ name: `Level ${prev.length + i + 1}`, assignedValue: null as number | null }));
                              return [...prev, ...additions];
                            }
                            return prev.slice(0, n);
                          });
                        }}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: MAX_LEVELS - 3 + 1 }, (_, i) => i + 3).map(n => (
                              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5"><Label>Replicates / Level</Label>
                        <Select value={String(linReplicatesPerLevel)} onValueChange={v => setLinReplicatesPerLevel(parseInt(v))}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2">2</SelectItem>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="5">5</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {/* Optional manufacturer claimed AMR. When both bounds are
                        present, the Linearity PDF gains a Coverage Summary block
                        surfacing the unverified gap (CLIA does not require fail
                        on coverage; director adjudicates). Leave blank to skip. */}
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Manufacturer Claimed AMR Low ({linUnits || "units"}) <span className="text-xs text-muted-foreground">(optional)</span></Label>
                        <Input
                          type="number" step="any" placeholder="e.g. 5"
                          value={linClaimedLow}
                          onChange={e => setLinClaimedLow(e.target.value === "" ? "" : parseFloat(e.target.value))}
                          data-testid="input-lin-claimed-low"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Manufacturer Claimed AMR High ({linUnits || "units"}) <span className="text-xs text-muted-foreground">(optional)</span></Label>
                        <Input
                          type="number" step="any" placeholder="e.g. 500"
                          value={linClaimedHigh}
                          onChange={e => setLinClaimedHigh(e.target.value === "" ? "" : parseFloat(e.target.value))}
                          data-testid="input-lin-claimed-high"
                        />
                      </div>
                    </div>
                    {(linClaimedLow !== "" || linClaimedHigh !== "") && (
                      <p className="text-xs text-muted-foreground italic">
                        When both bounds are entered, the report adds a Coverage Summary that compares the verified range against the manufacturer's claimed AMR. CLIA does not require a coverage threshold; the medical director adjudicates whether the verified range is acceptable.
                      </p>
                    )}
                    <div className="space-y-3">
                      {linLevels.map((lv, levelIdx) => {
                        const reps = linRunData[lv.name] || [];
                        const filled = reps.filter(v => v !== undefined && v !== null && !isNaN(v));
                        return (
                          <div key={levelIdx} className="rounded-md border border-border p-3 space-y-2">
                            <div className="grid sm:grid-cols-3 gap-3 items-end">
                              <div className="space-y-1"><Label className="text-xs">Level Name</Label>
                                <Input
                                  value={lv.name}
                                  onChange={e => {
                                    const newName = e.target.value;
                                    const oldName = lv.name;
                                    setLinLevels(prev => prev.map((p, i) => i === levelIdx ? { ...p, name: newName } : p));
                                    if (oldName !== newName) {
                                      setLinRunData(prev => {
                                        if (!(oldName in prev)) return prev;
                                        const { [oldName]: arr, ...rest } = prev;
                                        return { ...rest, [newName]: arr };
                                      });
                                    }
                                  }}
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="space-y-1"><Label className="text-xs">Assigned Value ({linUnits || "units"})</Label>
                                <Input
                                  type="number"
                                  step="any"
                                  value={lv.assignedValue ?? ""}
                                  onChange={e => {
                                    const num = e.target.value === "" ? null : parseFloat(e.target.value);
                                    setLinLevels(prev => prev.map((p, i) => i === levelIdx ? { ...p, assignedValue: num } : p));
                                  }}
                                  placeholder="e.g. 50"
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="text-xs text-muted-foreground pb-2">{filled.length} / {linReplicatesPerLevel} replicates entered</div>
                            </div>
                            <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
                              {Array.from({ length: linReplicatesPerLevel }).map((_, repIdx) => {
                                const val = reps[repIdx];
                                return (
                                  <Input
                                    key={repIdx}
                                    type="number"
                                    step="any"
                                    placeholder={`#${repIdx + 1}`}
                                    value={val === undefined || val === null || isNaN(val) ? "" : val}
                                    onChange={e => {
                                      const raw = e.target.value;
                                      const num = raw === "" ? NaN : parseFloat(raw);
                                      setLinRunData(prev => {
                                        const existing = prev[lv.name] ? [...prev[lv.name]] : [];
                                        while (existing.length <= repIdx) existing.push(NaN);
                                        existing[repIdx] = num;
                                        return { ...prev, [lv.name]: existing };
                                      });
                                    }}
                                    className="h-9 text-sm font-mono"
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ) : studyType === "reportable_range" ? (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base flex items-center justify-between">
                    <span>Reportable Range / AMR Verification Data Entry (CLIA §493.1255)</span>
                    {activeLabId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setQcImportMode("reportable_range");
                          setQcImportOpen(true);
                        }}
                        data-testid="button-veritaqc-import-rr"
                      >
                        Import from VeritaQC{"™…"}
                      </Button>
                    ) : null}
                  </CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-start gap-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                      <Info size={13} className="text-primary shrink-0 mt-0.5" />
                      <span>CLIA §493.1255 AMR verification: declare your claimed reportable range, then measure material spanning that range at 2-5 levels with at least 2 replicates per level. The study passes when every level's mean bias against assigned does not exceed the CLIA total allowable error (using the dual-criterion percent-or-absolute allowance).</span>
                    </div>
                    <div className="grid sm:grid-cols-4 gap-4">
                      <div className="space-y-1.5"><Label>Analyte Name</Label><Input placeholder="e.g. Glucose" value={rrAnalyte} onChange={e => setRrAnalyte(e.target.value)} data-testid="input-rr-analyte" /></div>
                      <div className="space-y-1.5"><Label>Units</Label><Input placeholder="e.g. mg/dL" value={rrUnits} onChange={e => setRrUnits(e.target.value)} data-testid="input-rr-units" /></div>
                      <div className="space-y-1.5"><Label>Claimed Range Low ({rrUnits || "units"})</Label>
                        <Input type="number" step="any" placeholder="e.g. 20" value={rrClaimedLow} onChange={e => setRrClaimedLow(e.target.value === "" ? "" : parseFloat(e.target.value))} data-testid="input-rr-claimed-low" />
                      </div>
                      <div className="space-y-1.5"><Label>Claimed Range High ({rrUnits || "units"})</Label>
                        <Input type="number" step="any" placeholder="e.g. 500" value={rrClaimedHigh} onChange={e => setRrClaimedHigh(e.target.value === "" ? "" : parseFloat(e.target.value))} data-testid="input-rr-claimed-high" />
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5"><Label>Levels</Label>
                        <Select value={String(rrLevels.length)} onValueChange={v => {
                          const n = parseInt(v);
                          setRrLevels(prev => {
                            if (n === prev.length) return prev;
                            if (n > prev.length) {
                              const additions = Array.from({ length: n - prev.length }, (_, i) => ({ name: `Level ${prev.length + i + 1}`, assignedValue: null as number | null }));
                              return [...prev, ...additions];
                            }
                            return prev.slice(0, n);
                          });
                        }}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: MAX_LEVELS - 2 + 1 }, (_, i) => i + 2).map(n => (
                              <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5"><Label>Replicates / Level</Label>
                        <Select value={String(rrReplicatesPerLevel)} onValueChange={v => setRrReplicatesPerLevel(parseInt(v))}>
                          <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2">2</SelectItem>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="5">5</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {rrLevels.map((lv, levelIdx) => {
                        const reps = rrRunData[lv.name] || [];
                        const filled = reps.filter(v => v !== undefined && v !== null && !isNaN(v));
                        return (
                          <div key={levelIdx} className="rounded-md border border-border p-3 space-y-2">
                            <div className="grid sm:grid-cols-3 gap-3 items-end">
                              <div className="space-y-1"><Label className="text-xs">Level Name</Label>
                                <Input
                                  value={lv.name}
                                  onChange={e => {
                                    const newName = e.target.value;
                                    const oldName = lv.name;
                                    setRrLevels(prev => prev.map((p, i) => i === levelIdx ? { ...p, name: newName } : p));
                                    if (oldName !== newName) {
                                      setRrRunData(prev => {
                                        if (!(oldName in prev)) return prev;
                                        const { [oldName]: arr, ...rest } = prev;
                                        return { ...rest, [newName]: arr };
                                      });
                                    }
                                  }}
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="space-y-1"><Label className="text-xs">Assigned Value ({rrUnits || "units"})</Label>
                                <Input
                                  type="number"
                                  step="any"
                                  value={lv.assignedValue ?? ""}
                                  onChange={e => {
                                    const num = e.target.value === "" ? null : parseFloat(e.target.value);
                                    setRrLevels(prev => prev.map((p, i) => i === levelIdx ? { ...p, assignedValue: num } : p));
                                  }}
                                  placeholder="e.g. 20"
                                  className="h-9 text-sm"
                                />
                              </div>
                              <div className="text-xs text-muted-foreground pb-2">{filled.length} / {rrReplicatesPerLevel} replicates entered</div>
                            </div>
                            <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
                              {Array.from({ length: rrReplicatesPerLevel }).map((_, repIdx) => {
                                const val = reps[repIdx];
                                return (
                                  <Input
                                    key={repIdx}
                                    type="number"
                                    step="any"
                                    placeholder={`#${repIdx + 1}`}
                                    value={val === undefined || val === null || isNaN(val) ? "" : val}
                                    onChange={e => {
                                      const raw = e.target.value;
                                      const num = raw === "" ? NaN : parseFloat(raw);
                                      setRrRunData(prev => {
                                        const existing = prev[lv.name] ? [...prev[lv.name]] : [];
                                        while (existing.length <= repIdx) existing.push(NaN);
                                        existing[repIdx] = num;
                                        return { ...prev, [lv.name]: existing };
                                      });
                                    }}
                                    className="h-9 text-sm font-mono"
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              ) : studyType === "sensitivity" ? (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base">Analytical Sensitivity Data Entry</CardTitle></CardHeader>
                  <CardContent className="space-y-5">
                    <div className="flex items-start gap-2 p-2.5 rounded-md bg-primary/5 border border-primary/15 text-xs text-muted-foreground leading-relaxed">
                      <Info size={13} className="text-primary shrink-0 mt-0.5" />
                      <span>Paste replicate values, one per line. Optional second value per line (comma or tab separated) is the reagent lot label, which enables a per-lot LoB breakdown in the report.</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Blank Samples</Label>
                        <span className="text-xs text-muted-foreground">{sensBlanksText.split(/\r?\n/).map(l => parseFloat(l.split(/[,\t]/)[0])).filter(v => !isNaN(v)).length} valid replicates</span>
                      </div>
                      <textarea
                        value={sensBlanksText}
                        onChange={e => setSensBlanksText(e.target.value)}
                        placeholder={"0.005\n0.008,LotA\n0.006,LotA\n0.012,LotB\n0.004,LotB\n..."}
                        className="w-full min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">Low-Level Samples (for LoD)</Label>
                        <span className="text-xs text-muted-foreground">{sensLowLevelText.split(/\r?\n/).map(l => parseFloat(l.split(/[,\t]/)[0])).filter(v => !isNaN(v)).length} valid replicates</span>
                      </div>
                      <textarea
                        value={sensLowLevelText}
                        onChange={e => setSensLowLevelText(e.target.value)}
                        placeholder={"0.020\n0.025,LotA\n0.022,LotB\n..."}
                        className="w-full min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-sm font-medium">LoQ Concentration Levels (optional)</Label>
                        <Button variant="outline" size="sm" onClick={() => setSensLoqLevels([...sensLoqLevels, { expectedConcentration: "", repsText: "" }])}>
                          <PlusCircle size={12} className="mr-1" />Add Level
                        </Button>
                      </div>
                      {sensLoqLevels.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">Add one or more low concentration levels to calculate the Limit of Quantitation. Each level needs an expected concentration and several replicate measurements.</p>
                      )}
                      {sensLoqLevels.map((lvl, idx) => (
                        <div key={idx} className="rounded-md border border-border p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <Label className="text-xs shrink-0">Expected Concentration</Label>
                            <Input
                              type="number"
                              step="any"
                              value={lvl.expectedConcentration}
                              onChange={e => {
                                const copy = [...sensLoqLevels];
                                copy[idx] = { ...copy[idx], expectedConcentration: e.target.value };
                                setSensLoqLevels(copy);
                              }}
                              className="h-8 max-w-[140px] text-sm"
                            />
                            <span className="text-xs text-muted-foreground">{sensUnits}</span>
                            <Button variant="ghost" size="icon" className="h-7 w-7 ml-auto" onClick={() => setSensLoqLevels(sensLoqLevels.filter((_, i) => i !== idx))}>
                              <Trash2 size={14} />
                            </Button>
                          </div>
                          <textarea
                            value={lvl.repsText}
                            onChange={e => {
                              const copy = [...sensLoqLevels];
                              copy[idx] = { ...copy[idx], repsText: e.target.value };
                              setSensLoqLevels(copy);
                            }}
                            placeholder={"Replicate values, one per line"}
                            className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                          />
                          <span className="text-xs text-muted-foreground">{lvl.repsText.split(/\r?\n/).map(l => parseFloat(l.split(/[,\t]/)[0])).filter(v => !isNaN(v)).length} valid replicates</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ) : studyType === "precision" ? (
                <Card>
                  <CardHeader className="pb-3"><CardTitle className="text-base flex items-center justify-between">
                    <span>Precision Data Entry</span>
                    <div className="flex items-center gap-2">
                      {activeLabId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setQcImportMode("precision");
                            setQcImportOpen(true);
                          }}
                          data-testid="button-veritaqc-import"
                        >
                          Import from VeritaQC{"™…"}
                        </Button>
                      ) : null}
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
                      <>
                        <div className="rounded-md bg-muted/50 border p-3 space-y-2">
                          <p className="text-xs font-medium">Simple: aggregate precision (CV) per level</p>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Verifies the manufacturer's precision claim for an FDA-cleared, unmodified assay by computing the coefficient of variation (CV) at each level. For each level, the calculation is: mean of replicates, standard deviation (SD, n-1 denominator), and CV = (SD divided by mean) times 100. CLSI EP15-A3 recommends a minimum of 5 days at 5 replicates per day for full verification; the simple path treats all replicates as a single pool and is appropriate when the data is collected within one run or one day.
                          </p>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            Acceptance criterion: the observed CV at each level must be at or below the adopted precision acceptance criterion (typically half of the §493 PT total allowable error per the ADLM recommendation, or the manufacturer's published CV claim, whichever applies). When an absolute floor is set, the dual-criterion rule under 42 CFR §493.1253(b)(1)(ii) applies: pass if the observed difference is within the greater of the percent or the absolute allowance.
                          </p>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            What this path does not do: it does not decompose variance into within-run and between-day components. For that, use Advanced (EP15) mode, which is the right path for laboratory-developed tests and modified procedures.
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <Label className="text-xs whitespace-nowrap">Replicates per level:</Label>
                          <Select value={String(precisionReps)} onValueChange={v => setPrecisionReps(parseInt(v))}>
                            <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {[5,10,15,20,25,30,35,40].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>

                        {/* Phase 3 simple-precision parity (2026-05-20):
                            Optional EE-style inputs. Leave any field blank
                            to skip the related output (vendor verdict,
                            bias, target plot centering). All four are
                            persisted on the study record and surface in
                            the PDF + on-screen result view. */}
                        <details className="rounded-md border bg-muted/30 p-3 text-xs">
                          <summary className="cursor-pointer font-medium select-none">
                            Optional precision parameters (vendor claim, target)
                          </summary>
                          <p className="text-muted-foreground mt-2 leading-relaxed">
                            Add a vendor SD claim from the package insert to surface a Pass / Fail / Uncertain verdict against the 95% confidence interval of your observed SD. Add a target mean and target CV from the QC control insert to surface bias / % bias and center the Precision Plot on the target. All fields optional.
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                            <div>
                              <Label className="text-[11px]">Vendor Within-Run SD</Label>
                              <Input type="number" step="any" placeholder="e.g. 1.57"
                                value={precisionVendorSd}
                                onChange={e => setPrecisionVendorSd(e.target.value)}
                                className="h-7 text-xs mt-1" />
                            </div>
                            <div>
                              <Label className="text-[11px]">Concentration at Vendor SD (optional)</Label>
                              <Input type="number" step="any" placeholder="e.g. 25"
                                value={precisionVendorSdConc}
                                onChange={e => setPrecisionVendorSdConc(e.target.value)}
                                className="h-7 text-xs mt-1" />
                            </div>
                            <div>
                              <Label className="text-[11px]">Target Mean</Label>
                              <Input type="number" step="any" placeholder="e.g. 23.6"
                                value={precisionTargetMean}
                                onChange={e => setPrecisionTargetMean(e.target.value)}
                                className="h-7 text-xs mt-1" />
                            </div>
                            <div>
                              <Label className="text-[11px]">Target CV (%)</Label>
                              <Input type="number" step="any" placeholder="e.g. 7.5"
                                value={precisionTargetCv}
                                onChange={e => setPrecisionTargetCv(e.target.value)}
                                className="h-7 text-xs mt-1" />
                            </div>
                          </div>

                          {/* EE Day 2 QC traceability: four optional fields.
                              These appear in the PDF Supporting Data panel when
                              populated. Universal CLIA lot-tracking fields. */}
                          <div className="mt-4 pt-3 border-t border-border/40">
                            <div className="text-[11px] font-semibold text-muted-foreground mb-2">
                              QC lot information (optional)
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <Label className="text-[11px]">Result Units</Label>
                                <Input placeholder="e.g. U/L, mg/dL"
                                  value={precisionResultUnits}
                                  onChange={e => setPrecisionResultUnits(e.target.value)}
                                  className="h-7 text-xs mt-1" />
                              </div>
                              <div>
                                <Label className="text-[11px]">Control Lot</Label>
                                <Input placeholder="e.g. Technopath 103506230 exp 31 Dec 2025"
                                  value={precisionControlLot}
                                  onChange={e => setPrecisionControlLot(e.target.value)}
                                  className="h-7 text-xs mt-1" />
                              </div>
                              <div>
                                <Label className="text-[11px]">Reagent Lot</Label>
                                <Input placeholder="e.g. Abbott 64489UD00 exp 06 Apr 2025"
                                  value={precisionReagentLot}
                                  onChange={e => setPrecisionReagentLot(e.target.value)}
                                  className="h-7 text-xs mt-1" />
                              </div>
                              <div className="sm:col-span-2">
                                <Label className="text-[11px]">Comment</Label>
                                <Textarea placeholder="e.g. Multichem S Precision Over Time"
                                  value={precisionComment}
                                  onChange={e => setPrecisionComment(e.target.value)}
                                  className="text-xs mt-1 min-h-[42px]" />
                              </div>
                            </div>
                          </div>
                        </details>
                      </>
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
                              <td className="py-1.5 pr-4">
                                <Input
                                  value={dp.customLabel ?? `S${dp.level}`}
                                  onChange={e => { const d = [...dataPoints]; d[idx] = { ...d[idx], customLabel: e.target.value }; setDataPoints(d); }}
                                  className="h-8 text-xs font-mono w-24"
                                  data-testid={`input-sample-label-${idx}`}
                                />
                              </td>
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
                              <td className="py-1.5 pr-4">
                                <Input
                                  value={dp.customLabel ?? `S${dp.level}`}
                                  onChange={e => { const d = [...dataPoints]; d[idx] = { ...d[idx], customLabel: e.target.value }; setDataPoints(d); }}
                                  className="h-8 text-xs font-mono w-24"
                                  data-testid={`input-sample-label-mc-${idx}`}
                                />
                              </td>
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
                              <td className="py-1.5 pr-4">
                                <Input
                                  value={dp.customLabel ?? `L${dp.level}`}
                                  onChange={e => { const d = [...dataPoints]; d[idx] = { ...d[idx], customLabel: e.target.value }; setDataPoints(d); }}
                                  className="h-8 text-xs font-mono w-24"
                                  data-testid={`input-level-label-${idx}`}
                                />
                              </td>
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
                  // Creatinine preset (index 19): ±10% or ±0.2 mg/dL, dual-criterion (greater).
                  // Was previously setCliaPreset(0) which loaded ALT/SGPT (±15%) by mistake.
                  const names = ["ATELLICA 2 Run 1", "ATELLICA 2 Run 2"]; setInstrumentNames(names); setCliaPreset(19);
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

          {/* Longstreth UX 1: explicit "what's blocking" panel so the
              tech does not have to guess why the Generate button is
              disabled. Renders only when the button is disabled for a
              non-pending reason. */}
          {(() => {
            const minLevels = studyType === "ref_interval" ? 20
              : studyType === "sensitivity" ? 5
              : studyType === "carryover" ? 12
              : studyType === "qc_range" ? 2
              : studyType === "accuracy_bias" ? 2
              : studyType === "linearity" ? 3
              : studyType === "reportable_range" ? 2
              : 3;
            const unit = studyType === "lot_to_lot" || studyType === "pt_coag" || studyType === "ref_interval" ? "specimen"
              : studyType === "sensitivity" ? "blank replicate"
              : studyType === "method_comparison" ? "sample"
              : "level";
            const studyTypeLabel = studyType === "cal_ver" ? "Calibration Verification"
              : studyType === "method_comparison" ? "Method Comparison"
              : studyType === "precision" ? "Precision Verification"
              : studyType === "lot_to_lot" ? "Reagent Lot Verification"
              : studyType === "pt_coag" ? "PT/INR Geometric Mean Calculator"
              : studyType === "qc_range" ? "QC Lot Verification"
              : studyType === "multi_analyte_coag" ? "Multi-Analyte Lot Comparison"
              : studyType === "ref_interval" ? "Reference Range Verification"
              : studyType === "sensitivity" ? "Sensitivity Verification"
              : studyType === "carryover" ? "Carryover Verification"
              : studyType === "accuracy_bias" ? "Accuracy / Bias"
              : studyType === "linearity" ? "Linearity"
              : studyType === "reportable_range" ? "Reportable Range / AMR Verification"
              : "this study type";
            const reasons: string[] = [];
            if (!testName.trim()) reasons.push("Enter the Test Name on the Setup tab.");
            if (filledLevels < minLevels) {
              const need = minLevels - filledLevels;
              reasons.push(`Fill ${need} more ${unit}${need !== 1 ? "s" : ""} on the Data Entry tab (${minLevels} ${unit}s required for ${studyTypeLabel}).`);
            }
            if (reasons.length === 0) return null;
            return (
              <div className="mt-8 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs space-y-1.5" data-testid="panel-generate-blocking-reasons">
                <p className="font-medium text-amber-800 dark:text-amber-300">Before you can generate the report:</p>
                <ul className="list-disc list-inside text-amber-700 dark:text-amber-400 space-y-0.5">
                  {reasons.map((r, i) => (<li key={i}>{r}</li>))}
                </ul>
              </div>
            );
          })()}

          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {filledLevels >= (studyType === "precision" ? 1 : studyType === "ref_interval" ? 20 : studyType === "sensitivity" ? 5 : 3) ? <span className="text-green-600 dark:text-green-400">{"✓"} {filledLevels} {studyType === "lot_to_lot" || studyType === "pt_coag" || studyType === "ref_interval" ? "specimen" : studyType === "sensitivity" ? "blank replicate" : studyType === "method_comparison" ? "sample" : "level"}{filledLevels !== 1 ? "s" : ""} ready</span> : <span>{filledLevels} / {studyType === "precision" ? 1 : studyType === "ref_interval" ? 20 : studyType === "sensitivity" ? 5 : 3} minimum filled</span>}
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSaveDraft}
                disabled={saveMutation.isPending || !testName.trim()}
                size="lg"
                variant="outline"
                data-testid="button-save-draft"
                title="Save what you have so far and finish later. Skips pass/fail calculation."
              >
                {saveMutation.isPending ? "Saving…" : isEditing ? "Save Changes (Draft)" : "Save Draft"}
              </Button>
              <Button onClick={handleSubmit} disabled={saveMutation.isPending || filledLevels < (studyType === "ref_interval" ? 20 : studyType === "sensitivity" ? 5 : studyType === "carryover" ? 12 : studyType === "qc_range" ? 2 : studyType === "accuracy_bias" ? 2 : studyType === "linearity" ? 3 : studyType === "reportable_range" ? 2 : 3) || !testName.trim()} size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold" data-testid="button-submit-study">
                {saveMutation.isPending ? "Calculating…" : isEditing ? "Save & Generate Report" : "Run Study & Generate Report"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing CTA — only show for free/per-study users */}
      {(!user?.plan || user.plan === "free" || user.plan === "per_study") && (
        <section className="section-padding bg-secondary/20" id="pricing">
          <div className="container-default max-w-2xl text-center">
            <div className="flex items-center justify-center gap-2 mb-3">
              <DollarSign size={18} className="text-primary" />
              <h2 className="font-serif text-2xl font-bold">Ready to Run Unlimited Studies?</h2>
            </div>
            <p className="text-muted-foreground mb-6">
              View our full pricing to find the right plan for your lab.
            </p>

            <div className="max-w-md mx-auto mb-6 text-left">
              <p className="text-sm text-muted-foreground mb-2">Have a discount code?</p>
              {!discountApplied ? (
                <div className="flex gap-2">
                  <Input
                    value={discountCode}
                    onChange={(e) => { setDiscountCode(e.target.value); setDiscountError(""); }}
                    onKeyDown={(e) => e.key === "Enter" && applyDiscount("veritacheck_only")}
                    placeholder="Enter code"
                    className="max-w-xs"
                  />
                  <Button
                    onClick={() => applyDiscount("veritacheck_only")}
                    disabled={discountLoading || !discountCode.trim()}
                    variant="outline"
                  >
                    {discountLoading ? <Loader2 size={14} className="animate-spin" /> : <Tag size={14} className="mr-1.5" />}
                    {discountLoading ? "Checking..." : "Apply"}
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-start gap-3">
                  <CheckCircle2 size={16} className="text-green-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-800">
                      <strong>{discountApplied.code}</strong>: {[discountApplied.trialDays ? `${discountApplied.trialDays}-day free trial` : "", discountApplied.pct ? `${discountApplied.pct}% off` : ""].filter(Boolean).join(" + ")} via {discountApplied.partnerName}
                    </p>
                    {discountApplied.trialDays ? (
                      <p className="text-xs text-green-700 mt-0.5">{discountApplied.trialDays}-day free trial{discountApplied.pct ? ` + ${discountApplied.pct}% off first year` : ""} - card required</p>
                    ) : discountApplied.pct === 100 ? (
                      <p className="text-xs text-green-700 mt-0.5">No payment method required.</p>
                    ) : null}
                  </div>
                  <button
                    className="text-xs text-muted-foreground underline"
                    onClick={() => { setDiscountApplied(null); setDiscountCode(""); }}
                  >
                    Remove
                  </button>
                </div>
              )}
              {discountError && (
                <p className="text-sm text-red-500 mt-2">{discountError}</p>
              )}
            </div>

            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <Link href="/pricing">
                View Pricing <ChevronRight size={15} className="ml-1" />
              </Link>
            </Button>
          </div>
        </section>
      )}

      {/* Payment result banners — always visible so users see confirmation after checkout */}
      {paymentStatus === "success" && (
        <section className="section-padding">
          <Alert className="max-w-2xl mx-auto border-green-500/30 bg-green-500/10">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700 dark:text-green-400 font-medium">
              Payment successful. Your account has been updated. Thank you!
            </AlertDescription>
          </Alert>
        </section>
      )}
      {paymentStatus === "cancelled" && (
        <section className="section-padding">
          <Alert className="max-w-2xl mx-auto border-yellow-500/30 bg-yellow-500/10">
            <XCircle className="h-4 w-4 text-yellow-600" />
            <AlertDescription className="text-yellow-700 dark:text-yellow-400">
              Payment cancelled. No charge was made.
            </AlertDescription>
          </Alert>
        </section>
      )}
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
