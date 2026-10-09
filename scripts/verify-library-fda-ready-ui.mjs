// scripts/verify-library-fda-ready-ui.mjs
// Gate 3 browser receipt for BUG-009 step 2 (2026-10-09): the FDA menu written to the
// 'ready' library instruments shows on the VeritaMap build page. Run against a LOCAL
// server on a scratch database (it registers an owner, provisions a lab and creates a
// map, so never point it at production). Usage:
//   PW_BASE=http://localhost:5148 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-library-fda-ready-ui.mjs
// Expected counts are read from client/src/lib/fdaInstrumentData.json and the write
// manifest (scripts/fda-menus/applied_ready_2026-10-09.json), never hard-coded.
// Checks: search offers each sample analyzer with its new test count; after adding the
// AU680, an FDA test added by the write is listed, Calprotectin carries FDA's HIGH, and
// the held duplicate ("Ammonia, plasma/serum" beside "Ammonia") is not listed.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5148", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const lib = JSON.parse(fs.readFileSync(new URL("../client/src/lib/fdaInstrumentData.json", import.meta.url), "utf8"));
const man = JSON.parse(fs.readFileSync(new URL("./fda-menus/applied_ready_2026-10-09.json", import.meta.url), "utf8"));
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `fdaready-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Library Owner", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Library Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Chemistry" }, token);
check("scratch map created", !!map.id, JSON.stringify(map).slice(0, 120));

const SAMPLES = [["AU640", "Beckman Coulter AU640"], ["DxC 500i", "Beckman Coulter DxC 500i"], ["cobas pure", "Roche cobas pure"], ["AU680", "Beckman Coulter AU680"]];
const au680Added = man.instruments["Beckman Coulter AU680"].adds.map((a) => a.analyte);
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
    await page.waitForTimeout(500);
    const result = page.locator("button", { hasText: key }).first();
    const text = (await result.isVisible().catch(() => false)) ? (await result.innerText()).replace(/\s+/g, " ") : "(no result)";
    const n = lib[key].testCount;
    check(`${mode}: searching "${q}" offers ${key} with ${n} tests`, new RegExp(`\\b${n} tests`).test(text), text);
  }
  if (mode === "light") {
    await search.fill("AU680");
    await page.waitForTimeout(500);
    await page.locator("button", { hasText: "Beckman Coulter AU680" }).first().click();
    await page.getByRole("button", { name: /^Add Instrument$/ }).click();
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: /Next: Select Tests/ }).click();
    await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText();
    check("after adding the AU680: a test added by the write is listed", au680Added.some((a) => body.includes(a)), `expected one of ${JSON.stringify(au680Added)}`);
    const calRow = page.locator("label, li, div", { hasText: /^Calprotectin/ }).filter({ hasText: /HIGH|MODERATE|WAIVED/ }).last();
    const calText = (await calRow.count()) ? (await calRow.innerText()).replace(/\s+/g, " ") : "(no row)";
    check("Calprotectin on the AU680 shows FDA's HIGH", /Calprotectin/.test(calText) && /HIGH/.test(calText) && !/MODERATE/.test(calText), calText.slice(0, 120));
    check("the held duplicate 'Ammonia, plasma/serum' is not listed (Ammonia is)", !body.includes("Ammonia, plasma/serum") && /\bAmmonia\b/.test(body));
    await page.screenshot({ path: `${OUT}/library_fda_ready_au680_${mode}.png`, fullPage: false });
  } else {
    await search.fill("AU640");
    await page.waitForTimeout(500);
    const box = search.locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
    await (await box.count() ? box : page).screenshot({ path: `${OUT}/library_fda_ready_search_${mode}.png` });
  }
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
