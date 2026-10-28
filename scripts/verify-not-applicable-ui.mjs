// scripts/verify-not-applicable-ui.mjs
// Browser receipt for BUG-115 (RFGH Brandy Morgan 2026-10-28, Michael Q50 = 1): on a competency's Employees tab, Not
// applicable takes one person off THIS competency (badge, Overview roster says Not applicable, New Assessment does not
// offer them) while they stay active; Applies again undoes it; the X now says it deactivates the person in every
// competency. Runs against a LOCAL production build on a scratch DB with made-up people. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-not-applicable-ui.mjs
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

const email = `na-ui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Not Applicable UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "NA UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "NA UI Lab", cliaNumber: "11D7654379", accreditationBody: "CLIA_ONLY", complexity: "high" }, owner.token);
await call("POST", `${L}/staff/employees`, { lastName: "Reyes", firstName: "Ana", highestComplexity: "M", performsTesting: true, hireDate: "2020-01-06" }, owner.token);
await call("POST", `${L}/staff/employees`, { lastName: "Tate", firstName: "Casey", highestComplexity: "M", performsTesting: true, hireDate: "2021-03-01" }, owner.token);
const P = (await call("POST", `${L}/competency/programs`, { name: "Gram Stain Competency", department: "Microbiology", type: "nontechnical", checklistItems: [{ description: "Perform 10 Gram Stains with Supervisor review in agreement" }] }, owner.token)).id;
const elig = (await call("GET", `${L}/competency/programs/${P}/eligible-employees`, undefined, owner.token)).employees || [];
const ana = elig.find((e) => /Ana/.test(e.name)), casey = elig.find((e) => /Casey/.test(e.name));
const sdb = new Database(process.env.SCRATCH_DB);
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const status = (id) => { const d = new Database(process.env.SCRATCH_DB, { readonly: true }); const r = d.prepare("SELECT status FROM competency_employees WHERE id = ?").get(id).status; d.close(); return r; };

const browser = await chromium.launch();
const login = async (pg) => {
  await pg.goto(`${BASE}/`);
  await pg.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
};
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await login(page);
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/${P}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Employees", exact: true }).click();
await page.locator(`[data-testid="na-mark-${ana.id}"]`).waitFor({ timeout: 20000 });

// 1. The X says what it does.
const xLabel = await page.locator(`[data-testid="deactivate-${ana.id}"]`).getAttribute("aria-label");
check("the X is labelled as deactivating in every competency", /every competency/.test(xLabel || ""), xLabel || "");
await page.locator(`[data-testid="deactivate-${ana.id}"]`).click();
const dlg = page.getByRole("alertdialog").or(page.getByRole("dialog"));
await dlg.first().waitFor({ timeout: 5000 });
const dlgText = (await dlg.first().innerText()).replace(/\s+/g, " ");
check("its confirmation says EVERY program and points to Not applicable", /EVERY competency program/.test(dlgText) && /use Not applicable instead/.test(dlgText), dlgText.slice(0, 200));
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "deactivate-everywhere-dialog.png"), fullPage: false });
await page.getByRole("button", { name: "Cancel" }).click();
check("cancelling leaves her active", status(ana.id) === "active");

// 2. Not applicable on this competency only.
await page.locator(`[data-testid="na-mark-${ana.id}"]`).click();
await page.locator('[role="alertdialog"], [role="dialog"]').getByRole("button", { name: "Mark not applicable" }).click();
await page.locator(`[data-testid="na-badge-${ana.id}"]`).waitFor({ timeout: 10000 });
check("Ana shows Not applicable and stays active", (await page.locator(`[data-testid="na-badge-${ana.id}"]`).count()) === 1 && status(ana.id) === "active", status(ana.id));
const countText = await page.locator('[data-testid="employees-count"]').innerText();
check("the count line says 1 not applicable", /2 active employee\(s\), 1 not applicable to this competency/.test(countText), countText);
await page.screenshot({ path: path.join(OUT, "employees-not-applicable.png"), fullPage: false });

// 3. Overview roster and the Employees stat.
await page.getByRole("button", { name: "Overview", exact: true }).click();
await page.getByText("Employee Roster").waitFor({ timeout: 10000 });
const roster = (await page.getByText("Employee Roster").locator("..").innerText()).replace(/\s+/g, " ");
check("the Overview roster says Not applicable for Ana and Not assessed for Casey", /Ana Reyes.*Not applicable/.test(roster) && /Casey Tate.*Not assessed/.test(roster), roster.slice(0, 200));
await page.getByText("Employee Roster").scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(OUT, "overview-roster-not-applicable.png"), fullPage: false });

// 4. New Assessment does not offer her.
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/${P}?newAssessment=1`, { waitUntil: "networkidle" });
await page.locator('[data-testid="assessment-employee-select"]').click();
await page.locator('[role="listbox"]').waitFor({ timeout: 10000 });
const opts = (await page.locator('[role="option"]').allInnerTexts()).join(" | ");
check("New Assessment offers Casey, not Ana", /Casey/.test(opts) && !/Ana/.test(opts), opts);
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, "new-assessment-picker.png"), fullPage: false });
await page.keyboard.press("Escape");

// 5. Applies again.
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/${P}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Employees", exact: true }).click();
await page.locator(`[data-testid="na-clear-${ana.id}"]`).click();
await page.locator(`[data-testid="na-mark-${ana.id}"]`).waitFor({ timeout: 10000 });
check("Applies again puts her back", (await page.locator(`[data-testid="na-badge-${ana.id}"]`).count()) === 0);

// 6. Dark mode: the Employees tab with Casey marked Not applicable.
await call("POST", `${L}/competency/programs/${P}/not-applicable`, { employeeId: casey.id }, owner.token);
const dark = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: "dark" });
await login(dark);
await dark.goto(`${BASE}/labs/${labId}/veritacomp-app/${P}`, { waitUntil: "networkidle" });
await dark.getByRole("button", { name: "Employees", exact: true }).click();
await dark.locator(`[data-testid="na-badge-${casey.id}"]`).waitFor({ timeout: 15000 });
check("dark mode renders the Not applicable badge and buttons", await dark.evaluate(() => document.documentElement.classList.contains("dark")), "html.dark");
await dark.screenshot({ path: path.join(OUT, "employees-not-applicable-dark.png"), fullPage: false });
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
