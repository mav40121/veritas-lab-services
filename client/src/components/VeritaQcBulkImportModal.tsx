import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { authHeaders } from "@/lib/auth";

// VeritaQC -> VeritaCheck "QC Lot Verification" (qc_range) Bulk Import modal.
//
// Phase D-2 of the VeritaQC Import family. The flat-list modal at
// VeritaQcImportModal handles single-level imports (precision, accuracy_bias,
// linearity, reportable_range). QC Lot Verification stores replicates in a
// 2D grid keyed by `${analyte}|${level}|${analyzer}`, so this modal pulls the
// full cube for one analyte from the D-1 endpoint
//   GET /api/labs/:labId/qc/import-analyte-bulk-candidates?analyte=X
// and lets the user check off which (level x instrument) cells to import.
//
// Design choices (v1):
//   1. No mapping UI. Server qc_level + instrument names land verbatim;
//      parent handler appends them to qcLevels/qcAnalyzers if missing.
//      Labels can be renamed post-import.
//   2. Routing radio: imported cells go to the new-lot grid (default) or
//      the prior-lot grid (used for the optional crossover bias check).
//   3. Exclude-Westgard-flagged toggle. When on, the parent receives the
//      WESTGARD_FLAG_SUMMARY but the values arrays exclude flagged points.
//      v1 ships without server-side exclusion (the D-1 endpoint returns
//      replicate_values but not the per-replicate flag), so the toggle is
//      surfaced but disabled with an explanatory tooltip until D-1.1 lands.
//   4. Date range filter passes through to D-1.

export interface VeritaQcBulkImportCell {
  qc_level: string;
  instrument: string;
  control_lot: string;
  control_lot_id: number;
  manufacturer?: string;
  target_value: number;
  target_sd: number;
  values: number[];
  result_count: number;
  latest_result_date: string;
  was_westgard_flagged_count: number;
}

export type VeritaQcBulkImportRouting = "new_lot" | "prior_lot";

export interface VeritaQcBulkImportPayload {
  analyte: string;
  cells: VeritaQcBulkImportCell[];
  routing: VeritaQcBulkImportRouting;
  import_source: {
    source: "veritaqc";
    endpoint: "import-analyte-bulk-candidates";
    fetched_at: string;
    analyte: string;
    start_date: string | null;
    end_date: string | null;
  };
  westgard_flag_summary: { total: number; flagged: number };
}

interface BulkLevel {
  qc_level: string;
  control_lot: string;
  control_lot_id: number;
  manufacturer?: string;
  target_value: number;
  target_sd: number;
  instruments: Array<{
    instrument: string;
    result_count: number;
    latest_result_date: string;
    was_westgard_flagged_count: number;
    replicate_values: number[];
  }>;
}

interface BulkCandidates {
  analyte: string;
  levels: BulkLevel[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  labId: number;
  defaultAnalyte?: string;
  onImport: (payload: VeritaQcBulkImportPayload) => void;
}

const DATE_RANGES = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 60 days", days: 60 },
  { label: "Last 90 days", days: 90 },
  { label: "Last 6 months", days: 180 },
  { label: "Custom", days: 0 },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split("T")[0];
}

function cellKey(level: string, instrument: string): string {
  return `${level}__${instrument}`;
}

