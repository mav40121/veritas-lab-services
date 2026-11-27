// scripts/verify-qc-rule-settings-ui.mjs
//
// Browser receipt: VeritaQC QC rules (B12 part 2, QC rules mock 4). LOCAL server on a scratch DB only; made-up lab, people and
// results. As the lab's owner, who is also its medical director:
//   1. the QC rules screen shows the seven rules and the manufacturer-range row, unlocked, with the starting rules
//   2. changing 2-2s to a warning, 2-2s and R-4s across levels and N-T off shows "Saving a change" with three rows; Save needs a reason
//   3. the save lands in "Every change, kept" and the Laboratory's rules read as changed
//   4. locking takes name and password; the chip then reads "Locked by ..."; a locked change asks for name and password again
//   7. a technical supervisor designee whose hospital requires its sign-in (S0) sees "Sign with Example Hospital" and no password; the
//      hospital sign-in opens in its own window, comes back, and the locked change is saved, recorded as signed with that sign-in
//   5. the VeritaQC run list has a "Judged under" column; a late entry says it was judged under the rules of its own date
//   6. the monthly review PDF downloads (rendered and looked at separately)
//   Screenshots, light and dark, at 1280 and at phone width (390).
// A made-up OpenID Connect provider runs on 127.0.0.1 (as scripts/verify-signature-prompt-ui.mjs does).
// A second run against the same server needs another IDP_PORT: the server keeps the first provider keys for its issuer.
// Run: PW_BASE=http://localhost:5251 SCRATCH_DB=<db> OUT=<dir> IDP_PORT=<free port> node scripts/verify-qc-rule-settings-ui.mjs
import fs from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; }
};
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ── A made-up OpenID Connect provider: signs in whoever the login hint names, at once, with auth_time now ──
const IDP_PORT = Number(process.env.IDP_PORT || 5392);
const key = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...key.publicKey.export({ format: "jwk" }), kid: "qc1", alg: "RS256", use: "sig" };
const ISSUER = `http://127.0.0.1:${IDP_PORT}/tenant/v2.0`;
const CLIENT_ID = "client-qc-rules";
const HOSPITAL = "Example Hospital";
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
    const h = b64url(Buffer.from(JSON.stringify({ alg: "RS256", kid: "qc1", typ: "JWT" }))), p = b64url(Buffer.from(JSON.stringify(payload)));
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

const email = `qc-rules-ui-${Date.now()}@example.com`;
const PW = ["Zq", "rules", "7x!"].join("-");
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Jordan Ellis, MD", hipaa_acknowledged: true });
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Sample Regional Medical Center (QC rules QA)", plan: "hospital" })).body?.labId;
{
  const d = new Database(process.env.SCRATCH_DB);
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(reg.body?.user?.id);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, medical_director_email = ?, clia_number = ? WHERE id = ?").run(email, `99D${String(Date.now()).slice(-7)}`, lab);
  d.close();
}
const T = reg.body.token, L = `/api/labs/${lab}`;
check("0. QA owner (the lab's medical director) and lab", !!lab && !!T);
const mkLot = async (analyte, level, mean, sd) => (await call("POST", `${L}/qc/control-lots`, { analyte, level, lot_number: `${analyte.slice(0, 2).toUpperCase()}-${level.slice(-1)}-4471`, mfr_mean: mean, mfr_sd: sd, manufacturer: "Made-up Controls" }, T)).body.lot.id;
const na1 = await mkLot("Sodium", "Level 1", 140, 1);
const na2 = await mkLot("Sodium", "Level 2", 140, 1);
await mkLot("Glucose", "Level 1", 100, 2);
await mkLot("Potassium", "Level 1", 4, 0.1);
const today = (await call("GET", `${L}/qc/rule-settings`, undefined, T)).body.today;
for (const [v, d] of [[142.2, -3], [142.4, -2]]) await call("POST", `${L}/qc/results`, { control_lot_id: na2, result_value: v, result_date: addDays(today, d), instrument: "CH-500 Chemistry" }, T);
const DOMAIN = `qc${String(Date.now()).slice(-6)}.test`;
const alice = { email: `alice@${DOMAIN}`, name: "Alice Tran" };
{
  const r = (await call("POST", "/api/auth/register", { email: alice.email, password: PW, name: alice.name, hipaa_acknowledged: true })).body;
  const now = new Date().toISOString();
  const d = new Database(process.env.SCRATCH_DB);
  d.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'staff','active',1,?,?,?)").run(lab, r.user.id, now, now, now);
  d.prepare("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(lab, r.user.id);
  d.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type)
    VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all"}', ?, ?, 'active')`).run(reg.body.user.id, alice.email, r.user.id, now, now, `qc-rules-alice-${Date.now()}`, lab);
  // A signed Letter of Delegation naming the QA and QC programs duty, as a technical supervisor.
  d.prepare("INSERT INTO director_delegations (lab_id, delegate_user_id, delegate_name, position, complexity_scope, responsibilities_json, status, signed_at, created_at, updated_at) VALUES (?, ?, ?, 'technical_supervisor', 'high', ?, 'active', ?, ?, ?)")
    .run(lab, r.user.id, alice.name, JSON.stringify({ qc_program: true }), now, now, now);
  d.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(r.user.id);
  d.close();
  const login = (await call("POST", "/api/auth/login", { email: alice.email, password: PW })).body;
  alice.id = r.user.id; alice.token = login.token; alice.user = login.user;
}
const cfg = await call("POST", "/api/admin/sso/configs", { secret: ADMIN, name: HOSPITAL, issuer: ISSUER, clientId: CLIENT_ID, emailDomains: [DOMAIN], required: true });
check("0. a technical supervisor designee whose hospital requires its sign-in", !!alice.token && cfg.status === 200, JSON.stringify(cfg.body).slice(0, 120));

