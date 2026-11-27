// tests/integration/accreditor-refs-hidden.test.ts
//
// STANDING integration test for BUG-191 (owner pick 2026-11-27, option 1; shared/accreditorRefs.ts). The COLA criterion and
// AABB standard numbers VeritaAssure supplied were never checked against the COLA criteria or the AABB Standards, so until
// each source is checked every place that prints one of OUR numbers prints "Being verified" instead. The numbers stay in the
// data files. What a laboratory typed itself prints as typed. TJC, CAP and CFR references are unchanged.
//   1. The switch itself, and the data still holding the numbers (the gap: before, these printed as they are).
//   2. VeritaScan Excel: AABB and COLA columns read "Being verified", even when the browser sends the old numbers; TJC, CAP and
//      CFR cells are exactly the data's; the About sheet says why; a lab's own custom question keeps its own AABB and COLA.
//   3. VeritaScan PDF (full report): no number of ours, "Being verified" printed, TJC/CAP/CFR printed, the custom question's own.
//   4. VeritaDC master list: the tracker (screen and readiness PDF), the workbook, the CFR crosswalk API; a custom entry's own.
//   5. VeritaDC documents generated from the master list: the Word file, and every house format, carry no COLA/AABB number.
//   6. VeritaCheck study PDF: the regulatory references box.
//   7. Who: another customer is refused; a Staff login, a view-only reviewer and Veritas support never see a number.
//   8. Source scan: every read of .aabb / .cola / aabb_ids / cola_ids / *_citations outside the data files goes through the
//      helper or is on the list below with its reason; the scan bites on a planted read.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:accreditor-refs-hidden
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { inspectionWorld } from "./inspectionFixture";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");

// ── 8's scanner, defined first so section 8 can also prove it bites ───────────────────────────────────────────────────────
const READ = /\.(aabb|cola)(_ids|_citations)?\b(?!\s*=[^=])/; // `x.cola = ...` writes a value already shown through the helper
const DYNAMIC_READ = /\[\s*a\.(key|fieldName)\s*\]/;
const DEFINES_KEY = /(key|fieldName):\s*["'](aabb|cola)(_citations)?["']/;
const HELPER = /\b(displayRef|displayRefList)\(/;
// Lines that read the fields without the helper, each with its reason. Every entry must still match a line.
const ALLOWED: Array<{ file: string; has: string; why: string }> = [
  { file: "server/routes.ts", has: "ci.aabb, ci.cola", why: "SELECT of the lab's own custom VeritaScan questions (lab-typed)" },
  { file: "server/routes.ts", has: "v.value.aabb, v.value.cola", why: "stores a custom question as the lab typed it" },
  { file: "server/routes.ts", has: "aabb: existing.aabb, cola: existing.cola", why: "custom question update: keeps the lab's own text" },
  { file: "server/routes.ts", has: "req.body.aabb !== undefined ? req.body.aabb : existing.aabb", why: "custom question update (lab-typed)" },
  { file: "server/routes.ts", has: "req.body.cola !== undefined ? req.body.cola : existing.cola", why: "custom question update (lab-typed)" },
  { file: "server/routes.ts", has: "content.aabb, content.cola", why: "custom question update write (lab-typed)" },
  { file: "server/routes.ts", has: "const accCells = xlsxSelected.map(a => { const v = (r as any)[a.key]", why: "Custom Questions sheet: the lab's own citations" },
  { file: "server/routes.ts", has: "b.cola_citations ?? null, b.aabb_citations ?? null", why: "stores a custom VeritaDC entry as the lab typed it" },
  { file: "server/pdfReport.ts", has: "the lab's own custom question: printed as the lab typed it", why: "VeritaScan PDF custom section (lab-typed)" },
  { file: "server/veritapolicyTracker.ts", has: "const citations = (source: any) => aoCols.map((a) => ({ label: a.label, value: source[a.key]", why: "a custom VeritaDC entry's own citations; master rows use masterCitations" },
  { file: "server/veritapolicyDocx.ts", has: "return !!(cw.cfr || cw.tjc || cw.cap || cw.cola || cw.aabb)", why: "presence check only; prints nothing" },
  { file: "server/veritascanCustomItems.ts", has: "cleanOptional(input.", why: "validates a custom question the lab typed" },
  { file: "client/src/pages/VeritaScanCustomQuestionsPage.tsx", has: "", why: "the lab's own custom questions screen (lab-typed throughout)" },
  { file: "client/src/pages/VeritaScanScanPage.tsx", has: "(r.tjc || r.cap || r.cfr || r.aabb || r.cola)", why: "custom question rows on the scan (lab-typed)" },
  { file: "client/src/pages/VeritaScanScanPage.tsx", has: "r.aabb && `AABB: ${r.aabb}`, r.cola && `COLA: ${r.cola}`", why: "custom question rows on the scan (lab-typed)" },
];
const DATA_FILES = new Set(["client/src/lib/veritaScanData.ts", "server/cfrRequirements.ts", "server/veritapolicyMasterList.ts", "shared/accreditorRefs.ts", "server/colaRequirements.ts"]);
function scanSource(file: string, text: string): string[] {
  const out: string[] = [];
  const definesKey = DEFINES_KEY.test(text);
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    const reads = READ.test(line) || (definesKey && DYNAMIC_READ.test(line));
    if (!reads || HELPER.test(line)) return;
    if (ALLOWED.some((a) => a.file === file && line.includes(a.has))) return;
    out.push(`${file}:${i + 1}: ${t.slice(0, 140)}`);
  });
  return out;
}

