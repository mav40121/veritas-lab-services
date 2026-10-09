// scripts/verify-seat-card-ui.mjs
// Gate 3 step 8 receipt for bug 4 (2026-10-09: "Every lab is showing that they
// have 25 admin seats and no staff seats"). Run against a LOCAL server on a
// scratch database (it registers an owner, provisions a lab and writes rows in
// SCRATCH_DB directly, so never point it at production). Usage:
//   PW_BASE=http://localhost:5145 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-seat-card-ui.mjs
// A Community lab whose owner's ACCOUNT plan is enterprise (the Redington shape)
// must read "1 of 5 active seats used"; after the admin route sets the Medium
// band, staff read "1 of 100 read-and-sign staff (Medium band)". Light + dark.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5145", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const ownerEmail = `seats-owner-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: "testpass123", name: "Lab Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Seat Card Lab", plan: "community" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
const ownerId = sdb.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'enterprise', seat_count = 1 WHERE id = ?").run(ownerId);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, plan = 'community' WHERE id = ?").run(labId);
sdb.prepare("INSERT INTO user_seats (owner_user_id, seat_email, invited_at, status, permissions, lab_id, seat_type) VALUES (?, 'tech@example.com', datetime('now'), 'pending', '{}', ?, 'staff_portal')").run(ownerId, labId);
sdb.close();
const band = await call("POST", "/api/admin/set-lab-staff-portal-band", { secret: ADMIN, labId, band: "medium" });
check("admin route set the Medium band", band.ok === true && band.after === "medium", JSON.stringify(band).slice(0, 160));

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, owner.token]);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [owner.token, me]);
  await page.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  const staff = page.getByTestId("staff-portal-count");
  await staff.waitFor({ timeout: 20000 });
  const card = staff.locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  const text = (await card.innerText()).replace(/\s+/g, " ");
  check(`${mode}: Community lab reads 1 of 5 active seats (not 25)`, /1 of 5 active seats used/.test(text), text.slice(0, 120));
  check(`${mode}: staff read 1 of 100 (Medium band)`, /1 of 100 read-and-sign staff \(Medium band\)/.test(text), (await staff.innerText()).trim());
  await card.screenshot({ path: `${OUT}/seat_card_${mode}.png` });
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
