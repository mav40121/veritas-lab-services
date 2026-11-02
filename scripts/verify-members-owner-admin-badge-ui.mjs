// scripts/verify-members-owner-admin-badge-ui.mjs
// Browser receipt (Michael 2026-11-02, Heywood: "he is not showing as the admin"): on the Lab Members page an owner
// shows the Admin badge as well as Owner, because an owner holds every admin right; an admin shows Admin only.
// Made-up people and lab on a scratch DB only. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-members-owner-admin-badge-ui.mjs
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
const ownerEmail = `owner-badge-${stamp}@example.com`, adminEmail = `admin-badge-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: "Testpass123", name: "Olive Owner", hipaa_acknowledged: true });
const admin = await call("POST", "/api/auth/register", { email: adminEmail, password: "Testpass123", name: "Adam Admin", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Badge Test Lab", plan: "hospital" })).labId;
const add = await call("POST", "/api/admin/add-lab-membership", { secret: ADMIN, userId: admin.user?.id, labId, role: "admin" });
const sdb = new Database(process.env.SCRATCH_DB);
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
const roles = sdb.prepare("SELECT u.name, lm.role FROM lab_members lm JOIN users u ON u.id = lm.user_id WHERE lm.lab_id = ? ORDER BY lm.role DESC").all(labId);
check("setup: one owner and one admin on the lab", roles.some((r) => r.role === "owner") && roles.some((r) => r.role === "admin"), JSON.stringify(roles) + " add=" + JSON.stringify(add).slice(0, 80));

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, colorScheme: scheme });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
  await page.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
  if (scheme === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  const ownerRow = page.locator("tr", { hasText: "Olive Owner" });
  const adminRow = page.locator("tr", { hasText: "Adam Admin" });
  await ownerRow.first().waitFor({ timeout: 15000 });
  const ownerBadges = (await ownerRow.first().locator("td").nth(1).innerText()).replace(/\s+/g, " ").trim();
  const adminBadges = (await adminRow.first().locator("td").nth(1).innerText()).replace(/\s+/g, " ").trim();
  const yourRole = (await page.getByText("Your role on this lab:").innerText()).replace(/\s+/g, " ").trim();
  if (scheme === "light") {
    check("owner row shows Owner and Admin", /Owner/.test(ownerBadges) && /Admin/.test(ownerBadges), ownerBadges);
    check("admin row shows Admin and not Owner", /Admin/.test(adminBadges) && !/Owner/.test(adminBadges), adminBadges);
    check("'Your role on this lab' shows Owner and Admin for the owner", /Owner/.test(yourRole) && /Admin/.test(yourRole), yourRole);
  }
  await page.locator("table").first().screenshot({ path: path.join(OUT, `members-owner-admin-${scheme}.png`) });
  check(`${scheme} mode: members table renders`, await ownerRow.first().isVisible());
  await page.close();
}
await browser.close();
sdb.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
