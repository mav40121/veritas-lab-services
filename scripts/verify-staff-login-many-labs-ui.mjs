// scripts/verify-staff-login-many-labs-ui.mjs
//
// Browser receipt for B3 (BUG-193, 2026-11-24): one read-and-sign staff login in several labs, and BUG-189 part 1's picker. On a local
// production build with a scratch DB and made-up people:
//   B1. a person Staff in one lab sees the other lab's invitation, accepts it, and lands in that lab with both in the switcher
//   S1. My sign-offs is the lab on screen; the switcher moves between the labs' sign-offs; the other lab's waiting items link there
//   J1. the emailed link, signed out: the create form and "Sign in to accept"
//   J2. the emailed link, signed in as someone else: which address it was sent to, and no Accept
//   J3. the emailed link, signed in as the invited person: Accept lands in the lab
//   W1. an editor in one lab who is Staff in the other: New Map on there, off here
//   P1. VeritaComp's Import from VeritaPT picker lists this lab's events with who tested, and fills the event ID and name
//   D1. the same in dark mode, and at phone width with no sideways scroll
// Localhost only. Run (from the repo): PW_BASE=http://localhost:5217 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-staff-login-many-labs-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE || "")) { console.log(`FAIL  PW_BASE must be a localhost URL (got ${BASE})`); process.exit(1); }
if (!process.env.SCRATCH_DB) { console.log("FAIL  SCRATCH_DB is required"); process.exit(1); }
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, path, body, token, lab) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(lab ? { "X-Active-Lab-Id": String(lab) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Many", "Labs", "Ui", "42!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();

const register = async (tag, name, inviteToken) => {
  const email = `sml-ui-${tag}-${stamp}@example.com`;
  const r = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true, ...(inviteToken ? { inviteToken } : {}) });
  const id = Number(sql("SELECT id FROM users WHERE email = ?", email)?.id);
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", id);
  return { email, name, token: r.body.token, id };
};
const OWNER = await register("owner", "Made-up Owner Larkspur");
const lab = async (name) => { const id = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: OWNER.email, labName: name, plan: "hospital" })).body.labId; sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", id); return id; };
const A = await lab("Made-up Northgate Lab"), S = await lab("Made-up Hillcrest Lab");
sql("UPDATE users SET plan = 'hospital', seat_count = 30 WHERE id = ?", OWNER.id);
const staffLabOf = (l) => sql("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", l)?.id ?? Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Made-up Lab', '22D0000777', ?, ?, ?)", OWNER.id, l, now, now));
const roster = (first, last, l) => Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, hire_date, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'MLS', '2019-03-01', 1, 'active', ?, ?)", staffLabOf(l), l, OWNER.id, last, first, now, now));
const invite = async (l, emp, email) => (await call("POST", `/api/labs/${l}/staff-portal-invites`, { staff_employee_id: emp, email, deliverEmail: false }, OWNER.token)).body;
const people = {};
for (const mode of ["light", "dark"]) {
  const t = mode === "dark" ? "Dusk" : "Dawn";
  const aRow = roster("Robin", t, A), sRow = roster("Robin", t, S);
  const first = await invite(A, aRow, `sml-ui-flo${mode}-${stamp}@example.com`);
  const who = await register(`flo${mode}`, `Robin ${t}`, first.inviteToken);
  // Something waiting in A.
  const programId = (await call("POST", `/api/labs/${A}/competency/programs`, { name: `Chemistry ${mode}`, department: "Chemistry", type: "technical" }, OWNER.token, A)).body.id;
  const qid = Number(sql("INSERT INTO competency_quizzes (user_id, program_id, lab_id, title, method_group_ids, created_by_user_id, questions, created_at) VALUES (?, ?, ?, ?, '[]', ?, ?, ?)", OWNER.id, programId, A, `Made-up quiz ${mode}`, OWNER.id, JSON.stringify([{ id: "q1", question: "Made-up question", options: ["A", "B"], correct_answer: "A" }]), now));
  await call("POST", `/api/veritacomp/quizzes/${qid}/assignments`, { staff_employee_ids: [aRow] }, OWNER.token, A);
  const inv = await invite(S, sRow, who.email);
  people[mode] = { who, sRow, inv };
}
check("setup: two labs, two people Staff in the first and invited to the second", A > 0 && S > 0 && !!people.light.who.token && !!people.dark.inv.inviteToken, JSON.stringify({ A, S }));
const STRANGER = await register("stranger", "Made-up Stranger");

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const openAs = async (u, path, { mode = "light", viewport = { width: 1200, height: 900 }, lab: l = null } = {}) => {
  const ctx = await browser.newContext({ viewport, colorScheme: mode });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  if (u) {
    const me = (await call("GET", "/api/auth/me", undefined, u.token)).body;
    await page.evaluate(([t, usr, lb]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(usr)); if (lb) localStorage.setItem("veritas_active_lab_id", String(lb)); if (usr?.id) localStorage.setItem(`onboarding_dismissed_${usr.id}`, "1"); }, [u.token, me, l]);
  }
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const acceptTerms = async (u) => { const s = (await call("GET", "/api/auth/terms", undefined, u.token)).body; if (s.required) await call("POST", "/api/auth/terms/accept", { version: s.version, typedName: u.name, typed_name: u.name, accepted: true, agree: true, acceptOrganization: true }, u.token); };
for (const u of [OWNER, STRANGER, people.light.who, people.dark.who]) await acceptTerms(u);

