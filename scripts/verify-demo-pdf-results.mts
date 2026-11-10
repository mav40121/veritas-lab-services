// scripts/verify-demo-pdf-results.mts
//
// Receipt for BUG-163 (2026-11-10). The public demo's study PDF (GET /api/demo/studies/:id/pdf) worked out its own
// results, one branch per study type, instead of the results page's (computeStudyResults). Lot-to-lot passed only when
// every pair passed (the real rule: mean |%diff| within TEa and at least 90% of pairs within), calibration
// verification compared a units criterion as a percent (±4 mmol/L read as ±400%), and the lot-to-lot and calibration
// summaries said a lot or a calibration was "acceptable". Through the real route, on a fresh database with the demo
// seed, it checks:
//   1. every seeded demo study gives a PDF, and its verdict line is the results page's
//   2. a made-up demo lot-to-lot study with 19 of 20 pairs within 10% (mean 2.5%) reads PASS, 19/20 (it read FAIL)
//   3. a made-up demo calibration verification with a ±4 mmol/L criterion and one level 6 mmol/L off reads FAIL (it read PASS)
//   4. no demo PDF says "acceptable for clinical use" or "Calibration verification acceptable"
// The PDFs' text is read with PyMuPDF (python -E; it is installed in the user site). With OUT=<dir> the PDFs are kept there.
// Run: rm -f .tmp-demopdf.db && DB_PATH=.tmp-demopdf.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/verify-demo-pdf-results.mts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import express from "express";
(globalThis as any).require ??= createRequire(import.meta.url);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};

const { db } = await import("../server/db");
const { seedDemoData } = await import("../server/seedDemo");
const { registerRoutes } = await import("../server/routes");
const { studyRowToClient } = await import("../server/studyPdf");
const { computeStudyResults } = await import("../client/src/lib/studyResults");
const { DEMO_USER_EMAIL } = await import("../server/constants");
const sqlite = (db as any).$client;
await seedDemoData();
const demoUser = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(DEMO_USER_EMAIL) as any;
check("0. the demo seed made the demo user", !!demoUser?.id);

// Two made-up demo studies whose verdicts the old branches got wrong.
const ins = sqlite.prepare(`INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit,
  clia_absolute_floor, clia_absolute_unit, clia_preset_label, data_points, instruments, status, created_at)
  VALUES (@user, @name, 'Made-up Analyzer', 'Made-up Analyst', '2026-11-10', @type, @tea, @pct, @unit, NULL, NULL, 'Lab-defined', @points, '["Made-up Analyzer"]', @status, '2026-11-10T00:00:00Z')`);
const cur = Array.from({ length: 20 }, (_, i) => 100 + 10 * i);
const lotPairs = cur.map((c, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, currentLot: c, newLot: +(c * (i === 7 ? 1.12 : 1.02)).toFixed(2), cohort: "Normal" }));
const lotId = Number(ins.run({ user: demoUser.id, name: "Made-up Lot Rule", type: "lot_to_lot", tea: 0.1, pct: 1, unit: "%", status: "pass",
  points: JSON.stringify({ data: lotPairs, sampleType: "normal", currentLot: "CUR-MU", newLot: "NEW-MU", analyte: "Made-up Glucose", units: "mg/dL" }) }).lastInsertRowid);
const calLevels = [[120, 123], [140, 142], [160, 166]].map(([e, m], i) => ({ level: i + 1, expectedValue: e, instrumentValues: { "Made-up Analyzer": m } }));
const calId = Number(ins.run({ user: demoUser.id, name: "Made-up Sodium", type: "cal_ver", tea: 4, pct: 0, unit: "mmol/L", status: "fail",
  points: JSON.stringify(calLevels) }).lastInsertRowid);

