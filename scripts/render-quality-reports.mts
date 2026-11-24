// scripts/render-quality-reports.mts
//
// Renders the VeritaQA reports (B15) on a SCRATCH database from made-up laboratories and numbers, through the functions the routes
// print with, and reads the pages back with PyMuPDF (python -E). Writes to OUT:
//   sys_ytd.pdf, lab_month.pdf, lab_quarter.pdf, lab_year.pdf   two laboratories, six indicators
//   sys_long.pdf                                                40 laboratories, five indicators
//   lab_long.pdf                                                25 indicators, 12 months
// It checks, on every page: the title block and CLIA line on page 1, the footer, the column headings above the first row and the
// table's name with them, no row split between two pages, every table's columns at the same places, and month numbers ending
// under their month's heading; the letters for a watch and a missed month; No entry in the cells.
//   DB_PATH=.tmp-quality-render.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy \
//   STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/render-quality-reports.mts <out dir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

const OUT = process.argv[2];
if (!OUT) { console.log("usage: npx tsx scripts/render-quality-reports.mts <out dir>"); process.exit(2); }
if (!process.env.DB_PATH || !/\.tmp|scratch/i.test(process.env.DB_PATH)) throw new Error("DB_PATH must be a scratch database (.tmp or scratch in its name).");
fs.mkdirSync(OUT, { recursive: true });

const { db } = await import("../server/db");
const { buildLabReport } = await import("../server/labQualityReport");
const { buildSystemReport } = await import("../server/orgQuality");
const { labReportPDF, systemReportPDF } = await import("../server/qualityReportFiles");
const { orgUnit, orgValue, parsePeriod } = await import("../shared/qualityIndicators");
const sqlite = (db as any).$client;
sqlite.pragma("foreign_keys = OFF");

let failures = 0;
const check = (name: string, cond: boolean, detail: unknown = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  :: ${JSON.stringify(detail)}`}`); if (!cond) failures++; };
const AT = "2026-01-01T00:00:00Z";
const ins = (table: string, values: Record<string, any>) => {
  const row: Record<string, any> = { ...values };
  for (const c of sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]) if (c.notnull && c.dflt_value == null && !c.pk && !(c.name in row)) row[c.name] = /_at$/.test(c.name) ? AT : /INT|REAL/.test(String(c.type)) ? 0 : "x";
  const k = Object.keys(row);
  return Number(sqlite.prepare(`INSERT INTO ${table} (${k.join(", ")}) VALUES (${k.map(() => "?").join(", ")})`).run(...k.map((x) => row[x])).lastInsertRowid);
};
const two = (n: number) => String(n).padStart(2, "0");
const period = (q: any) => { const p = parsePeriod(q); if ("error" in p) throw new Error(p.error); return p.period; };