for (const mode of ["light", "dark"]) {
  const tag = mode === "dark" ? "D1. dark: " : "";
  const { who } = people[mode];
  const p = await openAs(who, `/labs/${A}/dashboard`, { mode, lab: A });
  const banner = p.getByTestId("staff-invite-banner");
  await banner.waitFor({ timeout: 25000 }).catch(() => {});
  if (mode === "dark") check(`${tag}the page follows the system setting`, await p.evaluate(() => document.documentElement.classList.contains("dark")));
  check(`${tag}B1a. the invitation is on screen, naming the lab`, /Made-up Hillcrest Lab\s+invited you to a staff login/.test((await banner.innerText().catch(() => "")).replace(/\s+/g, " ")));
  await p.screenshot({ path: `${OUT}/b3-invite-banner-${mode}.png` });
  await p.setViewportSize({ width: 390, height: 800 });
  await p.waitForTimeout(300);
  check(`${tag}B1b. at phone width it fits`, await noSideways(p));
  await p.screenshot({ path: `${OUT}/b3-invite-banner-phone-${mode}.png` });
  await p.setViewportSize({ width: 1200, height: 900 });
  await banner.getByRole("button", { name: "Accept" }).click();
  await p.waitForURL(new RegExp(`/labs/${S}/dashboard`), { timeout: 20000 }).catch(() => {});
  check(`${tag}B1c. accepting opens that lab, and the banner is gone`, p.url().includes(`/labs/${S}/dashboard`) && !(await banner.isVisible().catch(() => false)), p.url());
  await p.getByTestId("lab-switcher").click();
  const menu = (await p.getByRole("menu").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(`${tag}B1d. the switcher has both labs`, menu.includes("Made-up Northgate Lab") && menu.includes("Made-up Hillcrest Lab"), menu.slice(0, 200));
  await p.screenshot({ path: `${OUT}/b3-switcher-${mode}.png` });
  await p.keyboard.press("Escape");

  await p.goto(`${BASE}/labs/${S}/my-signoffs`, { waitUntil: "networkidle" });
  await p.getByTestId("sp-tiles").waitFor({ timeout: 20000 }).catch(() => {});
  const bodyS = (await p.locator("main").innerText()).replace(/\s+/g, " ");
  check(`${tag}S1a. My sign-offs is Hillcrest's, with Northgate's waiting item`, /MLS · Made-up Hillcrest Lab/.test(bodyS) && /1 item waiting at Made-up Northgate Lab/.test(bodyS) && !/items? waiting for you/.test(bodyS), bodyS.slice(0, 300));
  await p.screenshot({ path: `${OUT}/b3-my-signoffs-${mode}.png` });
  await p.setViewportSize({ width: 390, height: 800 });
  await p.waitForTimeout(300);
  check(`${tag}S1b. at phone width it fits`, await noSideways(p));
  await p.setViewportSize({ width: 1200, height: 900 });
  await p.getByTestId("lab-switcher").click();
  await p.getByRole("menuitem").filter({ hasText: "Made-up Northgate Lab" }).first().click();
  await p.waitForURL(new RegExp(`/labs/${A}/my-signoffs`), { timeout: 20000 }).catch(() => {});
  await p.getByTestId("sp-pending-banner").waitFor({ timeout: 20000 }).catch(() => {});
  const bodyA = (await p.locator("main").innerText()).replace(/\s+/g, " ");
  check(`${tag}S1c. the switcher moves to Northgate's sign-offs, with its quiz`, p.url().includes(`/labs/${A}/my-signoffs`) && /MLS · Made-up Northgate Lab/.test(bodyA) && /You have 1 item waiting for you/.test(bodyA), `${p.url()} ${bodyA.slice(0, 250)}`);
  await p.goto(`${BASE}/labs/${S}/my-signoffs`, { waitUntil: "networkidle" });
  await p.getByTestId(`sp-elsewhere-${A}`).click().catch(() => {});
  await p.waitForURL(new RegExp(`/labs/${A}/my-signoffs`), { timeout: 15000 }).catch(() => {});
  check(`${tag}S1d. the waiting item's link opens the lab it is in`, p.url().includes(`/labs/${A}/my-signoffs`), p.url());
  await p.context().close();

  // The emailed link.
  const tagRow = roster("Jo", `Link${mode}`, S);
  const JO = await register(`jo${mode}`, "Jo Link"); await acceptTerms(JO);
  const link = (await invite(S, tagRow, JO.email)).inviteToken;
  const out = await openAs(null, `/join?token=${link}`, { mode });
  await out.getByTestId("join-have-account").waitFor({ timeout: 20000 }).catch(() => {});
  check(`${tag}J1. signed out: the create form and Sign in to accept`, await out.getByTestId("join-sign-in-to-accept").isVisible().catch(() => false) && await out.getByRole("button", { name: /Create Account/ }).isVisible().catch(() => false));
  await out.screenshot({ path: `${OUT}/b3-join-signed-out-${mode}.png`, fullPage: true });
  await out.getByTestId("join-sign-in-to-accept").click();
  await out.waitForURL(/\/login/, { timeout: 10000 }).catch(() => {});
  check(`${tag}J1b. ... which goes to sign in`, /\/login/.test(out.url()), out.url());
  await out.context().close();
  const other = await openAs(STRANGER, `/join?token=${link}`, { mode });
  await other.getByTestId("join-other-account").waitFor({ timeout: 20000 }).catch(() => {});
  const otherText = (await other.getByTestId("join-other-account").innerText().catch(() => "")).replace(/\s+/g, " ");
  check(`${tag}J2. signed in as someone else: the address it was sent to, and no Accept`, otherText.includes(JO.email) && otherText.includes(STRANGER.email) && (await other.getByTestId("join-accept-btn").count()) === 0, otherText);
  await other.screenshot({ path: `${OUT}/b3-join-other-account-${mode}.png` });
  await other.context().close();
  const mine = await openAs(JO, `/join?token=${link}`, { mode });
  await mine.getByTestId("join-accept").waitFor({ timeout: 20000 }).catch(() => {});
  await mine.screenshot({ path: `${OUT}/b3-join-accept-${mode}.png` });
  await mine.getByTestId("join-accept-btn").click();
  await mine.waitForURL(new RegExp(`/labs/${S}/dashboard`), { timeout: 20000 }).catch(() => {});
  check(`${tag}J3. signed in as the invited person: Accept lands in the lab`, mine.url().includes(`/labs/${S}/dashboard`), mine.url());
  await mine.context().close();
}

// W1. An editor in Northgate, Staff in Hillcrest.
const WRITER = await register("writer", "Made-up Writer Penrose"); await acceptTerms(WRITER);
sql("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)", A, WRITER.id, now, now, now);
sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'active', ?, '{\"mode\":\"edit_all\"}', ?, ?)", OWNER.id, WRITER.email, WRITER.id, A, now, now);
await invite(S, roster("Wren", "Penrose", S), WRITER.email);
await call("POST", `/api/me/staff-invites/${sql("SELECT id FROM user_seats WHERE seat_email = ? AND lab_id = ?", WRITER.email, S).id}/accept`, {}, WRITER.token);
for (const [l, on] of [[A, true], [S, false]]) {
  const p = await openAs(WRITER, `/labs/${l}/veritamap-app`, { lab: l });
  const btn = p.getByRole("button", { name: /New Map/ }).first();
  await btn.waitFor({ timeout: 25000 }).catch(() => {});
  check(`W1. ${on ? "the editor's lab: New Map is on" : "the lab where they are Staff: New Map is off"}`, (await btn.isVisible().catch(() => false)) && (await btn.isEnabled().catch(() => false)) === on);
  await p.context().close();
}

