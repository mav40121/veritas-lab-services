// scripts/verify-inventory-switch-ui.mjs
// Browser receipt for BUG-078 (Michael Q46 = 1, 2026-10-27): on the Staff Portal ("My sign-offs"), Count Inventory
// follows the VeritaStaff "Can adjust inventory" switch. Off: the tile is disabled and says who can turn it on. On: the
// tile opens VeritaStock. Runs against a LOCAL production build on a scratch DB with made-up people. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-inventory-switch-ui.mjs
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

const stamp = Date.now();
const owner = await call("POST", "/api/auth/register", { email: `ias-ui-owner-${stamp}@example.com`, password: "Testpass123", name: "Switch UI Owner", hipaa_acknowledged: true });
const staff = await call("POST", "/api/auth/register", { email: `ias-ui-staff-${stamp}@example.com`, password: "Testpass123", name: "Casey Counter", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: `ias-ui-owner-${stamp}@example.com`, labName: "Switch UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Switch UI Lab", cliaNumber: "11D7654378", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const rosterId = (await call("POST", `${L}/staff/employees`, { lastName: "Counter", firstName: "Casey", highestComplexity: "M", performsTesting: true }, owner.token)).id;
const sdb = new Database(process.env.SCRATCH_DB);
const now = new Date().toISOString();
const sid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(`ias-ui-staff-${stamp}@example.com`).id;
const oid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(`ias-ui-owner-${stamp}@example.com`).id;
sdb.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at)
  VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`).run(labId, sid, now, now, now);
sdb.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id)
  VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'staff_portal', ?)`).run(oid, `ias-ui-staff-${stamp}@example.com`, sid, now, now, `ias-ui-${stamp}`, labId, rosterId);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id IN (?, ?)").run(sid, oid);
sdb.close();
const setFlag = (v) => { const d = new Database(process.env.SCRATCH_DB); d.prepare("UPDATE staff_employees SET can_adjust_inventory = ? WHERE id = ?").run(v, rosterId); d.close(); };

const browser = await chromium.launch();
const open = async (colorScheme) => {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, colorScheme });
  await page.goto(`${BASE}/`);
  // The test user signed up through the public form, so dismiss the prospect welcome screen (same as the other UI checks).
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [staff.token, staff.user]);
  await page.goto(`${BASE}/staff-access`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="sp-tile-inventory"]').waitFor({ timeout: 20000 });
  return page;
};

// Switch off (the default)
let page = await open("light");
let tile = page.locator('[data-testid="sp-tile-inventory"]');
check("switch off: Count Inventory is disabled and says who can turn it on",
  (await tile.isDisabled()) && /Ask your lab director to turn on "Can adjust inventory"/.test(await tile.innerText()), (await tile.innerText()).replace(/\s+/g, " "));
await page.screenshot({ path: path.join(OUT, "inventory-switch-off.png"), fullPage: false });
const dark = await open("dark");
check("dark mode renders the disabled tile", await dark.evaluate(() => document.documentElement.classList.contains("dark")) && (await dark.locator('[data-testid="sp-tile-inventory"]').isDisabled()));
await dark.screenshot({ path: path.join(OUT, "inventory-switch-off-dark.png"), fullPage: false });

// Switch on
setFlag(1);
await page.reload({ waitUntil: "networkidle" });
tile = page.locator('[data-testid="sp-tile-inventory"]');
await tile.waitFor({ timeout: 20000 });
check("switch on: Count Inventory is enabled and opens VeritaStock", !(await tile.isDisabled()) && /Opens VeritaStock/.test(await tile.innerText()), (await tile.innerText()).replace(/\s+/g, " "));
await page.screenshot({ path: path.join(OUT, "inventory-switch-on.png"), fullPage: false });
await tile.click();
await page.waitForURL(/veritastock/, { timeout: 15000 }).catch(() => {});
check("clicking it opens VeritaStock", /veritastock/.test(page.url()), page.url());
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
