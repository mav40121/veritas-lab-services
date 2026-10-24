// scripts/verify-req101-library-search-ui.mjs
// Gate 3 browser receipt for REQ-101 (Lifepoint Georgetown, Brittany Harrison, 2026-10-23: "cannot find these
// instruments/ kits... CA-600, Sedimat-15, Binax Legionella, Binax Strep pnuemo"). Run against a LOCAL server on a
// scratch database (it registers an owner, provisions a lab and creates a map, so never point it at production):
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-req101-library-search-ui.mjs
// Checks, light and dark: the VeritaMap build page search finds each of Brittany's four names typed the ways a tech
// would type them, and the CA-600 result says it is also listed as the Sysmex CA-620 / CA-660. Light only: adding the
// BinaxNOW S. pneumoniae card lists its FDA test at MODERATE.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const lib = JSON.parse(fs.readFileSync(new URL("../client/src/lib/fdaInstrumentData.json", import.meta.url), "utf8"));
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const stamp = Date.now();
const email = `req101-${stamp}@example.com`;
const pw = ["Lq", String(stamp).slice(-6), "x"].join("-") + "!"; // throwaway, scratch database only
const token = (await call("POST", "/api/auth/register", { email, password: pw, name: "Library Owner", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Library Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Georgetown" }, token);
check("scratch map created", !!map.id, JSON.stringify(map).slice(0, 120));

const CA = "Siemens CA-600", SED = "Polymedco Sedimat 15 Plus";
const LEG = "Abbott BinaxNOW Legionella Urinary Antigen Card", STREP = "Abbott BinaxNOW Streptococcus pneumoniae Antigen Card";
const SAMPLES = [["CA-600", CA], ["CA600", CA], ["Sysmex CA-660", CA], ["Sedimat-15", SED], ["Binax Legionella", LEG], ["Binax Strep pneumo", STREP]];
const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [token, me]);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${map.id}/build`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  const search = page.locator("input[placeholder^='Type an instrument']").first();
  await search.waitFor({ timeout: 20000 });
  for (const [q, key] of SAMPLES) {
    await search.fill(q);
    await page.waitForTimeout(400);
    const result = page.locator("button", { hasText: key }).first();
    const text = (await result.isVisible().catch(() => false)) ? (await result.innerText()).replace(/\s+/g, " ") : "(no result)";
    const n = lib[key].testCount;
    check(`${mode}: searching "${q}" offers ${key} with ${n} test${n === 1 ? "" : "s"}`, text.includes(key) && new RegExp(`\\b${n} tests`).test(text), text);
    if (key === CA) check(`${mode}: the CA-600 result says it is also listed as the Sysmex CA-620 / CA-660`, /Also listed as: Sysmex CA-600 series, Sysmex CA-620, Sysmex CA-660/.test(text), text);
  }
  await search.fill("CA600");
  await page.waitForTimeout(400);
  const box = search.locator("xpath=ancestor::div[1]/following-sibling::div[1]");
  await ((await box.count()) ? box : page).screenshot({ path: `${OUT}/req101_search_ca600_${mode}.png` });
  if (mode === "light") {
    await search.fill("Binax Strep pneumo");
    await page.waitForTimeout(400);
    await page.locator("button", { hasText: STREP }).first().click();
    await page.getByRole("button", { name: /^Add Instrument$/ }).click();
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: /Next: Select Tests/ }).click();
    await page.waitForTimeout(2500);
    const row = page.locator("label, li, div", { hasText: /^Streptococcus pneumoniae antigen/ }).filter({ hasText: /HIGH|MODERATE|WAIVED/ }).last();
    const rowText = (await row.count()) ? (await row.innerText()).replace(/\s+/g, " ") : "(no row)";
    check("after adding the BinaxNOW S. pneumoniae card: 'Streptococcus pneumoniae antigen' is listed at MODERATE", /Streptococcus pneumoniae antigen/.test(rowText) && /MODERATE/.test(rowText) && !/HIGH|WAIVED/.test(rowText), rowText.slice(0, 160));
    await page.screenshot({ path: `${OUT}/req101_binax_strep_tests_${mode}.png`, fullPage: false });
  }
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
