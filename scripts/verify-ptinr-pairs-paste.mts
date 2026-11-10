// scripts/verify-ptinr-pairs-paste.mts
// Receipt for BUG-162's helpers (client/src/lib/pasteCells.ts splitPastedRows, fillPairsFrom, parsePairCell;
// client/src/lib/ptCoagPayload.ts readPtPairRows). No DB, no browser. Run: npx tsx scripts/verify-ptinr-pairs-paste.mts
import * as paste from "../client/src/lib/pasteCells";
import * as payload from "../client/src/lib/ptCoagPayload";

let failures = 0, passes = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const P: any = paste, L: any = payload;
const has = (m: any, f: string) => typeof m[f] === "function";
check("0. the helpers exist", has(P, "splitPastedRows") && has(P, "fillPairsFrom") && has(P, "parsePairCell") && has(L, "readPtPairRows"));
if (has(P, "splitPastedRows") && has(P, "fillPairsFrom") && has(P, "parsePairCell") && has(L, "readPtPairRows")) {
  const { splitPastedRows, fillPairsFrom, parsePairCell } = P;
  const { readPtPairRows } = L;
  const rows20 = Array.from({ length: 20 }, (_: unknown, i: number) => ({ id: `S${String(i + 1).padStart(5, "0")}`, x: null, y: null }));

  // splitPastedRows
  check("1a. Excel's two columns (tab, CRLF, trailing break) split into rows of two", JSON.stringify(splitPastedRows("10.5\t10.71\r\n10.8\t11.02\r\n")) === JSON.stringify([["10.5", "10.71"], ["10.8", "11.02"]]));
  check("1b. a one-column paste gives one cell per row", JSON.stringify(splitPastedRows("11.2\n11.4\n")) === JSON.stringify([["11.2"], ["11.4"]]));
  check("1c. a single value returns [] (the browser pastes it)", splitPastedRows("11.2").length === 0 && splitPastedRows("11.2\r\n").length === 0);
  check("1d. one row of two cells counts as a range", JSON.stringify(splitPastedRows("11.2\t11.4")) === JSON.stringify([["11.2", "11.4"]]));

  // fillPairsFrom
  const pairs = Array.from({ length: 25 }, (_: unknown, i: number) => [String(10 + i), String(20 + i)]);
  const a = fillPairsFrom(rows20, 0, "x", pairs, parsePairCell);
  check("2a. 25 two-column rows from row 1's X: 25 rows, both columns, ids run on to S00025", a.length === 25 && a[24].x === 34 && a[24].y === 44 && a[24].id === "S00025" && a[0].x === 10 && a[0].y === 20, JSON.stringify(a[24]));
  const b = fillPairsFrom(rows20, 4, "y", [["7.1"], ["7.2"]], parsePairCell);
  check("2b. one column into row 5's Y: only rows 5-6 Y change, 20 rows kept", b.length === 20 && b[4].y === 7.1 && b[5].y === 7.2 && b[4].x === null && b[3].y === null && b[6].y === null);
  const c = fillPairsFrom(rows20, 0, "y", [["1", "2"], ["3", "4"]], parsePairCell);
  check("2c. two columns started in the Y cell fill Y only (from the first column)", c[0].y === 1 && c[1].y === 3 && c[0].x === null);
  const d = fillPairsFrom(rows20, 18, "x", [["1", "2"], ["3", "4"], ["5", "6"], ["7", "8"]], parsePairCell);
  check("2d. a paste starting at row 19 runs past 20 and adds rows S00021, S00022", d.length === 22 && d[21].id === "S00022" && d[21].x === 7 && d[18].x === 1);
  const e = fillPairsFrom(rows20, 0, "x", [["", "5"], ["abc", ""], ["1,234.5", "2"]], parsePairCell);
  check("2e. a blank or non-number cell clears to null; a thousands comma is dropped", e[0].x === null && e[0].y === 5 && e[1].x === null && e[1].y === null && e[2].x === 1234.5);
  check("2f. the input rows are not changed in place", rows20.every((r: any) => r.x === null && r.y === null) && rows20.length === 20);

  // readPtPairRows
  const saved = Array.from({ length: 25 }, (_: unknown, i: number) => ({ id: `S${String(i + 1).padStart(5, "0")}`, x: 10 + i, y: 20 + i }));
  const r25 = readPtPairRows(saved);
  check("3a. Edit reads all 25 saved pairs back (it read the first 20)", r25.length === 25 && r25[24].x === 34 && r25[24].id === "S00025");
  const r3 = readPtPairRows(saved.slice(0, 3));
  check("3b. 3 saved pairs reopen as 20 rows, the 3 first", r3.length === 20 && r3[2].y === 22 && r3[3].x === null && r3[19].id === "S00020");
  check("3c. no data or junk reopens as 20 empty rows", readPtPairRows(null).length === 20 && readPtPairRows([{ x: "a" }])[0].x === null);
}
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
