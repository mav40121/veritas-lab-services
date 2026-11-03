// scripts/verify-legacy-redirect-query-ui.mjs
//
// Receipt for LegacyWorkspaceRedirect keeping the query string and hash (found 2026-11-03 building the heparin range
// study): an un-prefixed link such as the verification workbook's Run button (/veritacheck?studyType=...&verificationId=)
// or VeritaMap's correlation link was redirected to /labs/:id/veritacheck with its settings dropped, because wouter's
// location is the path only. On a local production build with a scratch DB and a made-up lab:
//   R1. a direct link /veritacheck?studyType=precision&analyte=Glucose lands on /labs/:id/veritacheck with the query,
//       Precision picked and Glucose as the test name
//   R2. an in-app navigation (pushState, the way wouter's navigate moves) to /veritacheck?studyType=lot_to_lot&... keeps it
//   R3. a link with no query still lands on /labs/:id/veritacheck, with no stray "?"
//   R4. a module with an app path (/veritascan?tab=x -> /labs/:id/veritascan-app?tab=x) keeps the query too
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-legacy-redirect-query-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return j; };

const email = `redirect-${Date.now()}@example.com`;
const T = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Redirect Owner", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Redirect Lab", plan: "hospital" })).labId;
{ const db = new Database(process.env.SCRATCH_DB); db.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email); db.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId); db.close(); }

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto(`${BASE}/`);
const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, T]);
await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [T, me, labId]);
const path = () => page.evaluate(() => window.location.pathname + window.location.search + window.location.hash);

await page.goto(`${BASE}/veritacheck?studyType=precision&analyte=Glucose`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
const p1 = await path();
const body1 = await page.locator("body").innerText();
check("R1. direct link keeps the query: Precision picked, Glucose as the test name", p1 === `/labs/${labId}/veritacheck?studyType=precision&analyte=Glucose`
  && /Precision Verification \(CLSI EP15-A3\)/.test(body1) && (await page.getByTestId("input-test-name").inputValue().catch(() => "")) === "Glucose", p1);
// Receipt: the landing page with the URL stamped on it (the address bar is not in a Playwright screenshot).
const stamp = (u) => page.evaluate((u) => { const d = document.createElement("div"); d.id = "url-stamp"; d.textContent = `URL: ${u}`; d.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#FFF4D6;color:#6A4B00;font:12px monospace;padding:4px 8px;border-bottom:1px solid #E8C96A"; document.body.appendChild(d); }, u);
await stamp(p1); await page.screenshot({ path: `${OUT}/redirect_direct_link.png` });

await page.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
await page.evaluate(() => { window.history.pushState({}, "", "/veritacheck?studyType=lot_to_lot&analyte=Fibrinogen&verificationId=7&element=accuracy#data"); window.dispatchEvent(new PopStateEvent("popstate")); });
await page.waitForTimeout(1500);
const p2 = await path();
check("R2. in-app navigation keeps the query and hash (the workbook Run button's shape)", p2 === `/labs/${labId}/veritacheck?studyType=lot_to_lot&analyte=Fibrinogen&verificationId=7&element=accuracy#data`
  && /Reagent Lot Verification \(CLSI EP26\)/.test(await page.locator("body").innerText()), p2);
await stamp(p2); await page.screenshot({ path: `${OUT}/redirect_in_app_navigation.png` });

await page.goto(`${BASE}/veritacheck`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
const p3 = await path();
check("R3. no query: lands on /labs/:id/veritacheck with no stray '?'", p3 === `/labs/${labId}/veritacheck`, p3);

await page.goto(`${BASE}/veritascan?tab=documents`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
const p4 = await path();
check("R4. a module with an app path keeps the query (/veritascan -> /veritascan-app)", p4 === `/labs/${labId}/veritascan-app?tab=documents`, p4);

await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
