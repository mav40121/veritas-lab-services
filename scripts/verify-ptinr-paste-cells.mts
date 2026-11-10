// Receipt for BUG-149 (SCAHC 2026-11-09): PT/INR Module 1 had 20 fixed cells and a column pasted from Excel filled
// only the first. Runs the paste helper (client/src/lib/pasteCells.ts), the censoring parser the cells use for typed
// and pasted text alike (shared/censoring.ts parseCensoredInput), and the unchanged payload builder
// (client/src/lib/ptCoagPayload.ts) on made-up values; no lab data.
//
//   npx tsx scripts/verify-ptinr-paste-cells.mts
import { splitPastedCells, fillCellsFrom } from "../client/src/lib/pasteCells";
import { parseCensoredInput, isCensored } from "../shared/censoring";
import { buildPtCoagPayload } from "../client/src/lib/ptCoagPayload";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 1. What Excel puts on the clipboard.
check("an Excel column (CRLF, trailing line break) splits into its values", same(splitPastedCells("11.4\r\n11.8\r\n12.1\r\n"), ["11.4", "11.8", "12.1"]));
check("an Excel row (tabs) splits into its values", same(splitPastedCells("11.4\t11.8\t12.1"), ["11.4", "11.8", "12.1"]));
check("a 2x2 block splits row by row", same(splitPastedCells("11.4\t11.8\r\n12.1\t<9.0\r\n"), ["11.4", "11.8", "12.1", "<9.0"]));
check("a blank cell inside a column stays blank", same(splitPastedCells("11.4\r\n\r\n11.8\r\n"), ["11.4", "", "11.8"]));
check("LF-only and spaces around values", same(splitPastedCells(" 11.4 \n 11.8 \n"), ["11.4", "11.8"]));
check("a single value is left to the browser (empty result)", splitPastedCells("11.4").length === 0 && splitPastedCells("11.4\r\n").length === 0 && splitPastedCells("").length === 0);

// 2. Filling cells from the one pasted into, adding cells past the end.
const twenty: (string | null)[] = Array(20).fill(null);
const col25 = Array.from({ length: 25 }, (_, i) => `v${i + 1}`);
const f1 = fillCellsFrom(twenty, 0, col25, null);
check("25 values pasted into cell 1 of 20: 25 cells, in order", f1.length === 25 && same(f1, col25));
const typed = twenty.slice(); typed[0] = "a"; typed[1] = "b";
const f2 = fillCellsFrom(typed, 18, ["x", "y", "z", "w", "q"], null);
check("5 values pasted into cell 19 of 20: 23 cells, cells before untouched", f2.length === 23 && f2[0] === "a" && f2[1] === "b" && same(f2.slice(18), ["x", "y", "z", "w", "q"]) && f2[17] === null);
const f3 = fillCellsFrom(typed, 2, ["x", "y"], null);
check("a paste that fits adds no cells", f3.length === 20 && same(f3.slice(0, 4), ["a", "b", "x", "y"]));
check("the input array is not changed", typed.length === 20 && typed[18] === null);

// 3. One parser for typed and pasted text.
const c = parseCensoredInput("<9.0");
check('"<9.0" parses to a censored value below 9', !!c?.censored && isCensored(c.censored) && c.censored.censor_direction === "below" && c.censored.censor_value === 9);
check('"11.8" parses to 11.8; "" and "abc" clear the cell', parseCensoredInput("11.8")?.value === 11.8 && parseCensoredInput("") === null && parseCensoredInput("abc") === null);

// 4. The saved data is built as before: numbers only, every one of them, no cap at 20.
const NORMALS = Array.from({ length: 25 }, (_, i) => +(11.2 + (i % 9) * 0.15).toFixed(2));
const cells: (number | null)[] = NORMALS.map((v, i) => (i === 12 ? null : v)); // cell 13 held "<9.0": the form sends it as empty
const rows = () => Array.from({ length: 20 }, (_, i) => ({ id: `S${String(i + 1).padStart(5, "0")}`, x: null as number | null, y: null as number | null }));
const form = { instrument1: { name: "Made-up CA-660", reagentLot: "", reagentExp: "", isi: 0.97, ptRILow: 10, ptRIHigh: 14, inrRILow: 0.9, inrRIHigh: 1.2, ptValues: cells },
  addlInstruments: [], instrument2Name: "Made-up B", module2Rows: rows(), module2TEa: 0.2, skipModule3: false, module3Rows: rows(), module3TEa: 0.2, oldLotNum: "" };
const want = NORMALS.filter((_, i) => i !== 12);
check("Run Study saves all 24 numbers of 25 cells (the censored one left out)", same(buildPtCoagPayload(form).module1Instruments[0].ptValues, want));
check("Save Draft saves the same 24", same((buildPtCoagPayload(form, { draft: true }).dataPoints as any).module1Instruments[0].ptValues, want));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
