import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// VeritaQC → VeritaCheck Verification Import modal (Phase A: Precision).
//
// Flow: user picks analyte → modal fetches candidates → user picks
// instrument + date range + control lot → modal previews per-level
// results → user clicks Import → parent receives the verification-study
// payload and merges it into the Precision data-entry state.
//
// Per design doc v2:
//   #1 multi-lot warning surfaces before preview; user must pick ONE
//      control lot. Reagent lot is captured post-import on the study
//      itself (qc_results does not currently store reagent_lot).
//   #2 instrument required for multi-analyzer labs (we infer "multi"
//      by whether the candidates endpoint returned more than one option)
//   #3 sticky level mapping handled server-side; modal exposes the
//      defaulted level_name as editable
//   #4 Westgard-flagged result count surfaced before commit
//   #5 import_source provenance returned with the preview is what the
//      parent persists into data_points.import_source on save

export type SubsampleStrategy = "most_recent" | "random" | "all";

export interface VeritaQcImportPayload {
  analyte: string;
  // Precision Phase A always lands one level per import (one control lot
  // → one qc_level). Tech can run the modal multiple times to stack
  // multiple levels into the same study.
  level: {
    name: string;
    values: number[];
    qc_level: string;
    control_lot_id: number;
    control_lot: string;
    manufacturer?: string;
    target_value?: number;
    target_sd?: number;
    was_westgard_flagged_count: number;
  };
  import_source: any;
  westgard_flag_summary: { total: number; flagged: number };
}

interface Candidate {
  analyte: string;
  instrument_options: string[];
  control_lot_options: Array<{ id: number; lot_number: string; level: string; manufacturer?: string; status: string }>;
  multi_lot_warning: { message: string; lot_counts: any[] } | null;
  levels: Array<{
    qc_level: string;
    control_lot_id: number;
    control_lot: string;
    manufacturer?: string;
    target_value: number;
    target_sd: number;
    result_count: number;
    latest_result_date: string;
  }>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labId: number;
  // Pre-fill analyte from the parent's current study state, if known.
  defaultAnalyte?: string;
  // Callback fired once the user clicks "Import to verification study".
  // Parent merges this payload into Precision state.
  onImport: (payload: VeritaQcImportPayload) => void;
}

const DATE_RANGES = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 6 months", days: 180 },
  { label: "Custom", days: 0 },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

