// scripts/verify-assign-by-instrument-ui.mjs
// Browser receipt for BUG-119 (RFGH Brandy Morgan, 2026-10-29; Michael Q71 = 1): in VeritaStaff > Assign by Instrument,
// ticking a person far down the staff list must not throw the list back to the top, and the instrument filter box must
// keep focus while you type. Made-up lab, analyzers and 40 made-up staff on a scratch DB only. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-assign-by-instrument-ui.mjs
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

const email = `assign-ui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Assign UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Assign UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Assign UI Lab", cliaNumber: "11D7654380", accreditationBody: "CLIA_ONLY", complexity: "high" }, owner.token);
const FIRST = ["Ana", "Ben", "Cara", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jo"];
const LAST = ["Abbott", "Baker", "Chen", "Diaz"];
for (const ln of LAST) for (const fn of FIRST) {
  await call("POST", `${L}/staff/employees`, { lastName: ln, firstName: fn, highestComplexity: "M", performsTesting: true, hireDate: "2021-01-04" }, owner.token);
}
const map = await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token);
for (const n of ["Sysmex XN-1000", "Sysmex XN-450"]) await call("POST", `${L}/veritamap/maps/${map.id}/instruments`, { instrument_name: n, role: "Primary", category: "Hematology", serial_number: `SN-${n.slice(-4)}` }, owner.token);
const sdb = new Database(process.env.SCRATCH_DB);
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
const staffCount = sdb.prepare("SELECT COUNT(*) n FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active'").get(labId).n;
sdb.close();
check("setup: 40 made-up staff and two analyzers on a scratch lab", staffCount >= 40 && !!map.id, `staff ${staffCount}, map ${map.id}`);

const browser = await chromium.launch();
const run = async (scheme) => {
  const page = await browser.newPage({ viewport: { width: 1300, height: 820 }, colorScheme: scheme });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
  await page.goto(`${BASE}/labs/${labId}/veritastaff-app`, { waitUntil: "networkidle" });
  await page.getByTestId("button-assign-by-instrument").click();
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ timeout: 10000 });
  return { page, dlg };
};

// 1. The filter box keeps focus while typing.
const { page, dlg } = await run("light");
const filter = page.getByTestId("instrument-assign-filter");
await filter.click();
await page.keyboard.type("XN-1000", { delay: 60 });
const typed = await filter.inputValue();
const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
check("typing 'XN-1000' into the filter keeps every letter", typed === "XN-1000", JSON.stringify(typed));
check("the filter box still has focus after typing", focused === "instrument-assign-filter", String(focused));

// 2. Pick the analyzer, scroll to the bottom of the staff list, tick someone near the bottom.
await page.locator('[data-testid^="instrument-pick-"]').first().click();
await page.getByText(/Who runs/i).waitFor({ timeout: 10000 });
const box = dlg.locator("div.overflow-y-auto").filter({ has: page.locator('[data-testid^="instrument-assign-staff-"]') }).last();
const scrollable = await box.evaluate((el) => el.scrollHeight > el.clientHeight + 20);
check("the staff list is long enough to scroll", scrollable);
await box.evaluate((el) => { el.scrollTop = el.scrollHeight; });
await page.waitForTimeout(250);
const before = await box.evaluate((el) => el.scrollTop);
const boxes = box.locator('[data-testid^="instrument-assign-staff-"]');
const n = await boxes.count();
await boxes.nth(n - 2).click();
await page.waitForTimeout(400);
const after1 = await box.evaluate((el) => el.scrollTop);
await boxes.nth(n - 1).click();
await page.waitForTimeout(400);
const after2 = await box.evaluate((el) => el.scrollTop);
check("ticking a person near the bottom leaves the list where it was", before > 50 && Math.abs(after1 - before) < 5 && Math.abs(after2 - before) < 5, `scrollTop before ${before}, after 1st click ${after1}, after 2nd ${after2}`);
const selectedText = await dlg.getByText(/selected$/).innerText();
check("both ticks registered", /^2 selected/.test(selectedText.trim()), selectedText);
await page.screenshot({ path: path.join(OUT, "assign-scroll-kept.png"), fullPage: false });

// 3. Save still works.
await page.getByTestId("instrument-assign-save").click();
await page.getByText("Assignment saved").first().waitFor({ timeout: 10000 }).catch(() => {});
const sdb2 = new Database(process.env.SCRATCH_DB, { readonly: true });
const joined = sdb2.prepare(`SELECT COUNT(*) n FROM staff_employee_instruments sei JOIN staff_employees se ON se.id = sei.employee_id WHERE se.tier2_lab_id = ?`).get(labId).n;
sdb2.close();
check("Save assigns the two people", joined === 2, `rows ${joined}`);
await page.close();

// 4. Dark mode.
const dark = await run("dark");
check("dark mode: the dialog renders on a dark page", await dark.page.evaluate(() => document.documentElement.classList.contains("dark")) && (await dark.dlg.count()) === 1);
await dark.page.screenshot({ path: path.join(OUT, "assign-dark.png"), fullPage: false });
await dark.page.close();

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
