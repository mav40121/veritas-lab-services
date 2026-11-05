// scripts/verify-email-verification-ui.mjs
// Gate 3 receipt for email verification at sign-up (Michael 2026-11-05). Run against a LOCAL server started with EMAIL_VERIFICATION=on on a
// scratch database. It writes a known link code to SCRATCH_DB, so never point it at production. Usage:
//   EMAIL_VERIFICATION=on PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-email-verification-ui.mjs
// In a real browser: signing up shows Check your email and signs nobody in; signing in before confirming shows the same screen and a new link
// can be sent; the link page refuses the wrong password; the right password confirms it; the person then signs in. Light, dark and phone shots.
import { createRequire } from "node:module";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", OUT = process.env.OUT || ".";
const PW = ["Verify", "chk", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `verify-ui-${Date.now()}@example.com`;
const sdb = new Database(process.env.SCRATCH_DB);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();

await page.goto(`${BASE}/login?tier=clinic`);
await page.getByRole("tab", { name: "Create Account" }).click();
await page.locator("input:not([type]):visible, input[type=text]:visible").first().fill("Made Up Person");
await page.locator("input[type=email]:visible").fill(email);
await page.locator("input[type=password]:visible").fill(PW);
await page.locator("input[type=checkbox]:visible").first().check();
await page.locator("button[type=submit]:visible").click();
await page.getByTestId("confirm-email-step").waitFor({ timeout: 15000 });
check("signing up shows Check your email, with the address", (await page.getByTestId("confirm-email-step").innerText()).includes(email));
check("nobody is signed in", !(await page.evaluate(() => localStorage.getItem("veritas_token"))));
await page.screenshot({ path: `${OUT}/email-verify-check-email.png` });

const row = () => sdb.prepare("SELECT id, email_verification_pending AS pending FROM users WHERE lower(email) = ?").get(email);
check("the account is waiting", row()?.pending === 1);
sdb.prepare("UPDATE users SET email_verification_sent_at = ? WHERE id = ?").run(new Date(Date.now() - 120000).toISOString(), row().id);
await page.getByTestId("confirm-email-resend").click();
await page.getByTestId("confirm-email-resent").waitFor({ timeout: 15000 });
check("a new link can be sent", true);

// Back to sign in, before confirming.
await page.getByRole("button", { name: "Back to sign in" }).click();
await page.getByRole("tab", { name: "Sign In" }).click();
await page.locator("input[type=email]:visible").fill(email);
await page.locator("input[type=password]:visible").fill(PW);
await page.locator("button[type=submit]:visible").first().click();
await page.getByTestId("confirm-email-step").waitFor({ timeout: 15000 });
check("signing in before confirming shows the same screen, and no session", !(await page.evaluate(() => localStorage.getItem("veritas_token"))));

// The link. The real one is only in the email, so a known code goes in the scratch database.
const token = crypto.randomBytes(32).toString("hex");
sdb.prepare("UPDATE users SET email_verification_token_hash = ?, email_verification_expires_at = ? WHERE id = ?").run(crypto.createHash("sha256").update(token).digest("hex"), new Date(Date.now() + 3600000).toISOString(), row().id);
await page.goto(`${BASE}/verify-email?token=${token}`);
await page.getByTestId("verify-password").fill("Wrong-pass-1!");
await page.getByTestId("verify-submit").click();
await page.getByTestId("verify-error").waitFor({ timeout: 15000 });
check("the wrong password is refused, and says why", /password chosen/.test(await page.getByTestId("verify-error").innerText()));
check("the account is still waiting", row().pending === 1);
await page.screenshot({ path: `${OUT}/email-verify-page.png` });
await page.getByTestId("verify-password").fill(PW);
await page.getByTestId("verify-submit").click();
await page.getByTestId("verify-sign-in").waitFor({ timeout: 15000 });
check("the right password confirms it", row().pending === 0);
await page.screenshot({ path: `${OUT}/email-verify-done.png` });

await page.getByTestId("verify-sign-in").click();
await page.waitForURL(/\/login/, { timeout: 15000 });
await page.getByRole("tab", { name: "Sign In" }).click().catch(() => {});
await page.locator("input[type=email]:visible").fill(email);
await page.locator("input[type=password]:visible").fill(PW);
await page.locator("button[type=submit]:visible").first().click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 }).catch(() => {});
await page.screenshot({ path: `${OUT}/email-verify-signed-in.png` });
check("the person signs in", !new URL(page.url()).pathname.startsWith("/login"), page.url());

// A dead link says so.
const deadCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const dead = await deadCtx.newPage();
await dead.goto(`${BASE}/verify-email?token=${token}`);
await dead.getByTestId("verify-password").fill(PW);
await dead.getByTestId("verify-submit").click();
await dead.getByTestId("verify-error").waitFor({ timeout: 15000 });
check("a used link says it's no longer valid, and offers sign in", /no longer valid/.test(await dead.getByTestId("verify-error").innerText()) && await dead.getByTestId("verify-sign-in").isVisible());

const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const dark = await darkCtx.newPage();
await dark.goto(`${BASE}/`);
await dark.evaluate(() => localStorage.setItem("theme", "dark"));
await dark.goto(`${BASE}/verify-email?token=${"a".repeat(64)}`);
await dark.getByTestId("verify-password").waitFor({ timeout: 15000 });
await dark.screenshot({ path: `${OUT}/email-verify-dark.png` });

const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const phone = await phoneCtx.newPage();
await phone.goto(`${BASE}/verify-email?token=${"a".repeat(64)}`);
await phone.getByTestId("verify-password").waitFor({ timeout: 15000 });
check("phone: no sideways scroll", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await phone.screenshot({ path: `${OUT}/email-verify-phone.png` });

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
