// scripts/verify-same-test-correlation-ui.mjs
// Gate 3 browser receipt for BUG-011 (2026-10-09). Run against a LOCAL server on a
// scratch database (it registers an owner, provisions a lab and seeds a map, so never
// point it at production). Usage:
//   PW_BASE=http://localhost:5149 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-same-test-correlation-ui.mjs
// Seeds a map with the shapes found on production (an XN analyzer, a Manual
// Differential entered as one test, manual vs automated urine sediment, blood bank
// tube vs analyzer with different capital letters), then checks the map
// intelligence API and the VeritaMap page: the same test under another name now
// requires a correlation; different tests (CBC RBC vs urine RBC, % vs #) do not.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5149", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const t = (analyte, specialty = "Hematology", complexity = "MODERATE") => ({ analyte, specialty, complexity, active: 1 });
const INSTRUMENTS = [
  { name: "Sysmex XN-1000", tests: [t("Lymph%"), t("Neut%"), t("LYMPH#"), t("NRBC%"), t("RBC")] },
  { name: "Manual Differential", tests: [t("Manual Diff"), t("NRBC (manual)")] },
  { name: "Urine Microscopic Examination", tests: [t("RBC (urine micro)", "Urinalysis"), t("Casts (urine)", "Urinalysis")] },
  { name: "Sysmex UF-5000", tests: [t("Casts (urine microscopy)", "Urinalysis")] },
  { name: "Blood Bank Tube Method", tests: [t("Antibody Screen", "Immunohematology", "HIGH")] },
  { name: "QuidelOrtho ORTHO VISION Swift", tests: [t("Antibody screen", "Immunohematology", "HIGH")] },
];
const email = `same-test-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Same Test", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Same Test Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Hematology, Urine, Blood Bank" }, token);
const seeded = await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: map.id, defaultActive: 1, instruments: INSTRUMENTS });
check("map seeded (6 instruments, 12 tests)", seeded?.totals?.inserted === 12, JSON.stringify(seeded?.totals));

const intel = (await call("GET", `/api/labs/${labId}/veritamap/maps/${map.id}/intelligence`, undefined, token)).intelligence || {};
const req = (a) => !!intel[a]?.correlationRequired;
for (const a of ["Manual Diff", "Lymph%", "NRBC (manual)", "NRBC%", "Casts (urine)", "Casts (urine microscopy)", "Antibody screen", "Antibody Screen"]) check(`API: "${a}" requires a correlation`, req(a), intel[a]?.correlationReason || "(none)");
for (const a of ["Neut%"]) check(`API: "${a}" requires a correlation (the manual diff covers it)`, req(a));
for (const a of ["LYMPH#", "RBC", "RBC (urine micro)"]) check(`API: "${a}" does NOT require one (no other method runs it)`, !req(a), intel[a]?.correlationReason || "");

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [token, me]);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${map.id}`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByText(/Correlations? Required/).first().waitFor({ timeout: 20000 });
  const body = await page.locator("body").innerText();
  const i = body.search(/Correlations? Required/);
  const panel = body.slice(Math.max(0, i - 10), i + 400).replace(/\n+/g, " | ");
  check(`${mode}: the Correlations Required panel lists Manual Diff`, /Manual Diff/.test(panel), panel.slice(0, 220));
  check(`${mode}: the panel lists the blood bank antibody screen`, /Antibody [Ss]creen/.test(panel));
  const row = page.locator("tr", { hasText: "Manual Diff" }).first();
  await row.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/same_test_map_${mode}.png`, fullPage: false });
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
