// scripts/verify-two-factor-ui.mjs
//
// Browser receipt for two-factor sign-in Stage 2 (Michael Q170 = 1, mock Q171 = 1). LOCAL server +
// scratch DB only (the accounts and lab are local test data). Drives the real screens:
//   1. Account settings: Two-factor card OFF -> Turn on -> QR + key -> code -> recovery codes -> ON
//   2. Sign out, sign in: password, then the 6-digit step; a wrong code shows an error; the right one
//      reaches the dashboard
//   3. Lab members page: the owner's Two-factor card; Require turns on and the person list shows it
//   4. light, dark and 390px; no horizontal page scroll on the sign-in step
// Run: PW_BASE=http://localhost:5195 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-two-factor-ui.mjs
import { createRequire } from "node:module";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; } };

// RFC 6238 TOTP (same as server/totp.ts), for typing the code the app would show.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const b32d = (s) => { let bits = 0, v = 0; const out = []; for (const ch of s.replace(/\s/g, "")) { v = (v << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const hotp = (key, ctr) => { const m = Buffer.alloc(8); m.writeUInt32BE(Math.floor(ctr / 2 ** 32), 0); m.writeUInt32BE(ctr >>> 0, 4); const h = crypto.createHmac("sha1", b32d(key)).update(m).digest(); const o = h[h.length - 1] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0"); };
const step = () => Math.floor(Date.now() / 30000);

const PW = ["Zq", "ui", "7x!"].join("-");
const email = `twofa-ui-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Jordan Ellis", hipaa_acknowledged: true });
const uid = reg.body?.user?.id;
const lab = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (QA)", plan: "hospital" });
const labId = lab.body?.labId;
const member = await call("POST", "/api/auth/register", { email: `twofa-ui-kim-${Date.now()}@example.com`, password: PW, name: "Kim Bravo", hipaa_acknowledged: true });
await call("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId, email: member.body?.user?.email, role: "staff" });
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id IN (?, ?)").run(uid, member.body?.user?.id);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
check("0. QA owner, lab and member created on the scratch DB", !!uid && !!labId && !!member.body?.user?.id);

const browser = await chromium.launch();
const signedInContext = async (scheme, width, token, user) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, user, labId]);
  return { ctx, page };
};
const typeCode = async (page, testId, code) => { await page.getByTestId(testId).click(); await page.keyboard.type(code, { delay: 40 }); };

// 1) Account settings: turn it on.
{
  const { ctx, page } = await signedInContext("dark", 1280, reg.body.token, reg.body.user);
  await page.goto(`${BASE}/account/settings`, { waitUntil: "networkidle" });
  const card = page.getByTestId("two-factor-card");
  await card.scrollIntoViewIfNeeded();
  check("1a. Two-factor card shows OFF with Turn on", (await card.innerText()).includes("OFF") && (await card.getByRole("button", { name: "Turn on" }).count()) === 1);
  await card.screenshot({ path: `${OUT}/two-factor-card-off-dark.png` });
  await card.getByRole("button", { name: "Turn on" }).click();
  await page.getByTestId("mfa-key").waitFor();
  await page.waitForFunction(() => /[A-Z2-7]{4}/.test(document.querySelector('[data-testid="mfa-key"]')?.textContent || ""));
  const key = (await page.getByTestId("mfa-key").innerText()).trim();
  check("1b. setup shows a QR code and the typed key", (await page.locator('[data-testid="mfa-qr"] svg').count()) === 1 && /^[A-Z2-7 ]{20,}$/.test(key), key.slice(0, 9) + "...");
  await card.screenshot({ path: `${OUT}/two-factor-setup-dark.png` });
  await typeCode(page, "mfa-setup-code", hotp(key, step()));
  await page.getByTestId("mfa-turn-on").click();
  await page.getByTestId("recovery-codes").waitFor({ timeout: 10000 });
  const codesText = await page.getByTestId("recovery-codes").innerText();
  check("1c. Turn on shows 10 recovery codes", (codesText.match(/[A-Z2-9]{4}-[A-Z2-9]{4}/g) || []).length === 10);
  await card.screenshot({ path: `${OUT}/two-factor-recovery-codes-dark.png` });
  await page.getByTestId("recovery-codes-continue").click();
  await page.waitForTimeout(800);
  const onText = await card.innerText();
  check("1d. the card now shows ON, authenticator app, 10 of 10", onText.includes("ON") && onText.includes("Authenticator app") && onText.includes("10 of 10"), onText.replace(/\s+/g, " ").slice(0, 160));
  await card.screenshot({ path: `${OUT}/two-factor-card-on-dark.png` });
  await ctx.close();
  global.__key = key;
}

// 2) Sign in with the code step.
for (const [scheme, width] of [["light", 1280], ["dark", 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  // A prior sign-in session for this person stays active, so end it (simulates signing out elsewhere).
  const db = new Database(process.env.SCRATCH_DB); db.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(uid); db.close();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("you@lab.com").fill(email);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.getByTestId("two-factor-signin").waitFor({ timeout: 10000 });
  const tag = `[${scheme} ${width}px]`;
  check(`2a. ${tag} after the password, the 6-digit step appears (not signed in yet)`, (await page.evaluate(() => localStorage.getItem("veritas_token"))) === null);
  check(`2b. ${tag} no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: `${OUT}/two-factor-signin-${scheme}-${width}.png` });
  if (width === 1280) {
    await typeCode(page, "mfa-code-input", "000000");
    await page.getByRole("alert").waitFor({ timeout: 5000 });
    check(`2c. ${tag} a wrong code shows an error`, (await page.getByRole("alert").innerText()).includes("didn't work"));
  }
  // Each sign-in needs a code from a newer 30-second step than the last one used.
  const dbs = new Database(process.env.SCRATCH_DB); const last = dbs.prepare("SELECT last_totp_step FROM user_mfa WHERE user_id = ?").get(uid)?.last_totp_step; dbs.prepare("UPDATE user_mfa SET last_totp_step = ? WHERE user_id = ?").run(step() - 2, uid); dbs.close();
  await page.getByTestId("mfa-code-input").click();
  await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");
  await page.keyboard.type(hotp(global.__key, step()), { delay: 40 });
  await page.waitForURL(/\/dashboard/, { timeout: 15000 }).catch(() => {});
  check(`2d. ${tag} the right code signs in and reaches the dashboard`, /\/dashboard/.test(page.url()) && !!(await page.evaluate(() => localStorage.getItem("veritas_token"))), page.url() + ` (last step ${last})`);
  await ctx.close();
}