/** A made-up system: its laboratories, its indicators turned on in each, and numbers for the first four months of a year. */
function world(name: string, labCount: number, year: number, tagged: boolean, clia: (i: number) => string | null) {
  const owner = ins("users", { email: `render-${name.toLowerCase().replace(/\W+/g, "")}@example.test`, name: "Made-up Owner", plan: "hospital" });
  const org = ins("organizations", { name, billing_owner_user_id: owner, plan: "enterprise" });
  const labs = Array.from({ length: labCount }, (_, i) => ins("labs", {
    lab_name: tagged ? `AlphaLab${two(i + 1)} Made-up Regional Hospital Clinical Laboratory OmegaLab${two(i + 1)}` : ["Made-up North Hospital Laboratory", "Made-up South Clinic Laboratory"][i], clia_number: clia(i), owner_user_id: owner, organization_id: org, plan: "hospital",
  }));
  const defs = [
    ["STAT troponin turnaround", "Chemistry", "ratio", "Total minutes from receipt to result", "STAT troponins", 45, "minutes"],
    ["Contaminated blood cultures", "Microbiology", "percent", "Contaminated sets", "Sets collected", 3, null],
    ["Phlebotomy complaints", "Phlebotomy", "count", "Complaints received", null, 1, null],
    ["Corrected reports", "Reporting", "per_1000", "Corrected reports", "Reports released", 2, null],
    ["Critical calls within 30 minutes", "Reporting", "percent", "Critical values called within 30 minutes", "Critical values", 95, null],
  ] as const;
  defs.forEach(([title, department, kind, numerator, denominator, target, unit], d) => {
    const ind = ins("org_quality_indicators", { organization_id: org });
    const direction = d === 4 ? "higher_is_better" : "lower_is_better";
    ins("org_quality_indicator_versions", { indicator_id: ind, version: 1, effective_from: `${year}-01`, name: title, definition: "Made-up definition for the render.", numerator_text: numerator, denominator_text: denominator, kind, unit, target, direction, frequency: "monthly", department });
    labs.forEach((lab, i) => {
      const dept = (sqlite.prepare("SELECT id FROM pi_departments WHERE lab_id = ? AND name = ?").get(lab, department) as any)?.id ?? ins("pi_departments", { account_id: owner, lab_id: lab, name: department, sort_order: 10 + d, active: 1 });
      const metric = ins("pi_metrics", { department_id: dept, account_id: owner, lab_id: lab, org_indicator_id: ind, name: title, unit: orgUnit(kind as any, unit), direction, benchmark_green: target, active: 1 });
      ins("org_quality_indicator_labs", { indicator_id: ind, organization_id: org, lab_id: lab, metric_id: metric });
      if ((i + d) % 7 === 6 || (labCount === 2 && d === 1)) return; // nothing entered: reads No entry
      for (let m = 1; m <= 4; m++) {
        const den = kind === "count" ? null : kind === "ratio" ? 50 : 200 + 10 * i;
        const num = kind === "count" ? (m + i) % 3 : kind === "ratio" ? 2000 + 100 * m + 40 * (i % 10) : d === 4 ? (den as number) - ((m + i) % 12) : 1 + ((m + i) % 9);
        ins("pi_entries", { metric_id: metric, account_id: owner, lab_id: lab, year, month: m, numerator: num, denominator: den, value: orgValue(kind as any, num, den), entry_kind: kind, entry_unit: orgUnit(kind as any, unit), target_value: target, target_direction: direction, org_version: 1 });
      }
    });
  });
  return { owner, org, labs };
}

/** A laboratory's own indicators, with a watch, a missed and an empty month among them. */
function ownIndicators(owner: number, lab: number, names: string[], departments: string[], year: number) {
  names.forEach((name, i) => {
    const department = departments[Math.floor((i * departments.length) / names.length)];
    const dept = (sqlite.prepare("SELECT id FROM pi_departments WHERE lab_id = ? AND name = ?").get(lab, department) as any)?.id ?? ins("pi_departments", { account_id: owner, lab_id: lab, name: department, sort_order: departments.indexOf(department), active: 1 });
    const minutes = i % 8 === 5;
    const metric = ins("pi_metrics", { department_id: dept, account_id: owner, lab_id: lab, name, unit: minutes ? "minutes" : "%", direction: "lower_is_better", benchmark_green: minutes ? 1200 : 2, benchmark_yellow: minutes ? 1300 : 3, sort_order: i, active: 1 });
    for (let m = 1; m <= 12; m++) {
      if ((i + m) % 6 === 0) continue;
      const value = minutes ? 1100.25 + 30 * ((i + m) % 9) : Math.round((0.8 + ((i * 3 + m * 5) % 30) / 10) * 100) / 100;
      ins("pi_entries", { metric_id: metric, account_id: owner, lab_id: lab, year, month: m, value, volume: 400 + m, notes: m === 3 && i % 4 === 0 ? "Made-up note: courier delay" : null, root_cause: m === 3 && i % 5 === 0 ? "Made-up root cause" : null });
    }
  });
}

