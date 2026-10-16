// scripts/verify-two-factor-owner-system-ui.mjs
//
// Browser receipt for the lab owner's whole-system two-factor switch (Michael 2026-10-15, recording 1:
// "if you turn it on as the lab owner, you are turning it on for your entire system. So all of your users
// will be required to have it."). LOCAL server + scratch DB only (the accounts and labs are local test data).
// Drives the real screens:
//   1. Account settings, owner of two labs: the card warns it covers both labs before Turn on
//   2. Turn on (QR, code, recovery codes): the card shows it required for everyone in both labs
//   3. The second lab's Members card: "On for the whole system", switch locked, member set up next sign-in
//   4. The member signs in: password, then first-time setup naming the lab (not signed in yet)
//   5. The owner turns it off (password; the note says it lifts it for everyone); the lab card shows Off
//   6. light, dark and 390px; no horizontal page scroll
// Run: PW_BASE=http://localhost:5195 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-two-factor-owner-system-ui.mjs
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
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };

const PW = ["Zq", "sys", "7x!"].join("-");
const stamp = Date.now();
const email = `twofa-sys-${stamp}@example.com`;
const kimEmail = `twofa-sys-kim-${stamp}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Jordan Ellis", hipaa_acknowledged: true });
const uid = reg.body?.user?.id;
const lab1 = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (QA)", plan: "hospital" })).body?.labId;
const lab2 = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Outpatient Lab (QA)", plan: "hospital" })).body?.labId;
const kim = await call("POST", "/api/auth/register", { email: kimEmail, password: PW, name: "Kim Bravo", hipaa_acknowledged: true });
await call("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId: lab2, email: kimEmail, role: "staff" });
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id IN (?, ?)").run(uid, kim.body?.user?.id);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id IN (?, ?)").run(lab1, lab2);
});
check("0. QA owner with two labs and a member, on the scratch DB", !!uid && !!lab1 && !!lab2 && !!kim.body?.user?.id);

const browser = await chromium.launch();
const signedIn = async (scheme, width, token, user, labId) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, user, labId]);
  return { ctx, page };
};
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// 1-2) Account settings: the owner's warning, then Turn on.
let ownerToken = reg.body.token, ownerUser = reg.body.user, key = "";
{
  const { ctx, page } = await signedIn("light", 1280, ownerToken, ownerUser, lab1);
  await page.goto(`${BASE}/account/settings`, { waitUntil: "networkidle" });
  const card = page.getByTestId("two-factor-card");
  await card.scrollIntoViewIfNeeded();
  const warn = await page.getByTestId("mfa-system-warning").innerText().catch(() => "");
  check("1a. before Turn on, the owner is told it covers both labs and the people in them", warn.includes("As the lab owner") && warn.includes("all 2 of your labs") && warn.includes("Riverside Outpatient Lab (QA)") && warn.includes("1 other person"), warn);
  await card.screenshot({ path: `${OUT}/two-factor-owner-off-light.png` });
  await card.getByRole("button", { name: "Turn on" }).click();
  await page.waitForFunction(() => /[A-Z2-7]{4}/.test(document.querySelector('[data-testid="mfa-key"]')?.textContent || ""));
  key = (await page.getByTestId("mfa-key").innerText()).trim();
  await page.getByTestId("mfa-setup-code").click();
  await page.keyboard.type(hotp(key, step()), { delay: 40 });
  await page.getByTestId("mfa-turn-on").click();
  await page.getByTestId("recovery-codes").waitFor({ timeout: 10000 });
  await page.getByTestId("recovery-codes-continue").click();
  await page.getByTestId("mfa-system-on").waitFor({ timeout: 10000 });
  const on = await card.innerText();
  check("2a. after Turn on, the card shows ON and required for everyone in both labs", on.includes("ON") && on.includes("Required for everyone in all 2 of your labs"), on.replace(/\s+/g, " ").slice(0, 260));
  check("2b. the owner keeps a Turn off button (their switch is the only thing requiring it)", (await card.getByRole("button", { name: "Turn off" }).count()) === 1);
  await card.screenshot({ path: `${OUT}/two-factor-owner-on-light.png` });
  await ctx.close();
  const st = await call("GET", "/api/auth/mfa", undefined, ownerToken);
  check("2c. the server records the owner's whole-system switch", st.body?.systemRequired === true, JSON.stringify({ sys: st.body?.systemRequired }));
}
for (const [scheme, width] of [["dark", 1280], ["light", 390]]) {
  const { ctx, page } = await signedIn(scheme, width, ownerToken, ownerUser, lab1);
  await page.goto(`${BASE}/account/settings`, { waitUntil: "networkidle" });
  const card = page.getByTestId("two-factor-card");
  await card.scrollIntoViewIfNeeded();
  await page.getByTestId("mfa-system-on").waitFor({ timeout: 10000 });
  check(`2d. [${scheme} ${width}px] the owner card renders with no horizontal page scroll`, await noScroll(page));
  await card.screenshot({ path: `${OUT}/two-factor-owner-on-${scheme}-${width}.png` });
  await ctx.close();
}

// 3) The second lab's Members card.
for (const scheme of ["light", "dark"]) {
  const { ctx, page } = await signedIn(scheme, 1280, ownerToken, ownerUser, lab2);
  await page.goto(`${BASE}/labs/${lab2}/members`, { waitUntil: "networkidle" });
  const card = page.getByTestId("two-factor-lab-card");
  await card.waitFor({ timeout: 10000 });
  await card.scrollIntoViewIfNeeded();
  const t = await card.innerText();
  if (scheme === "light") {
    check("3a. the lab card says it is on for the whole system, by the owner", t.includes("On for the whole system: Jordan Ellis turned it on as the lab owner"), t.replace(/\s+/g, " ").slice(0, 220));
    check("3b. the lab's own switch is locked on", (await page.getByTestId("two-factor-require-toggle").getAttribute("aria-checked")) === "true" && await page.getByTestId("two-factor-require-toggle").isDisabled());
    check("3c. the member shows Set up at next sign-in", t.includes("Kim Bravo") && t.includes("Set up at next sign-in"));
  }
  await card.screenshot({ path: `${OUT}/two-factor-owner-lab-card-${scheme}.png` });
  await ctx.close();
}

// 4) The member signs in: password, then first-time setup naming the lab.
{
  scratch((d) => d.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(kim.body.user.id));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("you@lab.com").fill(kimEmail);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.getByTestId("two-factor-setup").waitFor({ timeout: 10000 });
  const s = await page.getByTestId("two-factor-setup").innerText();
  check("4a. the member lands on first-time setup naming the lab, not signed in yet", s.includes("Riverside Outpatient Lab (QA)") && (await page.evaluate(() => localStorage.getItem("veritas_token"))) === null, s.replace(/\s+/g, " ").slice(0, 160));
  await page.screenshot({ path: `${OUT}/two-factor-owner-member-setup-light.png` });
  await ctx.close();
}

// 5) The owner turns it off: the note, the password, and the lab card back to Off.
{
  const { ctx, page } = await signedIn("light", 1280, ownerToken, ownerUser, lab1);
  await page.goto(`${BASE}/account/settings`, { waitUntil: "networkidle" });
  const card = page.getByTestId("two-factor-card");
  await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: "Turn off" }).click();
  const note = await page.getByTestId("mfa-off-system-note").innerText().catch(() => "");
  check("5a. turning it off warns it stops requiring it for everyone in both labs", note.includes("also stops requiring it for everyone in all 2 of your labs"), note);
  await card.screenshot({ path: `${OUT}/two-factor-owner-turn-off-light.png` });
  await page.locator("#mfa-password").fill(PW);
  await card.getByRole("button", { name: "Turn off" }).click();
  await page.getByTestId("mfa-system-warning").waitFor({ timeout: 10000 });
  check("5b. the card is OFF again", (await card.innerText()).includes("OFF"));
  await page.goto(`${BASE}/labs/${lab2}/members`, { waitUntil: "networkidle" });
  const lc = page.getByTestId("two-factor-lab-card");
  await lc.waitFor({ timeout: 10000 });
  const t = await lc.innerText();
  check("5c. the lab card is Off and its switch is free again", t.includes("Off. Anyone can still turn it on") && !(await page.getByTestId("two-factor-require-toggle").isDisabled()), t.replace(/\s+/g, " ").slice(0, 160));
  await ctx.close();
}

await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
