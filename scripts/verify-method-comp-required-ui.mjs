// scripts/verify-method-comp-required-ui.mjs
// Gate 3 browser receipt for BUG-018 (Michael, Q54 = 1, 2026-10-10): the VeritaMap score card and the map list
// count a missing correlation / method comparison only where 2+ nonwaived instruments run the test
// (42 CFR 493.1281(a)). Run against a LOCAL server on a scratch database (it registers an owner, provisions a lab
// and seeds two maps, so never point it at production). Usage:
//   PW_BASE=http://localhost:5150 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-method-comp-required-ui.mjs
// Shape: Chemistry map, Atellica runs Glucose and Magnesium; Blood Bank map, an i-STAT also runs Glucose.
// Magnesium has a cal ver date (set on the scratch DB). Expected: score card "1 method comp missing" (Glucose only;
// main's code said 2) and the Chemistry card in the map list "1 gap" (Glucose; main's code said 2, counting
// Magnesium for a comparison it does not need). Light + dark shots of the score card.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5150", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `mcreq-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "MC Required", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "MC Required Lab", plan: "hospital" })).labId;
const chem = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Chemistry" }, token);
const bb = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Blood Bank" }, token);
const t = (analyte, complexity = "MODERATE") => ({ analyte, specialty: "General Chemistry", complexity, active: 1 });
const s1 = await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: chem.id, defaultActive: 1, instruments: [{ name: "Siemens Atellica CH 930", tests: [t("Glucose"), t("Magnesium")] }] });
const s2 = await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: bb.id, defaultActive: 1, instruments: [{ name: "Abbott i-STAT 1", tests: [t("Glucose")] }] });
check("two maps seeded in one lab", s1?.totals?.inserted === 2 && s2?.totals?.inserted === 1, JSON.stringify([s1?.totals, s2?.totals]));
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.prepare("UPDATE veritamap_tests SET last_cal_ver = date('now') WHERE map_id = ? AND analyte = 'Magnesium'").run(chem.id);
sdb.close();

const list = await call("GET", `/api/labs/${labId}/veritamap/maps`, undefined, token);
const chemRow = (Array.isArray(list) ? list : []).find((m) => m.id === chem.id);
check("API: Chemistry map lists 1 gap (Glucose), not 2", chemRow?.gaps === 1, JSON.stringify({ gaps: chemRow?.gaps, totalTests: chemRow?.totalTests }));

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([tk, u, lab]) => { localStorage.setItem("veritas_token", tk); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(lab)); localStorage.setItem("theme", "light"); }, [token, me, labId]);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${chem.id}`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.locator("tr", { hasText: "Magnesium" }).first().waitFor({ timeout: 20000 });
  const card = page.locator("text=COMPLIANCE SCORE").first().locator("xpath=ancestor::div[2]");
  const cardText = (await card.innerText().catch(() => "")).replace(/\s+/g, " ");
  check(`${mode}: score card says 1 method comp missing (Glucose only)`, /\b1 method comp missing\b/.test(cardText), cardText);
  await page.screenshot({ path: `${OUT}/mcreq_scorecard_${mode}.png`, clip: { x: 0, y: 60, width: 1400, height: 840 } });
  await page.close();
}
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`${BASE}/`);
const me = await page.evaluate(async ([b, tk]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
await page.evaluate(([tk, u, lab]) => { localStorage.setItem("veritas_token", tk); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(lab)); }, [token, me, labId]);
await page.goto(`${BASE}/labs/${labId}/veritamap-app`, { waitUntil: "networkidle" });
await page.getByText("Chemistry", { exact: true }).first().waitFor({ timeout: 20000 }).catch(() => {});
const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
// Read the Chemistry card only (the Blood Bank card has its own gap count).
const chemCard = (body.match(/Chemistry Updated [A-Za-z]{3} \d{1,2}, \d{4} \d+ tests? (No gaps|\d+ gaps?)/) || [])[1] || "";
check("map list page: the Chemistry card shows 1 gap", chemCard === "1 gap", chemCard || (body.match(/Chemistry.{0,120}/) || [""])[0]);
await page.screenshot({ path: `${OUT}/mcreq_maplist_light.png` });
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
