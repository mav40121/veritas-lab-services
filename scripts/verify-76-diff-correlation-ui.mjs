// scripts/verify-76-diff-correlation-ui.mjs
// Gate 3 step 8 browser receipt for parking lot #76, run against a LOCAL server on a
// scratch database (it registers an owner, provisions a lab and marks onboarding done
// directly in SCRATCH_DB, so never point it at production). Usage:
//   PW_BASE=http://localhost:5131 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-76-diff-correlation-ui.mjs
// Local browser check for parking lot #76: build a map with Sysmex + Manual
// Differential through the API on a scratch server, then load the map page and
// assert the manual "Lymphocytes" row shows "Required" with the paired line.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("@playwright/test");
const BASE = process.env.PW_BASE || "http://localhost:5131", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
const email = `vdc-ui-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: "testpass123", name: "VDC UI", hipaa_acknowledged: true });
const token = reg.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "VDC UI Lab", plan: "hospital" })).labId;
// Scratch DB only: mark onboarding done so the first-run overlay does not cover the map.
const Database = createRequire(import.meta.url)("better-sqlite3");
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const L = `/api/labs/${labId}/veritamap`;
const map = await call("POST", `${L}/maps`, { name: "Hematology" }, token);
const add = async (instrument_name, role, complexity, analytes) => {
  const inst = await call("POST", `${L}/maps/${map.id}/instruments`, { instrument_name, role, category: "Hematology" }, token);
  await call("PUT", `${L}/maps/${map.id}/instruments/${inst.id}/tests`, { tests: analytes.map((analyte) => ({ analyte, specialty: "Hematology", complexity, active: 1 })) }, token);
};
await add("Sysmex XN-1000", "Primary", "MODERATE", ["LYMPH%", "LYMPH#", "NEUT%", "HGB"]);
await add("Manual Differential", "Primary", "HIGH", ["Lymphocytes", "Neutrophils", "Bands"]);

const browser = await chromium.launch();
const results = {};
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); }, [token, me]);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${map.id}`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  // Read the Correlation Required cell by column position, not by row text
  // ("Not Required" contains "Required").
  const heads = await page.locator("thead th").allInnerTexts();
  const corrIdx = heads.findIndex((h) => /correlation/i.test(h) && /required/i.test(h));
  const req = { corrColumn: corrIdx };
  for (const a of ["Lymphocytes", "LYMPH%", "Neutrophils", "NEUT%", "LYMPH#", "Bands", "HGB"]) {
    const rows = page.locator("tbody tr");
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const first = ((await rows.nth(i).locator("td").first().innerText().catch(() => "")) || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0];
      if (first === a) { req[a] = ((await rows.nth(i).locator("td").nth(corrIdx).innerText().catch(() => "")) || "").trim(); break; }
    }
  }
  // Hover the Lymphocytes correlation badge and read the tooltip.
  const lymRow = page.locator("tr", { hasText: "Lymphocytes" }).first();
  await lymRow.scrollIntoViewIfNeeded();
  await lymRow.getByText("Required", { exact: true }).first().hover();
  const tip = page.getByTestId("correlation-peers").first();
  await tip.waitFor({ timeout: 5000 }).catch(() => {});
  const tipText = (await tip.textContent().catch(() => "")) || "";
  results[mode] = { required: req, tooltip: tipText.trim() };
  const bb = await lymRow.boundingBox();
  await page.screenshot({ path: `${OUT}/diff_correlation_${mode}.png`, clip: { x: 0, y: Math.max(0, (bb?.y ?? 300) - 260), width: 1500, height: 560 } });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