const browser = await chromium.launch();
const open = async (scheme, width, path, height = path.endsWith("/rules") ? 2400 : 900, who = { token: T, user: reg.body.user }) => {
  // The rules screen is opened tall, so a screenshot of it needs no scrolling (the site header is sticky).
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true }));
    localStorage.setItem("veritas_active_lab_id", String(l));
    if (document.documentElement) document.documentElement.classList.toggle("dark", false);
  }, [who.token, who.user, lab]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return { ctx, page };
};
// The page's own content (the site header is sticky, so a full-page capture would paint it over the middle).
const shot = async (page, name) => {
  await page.waitForTimeout(600);
  const root = page.getByTestId("qc-rules-page");
  if (await root.count()) await root.screenshot({ path: `${OUT}/${name}.png` });
  else await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
};

{
  const { ctx, page } = await open("light", 1280, `/labs/${lab}/veritaqc-app/rules`);
  await page.getByTestId("qc-rules-table").waitFor({ timeout: 30000 });
  const rows = await page.locator('[data-testid^="qc-rule-row-"]').count();
  check("1. seven rules and the lock chip reads Unlocked", rows === 7 && (await page.getByTestId("qc-rules-lock-chip").innerText()).includes("Unlocked"), `${rows}`);
  check("1. the manufacturer-range row is there, as set now", await page.getByText("Outside the manufacturer's range").isVisible());
  check("1. 2-2s starts as a rejection", (await page.getByTestId("qc-rule-2-2s-rejection").getAttribute("aria-pressed")) === "true");
  await page.getByTestId("qc-rule-2-2s-warning").click();
  await page.getByTestId("qc-rule-2-2s-across").click();
  await page.getByTestId("qc-rule-R-4s-across").click();
  await page.getByTestId("qc-rule-N-T-on").click();
  const card = page.getByTestId("qc-rules-save-card");
  await card.waitFor({ timeout: 10000 });
  const rowsText = await card.locator("tbody tr").allInnerTexts();
  check("2. Saving a change lists the three changes, was and will be", rowsText.length === 3 && /2-2s\s+Rejection, within a level\s+Warning, within and across levels/.test(rowsText[0]) && /N-T\s+Rejection, 7 in a row\s+Off/.test(rowsText[2]), JSON.stringify(rowsText));
  check("2. Save waits for a reason", await page.getByTestId("qc-rules-save").isDisabled());
  await page.getByTestId("qc-rules-reason").fill("6 months of data reviewed; N-T found no true errors.");
  await shot(page, "qc-rules-saving-light-1280");
  await page.getByTestId("qc-rules-save").click();
  await page.getByTestId("qc-rules-save-card").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const hist = await page.getByTestId("qc-rules-history").innerText();
  check("3. the change is kept with its reason and who", /2-2s Rejection, within a level to Warning, within and across levels/.test(hist) && /6 months of data reviewed/.test(hist) && /Jordan Ellis, MD, medical director/.test(hist), hist.slice(0, 300));
  // Lock, signed.
  await page.getByTestId("qc-lock-open").click();
  await page.getByTestId("qc-lock-reason").fill("Rules approved for use.");
  await page.getByTestId("qc-lock-name").fill("Jordan Ellis, MD");
  await page.getByTestId("qc-lock-password").fill(PW);
  await page.getByTestId("qc-lock-sign").click();
  await page.locator('[data-testid="qc-rules-lock-chip"]:has-text("Locked by")').waitFor({ timeout: 15000 }).catch(() => {});
  check("4. locking takes name and password, and the chip says who", (await page.getByTestId("qc-rules-lock-chip").innerText()).startsWith("Locked by Jordan Ellis, MD"), await page.getByTestId("qc-rules-lock-chip").innerText());
  await page.getByTestId("qc-rule-N-x-n").fill("8");
  await page.getByTestId("qc-rules-save-card").waitFor({ timeout: 10000 });
  check("4. a locked change asks for name and password", await page.getByTestId("qc-rules-name").isVisible() && await page.getByTestId("qc-rules-password").isVisible() && (await page.getByTestId("qc-rules-save").innerText()).includes("Sign and save"));
  await page.getByTestId("qc-rules-reason").fill("Catch a shift sooner.");
  await page.getByTestId("qc-rules-name").fill("Jordan Ellis, MD");
  await page.getByTestId("qc-rules-password").fill(PW);
  await shot(page, "qc-rules-locked-signing-light-1280");
  await page.getByTestId("qc-rules-save").click();
  await page.getByTestId("qc-rules-save-card").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const hist2 = await page.getByTestId("qc-rules-history").innerText();
  check("4. the signed change is kept as name and password", /N-x Rejection, 10 in a row, within a level to Rejection, 8 in a row, within a level/.test(hist2) && /signed with name and password/.test(hist2) && /Locked\./.test(hist2), hist2.slice(0, 400));
  await shot(page, "qc-rules-light-1280");
  await ctx.close();
}
// 7. The designee whose hospital requires its sign-in: dark and phone first (nothing signed), then light, and sign.
const latestVersion = () => { const d = new Database(process.env.SCRATCH_DB, { readonly: true }); const r = d.prepare("SELECT * FROM qc_rule_versions WHERE lab_id = ? ORDER BY id DESC LIMIT 1").get(lab); d.close(); return r; };
const inside = async (loc, width) => { const b = await loc.boundingBox(); return !!b && b.x >= 0 && b.x + b.width <= width + 1; };
for (const [scheme, width] of [["dark", 1280], ["light", 390], ["light", 1280]]) {
  const { ctx, page } = await open(scheme, width, `/labs/${lab}/veritaqc-app/rules`, 2400, alice);
  await page.getByTestId("qc-rules-table").waitFor({ timeout: 30000 });
  await page.getByTestId("qc-rule-N-x-n").fill("9");
  await page.getByTestId("qc-rules-save-card").waitFor({ timeout: 10000 });
  await page.getByTestId("qc-rules-reason").fill("Hospital-signed change.");
  await page.getByTestId("qc-rules-name").fill(alice.name);
  const btn = page.getByTestId("qc-rules-sign-with-hospital");
  await btn.waitFor({ timeout: 10000 }).catch(() => {});
  check(`7. ${scheme} ${width}: Sign with ${HOSPITAL}, no password field, inside the screen`, await btn.isVisible() && (await btn.innerText()).includes(`Sign with ${HOSPITAL}`) && (await page.getByTestId("qc-rules-password").count()) === 0 && (await inside(btn, width)));
  check(`7. ${scheme} ${width}: Sign and save waits for the hospital sign-in`, await page.getByTestId("qc-rules-save").isDisabled());
  if (!(scheme === "light" && width === 1280)) { await shot(page, `qc-rules-hospital-${scheme}-${width}`); await ctx.close(); continue; }
  const [popup] = await Promise.all([page.waitForEvent("popup"), btn.click()]);
  let landed = "";
  try { await popup.waitForURL(/\/sso\/sign-done/, { timeout: 15000 }); landed = popup.url(); } catch { /* it may close first */ }
  await page.getByTestId("qc-rules-sign-with-hospital-done").waitFor({ timeout: 15000 }).catch(() => {});
  check("7. the hospital was asked for a fresh login for her", asked.length === 1 && asked[0].prompt === "login" && asked[0].max_age === "0" && asked[0].login_hint === alice.email, JSON.stringify(asked));
  check("7. the window came back to /sso/sign-done", /\/sso\/sign-done/.test(landed) || popup.isClosed(), landed.replace(/h=[^&]+/, "h=<code>"));
  check("7. the prompt says the sign-in is done, and Sign and save is ready", await page.getByTestId("qc-rules-sign-with-hospital-done").isVisible() && !(await page.getByTestId("qc-rules-save").isDisabled()));
  await shot(page, "qc-rules-hospital-done-light-1280");
  await page.getByTestId("qc-rules-save").click();
  await page.getByTestId("qc-rules-save-card").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  const v = latestVersion();
  check("7. the locked change is saved, signed with her hospital's sign-in", v?.signed === 1 && v?.signed_with === "sso" && v?.signed_with_provider === HOSPITAL && v?.typed_signature === alice.name && v?.capacity === "designee" && /"N-x"[^}]*"n":9/.test(v?.rules_json || ""), JSON.stringify(v).slice(0, 300));
  const hist = await page.getByTestId("qc-rules-history").innerText();
  check("7. Every change, kept says how it was signed", hist.includes(`signed with ${HOSPITAL} sign-in`) && hist.includes("signed with name and password"), hist.slice(0, 300));
  await ctx.close();
}
for (const [scheme, width] of [["dark", 1280], ["light", 390], ["dark", 390]]) {
  const { ctx, page } = await open(scheme, width, `/labs/${lab}/veritaqc-app/rules`);
  await page.getByTestId("qc-rules-table").waitFor({ timeout: 30000 });
  if (width === 390) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`1. ${scheme} ${width}: no sideways scroll of the page`, overflow <= 1, String(overflow));
  }
  await shot(page, `qc-rules-${scheme}-${width}`);
  await ctx.close();
}