const rollupRow = (id: number) => sqlite.prepare("SELECT l.id, l.lab_name, l.clia_number, l.time_zone, l.plan, l.organization_id, NULL AS organization_name, NULL AS organization_plan, l.is_trial, l.subscription_expires_at FROM labs l WHERE l.id = ?").get(id) as any;
const labReport = (w: { owner: number }, lab: number, q: any) => {
  const r = rollupRow(lab);
  return buildLabReport(sqlite, { kind: "lab", userId: w.owner, labId: lab, ownerId: w.owner, wide: [w.owner] }, { id: lab, name: r.lab_name, clia: r.clia_number }, period(q));
};
const sysReport = (w: { org: number; labs: number[] }, name: string, q: any) => buildSystemReport(sqlite, { organization: { id: w.org, name }, labs: w.labs.map(rollupRow), period: period(q), department: null, group: null });
const write = async (file: string, pdf: Promise<Buffer>) => fs.writeFileSync(path.join(OUT, file), await pdf);

const small = world("Made-up Health System", 2, 2026, false, (i) => `22D77901${two(i + 1)}`);
ownIndicators(small.owner, small.labs[0], ["Hemolyzed specimens", "Clotted CBC specimens", "Mislabeled specimens"], ["Chemistry", "Hematology"], 2026);
const finding = ins("findings", { user_id: small.owner, lab_id: small.labs[0], accreditor: "CAP", finding_number: "2026-04", standard_ref: "Made-up item 7", status: "open", source_type: "inspection" });
const missed = sqlite.prepare("SELECT e.id, e.metric_id FROM pi_entries e JOIN pi_metrics m ON m.id = e.metric_id WHERE m.lab_id = ? AND m.org_indicator_id IS NULL AND e.month = 3 AND e.value > 2 ORDER BY e.value DESC LIMIT 1").get(small.labs[0]) as any;
if (missed) ins("pi_finding_links", { lab_id: small.labs[0], metric_id: missed.metric_id, entry_id: missed.id, finding_id: finding });
const big = world("Made-up Forty Laboratory System", 40, 2026, true, (i) => (i % 9 === 4 ? null : `22D77${two(i + 1)}00`));
const long = world("Made-up Long Report", 1, 2026, true, () => null);
ownIndicators(long.owner, long.labs[0], Array.from({ length: 25 }, (_, i) => `AlphaInd${two(i + 1)} made-up indicator with a name long enough to wrap OmegaInd${two(i + 1)}`), ["Chemistry", "Hematology", "Coagulation", "Blood Bank", "Specimen Collection"], 2025);

await write("sys_ytd.pdf", systemReportPDF(sysReport(small, "Made-up Health System", { period: "ytd", year: 2026, month: 4 })));
await write("lab_month.pdf", labReportPDF(labReport(small, small.labs[0], { period: "month", year: 2026, month: 3 })));
await write("lab_quarter.pdf", labReportPDF(labReport(small, small.labs[0], { period: "quarter", year: 2026, quarter: 1 })));
await write("lab_year.pdf", labReportPDF(labReport(small, small.labs[0], { period: "year", year: 2026 })));
await write("sys_long.pdf", systemReportPDF(sysReport(big, "Made-up Forty Laboratory System", { period: "quarter", year: 2026, quarter: 1 })));
await write("lab_long.pdf", labReportPDF(labReport(long, long.labs[0], { period: "year", year: 2025 })));

