// The PT/INR Geometric Mean Calculator's saved data (study type pt_coag), built in one place so Run Study and
// Save Draft store the same shape, the one the results page (studyResults.ts), the PDF and the stored verdict
// (server/ptCoagVerdict.ts) read, and the edit form reads back.
//
// SCAHC report 2026-11-09 ("the Geometric Mean ... appears to not be working"), two faults in the form:
//   1. Run Study saved an untouched Module 3 as { data: [] } unless "Skip" was ticked. The stored verdict counts a
//      saved comparison module, and one with no pairs has none within TEa, so a study whose normals all passed was
//      stored FAIL (the dashboard said FAIL) while the results page and PDF, which skip a module with fewer than
//      3 pairs, said PASS. A comparison module is now saved only with at least 3 complete pairs, the results
//      page's rule; Module 2 already worked that way.
//   2. Save Draft sent the calibration-verification grid instead of this form, so a draft kept none of the PT
//      results and reopened empty. A draft now saves this form as typed (partial pair rows included, so it
//      reopens as left); its status is "draft", so nothing is judged until Run Study.

export type PtPairRow = { id: string; x: number | null; y: number | null };

// Edit reads a saved Module 2 or 3 back into its rows: every saved pair, and at least 20 rows (BUG-162: it read only the
// first 20, so a comparison saved with more reopened short, and a re-run dropped the rest).
export function readPtPairRows(data: unknown): PtPairRow[] {
  const saved = Array.isArray(data) ? data : [];
  return Array.from({ length: Math.max(20, saved.length) }, (_, i) => {
    const d: any = saved[i];
    return {
      id: d && typeof d.id === "string" ? d.id : `S${String(i + 1).padStart(5, "0")}`,
      x: d && typeof d.x === "number" ? d.x : null,
      y: d && typeof d.y === "number" ? d.y : null,
    };
  });
}

export interface PtInstrumentForm {
  name: string;
  reagentLot: string;
  reagentExp: string;
  isi: number;
  ptRILow: number;
  ptRIHigh: number;
  inrRILow: number;
  inrRIHigh: number;
  ptValues: (number | null)[];
}

export interface PtCoagForm {
  instrument1: PtInstrumentForm;           // Instrument 1 (its name is also Module 2's X)
  addlInstruments: PtInstrumentForm[];     // Instruments 2..N, each with its own geometric mean
  instrument2Name: string;                 // Module 2's Y
  module2Rows: PtPairRow[];
  module2TEa: number;                      // fraction, 0.20 = 20%
  skipModule3: boolean;
  module3Rows: PtPairRow[];
  module3TEa: number;
  oldLotNum: string;
  oldLotExp: string;                       // BUG-158: typed on the form and never saved before
}

// A comparison module counts only with this many complete pairs (studyResults.ts and the form agree).
export const PT_MIN_COMPARISON_PAIRS = 3;

const isNum = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);

type CompleteRow = { id: string; x: number; y: number };
const complete = (rows: PtPairRow[]): CompleteRow[] => rows.filter((d) => isNum(d.x) && isNum(d.y)) as CompleteRow[];
const comparisonInput = (rows: CompleteRow[], tea: number) =>
  ({ xValues: rows.map((d) => d.x), yValues: rows.map((d) => d.y), specimenIds: rows.map((d) => d.id), tea });

export function buildPtCoagPayload(f: PtCoagForm, opts: { draft?: boolean } = {}) {
  const block = (b: PtInstrumentForm, name: string) => ({
    name,
    ptValues: b.ptValues.filter(isNum),
    isi: b.isi,
    ptRI: { low: b.ptRILow, high: b.ptRIHigh },
    inrRI: { low: b.inrRILow, high: b.inrRIHigh },
    reagentLot: b.reagentLot,
    reagentExp: b.reagentExp,
  });
  const i1 = f.instrument1;
  const module1Instruments = [
    block(i1, i1.name),
    ...f.addlInstruments.map((b, i) => block(b, b.name.trim() || `Instrument ${i + 2}`)),
  ];

  const m2Pairs = complete(f.module2Rows);
  const m3Pairs = f.skipModule3 ? [] : complete(f.module3Rows);
  const m2Used = m2Pairs.length >= PT_MIN_COMPARISON_PAIRS;
  const m3Used = m3Pairs.length >= PT_MIN_COMPARISON_PAIRS;
  const m2Data = m2Used ? comparisonInput(m2Pairs, f.module2TEa) : null;
  const m3Data = m3Used ? comparisonInput(m3Pairs, f.module3TEa) : null;

  const module2 = opts.draft
    ? { data: f.module2Rows, tea: f.module2TEa, inst1: i1.name, inst2: f.instrument2Name }
    : m2Used ? { data: m2Pairs, tea: f.module2TEa, inst1: i1.name, inst2: f.instrument2Name } : null;
  const module3 = f.skipModule3
    ? null
    : opts.draft
    ? { data: f.module3Rows, tea: f.module3TEa, oldLot: f.oldLotNum, oldLotExp: f.oldLotExp, newLot: i1.reagentLot }
    : m3Used ? { data: m3Pairs, tea: f.module3TEa, oldLot: f.oldLotNum, oldLotExp: f.oldLotExp, newLot: i1.reagentLot } : null;

  const dataPoints = {
    module1Instruments,
    module1: { ptValues: module1Instruments[0].ptValues, isi: i1.isi, ptRI: module1Instruments[0].ptRI, inrRI: module1Instruments[0].inrRI },
    module2,
    module3,
    instrument: i1.name,
    reagentLot: i1.reagentLot,
    reagentExp: i1.reagentExp,
  };
  return { module1Instruments, m2Data, m3Data, dataPoints };
}