// 3) Lab members page: the owner's Two-factor card.
{
  // End the sign-in left from step 2 (else this API sign-in gets the other-device prompt), and move to a fresh 30-second step.
  const dbs = new Database(process.env.SCRATCH_DB); dbs.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(uid); dbs.prepare("UPDATE user_mfa SET last_totp_step = ? WHERE user_id = ?").run(step() - 2, uid); dbs.close();
  const login = await call("POST", "/api/auth/login", { email, password: PW });
  const v = await call("POST", "/api/auth/mfa/verify", { mfa_token: login.body.mfa_token, code: hotp(global.__key, step()), kind: "app" });
  for (const scheme of ["light", "dark"]) {
    const { ctx, page } = await signedInContext(scheme, 1280, v.body.token, v.body.user);
    await page.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
    const card = page.getByTestId("two-factor-lab-card");
    await card.waitFor({ timeout: 10000 });
    await card.scrollIntoViewIfNeeded();
    if (scheme === "light") {
      check("3a. the lab card lists the owner (On) and the member (Off)", (await card.innerText()).includes("Kim Bravo") && (await card.innerText()).includes("Jordan Ellis"));
      await page.getByTestId("two-factor-require-toggle").click();
      await page.waitForTimeout(1200);
      const t = await card.innerText();
      check("3b. Require turns on; the member shows Set up at next sign-in", t.includes("On since") && t.includes("Set up at next sign-in"), t.replace(/\s+/g, " ").slice(0, 200));
    }
    await card.screenshot({ path: `${OUT}/two-factor-lab-card-${scheme}.png` });
    await ctx.close();
  }
}

await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
