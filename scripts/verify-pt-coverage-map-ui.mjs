// scripts/verify-pt-coverage-map-ui.mjs
// Gate 3 receipt for bug 6 (2026-10-09), run against a LOCAL server on a scratch
// database (it registers an owner, provisions a lab and marks onboarding done
// directly in SCRATCH_DB, so never point it at production). Usage:
//   PW_BASE=http://localhost:5142 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-pt-coverage-map-ui.mjs
// Loads Redington-Fairview's exact 27-name menu (names, specialties and
// complexities as on prod 2026-10-09), then checks the coverage API and the
// VeritaPT page: no analyte is called "PT not required" from complexity; ABO,
// Rh, crossmatch, antibody ID, PT and APTT are regulated gaps; same-analyte menu
// tests share one row; unmatched names ask the lab to confirm. Light + dark shots.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5142", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

// Redington-Fairview lab 34 menu, 2026-10-09 (analyte, specialty, complexity).
const MENU = [
  ["ABO Group", "Immunohematology", "HIGH"], ["Antibody Identification", "Immunohematology", "HIGH"], ["Antibody Screen", "Immunohematology", "HIGH"],
  ["Fibrinogen", "Hematology", "MODERATE"], ["Rh typing", "Immunohematology", "HIGH"], ["D-dimer", "Hematology", "MODERATE"],
  ["ABO forward grouping", "Blood Bank", "HIGH"], ["ABO reverse grouping", "Blood Bank", "HIGH"], ["ABO/Rh confirmation", "Blood Bank", "HIGH"],
  ["Activated partial thromboplastin time (APTT)", "Hematology", "MODERATE"], ["Antibody identification panel A (11-cell panel)", "Blood Bank", "HIGH"],
  ["Antibody identification panel B (11-cell panel)", "Blood Bank", "HIGH"], ["Crossmatch (AHG)", "Immunohematology", "HIGH"], ["Crossmatch (IS)", "Immunohematology", "HIGH"],
  ["Crossmatch compatibility testing (AHG)", "Blood Bank", "HIGH"], ["DAT anti-IgG", "Blood Bank", "HIGH"], ["DAT anti-IgG/anti-C3d", "Blood Bank", "HIGH"],
  ["Direct Antiglobulin Test (DAT)", "Immunohematology", "HIGH"], ["Fetal Screen", "Blood Bank", "HIGH"],
  ["Heparin, unfractionated heparin (UFH) and low molecular weight heparin (LMWH)", "Hematology", "HIGH"], ["Immediate spin crossmatch", "Blood Bank", "HIGH"],
  ["Phenotyping (Rh, Kell, Duffy, Kidd, MNS)", "Immunohematology", "HIGH"], ["Prenatal testing", "Blood Bank", "MODERATE"], ["Prothrombin time (PT)", "Hematology", "MODERATE"],
  ["Rh Type", "Immunohematology", "HIGH"], ["Selected cells", "Blood Bank", "MODERATE"], ["Weak D", "Blood Bank", "HIGH"],
];
const email = `pt-map-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "PT Map", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "PT Map Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Blood Bank and Coag" }, token);
const seeded = await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: map.id, defaultActive: 1, instruments: [{ name: "Bench", tests: MENU.map(([analyte, specialty, complexity]) => ({ analyte, specialty, complexity, active: 1 })) }] });
check("menu loaded (27 tests)", seeded?.totals?.inserted === 27, JSON.stringify(seeded?.totals));

const cov = await call("GET", `/api/labs/${labId}/pt/coverage`, undefined, token);
const rows = cov.coverage || [];
const byMenu = (name) => rows.find((r) => (r.menuTests || []).includes(name));
check("no row is 'PT not required' from complexity", !rows.some((r) => r.status === "no_pt_required" || /complexity -- PT enrollment is not required/.test(r.notes || "")), JSON.stringify(rows.map((r) => r.status)));
for (const name of ["ABO forward grouping", "ABO reverse grouping", "ABO/Rh confirmation", "Rh Type", "Crossmatch (IS)", "Immediate spin crossmatch", "Antibody identification panel A (11-cell panel)", "Prothrombin time (PT)", "Activated partial thromboplastin time (APTT)"]) {
  const r = byMenu(name);
  check(`${name} -> regulated gap`, !!r && r.tier === "regulated" && r.status === "gap", r ? `${r.analyteName} ${r.tier} ${r.status}` : "no row");
}
const abo = rows.find((r) => r.analyteName === "ABO Group");
check("ABO menu tests share one row", !!abo && ["ABO Group", "ABO forward grouping", "ABO reverse grouping", "ABO/Rh confirmation"].every((n) => abo.menuTests.includes(n)) && rows.filter((r) => r.analyteName === "ABO Group").length === 1, JSON.stringify(abo && abo.menuTests));
for (const name of ["DAT anti-IgG", "Phenotyping (Rh, Kell, Duffy, Kidd, MNS)", "Fetal Screen"]) {
  const r = byMenu(name);
  check(`${name} -> not regulated, accuracy check`, !!r && r.tier === "unregulated" && r.status === "recommended", r ? `${r.analyteName} ${r.tier} ${r.status}` : "no row");
}
for (const name of ["Prenatal testing", "Selected cells", "Weak D"]) {
  const r = byMenu(name);
  check(`${name} -> confirm PT requirement`, !!r && r.status === "unmatched" && /Confirm whether PT is required/.test(r.notes || ""), r ? `${r.status}: ${r.notes}` : "no row");
}
// ABO Group, D (Rho) Typing, Antibody Identification, Unexpected Antibody Detection,
// Compatibility Testing, Fibrinogen, PTT, PT/INR: 8 regulated analytes, each once.
check("summary regulatedGaps counts each regulated analyte once", cov.summary && cov.summary.regulatedGaps === 8, JSON.stringify(cov.summary));

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [token, me]);
  await page.goto(`${BASE}/labs/${labId}/veritapt/app`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  const table = page.locator("table").filter({ hasText: "PT Category" }).first();
  await table.waitFor({ timeout: 20000 });
  const text = await table.innerText();
  check(`${mode}: page shows no "PT Not Required" badge`, !/PT Not Required/.test(text), "");
  check(`${mode}: page lists the lab's own ABO tests under ABO Group`, /Your tests:[^\n]*ABO forward grouping/.test(text), "");
  check(`${mode}: page asks to confirm unmatched names`, /Confirm PT Requirement/.test(text), "");
  await table.screenshot({ path: `${OUT}/pt_map_${mode}.png` });
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
