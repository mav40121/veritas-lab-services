// scripts/verify-verification-signatures-ui.mjs
//
// Browser receipt for B4 (2026-11-27; server/verificationSignatures.ts): a VeritaCheck verification plan signed before testing and
// the finished package signed with name, password, role and Accepted or Not accepted. On a local production build with a scratch
// DB, a made-up lab, made-up people and made-up studies:
//   U1. the Plan tab shows the plan unsigned, who can sign it, and the director signs it with name and password
//   U2. the Performance Elements tab marks the study run before the plan was signed
//   U3. the Director or Designee Approval tab: what the signature covers; a wrong password is refused in words and nothing is
//       recorded; nothing is chosen for the signer; the director signs, and the tab says Signed
//   U4. the account owner, who isn't the director or a designee, sees "Not able to sign" and why
//   U5. dark mode, and at phone width nothing runs off the page
//   U6. the package PDF is saved for a look at page 1
//   U7. the other way to sign (S0, server/eSignature.ts): a Technical Supervisor named in a letter, whose made-up email domain
//       requires the made-up hospital's sign-in, sees "Sign with Example Hospital" and no password field; the button opens the
//       hospital sign-in in its own window, fresh, and comes back; the package is signed, recorded sso with the hospital's name
// The director holds a VIEW-ONLY seat throughout (B4 review): signing is decided by qualification, not edit access to VeritaCheck.
// A made-up OpenID Connect provider runs on 127.0.0.1:IDP_PORT for U7 (as scripts/verify-signature-prompt-ui.mjs does).
// Screenshots verification_plan_light.png, verification_approval_light.png, verification_approval_dark.png,
// verification_approval_phone.png and verification_package.pdf in OUT. Nothing leaves the machine: requests to any other host are refused.
// Run: PW_BASE=http://localhost:5199 SCRATCH_DB=<db> OUT=<dir> IDP_PORT=<free port> node scripts/verify-verification-signatures-ui.mjs
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".", IDP_PORT = Number(process.env.IDP_PORT || 5417);
const HOSPITAL = "Example Hospital";

