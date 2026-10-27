// scripts/verify-competency-observer-ui.mjs
// Browser receipt for BUG-075 (Michael Q35 = 1, 2026-10-27): on the person page the Element 1 and Element 4 observer is
// a pick list of the lab's LD/TC/TS people in VeritaStaff (people who have left listed last), with no free-text entry
// and no General Supervisor; picking a TC saves; an observer saved before the check stays and is shown as "saved
// earlier". Runs against a LOCAL production build on a scratch DB with made-up people. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-competency-observer-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `observer-ui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Observer UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Observer UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Observer UI Lab", cliaNumber: "11D7654376", accreditationBody: "CLIA_ONLY", complexity: "high" }, owner.token);
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token)).id;
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
  { name: "Mini i-Sed", category: "Hematology", tests: [{ analyte: "Sed Rate", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
] });
const mk = async (body) => (await call("POST", `${L}/staff/employees`, body, owner.token)).id;
const tech = await mk({ lastName: "Reyes", firstName: "Ana", highestComplexity: "M", performsTesting: true, hireDate: "2020-01-06" });
await mk({ lastName: "Tate", firstName: "Casey", highestComplexity: "H", roles: [{ role: "TC", specialtyNumber: 8 }] });
await mk({ lastName: "Ellis", firstName: "Jordan", highestComplexity: "H", roles: [{ role: "GS" }] });
await mk({ lastName: "Chen", firstName: "Morgan", middleInitial: "Q", highestComplexity: "H", roles: [{ role: "LD" }] });
const former = await mk({ lastName: "Brooks", firstName: "Taylor", highestComplexity: "H", roles: [{ role: "TS", specialtyNumber: 8 }] });
const sdb = new Database(process.env.SCRATCH_DB);
const sed = sdb.prepare("SELECT id FROM veritamap_instruments WHERE map_id = ? AND instrument_name = 'Mini i-Sed'").get(mapId).id;
const now = new Date().toISOString();
sdb.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(tech, sed, now);
sdb.prepare("UPDATE staff_employees SET status = 'terminated', terminated_at = ? WHERE id = ?").run(now, former);
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
await page.goto(`${BASE}/`);
await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/employee/${tech}`, { waitUntil: "networkidle" });

// 1. Element 1 observer is a pick list (combobox), not a text box.
const el1 = page.locator('[data-testid="element-1-observerInitials"]');
await el1.waitFor({ timeout: 20000 });
check("Element 1 observer is a pick list", (await el1.getAttribute("role")) === "combobox", `role=${await el1.getAttribute("role")}`);
await el1.click();
await page.locator('[role="listbox"]').waitFor({ timeout: 5000 });
await page.waitForTimeout(400); // let the list finish its open animation before the screenshot
const options = await page.locator('[role="option"]').allInnerTexts();
await page.screenshot({ path: path.join(OUT, "observer-picklist.png"), fullPage: false });
const joined = options.join(" | ");
check("list holds the LD, the TC and the TS who left (marked)", /MQC : Chen, Morgan Q\. \(LD\)/.test(joined) && /CT : Tate, Casey \(TC\)/.test(joined) && /TB : Brooks, Taylor \(TS\), left the lab/.test(joined), joined);
check("no General Supervisor and no typed-entry option", !/Ellis/.test(joined) && !/Type initials/i.test(joined), joined);
await page.getByRole("option", { name: /CT : Tate, Casey/ }).click();

// 2. Element 4: pick the LD, save, and the server stores the picks.
await page.locator('[data-testid="element-4-observerInitials"]').click();
await page.getByRole("option", { name: /MQC : Chen, Morgan Q\./ }).click();
await page.locator('[data-testid="save-test-system"]').click();
await page.waitForTimeout(1500);
const view = await call("GET", `${L}/competency/employee/${tech}`, undefined, owner.token);
const ts = (view.testSystems || []).find((t) => t.instrumentId === sed) || {};
const el = (n) => (ts.elements || []).find((e) => e.num === n) || {};
check("save stores the picked observers", el(1).observerInitials === "CT" && el(4).observerInitials === "MQC", `el1=${el(1).observerInitials} el4=${el(4).observerInitials}`);

// 3. An observer saved before the check (made-up "ZZ") stays and is shown as saved earlier.
const db2 = new Database(process.env.SCRATCH_DB);
db2.prepare("UPDATE competency_assessment_items SET el1_observer_initials = 'ZZ' WHERE instrument_id = ? AND element_number = 1 AND signoff_id IS NULL").run(sed);
db2.close();
await page.reload({ waitUntil: "networkidle" });
const note = page.locator('[data-testid="element-1-observerInitials-saved-note"]');
await note.waitFor({ timeout: 15000 }).catch(() => {});
check("an earlier unmatched observer is kept and labelled", (await note.count()) === 1 && /saved earlier/i.test(await el1.innerText()), (await el1.innerText()).replace(/\s+/g, " "));
await el1.scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(OUT, "observer-saved-earlier.png"), fullPage: false });
// Dark mode: the same page with the browser set to dark (the app follows prefers-color-scheme).
const dark = await browser.newPage({ viewport: { width: 1400, height: 1100 }, colorScheme: "dark" });
await dark.goto(`${BASE}/`);
await dark.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
await dark.goto(`${BASE}/labs/${labId}/veritacomp-app/employee/${tech}`, { waitUntil: "networkidle" });
await dark.locator('[data-testid="element-1-observerInitials-saved-note"]').waitFor({ timeout: 15000 });
check("dark mode renders the pick list and the saved-earlier note", await dark.evaluate(() => document.documentElement.classList.contains("dark")), "html.dark");
await dark.screenshot({ path: path.join(OUT, "observer-saved-earlier-dark.png"), fullPage: false });
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
