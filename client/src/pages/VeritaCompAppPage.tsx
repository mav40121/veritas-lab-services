import { useState, useEffect } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthContext";
import { useIsReadOnly } from "@/components/SubscriptionBanner";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Users,
  ClipboardCheck,
  Lock,
  FileDown,
  FlaskConical,
  Stethoscope,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  UserPlus,
  Settings,
  List,
  BarChart3,
  X,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface Program {
  id: number;
  user_id: number;
  name: string;
  department: string;
  type: "technical" | "waived" | "nontechnical";
  map_id: number | null;
  created_at: string;
  updated_at: string;
  employeeCount: number;
  assessmentCount: number;
  methodGroups: MethodGroup[];
  checklistItems: ChecklistItem[];
}

interface MethodGroup {
  id: number;
  program_id: number;
  name: string;
  instruments: string;
  analytes: string;
  notes: string | null;
}

interface ChecklistItem {
  id: number;
  program_id: number;
  label: string;
  description: string;
  sort_order: number;
}

interface Employee {
  id: number;
  user_id: number;
  name: string;
  title: string;
  hire_date: string | null;
  lis_initials: string | null;
  status: string;
  created_at: string;
}

interface Assessment {
  id: number;
  program_id: number;
  employee_id: number;
  assessment_type: string;
  assessment_date: string;
  evaluator_name: string | null;
  evaluator_title: string | null;
  evaluator_initials: string | null;
  competency_type: string;
  status: string;
  remediation_plan: string | null;
  employee_acknowledged: number;
  supervisor_acknowledged: number;
  created_at: string;
  employee_name: string;
  employee_title: string;
  employee_hire_date: string | null;
  employee_lis_initials: string | null;
  items: AssessmentItem[];
}

interface AssessmentItem {
  id: number;
  assessment_id: number;
  method_number: number | null;
  method_group_id: number | null;
  item_label: string | null;
  item_description: string | null;
  evidence: string | null;
  date_met: string | null;
  employee_initials: string | null;
  supervisor_initials: string | null;
  passed: number;
}

interface MapInstrument {
  id: number;
  instrument_name: string;
  role: string;
  category: string;
  tests: { analyte: string; specialty: string; complexity: string }[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEPARTMENTS = [
  "Chemistry", "Hematology", "Coagulation", "Urinalysis", "Blood Bank",
  "Microbiology", "Molecular", "Phlebotomy", "Specimen Processing",
  "Point of Care", "Histology", "Cytology", "Flow Cytometry",
  "Manual Procedures", "Other",
];

const CLIA_METHODS = [
  "Direct observations of routine patient test performance (including specimen collection/handling/processing/testing)",
  "Monitoring recording and reporting of test results (including critical result reporting)",
  "Review of intermediate results, QC records, PT results, and preventive maintenance records",
  "Direct observation of instrument maintenance function checks and calibration",
  "Test performance (blind specimens, internal blind samples, external PT samples)",
  "Evaluation of problem-solving skills",
];

const WAIVED_METHODS = [
  "Blind specimen testing",
  "Periodic observation by supervisor",
  "Monitoring of QC performance",
  "Written test specific to the test assessed",
];

const DEFAULT_CHECKLISTS: Record<string, { label: string; description: string }[]> = {
  Chemistry: [
    { label: "A", description: "Tour Department" },
    { label: "B", description: "Policies and Procedures" },
    { label: "C", description: "Specimen collection and test menu" },
    { label: "D", description: "Analyzer operation, commands, and prompts" },
    { label: "E", description: "Reagent management" },
    { label: "F", description: "Maintenance" },
    { label: "G", description: "Quality Control" },
    { label: "H", description: "Calibration" },
    { label: "I", description: "Troubleshooting" },
    { label: "J", description: "Releasing results / LIS" },
    { label: "K", description: "Downtime operations" },
    { label: "L", description: "External data retention" },
    { label: "M", description: "Complete manufacturer instrument checklist" },
  ],
  Phlebotomy: [
    { label: "A", description: "Tube selection" },
    { label: "B", description: "Policy and procedure review" },
    { label: "C", description: "Vein selection" },
    { label: "D", description: "Order of draw" },
    { label: "E", description: "Heel sticks" },
    { label: "F", description: "Finger sticks" },
    { label: "G", description: "Blood bank samples" },
    { label: "H", description: "Blood cultures" },
    { label: "I", description: "Therapeutic phlebotomy" },
    { label: "J", description: "Adverse reactions" },
  ],
  Hematology: [
    { label: "A", description: "Tour Department" },
    { label: "B", description: "Policies and Procedures" },
    { label: "C", description: "CBC/Differential interpretation" },
    { label: "D", description: "Cell counter operation and troubleshooting" },
    { label: "E", description: "Manual differential" },
    { label: "F", description: "Reagent management" },
    { label: "G", description: "Maintenance" },
    { label: "H", description: "Quality Control" },
    { label: "I", description: "Calibration" },
    { label: "J", description: "Troubleshooting" },
    { label: "K", description: "Releasing results / LIS" },
    { label: "L", description: "Downtime operations" },
  ],
  Microbiology: [
    { label: "A", description: "Tour Department" },
    { label: "B", description: "Policies and Procedures" },
    { label: "C", description: "Gram stain technique and interpretation" },
    { label: "D", description: "Culture techniques (plating, streaking, isolation)" },
    { label: "E", description: "Organism identification" },
    { label: "F", description: "Antimicrobial susceptibility testing" },
    { label: "G", description: "Biosafety and PPE" },
    { label: "H", description: "Quality Control" },
    { label: "I", description: "Maintenance" },
    { label: "J", description: "Releasing results / LIS" },
    { label: "K", description: "Downtime operations" },
  ],
};

// ── Helpers ─────────────────────────────────────────────────────────────

function typeIcon(type: string) {
  if (type === "technical") return <FlaskConical size={14} />;
  if (type === "waived") return <Stethoscope size={14} />;
  return <BookOpen size={14} />;
}

function typeBadgeColor(type: string) {
  if (type === "technical") return "bg-blue-500/10 text-blue-600 border-blue-500/20";
  if (type === "waived") return "bg-emerald-500/10 text-emerald-600 border-emerald-500/20";
  return "bg-amber-500/10 text-amber-600 border-amber-500/20";
}

function typeLabel(type: string) {
  if (type === "technical") return "Technical";
  if (type === "waived") return "Waived";
  return "Non-Technical";
}

// ── Main Component ──────────────────────────────────────────────────────

export default function VeritaCompAppPage() {
  const { user, isLoggedIn } = useAuth();
  const [location, navigate] = useLocation();
  const params = useParams<{ programId?: string }>();
  const programId = params?.programId ? parseInt(params.programId) : null;

  const hasPlanAccess =
    user?.plan === "annual" ||
    user?.plan === "professional" ||
    user?.plan === "lab" ||
    user?.plan === "complete" ||
    user?.plan === "veritamap" ||
    user?.plan === "veritascan" ||
    user?.plan === "veritacomp";

  if (!isLoggedIn) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-4">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Sign in to access VeritaComp{"\u2122"}</h1>
          <p className="text-muted-foreground text-sm mb-6">
            VeritaComp{"\u2122"} requires an account. Sign in to continue.
          </p>
          <Button asChild><Link href="/login">Sign In</Link></Button>
        </div>
      </div>
    );
  }

