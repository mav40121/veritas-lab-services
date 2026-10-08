// scripts/verify-84-phase1-staff-ui.mjs
// Gate 3 step 8 browser receipt for parking lot #84 Phase 1 (2026-10-08): a
// Staff login sees the same module screens as the editors, can do the recording
// work, and does not see owner setup chrome. Runs against a LOCAL server on a
// scratch database (it creates the staff membership and seat directly in
// SCRATCH_DB; never point it at production). Usage:
//   PW_BASE=http://localhost:5131 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-84-phase1-staff-ui.mjs
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

const ownerEmail = `p1-owner-${stamp}@example.com`, staffEmail = `p1-staff-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: "testpass123", name: "P1 Owner", hipaa_acknowledged: true });
const staff = await call("POST", "/api/auth/register", { email: staffEmail, password: "testpass123", name: "Elizabeth Staff", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "P1 Lab", plan: "hospital" })).labId;
await call("POST", `/api/labs/${labId}/qc/control-lots`, { analyte: "PSA (FREND B)", level: "Level 1", lot_number: "6361A26001", mfr_mean: 1.29, mfr_sd: 0.35, mfr_range_low: 0.59, mfr_range_high: 1.99 }, owner.token);
await call("POST", `/api/labs/${labId}/equipment`, { instrument_name: "FREND B" }, owner.token);
const sdb = new Database(process.env.SCRATCH_DB);
const now = new Date().toISOString();
const ownerId = sdb.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail).id;
const staffId = sdb.prepare("SELECT id FROM users WHERE email = ?").get(staffEmail).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(ownerId);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
// What an accepted Staff invite creates: a 'staff' membership + a staff_portal seat (view_all).
sdb.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)").run(labId, staffId, now, now, now);
sdb.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{\"mode\":\"view_all\"}', ?, ?, 'staff_portal')").run(ownerId, staffEmail, staffId, now, now, `p1-${stamp}`, labId);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(staffId);
sdb.close();

async function signIn(browser, email) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const login = await call("POST", "/api/auth/login", { email, password: "testpass123" });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [login.token, login.user]);
  return page;
}

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await signIn(browser, staffEmail);
  await page.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByTestId("staff-my-work").waitFor({ timeout: 15000 }).catch(() => {});
  const dash = {
    myWork: await page.getByTestId("staff-my-work").count(),
    gettingStarted: await page.getByTestId("getting-started-card").count(),
    runAStudy: await page.getByRole("link", { name: "Run a Study" }).count(),
    plans: await page.getByRole("link", { name: "Plans", exact: true }).count(),
    setupBanner: await page.getByText("Complete your lab setup").count(),
    startAStudy: await page.getByRole("link", { name: "Start a Study" }).count(),
  };
  await page.screenshot({ path: `${OUT}/84p1_staff_dashboard_${mode}.png` });
  check(`staff dashboard (${mode}): My work shown; no Getting Started, Run a Study, Start a Study, Plans or setup banner`,
    dash.myWork === 1 && dash.gettingStarted === 0 && dash.runAStudy === 0 && dash.plans === 0 && dash.setupBanner === 0 && dash.startAStudy === 0, JSON.stringify(dash));

  if (mode === "light") {
    // VeritaQC: staff can record; supervisor controls are absent
    await page.goto(`${BASE}/labs/${labId}/veritaqc-app`, { waitUntil: "networkidle" });
    await page.locator("#qc-value").waitFor({ timeout: 15000 });
    const enabled = await page.locator("#qc-value").isEnabled();
    await page.locator("#qc-value").fill("1.12");
    await page.locator("#qc-date").fill("2026-10-08");
    await page.locator("form button[type=submit]").first().click();
    await page.waitForTimeout(1500);
    const recorded = await page.getByText("1.12").count();
    const voidBtn = await page.getByRole("button", { name: "Void" }).count();
    // an out-of-range run opens the corrective-action dialog; staff get no exclude box
    await page.locator("#qc-value").fill("2.9");
    await page.locator("form button[type=submit]").first().click();
    await page.waitForTimeout(1500);
    const caOpen = await page.getByRole("dialog").filter({ hasText: /corrective action/i }).count();
    const excludeBox = await page.getByText("Exclude this run from the QC baseline").count();
    await page.screenshot({ path: `${OUT}/84p1_staff_qc_${mode}.png` });
    check("staff VeritaQC: entry enabled and a result records; no Void button; the corrective-action dialog opens with no exclude-from-baseline box",
      enabled && recorded > 0 && voidBtn === 0 && caOpen > 0 && excludeBox === 0, JSON.stringify({ enabled, recorded, voidBtn, caOpen, excludeBox }));

    // VeritaMaintain: log maintenance yes, add instrument no
    await page.goto(`${BASE}/labs/${labId}/equipment-app`, { waitUntil: "networkidle" });
    const logBtn = page.getByRole("button", { name: "Log maintenance" }).first();
    await logBtn.waitFor({ timeout: 15000 });
    const maint = { log: await logBtn.isEnabled(), add: await page.getByRole("button", { name: "+ Add instrument" }).isEnabled() };
    check("staff VeritaMaintain: Log maintenance enabled, Add instrument disabled", maint.log && !maint.add, JSON.stringify(maint));

    // VeritaStock: scan to count yes
    await page.goto(`${BASE}/labs/${labId}/veritastock`, { waitUntil: "networkidle" });
    const countBtn = page.getByTestId("open-count-workflow-button");
    await countBtn.waitFor({ timeout: 15000 });
    check("staff VeritaStock: Scan to count enabled", await countBtn.isEnabled());
  }
  await page.close();
}

// Control: the owner still sees the setup chrome and supervisor controls
const op = await signIn(browser, ownerEmail);
await op.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "networkidle" });
await op.waitForTimeout(800);
const own = {
  myWork: await op.getByTestId("staff-my-work").count(),
  gettingStarted: await op.getByTestId("getting-started-card").count(),
  runAStudy: await op.getByRole("link", { name: "Run a Study" }).count(),
  plans: await op.getByRole("link", { name: "Plans", exact: true }).count(),
  startAStudy: await op.getByRole("link", { name: "Start a Study" }).count(),
};
await op.goto(`${BASE}/labs/${labId}/veritaqc-app`, { waitUntil: "networkidle" });
await op.waitForTimeout(1000);
own.voidBtn = await op.getByRole("button", { name: "Void" }).count();
check("owner control: no My work card; Getting Started, Run a Study, Plans and Void all present",
  own.myWork === 0 && own.gettingStarted === 1 && own.runAStudy > 0 && own.plans > 0 && own.startAStudy > 0 && own.voidBtn > 0, JSON.stringify(own));
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
