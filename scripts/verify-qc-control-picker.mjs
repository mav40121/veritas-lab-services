// scripts/verify-qc-control-picker.mjs
// Gate 3 step 8 browser receipt for bug 7/8 (2026-10-09, Gameday Brighton and
// Plymouth staff could not find how to switch from PSA FREND A Level 1 to PSA
// FREND B or Testosterone). Run against a LOCAL server on a scratch database
// (it registers an owner, provisions a lab and marks onboarding done directly in
// SCRATCH_DB, so never point it at production). Usage:
//   PW_BASE=http://localhost:5141 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-qc-control-picker.mjs
// Builds three control lines that share ONE lot number (as NanoEntek FREND
// controls do), then checks: the "What are you running?" picker names every
// line by analyte, analyzer and level; choosing a line moves the "Logging for"
// banner to it; the Lot picker lists only that line's lots. Light + dark shots.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5141", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `qc-picker-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "QC Picker", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "QC Picker Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const LINES = [["PSA (FREND A)", "Level 1", 1.29, 0.35], ["PSA (FREND B)", "Level 1", 1.29, 0.35], ["Testosterone (FREND A)", "Level 1", 240, 30]];
for (const [analyte, level, mean, sd] of LINES) {
  const r = await call("POST", `/api/labs/${labId}/qc/control-lots`, { analyte, level, lot_number: "6361A26001", manufacturer: "NanoEntek", mfr_mean: mean, mfr_sd: sd }, token);
  check(`lot created: ${analyte} ${level}`, !!(r?.lot?.id ?? r?.id), JSON.stringify(r).slice(0, 160));
}

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [token, me]);
  await page.goto(`${BASE}/labs/${labId}/veritaqc-app`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  const line = page.getByTestId("qc-control-line");
  await line.waitFor({ timeout: 20000 });
  check(`${mode}: closed control picker names the analyte, analyzer and level`, /\(FREND [AB]\).*Level 1/.test(await line.innerText()), await line.innerText());
  await line.click();
  const opts = (await page.locator("[role=option]").allInnerTexts()).map((t) => t.trim());
  check(`${mode}: picker lists all three lines by name`, opts.length === 3 && opts.some((o) => /PSA \(FREND A\).*Level 1/.test(o)) && opts.some((o) => /PSA \(FREND B\).*Level 1/.test(o)) && opts.some((o) => /Testosterone \(FREND A\).*Level 1/.test(o)), JSON.stringify(opts));
  await page.locator("[role=option]", { hasText: "Testosterone (FREND A)" }).click();
  await page.waitForTimeout(600);
  const banner = (await page.locator("text=Logging for").locator("xpath=..").innerText()).replace(/\s+/g, " ");
  check(`${mode}: choosing Testosterone moves the Logging-for banner to Testosterone`, /Logging for Testosterone \(FREND A\)/.test(banner), banner);
  await page.getByTestId("qc-lot").click();
  const lotOpts = (await page.locator("[role=option]").allInnerTexts()).map((t) => t.trim());
  check(`${mode}: Lot picker lists only the chosen line's lots`, lotOpts.length === 1 && /6361A26001/.test(lotOpts[0]), JSON.stringify(lotOpts));
  await page.keyboard.press("Escape");
  const card = page.getByTestId("qc-control-line").locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await card.screenshot({ path: `${OUT}/qc_control_picker_${mode}.png` });
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
