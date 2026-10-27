// scripts/verify-study-not-evaluable-ui.mjs
// Gate 3 step 8 browser receipt for BUG-085 (Michael Q18 = 1, 2026-10-27): a method comparison whose listed analyzers
// have no values in its data shows NOT EVALUABLE with the reason, not FAIL, and its PDF button is disabled. Runs against
// a LOCAL server on a scratch database with a made-up study (it inserts the study directly in SCRATCH_DB; never point it
// at production). Usage:
//   PW_BASE=http://localhost:5099 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-study-not-evaluable-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5099", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `nevui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Not Evaluable UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Not Evaluable Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
const points = [80, 100, 120, 140, 160].map((v, i) => ({ level: i + 1, expectedValue: null, instrumentValues: { "Ortho VITROS 5600": v, "Roche Cobas c503": v * 1.02 } }));
const studyId = Number(sdb.prepare(
  `INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, lifecycle_state, tea_is_percentage)
   VALUES (?, ?, 'Sodium Method Comparison Demo', 'Chemistry', 'Demo Analyst', '2026-05-29', 'method_comparison', 0.1, ?, ?, 'pass', ?, 'finalized', 1)`
).run(uid, labId, JSON.stringify(points), JSON.stringify(["Ortho 5600 Primary", "Ortho 5600 Backup", "Ortho VITROS XT 7600 (Sully)"]), new Date().toISOString()).lastInsertRowid);
sdb.close();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`${BASE}/`);
await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
for (const mode of ["light", "dark"]) {
  await page.goto(`${BASE}/labs/${labId}/study/${studyId}/results`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByTestId("badge-not-evaluable").waitFor({ timeout: 20000 });
  const panel = await page.getByTestId("panel-not-evaluable").innerText();
  const pdfDisabled = await page.getByTestId("button-download-pdf").isDisabled();
  const failBadge = await page.getByText("FAIL", { exact: true }).count();
  const body = await page.locator("body").innerText();
  check(`${mode}: NOT EVALUABLE badge and panel with the reason; no FAIL badge, FAIL narrative or Overall line; PDF button disabled`,
    /cannot be evaluated/.test(panel) && /Ortho VITROS 5600/.test(panel) && pdfDisabled && failBadge === 0
      && !/did not meet the adopted acceptance criterion/.test(body) && !/Overall: FAIL/.test(body), panel.replace(/\n/g, " | ").slice(0, 200));
  await page.screenshot({ path: path.join(OUT, `study-not-evaluable-${mode}.png`) });
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
