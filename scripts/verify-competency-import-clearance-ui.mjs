// scripts/verify-competency-import-clearance-ui.mjs
// Gate 3 step 8 browser receipt for Michael Q12 = 1 (2026-10-27): VeritaComp > Bulk Import previews what the
// import will do to each person's patient-testing clearance, and after the import the VeritaStaff roster shows
// staff moved over with passed competencies as cleared instead of "Not cleared". Runs against a LOCAL server on a
// scratch database with made-up people (it sets onboarding flags directly in SCRATCH_DB; never point it at
// production). Usage:
//   PW_BASE=http://localhost:5099 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-competency-import-clearance-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE || "http://localhost:5099", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const stamp = Date.now();

const email = `cimpui-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Import UI Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Import UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
{ const pre = new Database(process.env.SCRATCH_DB); pre.prepare("UPDATE labs SET accreditation_tjc = 1 WHERE id = ?").run(labId); pre.close(); } // the lab is TJC-accredited
const staffLab = await call("POST", `${L}/staff/lab`, { labName: "Import UI Lab", cliaNumber: "11D7000003", accreditationBody: "TJC", complexity: "high" }, owner.token);
if (!staffLab.id && !staffLab.lab_name) console.log("staff lab setup:", JSON.stringify(staffLab).slice(0, 200));
for (const [first, hire] of [["Ava", "2010-03-01"], ["Ben", "2026-10-01"], ["Eve", "2026-04-01"]]) {
  await call("POST", `${L}/staff/employees`, { lastName: "Mover", firstName: first, highestComplexity: "high", performsTesting: true, hireDate: hire }, owner.token);
}
await call("POST", `${L}/competency/programs`, { name: "Chemistry Analyzers", type: "technical" }, owner.token);
const sdb = new Database(process.env.SCRATCH_DB);
const ownerId = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(ownerId);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();

// The history file a lab moving over would load: Ava has years of annuals, Eve is in her first year, Ben has orientation only.
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Assessments");
ws.addRow(["Employee Name", "Program Name", "Assessment Type", "Assessment Date", "Status", "Evaluator Name"]);
for (const r of [
  ["Ava Mover", "Chemistry Analyzers", "annual", "2025-03-14", "pass", "R. Supervisor"],
  ["Ava Mover", "Chemistry Analyzers", "annual", "2026-03-15", "pass", "R. Supervisor"],
  ["Eve Mover", "Chemistry Analyzers", "initial", "2026-05-01", "pass", "R. Supervisor"],
  ["Ben Mover", "Chemistry Analyzers", "orientation", "2026-10-05", "pass", "J. Trainer"],
]) ws.addRow(r);
const xlsx = path.join(OUT, "competency_history_import.xlsx");
await wb.xlsx.writeFile(xlsx);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
// One active session per account: a second /login would conflict with the session registration opened, so the
// browser uses that session.
await page.goto(`${BASE}/`);
await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);

const cards = async () => {
  try { await page.locator('[data-testid="staff-employee-card"]').first().waitFor({ timeout: 20000 }); }
  catch (e) {
    await page.screenshot({ path: path.join(OUT, "competency-import-roster-missing.png") });
    console.log("roster did not render at", page.url(), "::", (await page.locator("body").innerText()).slice(0, 600).replace(/\n/g, " | "));
    throw e;
  }
};
const badge = async (first) => (await page.locator('[data-testid="staff-employee-card"]', { hasText: `Mover, ${first}` }).first().innerText()).match(/Not cleared|Current|Due Soon|Overdue|Not set/)?.[0] ?? "?";
await page.goto(`${BASE}/labs/${labId}/veritastaff-app`, { waitUntil: "networkidle" });
await cards();
const before = { ava: await badge("Ava"), ben: await badge("Ben"), eve: await badge("Eve") };
check("before the import: all three read Not cleared on the VeritaStaff roster", before.ava === "Not cleared" && before.ben === "Not cleared" && before.eve === "Not cleared", JSON.stringify(before));

for (const mode of ["light", "dark"]) {
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByRole("button", { name: "Bulk Import" }).click();
  await page.locator('[role="dialog"] input[type="file"]').setInputFiles(xlsx);
  await page.getByRole("button", { name: "Preview" }).click();
  const panel = page.getByTestId("bulk-import-clearance");
  await panel.waitFor({ timeout: 20000 });
  const text = await panel.innerText();
  check(`${mode}: preview panel says 2 people will count as cleared and 1 has no passed competency`,
    /2 people will count as cleared for patient testing/.test(text) && /1 person has no passed competency/.test(text), text.replace(/\n/g, " | "));
  await page.locator('[role="dialog"]').screenshot({ path: path.join(OUT, `competency-import-clearance-${mode}.png`) });
  if (mode === "light") { await page.keyboard.press("Escape"); continue; }
  await page.getByRole("button", { name: /^Import \d+ row/ }).click();
  const toast = await page.getByText(/now count as cleared for patient testing/).first().innerText({ timeout: 20000 }).catch(() => "");
  check("import: the confirmation says 2 people now count as cleared", /2 people now count as cleared/.test(toast), toast);
}

await page.goto(`${BASE}/labs/${labId}/veritastaff-app`, { waitUntil: "networkidle" });
await page.evaluate(() => document.documentElement.classList.remove("dark"));
await cards();
const after = { ava: await badge("Ava"), ben: await badge("Ben"), eve: await badge("Eve") };
check("after the import: Ava Current, Eve Due Soon (6-month 2026-11-01), Ben still Not cleared", after.ava === "Current" && after.eve === "Due Soon" && after.ben === "Not cleared", JSON.stringify(after));
await page.locator('[data-testid="staff-employee-card"]').last().scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(OUT, "competency-import-roster-after.png"), fullPage: true });

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
