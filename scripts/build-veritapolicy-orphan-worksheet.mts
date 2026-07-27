// scripts/build-veritapolicy-orphan-worksheet.mts
//
// Phase 2 triage tool for the VeritaPolicy orphan review (2026-07-27). Emits an
// Excel worksheet: one row per REMAINING orphan (catalog standard cited by no
// policy, after Phase 0 suppression + Phase 1 tags), with a heuristic proposed
// home policy pre-filled and decision columns for Michael to work down. Also
// seeds a "Named-instrument gaps" tab for the delegation-of-authority class
// (standard IS cited but the specific instrument is not surfaced) so those get
// captured by design, not just by memory.
//
// Run: npx tsx scripts/build-veritapolicy-orphan-worksheet.mts [outPath]
import { VERITAPOLICY_MASTER_LIST } from "../server/veritapolicyMasterList";
import { TJC_REQUIREMENTS } from "../server/tjcRequirements";
import { CAP_REQUIREMENTS } from "../server/capRequirements";
import { COLA_REQUIREMENTS } from "../server/colaRequirements";
import { CFR_REQUIREMENTS } from "../server/cfrRequirements";
import { existsSync } from "node:fs";

type Acc = "TJC" | "CAP" | "COLA" | "CFR";
const CFG: { acc: Acc; field: keyof (typeof VERITAPOLICY_MASTER_LIST)[number]; reqs: any[] }[] = [
  { acc: "TJC", field: "tjc_citations", reqs: TJC_REQUIREMENTS as any[] },
  { acc: "CAP", field: "cap_citations", reqs: CAP_REQUIREMENTS as any[] },
  { acc: "COLA", field: "cola_citations", reqs: COLA_REQUIREMENTS as any[] },
  { acc: "CFR", field: "cfr_citations", reqs: CFR_REQUIREMENTS as any[] },
];

function normStd(acc: Acc, s: string): string {
  let t = (s || "").trim().toUpperCase().replace(/§/g, "").replace(/\s+/g, " ").trim();
  if (acc === "COLA") t = t.replace(/^COLA\s+/, "");
  return t;
}
const STOP = new Set("policy plan written describing describes how the of and a an for to that this with or in on at is are all any laboratory lab requirement requirements documented document procedure procedures defines define including includes related per records record data health its into other under when after each".split(" "));
const toks = (s: string) => new Set((s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)));
const overlap = (a: Set<string>, b: Set<string>) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n; };
const policyTok = VERITAPOLICY_MASTER_LIST.map(p => ({ name: p.policy_name, t: toks(p.policy_name + " " + p.description) }));

// Same intentionally-unmapped CFR set as the audit (Phase 0) so the worksheet
// does not re-list structural sections.
const CFR_SKIP = new Set<string>([
  "42 CFR 493.1","42 CFR 493.5","42 CFR 493.19","42 CFR 493.20","42 CFR 493.25","42 CFR 493.43","42 CFR 493.51","42 CFR 493.53","42 CFR 493.55","42 CFR 493.61","42 CFR 493.63","42 CFR 493.553","42 CFR 493.551","42 CFR 493.557","42 CFR 493.807","42 CFR 493.833","42 CFR 493.839","42 CFR 493.901","42 CFR 493.1203","42 CFR 493.1205","42 CFR 493.1207","42 CFR 493.1208","42 CFR 493.1210","42 CFR 493.1211","42 CFR 493.1212","42 CFR 493.1213","42 CFR 493.1220","42 CFR 493.1221","42 CFR 493.1225","42 CFR 493.1226","42 CFR 493.1227","42 CFR 493.1240","42 CFR 493.1361","42 CFR 493.1409","42 CFR 493.1415","42 CFR 493.1481","42 CFR 493.1771","42 CFR 493.1777","42 CFR 493.1780","42 CFR 493.1800","42 CFR 493.1807","42 CFR 493.1808","42 CFR 493.1809","42 CFR 493.1826","42 CFR 493.1828","42 CFR 493.1832","42 CFR 493.1836","42 CFR 493.1842",
]);

type Row = { acc: Acc; std: string; name: string; detail: string; home: string; score: number };
const rows: Row[] = [];
for (const { acc, field, reqs } of CFG) {
  const referenced = new Set<string>();
  for (const p of VERITAPOLICY_MASTER_LIST) for (const c of (((p as any)[field] as string) || "").split(";")) { const k = normStd(acc, c); if (k) referenced.add(k); }
  const seen = new Set<string>();
  for (const r of reqs) {
    const key = normStd(acc, r.standard);
    if (!key || referenced.has(key) || seen.has(key)) continue;
    seen.add(key);
    if (acc === "CFR" && CFR_SKIP.has(key)) continue;
    const ot = toks(r.name + " " + r.description);
    let home = "", score = 0;
    for (const p of policyTok) { const s = overlap(ot, p.t); if (s > score) { score = s; home = p.name; } }
    rows.push({ acc, std: r.standard, name: r.name, detail: (r.description || "").slice(0, 240), home: score >= 2 ? home : "", score });
  }
}
rows.sort((a, b) => a.acc.localeCompare(b.acc) || a.std.localeCompare(b.std));

