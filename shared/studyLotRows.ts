// The reagent lots a study was run on, with their expiration dates, as rows for the results page's User
// Specifications card and the PDF's Supporting Data page (BUG-158, 2026-11-10).
//
// Lot-to-lot saved its two lot numbers but kept the expiration dates only in a draft, so a finished study lost
// them, and nothing showed them. The PT/INR form's Module 3 Old Lot Expiration was never saved at all.
// Both forms now save what was typed; this reads it back from the saved data.

type Row = [string, string];

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function parse(dataPoints: unknown): any {
  if (dataPoints && typeof dataPoints === "object") return dataPoints;
  if (typeof dataPoints !== "string") return null;
  try { return JSON.parse(dataPoints); } catch { return null; }
}

// "LOT-A (exp 2027-01-31)", the way the PDF already prints a reagent lot and its expiration.
function lotValue(lot: unknown, exp: unknown): string | null {
  const l = text(lot);
  const e = text(exp);
  if (!l && !e) return null;
  return `${l || "Not entered"}${e ? ` (exp ${e})` : ""}`;
}

export function studyLotRows(study: { studyType?: string | null; dataPoints?: unknown }): Row[] {
  const dp = parse(study?.dataPoints);
  if (!dp || typeof dp !== "object" || Array.isArray(dp)) return [];
  const rows: Row[] = [];
  const add = (label: string, lot: unknown, exp: unknown) => {
    const v = lotValue(lot, exp);
    if (v) rows.push([label, v]);
  };
  if (study.studyType === "lot_to_lot") {
    add("Current Lot", dp.currentLot, dp.currentLotExp);
    add("New Lot", dp.newLot, dp.newLotExp);
  } else if (study.studyType === "pt_coag" && dp.module3 && typeof dp.module3 === "object") {
    // Module 3's new lot is Instrument 1's reagent lot (ptCoagPayload.ts), so its expiration is that reagent's.
    add("Module 3 Old Lot", dp.module3.oldLot, dp.module3.oldLotExp);
    add("Module 3 New Lot", dp.module3.newLot, dp.reagentExp);
  }
  return rows;
}
