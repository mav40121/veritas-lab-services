// scripts/verify-competency-signatures-ui.mjs
//
// Browser receipt for B5 (signatures mock 2, 2026-11-27): competency signed by the person who watched and the person who
// evaluated. LOCAL production build + scratch DB only; made-up laboratory, people and results. Proves on screen:
//   1. the person page names the observer on Elements 1 and 4 and waits for them; the evaluator signs as themselves ("You sign
//      as"), and a Pass is held while the observer hasn't signed
//   2. the observer, on a Staff login, sees "Observations to sign" on VeritaComp™ and signs both with one name and password
//   3. the same Staff login reviews the method under "Methods to sign" and signs it as evaluator, with no edit controls
//   4. the person page then reads how it was signed, with the record's fingerprint; the record PDF is saved for a look at page 1
//   5. light and dark, 1280 and 390 px wide, with no sideways scroll and no Content-Security-Policy violations
// Run: PW_BASE=http://localhost:<port> SCRATCH_DB=<db> OUT=<dir> node scripts/verify-competency-signatures-ui.mjs
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT, DB = process.env.SCRATCH_DB;
const PW = ["Comp", "sign", "ui", "5k!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; }
};
const db = (fn) => { const d = new Database(DB); try { return fn(d); } finally { d.close(); } };
const now = new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
fs.mkdirSync(OUT, { recursive: true });

