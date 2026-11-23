// scripts/verify-antibiogram-rules.mts
// Receipt for shared/antibiogramRules.ts (parking lot #81, Decision 14 = 2): every branch of the antibiogram rules on a fixed
// input set, and the CFR text pinned to what eCFR returned (api/versioner/v1/full/2026-11-19/title-42.xml, sections 482.42 and
// 485.640). The defaults are the lab's settings, pending confirmation against CLSI M39 ED5 (2022). Exits non-zero on any failure.
import {
  CFR_AS_OF, CFR_STEWARDSHIP, STEWARDSHIP_DEFAULTS, computeAntibiogram, isYmd, monthsBefore, parseAntibiogramCsv, parseCount, parseCsvText,
  parseOrganismGroup, parseSettings, percentSusceptible, stewardshipReadiness, validateRow, validateRows, type AbgRow,
} from "../shared/antibiogramRules";

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

// Defaults (pending M39)
check("defaults: 30 isolates, suppress, 12 months", STEWARDSHIP_DEFAULTS.isolate_threshold === 30 && STEWARDSHIP_DEFAULTS.below_threshold === "suppress" && STEWARDSHIP_DEFAULTS.period_months === 12);

// Percent susceptible: whole percent, half rounds up, nothing tested is null
const pct: [number, number, number | null][] = [[210, 400, 53], [362, 412, 88], [109, 188, 58], [188, 188, 100], [0, 10, 0], [1, 3, 33], [2, 3, 67], [1, 8, 13], [5, 0, null]];
for (const [s, t, want] of pct) check(`percent ${s}/${t} = ${want}`, percentSusceptible(s, t) === want, String(percentSusceptible(s, t)));

// Counts
check("count: '1,330' is 1330", parseCount("1,330") === 1330);
check("count: blank is null", parseCount("  ") === null && parseCount(null) === null);
check("count: 12.5 is an error", typeof parseCount("12.5") === "object");
check("count: -3 is an error", typeof parseCount("-3") === "object");
check("count: over a million is an error", typeof parseCount("1000001") === "object");

// Groups
for (const [v, want] of [["Gram-negative", "gram_negative"], ["gram negative", "gram_negative"], ["GN", "gram_negative"], ["neg", "gram_negative"], ["Gram positive", "gram_positive"], ["gp", "gram_positive"], ["", "other"], ["yeast", "other"]] as const) {
  check(`group "${v}" -> ${want}`, parseOrganismGroup(v) === want);
}

// One row
const ok = validateRow({ organism: " E. coli ", antimicrobial: "Ampicillin", tested: "400", susceptible: 210, intermediate: "", resistant: "190" }, 1);
check("row: good row reads, trims, blank I is null", !!ok.row && ok.row.organism === "E. coli" && ok.row.intermediate === null && ok.row.resistant === 190 && ok.errors.length === 0);
for (const [label, raw] of [
  ["blank organism", { organism: "", antimicrobial: "A", tested: 1, susceptible: 1 }],
  ["blank antimicrobial", { organism: "O", antimicrobial: " ", tested: 1, susceptible: 1 }],
  ["blank tested", { organism: "O", antimicrobial: "A", tested: "", susceptible: 1 }],
  ["tested 0", { organism: "O", antimicrobial: "A", tested: 0, susceptible: 0 }],
  ["blank susceptible", { organism: "O", antimicrobial: "A", tested: 5, susceptible: "" }],
  ["S over tested", { organism: "O", antimicrobial: "A", tested: 5, susceptible: 6 }],
  ["S+I+R over tested", { organism: "O", antimicrobial: "A", tested: 5, susceptible: 3, intermediate: 2, resistant: 1 }],
  ["a decimal", { organism: "O", antimicrobial: "A", tested: "5.5", susceptible: 1 }],
] as const) {
  const v = validateRow(raw, 7);
  check(`row: ${label} is refused, on line 7`, !v.row && v.errors.length > 0 && v.errors.every((e) => e.line === 7), JSON.stringify(v));
}
check("row: S+I+R equal to tested is fine", !!validateRow({ organism: "O", antimicrobial: "A", tested: 6, susceptible: 3, intermediate: 2, resistant: 1 }, 1).row);

// Rows: duplicates (case-insensitive) refused, naming the first line
const dup = validateRows([{ organism: "E. coli", antimicrobial: "Ampicillin", tested: 4, susceptible: 2 }, { organism: "e. COLI", antimicrobial: "ampicillin", tested: 4, susceptible: 2 }], 2);
check("rows: the same pair twice (any case) is refused, naming line 2", dup.rows.length === 1 && /already on line 2/.test(dup.errors[0]?.message || "") && dup.errors[0].line === 3);