  if (!hasPlanAccess) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-950/30 mb-4">
            <Users className="h-7 w-7 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold mb-2">VeritaComp{"\u2122"} Access Required</h1>
          <p className="text-muted-foreground text-sm mb-6">
            Your current plan doesn't include VeritaComp{"\u2122"}. Upgrade to access competency assessment management.
          </p>
          <Button asChild><Link href="/veritacomp">View Plans</Link></Button>
        </div>
      </div>
    );
  }

  if (programId) {
    return (
      <>
        <WipBanner />
        <ProgramDetailView programId={programId} />
      </>
    );
  }

  return (
    <>
      <WipBanner />
      <ProgramListView />
    </>
  );
}

// ── WIP Banner (dismissible) ──────────────────────────────────────────

function WipBanner() {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem("veritacomp-wip-dismissed") === "1"; } catch { return false; }
  });

  if (dismissed) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-400/50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800 dark:text-amber-200 leading-relaxed flex-1">
          <span className="font-semibold">Work in Progress:</span> VeritaComp{"\u2122"} is actively being developed. You may encounter incomplete features or changes. Your data is safe and saved.
        </p>
        <button
          onClick={() => { setDismissed(true); try { sessionStorage.setItem("veritacomp-wip-dismissed", "1"); } catch {} }}
          className="text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200 shrink-0 mt-0.5"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

// ── Program List View ──────────────────────────────────────────────────

