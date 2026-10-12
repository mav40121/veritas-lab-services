// scripts/verify-bug041-module-switch-keeps-lab.mjs
//
// Gate 3 step 8 receipt for BUG-041 (2026-10-12, Michael: "I just went to switch modules inside of veritaassure,
// and it changed my lab as well"). LOCAL server + scratch DB only. A user owns two labs; the first in their list is
// the primary. They open the OTHER lab's VeritaComp by its URL (the switcher never makes it primary, the same state a
// Veritas-support or org-access lab is always in), then choose VeritaMap from the VeritaAssure menu.
//   PASS: the page lands on /labs/<other>/veritamap-app and the lab picker still names the other lab.
//   Old code: it lands on /labs/<primary>/veritamap-app.
// Run: PW_BASE=http://localhost:5164 SCRATCH_DB=<db> OUT=<dir> TAG=after node scripts/verify-bug041-module-switch-keeps-lab.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT, TAG = process.env.TAG || "after";
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return await r.json(); } catch { return {}; } };
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `b41-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Two Lab Owner", hipaa_acknowledged: true });
const labA = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Alpha Primary Lab", plan: "hospital" })).labId;
const labB = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Bravo Second Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id IN (?, ?)").run(labA, labB);
sdb.close();
const mem = await call("GET", "/api/labs/me", undefined, owner.token);
const list = Array.isArray(mem) ? mem : mem.labs || [];
const primary = list[0]?.labId, other = list.find((m) => m.labId !== primary)?.labId;
const otherName = list.find((m) => m.labId === other)?.labName;
check(`fixture [${TAG}]: two labs, primary first`, list.length === 2 && !!primary && !!other, JSON.stringify(list.map((m) => [m.labId, m.labName, m.isPrimaryLab])));

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto(`${BASE}/`);
const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, owner.token]);
await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); }, [owner.token, me]);

// Open the NON-primary lab by its URL (no switcher).
await page.goto(`${BASE}/labs/${other}/veritacomp-app`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
check(`1. [${TAG}] start in the second lab's VeritaComp`, page.url().includes(`/labs/${other}/veritacomp-app`), page.url().replace(BASE, ""));
// At 1400px the module menu is in the drawer: open it, expand VeritaAssure, choose VeritaMap.
await page.locator("header button:visible, nav button:visible").last().click(); await page.waitForTimeout(500);
await page.locator("button:visible", { hasText: "VeritaAssure" }).first().click(); await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/b41_${TAG}_menu.png` });
await page.locator("a:visible", { hasText: /^VeritaMap/ }).first().click();
await page.waitForTimeout(2500);
const url = page.url().replace(BASE, "");
const picker = await page.locator("header button:visible, nav button:visible").filter({ hasText: /Lab/ }).first().innerText().catch(() => "");
check(`2. [${TAG}] VeritaMap opens in the SAME lab (/labs/${other}), not the primary (/labs/${primary})`, url.startsWith(`/labs/${other}/veritamap-app`), url);
check(`3. [${TAG}] the lab picker still names the second lab`, picker.includes(otherName?.slice(0, 12) || "~"), `picker: ${picker.replace(/\s+/g, " ")}`);
await page.screenshot({ path: `${OUT}/b41_${TAG}_after.png` });

// Michael's second report: from the second lab's dashboard, VeritaAssure > All Modules Overview (/veritaassure, a
// page with no lab in its URL) showed the PRIMARY lab in the picker. It must keep the lab he was in.
await page.goto(`${BASE}/labs/${other}/dashboard`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
await page.locator("header button:visible, nav button:visible").last().click(); await page.waitForTimeout(500);
await page.locator("button:visible", { hasText: "VeritaAssure" }).first().click(); await page.waitForTimeout(400);
await page.locator("a:visible", { hasText: /^All Modules Overview/ }).first().click(); await page.waitForTimeout(2000);
const url3 = page.url().replace(BASE, "");
const picker3 = await page.locator("header button:visible, nav button:visible").filter({ hasText: /Lab/ }).first().innerText().catch(() => "");
check(`5. [${TAG}] All Modules Overview keeps the second lab in the picker`, url3.startsWith("/veritaassure") && picker3.includes(otherName?.slice(0, 12) || "~"), `${url3} | picker: ${picker3.replace(/\s+/g, " ")}`);
await page.screenshot({ path: `${OUT}/b41_${TAG}_overview.png` });

// A user who has not been in any lab yet still goes to the primary (fallback unchanged).
await page.evaluate(() => localStorage.removeItem("veritas_active_lab_id"));
await page.goto(`${BASE}/veritamap`, { waitUntil: "networkidle" }); await page.waitForTimeout(2000);
const url2 = page.url().replace(BASE, "");
check(`4. [${TAG}] with no remembered lab an un-prefixed module link still opens the primary lab`, url2.startsWith(`/labs/${primary}/veritamap-app`), url2);
await browser.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