async function main() {
  const w = await inspectionWorld("accrefs");
  const { A, X, call, check, sqlite, seed } = w;
  const { OWNER, OTHER, EDITOR, VIEWER, STAFF, SUPPORT } = w;
  const { SCAN_ITEMS } = await import("../../client/src/lib/veritaScanData");
  const { VERITAPOLICY_MASTER_LIST } = await import("../../server/veritapolicyMasterList");
  const { CFR_REQUIREMENTS } = await import("../../server/cfrRequirements");
  const refs = await import("../../shared/accreditorRefs");
  const { default: ExcelJS } = await import("exceljs");
  const { default: JSZip } = await import("jszip");
  const BV = "Being verified";

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "accrefs-"));
  const keep = process.env.PDF_OUT || "";
  if (keep) fs.mkdirSync(keep, { recursive: true });
  const pdfText = (buf: Buffer, name: string): string => {
    const file = path.join(work, name);
    fs.writeFileSync(file, buf);
    if (keep) fs.copyFileSync(file, path.join(keep, name));
    return execFileSync("python", ["-E", "-c", "import sys, json, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nprint(json.dumps([p.get_text() for p in fitz.open(sys.argv[1])]))", file]).toString("utf-8");
  };
  const cellText = (v: any): string => v == null ? "" : typeof v === "object" ? (v.richText ? v.richText.map((t: any) => t.text).join("") : v.text ?? v.result ?? String(v)) : String(v);
  const sheetRows = (ws: any): string[][] => { const rows: string[][] = []; ws.eachRow({ includeEmpty: false }, (row: any) => rows.push((row.values as any[]).slice(1).map(cellText))); return rows; };
  const docxText = async (buf: Buffer) => (await (await JSZip.loadAsync(buf)).file("word/document.xml")!.async("string")).replace(/<w:tab\/>/g, " ").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "");

  // Our numbers, as the data files hold them.
  const ourAabb = new Set(SCAN_ITEMS.map((i: any) => i.aabb).filter((v: string) => v && v !== "N/A"));
  const ourCola = new Set(SCAN_ITEMS.map((i: any) => i.cola).filter((v: string) => v && v !== "N/A"));
  const AABB_NUM = /\bAABB \d+\.\d+/;

  // Lab A is accredited by all four; lab A's own custom question carries its own AABB and COLA references.
  sqlite.prepare("UPDATE labs SET accreditation_tjc = 1, accreditation_cap = 1, accreditation_cola = 1, accreditation_aabb = 1 WHERE id IN (?, ?)").run(A, X);
  const LAB_AABB = "AABB 99.1.7 (lab-typed)", LAB_COLA = "COLA LAB-TYPED 42";
  seed("veritascan_custom_items", { lab_id: A, question: "Made-up custom: transfusion consent audit", status: "active", domain: "Blood Bank & Transfusion", tjc: "Made-up TJC ref", cfr: "Made-up CFR ref", aabb: LAB_AABB, cola: LAB_COLA });
  const scan = await w.newScan(EDITOR, A, "Made-up Readiness 2026");
  // The body an older browser bundle sends: our raw numbers included. The server must not print them.
  const rawRefs = SCAN_ITEMS.map((i: any) => ({ id: i.id, domain: i.domain, question: i.question, tjc: i.tjc, cap: i.cap, cfr: i.cfr, aabb: i.aabb, cola: i.cola }));

  // ── 1. The switch, and the data it hides ──────────────────────────────────────────────────────────────────────────────
  check("1a. COLA and AABB are the unchecked sources; TJC, CAP and CFR are not", JSON.stringify(refs.UNVERIFIED_REF_SOURCES) === JSON.stringify(["COLA", "AABB"]) && ["TJC", "CAP", "CFR"].every(refs.refSourceVerified) && !refs.refSourceVerified("cola"));
  check("1b. displayRef: our COLA/AABB value (N/A and blank too) reads Being verified; TJC passes through", refs.displayRef("AABB", "AABB 5.1.1") === BV && refs.displayRef("COLA", "QC 1") === BV && refs.displayRef("AABB", "N/A") === BV && refs.displayRef("COLA", "") === BV && refs.displayRef("TJC", "QSA.02.01.01 EP1") === "QSA.02.01.01 EP1" && refs.displayRef("CAP", null) === "");
  check("1c. displayRefList: one Being verified for COLA/AABB; CAP's list unchanged", JSON.stringify(refs.displayRefList("COLA", ["LAB.022", "LAB.023"])) === JSON.stringify([BV]) && JSON.stringify(refs.displayRefList("CAP", ["COM.04250"])) === JSON.stringify(["COM.04250"]) && refs.displayRefList("CAP", null).length === 0);
  check("1d. the note names only the unchecked sources asked about", refs.unverifiedRefNote(["TJC", "AABB"]) === `AABB references read "${BV}" until they are checked against the source standards.` && refs.unverifiedRefNote(["TJC", "CAP"]) === "" && /^COLA and AABB/.test(refs.unverifiedRefNote(["AABB", "COLA"])));
  const item = (id: number) => (SCAN_ITEMS as any[]).find((i) => i.id === id);
  check("1e. the gap: the data still holds the numbers, sequence fill included (items 1-3, 47-49), nothing was deleted",
    item(1).aabb === "AABB 5.1.1" && item(1).cola === "QC 1" && item(3).aabb === "AABB 5.1.3"
    && [47, 48, 49].map((i) => item(i).aabb).join() === "AABB 5.10.8,AABB 5.10.9,AABB 5.10.10" && ourAabb.size > 100 && ourCola.size > 50
    && VERITAPOLICY_MASTER_LIST.some((p) => p.cola_citations) && (CFR_REQUIREMENTS as any[]).some((r) => r.cola_ids?.length), `${ourAabb.size} ${ourCola.size}`);

  // ── 2. VeritaScan Excel ───────────────────────────────────────────────────────────────────────────────────────────────
  const xl = await call(EDITOR, "POST", `/api/labs/${A}/veritascan/excel/${scan}`, { referenceItems: rawRefs });
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(xl.buf as any);
  const main = sheetRows(wb.getWorksheet("VeritaScan")!);
  const head = main[0], body = main.slice(1);
  const col = (h: string) => head.indexOf(h);
  check("2a. the export answers and has all four accreditor columns", xl.s === 200 && ["TJC Standard", "CAP Requirement", "AABB Standard", "COLA Criterion"].every((h) => col(h) >= 0) && body.length === SCAN_ITEMS.length, `${xl.s} ${head.join("|")}`);
  check("2b. every AABB and COLA cell reads Being verified, though the request carried the numbers", body.every((r) => r[col("AABB Standard")] === BV && r[col("COLA Criterion")] === BV));
  const leaked = body.flat().filter((c) => ourAabb.has(c) || ourCola.has(c) || AABB_NUM.test(c));
  check("2c. no cell of the sheet holds one of our AABB or COLA numbers", leaked.length === 0, leaked.slice(0, 5).join(" | "));
  const byId = new Map((SCAN_ITEMS as any[]).map((i) => [String(i.id), i]));
  const tjcCapCfrSame = body.every((r) => { const it = byId.get(r[0]); const na = (v: string) => (v && v !== "N/A" ? v : ""); return it && r[col("TJC Standard")] === na(it.tjc) && r[col("CAP Requirement")] === na(it.cap) && r[col("42 CFR Citation")] === (it.cfr || ""); });
  check("2d. TJC, CAP and CFR cells are exactly the data's for all 173 items", tjcCapCfrSame);
  const about = sheetRows(wb.getWorksheet("About")!).flat().join("\n");
  check("2e. the About sheet says COLA and AABB read Being verified until checked", about.includes(`COLA and AABB references read "${BV}" until they are checked against the source standards.`), about.slice(0, 300));
  const custom = sheetRows(wb.getWorksheet("Custom Questions")!);
  const cRow = custom.find((r) => r.includes("Made-up custom: transfusion consent audit")) || [];
  check("2f. the lab's own custom question keeps its own AABB and COLA references", cRow[custom[0].indexOf("AABB Standard")] === LAB_AABB && cRow[custom[0].indexOf("COLA Criterion")] === LAB_COLA, JSON.stringify(cRow));
  // A current browser sends Being verified already; the result is the same.
  const xlNew = await call(EDITOR, "POST", `/api/labs/${A}/veritascan/excel/${scan}`, { referenceItems: rawRefs.map((r: any) => ({ ...r, aabb: BV, cola: BV })) });
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(xlNew.buf as any);
  check("2g. a body without the numbers gives the same sheet", JSON.stringify(sheetRows(wb2.getWorksheet("VeritaScan")!)) === JSON.stringify(main));
  // A lab with TJC and CAP only: no COLA/AABB column, no note, and the TJC/CAP cells as before.
  sqlite.prepare("UPDATE labs SET accreditation_cola = 0, accreditation_aabb = 0 WHERE id = ?").run(A);
  const xlTc = await call(EDITOR, "POST", `/api/labs/${A}/veritascan/excel/${scan}`, { referenceItems: rawRefs });
  const wb3 = new ExcelJS.Workbook(); await wb3.xlsx.load(xlTc.buf as any);
  const h3 = sheetRows(wb3.getWorksheet("VeritaScan")!)[0];
  check("2h. a TJC and CAP lab gets no AABB or COLA column and no note", !h3.includes("AABB Standard") && !h3.includes("COLA Criterion") && h3.includes("TJC Standard") && !sheetRows(wb3.getWorksheet("About")!).flat().join(" ").includes(BV), h3.join("|"));
  sqlite.prepare("UPDATE labs SET accreditation_cola = 1, accreditation_aabb = 1 WHERE id = ?").run(A);

  // ── 3. VeritaScan PDF (full report) ───────────────────────────────────────────────────────────────────────────────────
  const tk = await call(EDITOR, "POST", `/api/labs/${A}/veritascan/pdf/${scan}/full`, { referenceItems: rawRefs });
  const pdf = await call(EDITOR, "GET", `/api/pdf/${tk.j?.token}`);
  const pages: string[] = tk.s === 200 && pdf.s === 200 ? JSON.parse(pdfText(pdf.buf, "veritascan-full.pdf")) : [];
  // The table wraps cells across lines (and breaks at hyphens), so read it as one line of words.
  const flat = pages.join("\n").replace(/-\n/g, "-").replace(/\s+/g, " ");
  const aabbHits = (flat.match(/AABB \d+\.\d+(\.\d+)?/g) || []).filter((m) => !LAB_AABB.startsWith(m));
  const bvCount = (flat.match(/Being verified/g) || []).length;
  check("3a. the full report renders, with Being verified in the AABB and COLA cell of every one of the 173 items", pages.length > 1 && bvCount >= 2 * SCAN_ITEMS.length, `${tk.s} ${pdf.s} ${pages.length} pages, ${bvCount}`);
  check("3b. it prints none of our AABB numbers (only the lab's own custom one)", aabbHits.length === 0, aabbHits.slice(0, 5).join(", "));
  // COLA numbers are short ("QC 1"); one that also occurs in a question's own words can't be told apart, so leave those out.
  const questions = (SCAN_ITEMS as any[]).map((i) => i.question).join(" ");
  const token = (s: string, c: string) => new RegExp(`(^|[^A-Za-z0-9.])${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9.]|$)`).test(s);
  const colaHits = [...ourCola].filter((c) => token(flat, c) && !token(questions, c));
  check("3c. it prints none of our COLA numbers", colaHits.length === 0, colaHits.slice(0, 8).join(", "));
  check("3d. TJC, CAP and CFR references still print (items 1 and 2)", flat.includes("QSA.02.01.01 EP1") && flat.includes("QSA.02.01.01 EP2") && flat.includes("GEN.30000") && flat.includes("42 CFR §493.1256(d)"));
  check("3e. the page says why", flat.includes(`COLA and AABB references read "${BV}" until they are checked`));
  check("3f. the lab's own custom question prints its own AABB and COLA", flat.includes(LAB_AABB) && flat.includes(LAB_COLA), flat.slice(flat.indexOf("Made-up custom"), flat.indexOf("Made-up custom") + 200));

  // ── 4. VeritaDC master list ───────────────────────────────────────────────────────────────────────────────────────────
  const withCola = VERITAPOLICY_MASTER_LIST.find((p) => p.cola_citations && p.aabb_citations && p.tjc_citations && p.cap_citations)!;
  const ce = await call(EDITOR, "POST", `/api/labs/${A}/veritapolicy/custom-entries`, { policy_name: "Made-up custom policy", section: "Custom", cola_citations: "LAB COLA 7", aabb_citations: "LAB AABB 3.2" });
  const tr = await call(EDITOR, "GET", `/api/labs/${A}/veritapolicy/master-list`);
  const row = (id: string) => (tr.j?.rows || []).find((r: any) => r.policy_id === id);
  const ao = (r: any, label: string) => (r?.ao_citations || []).find((a: any) => a.label === label)?.value;
  check("4a. the tracker shows Being verified for our COLA and AABB, the numbers as before for TJC and CAP", tr.s === 200 && ao(row(withCola.policy_id), "COLA") === BV && ao(row(withCola.policy_id), "AABB") === BV && ao(row(withCola.policy_id), "TJC") === withCola.tjc_citations && ao(row(withCola.policy_id), "CAP") === withCola.cap_citations, JSON.stringify(row(withCola.policy_id)?.ao_citations));
  check("4b. no master row of the tracker carries a COLA or AABB number", (tr.j?.rows || []).filter((r: any) => !r.is_custom).every((r: any) => ao(r, "COLA") === BV && ao(r, "AABB") === BV));
  const own = (tr.j?.rows || []).find((r: any) => r.is_custom && r.policy_name === "Made-up custom policy");
  check("4c. a custom entry keeps the COLA and AABB citations the lab typed", ce.s < 300 && ao(own, "COLA") === "LAB COLA 7" && ao(own, "AABB") === "LAB AABB 3.2", `${ce.s} ${JSON.stringify(own?.ao_citations)}`);
  const mx = await call(EDITOR, "GET", `/api/labs/${A}/veritapolicy/master-list/excel`);
  const mwb = new ExcelJS.Workbook(); await mwb.xlsx.load(mx.buf as any);
  const mws = mwb.worksheets.find((s: any) => s.name !== "About")!;
  const mrows = sheetRows(mws), mh = mrows.findIndex((r) => r.includes("COLA Citations"));
  const mHead = mrows[mh] || [], mBody = mrows.slice(mh + 1);
  const mRow = mBody.find((r) => r[0] === withCola.policy_id) || [];
  check("4d. the master list workbook: COLA and AABB columns read Being verified on every row", mx.s === 200 && mBody.length === VERITAPOLICY_MASTER_LIST.length && mBody.every((r) => r[mHead.indexOf("COLA Citations")] === BV && r[mHead.indexOf("AABB Citations")] === BV), `${mx.s} ${mHead.join("|")}`);
  check("4e. its TJC, CAP and CFR cells are the master list's", mRow[mHead.indexOf("TJC Citations")] === withCola.tjc_citations && mRow[mHead.indexOf("CAP Citations")] === withCola.cap_citations && mRow[mHead.indexOf("CFR Citations")] === withCola.cfr_citations);
  const mAbout = sheetRows(mwb.getWorksheet("About")!).flat().join("\n");
  check("4f. its About sheet no longer says COLA and AABB are crosswalked, and says they are being verified", !mAbout.includes("standards of TJC, CAP, COLA, and AABB") && mAbout.includes("against the published standards of TJC and CAP.") && mAbout.includes(`COLA and AABB references read "${BV}"`));
  const rq = await call(EDITOR, "GET", "/api/veritapolicy/requirements", undefined, A);
  const cfrRows = (rq.j || []).filter((r: any) => r.source === "cfr");
  check("4g. the CFR crosswalk API: every row's COLA and AABB list is Being verified; CAP's as the data has it", rq.s === 200 && cfrRows.length > 100 && cfrRows.every((r: any) => JSON.stringify(r.cola_ids) === JSON.stringify([BV]) && JSON.stringify(r.aabb_ids) === JSON.stringify([BV]))
    && cfrRows.every((r: any) => JSON.stringify(r.cap_ids) === JSON.stringify((CFR_REQUIREMENTS as any[]).find((c) => c.id === r.id)?.cap_ids)), `${rq.s} ${cfrRows.length}`);
  const rpdf = await call(EDITOR, "POST", `/api/labs/${A}/veritapolicy/pdf`, {});
  const rwords = rpdf.s === 200 ? JSON.parse(pdfText(rpdf.buf, "veritadc-readiness.pdf")).join("\n") : "";
  const firstCola = withCola.cola_citations.split(";")[0].trim();
  check("4h. the readiness PDF (from the tracker) prints Being verified and not the master list's COLA number", rpdf.s === 200 && rwords.includes(BV) && !rwords.includes(withCola.aabb_citations.split(";")[0].trim()), `${rpdf.s} ${firstCola}`);

  // ── 5. VeritaDC documents generated from the master list ──────────────────────────────────────────────────────────────
  const { loadTemplate, generatePolicyDocxBuffer } = await import("../../server/veritapolicyDocx");
  const docRow = VERITAPOLICY_MASTER_LIST.find((p) => p.cola_citations && p.aabb_citations && p.tjc_citations && loadTemplate(p.policy_id));
  check("5a. a template policy with COLA, AABB and TJC citations exists to test with", !!docRow);
  if (docRow) {
    const dx = await call(EDITOR, "GET", `/api/labs/${A}/veritapolicy/templates/${docRow.policy_id}/docx`);
    const dtext = dx.s === 200 ? await docxText(dx.buf) : "";
    const numbers = [...docRow.cola_citations.split(";"), ...docRow.aabb_citations.split(";")].map((s) => s.trim()).filter(Boolean);
    check("5b. the Word document's crosswalk reads COLA Being verified and AABB Being verified", dx.s === 200 && /COLA\s*Being verified/.test(dtext) && /AABB\s*Being verified/.test(dtext), `${dx.s} ${dtext.slice(0, 200)}`);
    check("5c. it carries none of the master list's COLA or AABB numbers, and its TJC citation", numbers.every((n) => !dtext.includes(n)) && dtext.includes(docRow.tjc_citations.split(";")[0].trim()), numbers.filter((n) => dtext.includes(n)).join(", "));
    // Every house format, handed the raw crosswalk, still prints Being verified (the render path masks, not only the route).
    const house: any = await import("../../server/veritapolicyHouseFormats");
    const { Packer } = await import("docx");
    const builders = Object.keys(house).filter((k) => /^build.*Document$/.test(k) && typeof house[k] === "function");
    const raw = { cfr: docRow.cfr_citations, tjc: docRow.tjc_citations, cola: docRow.cola_citations, aabb: docRow.aabb_citations };
    const bad: string[] = [];
    for (const b of builders) {
      const t = await docxText(await Packer.toBuffer(house[b](loadTemplate(docRow.policy_id), { lab_name: "Made-up Lab A", clia_number: "00D0000000" }, raw, {}, { format: "x", draftDate: "2026-11-27" })));
      if (!/COLA: Being verified/.test(t) || !/AABB: Being verified/.test(t) || numbers.some((n) => t.includes(n))) bad.push(b);
    }
    check("5d. every house format prints COLA: Being verified and AABB: Being verified, never the numbers", builders.length >= 1 && bad.length === 0, `${builders.length} builders; failing ${bad.length}`);
    const plain = await docxText((await generatePolicyDocxBuffer(docRow.policy_id, { lab_name: "Made-up Lab A", clia_number: "00D0000000" }, raw, {}, null))!);
    check("5e. the standard Word renderer handed the raw crosswalk masks it too", /COLA\s*Being verified/.test(plain) && numbers.every((n) => !plain.includes(n)));
  }

  // ── 6. VeritaCheck study PDF: the regulatory references box ───────────────────────────────────────────────────────────
  const { buildStudyPdf } = await import("../../server/studyPdf");
  const points = [80, 100, 120, 140, 160].map((v, i) => ({ level: i + 1, expectedValue: null, instrumentValues: { "Made-up Analyzer X": v, "Made-up Analyzer Y": v * 1.01 } }));
  const sid = Number(sqlite.prepare(`INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, lifecycle_state, tea_is_percentage)
    VALUES (?, ?, 'Made-up Sodium', 'Chemistry', 'Made Up', '2026-11-20', 'method_comparison', 0.1, ?, ?, 'pass', ?, 'finalized', 1)`).run(OWNER.id, A, JSON.stringify(points), JSON.stringify(["Made-up Analyzer X", "Made-up Analyzer Y"]), new Date().toISOString()).lastInsertRowid);
  const labRow = sqlite.prepare("SELECT * FROM labs WHERE id = ?").get(A);
  const sp = await buildStudyPdf(sqlite, sqlite.prepare("SELECT * FROM studies WHERE id = ?").get(sid), labRow, { name: "Owner", email: OWNER.email });
  const swords = JSON.parse(pdfText(sp.buffer, "veritacheck-method-comparison.pdf")).join("\n");
  check("6a. the box prints COLA and AABB as Being verified", /COLA CRITERIA/i.test(swords) && /AABB STANDARD/i.test(swords) && (swords.match(/Being verified/g) || []).length >= 2, swords.slice(0, 200));
  check("6b. none of the box's COLA or AABB numbers (LAB.022, LAB.023, 5.7.1, 5.7.3)", !/LAB\.02[0-9]/.test(swords) && !/\b5\.7\.[13]\b/.test(swords));
  check("6c. its TJC, CAP, CLSI and CFR references print as before", swords.includes("QSA.02.08.01") && swords.includes("COM.04250") && swords.includes("COM.04300") && swords.includes("EP09c") && swords.includes("§493.927"));

  // ── 7. Who ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const other = await call(OTHER, "POST", `/api/labs/${A}/veritascan/excel/${scan}`, { referenceItems: rawRefs });
  check("7a. another customer can't export lab A's scan", other.s === 403 || other.s === 404, String(other.s));
  const crossLab = await call(OTHER, "POST", `/api/labs/${X}/veritascan/excel/${scan}`, { referenceItems: rawRefs });
  check("7b. nor through their own lab's address", crossLab.s === 404 || crossLab.s === 403, String(crossLab.s));
  const otherDoc = await call(OTHER, "GET", `/api/labs/${A}/veritapolicy/master-list`);
  check("7c. another customer can't read lab A's master list", otherDoc.s === 403 || otherDoc.s === 404, String(otherDoc.s));
  for (const [who, u] of [["a Staff login", STAFF], ["a view-only reviewer", VIEWER], ["Veritas support", SUPPORT]] as const) {
    const r = await call(u, "POST", `/api/labs/${A}/veritascan/excel/${scan}`, { referenceItems: rawRefs });
    let shown = false;
    if (r.s === 200) { const b = new ExcelJS.Workbook(); await b.xlsx.load(r.buf as any); shown = sheetRows(b.getWorksheet("VeritaScan")!).flat().some((c) => ourAabb.has(c) || ourCola.has(c)); }
    check(`7d. ${who}: refused, or given the workbook with no number of ours (${r.s})`, r.s === 403 || (r.s === 200 && !shown));
    const t = await call(u, "GET", `/api/labs/${A}/veritapolicy/master-list`);
    const leak = t.s === 200 && (t.j?.rows || []).some((x: any) => !x.is_custom && (x.ao_citations || []).some((a: any) => (a.label === "COLA" || a.label === "AABB") && a.value !== BV));
    check(`7e. ${who}: the master list is refused or shows no COLA/AABB number (${t.s})`, t.s === 403 || (t.s === 200 && !leak));
  }

  // ── 8. Source scan ────────────────────────────────────────────────────────────────────────────────────────────────────
  const files = execFileSync("git", ["-C", ROOT, "ls-files", "client/src", "server", "shared"]).toString("utf8").split(/\r?\n/)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !DATA_FILES.has(f));
  const found: string[] = [];
  const used = new Set<number>();
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), "utf8");
    found.push(...scanSource(f, text));
    text.split(/\r?\n/).forEach((line) => ALLOWED.forEach((a, i) => { if (a.file === f && line.includes(a.has)) used.add(i); }));
  }
  check("8a. every read of our COLA/AABB fields outside the data files goes through displayRef or is listed with its reason", found.length === 0, `\n    ${found.join("\n    ")}`);
  const stale = ALLOWED.filter((_, i) => !used.has(i));
  check("8b. every listed exception still matches a line (no stale entry)", stale.length === 0, stale.map((s) => `${s.file}: ${s.has}`).join(" | "));
  check("8c. the scan bites: a planted read without the helper is caught, and with it is not",
    scanSource("client/src/pages/Planted.tsx", "const x = item.aabb;\nconst y = displayRef('AABB', item.aabb);").length === 1
    && scanSource("server/planted.ts", "const cols = [{ key: 'cola_citations', label: 'COLA' }];\nconst v = (r as any)[a.key];").length === 1
    && scanSource("server/planted.ts", "const z = row.cola_ids.join(', ');").length === 1);
  check("8d. the files the brief names are scanned", ["server/pdfReport.ts", "server/veritapolicyDocx.ts", "server/veritapolicyHouseFormats.ts", "server/routes.ts", "client/src/pages/VeritaScanScanPage.tsx", "client/src/pages/DemoLabPage.tsx", "server/exportAll.ts"].every((f) => files.includes(f)));

  w.finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
