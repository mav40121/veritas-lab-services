// scripts/verify-veritamap-export-bands.mjs
//
// Receipt for PR 4: the VeritaMap Excel export renders every age/sex band.
//
// Before this, the export chose ONE band per analyte. For a lab whose creatinine
// is genuinely peds-vs-adult, that silently published half the lab's own values
// in a document a surveyor reads. Now it is one row per analyte PER BAND.
//
// Mirrors the row-building logic in the export route and asserts:
//   1. a single-band analyte still produces EXACTLY ONE row (every lab today),
//   2. an analyte with no values entered still produces one "Not established" row,
//   3. a banded analyte produces one row per band, each carrying its OWN values
//      and its OWN provenance (MEC review / 493.1253 attestation are per band),
//   4. the band column sits after Instruments so the C2 freeze still pins
//      Analyte + Instruments,
//   5. headers and column widths stay in lockstep (a silent off-by-one here
//      shifts every value into the wrong column of a compliance document).
//
// Run: node scripts/verify-veritamap-export-bands.mjs

import { readFileSync } from "fs";

const ALL_AGES = { ageMinDays: 0, ageMaxDays: 999999, sex: "A", label: "All ages" };
const NE = "Not established";
const DAYS_18Y = 6570;

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

function deriveBandLabel(minD, maxD, sex) {
  const fmt = (d) => (d % 365 === 0 ? `${d / 365} y` : `${d} d`);
  let age;
  if (minD === ALL_AGES.ageMinDays && maxD === ALL_AGES.ageMaxDays) age = "All ages";
  else if (maxD === ALL_AGES.ageMaxDays) age = `${fmt(minD)} and older`;
  else if (minD === 0) age = `0 to ${fmt(maxD)}`;
  else age = `${fmt(minD)} to ${fmt(maxD)}`;
  return age + (sex === "F" ? ", female" : sex === "M" ? ", male" : "");
}

// Mirrors the export's row builder (the band-relevant columns).
const COL = { ANALYTE: 0, INSTRUMENTS: 1, BAND: 9, UNITS: 10, REF_LO: 11, REF_HI: 12, CRIT_LO: 13, CRIT_HI: 14, MEC: 15 };
function buildRows(tests, analyteValueBands) {
  return tests.flatMap((t) => {
    const bands = analyteValueBands[t.analyte] ?? [];
    const bandList = bands.length ? bands : [null];
    return bandList.map((av) => {
      const bandLabel = !av
        ? ALL_AGES.label
        : (av.band_label || deriveBandLabel(av.age_min_days ?? ALL_AGES.ageMinDays, av.age_max_days ?? ALL_AGES.ageMaxDays, av.sex ?? ALL_AGES.sex));
      const mecCell = av?.mec_reviewed_at
        ? `Reviewed/approved ${String(av.mec_reviewed_at).slice(0, 10)}${av.mec_reviewed_by ? ` (recorded by ${av.mec_reviewed_by})` : ""}`
        : (av?.critical_low || av?.critical_high) ? "Pending MEC review" : "";
      const row = new Array(30).fill("");
      row[COL.ANALYTE] = t.analyte;
      row[COL.INSTRUMENTS] = (t.instruments || []).map((i) => `${i.instrument_name} [${i.role}]`).join("; ");
      row[COL.BAND] = bandLabel;
      row[COL.UNITS] = av?.units || NE;
      row[COL.REF_LO] = av?.ref_range_low || NE;
      row[COL.REF_HI] = av?.ref_range_high || NE;
      row[COL.CRIT_LO] = av?.critical_low || NE;
      row[COL.CRIT_HI] = av?.critical_high || NE;
      row[COL.MEC] = mecCell;
      return row;
    });
  });
}

const tests = [
  { analyte: "Sodium", instruments: [{ instrument_name: "VITROS", role: "Primary" }] },
  { analyte: "Creatinine", instruments: [{ instrument_name: "VITROS", role: "Primary" }] },
  { analyte: "Acetone", instruments: [{ instrument_name: "Kit", role: "Primary" }] }, // no values entered
];
const bands = {
  Sodium: [{ analyte: "Sodium", age_min_days: 0, age_max_days: 999999, sex: "A", band_label: "All ages", units: "mmol/L", ref_range_low: "136", ref_range_high: "145", critical_low: "120", critical_high: "160", mec_reviewed_at: "2026-06-17", mec_reviewed_by: "MEC" }],
  Creatinine: [
    { analyte: "Creatinine", age_min_days: 0, age_max_days: DAYS_18Y, sex: "A", band_label: "0 to 18 y", units: "mg/dL", ref_range_low: "0.2", ref_range_high: "0.9", critical_high: "0.99" },
    { analyte: "Creatinine", age_min_days: DAYS_18Y, age_max_days: 999999, sex: "A", band_label: "18 y and older", units: "mg/dL", ref_range_low: "0.6", ref_range_high: "1.2" },
  ],
};
const rows = buildRows(tests, bands);
const rowsFor = (a) => rows.filter((r) => r[COL.ANALYTE] === a);

console.log("\nCase 1: a single-band analyte still produces EXACTLY ONE row");
check("Sodium -> 1 row", rowsFor("Sodium").length === 1, `got ${rowsFor("Sodium").length}`);
check("labelled 'All ages'", rowsFor("Sodium")[0][COL.BAND] === "All ages");
check("its values are intact", rowsFor("Sodium")[0][COL.REF_LO] === "136" && rowsFor("Sodium")[0][COL.CRIT_HI] === "160");

