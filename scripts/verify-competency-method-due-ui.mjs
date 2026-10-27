// scripts/verify-competency-method-due-ui.mjs
// Browser receipt for BUG-069 (Michael Q34 = 1, 2026-10-27): the VeritaStaff roster status follows each method's own
// sign-offs. A person whose method 6-month is signed shows as current although the VeritaStaff record (filled from
// the initial) still lists the 6-month as overdue; a person with no method sign-offs shows Overdue from the record as
// before. Runs against a LOCAL production build on a scratch DB with made-up people. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-competency-method-due-ui.mjs
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
const iso = (d) => d.toISOString().slice(0, 10);
const months = (n) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };

const email = `cmdue-ui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Method Due UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Method Due UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Method Due UI Lab", cliaNumber: "11D7654398", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token)).id;
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
  { name: "Mini i-Sed", category: "Hematology", tests: [{ analyte: "Sed Rate", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
] });
const mira = (await call("POST", `${L}/staff/employees`, { lastName: "Method", firstName: "Mira", highestComplexity: "M", performsTesting: true, hireDate: months(-9) }, owner.token)).id;
const ollie = (await call("POST", `${L}/staff/employees`, { lastName: "Record", firstName: "Ollie", highestComplexity: "M", performsTesting: true, hireDate: months(-9) }, owner.token)).id;
for (const id of [mira, ollie]) await call("PUT", `${L}/staff/competency/${id}`, { initialCompletedAt: months(-8), initialSignedBy: "Casey Tate" }, owner.token);
const sdb = new Database(process.env.SCRATCH_DB);
const sed = sdb.prepare("SELECT id FROM veritamap_instruments WHERE map_id = ? AND instrument_name = 'Mini i-Sed'").get(mapId).id;
const now = new Date().toISOString();
for (const id of [mira, ollie]) sdb.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(id, sed, now);
const sign = sdb.prepare(`INSERT INTO competency_method_signoffs (lab_id, staff_employee_id, instrument_id, milestone, signed_date, signer_name, signer_role, complexity, determination, created_at)
  VALUES (?, ?, ?, ?, ?, 'Casey Tate', 'TC', 'MODERATE', 'pass', ?)`);
sign.run(labId, mira, sed, "initial", months(-8), now);
sign.run(labId, mira, sed, "six_month", months(-1), now);
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
const recordSix = sdb.prepare("SELECT six_month_due_at FROM staff_competency_schedules WHERE employee_id = ?").get(mira)?.six_month_due_at;
sdb.close();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
await page.goto(`${BASE}/`);
await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
await page.goto(`${BASE}/labs/${labId}/veritastaff-app`, { waitUntil: "networkidle" });
const cards = page.locator('[data-testid="staff-employee-card"]');
await cards.first().waitFor({ timeout: 20000 });
const texts = await cards.allInnerTexts();
const miraCard = texts.find((t) => /Mira/.test(t)) || "", ollieCard = texts.find((t) => /Ollie/.test(t)) || "";
check("roster: Mira (method 6-month signed) is not shown Overdue, although her VeritaStaff record lists the 6-month due " + recordSix,
  !!miraCard && !/Overdue/.test(miraCard), miraCard.replace(/\s+/g, " ").slice(0, 160));
check("roster: Ollie (no method sign-offs) is shown Overdue from the record, as before", /Overdue/.test(ollieCard), ollieCard.replace(/\s+/g, " ").slice(0, 160));
await page.screenshot({ path: path.join(OUT, "method-due-roster.png"), fullPage: false });
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
