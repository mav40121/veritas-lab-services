// scripts/verify-staff-roster-mobile.mjs
// Gate 3 browser receipt for BUG-030 (roster cards ran past a phone screen on production Riverside: long titles and
// role badges in one row that could not wrap) and BUG-031 (a waived tester read "Moderate complexity"). Builds a roster
// shaped like Riverside's (a long title with TS and TC badges, a waived tester) on a LOCAL server and checks it at
// 390 px and on the detail page. Never point it at production. Usage:
//   PW_BASE=http://localhost:5159 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-staff-roster-mobile.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5159", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return await r.json(); } catch { return {}; } };
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `roster-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Roster Owner", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Roster Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Roster Lab", cliaNumber: "11D7654331", accreditationBody: "CLIA_ONLY", complexity: "high" }, token);
const mk = (b) => call("POST", `${L}/staff/employees`, { performsTesting: true, ...b }, token);
await mk({ lastName: "Veri", firstName: "Michael", middleInitial: "A", title: "Laboratory Director / Technical Consultant", highestComplexity: "H", hireDate: "2024-01-15", roles: [{ role: "LD" }, { role: "TC", allSpecialties: true }] });
await mk({ lastName: "Ellis", firstName: "Jordan", title: "MLS(ASCP), Technical Supervisor", highestComplexity: "H", hireDate: "2015-08-03", roles: [{ role: "TS", allSpecialties: true }, { role: "TC", allSpecialties: true }] });
const lisa = (await mk({ lastName: "Thompson", firstName: "Lisa", middleInitial: "R", title: "Laboratory Assistant", highestComplexity: "W", hireDate: "2023-05-01" })).id;
await mk({ lastName: "Williams", firstName: "Sarah", middleInitial: "M", title: "Medical Laboratory Technician", highestComplexity: "M", hireDate: "2022-01-10" });
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
check("fixture: 4 staff incl. long titles with role badges and a waived tester", !!lisa);

const browser = await chromium.launch();
const open = async (path, width, dark = false) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([tk, u, lab]) => { localStorage.setItem("veritas_token", tk); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(lab)); localStorage.setItem("theme", "light"); }, [token, me, labId]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  return page;
};
let page = await open(`/labs/${labId}/veritastaff-app`, 390);
await page.getByTestId("staff-employee-card").first().waitFor({ timeout: 30000 });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const wide = await page.evaluate(() => Array.from(document.querySelectorAll("[data-testid='staff-employee-card']")).filter((c) => c.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length);
await page.getByTestId("staff-employee-card").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/roster_390_light.png` });
check("phone width (390): no horizontal scroll and no card past the screen edge (BUG-030)", overflow <= 1 && wide === 0, `overflow ${overflow}px, cards past edge ${wide}`);
await page.close();

page = await open(`/labs/${labId}/veritastaff-app`, 390, true);
await page.getByTestId("staff-employee-card").first().waitFor({ timeout: 30000 });
await page.getByTestId("staff-employee-card").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/roster_390_dark.png` });
await page.close();

page = await open(`/labs/${labId}/veritastaff-app`, 1300);
const lcard = page.getByTestId("staff-employee-card").filter({ hasText: "Thompson" }).first();
await lcard.waitFor({ timeout: 30000 });
const ltext = (await lcard.innerText()).replace(/\s+/g, " ");
const wcard = (await page.getByTestId("staff-employee-card").filter({ hasText: "Williams" }).first().innerText()).replace(/\s+/g, " ");
check("roster card: waived tester reads 'Waived complexity'; moderate stays 'Moderate complexity' (BUG-031)", /Waived complexity/.test(ltext) && /Moderate complexity/.test(wcard), `${ltext.slice(0, 90)} | ${wcard.slice(0, 90)}`);
await lcard.scrollIntoViewIfNeeded();
const lb = await lcard.boundingBox();
await page.screenshot({ path: `${OUT}/roster_card_waived.png`, clip: { x: 0, y: Math.max(0, (lb?.y ?? 0) - 10), width: 1300, height: (lb?.height ?? 80) + 20 } });
await lcard.click();
await page.waitForTimeout(1500);
const detail = ((await page.locator("body").innerText()).match(/Complexity\s*\n?\s*\w+/) || [""])[0].replace(/\s+/g, " ");
check("detail page: Complexity 'Waived' (BUG-031)", detail === "Complexity Waived", detail);
await page.close();
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
