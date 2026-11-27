// scripts/verify-signature-prompt-ui.mjs
//
// Browser receipt: the one signature prompt (S0, 2026-11-27; client/src/components/SignaturePrompt.tsx, server/eSignature.ts).
// LOCAL production build + scratch DB only, with a made-up OpenID Connect provider this script runs on 127.0.0.1. Made-up people and
// documents. On VeritaDC™ My policies, Approve:
//   1. a password user sees the typed name and password as before, signs, and the signature row reads "password"
//   2. a person whose domain requires single sign-on sees "Sign with Example Hospital" and no password field
//   3. that button opens the hospital sign-in in its own window with a fresh login asked for; the window comes back to
//      /sso/sign-done, hands the code back and closes; the prompt says the sign-in is done; Approve signs, and the row reads "sso"
//      with the hospital's name
//   4. light, dark and 390px screenshots of both; no Content-Security-Policy violations
//   5. Approve several (the grid layout): one hospital sign-in signs both documents, each recorded "sso"
// Run: PW_BASE=http://localhost:<port> SCRATCH_DB=<db> OUT=<dir> IDP_PORT=<free port> node scripts/verify-signature-prompt-ui.mjs
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT, IDP_PORT = Number(process.env.IDP_PORT || 5391);
const PW = ["Sign", "ui", "4k!"].join("-");
const HOSPITAL = "Example Hospital";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; }
};
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ── A made-up OpenID Connect provider: signs in whoever the login hint names, at once, with auth_time now ──
const key = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...key.publicKey.export({ format: "jwk" }), kid: "ui1", alg: "RS256", use: "sig" };
const ISSUER = `http://127.0.0.1:${IDP_PORT}/tenant/v2.0`;
const CLIENT_ID = "client-ui";
const codes = new Map();
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
    const h = b64url(Buffer.from(JSON.stringify({ alg: "RS256", kid: "ui1", typ: "JWT" }))), p = b64url(Buffer.from(JSON.stringify(payload)));
    const idToken = `${h}.${p}.${b64url(crypto.sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key.privateKey))}`;
    const code = b64url(crypto.randomBytes(16));
    codes.set(code, idToken);
    res.writeHead(302, { Location: `${q.get("redirect_uri")}?code=${code}&state=${encodeURIComponent(q.get("state") || "")}` });
    return res.end();
  }
  if (u.pathname.endsWith("/token")) {
    let raw = ""; for await (const c of req) raw += c;
    const code = new URLSearchParams(raw).get("code");
    const tok = codes.get(code); codes.delete(code);
    res.writeHead(tok ? 200 : 400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(tok ? { id_token: tok, token_type: "Bearer" } : { error: "invalid_grant" }));
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => idp.listen(IDP_PORT, "127.0.0.1", r));

