import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/queryClient";
import { authHeaders } from "@/lib/auth";
import { useAuth } from "@/components/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, CheckCircle2, Circle,
  AlertTriangle, FlaskConical, ClipboardCheck, BookOpen, Info, Download,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Verification {
  id: number;
  instrument_name: string;
  manufacturer: string;
  trigger_type: string;
  status: string;
  elements: string; // JSON array
  element_reasons: string; // JSON object
  director_name: string;
  director_title: string;
  approved_date: string;
  remediation_notes: string;
  map_instrument_id: number | null;
  unit_count: number;
  passed_count: number;
  failed_count: number;
  created_at: string;
  instruments: InstrumentUnit[];
  studies: VerificationStudy[];
}

interface InstrumentUnit {
  id: number;
  serial_number: string;
  model: string;
  location: string;
  director_name: string;
  director_title: string;
  approved_date: string;
}

interface VerificationStudy {
  id: number;
  element: string;
  study_id: number | null;
  analyte: string;
  sample_count: number;
  clsi_protocol: string;
  design_rationale: string;
  result_summary: string;
  passed: number | null;
  testName: string | null;
  studyType: string | null;
}

interface MapInstrument {
  id: number;
  instrument_name: string;
  manufacturer: string;
}

interface ExistingStudy {
  id: number;
  testName: string;
  studyType: string;
  createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const TRIGGER_TYPES = [
  { value: "new_instrument",  label: "New instrument (first of this type in lab)" },
  { value: "new_analyte",     label: "New analyte added to existing instrument" },
  { value: "second_unit",     label: "Second unit of same make/model" },
  { value: "replacement",     label: "Replacement instrument (same make/model)" },
];

const ALL_ELEMENTS = [
  {
    key: "accuracy",
    label: "Accuracy / Bias",
    protocol: "CLSI EP15-A3",
    samples: "20 patient samples across the reportable range",
    rationale: "CLSI EP15-A3 recommends a minimum of 20 samples spanning the full reportable range. Samples should include low, mid, and high concentrations to assess systematic bias against manufacturer claims.",
  },
  {
    key: "precision",
    label: "Precision",
    protocol: "CLSI EP15-A3",
    samples: "20 within-run replicates; 5 days x 4 replicates for between-run",
    rationale: "CLSI EP15-A3 recommends 20 within-run replicates to estimate repeatability and at least 5 days of 4 replicates each to estimate intermediate precision.",
  },
  {
    key: "reportable_range",
    label: "Reportable Range",
    protocol: "CLSI EP06",
    samples: "5-7 levels spanning low to high",
    rationale: "CLSI EP06 recommends a minimum of 5 data points (low, high, and at least 3 evenly spaced mid-range concentrations) to verify the manufacturer's stated analytical measurement range.",
  },
  {
    key: "reference_interval",
    label: "Reference Interval",
    protocol: "CLSI EP28-A3c",
    samples: "20 reference subjects (adoption); 120 subjects (de novo establishment)",
    rationale: "CLSI EP28-A3c allows adoption of a manufacturer's reference interval with verification using a minimum of 20 reference subjects. De novo establishment requires at least 120 subjects.",
  },
];

const ELEMENT_TO_STUDY_TYPE: Record<string, string[]> = {
  accuracy: ["method_comparison", "correlation"],
  precision: ["precision"],
  reportable_range: ["cal_ver"],
  reference_interval: ["ref_interval"],
};

// Maps element key -> studyType param for /study/new
const ELEMENT_STUDY_PARAM: Record<string, string> = {
  accuracy:           "method_comparison",
  precision:          "precision",
  reportable_range:   "reportable_range",
  reference_interval: "ref_interval",
};

const ELEMENT_STUDY_LABEL: Record<string, string> = {
  accuracy:           "Correlation / Method Comparison",
  precision:          "Precision (EP15)",
  reportable_range:   "Calibration Verification / Linearity",
  reference_interval: "Reference Interval Verification",
};

const ELEMENT_LABELS: Record<string, string> = {
  accuracy: "Accuracy / Bias",
  precision: "Precision",
  reportable_range: "Reportable Range",
  reference_interval: "Reference Interval",
};

// ── Helper ────────────────────────────────────────────────────────────────────
function statusColor(v: Verification) {
  if (v.status === "complete") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
  if (v.failed_count > 0) return "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20";
  return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20";
}

function statusLabel(v: Verification) {
  if (v.status === "complete") return "Complete";
  if (v.failed_count > 0) return "Has Failures";
  return "In Progress";
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function VeritaCheckVerificationPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [view, setView] = useState<"list" | "new" | "detail">("list");
  const [activeId, setActiveId] = useState<number | null>(null);

  const { data: verifications = [], isLoading } = useQuery<Verification[]>({
    queryKey: ["/api/veritacheck/verifications"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/veritacheck/verifications`, { headers: authHeaders() });
      return r.json();
    },
  });

  const openDetail = (id: number) => { setActiveId(id); setView("detail"); };
  const backToList = () => { setActiveId(null); setView("list"); qc.invalidateQueries({ queryKey: ["/api/veritacheck/verifications"] }); };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          {(view === "new" || view === "detail") && (
            <button onClick={backToList} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm">
              <ChevronLeft size={14} /> Back
            </button>
          )}
          <div>
            <h2 className="text-xl font-bold">Instrument Verification Packages</h2>
            <p className="text-xs text-muted-foreground">CLIA-required performance verification before reporting patient results</p>
          </div>
        </div>
        {view === "list" && (
          <Button size="sm" className="gap-1" onClick={() => setView("new")}>
            <Plus size={13} /> New Instrument Verification
          </Button>
        )}
      </div>

      {view === "list" && (
        <VerificationList
          verifications={verifications}
          isLoading={isLoading}
          onOpen={openDetail}
          onDeleted={() => qc.invalidateQueries({ queryKey: ["/api/veritacheck/verifications"] })}
          onNew={() => setView("new")}
        />
      )}
      {view === "new" && (
        <NewVerificationForm
          onCreated={(id) => { qc.invalidateQueries({ queryKey: ["/api/veritacheck/verifications"] }); openDetail(id); }}
          onCancel={() => setView("list")}
        />
      )}
      {view === "detail" && activeId && (
        <VerificationDetail
          id={activeId}
          onBack={backToList}
        />
      )}
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────
function VerificationList({ verifications, isLoading, onOpen, onDeleted, onNew }: {
  verifications: Verification[];
  isLoading: boolean;
  onOpen: (id: number) => void;
  onDeleted: () => void;
  onNew: () => void;
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null);

  const handleDelete = async (id: number) => {
    await fetch(`${API_BASE}/api/veritacheck/verifications/${id}`, { method: "DELETE", headers: authHeaders() });
    setConfirmId(null);
    onDeleted();
  };

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;

  if (verifications.length === 0) {
    return (
      <div className="text-center py-20 border-2 border-dashed border-border rounded-xl">
        <ClipboardCheck size={32} className="text-muted-foreground mx-auto mb-3" />
        <h3 className="font-semibold mb-1">No verification packages yet</h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
          Create a package to document CLIA-required performance verification for a new instrument or test.
        </p>
        <Button onClick={onNew} className="gap-1"><Plus size={13} /> New Instrument Verification</Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {verifications.map(v => (
        <Card key={v.id} className="hover:border-primary/30 transition-colors cursor-pointer group" onClick={() => confirmId === null && onOpen(v.id)}>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">{v.instrument_name}</span>
                {v.manufacturer && <span className="text-xs text-muted-foreground">{v.manufacturer}</span>}
                <Badge variant="outline" className={`text-xs ${statusColor(v)}`}>{statusLabel(v)}</Badge>
              </div>
              <div className="text-xs text-muted-foreground mt-1 flex gap-3 flex-wrap">
                <span>{TRIGGER_TYPES.find(t => t.value === v.trigger_type)?.label ?? v.trigger_type}</span>
                {v.unit_count > 0 && <span>· {v.unit_count} unit{v.unit_count !== 1 ? "s" : ""}</span>}
                <span>· {new Date(v.created_at).toLocaleDateString()}</span>
              </div>
              {/* Inline confirm - appears below text, no dialog conflict */}
              {confirmId === v.id && (
                <div className="mt-2 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                  <span className="text-xs text-red-500">Delete this package?</span>
                  <button
                    className="text-xs font-semibold text-red-500 hover:text-red-700 underline"
                    onClick={() => handleDelete(v.id)}
                  >Yes, delete</button>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                    onClick={() => setConfirmId(null)}
                  >Cancel</button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 shrink-0" onClick={e => e.stopPropagation()}>
              <Button
                variant="ghost" size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
                onClick={e => { e.stopPropagation(); setConfirmId(confirmId === v.id ? null : v.id); }}
              >
                <Trash2 size={13} />
              </Button>
              <ChevronRight size={16} className="text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ── New verification form ─────────────────────────────────────────────────────
function NewVerificationForm({ onCreated, onCancel }: { onCreated: (id: number) => void; onCancel: () => void }) {
  const [instrumentName, setInstrumentName] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [triggerType, setTriggerType] = useState("");
  const [mapInstrumentId, setMapInstrumentId] = useState<number | null>(null);
  const [selectedElements, setSelectedElements] = useState<Set<string>>(new Set(ALL_ELEMENTS.map(e => e.key)));
  const [elementReasons, setElementReasons] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Load VeritaMap instruments for pre-population
  const { data: mapInstruments = [] } = useQuery<MapInstrument[]>({
    queryKey: ["/api/veritamap/instruments-all"],
    queryFn: async () => {
      // Get all maps then their instruments
      const mapsR = await fetch(`${API_BASE}/api/veritamap/maps`, { headers: authHeaders() });
      if (!mapsR.ok) return [];
      const maps = await mapsR.json();
      const all: MapInstrument[] = [];
      for (const m of maps) {
        const instrR = await fetch(`${API_BASE}/api/veritamap/maps/${m.id}/instruments`, { headers: authHeaders() });
        if (instrR.ok) {
          const instrs = await instrR.json();
          all.push(...instrs);
        }
      }
      return all;
    },
  });

  const handleMapSelect = (instrId: string) => {
    const instr = mapInstruments.find(i => i.id === parseInt(instrId));
    if (instr) {
      setInstrumentName(instr.instrument_name);
      setManufacturer(instr.manufacturer || "");
      setMapInstrumentId(instr.id);
    }
  };

  const toggleElement = (key: string, on: boolean) => {
    setSelectedElements(prev => {
      const next = new Set(prev);
      on ? next.add(key) : next.delete(key);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!instrumentName.trim()) { setError("Instrument name is required."); return; }
    if (!triggerType) { setError("Please select a trigger type."); return; }
    // Require reason for any deselected element
    for (const e of ALL_ELEMENTS) {
      if (!selectedElements.has(e.key) && !elementReasons[e.key]?.trim()) {
        setError(`Please provide a reason for excluding ${ELEMENT_LABELS[e.key]}.`); return;
      }
    }
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/api/veritacheck/verifications`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          instrument_name: instrumentName.trim(),
          manufacturer: manufacturer.trim() || null,
          trigger_type: triggerType,
          map_instrument_id: mapInstrumentId,
          elements: Array.from(selectedElements),
          element_reasons: elementReasons,
        }),
      });
      const data = await r.json();
      if (r.ok) onCreated(data.id);
      else setError(data.error || "Failed to create verification.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Instrument / Test Profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {/* Optional VeritaMap pre-fill */}
          {mapInstruments.length > 0 && (
            <div>
              <Label className="text-xs mb-1 block text-muted-foreground">Pre-fill from VeritaMap™ (optional)</Label>
              <Select onValueChange={handleMapSelect}>
                <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select an instrument from your test menu" /></SelectTrigger>
                <SelectContent>
                  {mapInstruments.map(i => (
                    <SelectItem key={i.id} value={String(i.id)}>{i.instrument_name}{i.manufacturer ? ` - ${i.manufacturer}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs mb-1 block">Instrument Name <span className="text-red-500">*</span></Label>
              <Input value={instrumentName} onChange={e => setInstrumentName(e.target.value)} placeholder="e.g. i-STAT 1" className="h-9 text-sm" />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Manufacturer</Label>
              <Input value={manufacturer} onChange={e => setManufacturer(e.target.value)} placeholder="e.g. Abbott" className="h-9 text-sm" />
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1 block">Verification Trigger <span className="text-red-500">*</span></Label>
            <Select onValueChange={setTriggerType}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Why is this verification being performed?" /></SelectTrigger>
              <SelectContent>
                {TRIGGER_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Element selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performance Elements</CardTitle>
          <p className="text-xs text-muted-foreground">All four elements are required by default. You may exclude an element only with documented justification.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {ALL_ELEMENTS.map(el => {
            const included = selectedElements.has(el.key);
            return (
              <div key={el.key} className={`rounded-lg border p-4 transition-colors ${included ? "border-border bg-card" : "border-border/50 bg-muted/30"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{el.label}</span>
                      <Badge variant="outline" className="text-xs">{el.protocol}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">Recommended: {el.samples}</p>
                  </div>
                  <button
                    onClick={() => toggleElement(el.key, !included)}
                    className={`shrink-0 mt-0.5 ${included ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {included ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                  </button>
                </div>

                {/* CLSI rationale */}
                <div className="mt-2 p-2 rounded bg-muted/40 flex gap-2">
                  <Info size={12} className="text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{el.rationale}</p>
                </div>

                {/* Reason required if excluded */}
                {!included && (
                  <div className="mt-3">
                    <Label className="text-xs mb-1 block text-amber-600 dark:text-amber-400">
                      Reason for exclusion (required - will appear in package)
                    </Label>
                    <Textarea
                      value={elementReasons[el.key] || ""}
                      onChange={e => setElementReasons(prev => ({ ...prev, [el.key]: e.target.value }))}
                      placeholder={`e.g. Reference interval adopted from manufacturer per CLSI EP28-A3c with 20-sample verification`}
                      className="text-xs h-16 resize-none"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="flex gap-3">
        <Button onClick={handleSubmit} disabled={saving} className="gap-1">
          {saving ? "Creating..." : "Create Verification Package"}
          {!saving && <ChevronRight size={14} />}
        </Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ── Detail view ───────────────────────────────────────────────────────────────
function VerificationDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<"elements" | "units" | "director">("elements");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const { data: verification, isLoading, refetch } = useQuery<Verification>({
    queryKey: [`/api/veritacheck/verifications/${id}`],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/veritacheck/verifications/${id}`, { headers: authHeaders() });
      return r.json();
    },
  });

  const { data: suggestedStudies = [] } = useQuery<ExistingStudy[]>({
    queryKey: [`/api/veritacheck/verifications/${id}/suggest-studies`],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/veritacheck/verifications/${id}/suggest-studies`, { headers: authHeaders() });
      return r.json();
    },
    enabled: !!verification,
  });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const patchStudy = async (studySlotId: number, payload: object) => {
    setSaving(true);
    await fetch(`${API_BASE}/api/veritacheck/verifications/${id}/studies/${studySlotId}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await refetch();
    setSaving(false);
    showToast("Saved");
  };

  const patchVerification = async (payload: object) => {
    setSaving(true);
    await fetch(`${API_BASE}/api/veritacheck/verifications/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await refetch();
    setSaving(false);
    showToast("Saved");
  };

  const addUnit = async () => {
    const serial = prompt("Serial number:");
    if (!serial?.trim()) return;
    await fetch(`${API_BASE}/api/veritacheck/verifications/${id}/instruments`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ serial_number: serial.trim() }),
    });
    await refetch();
  };

  const deleteUnit = async (unitId: number) => {
    await fetch(`${API_BASE}/api/veritacheck/verifications/${id}/instruments/${unitId}`, { method: "DELETE", headers: authHeaders() });
    await refetch();
  };

  if (isLoading || !verification) return <div className="text-sm text-muted-foreground">Loading...</div>;

  const elements: string[] = JSON.parse(verification.elements || "[]");
  const elementReasons: Record<string, string> = JSON.parse(verification.element_reasons || "{}");

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Package header */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-bold text-lg">{verification.instrument_name}</h3>
              {verification.manufacturer && <p className="text-sm text-muted-foreground">{verification.manufacturer}</p>}
              <p className="text-xs text-muted-foreground mt-1">{TRIGGER_TYPES.find(t => t.value === verification.trigger_type)?.label}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={statusColor(verification)}>{statusLabel(verification)}</Badge>
              {verification.status !== "complete" && (
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-emerald-600 border-emerald-500/30" onClick={() => patchVerification({ status: "complete" })}>
                  <CheckCircle2 size={12} /> Mark Complete
                </Button>
              )}
              <Button
                size="sm" variant="outline"
                className="h-7 text-xs gap-1"
                onClick={async () => {
                  const r = await fetch(`${API_BASE}/api/veritacheck/verifications/${id}/pdf`, {
                    method: "POST",
                    headers: authHeaders(),
                  });
                  if (r.ok) {
                    const blob = await r.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `VeritaCheck_Verification_${verification.instrument_name}.pdf`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }
                }}
              >
                <Download size={12} /> Download PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["elements", "units", "director"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {tab === "elements" ? "Performance Elements" : tab === "units" ? `Instrument Units (${verification.instruments?.length ?? 0})` : "Director Approval"}
          </button>
        ))}
      </div>

      {/* Elements tab */}
      {activeTab === "elements" && (
        <div className="space-y-4">
          {ALL_ELEMENTS.filter(el => elements.includes(el.key)).map(el => {
            const slot = verification.studies?.find(s => s.element === el.key);
            const suggested = suggestedStudies.filter(s =>
              (ELEMENT_TO_STUDY_TYPE[el.key] || []).includes(s.studyType)
            );
            return (
              <ElementCard
                key={el.key}
                element={el}
                slot={slot}
                suggested={suggested}
                verificationId={id}
                onPatch={(payload) => slot && patchStudy(slot.id, payload)}
              />
            );
          })}

          {/* Excluded elements */}
          {ALL_ELEMENTS.filter(el => !elements.includes(el.key)).map(el => (
            <div key={el.key} className="rounded-lg border border-border/50 bg-muted/20 p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-muted-foreground">{el.label}</span>
                <Badge variant="outline" className="text-xs">Excluded</Badge>
              </div>
              <p className="text-xs text-muted-foreground italic">{elementReasons[el.key] || "No reason documented"}</p>
            </div>
          ))}

          {/* Remediation notes */}
          {verification.failed_count > 0 && (
            <RemediationCard verification={verification} onSave={(notes) => patchVerification({ remediation_notes: notes })} />
          )}
        </div>
      )}

      {/* Units tab */}
      {activeTab === "units" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Each unit requires a separate director sign-off. One study design covers all units.</p>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={addUnit}>
              <Plus size={12} /> Add Unit
            </Button>
          </div>
          {!verification.instruments?.length && (
            <div className="text-center py-10 border-2 border-dashed border-border rounded-xl">
              <p className="text-sm text-muted-foreground">No units added yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Add serial numbers for each physical instrument unit being verified.</p>
            </div>
          )}
          {verification.instruments?.map(unit => (
            <UnitCard key={unit.id} unit={unit} verificationId={id} onSaved={refetch} onDeleted={refetch} />
          ))}
        </div>
      )}

      {/* Director approval tab */}
      {activeTab === "director" && (
        <DirectorApprovalCard verification={verification} onSave={(payload) => patchVerification(payload)} />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── Element card ──────────────────────────────────────────────────────────────
function ElementCard({ element, slot, suggested, verificationId, onPatch }: {
  element: typeof ALL_ELEMENTS[0];
  slot?: VerificationStudy;
  suggested: ExistingStudy[];
  verificationId: number;
  onPatch: (payload: object) => void;
}) {
  const [, navigate] = useLocation();
  const [showLinkExisting, setShowLinkExisting] = useState(false);

  const isDone = slot?.passed === 1 || slot?.passed === 0;
  const isPassed = slot?.passed === 1;
  const isFailed = slot?.passed === 0;

  const studyParam = ELEMENT_STUDY_PARAM[element.key];
  const studyLabel = ELEMENT_STUDY_LABEL[element.key];

  const runStudyUrl = `/veritacheck?studyType=${studyParam}&instrument1=${encodeURIComponent("")}&verificationId=${verificationId}&element=${element.key}&slotId=${slot?.id || ""}`;

  return (
    <Card className={`border transition-colors ${
      isFailed ? "border-red-500/30 bg-red-500/5" :
      isPassed ? "border-emerald-500/30 bg-emerald-500/5" :
      "border-border"
    }`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            {isPassed && <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />}
            {isFailed && <AlertTriangle size={16} className="text-red-500 shrink-0" />}
            {!isDone && <Circle size={16} className="text-muted-foreground shrink-0" />}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{element.label}</span>
                <Badge variant="outline" className="text-xs">{element.protocol}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Recommended: {element.samples}</p>
            </div>
          </div>

          {/* Primary action */}
          {!isDone ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => navigate(runStudyUrl)}
              >
                <FlaskConical size={13} />
                Run {studyLabel}
              </Button>
              <Button
                size="sm" variant="outline"
                className="h-8 text-xs"
                onClick={() => setShowLinkExisting(v => !v)}
              >
                Link Existing Study
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold ${isPassed ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                {isPassed ? "PASS" : "FAIL"}
              </span>
              <button className="text-xs text-muted-foreground underline" onClick={() => onPatch({ passed: null, study_id: null })}>
                Redo
              </button>
            </div>
          )}
        </div>

        {/* Linked study info */}
        {slot?.testName && (
          <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 px-3 py-2 rounded">
            <FlaskConical size={12} />
            <span>Linked: <strong>{slot.testName}</strong></span>
            <button className="ml-auto underline" onClick={() => onPatch({ study_id: null })}>Unlink</button>
          </div>
        )}

        {/* Link existing study dropdown */}
        {showLinkExisting && (
          <div className="mt-3">
            <Select onValueChange={(v) => { onPatch({ study_id: parseInt(v) }); setShowLinkExisting(false); }}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select a completed study to link" /></SelectTrigger>
              <SelectContent>
                {suggested.length === 0 && (
                  <SelectItem value="__none" disabled className="text-xs text-muted-foreground">No studies found</SelectItem>
                )}
                {suggested.map(s => (
                  <SelectItem key={s.id} value={String(s.id)} className="text-xs">
                    {s.testName} - {new Date(s.createdAt).toLocaleDateString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Unit card ─────────────────────────────────────────────────────────────────
function UnitCard({ unit, verificationId, onSaved, onDeleted }: { unit: InstrumentUnit; verificationId: number; onSaved: () => void; onDeleted: () => void }) {
  const [directorName, setDirectorName] = useState(unit.director_name || "");
  const [directorTitle, setDirectorTitle] = useState(unit.director_title || "");
  const [approvedDate, setApprovedDate] = useState(unit.approved_date || "");
  const [dirty, setDirty] = useState(false);

  const save = async () => {
    await fetch(`${API_BASE}/api/veritacheck/verifications/${verificationId}/instruments/${unit.id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ director_name: directorName, director_title: directorTitle, approved_date: approvedDate }),
    });
    setDirty(false);
    onSaved();
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-sm font-semibold">S/N: {unit.serial_number}</span>
            {unit.model && <span className="text-xs text-muted-foreground ml-2">{unit.model}</span>}
            {unit.location && <span className="text-xs text-muted-foreground ml-2">- {unit.location}</span>}
          </div>
          <ConfirmDialog
            title="Remove Unit?"
            message={`Remove serial number ${unit.serial_number} from this verification package?`}
            confirmLabel="Remove"
            onConfirm={onDeleted}
          >
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive">
              <Trash2 size={12} />
            </Button>
          </ConfirmDialog>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs mb-1 block">Director / Designee Name</Label>
            <Input value={directorName} onChange={e => { setDirectorName(e.target.value); setDirty(true); }} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Title</Label>
            <Input value={directorTitle} onChange={e => { setDirectorTitle(e.target.value); setDirty(true); }} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Approval Date</Label>
            <Input type="date" value={approvedDate} onChange={e => { setApprovedDate(e.target.value); setDirty(true); }} className="h-8 text-xs" />
          </div>
        </div>
        {dirty && <Button size="sm" className="h-7 text-xs mt-3" onClick={save}>Save</Button>}
      </CardContent>
    </Card>
  );
}

// ── Director approval card ────────────────────────────────────────────────────
function DirectorApprovalCard({ verification, onSave }: { verification: Verification; onSave: (payload: object) => void }) {
  const [name, setName] = useState(verification.director_name || "");
  const [title, setTitle] = useState(verification.director_title || "");
  const [date, setDate] = useState(verification.approved_date || "");
  const [dirty, setDirty] = useState(false);

  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="p-4 rounded-lg border border-primary/20 bg-primary/5">
          <p className="text-sm font-semibold text-foreground mb-1">LABORATORY DIRECTOR OR DESIGNEE REVIEW</p>
          <p className="text-sm text-muted-foreground">I have reviewed the verification study results for the instrument identified above and find that the performance specifications have been adequately verified.</p>
          <p className="text-sm font-bold text-foreground mt-2">I approve this instrument/test for patient testing.</p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label className="text-xs mb-1 block">Printed Name</Label>
            <Input value={name} onChange={e => { setName(e.target.value); setDirty(true); }} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Title</Label>
            <Input value={title} onChange={e => { setTitle(e.target.value); setDirty(true); }} className="h-9 text-sm" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Date</Label>
            <Input type="date" value={date} onChange={e => { setDate(e.target.value); setDirty(true); }} className="h-9 text-sm" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Signature line will appear on the PDF cover page.</p>
        {dirty && (
          <Button size="sm" className="gap-1" onClick={() => { onSave({ director_name: name, director_title: title, approved_date: date }); setDirty(false); }}>
            <CheckCircle2 size={13} /> Save Approval Info
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ── Remediation card ──────────────────────────────────────────────────────────
function RemediationCard({ verification, onSave }: { verification: Verification; onSave: (notes: string) => void }) {
  const [notes, setNotes] = useState(verification.remediation_notes || "");
  const [dirty, setDirty] = useState(false);

  return (
    <Card className="border-red-500/30">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertTriangle size={14} /> Remediation Log
        </CardTitle>
        <p className="text-xs text-muted-foreground">Document corrective actions taken for any failed elements. This log will appear in the verification package.</p>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <Textarea
          value={notes}
          onChange={e => { setNotes(e.target.value); setDirty(true); }}
          placeholder="Describe the failure, root cause investigation, corrective action taken, and re-verification outcome. Include dates."
          className="text-xs h-24 resize-none"
        />
        {dirty && <Button size="sm" className="h-7 text-xs mt-2" onClick={() => { onSave(notes); setDirty(false); }}>Save</Button>}
      </CardContent>
    </Card>
  );
}
