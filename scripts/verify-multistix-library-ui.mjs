// scripts/verify-multistix-library-ui.mjs
// Gate 3 browser receipt for the Siemens Multistix 10 SG library entry (Michael 2026-11-09, "add this to the test menu").
// Run against a LOCAL server on a scratch database (it registers an owner, provisions a lab and creates a map, so never point
// it at production):
//   PW_BASE=http://localhost:5199 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-multistix-library-ui.mjs
// Checks, light and dark: the VeritaMap build page search finds the strips typed the ways a tech would type them and shows
// 10 tests; light only: adding them lists the ten dipstick tests, each WAIVED, as the FDA records have them (K992257).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5199", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
const lib = JSON.parse(fs.readFileSync(new URL("../client/src/lib/fdaInstrumentData.json", import.meta.url), "utf8"));
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const stamp = Date.now();
const email = `multistix-${stamp}@example.test`;
const pw = ["Ms", String(stamp).slice(-6), "x"].join("-") + "!"; // throwaway, scratch database only
const token = (await call("POST", "/api/auth/register", { email, password: pw, name: "Library Owner", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Library Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Urinalysis" }, token);
check("scratch map created", !!map.id, JSON.stringify(map).slice(0, 120));

const KEY = "Siemens Multistix 10 SG Reagent Strips (visual read)";
const TESTS = Object.keys(lib[KEY].tests);
const SAMPLES = ["Multistix", "multistix 10 sg", "Multistix10SG", "Bayer Multistix"];
const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, colorScheme: mode });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [token, me]);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${map.id}/build`, { waitUntil: "networkidle" });
  const search = page.locator("input[placeholder^='Type an instrument']").first();
  await search.waitFor({ timeout: 20000 });
  const mp = Object.values(lib).filter((v) => v.category === "Manual Procedures").length;
  const sizeText = `library of ${Object.keys(lib).length - mp} analyzers and ${mp} manual procedures`;
  check(`${mode}: the help text gives the library's size (${sizeText})`, (await page.evaluate(() => document.body.innerText)).includes(sizeText));
  for (const q of SAMPLES) {
    await search.fill(q);
    await page.waitForTimeout(400);
    const result = page.locator("button", { hasText: KEY }).first();
    const text = (await result.isVisible().catch(() => false)) ? (await result.innerText()).replace(/\s+/g, " ") : "(no result)";
    check(`${mode}: searching "${q}" offers ${KEY} with 10 tests`, text.includes(KEY) && /\b10 tests/.test(text), text);
  }
  await search.fill("Multistix");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/multistix_search_${mode}.png`, fullPage: false });
  if (mode === "light") {
    await page.locator("button", { hasText: KEY }).first().click();
    await page.getByRole("button", { name: /^Add Instrument$/ }).click();
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: /Next: Select Tests/ }).click();
    await page.waitForTimeout(2500);
    const body = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, " ");
    const listed = TESTS.filter((t) => body.includes(t));
    check("after adding the strips: all ten dipstick tests are listed", listed.length === 10, `${listed.length} of 10`);
    for (const t of TESTS) {
      const row = page.locator("label, li, div", { hasText: new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).filter({ hasText: /HIGH|MODERATE|WAIVED/ }).last();
      const rowText = (await row.count()) ? (await row.innerText()).replace(/\s+/g, " ") : "(no row)";
      check(`"${t}" is listed WAIVED`, /WAIVED/.test(rowText) && !/HIGH|MODERATE/.test(rowText), rowText.slice(0, 120));
    }
    await page.screenshot({ path: `${OUT}/multistix_tests_${mode}.png`, fullPage: false });
  }
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