// ── Read the pages back ──
const reader = path.join(OUT, "read_pages.py");
fs.writeFileSync(reader, `import sys, json, fitz
sys.stdout.reconfigure(encoding="utf-8")
out = []
for f in sys.argv[1:]:
    d = fitz.open(f)
    out.append({"author": d.metadata.get("author"), "pages": [{"height": p.rect.height, "words": [[round(w[0], 1), round(w[1], 1), round(w[2], 1), round(w[3], 1), w[4]] for w in p.get_text("words")]} for p in d]})
print(json.dumps(out))
`);
type Word = [number, number, number, number, string];
type Doc = { author: string; pages: { height: number; words: Word[] }[] };
const FILES = ["sys_ytd", "lab_month", "lab_quarter", "lab_year", "sys_long", "lab_long"];
const docs = JSON.parse(execFileSync("python", ["-E", reader, ...FILES.map((f) => path.join(OUT, `${f}.pdf`))], { maxBuffer: 1 << 28 }).toString("utf8")) as Doc[];
const doc = Object.fromEntries(FILES.map((f, i) => [f, docs[i]])) as Record<string, Doc>;
const text = (p: { words: Word[] }) => p.words.map((w) => w[4]).join(" ");
/** The heading rows on a page: the line that holds every one of these words. */
const headingRows = (p: { words: Word[] }, first: string, rest: string[]) => p.words.filter((w) => w[4] === first && rest.every((r) => p.words.some((x) => x[4] === r && Math.abs(x[3] - w[3]) < 12)));

for (const f of FILES) {
  const d = doc[f], first = text(d.pages[0]);
  check(`${f}: page 1 has the title block, the name and the CLIA line`, (f.startsWith("sys") ? /Quality Indicators Across Laboratories/ : /Quality Indicator Report/).test(first) && /Prepared for: /.test(first) && (f.startsWith("sys") ? /Made-up/ : f === "lab_long" ? /CLIA: Not on file\. Enter it in account settings\./ : /CLIA: 22D7790101/).test(first));
  check(`${f}: the footer is on every page (${d.pages.length}), and the author`, d.pages.every((p, i) => text(p).includes(`VeritaAssure® | VeritaQA™ | Confidential, For Internal Lab Use Only | Page ${i + 1} of ${d.pages.length}`)) && d.author === "Perplexity Computer");
}
check("the long reports run to several pages", doc.sys_long.pages.length > 4 && doc.lab_long.pages.length > 1, [doc.sys_long.pages.length, doc.lab_long.pages.length]);