const app = express();
app.use(express.json({ limit: "10mb" }));
const server = http.createServer(app);
await registerRoutes(server, app);
await new Promise<void>((resolve) => server.listen(0, resolve));
const addr = server.address();
const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), "demopdf-"));
fs.mkdirSync(OUT, { recursive: true });
const pdfText = (file: string): string => execFileSync("python", ["-E", "-c",
  "import sys, fitz\nd = fitz.open(sys.argv[1])\nsys.stdout.reconfigure(encoding='utf-8')\nprint('\\n'.join(p.get_text() for p in d))", file]).toString("utf-8");
// A PDF states its verdict as a banner ("Meets adopted acceptance criterion ...", "Meets CLSI EP28-A3c criteria"), as
// "Overall PASS" in its stats, or both; where both appear they must agree. Gives "PASS", "FAIL", "DISAGREE" or "".
const verdictOf = (t: string): string => {
  const s = t.replace(/\s+/g, " ");
  const b = s.match(/(Meets|Does not meet) [A-Za-z0-9 ().-]*?(acceptance criterion|criteria)/);
  const banner = b ? (b[1] === "Meets" ? "PASS" : "FAIL") : "";
  const overall = (s.match(/Overall:? (PASS|FAIL)/) || [])[1] ?? "";
  if (banner && overall && banner !== overall) return "DISAGREE";
  return banner || overall;
};
const pdfFor = async (id: number) => {
  const r = await fetch(`${base}/api/demo/studies/${id}/pdf`);
  const j: any = await r.json().catch(() => ({}));
  if (r.status !== 200 || !j.token) return { status: r.status, error: j.error, text: "", file: "" };
  const p = await fetch(`${base}/api/pdf/${j.token}`);
  const buf = Buffer.from(await p.arrayBuffer());
  const file = path.join(OUT, `demo-study-${id}.pdf`);
  fs.writeFileSync(file, buf);
  return { status: r.status, isPdf: buf.subarray(0, 4).toString() === "%PDF", text: pdfText(file), file };
};

try {
  // ── 1 and 4: every demo study ──
  const rows = sqlite.prepare("SELECT * FROM studies WHERE user_id = ? AND (comment IS NULL OR comment != 'COVERAGE_SEED v1') ORDER BY id").all(demoUser.id) as any[];
  check("1. the demo has studies to print", rows.length >= 5, String(rows.length));
  for (const row of rows) {
    const page = computeStudyResults(studyRowToClient(row)) as any;
    const pdf = await pdfFor(row.id);
    const got = verdictOf(pdf.text);
    const want = page.overallPass ? "PASS" : "FAIL";
    check(`1. ${row.study_type} "${row.test_name}": a PDF whose verdict is the results page's (${want})`,
      pdf.status === 200 && (pdf as any).isPdf && got === want, `${pdf.status} ${pdf.error ?? ""} | ${got || "(no verdict found)"}`);
    check(`4. ${row.study_type} "${row.test_name}": no "acceptable" advice, and no DRAFT watermark (the sample report never had one)`,
      !/acceptable for clinical use|Calibration verification acceptable/i.test(pdf.text) && !/\bDRAFT\b/.test(pdf.text));
  }
  // ── 2 and 3: the two the old branches judged wrong ──
  const lot = await pdfFor(lotId);
  check("2. lot-to-lot, 19 of 20 pairs within 10% and mean 2.5%: PASS, 19/20 (the old branch read FAIL: not every pair passed)",
    verdictOf(lot.text) === "PASS" && /19\/20/.test(lot.text.replace(/\s+/g, " ")), verdictOf(lot.text));
  const cal = await pdfFor(calId);
  check("3. calibration verification at ±4 mmol/L, one level 6 mmol/L off: FAIL (the old branch read ±4 as ±400% and PASS)",
    verdictOf(cal.text) === "FAIL", verdictOf(cal.text));
  check("3. ... and the PDF states the criterion in mmol/L, not as a percent", /4(\.0+)? mmol\/L/.test(cal.text) && !/400(\.0)?%/.test(cal.text));
} finally {
  server.close();
}
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