// ── A made-up OpenID Connect provider: signs in whoever the login hint names, at once, with auth_time now (U7) ──
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const idpKey = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...idpKey.publicKey.export({ format: "jwk" }), kid: "vs1", alg: "RS256", use: "sig" };
const ISSUER = `http://127.0.0.1:${IDP_PORT}/tenant/v2.0`;
const CLIENT_ID = "client-vsui";
const idpCodes = new Map();
const asked = [];
const idp = http.createServer(async (req, res) => {
  const u = new URL(req.url, ISSUER);
  if (u.pathname.endsWith("/.well-known/openid-configuration")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/keys` }));
  }
  if (u.pathname.endsWith("/keys")) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ keys: [jwk] })); }
  if (u.pathname.endsWith("/authorize")) {
    const q = u.searchParams;
    asked.push({ prompt: q.get("prompt"), max_age: q.get("max_age"), login_hint: q.get("login_hint") });
    const t = Math.floor(Date.now() / 1000);
    const payload = { iss: ISSUER, aud: CLIENT_ID, sub: `sub-${q.get("login_hint")}`, email: q.get("login_hint"), nonce: q.get("nonce"), iat: t, nbf: t, exp: t + 3600, auth_time: t };
    const h = b64url(Buffer.from(JSON.stringify({ alg: "RS256", kid: "vs1", typ: "JWT" }))), p = b64url(Buffer.from(JSON.stringify(payload)));
    const idToken = `${h}.${p}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), idpKey.privateKey))}`;
    const code = b64url(crypto.randomBytes(16));
    idpCodes.set(code, idToken);
    res.writeHead(302, { Location: `${q.get("redirect_uri")}?code=${code}&state=${encodeURIComponent(q.get("state") || "")}` });
    return res.end();
  }
  if (u.pathname.endsWith("/token")) {
    let raw = ""; for await (const c of req) raw += c;
    const code = new URLSearchParams(raw).get("code");
    const tok = idpCodes.get(code); idpCodes.delete(code);
    res.writeHead(tok ? 200 : 400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(tok ? { id_token: tok, token_type: "Bearer" } : { error: "invalid_grant" }));
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => idp.listen(IDP_PORT, "127.0.0.1", r));
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer());
  let j = {}; try { j = JSON.parse(buf.toString("utf8")); } catch {} return { status: r.status, body: j, buf };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Plan", "Sign", "77!"].join("-");
const stamp = Date.now(), now = new Date().toISOString(), today = now.slice(0, 10);

// A made-up lab, its owner, and its medical director (a member with edit on VeritaCheck)
const register = async (tag, name) => {
  const email = `vsui-${tag}-${stamp}@example.com`;
  const token = (await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true })).body.token;
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
  return { email, token, name, id: sql("SELECT id FROM users WHERE email = ?", email).id };
};
const owner = await register("owner", "Avery Owner"), md = await register("director", "Jordan Ellis, MD");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "Example Hospital Laboratory", plan: "hospital" })).body.labId;
// A made-up CLIA number, new on each run (labs.clia_number is unique).
const clia = `00D${String(stamp).slice(-7)}`;
sql("UPDATE labs SET is_demo = 0, clia_number = ?, medical_director_email = ?, medical_director_name = 'Jordan Ellis, MD' WHERE id = ?", clia, md.email, labId);
sql("UPDATE users SET clia_number = ?, clia_lab_name = 'Example Hospital Laboratory' WHERE id = ?", clia, owner.id);
sql("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)", labId, md.id, now, now, now);
sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'view_only')", owner.id, md.email, md.id, now, now, JSON.stringify({ mode: "view_all" }), `vsui-${stamp}`, labId);
const map = Number(sql("INSERT INTO veritamap_maps (user_id, lab_id, name, instruments, created_at, updated_at) VALUES (?, ?, 'Made-up map', '[]', ?, ?)", owner.id, labId, now, now).lastInsertRowid);
for (const a of ["Glucose", "Sodium", "ALT"]) sql("INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, active, updated_at) VALUES (?, ?, 'Chemistry', 'MODERATE', 1, ?)", map, a, now);

// The package: accuracy, precision and reportable range for three analytes; method comparison and carryover left out
const L = `/api/labs/${labId}`, V = "/api/veritacheck/verifications";
const vId = (await call("POST", `${L}/veritacheck/verifications`, {
  instrument_name: "CH-500 Chemistry", manufacturer: "Made-up Diagnostics", trigger_type: "new_instrument", elements: ["accuracy", "precision", "reportable_range"],
  element_reasons: { reference_interval: "Transferred from the analyzer in use", method_comparison: "First of this type in the lab", carryover: "Closed tube sampling, manufacturer's claim reviewed" },
}, owner.token)).body.id;
const ids = {};
for (const a of ["Glucose", "Sodium", "ALT"]) ids[a] = (await call("POST", `${V}/${vId}/analytes`, { analyte_name: a }, owner.token)).body.id;
await call("POST", `${V}/${vId}/instruments`, { serial_number: "0001-TEST" }, owner.token);
await call("PUT", `${V}/${vId}/plan`, { rows: [
  { element: "accuracy", analyte_ids: null, tested: "Glucose, sodium and ALT against the analyzer in use", criterion: "Lab-defined: glucose 8%, sodium 3 mmol/L, ALT 12%", specimens: "20 patient specimens each" },
  { element: "precision", analyte_ids: null, tested: "Two control levels, 5 days by 5 replicates", criterion: "2 SD within the limits above", specimens: "25 per level" },
  { element: "reportable_range", analyte_ids: null, tested: "Low to high of the manufacturer's claim", criterion: "Each level's mean within the limits above", specimens: "5 levels, 3 each" },
] }, owner.token);

// Made-up studies: one per element and analyte, signed by the director; one precision study run before the plan was signed
const points = JSON.stringify([[120, 121], [140, 139], [160, 161]].map(([e, s], i) => ({ level: i + 1, expectedValue: e, instrumentValues: { "CH-500 Chemistry": s } })));
const studyIds = [];
for (const el of ["accuracy", "precision", "reportable_range"]) for (const a of ["Glucose", "Sodium", "ALT"]) {
  const date = el === "precision" && a === "Glucose" ? "2026-11-20" : today;
  const sid = Number(sql("INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at) VALUES (?, ?, ?, 'CH-500 Chemistry', 'Ann Alyst', ?, 'cal_ver', 4, 0, 'mmol/L', ?, '[\"CH-500 Chemistry\"]', 'pass', ?)",
    owner.id, labId, a, date, points, now).lastInsertRowid);
  studyIds.push(sid);
  const slot = sql("SELECT id FROM veritacheck_verification_studies WHERE verification_id = ? AND element = ? AND analyte_id = ?", vId, el, ids[a]);
  await call("PATCH", `${V}/${vId}/studies/${slot.id}`, { study_id: sid, passed: 1, sample_count: 20 }, owner.token);
}

const browser = await chromium.launch();
const openAs = async (who, tab, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1200, height: 900 }, colorScheme: opts.dark ? "dark" : "light", bypassCSP: true });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message || e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text().slice(0, 400)); });
  await page.route((url) => url.origin !== new URL(BASE).origin, (route) => route.abort());
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, who.token]);
  await page.evaluate(([t, u, l, dark]) => {
    localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l));
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [who.token, me, labId, !!opts.dark]);
  await page.goto(`${BASE}/labs/${labId}/dashboard/verifications?verification=${vId}`, { waitUntil: "networkidle" });
  await page.getByTestId(`tab-${tab}`).click({ timeout: 20000 }).catch(async (e) => {
    // Keep what the page showed, for the report, then fail as before.
    await page.screenshot({ path: `${OUT}/failed_open_${tab}.png`, fullPage: true }).catch(() => {});
    console.log(`open failed at ${page.url()}: ${(await page.locator("body").innerText().catch(() => "")).slice(0, 300).replace(/\s+/g, " ")} | errors: ${pageErrors.join(" || ")}`);
    throw e;
  });
  await page.waitForTimeout(400); // the tabs' color transition
  return page;
};
const fill = async (page, prefix, name, password) => {
  await page.getByTestId(`${prefix}-name`).fill(name);
  await page.getByTestId(`${prefix}-password`).fill(password);
};

try {
  // U1. The plan
  const p = await openAs(md, "plan");
  await p.getByTestId("plan-sign-card").waitFor({ timeout: 20000 });
  const card = await p.getByTestId("plan-sign-card").innerText();
  check("U1. the plan is unsigned, says who can sign, and the director (a view-only seat) signs as the medical director", (await p.getByTestId("plan-not-signed-chip").isVisible()) && /Can sign: Jordan Ellis, MD \(Medical director\)/.test(card) && (await p.getByTestId("plan-sign-as").inputValue()) === "Medical director", card);
  check("U1. the view-only director can't edit the plan, only sign it", !(await p.getByTestId("plan-save").count()) && sql("SELECT seat_type FROM user_seats WHERE seat_user_id = ?", md.id).seat_type === "view_only");
  await p.screenshot({ path: `${OUT}/verification_plan_light.png`, fullPage: true });
  await fill(p, "plan-sign", md.name, pw);
  await p.getByTestId("plan-sign-submit").click();
  await p.getByTestId("plan-signed").waitFor({ timeout: 15000 });
  check("U1. signed: the screen and the record say so", /Signed .* by Jordan Ellis, MD, Medical director, with name and password/.test(await p.getByTestId("plan-signed").innerText()) && !!sql("SELECT signed_at FROM veritacheck_verification_plans WHERE verification_id = ?", vId).signed_at);

  // U2. Testing before the plan
  await p.getByTestId("tab-elements").click();
  const notice = await p.getByTestId("before-plan-notice").innerText();
  check("U2. the study run before the plan was signed is marked", /Precision, Glucose/.test(notice) && /11\/20\/2026/.test(notice) && /Before the plan was signed/.test(notice), notice);

  // Every study is signed by the director (as the study screen does)
  for (const sid of studyIds) await call("POST", `${L}/studies/${sid}/finalize`, { signature: md.name, password: pw, decision: "accepted" }, md.token);

  // U3. The package
  const a = await openAs(md, "director");
  await a.getByTestId("package-sign-card").waitFor({ timeout: 20000 });
  const covers = await a.getByTestId("approval-tab").innerText();
  check("U3. what the signature covers: the plan, 9 of 9 studies, the one before the plan, what was left out, the unit, the fingerprint", /9 of 9 signed, 9 pass/.test(covers) && /Precision, Glucose, 11\/20\/2026/.test(covers) && /Reference Range, Method Comparison, Carryover \(reasons given\)/.test(covers) && /S\/N 0001-TEST/.test(covers) && /made by the server/.test(covers), covers.slice(0, 600));
  check("U3. nothing is chosen for the signer", !(await a.getByTestId("package-sign-accepted").locator("input").isChecked()) && !(await a.getByTestId("package-sign-not_accepted").locator("input").isChecked()));
  await a.getByTestId("package-sign-accepted").click();
  await fill(a, "package-sign", md.name, "not-the-password");
  await a.getByTestId("package-sign-submit").click();
  await a.getByTestId("package-sign-error").waitFor({ timeout: 15000 });
  check("U3. a wrong password is refused in words and nothing is recorded", /Password incorrect; signature not recorded/.test(await a.getByTestId("package-sign-error").innerText()) && !sql("SELECT id FROM veritacheck_verification_signatures WHERE verification_id = ?", vId));
  await a.screenshot({ path: `${OUT}/verification_approval_light.png`, fullPage: true });
  await a.getByTestId("package-sign-password").fill(pw);
  await a.getByTestId("package-sign-title").fill("Medical director");
  await a.getByTestId("package-sign-submit").click();
  await a.getByTestId("package-signed").waitFor({ timeout: 15000 });
  const sig = sql("SELECT decision, capacity, signed_with FROM veritacheck_verification_signatures WHERE verification_id = ?", vId);
  check("U3. the director signs the package: Accepted, as the medical director, with name and password", /Signed\..*Jordan Ellis, MD, Medical director, with name and password: Accepted for patient testing/.test(await a.getByTestId("package-signed").innerText()) && sig?.decision === "accepted" && sig.capacity === "medical_director" && sig.signed_with === "password", JSON.stringify(sig));
  await a.screenshot({ path: `${OUT}/verification_signed_light.png`, fullPage: true });

  // A second package, not signed yet, so the signing form shows
  const v2 = (await call("POST", `${L}/veritacheck/verifications`, { instrument_name: "CH-500 Chemistry, unit 2", trigger_type: "second_unit", elements: ["precision"], element_reasons: { accuracy: "Same lot and model as unit 1", reportable_range: "Same as unit 1", reference_interval: "Same as unit 1", method_comparison: "Same as unit 1", carryover: "Same as unit 1" } }, owner.token)).body.id;
  await call("POST", `${V}/${v2}/analytes`, { analyte_name: "Glucose" }, owner.token);
  await call("PUT", `${V}/${v2}/plan`, { rows: [{ element: "precision", analyte_ids: null, tested: "Two control levels, 5 days by 5 replicates", criterion: "2 SD within the limits", specimens: "25 per level" }] }, owner.token);
  const openV2 = async (who, opts) => {
    const page = await openAs(who, "director", opts);
    await page.goto(`${BASE}/labs/${labId}/dashboard/verifications?verification=${v2}`, { waitUntil: "networkidle" });
    await page.getByTestId("tab-director").click();
    await page.getByTestId("package-sign-card").waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    return page;
  };

  // U4. The owner by ownership alone
  const o = await openV2(owner);
  const ownerAs = await o.getByTestId("package-sign-as").inputValue();
  const ownerWhy = await o.getByTestId("package-sign-cannot").innerText();
  check("U4. the owner isn't the director or a designee: Not able to sign, and why", ownerAs === "Not able to sign" && /Only the medical director, or someone named in a signed Letter of Delegation for verifying test method performance, can sign it/.test(ownerWhy) && await o.getByTestId("package-sign-submit").isDisabled(), `${ownerAs} | ${ownerWhy}`);

  // U5. Dark mode and phone width
  const d = await openV2(md, { dark: true });
  const bg = await d.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("U5. dark mode renders dark", /rgb\((\d+), (\d+), (\d+)\)/.test(bg) && bg.match(/\d+/g).slice(0, 3).every((n) => Number(n) < 80), bg);
  await d.screenshot({ path: `${OUT}/verification_approval_dark.png`, fullPage: true });
  const dp = await openAs(md, "plan", { dark: true });
  await dp.getByTestId("plan-tab").waitFor({ timeout: 20000 });
  await dp.screenshot({ path: `${OUT}/verification_plan_dark.png`, fullPage: true });
  const ph = await openV2(md, { viewport: { width: 390, height: 844 } });
  const fits = await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check("U5. at phone width nothing runs off the page", fits, String(await ph.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])));
  await ph.screenshot({ path: `${OUT}/verification_approval_phone.png`, fullPage: true });
  const pp = await openAs(md, "plan", { viewport: { width: 390, height: 844 } });
  await pp.getByTestId("plan-tab").waitFor({ timeout: 20000 });
  check("U5. the plan at phone width fits too", await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await pp.screenshot({ path: `${OUT}/verification_plan_phone.png`, fullPage: true });

  // U7. The other way to sign: a designee whose domain requires the hospital's sign-in signs package 2.
  // A made-up hospital domain, new on each run (a domain whose sign-in is required can't register with a password again).
  const hDomain = `vsui-${stamp}.test`;
  const hEmail = `alice@${hDomain}`;
  const hReg = (await call("POST", "/api/auth/register", { email: hEmail, password: pw, name: "Alice Tran", hipaa_acknowledged: true })).body;
  const alice = { email: hEmail, name: "Alice Tran", id: sql("SELECT id FROM users WHERE email = ?", hEmail).id };
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE id = ?", alice.id);
  sql("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)", labId, alice.id, now, now, now);
  sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'active')", owner.id, hEmail, alice.id, now, now, JSON.stringify({ mode: "edit_all" }), `vsui-alice-${stamp}`, labId);
  sql("INSERT INTO director_delegations (lab_id, delegate_user_id, delegate_name, position, complexity_scope, responsibilities_json, signed_by_user_id, signed_name, signed_at, status, created_at, updated_at) VALUES (?, ?, 'Alice Tran', 'technical_supervisor', 'high', ?, ?, 'Jordan Ellis, MD', ?, 'active', ?, ?)", labId, alice.id, JSON.stringify({ verify_method: true }), md.id, now, now, now);
  alice.token = hReg.token; // her sign-up session (a second sign-in would wait on the one-session rule)
  const cfg = await call("POST", "/api/admin/sso/configs", { secret: ADMIN, name: HOSPITAL, issuer: ISSUER, clientId: CLIENT_ID, emailDomains: [hDomain], required: true });
  // Package 2 made ready: its plan signed and its one study signed, both by the director with a password.
  const s2 = (await call("GET", `${V}/${v2}/signing`, undefined, md.token)).body;
  const plan2 = await call("POST", `${V}/${v2}/plan/sign`, { signature: md.name, password: pw, expect_rows_hash: s2.plan.rows_hash }, md.token);
  const st2 = Number(sql("INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at) VALUES (?, ?, 'Glucose', 'CH-500 Chemistry', 'Ann Alyst', ?, 'cal_ver', 4, 0, 'mmol/L', ?, '[\"CH-500 Chemistry\"]', 'pass', ?)", owner.id, labId, today, points, now).lastInsertRowid);
  const slot2 = sql("SELECT id FROM veritacheck_verification_studies WHERE verification_id = ? AND element = 'precision' AND analyte_id IS NOT NULL", v2);
  await call("PATCH", `${V}/${v2}/studies/${slot2.id}`, { study_id: st2, passed: 1, sample_count: 25 }, owner.token);
  const sign2 = await call("POST", `${L}/studies/${st2}/finalize`, { signature: md.name, password: pw, decision: "accepted" }, md.token);
  check("U7. setup: a designee on the hospital's required sign-in, package 2's plan and study signed", cfg.status === 200 && plan2.status === 200 && sign2.status === 200 && !!alice.token, `${cfg.status} ${JSON.stringify(cfg.body).slice(0, 120)} ${plan2.status} ${sign2.status}`);
  for (const [scheme, width, tag] of [["dark", 1200, "dark"], ["light", 390, "phone"]]) {
    const hp = await openV2(alice, { dark: scheme === "dark", viewport: { width, height: 900 } });
    const btn = hp.getByTestId("package-sign-hospital");
    await btn.waitFor({ timeout: 15000 });
    check(`U7. ${tag}: Sign with ${HOSPITAL}, no password field, Sign package waits for it, nothing runs off the page`, (await btn.innerText()).includes(`Sign with ${HOSPITAL}`) && (await hp.getByTestId("package-sign-password").count()) === 0 && await hp.getByTestId("package-sign-submit").isDisabled() && await hp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await hp.screenshot({ path: `${OUT}/verification_hospital_${tag}.png`, fullPage: true });
    await hp.context().close();
  }
  const h = await openV2(alice, {});
  check("U7. she signs as the designee", (await h.getByTestId("package-sign-as").inputValue()) === "Designee, Technical Supervisor (high complexity)");
  await h.getByTestId("package-sign-accepted").click();
  await h.getByTestId("package-sign-name").fill(alice.name);
  const [popup] = await Promise.all([h.waitForEvent("popup"), h.getByTestId("package-sign-hospital").click()]);
  await h.getByTestId("package-sign-hospital-done").waitFor({ timeout: 20000 });
  check("U7. the hospital was asked for a fresh login for her, and the prompt says it's done", asked.some((a) => a.prompt === "login" && a.max_age === "0" && a.login_hint === hEmail) && !(await h.getByTestId("package-sign-submit").isDisabled()), JSON.stringify(asked));
  await popup.waitForEvent("close", { timeout: 5000 }).catch(() => {});
  await h.screenshot({ path: `${OUT}/verification_hospital_done_light.png`, fullPage: true });
  await h.getByTestId("package-sign-submit").click();
  await h.getByTestId("package-signed").waitFor({ timeout: 15000 });
  const hsig = sql("SELECT decision, capacity, signed_with, signed_with_provider, typed_signature FROM veritacheck_verification_signatures WHERE verification_id = ?", v2);
  check("U7. package 2 is signed with the hospital's sign-in: sso, the hospital's name, the designee, Accepted", hsig?.signed_with === "sso" && hsig.signed_with_provider === HOSPITAL && hsig.capacity === "designee" && hsig.decision === "accepted" && hsig.typed_signature === alice.name && /with Example Hospital sign-in/.test(await h.getByTestId("package-signed").innerText()), JSON.stringify(hsig));
  await h.screenshot({ path: `${OUT}/verification_hospital_signed_light.png`, fullPage: true });
  const pdf2 = await call("POST", `${V}/${v2}/pdf`, {}, owner.token);
  fs.writeFileSync(`${OUT}/verification_package_hospital.pdf`, pdf2.buf);

  // U6. The package PDF
  const pdf = await call("POST", `${V}/${vId}/pdf`, {}, owner.token);
  fs.writeFileSync(`${OUT}/verification_package.pdf`, pdf.buf);
  check("U6. the package PDF is made", pdf.status === 200 && pdf.buf.length > 1000, String(pdf.status));
  fs.writeFileSync(`${OUT}/verification_ids.json`, JSON.stringify({ labId, vId, studyIds }));
} catch (e) { check("ran to the end", false, String(e?.stack || e).slice(0, 800)); }
await browser.close();
idp.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
