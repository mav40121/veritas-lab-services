// scripts/verify-units-limit-ui.mjs
// Gate 3 step 8 receipt for PR 1848 (2026-11-08): the VeritaCheck results screen and PDFs print a criterion stored in
// units as units (Sodium ±4 mmol/L, never ±400.0%), precision and lot-to-lot judge it that way (Q239 = 1), and the
// narratives carry the CFR paragraph and closing line. Run against a LOCAL server on a scratch database with made-up
// studies (it registers an owner, provisions a lab and writes to SCRATCH_DB, so never point it at production):
//   PW_BASE=http://localhost:5199 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-units-limit-ui.mjs
// In a real browser: each study's results page (narrative, criterion, table), then Download PDF, saved to OUT.
// 2026-11-08 follow-up (Q240 = 1): linearity with a units limit is judged level by level (and a percent limit keeps
// the slope test), the calibration summary names the unit, and Save draft on the study form keeps a units preset.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5199", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const PW = ["Units", "chk", "77!"].join("-");
const CLOSING = "Final approval and clinical determination must be made by the laboratory director or designee.";

const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `units-ui-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Units Limit UI Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999999' WHERE id = ?").run(labId);

const A = "Made-up Analyzer A", B = "Made-up Analyzer B";
const insert = sdb.prepare(`INSERT INTO studies (user_id, created_by_user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, tea_is_percentage, tea_unit, clia_absolute_floor, clia_absolute_unit, clia_preset_label)
  VALUES (@user, @user, @lab, @name, @instrument, 'Made-up Analyst', '2026-11-08', @type, @tea, @points, @instruments, @status, '2026-11-08T00:00:00Z', @isPct, @unit, @floor, @floorUnit, @preset)`);
const add = (c) => Number(insert.run({ user: reg.user.id, lab: labId, name: c.test, instrument: c.names.join(", "), type: c.type, tea: c.tea, points: JSON.stringify(c.points), instruments: JSON.stringify(c.names), status: c.status, isPct: c.pct ? 1 : 0, unit: c.unit, floor: c.floor ?? null, floorUnit: c.floorUnit ?? null, preset: c.preset }).lastInsertRowid);

const sodium = { test: "Sodium", tea: 4, pct: false, unit: "mmol/L", preset: "Sodium (±4 mmol/L)" };
const cal = (names, offs) => [118, 130, 142, 153, 165].map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: Object.fromEntries(names.map((n, k) => [n, +(v + offs[i] * (k === 0 ? 1 : -0.8)).toFixed(3)])) }));
const reps = (m, d, n = 20) => Array.from({ length: n }, (_, i) => +(m + (i % 2 ? d : -d)).toFixed(4));
const CASES = [
  { file: "sodium-calver", type: "cal_ver", names: [A], ...sodium, status: "pass", points: cal([A], [1, -1, 0.5, -0.5, 2]),
    has: ["±4 mmol/L", "§493.1255(b)(2) and §493.1253(b)(3)", "Adopted Acceptance Criterion (TEa) was ±4 mmol/L."], closing: true },
  { file: "sodium-calver-two-analyzers", type: "cal_ver", names: [A, B], ...sodium, status: "pass", points: cal([A, B], [1, -1, 0.5, -0.5, 2]),
    has: ["5 calibration levels for Sodium were run on 2 analyzers", "maximum observed error"], hasNot: ["This instrument", "All 10"], closing: true },
  { file: "sodium-precision-fail", type: "precision", names: [A], ...sodium, status: "fail", points: [{ level: 1, levelName: "Level 1", values: reps(140, 2.5) }],
    has: ["largest 2 SD of 5.130 mmol/L", "±4 mmol/L", "2 SD / Limit"], verdict: "FAIL", closing: true },
  { file: "potassium-precision-fail", type: "precision", names: [A], test: "Potassium", tea: 0.3, pct: false, unit: "mmol/L", preset: "Potassium (±0.3 mmol/L)", status: "fail",
    points: [{ level: 1, levelName: "Level 1", values: reps(4.0, 0.2) }], has: ["±0.3 mmol/L", "2 SD / Limit"], hasNot: ["30.0%"], verdict: "FAIL", closing: true },
  { file: "glucose-precision-floor", type: "precision", names: [A], test: "Glucose", tea: 0.08, pct: true, unit: "%", floor: 6, floorUnit: "mg/dL", preset: "Glucose (±8% or ±6 mg/dL)", status: "pass",
    points: [{ level: 1, levelName: "Level 1", values: reps(30, 2.6) }], has: ["or 2 SD ≤ 6", "dual-criterion rule"], verdict: "PASS", closing: true },
  { file: "albumin-precision", type: "precision", names: [A], test: "Albumin", tea: 0.08, pct: true, unit: "%", preset: "Albumin (±8%)", status: "pass",
    points: [{ level: 1, levelName: "Level 1", values: reps(4.0, 0.05) }], has: ["±8.0%", "§493.1253(b)(1)(i)(B)"], hasNot: ["Manufacturer precision claims"], verdict: "PASS", closing: true },
  { file: "sodium-lot-fail", type: "lot_to_lot", names: [A], ...sodium, status: "fail",
    points: { data: [[138, 144], [140, 146], [142, 147], [135, 141], [145, 150]].map(([c, n], i) => ({ specimenId: `S${i + 1}`, currentLot: c, newLot: n, cohort: "Normal" })), sampleType: "normal", currentLot: "L-OLD", newLot: "L-NEW", analyte: "Sodium", units: "mmol/L" },
    has: ["±4 mmol/L", "Mean |Diff|", "5.60 mmol/L", "Diff (mmol/L)"], verdict: "FAIL" },
  { file: "sodium-accuracy", type: "accuracy_bias", names: [A], ...sodium, status: "pass",
    points: { analyte: "Sodium", units: "mmol/L", levels: [{ name: "Low", assigned_value: 120, replicates: [121, 120.5, 121.5] }, { name: "High", assigned_value: 160, replicates: [161, 159.5, 160.5] }] },
    has: ["±4 mmol/L"] },
  { file: "sodium-linearity-fail", type: "linearity", names: [A], ...sodium, status: "fail",
    points: { analyte: "Sodium", units: "mmol/L", levels: [[110, 115.5], [130, 136.5], [150, 157.5], [170, 178.5]].map(([a, m], i) => ({ name: `L${i + 1}`, assigned_value: a, replicates: [m - 0.5, m, m + 0.5] })) },
    has: ["Acceptance for a limit in units: every level's mean within ±4 mmol/L of its assigned value, and r² ≥ 0.95.", "|Mean - Assigned|", "4 of 4 level means differ from the assigned value by more than ±4 mmol/L", "largest difference 8.500 mmol/L"], verdict: "FAIL", dark: "|Mean - Assigned|" },
  { file: "albumin-linearity-percent", type: "linearity", names: [A], test: "Albumin", tea: 0.08, pct: true, unit: "%", preset: "Albumin (±8%)", status: "pass",
    points: { analyte: "Albumin", units: "g/dL", levels: [[1.0, 1.05], [2.0, 2.1], [3.0, 3.15], [4.0, 4.2]].map(([a, m], i) => ({ name: `L${i + 1}`, assigned_value: a, replicates: [m - 0.01, m, m + 0.01] })) },
    has: ["Acceptance: |slope - 1| × 100 within the TEa percent, and r² ≥ 0.95.", "|slope - 1| × 100 = 5.00%"], hasNot: ["|Mean - Assigned|"], verdict: "PASS" },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(`${BASE}/`);
await page.evaluate(([t, u]) => {
  localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1");
}, [reg.token, reg.user]);

for (const c of CASES) {
  const id = add(c);
  await page.goto(`${BASE}/labs/${labId}/study/${id}/results`, { waitUntil: "networkidle" });
  await page.getByTestId("button-download-pdf").first().waitFor({ timeout: 20000 });
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check(`${c.file}: no ±400.0% or 400.0% anywhere on the results screen`, !body.includes("400.0%"));
  for (const h of c.has || []) check(`${c.file}: results screen reads "${h}"`, body.includes(h), body.slice(0, 300));
  for (const h of c.hasNot || []) check(`${c.file}: results screen no longer reads "${h}"`, !body.includes(h));
  if (c.verdict) check(`${c.file}: verdict ${c.verdict}`, body.includes(`Overall: ${c.verdict}`) || body.includes(c.verdict));
  const heading = page.getByText("Study Narrative Summary", { exact: true }).first();
  if (c.closing && (await heading.count()) > 0) {
    const narrative = (await heading.locator("xpath=ancestor::div[.//p][1]").locator("p").first().innerText()).trim();
    check(`${c.file}: narrative ends with the closing line`, narrative.endsWith(CLOSING), narrative.slice(-120));
    check(`${c.file}: narrative gives no instruction`, !/\bReview\b/.test(narrative));
    await heading.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -360));
  }
  await page.screenshot({ path: `${OUT}/${c.file}.png` });
  if (c.file === "sodium-precision-fail" || c.dark) {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    await page.getByText(c.dark || "2 SD / Limit").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/${c.file}-dark.png` });
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
  }
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.getByTestId("button-download-pdf").first().click()]);
  await dl.saveAs(`${OUT}/${c.file}.pdf`);
  const bytes = fs.readFileSync(`${OUT}/${c.file}.pdf`);
  check(`${c.file}: Download PDF delivered a PDF (${dl.suggestedFilename()})`, bytes.subarray(0, 4).toString() === "%PDF");
}

