import { useState, useMemo, useEffect } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
  Info,
  Pencil,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import fdaData from "@/lib/fdaInstrumentData.json";

// ── Types ─────────────────────────────────────────────────────────────────────

type Complexity = "MODERATE" | "HIGH" | "WAIVED";
type Role = "Primary" | "Backup" | "Satellite" | "POC";

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
  serial_number?: string | null;
  tests?: { analyte: string; specialty: string; complexity: string; active: boolean }[];
}

interface TestToggle {
  analyte: string;
  specialty: string;
  complexity: Complexity;
  active: boolean;
  isCustom?: boolean;
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

const CUSTOM_TEST_SPECIALTIES = [
  "Electrolytes",
  "General Chemistry",
  "Hematology",
  "Coagulation",
  "Urinalysis",
  "Blood Gas",
  "Blood Bank",
  "Microbiology",
  "Immunology",
  "Endocrinology",
  "Toxicology",
  "Molecular",
  "Other",
];

const OTHER_DEPARTMENT_VALUE = "__other__";
const OTHER_VENDOR_VALUE = "__other__";
const OTHER_INSTRUMENT_VALUE = "__other__";

function getSpecialtyOrder(specialty: string, isChemistry: boolean): number {
  if (!isChemistry) return 999;
  const order = CHEMISTRY_SPECIALTY_ORDER.indexOf(specialty);
  return order === -1 ? 998 : order;
}

const ROLES: Role[] = ["Primary", "Backup", "Satellite", "POC"];

const ROLE_STYLES: Record<string, string> = {
  Primary: "bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300 border-teal-200 dark:border-teal-800",
  Backup: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  Satellite: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800",
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

function isCustomInstrument(instrumentName: string): boolean {
  return !INSTRUMENT_DATA[instrumentName];
}

// ── Step indicator ─────────────────────────────────────────────────────────────

const ROLE_ORDER: Role[] = ["Primary", "Backup", "Satellite", "POC"];

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  Primary:   "Select the tests your primary analyzers run.",
  Backup:    "Copy from your primary instruments and deactivate any tests not run on backup.",
  Satellite: "Configure satellite analyzers - typically a smaller test menu.",
  POC:       "Configure point-of-care devices and their test menus.",
};

function StepIndicator({
  step,
  roleGroups,
  currentRole,
}: {
  step: 1 | 2;
  roleGroups?: Role[];
  currentRole?: Role;
}) {
  return (
    <div className="flex items-center gap-2 mb-1 flex-wrap">
      {/* Step 1 */}
      <div className="flex items-center gap-1.5">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
          step >= 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        }`}>1</div>
        <span className={`text-xs font-medium ${step === 1 ? "text-foreground" : "text-muted-foreground"}`}>
          Add Instruments
        </span>
      </div>
      <ChevronRight size={12} className="text-muted-foreground" />
      {/* Step 2 role sub-steps */}
      {step === 2 && roleGroups && roleGroups.length > 0 ? (
        roleGroups.map((r, i) => (
          <div key={r} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight size={12} className="text-muted-foreground" />}
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
              r === currentRole ? "bg-primary text-primary-foreground" :
              ROLE_ORDER.indexOf(r) < ROLE_ORDER.indexOf(currentRole!) ? "bg-primary/40 text-primary-foreground" :
              "bg-muted text-muted-foreground"
            }`}>{i + 2}</div>
            <span className={`text-xs font-medium ${r === currentRole ? "text-foreground" : "text-muted-foreground"}`}>
              {r}s
            </span>
          </div>
        ))
      ) : (
        <div className="flex items-center gap-1.5">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            step >= 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          }`}>2</div>
          <span className={`text-xs font-medium ${step === 2 ? "text-foreground" : "text-muted-foreground"}`}>
            Select Tests
          </span>
        </div>
      )}
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

// ── Add Custom Test Dialog ───────────────────────────────────────────────────

function AddCustomTestDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (test: TestToggle) => void;
}) {
  const [testName, setTestName] = useState("");
  const [specialty, setSpecialty] = useState("General Chemistry");
  const [complexity, setComplexity] = useState<Complexity>("MODERATE");

  function handleSubmit() {
    if (!testName.trim()) return;
    onAdd({
      analyte: testName.trim(),
      specialty,
      complexity,
      active: true,
      isCustom: true,
    });
    setTestName("");
    setSpecialty("General Chemistry");
    setComplexity("MODERATE");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Plus size={16} className="text-primary" /> Add Custom Test
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
              Test Name *
            </label>
            <Input
              className="h-9 text-sm"
              placeholder='e.g. "SARS-CoV-2 EUA", "Lab-developed Toxicology Panel"'
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
              Specialty
            </label>
            <Select value={specialty} onValueChange={setSpecialty}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {CUSTOM_TEST_SPECIALTIES.map((s) => (
                  <SelectItem key={s} value={s} className="text-sm">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">
              Complexity
            </label>
            <Select value={complexity} onValueChange={(v) => setComplexity(v as Complexity)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WAIVED" className="text-sm">WAIVED</SelectItem>
                <SelectItem value="MODERATE" className="text-sm">MODERATE</SelectItem>
                <SelectItem value="HIGH" className="text-sm">HIGH</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={!testName.trim()}
            onClick={handleSubmit}
          >
            <Plus size={14} className="mr-1" /> Add Test
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit Instrument Dialog ───────────────────────────────────────────────────

interface EditInstrumentDialogProps {
  instrument: InstrumentEntry;
  mapId: string;
  onSaved: () => void;
}

function EditInstrumentDialog({ instrument, mapId, onSaved }: EditInstrumentDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(instrument.instrument_name);
  const [role, setRole] = useState<Role>(instrument.role);
  const [category, setCategory] = useState(instrument.category || "");
  const [serial, setSerial] = useState(instrument.serial_number || "");

  const queryClient = useQueryClient();

  const editMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/veritamap/maps/${mapId}/instruments/${instrument.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          instrument_name: name,
          role,
          category,
          serial_number: serial,
        }),
      });
      if (!res.ok) throw new Error("Failed to update instrument");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}/instruments`] });
      onSaved();
      setOpen(false);
    },
  });

  const handleOpen = (val: boolean) => {
    if (val) {
      setName(instrument.instrument_name);
      setRole(instrument.role);
      setCategory(instrument.category || "");
      setSerial(instrument.serial_number || "");
    }
    setOpen(val);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit instrument">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Instrument</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label htmlFor="edit-inst-name">Instrument Name</Label>
            <Input
              id="edit-inst-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sysmex XN-1000"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-inst-role">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="edit-inst-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Primary">Primary</SelectItem>
                <SelectItem value="Backup">Backup</SelectItem>
                <SelectItem value="Satellite">Satellite</SelectItem>
                <SelectItem value="POC">POC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-inst-category">Category</Label>
            <Input
              id="edit-inst-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Hematology"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="edit-inst-serial">Serial Number</Label>
            <Input
              id="edit-inst-serial"
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() => editMutation.mutate()}
            disabled={!name.trim() || editMutation.isPending}
          >
            {editMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Instrument section for Step 2 ─────────────────────────────────────────────

function InstrumentTestSection({
  instrument,
  tests,
  mapId,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onAddCustomTest,
  otherInstruments,
  onCopyFrom,
  isCopying,
}: {
  instrument: InstrumentEntry;
  tests: TestToggle[];
  mapId: string;
  onToggle: (analyte: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onAddCustomTest: (test: TestToggle) => void;
  otherInstruments: Array<{id: number, instrument_name: string, testCount: number}>;
  onCopyFrom: (sourceInstId: number) => void;
  isCopying: boolean;
  roleContext?: Role;
}) {
  const [expanded, setExpanded] = useState(true);
  const [search, setSearch] = useState("");
  const [customTestOpen, setCustomTestOpen] = useState(false);
  const [copyFromOpen, setCopyFromOpen] = useState(false);
  const [copySourceId, setCopySourceId] = useState<number | ''>(otherInstruments[0]?.id ?? '');

  const isChemistry = instrument.category === "Chemistry";
  const isCustom = isCustomInstrument(instrument.instrument_name);

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
          {isCustom && (
            <Badge className="text-[10px] px-1.5 py-0 border-0 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              Other
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{activeCount}</span>/{tests.length} active
          </span>
          <span onClick={(e) => e.stopPropagation()}>
            <EditInstrumentDialog instrument={instrument} mapId={mapId} onSaved={() => {}} />
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
            {otherInstruments.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2"
                onClick={(e) => { e.stopPropagation(); setCopyFromOpen((v) => !v); }}
              >
                Copy test menu from...
              </Button>
            )}
          </div>

          {/* Copy-from inline dialog */}
          {copyFromOpen && otherInstruments.length > 0 && (
            <div className="px-4 py-3 bg-blue-50 dark:bg-blue-950/20 border-b border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-700 dark:text-blue-300 mb-2 font-medium">
                Copy tests from another instrument (merge only, existing tests kept):
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={copySourceId}
                  onChange={e => setCopySourceId(Number(e.target.value))}
                  className="text-sm border border-blue-300 rounded-lg px-3 py-1.5 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {otherInstruments.map(inst => (
                    <option key={inst.id} value={inst.id}>
                      {inst.instrument_name}{inst.testCount ? ` (${inst.testCount} tests)` : ''}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                  disabled={isCopying || !copySourceId}
                  onClick={() => { if (copySourceId) { onCopyFrom(Number(copySourceId)); setCopyFromOpen(false); } }}
                >
                  {isCopying ? 'Copying...' : 'Copy (merge)'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setCopyFromOpen(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Copy-from banner: shown only when instrument has NO tests at all (not just all-deactivated) */}
          {tests.length === 0 && otherInstruments.length > 0 && !copyFromOpen && (
            <div className="mx-4 mt-3 mb-1 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
                This instrument has no tests yet.
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mb-3">
                Copy a test menu from another instrument as a starting point, then adjust as needed.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={copySourceId}
                  onChange={e => setCopySourceId(Number(e.target.value))}
                  className="text-sm border border-blue-300 rounded-lg px-3 py-1.5 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {otherInstruments.map(inst => (
                    <option key={inst.id} value={inst.id}>
                      {inst.instrument_name}{inst.testCount ? ` (${inst.testCount} tests)` : ''}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium"
                  disabled={isCopying || !copySourceId}
                  onClick={() => { if (copySourceId) onCopyFrom(Number(copySourceId)); }}
                >
                  {isCopying ? 'Copying...' : 'Copy Test Menu'}
                </Button>
                <span className="text-xs text-blue-600 dark:text-blue-400">or start blank (add tests below)</span>
              </div>
            </div>
          )}

          {/* Empty state for custom instruments with no tests */}
          {isCustom && tests.length === 0 && (
            <div className="text-center py-8 px-4">
              <FlaskConical size={24} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm text-muted-foreground mb-3">
                No pre-defined tests for this custom instrument.
              </p>
              <Button
                type="button"
                size="sm"
                className="bg-primary hover:bg-primary/90 text-primary-foreground"
                onClick={(e) => { e.stopPropagation(); setCustomTestOpen(true); }}
              >
                <Plus size={14} className="mr-1" /> Add Custom Test
              </Button>
            </div>
          )}

          {/* Tests grouped by specialty */}
          {(tests.length > 0 || !isCustom) && (
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
                          {test.isCustom && (
                            <Badge className="text-[10px] px-1.5 py-0 border-0 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                              Custom
                            </Badge>
                          )}
                          {getComplexityBadge(test.complexity)}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}

          {Object.keys(bySpecialty).length === 0 && tests.length > 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No tests match "{search}"
            </div>
          )}

          {/* Add Custom Test button — always shown at bottom */}
          <div className="px-4 py-3 border-t border-border bg-muted/20">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={(e) => { e.stopPropagation(); setCustomTestOpen(true); }}
            >
              <Plus size={12} className="mr-1" /> Add Custom Test
            </Button>
          </div>

          {/* EUA/LDT info note */}
          <div className="px-4 py-2.5 bg-muted/10 border-t border-border">
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Info size={12} className="shrink-0 mt-0.5" />
              Running an EUA test or lab-developed test (LDT) not listed above? Use 'Add Custom Test' to include it in your compliance map.
            </p>
          </div>
        </CardContent>
      )}

      <AddCustomTestDialog
        open={customTestOpen}
        onOpenChange={setCustomTestOpen}
        onAdd={onAddCustomTest}
      />
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
  const readOnly = useIsReadOnly('veritamap');

  const [step, setStep] = useState<1 | 2>(1);
  const [currentRole, setCurrentRole] = useState<Role>("Primary");

  // Step 1 state — 3-step cascade
  const [selectedDepartment, setSelectedDepartment] = useState<string>("");
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [instrumentName, setInstrumentName] = useState<string>("");
  const [manualEntry, setManualEntry] = useState(false);
  const [manualInstrumentName, setManualInstrumentName] = useState("");
  const [role, setRole] = useState<Role>("Primary");
  const [serialNumber, setSerialNumber] = useState("");

  // "Other" write-in state for cascade
  const [customDepartment, setCustomDepartment] = useState("");
  const [customVendor, setCustomVendor] = useState("");
  const [customInstrument, setCustomInstrument] = useState("");

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

  // Compute which role groups are present (in order), used for step navigation
  const presentRoleGroups = useMemo(() =>
    ROLE_ORDER.filter(r => instruments.some(i => i.role === r)),
    [instruments]
  );

  // Instruments for the current role step
  const currentRoleInstruments = useMemo(() =>
    instruments.filter(i => i.role === currentRole),
    [instruments, currentRole]
  );

  // When entering step 2, start at the first present role group
  const enterStep2 = () => {
    const firstRole = presentRoleGroups[0] ?? "Primary";
    setCurrentRole(firstRole);
    setStep(2);
  };

  // Advance to next role group, or save if last
  const advanceRole = () => {
    const idx = presentRoleGroups.indexOf(currentRole);
    if (idx < presentRoleGroups.length - 1) {
      setCurrentRole(presentRoleGroups[idx + 1]);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      saveAllMutation.mutate();
    }
  };

  const isLastRoleGroup = presentRoleGroups.indexOf(currentRole) === presentRoleGroups.length - 1;

  // Initialize test toggles when instruments load or change
  useEffect(() => {
    if (!instruments.length) return;
    setTestsByInstrument((prev) => {
      const next = { ...prev };
      for (const instr of instruments) {
        if (!next[instr.id]) {
          // If the API returned saved tests for this instrument, use them
          if (instr.tests && instr.tests.length > 0) {
            const savedAnalytes = new Set(instr.tests.map((t) => t.analyte));
            const fdaInstr = INSTRUMENT_DATA[instr.instrument_name];
            // Start with saved tests (preserving their active state)
            const toggles: TestToggle[] = instr.tests.map((t) => ({
              analyte: t.analyte,
              specialty: t.specialty,
              complexity: t.complexity as Complexity,
              active: Boolean(t.active),
              isCustom: fdaInstr ? !fdaInstr.tests[t.analyte] : true,
            }));
            // Add any FDA tests not yet saved (as inactive) so the full menu is shown
            if (fdaInstr) {
              for (const [analyte, info] of Object.entries(fdaInstr.tests)) {
                if (!savedAnalytes.has(analyte)) {
                  toggles.push({
                    analyte,
                    specialty: info.specialty,
                    complexity: info.complexity as Complexity,
                    active: false,
                  });
                }
              }
            }
            next[instr.id] = toggles;
          } else {
            // No saved tests: initialize from FDA data (new instrument)
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
      }
      return next;
    });
  }, [instruments]);

  // Determine effective instrument name based on cascade state
  const isOtherDepartment = selectedDepartment === OTHER_DEPARTMENT_VALUE;
  const isOtherVendor = selectedVendor === OTHER_VENDOR_VALUE;
  const isOtherInstrument = instrumentName === OTHER_INSTRUMENT_VALUE;

  const effectiveInstrumentName = manualEntry
    ? manualInstrumentName.trim()
    : isOtherDepartment
      ? customInstrument.trim()
      : isOtherInstrument
        ? customInstrument.trim()
        : instrumentName;

  const effectiveCategory = isOtherDepartment
    ? customDepartment.trim()
    : selectedDepartment || "Unknown";

  // Add instrument mutation
  const addInstrumentMutation = useMutation({
    mutationFn: async () => {
      const name = effectiveInstrumentName;
      const fdaInstr = INSTRUMENT_DATA[name];
      const category = fdaInstr?.category ?? effectiveCategory;
      const res = await fetch(
        `${API_BASE}/api/veritamap/maps/${mapId}/instruments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({
            instrument_name: name,
            role,
            category,
            serial_number: serialNumber.trim() || null,
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
      setCustomDepartment("");
      setCustomVendor("");
      setCustomInstrument("");
      setSerialNumber("");
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
      } else {
        // Custom instrument — no FDA tests, start empty
        setTestsByInstrument((prev) => ({
          ...prev,
          [newInstr.id]: [],
        }));
      }
      toast({ title: "Instrument added" });
    },
    onError: (err: any) => {
      if (err.limitReached) {
        setUpgradeMessage(`You've reached the free plan limit of ${err.limit} ${err.type}. Upgrade to VeritaMap™ for unlimited instruments, analytes, and full intelligence features.`);
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

  // Copy test menu from another instrument (merge)
  const [isCopying, setIsCopying] = useState(false);

  async function handleCopyFrom(targetInstId: number, sourceInstId: number) {
    if (!mapId) return;
    setIsCopying(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/veritamap/maps/${mapId}/instruments/${targetInstId}/copy-from/${sourceInstId}`,
        { method: 'POST', headers: authHeaders() }
      );
      const data = await res.json();
      if (!res.ok) {
        toast({ title: 'Copy failed', description: data.error, variant: 'destructive' });
      } else {
        toast({ title: 'Test menu copied', description: data.message });
        // Refresh instruments to pick up the new tests
        qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}/instruments`] });
        qc.invalidateQueries({ queryKey: [`/api/veritamap/maps/${mapId}`] });
        // Clear local test state for this instrument so it reloads from server
        setTestsByInstrument((prev) => {
          const next = { ...prev };
          delete next[targetInstId];
          return next;
        });
      }
    } catch {
      toast({ title: 'Copy failed', description: 'Network error. Please try again.', variant: 'destructive' });
    } finally {
      setIsCopying(false);
    }
  }

  // Save all tests mutation
  const saveAllMutation = useMutation({
    mutationFn: async () => {
      for (const instr of instruments) {
        // Skip instruments where we have no local state - their tests were saved
        // directly to the server (e.g. via Copy Test Menu) and we should not overwrite them
        if (!(instr.id in testsByInstrument)) continue;
        const tests = testsByInstrument[instr.id];
        // Save all tests (active and inactive) so user can re-activate deselected tests later
        const res = await fetch(
          `${API_BASE}/api/veritamap/maps/${mapId}/instruments/${instr.id}/tests`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ tests }),
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
        setUpgradeMessage(`You've reached the free plan limit of ${err.limit} ${err.type}. Upgrade to VeritaMap™ for unlimited instruments, analytes, and full intelligence features.`);
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
    if (!selectedDepartment || isOtherDepartment || !cascade[selectedDepartment]) return [];
    return Object.keys(cascade[selectedDepartment]).sort();
  }, [selectedDepartment, cascade, isOtherDepartment]);

  // Instruments filtered by selected department + vendor
  const instrumentsForVendor = useMemo(() => {
    if (!selectedDepartment || !selectedVendor || isOtherDepartment || isOtherVendor) return [];
    return cascade[selectedDepartment]?.[selectedVendor] ?? [];
  }, [selectedDepartment, selectedVendor, cascade, isOtherDepartment, isOtherVendor]);

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

  function addCustomTest(instId: number, test: TestToggle) {
    setTestsByInstrument((prev) => ({
      ...prev,
      [instId]: [...(prev[instId] ?? []), test],
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

  // Reset cascade fields when department changes
  function handleDepartmentChange(v: string) {
    setSelectedDepartment(v);
    setSelectedVendor("");
    setInstrumentName("");
    setManualEntry(false);
    setManualInstrumentName("");
    setCustomDepartment("");
    setCustomVendor("");
    setCustomInstrument("");

    if (v === OTHER_DEPARTMENT_VALUE) {
      // "Other" department — skip to free-text
      return;
    }

    // Auto-select vendor if only one option (e.g., Manual Procedures)
    const vendors = cascade[v] ? Object.keys(cascade[v]) : [];
    if (vendors.length === 1) {
      setSelectedVendor(vendors[0]);
    }
    // Default role to Reference for Manual Procedures
    if (v === "Manual Procedures") {
      setRole("Primary");
    } else {
      setRole("Primary");
    }
  }

  function handleVendorChange(v: string) {
    setSelectedVendor(v);
    setInstrumentName("");
    setManualEntry(false);
    setManualInstrumentName("");
    setCustomInstrument("");
  }

  function handleInstrumentChange(v: string) {
    setInstrumentName(v);
    setCustomInstrument("");
  }

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
          Add every instrument your lab uses for each test, including primary AND backup
          analyzers. Even if two instruments are the same model, add them separately.
        </p>
        {limits?.isFree && (
          <div className="mb-4 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
            <Lock size={12} />
            <span>Instruments: <span className="font-semibold">{instruments.length}</span>/{limits.instrumentLimit} (free plan). <Link href="/veritamap" className="underline hover:no-underline">Upgrade for unlimited</Link></span>
          </div>
        )}

        {/* Add instrument form — 3-step cascade */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold mb-3">Add Instrument</h2>

            {/* Other Department write-in mode */}
            {isOtherDepartment ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {/* Department dropdown showing "Other" */}
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Department</label>
                    <Select value={selectedDepartment} onValueChange={handleDepartmentChange}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select department…" />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {departments.map((dept) => (
                          <SelectItem key={dept} value={dept} className="text-sm">{dept}</SelectItem>
                        ))}
                        <SelectItem value={OTHER_DEPARTMENT_VALUE} className="text-sm text-muted-foreground">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Custom department name */}
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Department Name</label>
                    <Input
                      className="h-9 text-sm"
                      placeholder="Type department name…"
                      value={customDepartment}
                      onChange={(e) => setCustomDepartment(e.target.value)}
                    />
                  </div>
                  {/* Custom instrument name */}
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Instrument Name</label>
                    <Input
                      className="h-9 text-sm"
                      placeholder="Type instrument name…"
                      value={customInstrument}
                      onChange={(e) => setCustomInstrument(e.target.value)}
                    />
                  </div>
                  {/* Role select */}
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Role</label>
                    <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r} className="text-sm">{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <Info size={12} className="shrink-0 mt-0.5" />
                  Use this for EUA tests, laboratory-developed tests (LDTs), or instruments not yet in our database.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Step 1: Department */}
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Department</label>
                  <Select value={selectedDepartment} onValueChange={handleDepartmentChange}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select department…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {departments.map((dept) => (
                        <SelectItem key={dept} value={dept} className="text-sm">{dept}</SelectItem>
                      ))}
                      <SelectItem value={OTHER_DEPARTMENT_VALUE} className="text-sm text-muted-foreground">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Step 2: Vendor (filtered) */}
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Vendor</label>
                  {isOtherVendor ? (
                    <Input
                      className="h-9 text-sm"
                      placeholder="Type vendor / manufacturer name…"
                      value={customVendor}
                      onChange={(e) => setCustomVendor(e.target.value)}
                    />
                  ) : (
                    <Select
                      value={selectedVendor}
                      onValueChange={handleVendorChange}
                      disabled={!selectedDepartment || manualEntry}
                    >
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder={selectedDepartment ? "Select vendor…" : "Select department first"} />
                      </SelectTrigger>
                      <SelectContent className="max-h-72">
                        {vendorsForDept.map((vendor) => (
                          <SelectItem key={vendor} value={vendor} className="text-sm">{vendor}</SelectItem>
                        ))}
                        {selectedDepartment && (
                          <SelectItem value={OTHER_VENDOR_VALUE} className="text-sm text-muted-foreground">Other / Not Listed</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {/* Step 3: Instrument (filtered) — or manual/other entry */}
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Instrument</label>
                  {manualEntry || isOtherVendor || isOtherInstrument ? (
                    <Input
                      className="h-9 text-sm"
                      placeholder="Type instrument name…"
                      value={manualEntry ? manualInstrumentName : customInstrument}
                      onChange={(e) => manualEntry ? setManualInstrumentName(e.target.value) : setCustomInstrument(e.target.value)}
                    />
                  ) : (
                    <Select
                      value={instrumentName}
                      onValueChange={handleInstrumentChange}
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
                        {selectedVendor && (
                          <SelectItem value={OTHER_INSTRUMENT_VALUE} className="text-sm text-muted-foreground">Other / Not Listed</SelectItem>
                        )}
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
            )}

            {/* Serial Number (optional, always visible) */}
            <div className="max-w-xs mt-3">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 block">Serial Number</label>
              <Input
                className="h-9 text-sm"
                placeholder="e.g. SN-2024-00142"
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground mt-1">Optional. Used for maintenance records and instrument inventory.</p>
            </div>

            {/* Helper note for Other instrument */}
            {(isOtherInstrument || isOtherVendor) && !isOtherDepartment && (
              <p className="text-[11px] text-muted-foreground flex items-start gap-1.5 mt-2">
                <Info size={12} className="shrink-0 mt-0.5" />
                Use this for EUA tests, laboratory-developed tests (LDTs), or instruments not yet in our database.
              </p>
            )}

            {/* Manual entry toggle + other vendor back link + Add button row */}
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-3">
                {isOtherVendor && !isOtherDepartment ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2"
                    onClick={() => {
                      setSelectedVendor("");
                      setCustomVendor("");
                      setCustomInstrument("");
                    }}
                  >
                    Back to vendor list
                  </button>
                ) : isOtherInstrument && !isOtherDepartment ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-primary underline underline-offset-2"
                    onClick={() => {
                      setInstrumentName("");
                      setCustomInstrument("");
                    }}
                  >
                    Back to instrument list
                  </button>
                ) : !isOtherDepartment ? (
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
                ) : null}
              </div>
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
              const isOther = !fdaInstr;
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
                      {isOther && (
                        <Badge className="text-[10px] px-1.5 py-0 border-0 bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                          Other
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {isOther
                        ? "Custom instrument - add tests in Step 2"
                        : `${fdaInstr?.testCount ?? 0} ${instr.category === "Manual Procedures" ? "tests" : "FDA-cleared tests"}`}
                    </span>
                    {instr.serial_number && (
                      <span className="text-[10px] text-muted-foreground">S/N: {instr.serial_number}</span>
                    )}
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
            No instruments added yet. Select one above to start.
          </div>
        )}

        {/* Tip */}
        <div className="p-3.5 rounded-lg bg-muted/50 border border-border text-sm text-muted-foreground mb-6">
          <FlaskConical size={13} className="inline mr-1.5 text-primary" />
          Tip: Add duplicate analyzers of the same model separately. The intelligence engine
          will identify correlation requirements between them.
        </div>

        {/* Next button */}
        <div className="flex justify-end">
          <Button
            disabled={instruments.length === 0}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={enterStep2}
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

      <StepIndicator step={2} roleGroups={presentRoleGroups} currentRole={currentRole} />
      <h1 className="text-2xl font-bold mt-2 mb-1">
        {currentRole} Instruments: Select Tests
      </h1>
      <p className="text-sm text-muted-foreground mb-2 max-w-2xl">
        {ROLE_DESCRIPTIONS[currentRole]}
      </p>
      {limits?.isFree && (
        <div className="mb-3 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <Lock size={12} />
          <span>Analytes: <span className="font-semibold">{totalActiveTests}</span>/{limits.analyteLimit} (free plan). <Link href="/veritamap" className="underline hover:no-underline">Upgrade for unlimited</Link></span>
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

      {/* Instruments for current role group */}
      <div className="space-y-3 mb-8">
        {currentRoleInstruments.map((instr) => (
          <InstrumentTestSection
            key={instr.id}
            instrument={instr}
            tests={testsByInstrument[instr.id] ?? []}
            mapId={mapId!}
            onToggle={(analyte) => toggleTest(instr.id, analyte)}
            onSelectAll={() => selectAll(instr.id)}
            onDeselectAll={() => deselectAll(instr.id)}
            onAddCustomTest={(test) => addCustomTest(instr.id, test)}
            otherInstruments={instruments
              .filter(i => i.id !== instr.id)
              .map(i => ({
                id: i.id,
                instrument_name: i.instrument_name,
                testCount: (testsByInstrument[i.id] ?? []).length,
              }))}
            roleContext={currentRole}
            onCopyFrom={(sourceInstId) => handleCopyFrom(instr.id, sourceInstId)}
            isCopying={isCopying}
          />
        ))}
      </div>

      {/* Next / Build button */}
      <div className="flex items-center justify-between pt-6 border-t border-border">
        <div className="text-sm text-muted-foreground space-y-0.5">
          <p>{totalActiveTests} test{totalActiveTests !== 1 ? "s" : ""} active across all instruments.</p>
          {!isLastRoleGroup && (
            <p className="text-xs">Next: configure your {presentRoleGroups[presentRoleGroups.indexOf(currentRole) + 1]} instruments.</p>
          )}
        </div>
        <div className="flex gap-2">
          {presentRoleGroups.indexOf(currentRole) > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                const idx = presentRoleGroups.indexOf(currentRole);
                setCurrentRole(presentRoleGroups[idx - 1]);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              <ArrowLeft size={14} className="mr-1.5" />
              Back to {presentRoleGroups[presentRoleGroups.indexOf(currentRole) - 1]}s
            </Button>
          )}
          <Button
            onClick={advanceRole}
            disabled={saveAllMutation.isPending}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saveAllMutation.isPending ? "Building…" : isLastRoleGroup ? "Build My Map" : `Next: ${presentRoleGroups[presentRoleGroups.indexOf(currentRole) + 1]}s`}
            {!saveAllMutation.isPending && <ArrowRight size={14} className="ml-1.5" />}
          </Button>
        </div>
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