export function VeritaQcImportModal({ open, onOpenChange, labId, defaultAnalyte, onImport }: Props) {
  const [analyte, setAnalyte] = useState(defaultAnalyte || "");
  const [analyteInput, setAnalyteInput] = useState(defaultAnalyte || "");
  const [instrument, setInstrument] = useState<string>("");
  const [dateRangePreset, setDateRangePreset] = useState<string>("Last 30 days");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [controlLotId, setControlLotId] = useState<string>("");
  const [replicates, setReplicates] = useState<number>(20);
  const [strategy, setStrategy] = useState<SubsampleStrategy>("most_recent");
  const [studyLevelName, setStudyLevelName] = useState<string>("");

  const [candidates, setCandidates] = useState<Candidate | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<VeritaQcImportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Date range resolution -> start/end ISO strings.
  const { startDate, endDate } = useMemo(() => {
    if (dateRangePreset === "Custom") {
      return { startDate: customStart || null, endDate: customEnd || null };
    }
    const preset = DATE_RANGES.find(r => r.label === dateRangePreset);
    if (!preset || preset.days === 0) return { startDate: null, endDate: null };
    return { startDate: isoDaysAgo(preset.days), endDate: null };
  }, [dateRangePreset, customStart, customEnd]);

  // Reset modal state when reopened or labId/analyte changes.
  useEffect(() => {
    if (!open) return;
    setAnalyteInput(defaultAnalyte || "");
    setAnalyte(defaultAnalyte || "");
    setInstrument("");
    setControlLotId("");
    setPreview(null);
    setError(null);
    setCandidates(null);
  }, [open, defaultAnalyte]);

  // Fetch candidates whenever analyte (committed) or filters change.
  useEffect(() => {
    if (!open || !analyte.trim()) {
      setCandidates(null);
      return;
    }
    const ctrl = new AbortController();
    (async () => {
      try {
        const params = new URLSearchParams({ analyte: analyte.trim() });
        if (instrument) params.set("instrument", instrument);
        if (startDate) params.set("start_date", startDate);
        if (endDate) params.set("end_date", endDate);
        if (controlLotId) params.set("control_lot_id", controlLotId);
        const r = await fetch(`/api/labs/${labId}/qc/import-candidates?` + params.toString(), { signal: ctrl.signal });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError(j?.error || `Failed to fetch candidates (HTTP ${r.status})`);
          setCandidates(null);
          return;
        }
        const data = await r.json();
        setCandidates(data);
        setError(null);
        // Auto-select instrument if only one option and none picked yet.
        if (!instrument && data.instrument_options?.length === 1) {
          setInstrument(data.instrument_options[0]);
        }
        // Auto-select control lot if only one matches and none picked yet.
        if (!controlLotId && data.levels?.length === 1) {
          setControlLotId(String(data.levels[0].control_lot_id));
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setError(err.message || "Network error");
          setCandidates(null);
        }
      }
    })();
    return () => ctrl.abort();
  }, [open, analyte, instrument, startDate, endDate, controlLotId, labId]);

  const multiInstrument = (candidates?.instrument_options?.length || 0) > 1;
  const instrumentRequired = multiInstrument && !instrument;
  const multiLot = candidates?.multi_lot_warning != null;
  const controlLotRequired = multiLot && !controlLotId;
  const selectedLevel = candidates?.levels.find(l => String(l.control_lot_id) === controlLotId);

  // Default the study level name when the selected level changes (and the
  // user has not typed a custom name yet).
  useEffect(() => {
    if (!selectedLevel) return;
    if (studyLevelName) return; // respect user override
    const map: Record<string, string> = {
      low: "Level 1 (QC Low)",
      mid: "Level 2 (QC Mid)",
      high: "Level 3 (QC High)",
    };
    setStudyLevelName(map[selectedLevel.qc_level.toLowerCase()] || `QC ${selectedLevel.qc_level}`);
  }, [selectedLevel, studyLevelName]);

  const canPreview = !!analyte.trim() && !!controlLotId && !instrumentRequired && !controlLotRequired;

  async function handlePreview() {
    if (!canPreview) return;
    setPreviewing(true);
    setError(null);
    try {
      const body: any = {
        analyte: analyte.trim(),
        control_lot_id: Number(controlLotId),
        replicates_per_level: replicates,
        subsample_strategy: strategy,
      };
      if (instrument) body.instrument = instrument;
      if (startDate) body.start_date = startDate;
      if (endDate) body.end_date = endDate;
      const r = await fetch(`/api/labs/${labId}/qc/import-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j?.error || `Preview failed (HTTP ${r.status})`);
        return;
      }
      const data = await r.json();
      // Apply the user's level-name override before stashing the preview.
      if (studyLevelName && data?.levels?.[0]) {
        data.levels[0].name = studyLevelName;
      }
      setPreview({
        analyte: data.analyte,
        level: data.levels[0],
        import_source: data.import_source,
        westgard_flag_summary: data.westgard_flag_summary,
      });
    } catch (err: any) {
      setError(err.message || "Network error");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    if (!preview) return;
    setImporting(true);
    try {
      // Persist the sticky mapping override (if the user typed a custom
      // name) before firing the parent callback. Non-blocking — failure
      // here doesn't stop the import.
      if (studyLevelName && selectedLevel) {
        try {
          await fetch(`/api/labs/${labId}/qc/import-mappings/${encodeURIComponent(analyte.trim())}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mappings: [{ qc_level: selectedLevel.qc_level, study_level_name: studyLevelName }],
            }),
          });
        } catch {}
      }
      onImport(preview);
      onOpenChange(false);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import QC Results from VeritaQC™</DialogTitle>
          <DialogDescription>
            Pull daily QC results from VeritaQC and reshape them as Precision Verification replicates (CLSI EP15-A3). Per design, one control lot per import.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Filter row 1: analyte + instrument */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Analyte (required)</Label>
              <div className="flex gap-2">
                <Input
                  value={analyteInput}
                  onChange={(e) => setAnalyteInput(e.target.value)}
                  onBlur={() => setAnalyte(analyteInput.trim())}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setAnalyte(analyteInput.trim()); } }}
                  placeholder="e.g. Glucose"
                  className="h-8"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Instrument{multiInstrument ? " (required)" : ""}</Label>
              <Select value={instrument || "__any"} onValueChange={(v) => setInstrument(v === "__any" ? "" : v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Any instrument" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__any">Any instrument</SelectItem>
                  {candidates?.instrument_options?.map(i => (
                    <SelectItem key={i} value={i}>{i}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {instrumentRequired && (
                <p className="text-xs text-amber-700 dark:text-amber-400">Pick one instrument; this lab has multiple analyzers.</p>
              )}
            </div>
          </div>

          {/* Filter row 2: date range + control lot */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Date range</Label>
              <Select value={dateRangePreset} onValueChange={setDateRangePreset}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATE_RANGES.map(r => (<SelectItem key={r.label} value={r.label}>{r.label}</SelectItem>))}
                </SelectContent>
              </Select>
              {dateRangePreset === "Custom" && (
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="h-8 text-xs" />
                  <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="h-8 text-xs" />
                </div>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Control lot{multiLot ? " (required)" : ""}</Label>
              <Select value={controlLotId || "__none"} onValueChange={(v) => setControlLotId(v === "__none" ? "" : v)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Pick a control lot" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Pick a control lot</SelectItem>
                  {candidates?.control_lot_options?.map(l => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.lot_number}, {l.level.toUpperCase()}{l.status !== "active" ? ` (${l.status})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Multi-lot warning (design doc decision #1) */}
          {candidates?.multi_lot_warning && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <p className="font-medium text-amber-800 dark:text-amber-300">⚠ Multiple control lots in range</p>
              <p className="mt-1 text-amber-700 dark:text-amber-400">{candidates.multi_lot_warning.message}</p>
            </div>
          )}

          {/* Reagent lot note (post-import on study record) */}
          <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
            VeritaQC does not currently track reagent lot per result. Enter the reagent lot on the verification study after import.
          </div>

          {/* Per-level summary tiles */}
          {candidates && candidates.levels.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Matching results</Label>
              <div className="space-y-1">
                {candidates.levels.map(l => (
                  <div
                    key={l.control_lot_id}
                    className={`flex items-center justify-between rounded-md border p-2 text-xs ${String(l.control_lot_id) === controlLotId ? "border-primary bg-primary/5" : ""}`}
                  >
                    <div>
                      <div className="font-medium">{l.qc_level.toUpperCase()}: Lot {l.control_lot}</div>
                      <div className="text-muted-foreground">target {l.target_value} ± {l.target_sd} SD · N={l.result_count} results</div>
                    </div>
                    <div className="text-muted-foreground">{l.latest_result_date}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Replicate count + strategy + study level name */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Replicates per level</Label>
              <Select value={String(replicates)} onValueChange={(v) => setReplicates(Number(v))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[5, 10, 15, 20, 25, 30, 40].map(n => (<SelectItem key={n} value={String(n)}>{n}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Subsample strategy</Label>
              <Select value={strategy} onValueChange={(v) => setStrategy(v as SubsampleStrategy)}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="most_recent">Most recent</SelectItem>
                  <SelectItem value="random">Random</SelectItem>
                  <SelectItem value="all">All (bypass cap)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Study level name</Label>
              <Input
                value={studyLevelName}
                onChange={(e) => setStudyLevelName(e.target.value)}
                placeholder="QC Low"
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* Preview output */}
          {preview && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs space-y-1.5">
              <p className="font-medium text-emerald-800 dark:text-emerald-300">Preview: {preview.analyte}</p>
              <div className="font-medium">{preview.level.name} · {preview.level.values.length} replicates</div>
              <div className="font-mono text-muted-foreground break-words">
                {preview.level.values.slice(0, 20).map(v => v.toFixed(2)).join(", ")}
                {preview.level.values.length > 20 ? `, … (+${preview.level.values.length - 20})` : ""}
              </div>
              {preview.westgard_flag_summary.flagged > 0 && (
                <p className="text-amber-700 dark:text-amber-400">
                  ⚠ {preview.westgard_flag_summary.flagged} of {preview.westgard_flag_summary.total} results were Westgard-flagged in VeritaQC. They will be imported with the flag visible to the director.
                </p>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-400">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!preview && (
            <Button onClick={handlePreview} disabled={!canPreview || previewing}>
              {previewing ? "Loading…" : "Preview values"}
            </Button>
          )}
          {preview && (
            <>
              <Button variant="outline" onClick={() => setPreview(null)}>Adjust filters</Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? "Importing…" : "Import to verification study"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
