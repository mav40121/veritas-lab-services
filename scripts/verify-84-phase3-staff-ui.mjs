// scripts/verify-84-phase3-staff-ui.mjs
// Gate 3 step 8 browser receipt for parking lot #84 Phase 3 (2026-10-08): a
// Staff login sees the same module screens as the editors but none of the
// setup controls (the server already refuses them since #1533). The owner run
// is the control: every hidden control must be present for the owner, so the
// check proves the gate, not a missing fixture. LOCAL server + scratch DB only.
// Usage:
//   PW_BASE=http://localhost:5131 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-84-phase3-staff-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5131", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const stamp = Date.now();

const ownerEmail = `p3-owner-${stamp}@example.com`, staffEmail = `p3-staff-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: "testpass123", name: "P3 Owner", hipaa_acknowledged: true });
await call("POST", "/api/auth/register", { email: staffEmail, password: "testpass123", name: "Elizabeth Staff", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "P3 Lab", plan: "hospital" })).labId;
const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "P3 Map" }, owner.token);
const prog = await call("POST", `/api/labs/${labId}/competency/programs`, { name: "P3 Program", type: "technical" }, owner.token);
const scan = await call("POST", `/api/labs/${labId}/veritascan/scans`, { name: "P3 Scan" }, owner.token);
const mapId = map.id ?? map.map?.id, progId = prog.id ?? prog.program?.id, scanId = scan.id ?? scan.scan?.id;
check("setup: map, program and scan created by the owner", !!mapId && !!progId && !!scanId, `map=${mapId} program=${progId} scan=${scanId}`);

const sdb = new Database(process.env.SCRATCH_DB);
const now = new Date().toISOString();
const ownerId = sdb.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail).id;
const staffId = sdb.prepare("SELECT id FROM users WHERE email = ?").get(staffEmail).id;
for (const id of [ownerId, staffId]) sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(id);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
// What an accepted Staff invite creates: a 'staff' membership + a staff_portal seat (view_all).
sdb.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)").run(labId, staffId, now, now, now);
sdb.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{\"mode\":\"view_all\"}', ?, ?, 'staff_portal')").run(ownerId, staffEmail, staffId, now, now, `p3-${stamp}`, labId);
sdb.close();

async function signIn(browser, email, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: mode });
  const page = await ctx.newPage();
  const login = await call("POST", "/api/auth/login", { email, password: "testpass123" });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [login.token, login.user]);
  return page;
}
// Counts elements that actually RENDER (have a layout box). Deliberately does NOT
// skip [hidden]: a utility class like inline-flex can override the hidden
// attribute, so "has hidden" is not proof of "not on screen" (found 2026-10-08:
// the first version of this check trusted [hidden] and passed while the button
// was visible).
const visible = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => e.getClientRects().length > 0).length);
const visibleText = (page, text) => page.$$eval("button, a", (els, t) => els.filter((e) => e.textContent && e.textContent.trim().includes(t) && e.getClientRects().length > 0).length, text);
async function go(page, path) { await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }); await page.waitForTimeout(700); }

// Each probe returns counts for the setup controls on one screen.
const probes = [
  ["VeritaMap list: Edit map", `/labs/${labId}/veritamap-app`, (p) => visible(p, 'button[title^="Edit this map"]')],
  ["VeritaMap build: editor (0 = view-only note shown)", `/labs/${labId}/veritamap-app/${mapId}/build`, async (p) => (await visible(p, '[data-testid="map-build-view-only"]')) ? 0 : 1],
  ["VeritaComp program: New Assessment", `/labs/${labId}/veritacomp-app/${progId}`, (p) => visibleText(p, "New Assessment")],
  ["VeritaScan list: Delete scan", `/labs/${labId}/veritascan-app`, (p) => visible(p, 'button[title="Delete scan"]')],
  ["VeritaTrack: Add Task", `/labs/${labId}/veritatrack-app`, (p) => visibleText(p, "Add Task")],
  ["VeritaTrack: Quick Setup panel", `/labs/${labId}/veritatrack-app`, (p) => p.$$eval("*", (els) => els.filter((e) => e.childElementCount === 0 && e.textContent?.trim() === "Select categories to add common tasks automatically" && e.getClientRects().length > 0).length)],
  ["VeritaQA: setup wizard (0 = staff note shown)", `/labs/${labId}/veritabench/pi`, async (p) => (await visible(p, '[data-testid="staff-login-not-available"], [data-testid="pi-view-only-empty"]')) ? 0 : 1],
  ["VeritaPace: Add Month (0 = staff note shown)", `/labs/${labId}/veritabench`, async (p) => (await visible(p, '[data-testid="staff-login-not-available"]')) ? 0 : await visibleText(p, "Add Month")],
  ["Account settings: Discount Code card", `/labs/${labId}/account/settings`, (p) => p.$$eval("h3, div", (els) => els.filter((e) => e.textContent?.trim() === "Discount Code" && e.getClientRects().length > 0).length)],
];

const browser = await chromium.launch();
const results = {};
for (const who of ["staff", "owner"]) {
  for (const mode of who === "staff" ? ["light", "dark"] : ["light"]) {
    const page = await signIn(browser, who === "staff" ? staffEmail : ownerEmail, mode);
    for (const [name, path, probe] of probes) {
      await go(page, path);
      const n = await probe(page);
      results[`${who}|${mode}|${name}`] = n;
      if (who === "staff") check(`staff (${mode}) ${name}: hidden`, n === 0, `visible=${n}`);
      else check(`owner control ${name}: present`, n > 0, `visible=${n}`);
      if (mode === "light" || name.startsWith("VeritaMap build")) await page.screenshot({ path: `${OUT}/84p3_${who}_${mode}_${name.split(":")[0].replace(/\W+/g, "_").toLowerCase()}.png` });
    }
    await page.context().close();
  }
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