// CSV
const t = parseCsvText('﻿a,"b, c","d ""q"""\r\n1,2,3\n\n"x\ny",z,\n');
check("csv: BOM, quoted comma, doubled quote, CRLF, blank line skipped, line break inside quotes", t.length === 3 && t[0][1] === "b, c" && t[0][2] === 'd "q"' && t[2][0] === "x\ny" && t[2][2] === "", JSON.stringify(t));
const phi = parseAntibiogramCsv("Organism,Antimicrobial,Tested,Susceptible,Patient Name,DOB\nE. coli,Ampicillin,1,1,Made Up,2000-01-01\n");
check("csv: patient columns refused by name, nothing read", phi.rows.length === 0 && phi.unknown_columns.join("|") === "patient name|dob");
const acc = parseAntibiogramCsv("Accession,Organism,Antimicrobial,Tested,Susceptible\nA1,E. coli,Ampicillin,1,1\n");
check("csv: an accession column is refused too", acc.unknown_columns.join("|") === "accession");
const miss = parseAntibiogramCsv("Organism,Drug,Tested\nE. coli,Ampicillin,5\n");
check("csv: no susceptible column is refused", /Missing columns: susceptible/.test(miss.errors[0]?.message || ""));
const aliases = parseAntibiogramCsv("Species,Gram,Antibiotic,Number_Tested,S,I,R\nE. coli,neg,Ampicillin,400,210,0,190\n");
check("csv: aliases (species, gram, antibiotic, number_tested, S, I, R)", aliases.rows.length === 1 && aliases.rows[0].organism_group === "gram_negative" && aliases.rows[0].tested === 400 && aliases.rows[0].resistant === 190, JSON.stringify(aliases));
const badLine = parseAntibiogramCsv("Organism,Antimicrobial,Tested,Susceptible\nE. coli,Ampicillin,10,4\nE. coli,Ceftriaxone,10,40\n");
check("csv: a bad line is named by its file line (3)", badLine.errors[0]?.line === 3);
check("csv: empty file and header-only file refused", parseAntibiogramCsv("").errors.length === 1 && parseAntibiogramCsv("Organism,Antimicrobial,Tested,Susceptible\n").errors.length === 1);

// The table
const rows: AbgRow[] = [
  { organism: "E. coli", organism_group: "gram_negative", antimicrobial: "Ampicillin", tested: 400, susceptible: 210, intermediate: null, resistant: null },
  { organism: "E. coli", organism_group: "gram_negative", antimicrobial: "Ceftriaxone", tested: 412, susceptible: 362, intermediate: null, resistant: null },
  { organism: "S. aureus", organism_group: "gram_positive", antimicrobial: "Oxacillin", tested: 188, susceptible: 109, intermediate: null, resistant: null },
  { organism: "E. cloacae", organism_group: "gram_negative", antimicrobial: "Ceftriaxone", tested: 18, susceptible: 13, intermediate: null, resistant: null },
  { organism: "C. albicans", organism_group: "other", antimicrobial: "Fluconazole", tested: 40, susceptible: 38, intermediate: null, resistant: null },
];
const sup = computeAntibiogram(rows, { threshold: 30, mode: "suppress" });
check("table: groups in order gram-negative, gram-positive, other", sup.map((g) => g.group).join(",") === "gram_negative,gram_positive,other");
const gn = sup[0];
check("table: drugs across in first-seen order", gn.drugs.join(",") === "Ampicillin,Ceftriaxone");
check("table: organisms down in first-seen order", gn.organisms.map((o) => o.organism).join(",") === "E. coli,E. cloacae");
check("table: E. coli isolates is the most tested (412)", gn.organisms[0].isolates === 412 && gn.organisms[0].below === false);
check("table: E. coli 53 and 88", gn.organisms[0].cells.Ampicillin.pct === 53 && gn.organisms[0].cells.Ceftriaxone.pct === 88);
check("table: E. cloacae has no Ampicillin cell (not tested)", gn.organisms[1].cells.Ampicillin === undefined);
check("table, suppress: 18 tested is below and not shown", gn.organisms[1].below && gn.organisms[1].cells.Ceftriaxone.below && !gn.organisms[1].cells.Ceftriaxone.shown);
const flag = computeAntibiogram(rows, { threshold: 30, mode: "flag" });
check("table, flag: 18 tested is below, shown, 72", flag[0].organisms[1].cells.Ceftriaxone.shown && flag[0].organisms[1].cells.Ceftriaxone.below && flag[0].organisms[1].cells.Ceftriaxone.pct === 72);
const t10 = computeAntibiogram(rows, { threshold: 10, mode: "suppress" });
check("table, threshold 10: the 18 is shown, not below", t10[0].organisms[1].cells.Ceftriaxone.shown && !t10[0].organisms[1].cells.Ceftriaxone.below);
check("table, threshold exactly met (30 of 30) counts", !computeAntibiogram([{ ...rows[0], tested: 30, susceptible: 15 }], { threshold: 30, mode: "suppress" })[0].organisms[0].cells.Ampicillin.below);
check("table: empty rows, empty table", computeAntibiogram([], { threshold: 30, mode: "suppress" }).length === 0);