// Save draft on the study form with the Sodium preset: the row keeps the limit in units (it was stored as a percent).
await page.goto(`${BASE}/labs/${labId}/study/new`, { waitUntil: "networkidle" });
await page.getByTestId("input-test-name").fill("Sodium draft check");
const teaCard = page.getByText("Adopted Acceptance Criterion (TEa)", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
await teaCard.getByRole("combobox").first().click();
await page.getByRole("option", { name: "Sodium (±4 mmol/L)" }).click();
const activeTea = (await teaCard.innerText()).replace(/\s+/g, " ");
check("study form: Sodium preset picked, Active TEa ±4 mmol/L", activeTea.includes("Active TEa: ±4 mmol/L"), activeTea.slice(0, 200));
await page.getByTestId("button-save-draft").click();
let draft = null;
for (let i = 0; i < 40 && !draft; i++) { await page.waitForTimeout(250); draft = sdb.prepare("SELECT status, clia_allowable_error AS tea, tea_is_percentage AS pct, tea_unit AS unit, clia_preset_label AS preset FROM studies WHERE test_name = 'Sodium draft check'").get(); }
check("Save draft: the row is a draft with ±4 kept in mmol/L (teaIsPercentage 0, teaUnit mmol/L)",
  !!draft && draft.status === "draft" && draft.tea === 4 && draft.pct === 0 && draft.unit === "mmol/L" && draft.preset === "Sodium (±4 mmol/L)", JSON.stringify(draft));
await page.screenshot({ path: `${OUT}/sodium-draft-saved.png` });

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
await browser.close();
sdb.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
