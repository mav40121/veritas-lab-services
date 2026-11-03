// scripts/verify-terms-gate-ui.mjs
//
// Browser receipt for the Terms of Use and Confidentiality Agreement (Michael 2026-11-03, Q141 = 1; server/termsOfUse.ts,
// client/src/components/TermsAcceptance.tsx). On a local production build with a scratch DB and made-up people:
//   U1. before a version is activated, a signed-in owner works as before (no agreement shown)
//   U2. activating it while that page is open holds the session at the agreement on its next request, with no reload
//       and no sign-out
//   U3. the owner must type a name, agree, and accept for the organization (the lab is named) before "I agree"
//       enables; accepting closes it, records the typed name and the organization acceptance, and the app works again
//   U4. a non-owner sees the agreement on sign-in without the organization box; the no-PHI prompt waits behind it and
//       appears only after the agreement is accepted
//   U5. "Sign out" from the agreement ends the session and goes to the sign-in page
//   U6. public pages are not covered: /terms shows the new text to anyone, and a held person on the home page sees no
//       agreement
//   U7. a brand-new sign-up (onboarding not done) sees only the agreement; the onboarding wizard waits behind it and
//       opens after acceptance (production 2026-11-03 showed the two stacked)
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-terms-gate-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Terms", "Gate", "77!"].join("-");

