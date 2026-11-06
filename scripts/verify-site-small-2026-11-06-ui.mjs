// scripts/verify-site-small-2026-11-06-ui.mjs
// Gate 3 receipt, Michael 2026-11-06: the two quotes are off the pricing page ("just remove the quotes"); the Staff home card no longer promises daily tasks, because VeritaTrack
// frequencies start at Weekly; Account Settings stops telling a lab with no CLIA number to enter one (Splice Histology, CAP-accredited, prepares slides only), and still says so for a lab whose number is pending.
// Run against a LOCAL production build on a scratch database, with made-up people. It writes data, so it refuses any other host. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-site-small-2026-11-06-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const PW = ["Site", "small", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
const stamp = Date.now();
const emailOf = (tag) => `sitesmall-${tag}-${stamp}@example.test`;
const reg = (tag, name) => call("POST", "/api/auth/register", { email: emailOf(tag), password: PW, name, hipaa_acknowledged: true });
const owner = await reg("owner", "Made Up Owner"), staff = await reg("staff", "Ann Staff");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: emailOf("owner"), labName: "Site Small UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Site Small UI Lab", cliaNumber: "99D9999996", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const annId = (await call("POST", `${L}/staff/employees`, { lastName: "Staff", firstName: "Ann", title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).id;
const now = new Date().toISOString();
const sdb = new Database(process.env.SCRATCH_DB);
const userId = (tag) => sdb.prepare("SELECT id FROM users WHERE email = ?").get(emailOf(tag)).id;
const oid = userId("owner"), sid = userId("staff");
sdb.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`).run(labId, sid, now, now, now);
sdb.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'staff_portal', ?)`).run(oid, emailOf("staff"), sid, now, now, `sitesmall-${stamp}`, labId, annId);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id IN (?, ?)").run(oid, sid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
const setClia = (v) => { sdb.prepare("UPDATE labs SET clia_number = ?, clia_locked = 0 WHERE id = ?").run(v, labId); };

const browser = await chromium.launch();
const open = async (token, user, opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, ...opts });
  await ctx.addInitScript(([t, u, lab]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify(u));
    localStorage.setItem("veritas_active_lab_id", String(lab));
    localStorage.setItem(`onboarding_dismissed_${u.id}`, "1");
  }, [token, user, labId]);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { failures++; console.log("FAIL  page error ::", String(e).slice(0, 200)); });
  return { ctx, page };
};
const me = async (token) => call("GET", "/api/auth/me", undefined, token);

// Pricing, signed out
const pub = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const pp = await pub.newPage();
await pp.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
const pricing = await pp.locator("body").innerText();
check("1a. the pricing page still shows its plans", /Clinic/.test(pricing) && /Community/.test(pricing) && /Hospital/.test(pricing));
check("1b. John Hall's quote is gone", !/John Hall|what I was missing/i.test(pricing));
check("1c. Lisa Veri's quote is gone", !/Lisa Veri|revolutionize/i.test(pricing));
await pp.screenshot({ path: path.join(OUT, "site-small-pricing.png"), fullPage: true });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
const ph = await phone.newPage();
await ph.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
check("1d. no sideways scroll on a phone", await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await pub.close(); await phone.close();

// Staff home card
const s = await open(staff.token, await me(staff.token));
await s.page.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "networkidle" });
await s.page.waitForTimeout(1200);
const home = await s.page.locator("body").innerText();
check("2a. the Staff home card says weekly and monthly", /Weekly, monthly and longer-interval tasks assigned to the lab/.test(home), home.slice(0, 300));
check("2b. it no longer says daily", !/Daily, weekly and monthly/.test(home));
await s.page.screenshot({ path: path.join(OUT, "site-small-staff-home.png") });
await s.ctx.close();

// Account Settings, both kinds of placeholder and a real number
const settingsText = async (value, shot, opts) => {
  setClia(value);
  const o = await open(owner.token, await me(owner.token), opts);
  await o.page.goto(`${BASE}/account/settings`, { waitUntil: "networkidle" });
  await o.page.waitForTimeout(1200);
  const note = o.page.getByTestId("clia-pending-note");
  const text = (await note.count()) ? await note.first().innerText() : null;
  if (shot) await o.page.screenshot({ path: path.join(OUT, `site-small-${shot}.png`) });
  await o.ctx.close();
  return text;
};
const none = await settingsText("N/A - CAP 9999999", "settings-no-clia");
check("3a. a lab with no CLIA number isn't told to enter one", /doesn't hold a CLIA number/.test(none ?? "") && !/Enter the lab/.test(none ?? ""), String(none));
const dark = await settingsText("N/A - CAP 9999999", "settings-no-clia-dark", { colorScheme: "dark" });
check("3b. same in dark mode", /doesn't hold a CLIA number/.test(dark ?? ""), String(dark));
const pending = await settingsText("PENDING-MADEUP-2026", "settings-pending");
check("3c. a lab whose number is pending is still told to enter it", /Enter the lab's 10-character CLIA number/.test(pending ?? ""), String(pending));
const real = await settingsText("99D9999996", null);
check("3d. a real number shows no note", real === null, String(real));

sdb.close();
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