// 5. Runs: one dated today (judged under the change), one late entry (judged under the starting rules).
await call("POST", `${L}/qc/results`, { control_lot_id: na2, result_value: 142.1, result_date: today, instrument: "CH-500 Chemistry" }, T);
await call("POST", `${L}/qc/results`, { control_lot_id: na1, result_value: 137.8, result_date: today, run_time: "06:10", instrument: "CH-500 Chemistry" }, T);
const across = await call("POST", `${L}/qc/results`, { control_lot_id: na2, result_value: 142.3, result_date: today, run_time: "06:14", instrument: "CH-500 Chemistry" }, T);
check("5. across levels: the later run is flagged R-4s across, naming the other", across.body.violations?.some((v) => v.rule_code === "R-4s across" && /Level 1, 6:10 AM/.test(v.detail)), JSON.stringify(across.body.violations));
for (const [scheme, width] of [["light", 1280], ["dark", 390]]) {
  const { ctx, page } = await open(scheme, width, `/labs/${lab}/veritaqc-app`);
  await page.getByTestId("qc-control-line").waitFor({ timeout: 30000 });
  // Pick Sodium Level 2 and enter a late run, dated before the change.
  await page.getByTestId("qc-control-line").click();
  await page.getByRole("option", { name: /Sodium.*Level 2/ }).first().click();
  await page.locator("th", { hasText: "Judged under" }).first().waitFor({ timeout: 15000 }).catch(() => {});
  if (scheme === "light") {
    await page.locator("#qc-value").fill("142.5");
    await page.locator("#qc-date").fill(addDays(today, -1));
    await page.getByRole("button", { name: "Submit result" }).click();
    const note = page.getByTestId("qc-judged-note").first();
    await note.waitFor({ timeout: 15000 }).catch(() => {});
    check("5. a late entry says it was judged under the rules of its own date", (await note.isVisible()) && /the starting rules|the rules of/.test(await note.innerText()), (await note.isVisible()) ? await note.innerText() : "no note");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/qc-late-entry-light-1280.png` });
    await page.keyboard.press("Escape");
    const ca = page.getByText("Corrective action required");
    if (await ca.isVisible().catch(() => false)) {
      await page.locator("textarea").first().fill("Recalibrated and reran; made-up QA entry.");
      await page.getByRole("button", { name: /Save corrective action|File corrective action|Save/ }).last().click();
      await page.waitForTimeout(1200);
    }
  }
  const head = await page.locator("th", { hasText: "Judged under" }).count();
  check(`5. ${scheme} ${width}: the run list has a Judged under column`, head === 1);
  await page.locator("th", { hasText: "Judged under" }).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/qc-runs-judged-under-${scheme}-${width}.png` });
  await ctx.close();
}
await browser.close();

// 6. The monthly review PDF (rendered to images and looked at separately).
const ym = today.slice(0, 7);
const pdf = await fetch(`${BASE}${L}/qc/period-reviews/pdf?control_lot_id=${na2}&year=${ym.slice(0, 4)}&month=${Number(ym.slice(5, 7))}`, { headers: { Authorization: `Bearer ${T}` } });
const buf = Buffer.from(await pdf.arrayBuffer());
fs.writeFileSync(`${OUT}/qc-monthly-review-sodium-l2.pdf`, buf);
check("6. the monthly review PDF downloads", pdf.status === 200 && buf.subarray(0, 4).toString() === "%PDF", `${pdf.status} ${buf.length}`);
idp.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