// No row split: the first and last word of every name in a first cell are on one page, and each row is there once.
for (const [f, tag, count, times] of [["lab_long", "Ind", 25, 1], ["sys_long", "Lab", 40, 6]] as const) {
  const bad: string[] = [];
  for (let i = 1; i <= count; i++) {
    const at = (w: string) => doc[f].pages.flatMap((p, k) => p.words.filter((x) => x[4] === w).map(() => k));
    const a = at(`Alpha${tag}${two(i)}`), o = at(`Omega${tag}${two(i)}`);
    if (a.length !== times || JSON.stringify(a) !== JSON.stringify(o)) bad.push(`${two(i)}: ${a} / ${o}`);
  }
  check(`${f}: no row is split between pages, and every row is there`, bad.length === 0, bad.slice(0, 4));
}
// Headings above the first row of every page, with the table's name.
for (const [f, tag, firstHead, rest] of [["lab_long", "AlphaInd", "Indicator", ["Target", "Jan", "Dec", "total", "Result"]], ["sys_long", "AlphaLab", "Laboratory", ["Target", "Result", "Entries", "Note"]]] as const) {
  const bad: number[] = [];
  doc[f].pages.forEach((p, i) => {
    const rows = p.words.filter((w) => w[4].startsWith(tag));
    if (!rows.length) return;
    const top = Math.min(...rows.map((w) => w[1]));
    const heads = f === "sys_long" ? p.words.filter((w) => w[4] === "Laboratory" && w[1] < top && (rest.every((r) => p.words.some((x) => x[4] === r && Math.abs(x[1] - w[1]) < 6)) || p.words.some((x) => x[4] === "CLIA" && Math.abs(x[1] - w[1]) < 6))) : headingRows(p, firstHead, [...rest]).filter((w) => w[1] < top);
    const name = p.words.some((w) => w[1] < top && /^(Chemistry|Hematology|Coagulation|Blood|Specimen|\(Chemistry\)|\(Microbiology\)|\(Phlebotomy\)|\(Reporting\)|Laboratories)$/.test(w[4]));
    if (!heads.length || !name) bad.push(i + 1);
  });
  check(`${f}: headings and the table's name are above the first row on every page`, bad.length === 0, bad);
}
// One layout: each column heading starts (or, right aligned, ends) at the same place in every table.
const places = (f: string, word: string, edge: 0 | 2, line: string) => new Set(doc[f].pages.flatMap((p) => p.words.filter((w) => w[4] === word && p.words.some((x) => x[4] === line && Math.abs(x[1] - w[1]) < 6)).map((w) => Math.round(w[edge]))));
for (const f of ["lab_year", "lab_long"]) for (const [word, edge] of [["Target", 0], ["Jan", 2], ["Feb", 2], ["Jun", 2], ["Dec", 2], ["Result", 0]] as const) {
  const at = places(f, word, edge, word === "Jan" ? "Dec" : "Jan");
  check(`${f}: ${word} is at one place in every table`, at.size === 1, [...at]);
}
for (const f of ["lab_quarter"]) for (const [word, edge] of [["Target", 0], ["Jan", 2], ["Mar", 2], ["Result", 0]] as const) check(`${f}: ${word} is at one place in every table`, places(f, word, edge, word === "Jan" ? "Mar" : "Jan").size === 1);
for (const [word, edge] of [["Target", 0], ["Value", 2], ["Result", 0]] as const) check(`lab_month: ${word} is at one place in every table`, places("lab_month", word, edge, "Numerator").size === 1);
for (const f of ["sys_ytd", "sys_long"]) for (const [word, edge] of [["Denominator", 2], ["Value", 2], ["Target", 0], ["Result", 0], ["Entries", 0]] as const) check(`${f}: ${word} is at one place in every table`, places(f, word, edge, word === "Denominator" ? "Value" : "Denominator").size === 1);
// Month numbers end under their month's heading; a letter follows the number.
{
  const bad: unknown[] = [];
  let seen = 0;
  for (const q of doc.lab_long.pages) {
    const head = q.words.find((w) => w[4] === "Jan"), next = q.words.find((w) => w[4] === "Feb");
    if (!head || !next) continue;
    const under = q.words.filter((w) => /^\d+(\.\d+)?$/.test(w[4]) && w[1] > head[3] && w[2] > head[0] - 12 && w[2] < next[0] - 8 && w[0] > 180);
    seen += under.length;
    bad.push(...under.filter((w) => Math.abs(w[2] - head[2]) > 1.2));
  }
  const qp = doc.lab_quarter.pages[0], heads = ["Jan", "Feb", "Mar"].map((m) => qp.words.find((w) => w[4] === m)![2]);
  const cells = qp.words.filter((w) => w[1] > 200 && w[1] < qp.words.find((x) => x[4] === "Linked")![1] - 20 && w[2] > heads[0] - 25 && w[2] < heads[2] + 2 && (/^\d+(\.\d+)?$/.test(w[4]) || w[4] === "entry"));
  check("lab_quarter: every number and No entry ends under its month's heading", cells.length > 15 && cells.every((w) => heads.some((h) => Math.abs(h - w[2]) < 1.2)), cells.filter((w) => !heads.some((h) => Math.abs(h - w[2]) < 1.2)).slice(0, 4));
  check("lab_long: January's numbers end under its heading on every page", seen >= 18 && bad.length === 0, [seen, ...bad.slice(0, 4)]);
  const p = doc.lab_long.pages[0];
  const all = text(p);
  check("lab_long: a watch and a missed month carry their letters, and the key says so", /\d W /.test(all) && /\d M /.test(all) && /W after a number is Watch, M is Missed\./.test(all));
  check("lab_long: an empty month reads No entry, as the key does", /No entry: nothing was entered that month/.test(all) && (all.match(/No entry/g) || []).length > 10);
  check("no page of any report has a dash for a number", FILES.every((f) => doc[f].pages.every((q) => !q.words.some((w) => w[4] === "-"))));
}
console.log(failures ? `\n${failures} FAILED` : `\nALL PASS. Files in ${OUT}`);
process.exit(failures ? 1 : 0);
