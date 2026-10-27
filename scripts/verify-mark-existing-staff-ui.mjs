// scripts/verify-mark-existing-staff-ui.mjs
// Gate 3 step 8 browser receipt for Michael Q19 = 1 (2026-10-27): VeritaStaff shows "Mark existing staff (N)" while
// testing staff have no marking; the dialog lists them with nothing pre-selected; Select all + save marks them, their
// badges stop reading "Not cleared", and the button goes away. Runs against a LOCAL server on a scratch database with
// made-up people. Usage:
//   PW_BASE=http://localhost:5099 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-mark-existing-staff-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5099", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `mexui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Mark Existing UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Moved Over Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Moved Over Lab", cliaNumber: "11D7654391", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
for (const [last, first, hire] of [["Avery", "Jo", "2011-04-01"], ["Brooks", "Lee", "2016-09-12"], ["Cruz", "Sam", "2019-02-25"]]) {
  await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, title: "MLT(ASCP)", highestComplexity: "M", performsTesting: true, hireDate: hire }, owner.token);
}
const sdb = new Database(process.env.SCRATCH_DB);
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
await page.goto(`${BASE}/`);
await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
await page.goto(`${BASE}/labs/${labId}/veritastaff-app`, { waitUntil: "networkidle" });
const btn = page.getByTestId("button-mark-existing");
await btn.waitFor({ timeout: 20000 });
const cards = page.locator('[data-testid="staff-employee-card"]');
const badgesBefore = await cards.allInnerTexts();
check("before: the button reads 'Mark existing staff (3)' and all three read Not cleared",
  /Mark existing staff \(3\)/.test(await btn.innerText()) && badgesBefore.filter((t) => /Not cleared/.test(t)).length === 3, await btn.innerText());
await btn.click();
const dlg = page.getByTestId("mark-existing-dialog");
await dlg.waitFor();
const saveBtn = page.getByTestId("mark-existing-save");
check("dialog: three people listed, nothing pre-selected (save disabled)", (await dlg.locator('[data-testid^="mark-existing-row-"]').count()) === 3 && await saveBtn.isDisabled());
await page.getByTestId("mark-existing-all").click();
await dlg.screenshot({ path: path.join(OUT, "mark-existing-dialog.png") });
check("Select all enables 'Mark 3 as existing staff'", /Mark 3 as existing staff/.test(await saveBtn.innerText()) && !(await saveBtn.isDisabled()));
await saveBtn.click();
await page.getByText(/3 people marked existing staff/).first().waitFor({ timeout: 15000 });
await page.waitForTimeout(1500);
const badgesAfter = await cards.allInnerTexts();
check("after: no one reads Not cleared, and the button is gone",
  badgesAfter.filter((t) => /Not cleared/.test(t)).length === 0 && (await page.getByTestId("button-mark-existing").count()) === 0, JSON.stringify(badgesAfter.map((t) => t.replace(/\s+/g, " ").slice(0, 60))));
await page.screenshot({ path: path.join(OUT, "mark-existing-after.png"), fullPage: true });
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
