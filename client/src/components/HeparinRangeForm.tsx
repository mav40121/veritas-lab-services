// client/src/components/HeparinRangeForm.tsx
//
// Heparin Therapeutic Range, aPTT vs Anti-Xa (Brill-Edwards) study input (REQ-124, Michael Q134 = 1). Self-contained
// like ManualDifferentialForm: the parent renders it when studyType === "heparin_range" and passes testName/analyst/
// date + an onSave callback (the existing saveMutation). The live summary comes from the shared evaluator
// (@shared/heparinRange), the same code the server verdict, the results page and the PDF run.
import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, Activity, ClipboardPaste } from "lucide-react";
import { evaluateHeparinRange, normalizeHeparinInput, HEPARIN_MIN_SAMPLES, type HeparinRangeInput } from "@shared/heparinRange";
import type { InsertStudy } from "@shared/schema";

interface Row { patientCode: string; antiXa: string; aptt: string; inr: string; plasma: "fresh" | "frozen"; exclude: boolean; excludeReason: string }
const emptyRow = (): Row => ({ patientCode: "", antiXa: "", aptt: "", inr: "", plasma: "fresh", exclude: false, excludeReason: "" });
const sid = (i: number) => `S-${String(i + 1).padStart(2, "0")}`;

export default function HeparinRangeForm({
  testName, analyst, date, saving, onSave, initial,
}: {
  testName: string;
  analyst: string;
  date: string;
  saving: boolean;
  onSave: (study: InsertStudy) => void;
  // Editing an unsigned study: the saved analyzer and data points (the parent remounts the form once they load).
  initial?: { instrument?: string; data?: string | object | null };
}) {
  const init = useMemo(() => {
    let raw: any = null;
    try { raw = typeof initial?.data === "string" ? JSON.parse(initial.data) : initial?.data ?? null; } catch { raw = null; }
    return raw ? normalizeHeparinInput(raw) : null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- read once per mount
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  const [instrument, setInstrument] = useState(initial?.instrument ?? "");
  const [reagentLot, setReagentLot] = useState(init?.reagentLot ?? "");
  const [reagentExp, setReagentExp] = useState(init?.reagentExp ?? "");
  const [antiXaMethod, setAntiXaMethod] = useState(init?.antiXaMethod ?? "");
  const [antiXaLot, setAntiXaLot] = useState(init?.antiXaLot ?? "");
  const [targetLow, setTargetLow] = useState(init ? s(init.targetLow) : "0.3");
  const [targetHigh, setTargetHigh] = useState(init ? s(init.targetHigh) : "0.7");
  const [priorLot, setPriorLot] = useState(init?.priorLot ?? "");
  const [priorLow, setPriorLow] = useState(s(init?.priorLow));
  const [priorHigh, setPriorHigh] = useState(s(init?.priorHigh));
  const [rows, setRows] = useState<Row[]>(() => {
    const saved: Row[] = (init?.samples || []).map((x) => ({ patientCode: x.patientCode, antiXa: s(x.antiXa), aptt: s(x.aptt), inr: s(x.inr), plasma: x.plasma, exclude: x.exclude, excludeReason: x.excludeReason }));
    return saved.length >= HEPARIN_MIN_SAMPLES ? saved : [...saved, ...Array.from({ length: HEPARIN_MIN_SAMPLES - saved.length }, emptyRow)];
  });
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const input: HeparinRangeInput = useMemo(() => ({
    reagentLot, reagentExp, antiXaMethod, antiXaLot,
    targetLow: Number(targetLow), targetHigh: Number(targetHigh),
    priorLot, priorLow: priorLow === "" ? null : Number(priorLow), priorHigh: priorHigh === "" ? null : Number(priorHigh),
    samples: rows.map((r, i) => ({
      id: sid(i), patientCode: r.patientCode.trim(),
      antiXa: r.antiXa === "" ? null : Number(r.antiXa), aptt: r.aptt === "" ? null : Number(r.aptt), inr: r.inr === "" ? null : Number(r.inr),
      plasma: r.plasma, exclude: r.exclude, excludeReason: r.excludeReason.trim(),
    })),
  }), [reagentLot, reagentExp, antiXaMethod, antiXaLot, targetLow, targetHigh, priorLot, priorLow, priorHigh, rows]);
  const res = useMemo(() => evaluateHeparinRange(input), [input]);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  // Paste from a spreadsheet: one sample per line, columns patient code, anti-Xa, aPTT, INR (INR optional), separated
  // by tabs or commas. Filled rows are replaced from the top; blank rows are kept for more entries.
  const applyPaste = () => {
    const parsed = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(/\t|,/).map((c) => c.trim()))
      .filter((c) => c.length >= 3 && c[1] !== "" && !Number.isNaN(Number(c[1])) && !Number.isNaN(Number(c[2])))
      .map((c) => ({ ...emptyRow(), patientCode: c[0], antiXa: c[1], aptt: c[2], inr: c[3] && !Number.isNaN(Number(c[3])) ? c[3] : "" }));
    if (!parsed.length) return;
    setRows(parsed.length >= HEPARIN_MIN_SAMPLES ? parsed : [...parsed, ...Array.from({ length: HEPARIN_MIN_SAMPLES - parsed.length }, emptyRow)]);
    setPasteText("");
    setPasteOpen(false);
  };

  const headerOk = instrument.trim() && reagentLot.trim() && antiXaMethod.trim();
  const canSave = !saving && !!headerOk && res.n >= 3 && Number(targetLow) > 0 && Number(targetHigh) > Number(targetLow);

  const save = () => {
    const used = input.samples.filter((s) => s.antiXa !== null || s.aptt !== null || s.patientCode);
    const data: HeparinRangeInput = { ...input, samples: used.map((s, i) => ({ ...s, id: sid(i) })) };
    const inst = instrument.trim();
    const study: InsertStudy = {
      testName: testName.trim() || "aPTT",
      instrument: inst,
      analyst: analyst.trim() || "-",
      date,
      studyType: "heparin_range",
      cliaAllowableError: 0,
      teaIsPercentage: 0,
      teaUnit: "s",
      cliaAbsoluteFloor: null,
      cliaAbsoluteUnit: null,
      cliaPresetLabel: "Sample set criteria (Marlar 2017)",
      dataPoints: JSON.stringify(data),
      instruments: JSON.stringify([inst]),
      status: "final",
      createdAt: new Date().toISOString(),
    } as InsertStudy;
    onSave(study);
  };

  const fmt = (n: number | null, d = 1) => (n === null || !Number.isFinite(n) ? "-" : n.toFixed(d));

  return (
    <Card data-testid="heparin-range-form">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity size={16} className="text-primary" /> Heparin Therapeutic Range: aPTT vs Anti-Xa (Brill-Edwards)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Run aPTT on the new reagent lot and anti-Xa on the same plasma from patients receiving unfractionated heparin.
          VeritaCheck regresses aPTT on anti-Xa and reports the aPTT at the anti-Xa targets. The sample set needs at
          least {HEPARIN_MIN_SAMPLES} samples, fewer than 10% from any one patient, and no sample with an INR above 1.5
          (Marlar, Clement and Gausman 2017). Use a de-identified patient code, never a name or medical record number.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5"><Label>Coagulation analyzer *</Label><Input placeholder="e.g. Stago STA R Max 3" value={instrument} onChange={(e) => setInstrument(e.target.value)} data-testid="hr-instrument" /></div>
          <div className="space-y-1.5"><Label>aPTT reagent lot (new) *</Label><Input value={reagentLot} onChange={(e) => setReagentLot(e.target.value)} data-testid="hr-reagent-lot" /></div>
          <div className="space-y-1.5"><Label>aPTT reagent expiration</Label><Input type="date" value={reagentExp} onChange={(e) => setReagentExp(e.target.value)} data-testid="hr-reagent-exp" /></div>
          <div className="space-y-1.5"><Label>Anti-Xa method *</Label><Input placeholder="e.g. STA-Liquid Anti-Xa" value={antiXaMethod} onChange={(e) => setAntiXaMethod(e.target.value)} data-testid="hr-antixa-method" /></div>
          <div className="space-y-1.5"><Label>Anti-Xa reagent lot</Label><Input value={antiXaLot} onChange={(e) => setAntiXaLot(e.target.value)} data-testid="hr-antixa-lot" /></div>
          <div className="space-y-1.5">
            <Label>Anti-Xa target (IU/mL)</Label>
            <div className="flex items-center gap-2">
              <Input type="text" inputMode="decimal" value={targetLow} onChange={(e) => setTargetLow(e.target.value)} className="max-w-[90px]" data-testid="hr-target-low" />
              <span className="text-sm text-muted-foreground">to</span>
              <Input type="text" inputMode="decimal" value={targetHigh} onChange={(e) => setTargetHigh(e.target.value)} className="max-w-[90px]" data-testid="hr-target-high" />
            </div>
          </div>
          <div className="space-y-1.5"><Label>Prior lot (optional)</Label><Input value={priorLot} onChange={(e) => setPriorLot(e.target.value)} data-testid="hr-prior-lot" /></div>
          <div className="space-y-1.5">
            <Label>Prior lot range (seconds)</Label>
            <div className="flex items-center gap-2">
              <Input type="text" inputMode="decimal" value={priorLow} onChange={(e) => setPriorLow(e.target.value)} className="max-w-[90px]" data-testid="hr-prior-low" />
              <span className="text-sm text-muted-foreground">to</span>
              <Input type="text" inputMode="decimal" value={priorHigh} onChange={(e) => setPriorHigh(e.target.value)} className="max-w-[90px]" data-testid="hr-prior-high" />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-medium">Samples</span>
          <Button type="button" size="sm" variant="outline" onClick={() => setPasteOpen((v) => !v)} data-testid="hr-paste-toggle">
            <ClipboardPaste size={14} className="mr-1" /> Paste from a spreadsheet
          </Button>
        </div>
        {pasteOpen && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">One sample per line: patient code, anti-Xa, aPTT, INR (INR optional). Copy the columns from Excel and paste them here.</p>
            <Textarea rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)} data-testid="hr-paste-text" />
            <div className="flex justify-end"><Button type="button" size="sm" onClick={applyPaste} data-testid="hr-paste-apply">Fill the table</Button></div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="py-2 px-1.5 font-medium">Sample</th>
                <th className="py-2 px-1.5 font-medium">Patient code</th>
                <th className="py-2 px-1.5 font-medium">Anti-Xa (IU/mL)</th>
                <th className="py-2 px-1.5 font-medium">aPTT (s)</th>
                <th className="py-2 px-1.5 font-medium">INR</th>
                <th className="py-2 px-1.5 font-medium">Plasma</th>
                <th className="py-2 px-1.5 font-medium">Exclude</th>
                <th className="py-2 px-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-border/60 align-top">
                  <td className="py-1.5 px-1.5 text-xs text-muted-foreground whitespace-nowrap pt-3">{sid(i)}</td>
                  <td className="py-1.5 px-1.5"><Input value={r.patientCode} onChange={(e) => setRow(i, { patientCode: e.target.value })} className="h-8 min-w-[80px]" data-testid={`hr-row-${i}-patient`} /></td>
                  <td className="py-1.5 px-1.5"><Input type="text" inputMode="decimal" value={r.antiXa} onChange={(e) => setRow(i, { antiXa: e.target.value })} className="h-8 min-w-[70px]" data-testid={`hr-row-${i}-antixa`} /></td>
                  <td className="py-1.5 px-1.5"><Input type="text" inputMode="decimal" value={r.aptt} onChange={(e) => setRow(i, { aptt: e.target.value })} className="h-8 min-w-[70px]" data-testid={`hr-row-${i}-aptt`} /></td>
                  <td className="py-1.5 px-1.5"><Input type="text" inputMode="decimal" value={r.inr} onChange={(e) => setRow(i, { inr: e.target.value })} className="h-8 min-w-[60px]" data-testid={`hr-row-${i}-inr`} /></td>
                  <td className="py-1.5 px-1.5">
                    <select value={r.plasma} onChange={(e) => setRow(i, { plasma: e.target.value as Row["plasma"] })}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm" data-testid={`hr-row-${i}-plasma`} aria-label="Plasma">
                      <option value="fresh">Fresh</option>
                      <option value="frozen">Frozen</option>
                    </select>
                  </td>
                  <td className="py-1.5 px-1.5">
                    <div className="flex items-center gap-2 pt-1.5">
                      <Checkbox checked={r.exclude} onCheckedChange={(v) => setRow(i, { exclude: v === true })} aria-label="Exclude sample" data-testid={`hr-row-${i}-exclude`} />
                    </div>
                    {r.exclude && (
                      <Input placeholder="Reason" value={r.excludeReason} onChange={(e) => setRow(i, { excludeReason: e.target.value })}
                        className="h-8 mt-1 min-w-[140px]" data-testid={`hr-row-${i}-reason`} />
                    )}
                  </td>
                  <td className="py-1.5 px-1.5">
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeRow(i)} aria-label="Remove sample">
                      <Trash2 size={13} className="text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={addRow} data-testid="hr-add-sample">
          <Plus size={14} className="mr-1" /> Add sample
        </Button>

        <div className="rounded-md bg-primary/5 border border-primary/20 p-3 space-y-2" data-testid="hr-summary">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-medium">
              aPTT range: {res.rangeLowRounded !== null && res.rangeHighRounded !== null && res.slope !== null && res.slope > 0
                ? `${res.rangeLowRounded} to ${res.rangeHighRounded} s` : "-"}
              <span className="text-muted-foreground font-normal"> (n {res.n}, r {fmt(res.r, 3)})</span>
            </span>
            {res.n > 0 && (res.meets
              ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-600" data-testid="hr-verdict">Sample set meets the study criteria</Badge>
              : <Badge variant="outline" className="border-amber-500/40 text-amber-700" data-testid="hr-verdict">Sample set does not meet the study criteria yet</Badge>)}
          </div>
          <ul className="text-xs space-y-0.5">
            {res.criteria.map((c) => (
              <li key={c.key} className={c.met ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>
                {c.met ? "Met" : "Not met"}: {c.label} ({c.value})
              </li>
            ))}
          </ul>
        </div>

        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={!canSave} data-testid="hr-save">
            {saving ? "Saving..." : "Save Heparin Therapeutic Range Study"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
