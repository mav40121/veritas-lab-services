import { useState, useMemo, useEffect } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  Search,
  Trash2,
  Plus,
  ChevronDown,
  ChevronRight,
  Lock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import fdaData from "@/lib/fdaInstrumentData.json";

// ── Types ─────────────────────────────────────────────────────────────────────

type Complexity = "MODERATE" | "HIGH" | "WAIVED";
type Role = "Primary" | "Backup" | "Satellite" | "Reference" | "POC";

interface FDATest {
  complexity: Complexity;
  specialty: string;
}

interface FDAInstrument {
  vendor: string;
  category: string;
  testCount: number;
  tests: Record<string, FDATest>;
}

interface InstrumentEntry {
  id: number;
  instrument_name: string;
  role: Role;
  category: string;
}

interface TestToggle {
  analyte: string;
  specialty: string;
  complexity: Complexity;
  active: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const INSTRUMENT_DATA = fdaData as Record<string, FDAInstrument>;

const CATEGORY_ORDER = [
  "Chemistry",
  "Immunoassay",
  "Hematology",
  "Coagulation",
  "Blood Gas",
  "Urinalysis",
  "Blood Bank",
  "Point of Care",
  "Microbiology",
  "Molecular",
  "Immunology / Protein",
  "Endocrinology / Immunoassay",
  "Toxicology / TDM",
  "ESR",
  "Fecal Testing",
  "Manual Procedures",
];

const CHEMISTRY_SPECIALTY_ORDER = [
  "Electrolytes",
  "General Chemistry",
  "Endocrinology",
  "General Immunology",
  "Immunology",
  "Toxicology",
  "Coagulation",
  "Hematology",
  "Urinalysis",
  "Microbiology",
  "Blood Bank",
];

function getSpecialtyOrder(specialty: string, isChemistry: boolean): number {
  if (!isChemistry) return 999;
  const order = CHEMISTRY_SPECIALTY_ORDER.indexOf(specialty);
  return order === -1 ? 998 : order;
}

const ROLES: Role[] = ["Primary", "Backup", "Satellite", "Reference", "POC"];

const ROLE_STYLES: Record<Role, string> = {
  Primary: "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300 border-teal-200 dark:border-teal-800",
  Backup: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  Satellite: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800",
  Reference: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  POC: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300 border-green-200 dark:border-green-800",
};

function getCategoryColor(category: string): string {
  const map: Record<string, string> = {
    Chemistry: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    Immunoassay: "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
    Hematology: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    Coagulation: "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
    "Blood Gas": "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    Urinalysis: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300",
    "Blood Bank": "bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300",
    "Point of Care": "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    Microbiology: "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
    Molecular: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
    "Immunology / Protein": "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
    "Endocrinology / Immunoassay": "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
    "Toxicology / TDM": "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
    ESR: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    "Fecal Testing": "bg-lime-100 text-lime-700 dark:bg-lime-950/40 dark:text-lime-300",
    "Manual Procedures": "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  };
  return map[category] ?? "bg-muted text-muted-foreground";
}

function getComplexityBadge(complexity: Complexity) {
  if (complexity === "WAIVED")
    return (
      <Badge className="text-[10px] px-1.5 py-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-0">
        WAIVED
      </Badge>
    );
  if (complexity === "HIGH")
    return (
      <Badge className="text-[10px] px-1.5 py-0 bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-0">
        HIGH
      </Badge>
    );
  return (
    <Badge className="text-[10px] px-1.5 py-0 bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-0">
      MODERATE
    </Badge>
  );
}

function getSpecialtyColor(specialty: string): string {
  const map: Record<string, string> = {
    "General Chemistry": "text-blue-600 dark:text-blue-400",
    "General Immunology": "text-purple-600 dark:text-purple-400",
    Hematology: "text-red-600 dark:text-red-400",
    Endocrinology: "text-violet-600 dark:text-violet-400",
    Toxicology: "text-orange-600 dark:text-orange-400",
    Immunohematology: "text-pink-600 dark:text-pink-400",
    Urinalysis: "text-yellow-600 dark:text-yellow-400",
    Coagulation: "text-orange-500 dark:text-orange-300",
    "Blood Gas": "text-sky-600 dark:text-sky-400",
    Microbiology: "text-green-600 dark:text-green-400",
    "Routine Chemistry": "text-blue-600 dark:text-blue-400",
  };
  return map[specialty] ?? "text-muted-foreground";
}

// ── Step indicator ─────────────────────────────────────────────────────────────

function StepIndicator({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-2 mb-1">
      <div className="flex items-center gap-1.5">
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            step >= 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          1
        </div>
        <span
          className={`text-xs font-medium ${
            step === 1 ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          Add Instruments
        </span>
      </div>
      <ChevronRight size={12} className="text-muted-foreground" />
      <div className="flex items-center gap-1.5">
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            step >= 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          2
        </div>
        <span
          className={`text-xs font-medium ${
            step === 2 ? "text-foreground" : "text-muted-foreground"
          }`}
        >
          Select Tests
        </span>
      </div>
    </div>
  );
}

// ── RoleBadge ─────────────────────────────────────────────────────────────────

function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${ROLE_STYLES[role]}`}
    >
      {role}
    </span>
  );
}

// ── Instrument section for Step 2 ─────────────────────────────────────────────

function InstrumentTestSection({
  instrument,
  tests,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: {
  instrument: InstrumentEntry;
  tests: TestToggle[];
  onToggle: (analyte: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [search, setSearch] = useState("");

  const isChemistry = instrument.category === "Chemistry";

  const filtered = useMemo(() => {
    if (!search.trim()) return tests;
    const q = search.toLowerCase();
    return tests
      .filter(
        (t) =>
          t.analyte.toLowerCase().includes(q) ||
          t.specialty.toLowerCase().includes(q)
      )
      .sort((a, b) => a.analyte.localeCompare(b.analyte));
  }, [tests, search]);

  const activeCount = tests.filter((t) => t.active).length;

  // Group by specialty, sort tests alphabetically within each group
  const bySpecialty = useMemo(() => {
    const grouped: Record<string, TestToggle[]> = {};
    for (const t of filtered) {
      if (!grouped[t.specialty]) grouped[t.specialty] = [];
      grouped[t.specialty].push(t);
    }
    for (const key of Object.keys(grouped)) {
      grouped[key].sort((a, b) => a.analyte.localeCompare(b.analyte));
    }
    return grouped;
  }, [filtered]);

  return (
    <Card className="overflow-hidden">
      {/* Section header */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <ChevronDown
            size={14}
            className={`shrink-0 text-muted-foreground transition-transform ${
              expanded ? "" : "-rotate-90"
            }`}
          />
          <span className="font-semibold text-sm truncate">{instrument.instrument_name}</span>
          <RoleBadge role={instrument.role} />
          <Badge className={`text-[10px] px-1.5 py-0 border-0 ${getCategoryColor(instrument.category)}`}>
            {instrument.category}
          </Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{activeCount}</span>/{tests.length} active
          </span>
        </div>
      </button>

      {expanded && (
        <CardContent className="p-0 border-t border-border">
          {/* Controls */}
          <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/30 border-b border-border">
            <div className="relative flex-1 max-w-xs">
              <Search
                size={12}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Search tests…"
                className="pl-7 h-7 text-xs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={onSelectAll}
            >
              Select All
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={onDeselectAll}
            >
              Deselect All
            </Button>
          </div>

          {/* Tests grouped by specialty */}
          <div className="divide-y divide-border">
            {Object.entries(bySpecialty)
              .sort(([a], [b]) => {
                const orderA = getSpecialtyOrder(a, isChemistry);
                const orderB = getSpecialtyOrder(b, isChemistry);
                if (orderA !== orderB) return orderA - orderB;
                return a.localeCompare(b);
              })
              .map(([specialty, specialtyTests]) => (
                <div key={specialty}>
                  <div className="px-4 pt-2.5 pb-1">
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${getSpecialtyColor(specialty)}`}>
                      {specialty}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-2">
                      ({specialtyTests.filter((t) => t.active).length}/{specialtyTests.length})
                    </span>
                  </div>
                  {specialtyTests.map((test) => (
                    <div
                      key={test.analyte}
                      className={`flex items-center gap-3 px-4 py-2 transition-colors ${
                        !test.active ? "opacity-50 bg-muted/20" : "hover:bg-muted/20"
                      }`}
                    >
                      <Switch
                        checked={test.active}
                        onCheckedChange={() => onToggle(test.analyte)}
                        className="data-[state=checked]:bg-primary shrink-0"
                      />
                      <span className="text-sm font-medium flex-1 min-w-0 truncate">
                        {test.analyte}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {getComplexityBadge(test.complexity)}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
          </div>

          {Object.keys(bySpecialty).length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No tests match "{search}"
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VeritaMapBuildPage() {
  const [, params] = useRoute("/veritamap-app/:id/build");
  const mapId = params?.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 state — 3-step cascade
  const [selectedDepartment, setSelectedDepartment] = useState<string>("");
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [instrumentName, setInstrumentName] = useState<string>("");
  const [manualEntry, setManualEntry] = useState(false);
  const [manualInstrumentName, setManualInstrumentName] = useState("");
  const [role, setRole] = useState<Role>("Primary");

  // Step 2 state: map from instId → test toggles
  const [testsByInstrument, setTestsByInstrument] = useState<
    Record<number, TestToggle[]>
  >({});

  // Freemium limits
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState("");

  const { data: limits } = useQuery<{
    isFree: boolean;
    instrumentCount: number;
    analyteCount: number;
    instrumentLimit: number | null;
    analyteLimit: number | null;
  }>({
    queryKey: [`/api/veritamap/maps/${mapId}/limits`],
    enabled: !!mapId,
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/veritamap/maps/${mapId}/limits`, { headers: authHeaders() });
      if (!res.ok) return { isFree: false, instrumentCount: 0, analyteCount: 0, instrumentLimit: null, analyteLimit: null };
      return res.json();
    },
  });

  // Fetch existing instruments
  const { data: instruments = [], isLoading: loadingInstruments } = useQuery<
    InstrumentEntry[]
  >({
    queryKey: [`/api/veritamap/maps/${mapId}/instruments`],
    enabled: !!mapId,
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/veritamap/maps/${mapId}/instruments`,
        { headers: authHeaders() }
      );
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Initialize test toggles when instruments load or change
  useEffect(() => {
    if (!instruments.length) return;
    setTestsByInstrument((prev) => {
      const next = { ...prev };
      for (const instr of instruments) {
        if (!next[instr.id]) {
          const fdaInstr = INSTRUMENT_DATA[instr.instrument_name];
          if (fdaInstr) {
            next[instr.id] = Object.entries(fdaInstr.tests).map(
              ([analyte, info]) => ({
                analyte,
                specialty: info.specialty,
                complexity: info.complexity as Complexity,
                active: true,
              })
            );
          } else {
            next[instr.id] = [];
          }
        }
      }
      return next;
    });
  }, [instruments]);

  // Resolve the effective instrument name (from dropdown or manual entry)
  const effectiveInstrumentName = manualEntry ? manualInstrumentName.trim() : instrumentName;

  // Add instrument mutation
  const addInstrumentMutation = useMutation({
    mutationFn: async () => {
      const name = effectiveInstrumentName;
      const fdaInstr = INSTRUMENT_DATA[name];
      const category = fdaInstr?.category ?? (selectedDepartment || "Unknown");
      const res = await fetch(
        `${API_BASE}/api/veritamap/maps/${mapId}/instruments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            instrument_name: name,
            role,
            category,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.limitReached) {
          throw Object.assign(new Error(data.error), { limitReached: true, type: data.type, limit: data.limit });
        }
        throw new Error(data?.error || "Failed to add instrument");
      }
      return res.json() as Promise<InstrumentEntry>;
    },
    onSuccess: (newInstr) => {
      qc.invalidateQueries({
        queryKey: [`/api/veritamap/maps/${mapId}/instruments`],
      });
      qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}/limits`] });
      setInstrumentName("");
      setSelectedVendor("");
      setManualInstrumentName("");
      setManualEntry(false);
      // Initialize tests for new instrument
      const fdaInstr = INSTRUMENT_DATA[newInstr.instrument_name];
      if (fdaInstr) {
        setTestsByInstrument((prev) => ({
          ...prev,
          [newInstr.id]: Object.entries(fdaInstr.tests).map(
            ([analyte, info]) => ({
              analyte,
              specialty: info.specialty,
              complexity: info.complexity as Complexity,
              active: true,
            })
          ),
        }));
      }
      toast({ title: "Instrument added" });
    },
    onError: (err: any) => {
      if (err.limitReached) {
        setUpgradeMessage(`You've reached the free plan limit of ${err.limit} ${err.type}. Upgrade to VeritaMap\u2122 for unlimited instruments, analytes, and full intelligence features.`);
        setUpgradeOpen(true);
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    },
  });

  // Delete instrument mutation
  const deleteInstrumentMutation = useMutation({
    mutationFn: async (instId: number) => {
      const res = await fetch(
        `${API_BASE}/api/veritamap/maps/${mapId}/instruments/${instId}`,
        { method: "DELETE", headers: authHeaders() }
      );
      if (!res.ok) throw new Error("Failed to delete instrument");
    },
    onSuccess: (_, instId) => {
      qc.invalidateQueries({
        queryKey: [`/api/veritamap/maps/${mapId}/instruments`],
      });
      qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}/limits`] });
      setTestsByInstrument((prev) => {
        const next = { ...prev };
        delete next[instId];
        return next;
      });
      toast({ title: "Instrument removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove instrument", variant: "destructive" });
    },
  });

  // Save all tests mutation
  const saveAllMutation = useMutation({
    mutationFn: async () => {
      for (const instr of instruments) {
        const tests = testsByInstrument[instr.id] ?? [];
        const activeParts = tests.filter((t) => t.active);
        const res = await fetch(
          `${API_BASE}/api/veritamap/maps/${mapId}/instruments/${instr.id}/tests`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ tests: activeParts }),
          }
        );
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          if (data?.limitReached) {
            throw Object.assign(new Error(data.error), { limitReached: true, type: data.type, limit: data.limit });
          }
          throw new Error(data?.error || data?.message || `Failed to save tests for ${instr.instrument_name}`);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}`] });
      qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}/intelligence`] });
      qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}/instruments`] });
      navigate(`/veritamap-app/${mapId}`);
    },
    onError: (err: any) => {
      if (err.limitReached) {
        setUpgradeMessage(`You've reached the free plan limit of ${err.limit} ${err.type}. Upgrade to VeritaMap\u2122 for unlimited instruments, analytes, and full intelligence features.`);
        setUpgradeOpen(true);
      } else {
        toast({ title: "Error saving tests", description: err.message, variant: "destructive" });
      }
    },
  });

  // Build cascade lookup: departments → vendors → instruments
  const cascade = useMemo(() => {
    const deptVendorInstr: Record<string, Record<string, string[]>> = {};
    for (const [name, info] of Object.entries(INSTRUMENT_DATA)) {
      const dept = info.category;
      const vendor = info.vendor || "Unknown";
      if (!deptVendorInstr[dept]) deptVendorInstr[dept] = {};
      if (!deptVendorInstr[dept][vendor]) deptVendorInstr[dept][vendor] = [];
      deptVendorInstr[dept][vendor].push(name);
    }
    // Sort instrument names within each vendor
    for (const dept of Object.values(deptVendorInstr)) {
      for (const vendor of Object.keys(dept)) {
        dept[vendor].sort();
      }
    }
    return deptVendorInstr;
  }, []);

  // Sorted department list based on CATEGORY_ORDER
  const departments = useMemo(() => {
    const existing = Object.keys(cascade);
    const ordered = CATEGORY_ORDER.filter((c) => existing.includes(c));
    const extra = existing.filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return [...ordered, ...extra];
  }, [cascade]);

  // Vendors filtered by selected department
  const vendorsForDept = useMemo(() => {
    if (!selectedDepartment || !cascade[selectedDepartment]) return [];
    return Object.keys(cascade[selectedDepartment]).sort();
  }, [selectedDepartment, cascade]);

  // Instruments filtered by selected department + vendor
  const instrumentsForVendor = useMemo(() => {
    if (!selectedDepartment || !selectedVendor) return [];
    return cascade[selectedDepartment]?.[selectedVendor] ?? [];
  }, [selectedDepartment, selectedVendor, cascade]);

  // Toggle a test for a specific instrument
  function toggleTest(instId: number, analyte: string) {
    setTestsByInstrument((prev) => ({
      ...prev,
      [instId]: (prev[instId] ?? []).map((t) =>
        t.analyte === analyte ? { ...t, active: !t.active } : t
      ),
    }));
  }

  function selectAll(instId: number) {
    setTestsByInstrument((prev) => ({
      ...prev,
      [instId]: (prev[instId] ?? []).map((t) => ({ ...t, active: true })),
    }));
  }

  function deselectAll(instId: number) {
    setTestsByInstrument((prev) => ({
      ...prev,
      [instId]: (prev[instId] ?? []).map((t) => ({ ...t, active: false })),
    }));
  }

  // Total active tests count across all instruments
  const totalActiveTests = useMemo(() => {
    let count = 0;
    for (const tests of Object.values(testsByInstrument)) {
      count += tests.filter((t) => t.active).length;
    }
    return count;
  }, [testsByInstrument]);

  // ── Step 1 ────────────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="mb-5 -ml-2 text-muted-foreground"
        >
          <Link href="/veritamap-app">
            <ArrowLeft size={14} className="mr-1" /> Back to Maps
          </Link>
        </Button>

        <StepIndicator step={1} />
        <h1 className="text-2xl font-bold mt-2 mb-1">Step 1: Add Your Instruments</h1>
        <p className="text-sm text-muted-foreground mb-3 max-w-2xl">
          Add every instrument your lab uses for each test — including primary AND backup
          analyzers. Even if two instruments are the same model, add them separately.
        </p>
        {limits?.isFree && (
          <div className="mb-4 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            <Lock size={12} />
            <span>Instruments: <span className="font-semibold">{instruments.length}</span>/{limits.instrumentLimit} (free plan) — <Link href="/veritamap" className="underline hover:no-underline">upgrade for unlimited</Link></span>
          </div>
        )}

        {/* Add instrument form — 3-step cascade */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold mb-3">Add Instrument</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Step 1: Department */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Department</label>
                <Select
                  value={selectedDepartment}
                  onValueChange={(v) => {
                    setSelectedDepartment(v);
                    setSelectedVendor("");
                    setInstrumentName("");
                    setManualEntry(false);
                    setManualInstrumentName("");
                    // Auto-select vendor if only one option (e.g., Manual Procedures)
                    const vendors = cascade[v] ? Object.keys(cascade[v]) : [];
                    if (vendors.length === 1) {
                      setSelectedVendor(vendors[0]);
                    }
                    // Default role to Reference for Manual Procedures
                    if (v === "Manual Procedures") {
                      setRole("Reference");
                    } else {
                      setRole("Primary");
                    }
                  }}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select department…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {departments.map((dept) => (
                      <SelectItem key={dept} value={dept} className="text-sm">
                        {dept}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Step 2: Vendor (filtered) */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Vendor</label>
                <Select
                  value={selectedVendor}
                  onValueChange={(v) => {
                    setSelectedVendor(v);
                    setInstrumentName("");
                    setManualEntry(false);
                    setManualInstrumentName("");
                  }}
                  disabled={!selectedDepartment || manualEntry}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder={selectedDepartment ? "Select vendor…" : "Select department first"} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {vendorsForDept.map((vendor) => (
                      <SelectItem key={vendor} value={vendor} className="text-sm">
                        {vendor}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Step 3: Instrument (filtered) — or manual entry */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Instrument</label>
                {manualEntry ? (
                  <Input
                    className="h-9 text-sm"
                    placeholder="Type instrument name…"
                    value={manualInstrumentName}
                    onChange={(e) => setManualInstrumentName(e.target.value)}
                  />
                ) : (
                  <Select
                    value={instrumentName}
                    onValueChange={(v) => setInstrumentName(v)}
                    disabled={!selectedVendor}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder={selectedVendor ? "Select instrument…" : "Select vendor first"} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {instrumentsForVendor.map((name) => (
                        <SelectItem key={name} value={name} className="text-sm">
                          {name}
                          <span className="ml-2 text-[10px] text-muted-foreground">
                            ({INSTRUMENT_DATA[name].testCount} tests)
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* Role select */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Role</label>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as Role)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="text-sm">
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Manual entry toggle + Add button row */}
            <div className="flex items-center justify-between mt-3">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2"
                onClick={() => {
                  setManualEntry(!manualEntry);
                  setInstrumentName("");
                  setManualInstrumentName("");
                }}
              >
                {manualEntry ? "Back to instrument list" : "Don't see your instrument? Add it manually"}
              </button>
              <Button
                className="h-9 shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground"
                disabled={!effectiveInstrumentName || addInstrumentMutation.isPending}
                onClick={() => addInstrumentMutation.mutate()}
              >
                <Plus size={14} className="mr-1" />
                Add Instrument
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Added instruments list */}
        {loadingInstruments ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : instruments.length > 0 ? (
          <div className="space-y-2 mb-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              {instruments.length} instrument{instruments.length !== 1 ? "s" : ""} added
            </h2>
            {instruments.map((instr) => {
              const fdaInstr = INSTRUMENT_DATA[instr.instrument_name];
              return (
                <div
                  key={instr.id}
                  className="flex items-center gap-3 p-3.5 rounded-xl border border-border bg-card hover:border-primary/20 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">{instr.instrument_name}</span>
                      <RoleBadge role={instr.role} />
                      {instr.category === "Manual Procedures" ? (
                        <Badge className="text-[10px] px-1.5 py-0 border-0 bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                          Manual
                        </Badge>
                      ) : (
                        <Badge className={`text-[10px] px-1.5 py-0 border-0 ${getCategoryColor(instr.category)}`}>
                          {instr.category}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {fdaInstr?.testCount ?? 0} {instr.category === "Manual Procedures" ? "tests" : "FDA-cleared tests"}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                    onClick={() => deleteInstrumentMutation.mutate(instr.id)}
                    disabled={deleteInstrumentMutation.isPending}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 border-2 border-dashed border-border rounded-xl mb-6 text-sm text-muted-foreground">
            <FlaskConical size={24} className="mx-auto mb-2 opacity-40" />
            No instruments added yet — select one above to start.
          </div>
        )}

        {/* Tip */}
        <div className="p-3.5 rounded-lg bg-muted/50 border border-border text-sm text-muted-foreground mb-6">
          <FlaskConical size={13} className="inline mr-1.5 text-primary" />
          Tip: Add duplicate analyzers of the same model separately — the intelligence engine
          will identify correlation requirements between them.
        </div>

        {/* Next button */}
        <div className="flex justify-end">
          <Button
            disabled={instruments.length === 0}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={() => setStep(2)}
          >
            Next: Select Tests
            <ArrowRight size={14} className="ml-1.5" />
          </Button>
        </div>

        {/* Upgrade dialog */}
        <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lock size={16} className="text-primary" /> Free Plan Limit Reached
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{upgradeMessage}</p>
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={() => setUpgradeOpen(false)}>
                Close
              </Button>
              <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground" asChild>
                <Link href="/veritamap">Upgrade Now</Link>
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setStep(1)}
        className="mb-5 -ml-2 text-muted-foreground"
      >
        <ArrowLeft size={14} className="mr-1" /> Back to Instrument Selection
      </Button>

      <StepIndicator step={2} />
      <h1 className="text-2xl font-bold mt-2 mb-1">Step 2: Select Your Test Menu</h1>
      <p className="text-sm text-muted-foreground mb-2 max-w-2xl">
        For each instrument, select only the tests your lab actually runs. Deactivate tests
        you don't perform.
      </p>
      {limits?.isFree && (
        <div className="mb-3 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <Lock size={12} />
          <span>Analytes: <span className="font-semibold">{totalActiveTests}</span>/{limits.analyteLimit} (free plan) — <Link href="/veritamap" className="underline hover:no-underline">upgrade for unlimited</Link></span>
        </div>
      )}

      {/* Summary */}
      <div className="flex items-center gap-3 mb-6 text-sm">
        <CheckCircle2 size={14} className="text-primary" />
        <span className="text-muted-foreground">
          <span className="font-semibold text-foreground">{totalActiveTests}</span> tests active
          across <span className="font-semibold text-foreground">{instruments.length}</span>{" "}
          instruments
        </span>
      </div>

      {/* One section per instrument */}
      <div className="space-y-3 mb-8">
        {instruments.map((instr) => (
          <InstrumentTestSection
            key={instr.id}
            instrument={instr}
            tests={testsByInstrument[instr.id] ?? []}
            onToggle={(analyte) => toggleTest(instr.id, analyte)}
            onSelectAll={() => selectAll(instr.id)}
            onDeselectAll={() => deselectAll(instr.id)}
          />
        ))}
      </div>

      {/* Build button */}
      <div className="flex items-center justify-between pt-6 border-t border-border">
        <span className="text-sm text-muted-foreground">
          {totalActiveTests} test{totalActiveTests !== 1 ? "s" : ""} will be saved to your map.
        </span>
        <Button
          onClick={() => saveAllMutation.mutate()}
          disabled={totalActiveTests === 0 || saveAllMutation.isPending}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {saveAllMutation.isPending ? "Building…" : "Build My Map"}
          {!saveAllMutation.isPending && (
            <ArrowRight size={14} className="ml-1.5" />
          )}
        </Button>
      </div>

      {/* Upgrade dialog */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock size={16} className="text-primary" /> Free Plan Limit Reached
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{upgradeMessage}</p>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" size="sm" onClick={() => setUpgradeOpen(false)}>
              Close
            </Button>
            <Button size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground" asChild>
              <Link href="/veritamap">Upgrade Now</Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