// P1. The PT picker (BUG-189): an unsigned record opened for editing.
const pid = (await call("POST", `/api/labs/${A}/competency/programs`, { name: "Made-up PT program", department: "Chemistry", type: "technical" }, OWNER.token, A)).body.id;
sql("INSERT INTO competency_method_groups (program_id, name, instruments, analytes) VALUES (?, 'Made-up analyzer', '[]', '[\"Glucose\"]')", pid);
const mine = roster("Pat", "Tester", A), other = roster("Kim", "Other", A);
const ce = Number(sql("INSERT INTO competency_employees (user_id, name, title, status, created_at, lab_id, staff_employee_id) VALUES (?, 'Pat Tester', 'MLS', 'active', ?, ?, ?)", OWNER.id, now, A, mine));
sql("INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, competency_type, status, created_at) VALUES (?, ?, 'initial', ?, 'technical', 'incomplete', ?)", pid, ce, now.slice(0, 10), now);
const day = (b) => new Date(Date.now() - b * 86400000).toISOString().slice(0, 10);
const ev = (l, b, id, name, t) => Number(sql("INSERT INTO pt_events (enrollment_id, user_id, event_id, event_name, event_date, analyte, pass_fail, tested_by_employee_id, lab_id) VALUES (0, ?, ?, ?, ?, 'Glucose', 'pass', ?, ?)", OWNER.id, id, name, day(b), t, l));
const e1 = ev(A, 5, "C-A 2026", "Made-up Chemistry 1", mine), e2 = ev(A, 6, null, "Made-up Chemistry 2", null), e3 = ev(A, 7, "C-K 2026", "Made-up Kim event", other), e4 = ev(S, 4, "H-1 2026", "Made-up Hillcrest event", null);
for (const mode of ["light", "dark"]) {
  const p = await openAs(OWNER, `/labs/${A}/veritacomp-app/${pid}`, { mode, lab: A });
  await p.getByRole("button", { name: "Assessments" }).first().click().catch(() => {});
  await p.getByTestId("edit-assessment").first().click({ timeout: 15000 }).catch(() => {});
  const imp = p.getByRole("button", { name: "Import from VeritaPT" }).first();
  await imp.scrollIntoViewIfNeeded().catch(() => {});
  await imp.click({ timeout: 15000 }).catch(() => {});
  await p.getByTestId(`pt-sample-tester-${e1}`).waitFor({ timeout: 15000 }).catch(() => {});
  const dlg = p.getByRole("dialog").filter({ hasText: "Import PT sample from VeritaPT" });
  const text = (await dlg.innerText().catch(() => "")).replace(/\s+/g, " ");
  check(`P1a. ${mode}: this lab's events with who tested; not the other lab's, and not one someone else tested`, /Made-up Chemistry 1/.test(text) && /Tester, Pat/.test(text) && /Made-up Chemistry 2/.test(text) && /Not recorded/.test(text) && !/Hillcrest event/.test(text) && !/Kim event/.test(text), `${text.slice(0, 400)} ${[e2, e3, e4]}`);
  await dlg.screenshot({ path: `${OUT}/b189-pt-picker-${mode}.png` }).catch(() => {});
  await dlg.locator("tr", { hasText: "Made-up Chemistry 1" }).getByRole("button", { name: "Select" }).click().catch(() => {});
  const val = await p.getByPlaceholder("Sample ID").first().inputValue().catch(() => "");
  check(`P1b. ${mode}: Select fills the event ID and name`, val === "C-A 2026, Made-up Chemistry 1", val);
  await p.context().close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED (${passes} passed)` : `\nALL PASS (${passes})`);
process.exit(failures ? 1 : 0);