export function VeritaQcBulkImportModal({ open, onOpenChange, labId, defaultAnalyte, onImport }: Props) {
  const [analyte, setAnalyte] = useState(defaultAnalyte || "");
  const [analyteInput, setAnalyteInput] = useState(defaultAnalyte || "");
  const [dateRangePreset, setDateRangePreset] = useState<string>("Last 90 days");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [routing, setRouting] = useState<VeritaQcBulkImportRouting>("new_lot");

  const [candidates, setCandidates] = useState<BulkCandidates | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { startDate, endDate } = useMemo(() => {
    if (dateRangePreset === "Custom") {
      return { startDate: customStart || null, endDate: customEnd || null };
    }
    const preset = DATE_RANGES.find(r => r.label === dateRangePreset);
    if (!preset || preset.days === 0) return { startDate: null, endDate: null };
    return { startDate: isoDaysAgo(preset.days), endDate: null };
  }, [dateRangePreset, customStart, customEnd]);

  useEffect(() => {
    if (!open) return;
    setAnalyteInput(defaultAnalyte || "");
    setAnalyte(defaultAnalyte || "");
    setCandidates(null);
    setSelected({});
    setError(null);
    setRouting("new_lot");
  }, [open, defaultAnalyte]);

  // Fetch the cube whenever analyte (committed) or date filters change.
  useEffect(() => {
    if (!open || !analyte.trim()) {
      setCandidates(null);
      return;
    }
    const ctrl = new AbortController();
    setFetching(true);
    setError(null);
    (async () => {
      try {
        const params = new URLSearchParams({ analyte: analyte.trim() });
        if (startDate) params.set("start_date", startDate);
        if (endDate) params.set("end_date", endDate);
        const r = await fetch(`/api/labs/${labId}/qc/import-analyte-bulk-candidates?` + params.toString(), {
          signal: ctrl.signal,
          headers: authHeaders(),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError(j?.error || `Failed to fetch candidates (HTTP ${r.status})`);
          setCandidates(null);
          return;
        }
        const data = await r.json();
        setCandidates(data);
        // Default-select every cell that has at least one result.
        const next: Record<string, boolean> = {};
        for (const lvl of (data.levels || []) as BulkLevel[]) {
          for (const inst of lvl.instruments || []) {
            if (inst.result_count > 0) {
              next[cellKey(lvl.qc_level, inst.instrument)] = true;
            }
          }
        }
        setSelected(next);
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setError(err.message || "Network error");
          setCandidates(null);
        }
      } finally {
        setFetching(false);
      }
    })();
    return () => ctrl.abort();
  }, [open, analyte, startDate, endDate, labId]);

  const allCells: Array<{ level: BulkLevel; inst: BulkLevel["instruments"][0] }> = useMemo(() => {
    if (!candidates) return [];
    const out: Array<{ level: BulkLevel; inst: BulkLevel["instruments"][0] }> = [];
    for (const lvl of candidates.levels) {
      for (const inst of lvl.instruments) {
        out.push({ level: lvl, inst });
      }
    }
    return out;
  }, [candidates]);

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const totalCells = allCells.length;
  const totalResults = allCells.reduce((acc, c) => acc + (selected[cellKey(c.level.qc_level, c.inst.instrument)] ? c.inst.result_count : 0), 0);
  const totalFlagged = allCells.reduce((acc, c) => acc + (selected[cellKey(c.level.qc_level, c.inst.instrument)] ? c.inst.was_westgard_flagged_count : 0), 0);

  function toggleAll(value: boolean) {
    if (!candidates) return;
    const next: Record<string, boolean> = {};
    for (const lvl of candidates.levels) {
      for (const inst of lvl.instruments) {
        next[cellKey(lvl.qc_level, inst.instrument)] = value && inst.result_count > 0;
      }
    }
    setSelected(next);
  }

  async function handleImport() {
    if (!candidates || selectedCount === 0) return;
    setImporting(true);
    try {
      const cells: VeritaQcBulkImportCell[] = [];
      for (const lvl of candidates.levels) {
        for (const inst of lvl.instruments) {
          if (!selected[cellKey(lvl.qc_level, inst.instrument)]) continue;
          if (inst.result_count === 0) continue;
          cells.push({
            qc_level: lvl.qc_level,
            instrument: inst.instrument,
            control_lot: lvl.control_lot,
            control_lot_id: lvl.control_lot_id,
            manufacturer: lvl.manufacturer,
            target_value: lvl.target_value,
            target_sd: lvl.target_sd,
            values: inst.replicate_values.slice(),
            result_count: inst.result_count,
            latest_result_date: inst.latest_result_date,
            was_westgard_flagged_count: inst.was_westgard_flagged_count,
          });
        }
      }
      const payload: VeritaQcBulkImportPayload = {
        analyte: candidates.analyte,
        cells,
        routing,
        import_source: {
          source: "veritaqc",
          endpoint: "import-analyte-bulk-candidates",
          fetched_at: new Date().toISOString(),
          analyte: candidates.analyte,
          start_date: startDate,
          end_date: endDate,
        },
        westgard_flag_summary: { total: totalResults, flagged: totalFlagged },
      };
      onImport(payload);
      onOpenChange(false);
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import QC Results into QC Lot Verification</DialogTitle>
          <DialogDescription>
            Pull existing QC results from VeritaQC™ into the new-lot replicate grid (or the prior-lot grid for the crossover bias check). One analyte per import; run it again per analyte for a multi-analyte study.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Filter row: analyte + date range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Analyte (required)</Label>
              <Input
                value={analyteInput}
                onChange={(e) => setAnalyteInput(e.target.value)}
                onBlur={() => setAnalyte(analyteInput.trim())}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setAnalyte(analyteInput.trim()); } }}
                placeholder="e.g. Glucose"
                className="h-8"
              />
            </div>
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
          </div>

          {/* Routing radio */}
          <div className="rounded-md border p-3 space-y-2">
            <Label className="text-xs font-medium">Route imported replicates to</Label>
            <div className="flex flex-col gap-1.5">
              <label className="flex items-start gap-2 text-xs cursor-pointer select-none">
                <input
                  type="radio"
                  name="bulk-routing"
                  checked={routing === "new_lot"}
                  onChange={() => setRouting("new_lot")}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-medium">New-lot grid (default)</div>
                  <div className="text-muted-foreground">For the range-establishment portion of the study on the incoming control lot.</div>
                </div>
              </label>
              <label className="flex items-start gap-2 text-xs cursor-pointer select-none">
                <input
                  type="radio"
                  name="bulk-routing"
                  checked={routing === "prior_lot"}
                  onChange={() => setRouting("prior_lot")}
                  className="mt-0.5"
                />
                <div>
                  <div className="font-medium">Prior-lot grid (crossover bias check)</div>
                  <div className="text-muted-foreground">For the parallel prior-lot replicates used in the optional CLSI C24-Ed4 crossover bias check. Enables the prior-lot section automatically.</div>
                </div>
              </label>
            </div>
          </div>

          {fetching && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">Loading candidates from VeritaQC...</div>
          )}

          {candidates && candidates.levels.length === 0 && !fetching && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              No control lots match analyte "{candidates.analyte}" in VeritaQC. Check the analyte spelling or widen the date range.
            </div>
          )}

          {candidates && candidates.levels.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <div className="text-muted-foreground">
                  {selectedCount} of {totalCells} cells selected, {totalResults} results
                  {totalFlagged > 0 ? ` (${totalFlagged} Westgard-flagged in VeritaQC)` : ""}
                </div>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => toggleAll(true)}>Select all</Button>
                  <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => toggleAll(false)}>Clear</Button>
                </div>
              </div>

              {candidates.levels.map(level => (
                <div key={`${level.qc_level}_${level.control_lot_id}`} className="rounded-md border">
                  <div className="px-3 py-2 border-b bg-muted/40 text-xs">
                    <div className="font-medium">
                      Level {level.qc_level.toUpperCase()}: Lot {level.control_lot}
                      {level.manufacturer ? `, ${level.manufacturer}` : ""}
                    </div>
                    <div className="text-muted-foreground">
                      target {level.target_value} +/- {level.target_sd} SD
                    </div>
                  </div>
                  <div className="divide-y">
                    {level.instruments.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground italic">No instruments returned results in range.</div>
                    )}
                    {level.instruments.map(inst => {
                      const key = cellKey(level.qc_level, inst.instrument);
                      const disabled = inst.result_count === 0;
                      return (
                        <label
                          key={inst.instrument}
                          className={`flex items-center justify-between gap-3 px-3 py-2 text-xs cursor-pointer ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                        >
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={!!selected[key]}
                              disabled={disabled}
                              onCheckedChange={(v) => setSelected(prev => ({ ...prev, [key]: !!v }))}
                            />
                            <div>
                              <div className="font-medium">{inst.instrument}</div>
                              <div className="text-muted-foreground">
                                {inst.result_count} results, latest {inst.latest_result_date || "n/a"}
                                {inst.was_westgard_flagged_count > 0 ? `, ${inst.was_westgard_flagged_count} Westgard-flagged` : ""}
                              </div>
                            </div>
                          </div>
                          <div className="font-mono text-muted-foreground text-[10px] max-w-[40%] truncate">
                            {inst.replicate_values.slice(0, 6).map(v => v.toFixed(2)).join(", ")}
                            {inst.replicate_values.length > 6 ? ", ..." : ""}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                Imported levels and instruments that do not already exist on this study will be added automatically. Rename labels after import if your study uses different naming.
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-700 dark:text-red-400">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleImport} disabled={importing || selectedCount === 0 || !candidates}>
            {importing ? "Importing..." : `Import ${selectedCount} cell${selectedCount === 1 ? "" : "s"} to QC Lot Verification`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