console.log("\nCase 2: an analyte with NO values entered still produces one row");
check("Acetone -> 1 row", rowsFor("Acetone").length === 1);
check("band reads 'All ages' (no band invented)", rowsFor("Acetone")[0][COL.BAND] === "All ages");
check("values read 'Not established'", rowsFor("Acetone")[0][COL.REF_LO] === NE && rowsFor("Acetone")[0][COL.UNITS] === NE);

console.log("\nCase 3: a banded analyte produces one row PER BAND with its own values");
const creat = rowsFor("Creatinine");
check("Creatinine -> 2 rows", creat.length === 2, `got ${creat.length}`);
check("peds row carries the peds range", creat[0][COL.BAND] === "0 to 18 y" && creat[0][COL.REF_LO] === "0.2" && creat[0][COL.REF_HI] === "0.9");
check("peds row carries the peds critical", creat[0][COL.CRIT_HI] === "0.99");
check("adult row carries the adult range", creat[1][COL.BAND] === "18 y and older" && creat[1][COL.REF_LO] === "0.6" && creat[1][COL.REF_HI] === "1.2");
check("adult row has NO critical (the lab did not state one)", creat[1][COL.CRIT_HI] === NE);
check("both rows repeat the analyte so each row is self-describing", creat.every((r) => r[COL.ANALYTE] === "Creatinine"));
check("both rows repeat the instruments", creat.every((r) => r[COL.INSTRUMENTS] === "VITROS [Primary]"));

console.log("\nCase 4: provenance resolves PER BAND, not per analyte");
check("Sodium's MEC review shows on its band", rowsFor("Sodium")[0][COL.MEC].startsWith("Reviewed/approved 2026-06-17"));
check("Creatinine peds band shows Pending MEC review (it has a critical)", creat[0][COL.MEC] === "Pending MEC review");
check("Creatinine adult band shows nothing (no critical to review)", creat[1][COL.MEC] === "");

console.log("\nCase 5: shipped source -- column layout and freeze pane");
// Normalise newlines: this repo checks out CRLF on Windows, and Node's
// readFileSync does not translate them the way Python's read_text does. Without
// this, any needle containing "\n" silently fails to match and indexOf returns
// -1, which then makes a slice grab an unrelated block and "pass" nonsense.
const src = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const hdrBlock = src.slice(src.indexOf('"Analyte", "Instruments", "Serial Number"'), src.indexOf('// Column widths'));
const bandIdx = hdrBlock.indexOf('"Age / Sex Band"');
check("export has an 'Age / Sex Band' column", bandIdx > 0);
check("it is NOT column A or B (freeze pane is C2 = Analyte + Instruments)",
  bandIdx > hdrBlock.indexOf('"Instruments"'));
check("it sits immediately before 'Units of Measure'", bandIdx < hdrBlock.indexOf('"Units of Measure"'));
check("freeze pane is still C2", /topLeftCell: "C2"/.test(src) && /xSplit: 2/.test(src));
check("export builds one row per band (flatMap), not one per analyte", /const rows = tests\.flatMap/.test(src));
check("the last-band-wins collapse is gone from the export", !/analyteValuesMap\[t\.analyte\]/.test(src));

console.log("\nCase 6: headers, column widths and row length stay in lockstep");
// An off-by-one here shifts every value into the wrong column of a document a
// surveyor reads, and nothing else would catch it. Compare the three counts to
// EACH OTHER rather than to a hand-counted number.
//
// Locating the right block matters: routes.ts has several ExcelJS exports, each
// with its own `const headers` / `const colWidths`, and the comment above this
// export also mentions the band column. So: find the headers ARRAY that actually
// contains the element, then the first colWidths after it.
const hdrStarts = [...src.matchAll(/const headers = \[/g)].map((m) => m.index);
const vmHdrStart = hdrStarts.filter((idx) => {
  const block = src.slice(idx, src.indexOf("];", idx));
  return block.includes('"Age / Sex Band"');
});
check("found exactly one export whose headers contain the band column", vmHdrStart.length === 1, `got ${vmHdrStart.length}`);
const hStart = vmHdrStart[0];
const hEnd = src.indexOf("];", hStart);
const headerCount = (src.slice(hStart, hEnd).match(/"[^"]*"/g) || []).length;
const cwStart = src.indexOf("const colWidths = [", hEnd);
const cwEnd = src.indexOf("];", cwStart);
const widthCount = (src.slice(cwStart, cwEnd).match(/\d+/g) || []).length;
check(`headers (${headerCount}) === colWidths (${widthCount})`, headerCount === widthCount);
check("band column is at the index the row builder writes it to (9)",
  (src.slice(hStart, hEnd).match(/"[^"]*"/g) || []).indexOf('"Age / Sex Band"') === 9);

// Parse the SHIPPED row literal, not this script's mirror. A mirror only proves
// the mirror; this catches a real off-by-one, which would silently shift every
// value one column left in a document a surveyor reads.
const rStart = src.indexOf("return [\n            t.analyte,");
const rEnd = src.indexOf("];", rStart);
const rowBlock = src.slice(rStart + "return [".length, rEnd);
let depth = 0, realEntries = 1;
for (const ch of rowBlock) {
  if ("([{".includes(ch)) depth++;
  else if (")]}".includes(ch)) depth--;
  else if (ch === "," && depth === 0) realEntries++;
}
if (rowBlock.trimEnd().endsWith(",")) realEntries--;
check(`SHIPPED row literal (${realEntries}) === headers (${headerCount})`, realEntries === headerCount);
check(`this script's mirror (${rows[0].length}) matches the shipped row (${realEntries})`, rows[0].length === realEntries);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
