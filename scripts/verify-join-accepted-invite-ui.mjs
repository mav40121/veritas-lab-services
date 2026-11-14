// scripts/verify-join-accepted-invite-ui.mjs
// Browser receipt for BUG-117 (client/src/pages/JoinPage.tsx): a person who already joined opens the invite link
// again. It said "This invitation has already been accepted." with a warning and "Contact your lab administrator for
// a new invitation.", so a new user who had joined went looking for a new invite instead of signing in.
// Run against a LOCAL production build on a scratch database with made-up values (it writes to SCRATCH_DB, so it
// refuses any other host):
//   PW_BASE=http://localhost:5320 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-join-accepted-invite-ui.mjs
//   1. accepted invite: "You've already joined", a Sign in button, no "new invitation" line, no invited address shown;
//   2. Sign in opens the sign-in page;
//   3. expired invite: still "This invitation has expired." with the contact line;
//   4. unknown link: still "This invitation link is not valid." with the contact line;
//   5. an open invite still shows the create-account form;
//   6. dark mode, no page errors.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return j;
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };

const stamp = Date.now();
const ownerEmail = `join-owner-${stamp}@example.test`;
await call("POST", "/api/auth/register", { email: ownerEmail, password: ["Join", "owner", "117!"].join("-"), name: "Made Up Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Made-up Invite Lab", plan: "hospital" })).labId;
const ownerId = sql("SELECT id FROM users WHERE email = ?", ownerEmail).id;
const joinedEmail = `join-joined-${stamp}@example.test`;
const joined = await call("POST", "/api/auth/register", { email: joinedEmail, password: ["Join", "joined", "117!"].join("-"), name: "Made Up Joined", hipaa_acknowledged: true });
const seat = (email, status, invitedAt, token, userId = null) => sql(
  "INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, invite_token, lab_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ownerId, email, userId, invitedAt, status === "active" ? new Date().toISOString() : null, status, token, labId);
const now = new Date().toISOString();
const old = new Date(Date.now() - 40 * 86400000).toISOString();
seat(joinedEmail, "active", now, `accepted-${stamp}`, joined.user?.id ?? null);
seat(`join-expired-${stamp}@example.test`, "pending", old, `expired-${stamp}`);
seat(`join-open-${stamp}@example.test`, "pending", now, `open-${stamp}`);

const browser = await chromium.launch();
const errors = [];
const open = async (token, dark = false) => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  if (dark) { await page.goto(`${BASE}/`); await page.evaluate(() => localStorage.setItem("theme", "dark")); }
  await page.goto(`${BASE}/join?token=${encodeURIComponent(token)}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !document.body.innerText.includes("Verifying invitation"), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  return { page, ctx, text: async () => (await page.locator("body").innerText()).replace(/\s+/g, " ") };
};

try {
  const { page, ctx, text } = await open(`accepted-${stamp}`);
  const t = await text();
  check("1a. accepted invite says You've already joined", t.includes("You've already joined"), t.slice(0, 300));
  check("1b. it tells the person to sign in with the invited address", t.includes("Sign in with the email address the invitation was sent to."), t.slice(0, 300));
  check("1c. no 'Contact your lab administrator for a new invitation.' line", !t.includes("new invitation"), t.slice(0, 300));
  check("1d. the old 'already been accepted' warning is gone", !t.includes("already been accepted"), t.slice(0, 300));
  check("1e. the invited address is not shown", !t.includes(joinedEmail), t.slice(0, 300));
  check("1f. a Forgot your password? link is offered", await page.getByRole("link", { name: "Forgot your password?" }).count() === 1);
  await page.screenshot({ path: path.join(OUT, "bug117-already-joined.png"), animations: "disabled" });
  await page.getByTestId("join-sign-in").click();
  await page.waitForURL(/\/login/, { timeout: 10000 });
  check("2. Sign in opens the sign-in page", new URL(page.url()).pathname === "/login", page.url());
  await ctx.close();
} catch (e) { check("accepted section ran to the end", false, String(e?.message || e).split("\n")[0]); }

try {
  const { ctx, text } = await open(`expired-${stamp}`);
  const t = await text();
  check("3. expired invite: 'This invitation has expired.' with the contact line", t.includes("This invitation has expired.") && t.includes("Contact your lab administrator for a new invitation."), t.slice(0, 300));
  await ctx.close();
} catch (e) { check("expired section ran to the end", false, String(e?.message || e).split("\n")[0]); }

try {
  const { ctx, text } = await open(`no-such-token-${stamp}`);
  const t = await text();
  check("4. unknown link: 'This invitation link is not valid.' with the contact line", t.includes("This invitation link is not valid.") && t.includes("Contact your lab administrator for a new invitation."), t.slice(0, 300));
  await ctx.close();
} catch (e) { check("unknown section ran to the end", false, String(e?.message || e).split("\n")[0]); }

try {
  const { ctx, text } = await open(`open-${stamp}`);
  const t = await text();
  check("5. an open invite still shows the create-account form", t.includes("You've been invited to join Made-up Invite Lab") && t.includes("Create Account & Join Lab"), t.slice(0, 300));
  await ctx.close();
} catch (e) { check("open section ran to the end", false, String(e?.message || e).split("\n")[0]); }

try {
  const { page, ctx, text } = await open(`accepted-${stamp}`, true);
  const t = await text();
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  check("6a. dark mode: the page is dark and reads You've already joined", dark && t.includes("You've already joined"), `dark=${dark}`);
  await page.screenshot({ path: path.join(OUT, "bug117-already-joined-dark.png"), animations: "disabled" });
  await ctx.close();
} catch (e) { check("dark section ran to the end", false, String(e?.message || e).split("\n")[0]); }

check("6b. no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