// ── Setup: a lab, Sam (tested), Casey Tate (TC, Staff login), Morgan Chen (TS, editor) ──
const owner = (await call("POST", "/api/auth/register", { email: "b5-ui-owner@owner.test", password: PW, name: "Jordan Ellis", hipaa_acknowledged: true })).body;
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: "b5-ui-owner@owner.test", labName: "Example Hospital Laboratory", plan: "hospital" })).body?.labId;
const L = `/api/labs/${lab}`;
await call("POST", `${L}/staff/lab`, { labName: "Example Hospital Laboratory", cliaNumber: "00D0000000", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token)).body.id;
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [{ name: "CH-500 Chemistry", category: "Chemistry", tests: [{ analyte: "Made-up Sodium", specialty: "Chemistry", complexity: "MODERATE", active: 1 }] }] });
const CHEM = db((d) => d.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = 'CH-500 Chemistry' AND map_id = ?").get(mapId).id);
const person = async (last, first, roles = []) => (await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, title: roles.length ? "" : "MLS", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01", roles }, owner.token)).body.id;
const sam = await person("Rivera", "Sam");
const casey = await person("Tate", "Casey", [{ role: "TC", specialtyNumber: 7 }]);
const morgan = await person("Chen", "Morgan", [{ role: "TS", specialtyNumber: 7 }]);
db((d) => d.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(sam, CHEM, now));
const people = {};
for (const [tag, email, name, rosterId, seatType] of [["casey", "casey@example.test", "Casey Tate", casey, "staff_portal"], ["morgan", "morgan@example.test", "Morgan Chen", morgan, "active"]]) {
  const reg = (await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true })).body;
  db((d) => {
    d.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,?,'active',1,?,?,?)").run(lab, reg.user.id, "staff", now, now, now);
    d.prepare("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(lab, reg.user.id);
    d.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`).run(owner.user.id, email, reg.user.id, now, now, seatType === "active" ? '{"mode":"edit_all"}' : '{"mode":"view_all"}', `b5-ui-${tag}-${Date.now()}`, lab, seatType, seatType === "staff_portal" ? rosterId : null);
    if (seatType === "active") d.prepare("UPDATE staff_employees SET login_user_id = ? WHERE id = ?").run(reg.user.id, rosterId);
    d.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(reg.user.id);
  });
  const login = (await call("POST", "/api/auth/login", { email, password: PW })).body;
  people[tag] = { email, name, id: reg.user.id, token: login.token, user: login.user };
}
db((d) => { d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(owner.user.id); d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab); });
const day = daysAgo(8);
const saved = await call("PUT", `${L}/competency/employee/${sam}/test-system/${CHEM}`, { elements: [
  { num: 1, specimenId: "QA-1042", observerInitials: "CT", passed: true },
  { num: 2, evidence: "Result review", date: day, passed: true },
  { num: 3, qcDate: day, passed: true },
  { num: 4, dateObserved: day, observerInitials: "CT", passed: true },
  { num: 5, samples: [{ sampleType: "PT", sampleId: "PT-2026-1", acceptable: true }], passed: true },
  { num: 6, quizId: "Q-CH-1", score: 100, dateTaken: day, passed: true },
] }, owner.token);
check("0. a lab, Sam's CH-500 Chemistry entries naming Casey Tate as observer, Casey on a Staff login and Morgan on an editor seat", !!lab && saved.status === 200 && !!people.casey.token && !!people.morgan.token, JSON.stringify(saved.body));

const browser = await chromium.launch();
const csp = [];
const open = async (who, scheme, width, path) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  ctx.on("page", (pg) => pg.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); }));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [who.token, who.user, lab]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return { ctx, page };
};
const noSideways = async (page, width) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= width + 1;
const personPath = `/labs/${lab}/veritacomp-app/employee/${sam}?method=${CHEM}`;

// 1. The evaluator's view before the observer signs.
for (const [scheme, width, tag] of [["light", 1280, "light"], ["dark", 390, "dark-390"]]) {
  const { ctx, page } = await open(people.morgan, scheme, width, personPath);
  await page.getByTestId("method-sign-form").waitFor({ timeout: 20000 });
  check(`1. ${tag}: Elements 1 and 4 say Not signed, and the method waits for the observer`, (await page.getByTestId("observer-not-signed-chip").count()) === 2 && (await page.getByTestId("observer-waiting").innerText()).includes("Element 1 (Casey Tate) and Element 4 (Casey Tate)"));
  check(`1. ${tag}: Morgan signs as Morgan, not a name from a list`, (await page.getByTestId("sign-as").innerText()).startsWith("Morgan Chen, Technical Supervisor") && (await page.getByTestId("paper-signer-select").count()) === 0);
  await page.getByTestId("determination-select").selectOption("pass");
  check(`1. ${tag}: a Pass is held until the observer signs`, await page.getByTestId("observer-pass-blocked").isVisible() && await page.getByTestId("sign-method").isDisabled());
  check(`1. ${tag}: no sideways scroll`, await noSideways(page, width));
  await page.screenshot({ path: `${OUT}/person-waiting-${tag}.png`, fullPage: true });
  await ctx.close();
}

// 2. The observer signs both observations from their Staff login.
for (const [scheme, width, tag] of [["dark", 390, "dark-390"], ["light", 390, "light-390"]]) {
  const { ctx, page } = await open(people.casey, scheme, width, `/labs/${lab}/veritacomp-app`);
  await page.getByTestId("observations-to-sign").waitFor({ timeout: 20000 });
  check(`2. ${tag}: Casey's VeritaComp shows two observations to sign, Sam Rivera's`, (await page.getByTestId("observation-row").count()) === 2 && (await page.getByTestId("observations-statement").innerText()).includes("I watched Sam Rivera"));
  check(`2. ${tag}: no sideways scroll`, await noSideways(page, width));
  if (tag === "dark-390") { await page.screenshot({ path: `${OUT}/observations-to-sign-${tag}.png`, fullPage: true }); await ctx.close(); continue; }
  for (const row of await page.getByTestId("observation-date").all()) await row.fill(daysAgo(3));
  for (const b of await page.getByTestId("observation-pass").all()) await b.click();
  await page.getByTestId("observations-sign-name").fill("Casey Tate");
  await page.getByTestId("observations-sign-password").fill(PW);
  await page.screenshot({ path: `${OUT}/observations-to-sign-${tag}.png`, fullPage: true });
  await page.getByTestId("observations-sign").click();
  await page.getByTestId("observations-to-sign").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const sigs = db((d) => d.prepare("SELECT * FROM competency_observation_signatures WHERE staff_employee_id = ?").all(sam));
  check("2. two signature rows, each as Casey with name and password", sigs.length === 2 && sigs.every((s) => s.observer_staff_employee_id === casey && s.signed_with === "password" && s.typed_name === "Casey Tate"), JSON.stringify(sigs.map((s) => [s.element_number, s.signed_with])));

  // 3. The same Staff login signs the method as evaluator.
  await page.getByTestId("methods-to-sign").waitFor({ timeout: 15000 });
  await page.getByTestId("method-to-sign-open").click();
  await page.getByTestId("method-sign-form").waitFor({ timeout: 10000 });
  check("3. the method opens read only for review: no Save, no Unlock, no paper entry", (await page.getByTestId("save-test-system").count()) === 0 && (await page.getByTestId("method-unlock").count()) === 0 && (await page.getByTestId("sign-mode-toggle").count()) === 0 && (await page.getByTestId("signed-observer").count()) === 2);
  check("3. Casey signs as Casey", (await page.getByTestId("sign-as").innerText()).startsWith("Casey Tate, Technical Consultant"));
  await page.getByTestId("determination-select").selectOption("pass");
  await page.getByTestId("method-sign-name").fill("Casey Tate");
  await page.getByTestId("method-sign-password").fill(PW);
  check("3. no sideways scroll with the form open", await noSideways(page, width));
  await page.screenshot({ path: `${OUT}/method-to-sign-${tag}.png`, fullPage: true });
  await page.getByTestId("sign-method").click();
  await page.waitForTimeout(2500);
  const row = db((d) => d.prepare("SELECT * FROM competency_method_signoffs WHERE staff_employee_id = ? AND instrument_id = ?").get(sam, CHEM));
  check("3. the method is signed by Casey, electronically, with the server's fingerprint", row?.signer_staff_employee_id === casey && row?.signed_with === "password" && /^[0-9a-f]{64}$/.test(row?.record_fingerprint || ""), JSON.stringify(row));
  await ctx.close();
}

// 4. The person page after, and the record PDF.
for (const [scheme, width, tag] of [["light", 1280, "light"], ["dark", 390, "dark-390"]]) {
  const { ctx, page } = await open(people.morgan, scheme, width, personPath);
  await page.getByTestId("method-how-signed").waitFor({ timeout: 20000 });
  const how = await page.getByTestId("method-how-signed").innerText();
  check(`4. ${tag}: the sign-off says how and when it was signed, and the record's fingerprint`, how.startsWith("Electronically, name and password") && /Record [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}/.test(how), how);
  await page.getByTestId("method-view-entries").click();
  check(`4. ${tag}: the signed entries say the observer signed`, (await page.getByTestId("signed-observer").count()) === 2);
  check(`4. ${tag}: no sideways scroll`, await noSideways(page, width));
  await page.screenshot({ path: `${OUT}/person-signed-${tag}.png`, fullPage: true });
  await ctx.close();
}
const tok = (await call("GET", `${L}/competency/employee/${sam}/record-pdf`, undefined, people.morgan.token)).body?.token;
const pdf = tok ? Buffer.from(await (await fetch(`${BASE}/api/pdf/${tok}`, { headers: { Authorization: `Bearer ${people.morgan.token}` } })).arrayBuffer()) : Buffer.alloc(0);
fs.writeFileSync(`${OUT}/competency-record.pdf`, pdf);
check("4. the record PDF renders", pdf.slice(0, 5).toString() === "%PDF-" && pdf.length > 10000, `${pdf.length} bytes`);
check("5. no Content-Security-Policy violations", csp.length === 0, csp.slice(0, 2).join(" | "));
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