// Settings
const cur = { ...STEWARDSHIP_DEFAULTS };
check("settings: missing keys keep the current value", JSON.stringify(parseSettings({}, cur).settings) === JSON.stringify(cur));
check("settings: 10, flag, 24 accepted", (() => { const s = parseSettings({ isolate_threshold: "10", below_threshold: "flag", period_months: 24 }, cur).settings; return s?.isolate_threshold === 10 && s.below_threshold === "flag" && s.period_months === 24; })());
for (const [label, b] of [["threshold 0", { isolate_threshold: 0 }], ["threshold 1.5", { isolate_threshold: 1.5 }], ["threshold 1001", { isolate_threshold: 1001 }], ["mode hide", { below_threshold: "hide" }], ["period 0", { period_months: 0 }], ["period 37", { period_months: 37 }], ["blank note", { first_isolate_note: "  " }]] as const) {
  check(`settings: ${label} refused`, !!parseSettings(b, cur).error);
}

// Dates
check("monthsBefore: 2026-11-23 less 12 = 2025-11-23", monthsBefore("2026-11-23", 12) === "2025-11-23");
check("monthsBefore: 2026-03-31 less 1 = 2026-02-28 (clamps)", monthsBefore("2026-03-31", 1) === "2026-02-28");
check("monthsBefore: 2024-03-30 less 1 = 2024-02-29 (leap year)", monthsBefore("2024-03-30", 1) === "2024-02-29");
check("monthsBefore: 2026-01-15 less 13 = 2024-12-15", monthsBefore("2026-01-15", 13) === "2024-12-15");
check("isYmd: 2026-02-30 is not a date shape we accept? (Date.parse rolls it; shape check only)", isYmd("2026-02-28") && !isYmd("2026-2-28") && !isYmd("soon"));

// Readiness
const today = "2026-11-23";
const none = stewardshipReadiness({ today, periodMonths: 12, lastReleased: null, lastMeetingDate: null, openActions: [] });
check("readiness, nothing recorded: antibiogram not met, committee not met, actions met (none open)", none.map((i) => i.state).join(",") === "not_met,not_met,met");
const fresh = stewardshipReadiness({ today, periodMonths: 12, lastReleased: { released_day: "2026-01-12", period_end: "2025-12-31", version: 1, title: "2025" }, lastMeetingDate: "2026-10-01", openActions: [{ due_date: "2026-12-01" }, { due_date: null }] });
check("readiness, released this year, met in October, two open on time: all met", fresh.map((i) => i.state).join(",") === "met,met,met", JSON.stringify(fresh));
const stale = stewardshipReadiness({ today, periodMonths: 12, lastReleased: { released_day: "2025-11-22", period_end: "2024-12-31", version: 2, title: "2024" }, lastMeetingDate: "2025-11-22", openActions: [{ due_date: "2026-11-22" }] });
check("readiness, released and met a year and a day ago, one action a day late: all not met", stale.map((i) => i.state).join(",") === "not_met,not_met,not_met", JSON.stringify(stale));
check("readiness: a release exactly one period ago still counts", stewardshipReadiness({ today, periodMonths: 12, lastReleased: { released_day: "2025-11-23", period_end: "2024-12-31", version: 1, title: "x" }, lastMeetingDate: null, openActions: [] })[0].state === "met");
check("readiness: a 24-month period stretches the window", stewardshipReadiness({ today, periodMonths: 24, lastReleased: { released_day: "2025-01-01", period_end: "2024-12-31", version: 1, title: "x" }, lastMeetingDate: null, openActions: [] })[0].state === "met");
check("readiness: due today is not past due", stewardshipReadiness({ today, periodMonths: 12, lastReleased: null, lastMeetingDate: null, openActions: [{ due_date: today }] })[2].state === "met");

// CFR text pinned to eCFR (2026-11-19)
check("CFR as-of date", CFR_AS_OF === "2026-11-19");
check("CFR: 482.42(b)(2)(i) verbatim", CFR_STEWARDSHIP[0].citation === "42 CFR 482.42(b)(2)(i)" && CFR_STEWARDSHIP[0].text === "(i) Demonstrates coordination among all components of the hospital responsible for antibiotic use and resistance, including, but not limited to, the infection prevention and control program, the QAPI program, the medical staff, nursing services, and pharmacy services;");
check("CFR: 485.640(b)(2)(i) verbatim", CFR_STEWARDSHIP[1].citation === "42 CFR 485.640(b)(2)(i)" && CFR_STEWARDSHIP[1].text === "(i) Demonstrates coordination among all components of the CAH responsible for antibiotic use and resistance, including, but not limited to, the infection prevention and control program, the QAPI program, the medical staff, nursing services, and pharmacy services;");
check("CFR: 485.640(b)(2) says facility-wide, 482.42(b)(2) says hospital-wide", /The facility-wide antibiotic stewardship program:$/.test(CFR_STEWARDSHIP[1].lead) && /The hospital-wide antibiotic stewardship program:$/.test(CFR_STEWARDSHIP[0].lead));
check("CFR: no em dash in the pinned text", !CFR_STEWARDSHIP.some((c) => /—/.test(c.lead + c.text)));

console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
