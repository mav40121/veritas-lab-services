// scripts/verify-regulated-analyte-labels-ui.mjs
// Gate 3 receipt for the VeritaCheck label fix (2026-11-05). Run against a LOCAL server on a scratch database, with made-up studies (it registers an owner,
// provisions a lab and writes to SCRATCH_DB, so never point it at production). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-regulated-analyte-labels-ui.mjs
// In a real browser, on the study results page: each study's label on screen matches what the study holds, and Download PDF still delivers a PDF, which is saved
// to OUT so its wording can be read against the screen.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const PW = ["Labels", "chk", "77!"].join("-");
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `labels-ui-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Labels UI Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999999' WHERE id = ?").run(labId);

const CALVER = JSON.stringify([2, 5, 10, 20, 40].map((v, i) => ({ level: i + 1, expectedValue: v * 10, instrumentValues: { "Made-up Analyzer": +(v * 10 * (i % 2 ? 1.01 : 0.99)).toFixed(2) } })));
const ACCURACY = JSON.stringify({ analyte: "", units: "U/L", levels: [{ name: "L1", assigned_value: 50, replicates: [50, 50.5, 49.5] }, { name: "L2", assigned_value: 200, replicates: [201, 199, 200] }] });
const insert = sdb.prepare(`INSERT INTO studies (user_id, created_by_user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, tea_is_percentage, tea_unit, clia_absolute_floor, clia_absolute_unit, clia_preset_label)
  VALUES (@user, @user, @lab, @name, 'Made-up Analyzer', 'Made-up Analyst', '2026-11-05', @type, @tea, @points, '["Made-up Analyzer"]', 'pass', '2026-11-05T00:00:00Z', 1, '%', @floor, @floorUnit, @preset)`);
const add = (name, tea, preset, type = "cal_ver", floor = null, floorUnit = null) => Number(insert.run({ user: reg.user.id, lab: labId, name, type, tea, points: type === "cal_ver" ? CALVER : ACCURACY, floor, floorUnit, preset }).lastInsertRowid);

const CASES = [
  // Cortisol read Lab-Set on the PDF and CLIA TEa on the screen. WBC read Lab-Set on both, because the screen matched exact table names only.
  { name: "Cortisol", tea: 0.2, preset: "Cortisol (±20%)", want: "CLIA TEa", file: "cortisol" },
  { name: "WBC", tea: 0.1, preset: "Leukocyte Count / WBC (±10%)", want: "CLIA TEa", file: "wbc" },
  { name: "Glucose", tea: 0.08, preset: "Glucose (±8% or ±6 mg/dL)", floor: 6, floorUnit: "mg/dL", want: "CLIA TEa", file: "glucose" },
  { name: "Hemoglobin", tea: 0.04, preset: "Hemoglobin (±4%)", want: "CLIA TEa", file: "hemoglobin" },
  // The lab's own number stays what it is.
  { name: "Cortisol", tea: 0.15, preset: "Lab-defined", want: "Lab-Set Internal Goal", file: "custom-cortisol" },
  { name: "Glucose", tea: 0.05, preset: "Lab-defined", want: "Lab-Set Internal Goal", file: "custom-glucose" },
  { name: "Lipase", tea: 0.2, preset: "Lab-defined", want: "Lab-Set Internal Goal", file: "lipase" },
  // The accuracy/bias card said "CLIA TEa" for everything.
  { name: "Lipase", tea: 0.2, preset: "Lab-defined", type: "accuracy_bias", want: "Lab-Set Internal Goal", file: "lipase-accuracy" },
  { name: "Cortisol", tea: 0.2, preset: "Cortisol (±20%)", type: "accuracy_bias", want: "CLIA TEa", file: "cortisol-accuracy" },
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
  const id = add(c.name, c.tea, c.preset, c.type || "cal_ver", c.floor ?? null, c.floorUnit ?? null);
  await page.goto(`${BASE}/labs/${labId}/study/${id}/results`, { waitUntil: "networkidle" });
  await page.getByTestId("button-download-pdf").first().waitFor({ timeout: 20000 });
  const wants = await page.getByText(c.want, { exact: true }).count();
  const other = c.want === "CLIA TEa" ? "Lab-Set Internal Goal" : "CLIA TEa";
  const others = await page.getByText(other, { exact: true }).count();
  check(`${c.name} (${c.type || "cal_ver"}, ${c.preset}) reads "${c.want}" on screen`, wants >= 1 && others === 0, `"${c.want}" x${wants}, "${other}" x${others}`);
  await page.screenshot({ path: `${OUT}/${c.file}.png` });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.getByTestId("button-download-pdf").first().click()]);
  await dl.saveAs(`${OUT}/${c.file}.pdf`);
  check(`${c.name}: Download PDF delivered ${dl.suggestedFilename()}`, dl.suggestedFilename().endsWith(".pdf"));
}
check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
await browser.close();
sdb.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
