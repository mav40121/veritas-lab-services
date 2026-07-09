// client/src/components/ManualDifferentialForm.tsx
//
// Manual Differential (Rümke / CLSI H20) study input. Self-contained so it does
// NOT weave into VeritaCheckPage's per-type grid machinery: the parent renders it
// when studyType === "manual_diff" and passes testName/analyst/date + an onSave
// callback (which drives the existing saveMutation). The comparator is manual vs
// automated reference: each cell class is acceptable when the reference % falls
// within the binomial 95% CI of the manual count. Limits computed from the shared
// evaluator (@shared/rumke), identical to the server-side verdict.
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Microscope } from "lucide-react";
import { evaluateManualDiff } from "@shared/rumke";
import type { InsertStudy } from "@shared/schema";

interface Row { name: string; manualCount: string; referencePct: string }

const STANDARD_CLASSES = ["Neutrophils", "Lymphocytes", "Monocytes", "Eosinophils", "Basophils"];

export default function ManualDifferentialForm({
  testName, analyst, date, saving, onSave,
}: {
  testName: string;
  analyst: string;
  date: string;
  saving: boolean;
  onSave: (study: InsertStudy) => void;
}) {
  const [cellsCounted, setCellsCounted] = useState(100);
  const [referenceSource, setReferenceSource] = useState("");
  const [rows, setRows] = useState<Row[]>(STANDARD_CLASSES.map((name) => ({ name, manualCount: "", referencePct: "" })));

  // Live evaluation from the shared Rümke evaluator (same code the server runs).
  const evalRows = useMemo(() => {
    const classes = rows.map((r) => ({
      name: r.name,
      manualCount: r.manualCount === "" ? NaN : Number(r.manualCount),
      referencePct: r.referencePct === "" ? NaN : Number(r.referencePct),
    }));
    const res = evaluateManualDiff({ cellsCounted, referenceSource, classes });
    return res.classes.map((c, i) => ({ ...c, complete: rows[i].manualCount !== "" && rows[i].referencePct !== "" }));
  }, [rows, cellsCounted, referenceSource]);

  const countSum = rows.reduce((s, r) => s + (r.manualCount === "" ? 0 : Number(r.manualCount) || 0), 0);
  const anyComplete = evalRows.some((r) => r.complete);
  const overallPass = anyComplete && evalRows.every((r) => !r.complete || r.within);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { name: "", manualCount: "", referencePct: "" }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const canSave = !saving && cellsCounted > 0 && anyComplete && rows.some((r) => r.name.trim());

  const save = () => {
    const classes = rows
      .filter((r) => r.name.trim() && r.manualCount !== "" && r.referencePct !== "")
      .map((r) => ({ name: r.name.trim(), manualCount: Number(r.manualCount) || 0, referencePct: Number(r.referencePct) || 0 }));
    if (classes.length === 0) return;
    const refSrc = referenceSource.trim();
    const study: InsertStudy = {
      testName: testName.trim() || "Manual Differential",
      instrument: refSrc || "Manual differential",
      analyst: analyst.trim() || "-",
      date,
      studyType: "manual_diff",
      cliaAllowableError: 0,
      teaIsPercentage: 1,
      teaUnit: "%",
      cliaAbsoluteFloor: null,
      cliaAbsoluteUnit: null,
      cliaPresetLabel: "Rümke 95% CI (CLSI H20)",
      dataPoints: JSON.stringify({ cellsCounted, referenceSource: refSrc, classes }),
      instruments: JSON.stringify([refSrc || "Manual differential"]),
      status: "final",
    } as InsertStudy;
    onSave(study);
  };

  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "-");

  return (
    <Card data-testid="manual-diff-form">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Microscope size={16} className="text-primary" /> Manual Differential — Rümke 95% Confidence Limits (CLSI H20)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Each cell class is acceptable when the automated reference percentage falls within the binomial 95% confidence
          limits of the manual count. Low-frequency classes get wide limits at 100 cells that tighten at 200.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Cells counted</Label>
            <div className="flex items-center gap-2">
              {[100, 200].map((n) => (
                <Button key={n} type="button" size="sm" variant={cellsCounted === n ? "default" : "outline"}
                  onClick={() => setCellsCounted(n)} data-testid={`md-cells-${n}`}>{n}</Button>
              ))}
              <Input type="number" min={1} value={cellsCounted} onChange={(e) => setCellsCounted(Math.max(1, Math.floor(Number(e.target.value) || 0)))}
                className="max-w-[100px]" data-testid="md-cells-counted" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Reference (automated) source</Label>
            <Input placeholder="e.g. Sysmex XN-1000 automated differential" value={referenceSource}
              onChange={(e) => setReferenceSource(e.target.value)} data-testid="md-reference-source" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 px-2 font-medium">Cell class</th>
                <th className="py-2 px-2 font-medium">Manual count</th>
                <th className="py-2 px-2 font-medium">Manual %</th>
                <th className="py-2 px-2 font-medium">Reference %</th>
                <th className="py-2 px-2 font-medium">Rümke 95% CI</th>
                <th className="py-2 px-2 font-medium">Result</th>
                <th className="py-2 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ev = evalRows[i];
                return (
                  <tr key={i} className="border-b border-border/60">
                    <td className="py-1.5 px-2">
                      <Input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} className="h-8 min-w-[130px]" data-testid={`md-row-${i}-name`} />
                    </td>
                    <td className="py-1.5 px-2">
                      <Input type="number" min={0} value={r.manualCount} onChange={(e) => setRow(i, { manualCount: e.target.value })} className="h-8 max-w-[90px]" data-testid={`md-row-${i}-count`} />
                    </td>
                    <td className="py-1.5 px-2 text-muted-foreground">{r.manualCount === "" ? "-" : fmt(ev.manualPct) + "%"}</td>
                    <td className="py-1.5 px-2">
                      <Input type="number" min={0} step="any" value={r.referencePct} onChange={(e) => setRow(i, { referencePct: e.target.value })} className="h-8 max-w-[90px]" data-testid={`md-row-${i}-ref`} />
                    </td>
                    <td className="py-1.5 px-2 text-muted-foreground text-xs">{r.manualCount === "" ? "-" : `${fmt(ev.ciLoPct)} - ${fmt(ev.ciHiPct)}%`}</td>
                    <td className="py-1.5 px-2">
                      {ev.complete
                        ? (ev.within
                            ? <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600">Within</Badge>
                            : <Badge variant="destructive" className="text-[10px]">Exceeds</Badge>)
                        : <span className="text-xs text-muted-foreground">-</span>}
                    </td>
                    <td className="py-1.5 px-2">
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeRow(i)} aria-label="Remove class">
                        <Trash2 size={13} className="text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={addRow} data-testid="md-add-class">
            <Plus size={14} className="mr-1" /> Add cell class
          </Button>
          <span className={`text-xs ${countSum === cellsCounted ? "text-emerald-600" : "text-amber-600"}`} data-testid="md-count-sum">
            Counted {countSum} of {cellsCounted} cells{countSum === cellsCounted ? "" : " (should equal cells counted)"}
          </span>
        </div>

        <div className="rounded-md bg-primary/5 border border-primary/20 p-3 flex items-center justify-between">
          <span className="text-sm font-medium">Overall</span>
          <span data-testid="md-overall">
            {anyComplete
              ? (overallPass
                  ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-600">All classes within limits</Badge>
                  : <Badge variant="destructive">One or more classes exceed limits</Badge>)
              : <span className="text-xs text-muted-foreground">Enter counts and reference percentages</span>}
          </span>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={!canSave} data-testid="md-save">
            {saving ? "Saving..." : "Save Manual Differential"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