function ProgramListView() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const readOnly = useIsReadOnly();
  const [wizardOpen, setWizardOpen] = useState(false);

  const { data: programs, isLoading, error } = useQuery<Program[]>({
    queryKey: ["/api/competency/programs"],
  });

  const deleteProgram = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API_BASE}/api/competency/programs/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/competency/programs"] }),
  });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold tracking-tight">VeritaComp{"\u2122"}</h1>
            <Badge variant="outline" className="text-xs bg-primary/5 text-primary border-primary/20">Beta</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            TJC/CLIA/CAP Competency Assessment Management
          </p>
        </div>
        <Button className="shrink-0" onClick={() => setWizardOpen(true)} disabled={readOnly} title={readOnly ? "Resubscribe to add new records" : undefined}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Program
        </Button>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map(n => <div key={n} className="h-28 rounded-xl bg-muted/60 animate-pulse" />)}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load programs. Please refresh and try again.
        </div>
      )}

      {!isLoading && !error && programs?.length === 0 && (
        <div className="text-center py-16 rounded-xl border border-dashed border-border">
          <Users className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="font-semibold mb-1">No competency programs yet</p>
          <p className="text-sm text-muted-foreground mb-5">
            Create your first competency program to get started.
          </p>
          <Button onClick={() => setWizardOpen(true)} disabled={readOnly} title={readOnly ? "Resubscribe to add new records" : undefined}>
            <Plus className="h-4 w-4 mr-1.5" />
            New Program
          </Button>
        </div>
      )}

      {!isLoading && !error && programs && programs.length > 0 && (
        <div className="space-y-3">
          {programs.map(p => (
            <Card key={p.id} className="group hover:border-primary/30 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="font-semibold text-sm leading-tight truncate">{p.name}</span>
                      <Badge variant="outline" className={`text-[10px] ${typeBadgeColor(p.type)}`}>
                        {typeIcon(p.type)}
                        <span className="ml-1">{typeLabel(p.type)}</span>
                      </Badge>
                      <span className="text-xs text-muted-foreground">{p.department}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users size={12} />
                        {p.employeeCount} employee{p.employeeCount !== 1 ? "s" : ""}
                      </span>
                      <span className="flex items-center gap-1">
                        <ClipboardCheck size={12} />
                        {p.assessmentCount} assessment{p.assessmentCount !== 1 ? "s" : ""}
                      </span>
                      {p.map_id && (
                        <span className="flex items-center gap-1 text-primary">
                          <FlaskConical size={12} />
                          Linked to VeritaMap
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <DeleteConfirmDialog
                      name={p.name}
                      onDelete={() => deleteProgram.mutate(p.id)}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate(`/veritacomp-app/${p.id}`)}
                      className="gap-1"
                    >
                      Open
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {wizardOpen && (
        <NewProgramWizard
          onClose={() => setWizardOpen(false)}
          onCreated={(id) => {
            setWizardOpen(false);
            qc.invalidateQueries({ queryKey: ["/api/competency/programs"] });
            navigate(`/veritacomp-app/${id}`);
          }}
        />
      )}
    </div>
  );
}

// ── Delete Confirm ──────────────────────────────────────────────────────

function DeleteConfirmDialog({ name, onDelete }: { name: string; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0" title="Delete">
          <Trash2 className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Delete Program?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Are you sure you want to delete <span className="font-semibold text-foreground">"{name}"</span>? All assessments and data will be permanently removed.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" size="sm" onClick={() => { onDelete(); setOpen(false); }}>Delete</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── New Program Wizard ──────────────────────────────────────────────────

function NewProgramWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("Chemistry");
  const [type, setType] = useState<"technical" | "waived" | "nontechnical">("technical");
  const [mapId, setMapId] = useState<number | null>(null);
  const [methodGroups, setMethodGroups] = useState<{ name: string; instruments: string[]; analytes: string[] }[]>([]);
  const [checklistItems, setChecklistItems] = useState<{ label: string; description: string }[]>([]);
  const [creating, setCreating] = useState(false);

  // Fetch user's VeritaMap maps
  const { data: maps } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/veritamap/maps"],
    enabled: type === "technical" || type === "waived",
  });

  // Fetch instruments from selected map
  const { data: mapInstruments } = useQuery<MapInstrument[]>({
    queryKey: ["/api/competency/map-instruments", mapId],
    enabled: !!mapId,
  });

  // Auto-suggest method groups from map instruments
  useEffect(() => {
    if (mapInstruments && mapInstruments.length > 0 && type === "technical") {
      const grouped: Record<string, { instruments: string[]; analytes: string[] }> = {};
      for (const inst of mapInstruments) {
        const key = `${inst.category} \u2014 ${inst.instrument_name}`;
        if (!grouped[key]) grouped[key] = { instruments: [], analytes: [] };
        grouped[key].instruments.push(inst.instrument_name);
        for (const t of inst.tests) {
          if (!grouped[key].analytes.includes(t.analyte)) {
            grouped[key].analytes.push(t.analyte);
          }
        }
      }
      setMethodGroups(Object.entries(grouped).map(([name, data]) => ({
        name,
        instruments: data.instruments,
        analytes: data.analytes,
      })));
    }
  }, [mapInstruments, type]);

  // Auto-populate checklist for nontechnical
  useEffect(() => {
    if (type === "nontechnical") {
      const defaults = DEFAULT_CHECKLISTS[department] || DEFAULT_CHECKLISTS["Chemistry"] || [];
      setChecklistItems(defaults);
    }
  }, [type, department]);

  const totalSteps = type === "technical" || type === "nontechnical" ? 3 : 2;

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/competency/programs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: name.trim(),
          department,
          type,
          mapId,
          methodGroups: type === "technical" ? methodGroups : undefined,
          checklistItems: type === "nontechnical" ? checklistItems : undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to create program");
      const data = await res.json();
      onCreated(data.id);
    } catch {
      setCreating(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Competency Program (Step {step}/{totalSteps})</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Program Name</label>
              <Input
                autoFocus
                placeholder="e.g., 2026 Annual Competency \u2014 Chemistry"
                value={name}
                onChange={e => setName(e.target.value)}
                maxLength={200}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Department</label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENTS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Competency Type</label>
              <div className="grid grid-cols-3 gap-2">
                {(["technical", "waived", "nontechnical"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`border rounded-lg p-3 text-left transition-colors ${type === t ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      {typeIcon(t)}
                      <span className="text-xs font-semibold">{typeLabel(t)}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {t === "technical" ? "6 CLIA methods \u00D7 method groups" : t === "waived" ? "2 of 4 methods per test" : "Departmental checklist"}
                    </p>
                  </button>
                ))}
              </div>
            </div>
            {(type === "technical" || type === "waived") && maps && maps.length > 0 && (
              <div>
                <label className="text-sm font-medium mb-1 block">Link to VeritaMap{"\u2122"} (optional)</label>
                <Select value={mapId ? String(mapId) : "none"} onValueChange={v => setMapId(v === "none" ? null : parseInt(v))}>
                  <SelectTrigger><SelectValue placeholder="Select a map..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No map</SelectItem>
                    {maps.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Import instruments and auto-suggest method groups from your test menu map.</p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" disabled={!name.trim()} onClick={() => setStep(2)}>
                {totalSteps === 2 && type === "waived" ? "Create Program" : "Next"}
                <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && type === "technical" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Define method groups. Each group represents instruments/analytes that share the same operator workflow.
              {mapId ? " Groups have been auto-suggested from your VeritaMap." : " Add groups manually."}
            </p>
            {methodGroups.map((g, i) => (
              <div key={i} className="border border-border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Input
                    value={g.name}
                    onChange={e => {
                      const updated = [...methodGroups];
                      updated[i] = { ...updated[i], name: e.target.value };
                      setMethodGroups(updated);
                    }}
                    className="text-sm"
                    placeholder="Method group name"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => setMethodGroups(methodGroups.filter((_, j) => j !== i))}
                  >
                    <X size={14} />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {g.instruments.length} instrument(s) {"\u00B7"} {g.analytes.length} analyte(s)
                  {g.analytes.length > 0 && `: ${g.analytes.slice(0, 5).join(", ")}${g.analytes.length > 5 ? "..." : ""}`}
                </p>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMethodGroups([...methodGroups, { name: "", instruments: [], analytes: [] }])}
            >
              <Plus size={13} className="mr-1" />
              Add Method Group
            </Button>
            <div className="flex justify-between pt-2">
              <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
              </Button>
              <Button size="sm" disabled={methodGroups.length === 0} onClick={() => setStep(3)}>
                Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && type === "nontechnical" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Customize the checklist items for this department. Items are pre-populated based on common {department} competency areas.
            </p>
            {checklistItems.map((item, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs font-bold text-muted-foreground w-6 shrink-0">{item.label}.</span>
                <Input
                  value={item.description}
                  onChange={e => {
                    const updated = [...checklistItems];
                    updated[i] = { ...updated[i], description: e.target.value };
                    setChecklistItems(updated);
                  }}
                  className="text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    const updated = checklistItems.filter((_, j) => j !== i);
                    // Re-label
                    setChecklistItems(updated.map((item, idx) => ({ ...item, label: String.fromCharCode(65 + idx) })));
                  }}
                >
                  <X size={14} />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChecklistItems([
                ...checklistItems,
                { label: String.fromCharCode(65 + checklistItems.length), description: "" },
              ])}
            >
              <Plus size={13} className="mr-1" />
              Add Item
            </Button>
            <div className="flex justify-between pt-2">
              <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
              </Button>
              <Button size="sm" disabled={checklistItems.length === 0} onClick={() => setStep(3)}>
                Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && type === "waived" && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Your waived testing competency program is ready to create. Waived test instruments will be managed within the program.
            </p>
            <div className="bg-muted/30 border border-border rounded-lg p-4">
              <div className="text-sm font-semibold mb-2">Program Summary</div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div><strong>Name:</strong> {name}</div>
                <div><strong>Department:</strong> {department}</div>
                <div><strong>Type:</strong> Waived Testing Competency (WT.03.01.01)</div>
                {mapId && <div><strong>Linked Map:</strong> ID {mapId}</div>}
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="outline" size="sm" onClick={() => setStep(1)}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
              </Button>
              <Button size="sm" disabled={creating} onClick={handleCreate}>
                {creating ? "Creating..." : "Create Program"}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-muted/30 border border-border rounded-lg p-4">
              <div className="text-sm font-semibold mb-2">Program Summary</div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div><strong>Name:</strong> {name}</div>
                <div><strong>Department:</strong> {department}</div>
                <div><strong>Type:</strong> {typeLabel(type)} Competency</div>
                {type === "technical" && <div><strong>Method Groups:</strong> {methodGroups.length}</div>}
                {type === "nontechnical" && <div><strong>Checklist Items:</strong> {checklistItems.length}</div>}
                {mapId && <div><strong>Linked VeritaMap:</strong> ID {mapId}</div>}
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="outline" size="sm" onClick={() => setStep(2)}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
              </Button>
              <Button size="sm" disabled={creating} onClick={handleCreate}>
                {creating ? "Creating..." : "Create Program"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Program Detail View ────────────────────────────────────────────────

function ProgramDetailView({ programId }: { programId: number }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"overview" | "assessments" | "employees" | "settings">("overview");
  const [newAssessmentOpen, setNewAssessmentOpen] = useState(false);

  const { data: program, isLoading } = useQuery<Program & { employees: Employee[]; assessments: Assessment[] }>({
    queryKey: ["/api/competency/programs", programId],
  });

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="h-64 rounded-xl bg-muted/60 animate-pulse" />
      </div>
    );
  }

  if (!program) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 text-center">
        <p className="text-muted-foreground">Program not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate("/veritacomp-app")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back to Programs
        </Button>
      </div>
    );
  }

  const tabs = [
    { key: "overview", label: "Overview", icon: BarChart3 },
    { key: "assessments", label: "Assessments", icon: ClipboardCheck },
    { key: "employees", label: "Employees", icon: Users },
    { key: "settings", label: "Settings", icon: Settings },
  ] as const;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Back + Header */}
      <Button variant="ghost" size="sm" className="mb-4 -ml-2" onClick={() => navigate("/veritacomp-app")}>
        <ChevronLeft className="h-4 w-4 mr-1" /> All Programs
      </Button>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">{program.name}</h1>
            <Badge variant="outline" className={`text-xs ${typeBadgeColor(program.type)}`}>
              {typeIcon(program.type)}
              <span className="ml-1">{typeLabel(program.type)}</span>
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{program.department} Department</p>
        </div>
        <Button onClick={() => setNewAssessmentOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Assessment
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border mb-6 gap-0">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && <OverviewTab program={program} />}
      {activeTab === "assessments" && <AssessmentsTab program={program} onNewAssessment={() => setNewAssessmentOpen(true)} />}
      {activeTab === "employees" && <EmployeesTab employees={program.employees || []} />}
      {activeTab === "settings" && <SettingsTab program={program} />}

      {newAssessmentOpen && (
        <NewAssessmentDialog
          program={program}
          employees={program.employees || []}
          onClose={() => setNewAssessmentOpen(false)}
          onCreated={() => {
            setNewAssessmentOpen(false);
            qc.invalidateQueries({ queryKey: ["/api/competency/programs", programId] });
          }}
        />
      )}
    </div>
  );
}

// ── Overview Tab ───────────────────────────────────────────────────────

function OverviewTab({ program }: { program: Program & { employees: Employee[]; assessments: Assessment[] } }) {
  const employees = program.employees || [];
  const assessments = program.assessments || [];
  const activeEmployees = employees.filter(e => e.status === "active");

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Employees", value: activeEmployees.length, icon: Users },
          { label: "Assessments", value: assessments.length, icon: ClipboardCheck },
          { label: "Passing", value: assessments.filter(a => a.status === "pass").length, icon: CheckCircle2 },
          { label: "Remediation", value: assessments.filter(a => a.status === "remediation" || a.status === "fail").length, icon: AlertTriangle },
        ].map((s, i) => (
          <div key={i} className="border border-border rounded-lg p-3 bg-card">
            <div className="flex items-center gap-2 mb-1">
              <s.icon size={14} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
            <div className="text-2xl font-bold">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Program info */}
      <div className="border border-border rounded-lg p-4 bg-card">
        <div className="text-sm font-semibold mb-3">Program Details</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div><span className="text-xs text-muted-foreground block">Type</span>{typeLabel(program.type)} Competency</div>
          <div><span className="text-xs text-muted-foreground block">Department</span>{program.department}</div>
          <div><span className="text-xs text-muted-foreground block">Created</span>{new Date(program.created_at).toLocaleDateString()}</div>
          {program.type === "technical" && (
            <div><span className="text-xs text-muted-foreground block">Method Groups</span>{program.methodGroups?.length || 0}</div>
          )}
          {program.type === "nontechnical" && (
            <div><span className="text-xs text-muted-foreground block">Checklist Items</span>{program.checklistItems?.length || 0}</div>
          )}
          {program.map_id && (
            <div>
              <span className="text-xs text-muted-foreground block">Linked VeritaMap</span>
              <Link href={`/veritamap-app/${program.map_id}`} className="text-primary hover:underline">Map #{program.map_id}</Link>
            </div>
          )}
        </div>
      </div>

      {/* Employee roster */}
      <div className="border border-border rounded-lg p-4 bg-card">
        <div className="text-sm font-semibold mb-3">Employee Roster</div>
        {activeEmployees.length === 0 ? (
          <p className="text-xs text-muted-foreground">No employees added yet. Go to the Employees tab to add staff.</p>
        ) : (
          <div className="space-y-2">
            {activeEmployees.map(emp => {
              const empAssessments = assessments.filter(a => a.employee_id === emp.id);
              const latest = empAssessments[0];
              const statusColor = !latest ? "text-muted-foreground bg-muted" :
                latest.status === "pass" ? "text-emerald-600 bg-emerald-500/10" :
                "text-red-600 bg-red-500/10";
              const statusLabel = !latest ? "Not assessed" :
                latest.status === "pass" ? "Current" :
                latest.status === "fail" ? "Failed" : "Remediation";
              return (
                <div key={emp.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                  <div>
                    <span className="text-sm font-medium">{emp.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{emp.title}</span>
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${statusColor}`}>{statusLabel}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Method groups (technical only) */}
      {program.type === "technical" && program.methodGroups && program.methodGroups.length > 0 && (
        <div className="border border-border rounded-lg p-4 bg-card">
          <div className="text-sm font-semibold mb-3">Method Groups</div>
          <div className="space-y-2">
            {program.methodGroups.map(g => {
              const instruments = JSON.parse(g.instruments || "[]");
              const analytes = JSON.parse(g.analytes || "[]");
              return (
                <div key={g.id} className="border border-border rounded-lg p-3">
                  <div className="font-medium text-sm">{g.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    <strong>Instruments:</strong> {instruments.join(", ") || "None"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    <strong>Analytes:</strong> {analytes.slice(0, 10).join(", ")}{analytes.length > 10 ? ` +${analytes.length - 10} more` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Assessments Tab ──────────────────────────────────────────────────

function AssessmentsTab({ program, onNewAssessment }: { program: Program & { assessments: Assessment[] }; onNewAssessment: () => void }) {
  const qc = useQueryClient();
  const assessments = program.assessments || [];

  const downloadPdf = async (assessmentId: number) => {
    const res = await fetch(`${API_BASE}/api/competency/pdf/${assessmentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `VeritaComp_Assessment_${assessmentId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteAssessment = async (id: number) => {
    await fetch(`${API_BASE}/api/competency/assessments/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    qc.invalidateQueries({ queryKey: ["/api/competency/programs", program.id] });
  };

  if (assessments.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-border rounded-xl">
        <ClipboardCheck className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
        <p className="font-semibold mb-1">No assessments yet</p>
        <p className="text-sm text-muted-foreground mb-5">Create your first competency assessment.</p>
        <Button onClick={onNewAssessment}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Assessment
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {assessments.map(a => {
        const passColor = a.status === "pass" ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" :
          a.status === "fail" ? "text-red-600 bg-red-500/10 border-red-500/20" :
          "text-amber-600 bg-amber-500/10 border-amber-500/20";
        const passLabel = a.status === "pass" ? "Pass" : a.status === "fail" ? "Fail" : "Remediation";
        return (
          <Card key={a.id} className="hover:border-primary/30 transition-colors">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-semibold text-sm">{a.employee_name}</span>
                    <Badge variant="outline" className={`text-[10px] ${passColor}`}>{passLabel}</Badge>
                    <span className="text-xs text-muted-foreground">{a.assessment_type.replace("_", " ")}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {a.assessment_date} {"\u00B7"} Evaluator: {a.evaluator_name || "N/A"} {"\u00B7"} {a.items?.length || 0} item(s)
                  </div>
                  {a.remediation_plan && (
                    <div className="text-xs text-amber-600 mt-1">Remediation: {a.remediation_plan}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" title="Download PDF" onClick={() => downloadPdf(a.id)}>
                    <FileDown className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Delete" onClick={() => deleteAssessment(a.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ── Employees Tab ──────────────────────────────────────────────────────

function EmployeesTab({ employees }: { employees: Employee[] }) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [lisInitials, setLisInitials] = useState("");

  const createEmployee = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/competency/employees`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ name: name.trim(), title, hireDate: hireDate || null, lisInitials: lisInitials || null }),
      });
      if (!res.ok) throw new Error("Failed to add employee");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/competency/programs"] });
      qc.invalidateQueries({ queryKey: ["/api/competency/employees"] });
      setAddOpen(false);
      setName("");
      setTitle("");
      setHireDate("");
      setLisInitials("");
    },
  });

  const deactivate = async (id: number) => {
    await fetch(`${API_BASE}/api/competency/employees/${id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    qc.invalidateQueries({ queryKey: ["/api/competency/programs"] });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {employees.filter(e => e.status === "active").length} active employee(s)
        </p>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><UserPlus className="h-4 w-4 mr-1.5" />Add Employee</Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Add Employee</DialogTitle></DialogHeader>
            <form
              onSubmit={e => { e.preventDefault(); if (name.trim()) createEmployee.mutate(); }}
              className="space-y-3"
            >
              <Input autoFocus placeholder="Full name" value={name} onChange={e => setName(e.target.value)} />
              <Input placeholder="Title (e.g., Medical Laboratory Scientist)" value={title} onChange={e => setTitle(e.target.value)} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Hire Date</label>
                  <Input type="date" value={hireDate} onChange={e => setHireDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">LIS Initials</label>
                  <Input placeholder="MV" value={lisInitials} onChange={e => setLisInitials(e.target.value)} maxLength={10} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button type="submit" size="sm" disabled={!name.trim() || createEmployee.isPending}>
                  {createEmployee.isPending ? "Adding..." : "Add"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {employees.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <Users className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="font-semibold mb-1">No employees yet</p>
          <p className="text-sm text-muted-foreground mb-5">Add employees to begin competency assessments.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="text-left p-3 font-medium text-xs">Name</th>
                <th className="text-left p-3 font-medium text-xs">Title</th>
                <th className="text-left p-3 font-medium text-xs">Hire Date</th>
                <th className="text-left p-3 font-medium text-xs">LIS</th>
                <th className="text-left p-3 font-medium text-xs">Status</th>
                <th className="p-3 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.id} className="border-b border-border last:border-0">
                  <td className="p-3 font-medium">{emp.name}</td>
                  <td className="p-3 text-muted-foreground">{emp.title || "\u2014"}</td>
                  <td className="p-3 text-muted-foreground">{emp.hire_date || "\u2014"}</td>
                  <td className="p-3 text-muted-foreground">{emp.lis_initials || "\u2014"}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={`text-[10px] ${emp.status === "active" ? "text-emerald-600 bg-emerald-500/10" : "text-muted-foreground bg-muted"}`}>
                      {emp.status}
                    </Badge>
                  </td>
                  <td className="p-3">
                    {emp.status === "active" && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => deactivate(emp.id)}>
                        <X size={14} />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Settings Tab ──────────────────────────────────────────────────────

function SettingsTab({ program }: { program: Program }) {
  const qc = useQueryClient();
  const [name, setName] = useState(program.name);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await fetch(`${API_BASE}/api/competency/programs/${program.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ name }),
    });
    qc.invalidateQueries({ queryKey: ["/api/competency/programs", program.id] });
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="border border-border rounded-lg p-4 bg-card">
        <div className="text-sm font-semibold mb-3">Program Settings</div>
        <div className="space-y-3 max-w-md">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Program Name</label>
            <Input value={name} onChange={e => setName(e.target.value)} />
          </div>
          <Button size="sm" onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-lg p-4 bg-card">
        <div className="text-sm font-semibold mb-2">Program Information</div>
        <div className="text-xs text-muted-foreground space-y-1">
          <div>Type: {typeLabel(program.type)}</div>
          <div>Department: {program.department}</div>
          <div>Created: {new Date(program.created_at).toLocaleString()}</div>
          <div>Last Updated: {new Date(program.updated_at).toLocaleString()}</div>
        </div>
      </div>
    </div>
  );
}

// ── New Assessment Dialog ──────────────────────────────────────────────

function NewAssessmentDialog({
  program,
  employees,
  onClose,
  onCreated,
}: {
  program: Program;
  employees: Employee[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const activeEmployees = employees.filter(e => e.status === "active");
  const [employeeId, setEmployeeId] = useState<number | null>(activeEmployees[0]?.id || null);
  const [assessmentType, setAssessmentType] = useState("initial");
  const [assessmentDate, setAssessmentDate] = useState(new Date().toISOString().split("T")[0]);
  const [evaluatorName, setEvaluatorName] = useState("");
  const [evaluatorTitle, setEvaluatorTitle] = useState("");
  const [evaluatorInitials, setEvaluatorInitials] = useState("");
  const [status, setStatus] = useState("pass");
  const [remediationPlan, setRemediationPlan] = useState("");
  const [employeeAck, setEmployeeAck] = useState(false);
  const [supervisorAck, setSupervisorAck] = useState(false);
  const [creating, setCreating] = useState(false);

  // Items state based on type
  const [techItems, setTechItems] = useState<Record<string, { evidence: string; passed: boolean; initials: string; date: string; specimen: string }>>({});
  const [waivedMethods, setWaivedMethods] = useState<number[]>([1, 2]);
  const [waivedItems, setWaivedItems] = useState<Record<number, { evidence: string; passed: boolean; initials: string; date: string; specimen: string }>>({});
  const [nonTechItems, setNonTechItems] = useState<Record<string, { dateMet: string; empInitials: string; supInitials: string; specimen: string }>>({});

  // Initialize nontechnical items
  useEffect(() => {
    if (program.type === "nontechnical" && program.checklistItems) {
      const init: Record<string, { dateMet: string; empInitials: string; supInitials: string; specimen: string }> = {};
      for (const item of program.checklistItems) {
        init[item.label] = { dateMet: "", empInitials: "", supInitials: "", specimen: "" };
      }
      setNonTechItems(init);
    }
  }, [program]);

  async function handleCreate() {
    if (!employeeId) return;
    setCreating(true);

    const items: any[] = [];

    if (program.type === "technical") {
      for (const mg of (program.methodGroups || [])) {
        for (let m = 1; m <= 6; m++) {
          const key = `${m}-${mg.id}`;
          const cell = techItems[key] || { evidence: "", passed: false, initials: "", date: "", specimen: "" };
          items.push({
            methodNumber: m,
            methodGroupId: mg.id,
            evidence: cell.evidence,
            dateMet: cell.date || assessmentDate,
            supervisorInitials: cell.initials || evaluatorInitials,
            specimenInfo: cell.specimen,
            passed: cell.passed,
          });
        }
      }
    } else if (program.type === "waived") {
      for (const methodNum of waivedMethods) {
        const cell = waivedItems[methodNum] || { evidence: "", passed: false, initials: "", date: "", specimen: "" };
        items.push({
          methodNumber: methodNum,
          evidence: cell.evidence,
          dateMet: cell.date || assessmentDate,
          supervisorInitials: cell.initials || evaluatorInitials,
          specimenInfo: cell.specimen,
          passed: cell.passed,
        });
      }
    } else {
      for (const item of (program.checklistItems || [])) {
        const cell = nonTechItems[item.label] || { dateMet: "", empInitials: "", supInitials: "", specimen: "" };
        items.push({
          itemLabel: item.label,
          itemDescription: item.description,
          dateMet: cell.dateMet || assessmentDate,
          employeeInitials: cell.empInitials,
          supervisorInitials: cell.supInitials || evaluatorInitials,
          specimenInfo: cell.specimen,
          passed: !!(cell.dateMet && cell.empInitials && cell.supInitials),
        });
      }
    }

    try {
      const res = await fetch(`${API_BASE}/api/competency/assessments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          programId: program.id,
          employeeId,
          assessmentType,
          assessmentDate,
          evaluatorName,
          evaluatorTitle,
          evaluatorInitials,
          competencyType: program.type,
          status,
          remediationPlan: status === "remediation" ? remediationPlan : null,
          employeeAcknowledged: employeeAck,
          supervisorAcknowledged: supervisorAck,
          items,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      onCreated();
    } catch {
      setCreating(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New {typeLabel(program.type)} Assessment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Header fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1">Employee</label>
              <Select value={employeeId ? String(employeeId) : ""} onValueChange={v => setEmployeeId(parseInt(v))}>
                <SelectTrigger><SelectValue placeholder="Select employee..." /></SelectTrigger>
                <SelectContent>
                  {activeEmployees.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Assessment Type</label>
              <Select value={assessmentType} onValueChange={setAssessmentType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {program.type === "nontechnical" ? (
                    <>
                      <SelectItem value="initial">Orientation</SelectItem>
                      <SelectItem value="annual">2-Year Reassessment</SelectItem>
                      <SelectItem value="reassessment">Duty Change</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="initial">Initial</SelectItem>
                      <SelectItem value="6month">6-Month</SelectItem>
                      <SelectItem value="annual">Annual</SelectItem>
                      <SelectItem value="reassessment">Reassessment</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1">Assessment Date</label>
              <Input type="date" value={assessmentDate} onChange={e => setAssessmentDate(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Overall Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pass">Pass</SelectItem>
                  <SelectItem value="fail">Fail</SelectItem>
                  <SelectItem value="remediation">Remediation</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1">Evaluator Name</label>
              <Input placeholder="Print name" value={evaluatorName} onChange={e => setEvaluatorName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Evaluator Title</label>
              <Input placeholder="Technical Supervisor" value={evaluatorTitle} onChange={e => setEvaluatorTitle(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Evaluator Initials</label>
              <Input placeholder="MV" value={evaluatorInitials} onChange={e => setEvaluatorInitials(e.target.value)} maxLength={10} />
            </div>
          </div>

          {/* Technical form: 6-method matrix */}
          {program.type === "technical" && program.methodGroups && program.methodGroups.length > 0 && (
            <div>
              <div className="text-sm font-semibold mb-2">Assessment Matrix</div>
              <p className="text-[10px] text-muted-foreground mb-2">For each method/group, record the observation date, specimen or sample used, evidence, and evaluator initials. These are required for CLIA/CAP compliance.</p>
              <div className="overflow-x-auto border border-border rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-primary/5">
                      <th className="p-2 text-left font-medium text-xs w-[35%]">CLIA Method</th>
                      {program.methodGroups.map(g => (
                        <th key={g.id} className="p-2 text-left font-medium text-xs">{g.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {CLIA_METHODS.map((method, mIdx) => (
                      <tr key={mIdx} className="border-t border-border">
                        <td className="p-2 text-xs leading-tight">{method}</td>
                        {program.methodGroups!.map(g => {
                          const key = `${mIdx + 1}-${g.id}`;
                          const cell = techItems[key] || { evidence: "", passed: false, initials: "", date: "", specimen: "" };
                          return (
                            <td key={g.id} className="p-1.5 border-l border-border">
                              <Input
                                className="text-xs h-6 mb-1"
                                placeholder="Evidence..."
                                value={cell.evidence}
                                onChange={e => setTechItems(prev => ({ ...prev, [key]: { ...cell, evidence: e.target.value } }))}
                              />
                              <Input
                                className="text-xs h-6 mb-1"
                                placeholder="Specimen/sample ID..."
                                value={cell.specimen}
                                onChange={e => setTechItems(prev => ({ ...prev, [key]: { ...cell, specimen: e.target.value } }))}
                              />
                              <div className="flex gap-1 mb-1">
                                <Input
                                  type="date"
                                  className="text-[10px] h-6 flex-1"
                                  value={cell.date}
                                  onChange={e => setTechItems(prev => ({ ...prev, [key]: { ...cell, date: e.target.value } }))}
                                  title="Observation date"
                                />
                                <Input
                                  className="text-[10px] h-6 w-14"
                                  placeholder="Init"
                                  value={cell.initials}
                                  onChange={e => setTechItems(prev => ({ ...prev, [key]: { ...cell, initials: e.target.value } }))}
                                  maxLength={10}
                                  title="Evaluator initials"
                                />
                              </div>
                              <label className="flex items-center gap-1 text-[10px] cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={cell.passed}
                                  onChange={e => setTechItems(prev => ({ ...prev, [key]: { ...cell, passed: e.target.checked } }))}
                                  className="w-3 h-3"
                                />
                                Pass
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Waived form: select 2 of 4 methods */}
          {program.type === "waived" && (
            <div>
              <div className="text-sm font-semibold mb-2">Select 2 of 4 Methods</div>
              <p className="text-[10px] text-muted-foreground mb-2">For each selected method, record the date performed, specimen/sample used, evidence, and evaluator initials.</p>
              <div className="space-y-2">
                {WAIVED_METHODS.map((method, mIdx) => {
                  const num = mIdx + 1;
                  const selected = waivedMethods.includes(num);
                  const cell = waivedItems[num] || { evidence: "", passed: false, initials: "", date: "", specimen: "" };
                  return (
                    <div key={num} className={`border rounded-lg p-3 ${selected ? "border-primary bg-primary/5" : "border-border"}`}>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={e => {
                            if (e.target.checked) {
                              setWaivedMethods(prev => [...prev, num].slice(-4));
                            } else {
                              setWaivedMethods(prev => prev.filter(m => m !== num));
                            }
                          }}
                          className="mt-0.5"
                        />
                        <div className="flex-1">
                          <div className="text-xs font-medium">{method}</div>
                          {selected && (
                            <div className="mt-2 space-y-1.5">
                              <div className="flex gap-2">
                                <Input
                                  className="text-xs h-7 flex-1"
                                  placeholder="Evidence..."
                                  value={cell.evidence}
                                  onChange={e => setWaivedItems(prev => ({ ...prev, [num]: { ...cell, evidence: e.target.value } }))}
                                />
                                <label className="flex items-center gap-1 text-[10px] shrink-0">
                                  <input
                                    type="checkbox"
                                    checked={cell.passed}
                                    onChange={e => setWaivedItems(prev => ({ ...prev, [num]: { ...cell, passed: e.target.checked } }))}
                                    className="w-3 h-3"
                                  />
                                  Pass
                                </label>
                              </div>
                              <div className="flex gap-2">
                                <Input
                                  className="text-xs h-7 flex-1"
                                  placeholder="Specimen/sample ID..."
                                  value={cell.specimen}
                                  onChange={e => setWaivedItems(prev => ({ ...prev, [num]: { ...cell, specimen: e.target.value } }))}
                                />
                                <Input
                                  type="date"
                                  className="text-xs h-7 w-36"
                                  value={cell.date}
                                  onChange={e => setWaivedItems(prev => ({ ...prev, [num]: { ...cell, date: e.target.value } }))}
                                  title="Date performed"
                                />
                                <Input
                                  className="text-xs h-7 w-16"
                                  placeholder="Init"
                                  value={cell.initials}
                                  onChange={e => setWaivedItems(prev => ({ ...prev, [num]: { ...cell, initials: e.target.value } }))}
                                  maxLength={10}
                                  title="Evaluator initials"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </label>
                    </div>
                  );
                })}
              </div>
              {waivedMethods.length < 2 && (
                <p className="text-xs text-amber-600 mt-2">Select at least 2 methods (WT.03.01.01 EP 5).</p>
              )}
            </div>
          )}

          {/* Non-technical checklist */}
          {program.type === "nontechnical" && program.checklistItems && (
            <div>
              <div className="text-sm font-semibold mb-2">Checklist Items</div>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-primary/5">
                      <th className="p-2 text-left w-8">#</th>
                      <th className="p-2 text-left">Item</th>
                      <th className="p-2 text-left w-28">Date Met</th>
                      <th className="p-2 text-left w-28">Specimen/Scenario</th>
                      <th className="p-2 text-left w-20">Emp Init</th>
                      <th className="p-2 text-left w-20">Sup Init</th>
                    </tr>
                  </thead>
                  <tbody>
                    {program.checklistItems.map(item => {
                      const cell = nonTechItems[item.label] || { dateMet: "", empInitials: "", supInitials: "", specimen: "" };
                      return (
                        <tr key={item.label} className="border-t border-border">
                          <td className="p-2 font-bold">{item.label}.</td>
                          <td className="p-2">{item.description}</td>
                          <td className="p-1.5">
                            <Input
                              type="date"
                              className="text-xs h-7"
                              value={cell.dateMet}
                              onChange={e => setNonTechItems(prev => ({ ...prev, [item.label]: { ...cell, dateMet: e.target.value } }))}
                            />
                          </td>
                          <td className="p-1.5">
                            <Input
                              className="text-xs h-7"
                              placeholder="Specimen/scenario..."
                              value={cell.specimen}
                              onChange={e => setNonTechItems(prev => ({ ...prev, [item.label]: { ...cell, specimen: e.target.value } }))}
                            />
                          </td>
                          <td className="p-1.5">
                            <Input
                              className="text-xs h-7"
                              placeholder="Init"
                              value={cell.empInitials}
                              onChange={e => setNonTechItems(prev => ({ ...prev, [item.label]: { ...cell, empInitials: e.target.value } }))}
                              maxLength={10}
                            />
                          </td>
                          <td className="p-1.5">
                            <Input
                              className="text-xs h-7"
                              placeholder="Init"
                              value={cell.supInitials}
                              onChange={e => setNonTechItems(prev => ({ ...prev, [item.label]: { ...cell, supInitials: e.target.value } }))}
                              maxLength={10}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Remediation */}
          {(status === "fail" || status === "remediation") && (
            <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400 font-medium mb-2">
                This employee needs additional training and is restricted from performing patient testing unsupervised.
              </p>
              <Textarea
                placeholder="Action plan and timeline..."
                value={remediationPlan}
                onChange={e => setRemediationPlan(e.target.value)}
                className="text-xs"
                rows={3}
              />
            </div>
          )}

          {/* Acknowledgements */}
          <div className="border border-border rounded-lg p-3 space-y-2">
            <div className="text-xs font-semibold">Acknowledgement</div>
            <p className="text-xs text-muted-foreground">
              {program.type === "technical"
                ? "I have had an opportunity to review and ask questions about policies and procedures related to equipment and testing above."
                : "The signatures below indicate that the employee and supervisor both affirm that the employee can perform all duties covered above."}
            </p>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={employeeAck} onChange={e => setEmployeeAck(e.target.checked)} />
                Employee Acknowledged
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={supervisorAck} onChange={e => setSupervisorAck(e.target.checked)} />
                Supervisor Acknowledged
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              disabled={!employeeId || creating || (program.type === "waived" && waivedMethods.length < 2)}
              onClick={handleCreate}
            >
              {creating ? "Saving..." : "Save Assessment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
