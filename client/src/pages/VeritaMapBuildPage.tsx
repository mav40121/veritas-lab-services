import { useState, useMemo } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  Search,
  Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import fdaData from "@/lib/fdaInstrumentData.json";

// ── Types ─────────────────────────────────────────────────────────────────────

type Complexity = "MODERATE" | "HIGH" | "WAIVED";

interface FDATest {
  complexity: Complexity;
  specialty: string;
}

interface FDAInstrument {
  category: string;
  testCount: number;
  tests: Record<string, FDATest>;
}

interface ActiveTest {
  analyte: string;
  specialty: string;
  complexity: Complexity;
  active: boolean;
  instrument_source: string;
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
  "Microbiology",
];

function getCategoryColor(category: string): string {
  const map: Record<string, string> = {
    Chemistry:
      "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
    Immunoassay:
      "bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
    Hematology:
      "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
    Coagulation:
      "bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300",
    "Blood Gas":
      "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
    Urinalysis:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300",
    Microbiology:
      "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300",
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

/** Merge selected instruments into a deduplicated test list */
function buildTestList(selectedInstruments: string[]): ActiveTest[] {
  const seen = new Map<string, ActiveTest>();
  for (const instrName of selectedInstruments) {
    const instr = INSTRUMENT_DATA[instrName];
    if (!instr) continue;
    for (const [analyte, testInfo] of Object.entries(instr.tests)) {
      if (!seen.has(analyte)) {
        seen.set(analyte, {
          analyte,
          specialty: testInfo.specialty,
          complexity: testInfo.complexity as Complexity,
          active: true,
          instrument_source: instrName,
        });
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.analyte.localeCompare(b.analyte)
  );
}

// ── Instrument Card ───────────────────────────────────────────────────────────

function InstrumentCard({
  name,
  instrument,
  selected,
  onToggle,
}: {
  name: string;
  instrument: FDAInstrument;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full text-left rounded-xl border p-3.5 transition-all ${
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
          : "border-border hover:border-primary/30 hover:bg-muted/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm leading-tight mb-1">{name}</div>
          <Badge className={`text-[10px] px-1.5 py-0 border-0 ${getCategoryColor(instrument.category)}`}>
            {instrument.category}
          </Badge>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div
            className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
              selected
                ? "bg-primary text-primary-foreground"
                : "border-2 border-muted-foreground/30"
            }`}
          >
            {selected && <Check size={11} strokeWidth={3} />}
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {instrument.testCount} tests
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VeritaMapBuildPage() {
  const [, params] = useRoute("/veritamap-app/:id/build");
  const mapId = params?.id;
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [selectedInstruments, setSelectedInstruments] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [tests, setTests] = useState<ActiveTest[]>([]);

  // Group instruments by category
  const instrumentsByCategory = useMemo(() => {
    const grouped: Record<string, string[]> = {};
    for (const [name, info] of Object.entries(INSTRUMENT_DATA)) {
      const cat = info.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(name);
    }
    return grouped;
  }, []);

  const sortedCategories = CATEGORY_ORDER.filter((c) => instrumentsByCategory[c]);

  function toggleInstrument(name: string) {
    setSelectedInstruments((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  }

  function handleProceedToStep2() {
    if (selectedInstruments.length === 0) {
      toast({ title: "Select at least one instrument", variant: "destructive" });
      return;
    }
    const merged = buildTestList(selectedInstruments);
    setTests(merged);
    setStep(2);
  }

  function toggleTest(analyte: string) {
    setTests((prev) =>
      prev.map((t) =>
        t.analyte === analyte ? { ...t, active: !t.active } : t
      )
    );
  }

  // Group tests by specialty for step 2 display
  const testsBySpecialty = useMemo(() => {
    const filtered = search.trim()
      ? tests.filter((t) =>
          t.analyte.toLowerCase().includes(search.toLowerCase()) ||
          t.specialty.toLowerCase().includes(search.toLowerCase())
        )
      : tests;
    const grouped: Record<string, ActiveTest[]> = {};
    for (const t of filtered) {
      if (!grouped[t.specialty]) grouped[t.specialty] = [];
      grouped[t.specialty].push(t);
    }
    return grouped;
  }, [tests, search]);

  const activeCount = tests.filter((t) => t.active).length;

  // Save tests mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const activeParts = tests.filter((t) => t.active);
      const res = await fetch(`${API_BASE}/api/veritamap/maps/${mapId}/tests`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ tests: activeParts }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to save test menu");
      }
      return res.json();
    },
    onSuccess: () => {
      navigate(`/veritamap-app/${mapId}`);
    },
    onError: (err: Error) => {
      toast({ title: "Error saving test menu", description: err.message, variant: "destructive" });
    },
  });

  // ── Step 1 ────────────────────────────────────────────────────────────────
  if (step === 1) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="mb-4 -ml-2 text-muted-foreground"
          >
            <Link href="/veritamap-app">
              <ArrowLeft size={14} className="mr-1" /> Back to Maps
            </Link>
          </Button>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
              Step 1 of 2
            </span>
          </div>
          <h1 className="text-2xl font-bold mb-1.5">Build Your Test Menu</h1>
          <p className="text-muted-foreground text-sm max-w-2xl">
            Select the analyzers your lab uses. VeritaMap will pull the
            FDA-cleared test menu for each instrument.
          </p>
        </div>

        {/* Selected count */}
        {selectedInstruments.length > 0 && (
          <div className="flex items-center gap-2 mb-5 text-sm">
            <CheckCircle2 size={14} className="text-primary" />
            <span className="font-medium text-primary">
              {selectedInstruments.length} instrument
              {selectedInstruments.length !== 1 ? "s" : ""} selected
            </span>
            <span className="text-muted-foreground">
              (
              {buildTestList(selectedInstruments).length} unique tests)
            </span>
          </div>
        )}

        {/* Instruments by category */}
        <div className="space-y-8">
          {sortedCategories.map((category) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold">{category}</h2>
                <Badge
                  className={`text-[10px] px-1.5 py-0 border-0 ${getCategoryColor(category)}`}
                >
                  {instrumentsByCategory[category].length}
                </Badge>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {instrumentsByCategory[category].map((name) => (
                  <InstrumentCard
                    key={name}
                    name={name}
                    instrument={INSTRUMENT_DATA[name]}
                    selected={selectedInstruments.includes(name)}
                    onToggle={() => toggleInstrument(name)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Custom tests note */}
        <div className="mt-8 p-3.5 rounded-lg bg-muted/50 border border-border text-sm text-muted-foreground">
          <FlaskConical size={13} className="inline mr-1.5 text-primary" />
          You can also add custom tests (send-outs, reference methods) after
          building the initial map.
        </div>

        {/* Next button */}
        <div className="flex justify-end mt-6">
          <Button
            onClick={handleProceedToStep2}
            disabled={selectedInstruments.length === 0}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            Review Test Menu
            <ArrowRight size={14} className="ml-1.5" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Step 2 ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setStep(1)}
          className="mb-4 -ml-2 text-muted-foreground"
        >
          <ArrowLeft size={14} className="mr-1" /> Back to Instrument Selection
        </Button>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
            Step 2 of 2
          </span>
        </div>
        <h1 className="text-2xl font-bold mb-1.5">Review & Deactivate Tests</h1>
        <p className="text-muted-foreground text-sm">
          Your merged test menu from {selectedInstruments.length} instrument
          {selectedInstruments.length !== 1 ? "s" : ""}. Toggle off tests your
          lab doesn't perform.
        </p>
      </div>

      {/* Stats + search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 text-sm">
          <span className="font-semibold text-foreground">
            {activeCount} tests selected
          </span>
          <span className="text-muted-foreground">from {tests.length} total</span>
        </div>
        <div className="relative max-w-xs w-full">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search analytes or specialties…"
            className="pl-8 h-8 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Test list by specialty */}
      <div className="space-y-6">
        {Object.entries(testsBySpecialty)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([specialty, specialtyTests]) => (
            <div key={specialty}>
              <div className="flex items-center gap-2 mb-2">
                <h3 className={`text-xs font-semibold uppercase tracking-wide ${getSpecialtyColor(specialty)}`}>
                  {specialty}
                </h3>
                <span className="text-xs text-muted-foreground">
                  ({specialtyTests.filter((t) => t.active).length}/
                  {specialtyTests.length})
                </span>
              </div>
              <Card>
                <CardContent className="p-0 divide-y divide-border">
                  {specialtyTests.map((test) => (
                    <div
                      key={test.analyte}
                      className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                        !test.active ? "opacity-50 bg-muted/30" : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium truncate block">
                          {test.analyte}
                        </span>
                        <span className="text-xs text-muted-foreground truncate block">
                          {test.instrument_source}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {getComplexityBadge(test.complexity)}
                        <Switch
                          checked={test.active}
                          onCheckedChange={() => toggleTest(test.analyte)}
                          className="data-[state=checked]:bg-primary"
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ))}
      </div>

      {Object.keys(testsBySpecialty).length === 0 && search && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No tests match "{search}"
        </div>
      )}

      {/* Build button */}
      <div className="flex justify-between items-center mt-8 pt-6 border-t border-border">
        <span className="text-sm text-muted-foreground">
          {activeCount} test{activeCount !== 1 ? "s" : ""} will be added to your
          map.
        </span>
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={activeCount === 0 || saveMutation.isPending}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          {saveMutation.isPending ? "Building…" : "Build My Map"}
          {!saveMutation.isPending && (
            <ArrowRight size={14} className="ml-1.5" />
          )}
        </Button>
      </div>
    </div>
  );
}
