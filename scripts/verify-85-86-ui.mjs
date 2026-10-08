// scripts/verify-85-86-ui.mjs
// Gate 3 step 8 browser receipt for parking lot #85 and #86 (2026-10-08), run
// against a LOCAL server on a scratch database (it registers an owner,
// provisions a lab and marks onboarding done directly in SCRATCH_DB, so never
// point it at production). Usage:
//   PW_BASE=http://localhost:5131 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-85-86-ui.mjs
//   #85 VeritaCheck verification: Remove on an instrument unit actually removes it
//       (it used to only re-read the package).
//   #86 VeritaMap build, step 1: "request we add your instrument" opens the dialog
//       (it was only rendered on step 2).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5131", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token, lab) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(lab ? { "X-Active-Lab-Id": String(lab) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `v8586-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: "testpass123", name: "V8586", hipaa_acknowledged: true });
const token = reg.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "V8586 Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();

// #85 fixture: a package with two units
const v = await call("POST", `/api/labs/${labId}/veritacheck/verifications`, { instrument_name: "Receipt Analyzer", trigger_type: "new_instrument", elements: ["precision"] }, token);
const u1 = await call("POST", `/api/veritacheck/verifications/${v.id}/instruments`, { serial_number: "SN-KEEP-1" }, token, labId);
const u2 = await call("POST", `/api/veritacheck/verifications/${v.id}/instruments`, { serial_number: "SN-REMOVE-2" }, token, labId);
// #86 fixture: a map to build
const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Receipt Map" }, token);

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) { localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); const id = (u.user || u).id; if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); } }, [token, me]);

  if (mode === "light") {
    // #85: remove the second unit through the UI
    await page.goto(`${BASE}/labs/${labId}/dashboard/verifications?verification=${v.id}`, { waitUntil: "networkidle" });
    // The package sections are buttons ("Instrument Units (2)"), not ARIA tabs.
    await page.getByRole("button", { name: /^Instrument Units/ }).first().click();
    const btn = page.getByTestId(`remove-unit-${u2.id}`);
    await btn.waitFor({ timeout: 15000 });
    await page.getByText("SN-REMOVE-2").first().screenshot({ path: `${OUT}/85_before_${mode}.png` }).catch(() => {});
    await btn.click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.waitForTimeout(1500);
    const visibleAfter = await page.getByText("SN-REMOVE-2").count();
    const keepVisible = await page.getByText("SN-KEEP-1").count();
    const pkg = await call("GET", `/api/veritacheck/verifications/${v.id}`, undefined, token, labId);
    const units = (pkg.instruments || pkg.units || []).map((x) => x.serial_number);
    check("#85 Remove deletes the unit (gone from the screen and the API; the other unit stays)",
      visibleAfter === 0 && keepVisible > 0 && !units.includes("SN-REMOVE-2") && units.includes("SN-KEEP-1"),
      JSON.stringify({ visibleAfter, keepVisible, units }));
  }

  // #86: the request dialog opens on build step 1
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${map.id}/build`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  const trigger = page.getByTestId("request-instrument-trigger");
  await trigger.waitFor({ timeout: 15000 });
  await trigger.click();
  const dlg = page.getByRole("dialog").filter({ hasText: "Request an instrument" });
  const opened = await dlg.isVisible({ timeout: 5000 }).catch(() => false);
  if (opened) await dlg.screenshot({ path: `${OUT}/86_request_dialog_${mode}.png` });
  check(`#86 (${mode}) build step 1: the request link opens the "Request an instrument" dialog`, opened);
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