const TEAL = "FF01696F", ALT = "FFEBF3F8", BORDER = "FFD0D0D0", TEXT = "FF28251D";
const outArg = process.argv[2];
const candidates = [outArg, "C:/Users/veril/OneDrive/Desktop/VeritaPolicy_Orphan_Triage_Worksheet.xlsx", "C:/Users/veril/Desktop/VeritaPolicy_Orphan_Triage_Worksheet.xlsx"].filter(Boolean) as string[];
const outPath = outArg || (existsSync("C:/Users/veril/OneDrive/Desktop") ? candidates[1] : candidates[2]);

const { default: ExcelJS } = await import("exceljs");
const wb = new ExcelJS.Workbook();

// Instructions sheet
const info = wb.addWorksheet("How to use");
info.columns = [{ width: 110 }];
const infoLines = [
  "VeritaPolicy Orphan Triage Worksheet (Phase 2)",
  "",
  "Each row on the Orphan Triage tab is an accreditor standard the VeritaPolicy catalog defines but no policy currently cites.",
  "Structural CFR sections (Conditions, registration, enforcement) were already suppressed in Phase 0; the 10 clean tag-adds shipped in Phase 1.",
  "",
  "For each row, set Decision:",
  "  Map to existing  -> the standard is covered by a policy that just is not tagged. Put that policy in Target Policy; I will add the citation.",
  "  Author new policy -> no policy covers it; it is a genuine content gap for Phase 3.",
  "  Not applicable    -> out of scope for this lab menu; note why.",
  "Proposed Home is a heuristic best guess (word overlap) and is often wrong; treat it as a starting point, not an answer.",
  "",
  "The second tab, Named-instrument gaps, is a different class: the standard IS cited, but a specific required instrument is not surfaced in any policy scope (the delegation-of-authority finding). Add rows here as you spot them.",
];
infoLines.forEach((t, i) => { const c = info.getCell(i + 1, 1); c.value = t; c.font = { name: "Calibri", size: i === 0 ? 14 : 10, bold: i === 0, color: { argb: TEXT } }; c.alignment = { wrapText: true, vertical: "middle" }; });

// Orphan triage sheet
const ws = wb.addWorksheet("Orphan Triage");
const headers = ["Accreditor", "Standard", "Requirement", "Requirement detail", "Proposed home (heuristic)", "Match", "Decision", "Target policy", "Notes"];
const widths = [12, 18, 40, 60, 40, 8, 20, 40, 40];
ws.columns = headers.map((h, i) => ({ header: h, width: widths[i] }));
const hr = ws.getRow(1);
hr.height = 22;
hr.eachCell((c, col) => {
  if (col > headers.length) return;
  c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
  c.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
  c.border = { top: { style: "thin", color: { argb: BORDER } }, bottom: { style: "thin", color: { argb: BORDER } }, left: { style: "thin", color: { argb: BORDER } }, right: { style: "thin", color: { argb: BORDER } } };
});
rows.forEach((r, i) => {
  const row = ws.addRow([r.acc, r.std, r.name, r.detail, r.home, r.score || "", "", "", ""]);
  row.height = 30;
  const even = i % 2 === 1;
  row.eachCell((c, col) => {
    if (col > headers.length) return;
    c.font = { name: "Calibri", size: 10, color: { argb: TEXT } };
    c.alignment = { vertical: "middle", wrapText: true };
    if (even) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT } };
    c.border = { top: { style: "thin", color: { argb: BORDER } }, bottom: { style: "thin", color: { argb: BORDER } }, left: { style: "thin", color: { argb: BORDER } }, right: { style: "thin", color: { argb: BORDER } } };
  });
  // Decision dropdown
  ws.getCell(row.number, 7).dataValidation = { type: "list", allowBlank: true, formulae: ['"Map to existing,Author new policy,Not applicable"'] };
});
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

// Named-instrument gaps sheet (seed with the delegation finding)
const ng = wb.addWorksheet("Named-instrument gaps");
const ngHeaders = ["Standard (cited)", "Required instrument not surfaced", "Policy that should name it", "Decision", "Notes"];
const ngWidths = [22, 50, 45, 20, 40];
ng.columns = ngHeaders.map((h, i) => ({ header: h, width: ngWidths[i] }));
const ngh = ng.getRow(1); ngh.height = 22;
ngh.eachCell((c, col) => { if (col > ngHeaders.length) return; c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } }; c.alignment = { vertical: "middle", wrapText: true }; });
const seed = ng.addRow(["42 CFR 493.1445", "Director's written delegation of specified duties to qualified individuals (delegation of authority record)", "Laboratory Governance and Leadership Policy", "Surfaced in scope 2026-07-27 (Option 1)", "Standard was already cited; scope now names the written delegation. Consider a delegation record artifact in the DOCX body."]);
seed.height = 44; seed.eachCell((c, col) => { if (col > ngHeaders.length) return; c.font = { name: "Calibri", size: 10, color: { argb: TEXT } }; c.alignment = { vertical: "middle", wrapText: true }; });
ng.views = [{ state: "frozen", ySplit: 1 }];

await wb.xlsx.writeFile(outPath);
console.log(`Wrote ${rows.length} orphan rows -> ${outPath}`);
console.log(`  by accreditor: ` + ["TJC", "CAP", "COLA", "CFR"].map(a => `${a} ${rows.filter(r => r.acc === a).length}`).join(", "));
