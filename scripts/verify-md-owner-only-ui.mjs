// scripts/verify-md-owner-only-ui.mjs
// Gate 3 step 8 receipt for bug 3 (2026-10-09: "I am only an admin on this lab
// yet I can set the medical director?"). Run against a LOCAL server on a scratch
// database (it registers users, provisions a lab and writes lab_members rows
// directly in SCRATCH_DB, so never point it at production). Usage:
//   PW_BASE=http://localhost:5143 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-md-owner-only-ui.mjs
// The owner sees "Make medical director" and can pick Medical Director in the
// invite form; an admin sees the Medical Director badge but no buttons, and the
// invite option is disabled "(owner only)". Light + dark shots of the admin view.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5143", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const stamp = Date.now();
const ownerEmail = `md-owner-${stamp}@example.com`, adminEmail = `md-admin-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: "testpass123", name: "Lab Owner", hipaa_acknowledged: true });
const admin = await call("POST", "/api/auth/register", { email: adminEmail, password: "testpass123", name: "Lab Admin", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "MD Owner-Only Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
const adminId = sdb.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email IN (?, ?)").run(ownerEmail, adminEmail);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, medical_director_email = ?, medical_director_name = ? WHERE id = ?").run(ownerEmail, "Lab Owner", labId);
sdb.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at) VALUES (?, ?, 'admin', 'active', 1, datetime('now'))").run(labId, adminId);
sdb.close();

const browser = await chromium.launch();
async function view(who, token, mode) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [token, me]);
  await page.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByTestId("medical-director-badge").first().waitFor({ timeout: 20000 });
  const makeButtons = await page.getByTestId("make-md-btn").count() + await page.getByTestId("clear-md-btn").count();
  const mdOption = page.locator('[data-testid="invite-role-select"] option[value="medical_director"]');
  const optDisabled = await mdOption.count() ? await mdOption.evaluate((o) => o.disabled) : null;
  const optText = await mdOption.count() ? (await mdOption.innerText()).trim() : "";
  return { page, makeButtons, optDisabled, optText };
}
{
  const v = await view("owner", owner.token, "light");
  check("owner sees the Make/Clear medical director buttons", v.makeButtons >= 1, `buttons=${v.makeButtons}`);
  check("owner can pick Medical Director in the invite form", v.optDisabled === false, v.optText);
  await v.page.close();
}
for (const mode of ["light", "dark"]) {
  const v = await view("admin", admin.token, mode);
  check(`${mode}: admin sees the Medical Director badge but no Make/Clear buttons`, v.makeButtons === 0, `buttons=${v.makeButtons}`);
  check(`${mode}: admin's Medical Director invite option is disabled (owner only)`, v.optDisabled === true && /owner only/.test(v.optText), v.optText);
  await v.page.screenshot({ path: `${OUT}/md_owner_only_admin_${mode}.png`, fullPage: true });
  await v.page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
