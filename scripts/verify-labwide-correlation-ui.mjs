// scripts/verify-labwide-correlation-ui.mjs
// Gate 3 browser receipt for BUG-011 part C (Michael, Q43 = 1, 2026-10-09): on the
// VeritaMap page, a test run on another of the lab's maps makes this map's row
// "Required", and the row's tooltip names the other map. Run against a LOCAL server
// on a scratch database (it registers an owner, provisions a lab and seeds two maps,
// so never point it at production). Usage:
//   PW_BASE=http://localhost:5150 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-labwide-correlation-ui.mjs
// Shape: Glucose on the Chemistry map and on a nonwaived i-STAT kept on the Blood Bank map (a WAIVED meter
// would not count: BUG-016, Michael 2026-10-09). A WAIVED StatStrip meter also runs Glucose on the Chemistry map:
// the row must still say 2 instruments and the tooltip must not list the meter. Light + dark shots of the tooltip.
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

const email = `labwide-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Lab Wide", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Lab Wide Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const chem = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Chemistry" }, token);
const bb = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Blood Bank" }, token);
const t = (analyte, complexity = "MODERATE") => ({ analyte, specialty: "General Chemistry", complexity, active: 1 });
const s1 = await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: chem.id, defaultActive: 1, instruments: [{ name: "Siemens Atellica CH 930", tests: [t("Glucose"), t("Magnesium")] }, { name: "Nova StatStrip Glucose Hospital Meter", tests: [t("Glucose", "WAIVED")] }] });
const s2 = await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: bb.id, defaultActive: 1, instruments: [{ name: "Abbott i-STAT 1", tests: [t("Glucose", "MODERATE")] }] });
check("two maps seeded in one lab", s1?.totals?.inserted === 3 && s2?.totals?.inserted === 1, JSON.stringify([s1?.totals, s2?.totals]));

const intel = (await call("GET", `/api/labs/${labId}/veritamap/maps/${chem.id}/intelligence`, undefined, token)).intelligence || {};
check("API: Chemistry-map Glucose requires a correlation with the Blood Bank i-STAT", !!intel.Glucose?.correlationRequired && /on map "Blood Bank"/.test(intel.Glucose?.correlationReason || ""), intel.Glucose?.correlationReason || "(none)");
check("API: Magnesium (one analyzer in the lab) does not", !intel.Magnesium?.correlationRequired);

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [token, me]);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${chem.id}`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  const row = page.locator("tr", { hasText: "Glucose" }).first();
  await row.waitFor({ timeout: 20000 });
  const badge = row.getByText("Required", { exact: true }).first();
  check(`${mode}: the Glucose row shows correlation Required`, await badge.isVisible().catch(() => false));
  await badge.hover();
  const peer = page.locator('[data-testid="correlation-peers"]').first();
  await peer.waitFor({ timeout: 8000 }).catch(() => {});
  const txt = (await peer.innerText().catch(() => "")).replace(/\s+/g, " ");
  check(`${mode}: the tooltip names the other map`, /Abbott i-STAT 1/.test(txt) && /on map "Blood Bank"/.test(txt), txt);
  const tip = (await page.locator("p", { hasText: "instruments running this test" }).first().locator("xpath=..").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(`${mode}: the tooltip counts 2 instruments and does not list the waived StatStrip (BUG-016)`, /^2 instruments running this test/.test(tip) && /Siemens Atellica CH 930/.test(tip) && !/StatStrip/.test(tip), tip);
  await page.screenshot({ path: `${OUT}/labwide_tooltip_${mode}.png`, fullPage: false });
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