// A made-up owner with a lab, and a made-up member with no lab.
const ownerEmail = `terms-owner-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Terms Gate Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", ownerEmail);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
const memberEmail = `terms-member-${Date.now()}@example.com`;
const member = await call("POST", "/api/auth/register", { email: memberEmail, password: pw, name: "Morgan Member", hipaa_acknowledged: true });
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?", memberEmail);

const browser = await chromium.launch();
const signIn = async (token) => {
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, token]);
  await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); if (l) localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, me, labId]);
  return page;
};
const dialog = (page) => page.getByTestId("terms-acceptance");

// U1
const op = await signIn(owner.body.token);
await op.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "networkidle" }); await op.waitForTimeout(1200);
check("U1. before activation the owner works as before (no agreement)", (await dialog(op).count()) === 0);

// U2
const VERSION = (await (await fetch(`${BASE}/api/admin/terms/status`, { headers: { "x-admin-secret": ADMIN } })).json()).currentVersion; // the build's own version
const act = await call("POST", "/api/admin/terms/activate", { secret: ADMIN, version: VERSION, dryRun: false });
check("U2. activation (admin) succeeded", act.status === 200 && act.body.dryRun === false, JSON.stringify(act.body));
await op.evaluate(() => { window.history.pushState({}, "", window.location.pathname.replace(/dashboard$/, "veritacheck")); window.dispatchEvent(new PopStateEvent("popstate")); });
await dialog(op).waitFor({ timeout: 15000 }).catch(() => {});
const sessionsOpen = sql("SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = ?) AND is_active = 1", ownerEmail).n;
check("U2. the open session is held at the agreement on its next request, with no reload and still signed in", (await dialog(op).count()) === 1 && sessionsOpen >= 1, `sessions ${sessionsOpen}`);
await op.screenshot({ path: `${OUT}/terms_held_open_session.png` });

// U3
const acceptBtn = op.getByTestId("terms-accept");
const orgText = await op.getByTestId("terms-for-org").locator("xpath=..").innerText().catch(() => "");
check("U3. the owner is asked to accept for the organization, naming the lab", /Terms Gate Lab/.test(orgText), orgText);
await op.getByTestId("terms-signed-name").fill("Riley Owner");
await op.getByTestId("terms-agree").check();
const disabledWithoutOrg = await acceptBtn.isDisabled();
await op.getByTestId("terms-for-org").check();
const enabledWithOrg = await acceptBtn.isEnabled();
check("U3. 'I agree' stays off until the owner also accepts for the organization", disabledWithoutOrg && enabledWithOrg, `${disabledWithoutOrg} ${enabledWithOrg}`);
await op.screenshot({ path: `${OUT}/terms_owner_ready.png` });
await acceptBtn.click();
await dialog(op).waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
const rowO = sql("SELECT signed_name, accepted_for_organization, organization_names FROM terms_acceptances WHERE user_id = (SELECT id FROM users WHERE email = ?)", ownerEmail);
await op.waitForTimeout(1500);
const apiAfter = await op.evaluate(async ([b, l]) => (await fetch(`${b}/api/auth/no-phi-acknowledgment`, { headers: { Authorization: `Bearer ${localStorage.getItem("veritas_token")}`, "X-Active-Lab-Id": String(l) } })).status, [BASE, labId]);
check("U3. accepting closes it, records the typed name and the organization, and the app works again", (await dialog(op).count()) === 0 && rowO?.signed_name === "Riley Owner"
  && rowO?.accepted_for_organization === 1 && /Terms Gate Lab/.test(rowO?.organization_names || "") && apiAfter === 200, JSON.stringify({ rowO, apiAfter }));
await op.screenshot({ path: `${OUT}/terms_owner_after.png` });

// U4 (the member's no-PHI acknowledgment is marked as not their own, so that prompt is due too)
sql("UPDATE users SET hipaa_ack_source = 'on_behalf' WHERE email = ?", memberEmail);
const mp = await signIn(member.body.token);
await mp.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" }); await mp.waitForTimeout(1500);
await dialog(mp).waitFor({ timeout: 15000 }).catch(() => {});
check("U4. a non-owner sees the agreement on sign-in, without the organization box", (await dialog(mp).count()) === 1 && (await mp.getByTestId("terms-for-org").count()) === 0);
check("U4. the no-PHI prompt waits behind the agreement", (await mp.getByTestId("no-phi-acknowledgment").count()) === 0);
await mp.screenshot({ path: `${OUT}/terms_member.png` });
// The same view in dark mode (the app's theme is a class on <html>).
await mp.evaluate(() => document.documentElement.classList.add("dark")); await mp.waitForTimeout(300);
await mp.screenshot({ path: `${OUT}/terms_member_dark.png` });
await mp.evaluate(() => document.documentElement.classList.remove("dark"));
await mp.getByTestId("terms-signed-name").fill("Morgan Member");
await mp.getByTestId("terms-agree").check();
await mp.getByTestId("terms-accept").click();
await mp.getByTestId("no-phi-acknowledgment").waitFor({ timeout: 15000 }).catch(() => {});
check("U4. after accepting, the no-PHI prompt appears", (await dialog(mp).count()) === 0 && (await mp.getByTestId("no-phi-acknowledgment").count()) === 1);

// U5
const third = await call("POST", "/api/auth/register", { email: `terms-third-${Date.now()}@example.com`, password: pw, name: "Sam Third", hipaa_acknowledged: true });
const tp = await signIn(third.body.token);
await tp.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" }); await dialog(tp).waitFor({ timeout: 15000 }).catch(() => {});
await tp.getByTestId("terms-sign-out").click();
await tp.waitForURL(/\/login/, { timeout: 15000 }).catch(() => {});
// Sign-out posts /api/auth/logout without waiting (AuthContext.tsx), so give the request up to 6 s to land.
let thirdActive = 1;
for (let i = 0; i < 12 && thirdActive !== 0; i++) {
  thirdActive = sql("SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email LIKE 'terms-third-%' ORDER BY id DESC LIMIT 1) AND is_active = 1").n;
  if (thirdActive !== 0) await tp.waitForTimeout(500);
}
check("U5. 'Sign out' from the agreement ends the session and goes to the sign-in page", /\/login/.test(tp.url()) && thirdActive === 0, `${tp.url()} active=${thirdActive}`);

// U6
const fourth = await call("POST", "/api/auth/register", { email: `terms-fourth-${Date.now()}@example.com`, password: pw, name: "Jo Fourth", hipaa_acknowledged: true });
const fp = await signIn(fourth.body.token);
await fp.goto(`${BASE}/`, { waitUntil: "domcontentloaded" }); await fp.waitForTimeout(1500);
check("U6. a held person on a public page sees no agreement", (await dialog(fp).count()) === 0);
const pub = await (await browser.newContext({ viewport: { width: 1300, height: 900 } })).newPage();
await pub.goto(`${BASE}/terms`, { waitUntil: "networkidle" }); await pub.waitForTimeout(800);
const termsText = await pub.locator("body").innerText();
check("U6. /terms shows the new agreement to anyone (title, confidentiality, acceptable use, one login per person)",
  /Terms of Use and Confidentiality Agreement/.test(termsText) && /7\. Confidentiality/.test(termsText) && /8\. Acceptable Use/.test(termsText) && /Each login belongs to one person/.test(termsText) && !/—/.test(termsText));
await pub.screenshot({ path: `${OUT}/terms_public_page.png` });

// U7 (onboarding flags left as a fresh sign-up has them)
const fresh = await call("POST", "/api/auth/register", { email: `terms-fresh-${Date.now()}@example.com`, password: pw, name: "Casey Fresh", hipaa_acknowledged: true });
const np = await signIn(fresh.body.token);
await np.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
await dialog(np).waitFor({ timeout: 15000 }).catch(() => {});
await np.waitForTimeout(1500);
const wizard = np.getByText("Is your lab ready for its next inspection?");
check("U7. a brand-new sign-up sees only the agreement (the onboarding wizard waits)", (await dialog(np).count()) === 1 && (await wizard.count()) === 0, `wizard ${await wizard.count()}`);
await np.screenshot({ path: `${OUT}/terms_new_signup.png` });
await np.getByTestId("terms-signed-name").fill("Casey Fresh");
await np.getByTestId("terms-agree").check();
await np.getByTestId("terms-accept").click();
await wizard.waitFor({ timeout: 15000 }).catch(() => {});
check("U7. after accepting, the onboarding wizard opens", (await dialog(np).count()) === 0 && (await wizard.count()) === 1);
await np.screenshot({ path: `${OUT}/terms_new_signup_after.png` });

await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