// ── Setup: one lab, a password user and a hospital user, each with documents waiting on them ──
const now = new Date().toISOString();
const owner = (await call("POST", "/api/auth/register", { email: "sign-ui-owner@owner.test", password: PW, name: "Morgan Example", hipaa_acknowledged: true })).body;
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: "sign-ui-owner@owner.test", labName: "Sample Regional Medical Center (Signature QA)", plan: "hospital", isWarehouse: true })).body?.labId;
const people = {};
for (const [tag, email, name] of [["pat", "pat@plain.test", "Pat Rivera"], ["alice", "alice@hospital.test", "Alice Tran"]]) {
  const reg = (await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true })).body;
  const d = new Database(process.env.SCRATCH_DB);
  d.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,?,'active',1,?,?,?)").run(lab, reg.user.id, "staff", now, now, now);
  d.prepare("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(lab, reg.user.id);
  d.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type)
    VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`).run(owner.user.id, email, reg.user.id, now, now, `sign-ui-${tag}-${Date.now()}`, lab);
  d.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(reg.user.id);
  d.close();
  const login = (await call("POST", "/api/auth/login", { email, password: PW })).body;
  people[tag] = { email, name, id: reg.user.id, token: login.token, user: login.user };
}
{ const d = new Database(process.env.SCRATCH_DB); d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(owner.user.id); d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab); d.close(); }
const P = `/api/labs/${lab}/veritapolicy`;
const docs = {};
for (const tag of ["pat", "alice"]) {
  const w = (await call("POST", `${P}/workflows`, { name: `${people[tag].name} signs` }, owner.token)).body;
  await call("POST", `${P}/workflows/${w.id}/steps`, { stepName: "Supervisor review", requiredRole: "specific_user", specificUserId: people[tag].id }, owner.token);
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from("Made-up procedure text for the signature receipt.\n")], { type: "text/plain" }), "made-up.txt");
  fd.append("title", tag === "pat" ? "Specimen Labeling (made-up)" : "Critical Result Reporting (made-up)");
  const doc = await (await fetch(`${BASE}${P}/documents`, { method: "POST", headers: { Authorization: `Bearer ${owner.token}` }, body: fd })).json();
  await call("POST", `${P}/documents/${doc.id}/submit`, { workflowId: w.id }, owner.token);
  docs[tag] = doc.id;
}
const cfg = await call("POST", "/api/admin/sso/configs", { secret: ADMIN, name: HOSPITAL, issuer: ISSUER, clientId: CLIENT_ID, emailDomains: ["hospital.test"], required: true });
check("0. a lab, a password user, a hospital user, a document waiting on each, and a required hospital sign-in", !!lab && !!people.pat.token && !!people.alice.token && !!docs.pat && !!docs.alice && cfg.status === 200, JSON.stringify(cfg.body).slice(0, 100));

const signoff = (docId, userId) => { const d = new Database(process.env.SCRATCH_DB, { readonly: true }); const r = d.prepare("SELECT signed_with, signed_with_provider, typed_signature FROM policy_signoffs WHERE document_id = ? AND user_id = ? AND action = 'approved'").get(docId, userId); d.close(); return r; };

const browser = await chromium.launch();
const csp = [];
const open = async (who, scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  ctx.on("page", (pg) => pg.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); }));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [who.token, who.user, lab]);
  await page.goto(`${BASE}/labs/${lab}/veritapolicy-app/my-policies`, { waitUntil: "networkidle" });
  const approve = page.getByRole("button", { name: "Approve", exact: true }).first();
  await approve.waitFor({ timeout: 20000 });
  await approve.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 10000 });
  await page.getByTestId("sign-name").waitFor({ timeout: 10000 });
  await page.waitForTimeout(700);
  return { ctx, page, dialog };
};
const inside = async (loc, width) => { const b = await loc.boundingBox(); return !!b && b.x >= 0 && b.x + b.width <= width + 1; };

// 1. Password user: dark and 390 first (no signing), then light and sign.
for (const [scheme, width, tag] of [["dark", 1280, "dark"], ["light", 390, "390"]]) {
  const { ctx, page, dialog } = await open(people.pat, scheme, width);
  check(`1. password user, ${tag}: name and password, no hospital button`, await page.getByTestId("sign-password").isVisible() && (await page.getByTestId("sign-with-hospital").count()) === 0 && (await inside(page.getByTestId("sign-password"), width)));
  await dialog.screenshot({ path: `${OUT}/prompt-password-${tag}.png` });
  await ctx.close();
}
{
  const { ctx, page, dialog } = await open(people.pat, "light", 1280);
  check("1. password user, light: the label reads as before", await page.getByText("Your password (21 CFR Part 11 re-auth)").isVisible() && (await page.getByTestId("sign-name").inputValue()) === people.pat.name);
  await dialog.screenshot({ path: `${OUT}/prompt-password-light.png` });
  await page.getByTestId("sign-password").fill(PW);
  await page.getByTestId("sign-submit").click();
  await page.getByText("All steps complete; policy is now approved.").first().waitFor({ timeout: 15000 }).catch(() => {});
  const row = signoff(docs.pat, people.pat.id);
  check("1. password user signs, and the signature reads password", row?.signed_with === "password" && row?.signed_with_provider === null && row?.typed_signature === people.pat.name, JSON.stringify(row));
  await ctx.close();
}

// 2 and 3. Hospital user.
for (const [scheme, width, tag] of [["dark", 1280, "dark"], ["light", 390, "390"]]) {
  const { ctx, page, dialog } = await open(people.alice, scheme, width);
  const btn = page.getByTestId("sign-with-hospital");
  check(`2. hospital user, ${tag}: Sign with ${HOSPITAL}, no password field`, await btn.isVisible() && (await btn.innerText()).includes(`Sign with ${HOSPITAL}`) && (await page.getByTestId("sign-password").count()) === 0 && (await inside(btn, width)));
  check(`2. hospital user, ${tag}: Approve waits for the hospital sign-in`, await page.getByTestId("sign-submit").isDisabled());
  await dialog.screenshot({ path: `${OUT}/prompt-hospital-${tag}.png` });
  await ctx.close();
}
{
  const { ctx, page, dialog } = await open(people.alice, "light", 1280);
  await dialog.screenshot({ path: `${OUT}/prompt-hospital-light.png` });
  check("2. hospital user, light: the reason line is the step's own", await page.getByText("Your typed name plus a hash of the current version is recorded as your electronic signature for this approval step.").isVisible());
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByTestId("sign-with-hospital").click()]);
  let landed = "";
  try { await popup.waitForURL(/\/sso\/sign-done/, { timeout: 15000 }); landed = popup.url(); await popup.screenshot({ path: `${OUT}/sign-done-window.png` }).catch(() => {}); } catch { /* it may close first */ }
  await page.getByTestId("sign-with-hospital-done").waitFor({ timeout: 15000 }).catch(() => {});
  check("3. the hospital was asked for a fresh login for her", asked.length === 1 && asked[0].prompt === "login" && asked[0].max_age === "0" && asked[0].login_hint === people.alice.email, JSON.stringify(asked));
  check("3. the window came back to /sso/sign-done", /\/sso\/sign-done/.test(landed) || popup.isClosed(), landed.replace(/h=[^&]+/, "h=<code>"));
  check("3. the prompt says the sign-in is done, and Approve is ready", await page.getByTestId("sign-with-hospital-done").isVisible() && !(await page.getByTestId("sign-submit").isDisabled()));
  await popup.waitForEvent("close", { timeout: 5000 }).catch(() => {});
  check("3. the window closed itself", popup.isClosed());
  await dialog.screenshot({ path: `${OUT}/prompt-hospital-done-light.png` });
  await page.getByTestId("sign-submit").click();
  await page.getByText("All steps complete; policy is now approved.").first().waitFor({ timeout: 15000 }).catch(() => {});
  const row = signoff(docs.alice, people.alice.id);
  check("3. she signs, and the signature reads sso with the hospital's name", row?.signed_with === "sso" && row?.signed_with_provider === HOSPITAL && row?.typed_signature === people.alice.name, JSON.stringify(row));
  await ctx.close();
}
// Two more documents waiting on her, for the dark done state and for Approve several.
const more = [];
{
  const w = (await call("POST", `${P}/workflows`, { name: "Alice again" }, owner.token)).body;
  await call("POST", `${P}/workflows/${w.id}/steps`, { stepName: "Supervisor review", requiredRole: "specific_user", specificUserId: people.alice.id }, owner.token);
  for (const title of ["Pipette Check (made-up)", "Chemical Hygiene Plan (made-up)"]) {
    const fd = new FormData();
    fd.append("file", new Blob([Buffer.from(`Made-up procedure: ${title}.\n`)], { type: "text/plain" }), "made-up-2.txt");
    fd.append("title", title);
    const doc = await (await fetch(`${BASE}${P}/documents`, { method: "POST", headers: { Authorization: `Bearer ${owner.token}` }, body: fd })).json();
    await call("POST", `${P}/documents/${doc.id}/submit`, { workflowId: w.id }, owner.token);
    more.push(doc.id);
  }
}
// The done state in dark, screenshot before signing (nothing signed).
{
  const { ctx, page, dialog } = await open(people.alice, "dark", 1280);
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.getByTestId("sign-with-hospital").click()]);
  await page.getByTestId("sign-with-hospital-done").waitFor({ timeout: 15000 }).catch(() => {});
  await popup.waitForEvent("close", { timeout: 5000 }).catch(() => {});
  await page.bringToFront();
  await page.getByRole("heading", { name: "Approve this policy" }).click();
  await page.waitForTimeout(1500);
  check("3. dark: the done line shows and Approve is ready", await page.getByTestId("sign-with-hospital-done").isVisible() && !(await page.getByTestId("sign-submit").isDisabled()));
  await dialog.screenshot({ path: `${OUT}/prompt-hospital-done-dark.png` });
  await ctx.close();
}
// 5. Approve several.
for (const [scheme, width, tag] of [["dark", 390, "dark-390"], ["light", 1280, "light"]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  ctx.on("page", (pg) => pg.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); }));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [people.alice.token, people.alice.user, lab]);
  await page.goto(`${BASE}/labs/${lab}/veritapolicy-app/my-policies`, { waitUntil: "networkidle" });
  await page.getByTestId("bulk-open").click();
  const dialog = page.getByRole("dialog");
  await page.getByTestId("bulk-name").waitFor({ timeout: 10000 });
  const btn = page.getByTestId("bulk-sign-with-hospital");
  check(`5. Approve several, ${tag}: the hospital button in place of the password`, await btn.isVisible() && (await page.getByTestId("bulk-password").count()) === 0 && (await inside(btn, width)));
  await page.waitForTimeout(500);
  await dialog.screenshot({ path: `${OUT}/bulk-hospital-${tag}.png` });
  if (tag !== "light") { await ctx.close(); continue; }
  await page.getByTestId("bulk-all").click();
  const [popup] = await Promise.all([page.waitForEvent("popup"), btn.click()]);
  await page.getByTestId("bulk-sign-with-hospital-done").waitFor({ timeout: 15000 }).catch(() => {});
  await popup.waitForEvent("close", { timeout: 5000 }).catch(() => {});
  await dialog.screenshot({ path: `${OUT}/bulk-hospital-done-light.png` });
  await page.getByTestId("bulk-sign").click();
  await page.getByTestId("bulk-summary").waitFor({ timeout: 15000 }).catch(() => {});
  const rows = more.map((id) => signoff(id, people.alice.id));
  check("5. one hospital sign-in signs both, each recorded sso", /2 documents signed/.test(await page.getByTestId("bulk-summary").innerText().catch(() => "")) && rows.every((r) => r?.signed_with === "sso" && r?.signed_with_provider === HOSPITAL), JSON.stringify(rows));
  await ctx.close();
}
check("4. no Content-Security-Policy violations", csp.length === 0, csp.slice(0, 2).join(" | "));
await browser.close();
idp.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
