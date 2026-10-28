// scripts/verify-no-phi-ack-ui.mjs
// Browser receipt for BUG-083 (Michael Q66 = 1, 2026-10-28): an owner Veritas set up (provision-owner-lab) signs in
// through the real sign-in page and is asked once for the no-PHI acknowledgment; it cannot be dismissed with Escape,
// "I agree" needs the box checked, the click is recorded with its time, and it does not come back. A self sign-up is
// never asked, public pages are never covered, and Sign out leaves. Made-up accounts on a scratch DB only. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-no-phi-ack-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const PW = ["Nophi", "Test", "2026!"].join("-");
const stamp = Date.now();

// Two owners Veritas sets up (one to agree, one for dark mode, public pages and Sign out), one self sign-up.
const provision = async (tag) => {
  const email = `nophi-ui-${tag}-${stamp}@example.com`;
  const p = await call("POST", "/api/admin/provision-owner-lab", { secret: ADMIN, ownerEmail: email, ownerName: `No-PHI UI ${tag}`, labName: `No-PHI UI Lab ${tag}`, plan: "hospital" });
  const token = new URL(p.body.onboardingUrl).searchParams.get("token");
  const reset = await call("POST", "/api/auth/reset-password", { token, password: PW });
  return { email, id: p.body.owner_user_id, labId: p.body.lab_id, ok: p.status === 200 && reset.status === 200 };
};
const A = await provision("a");
const B = await provision("b");
const selfEmail = `nophi-ui-self-${stamp}@example.com`;
await call("POST", "/api/auth/register", { email: selfEmail, password: PW, name: "No-PHI UI Self", hipaa_acknowledged: true });
const sdb = new Database(process.env.SCRATCH_DB);
const selfId = sdb.prepare("SELECT id FROM users WHERE email = ?").get(selfEmail).id;
for (const id of [A.id, B.id, selfId]) sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(id);
for (const id of [A.labId, B.labId]) sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(id);
const row = (id) => sdb.prepare("SELECT hipaa_acknowledged AS ack, hipaa_acknowledged_at AS at, hipaa_ack_source AS src FROM users WHERE id = ?").get(id);
check("setup: two owners set up by Veritas (password set through the onboarding link) and one self sign-up", A.ok && B.ok && !!selfId && Number(row(A.id).ack) === 0 && row(selfId).src === "signup");

const browser = await chromium.launch();
const signIn = async (email, scheme = "light") => {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, colorScheme: scheme });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.locator('form input[type="email"]').first().fill(email);
  await page.locator('[data-testid="login-password"]').fill(PW);
  await page.locator('[data-testid="login-password"]').press("Enter");
  // The onboarding link's password set (or the previous page) leaves a session open: take the sign-in page's
  // "Force Logout Other Device" the way a person would.
  const force = page.getByRole("button", { name: "Force Logout Other Device" });
  const inApp = () => page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 });
  await Promise.race([inApp(), force.waitFor({ timeout: 20000 })]).catch(() => {});
  if (await force.count()) await force.click();
  await inApp().catch(() => {});
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  return page;
};
const dialog = (page) => page.locator('[data-testid="no-phi-acknowledgment"]');

// Owner A: asked, cannot dismiss, agrees, never asked again
const a = await signIn(A.email);
check("A signs in through the sign-in page and lands in the app", !new URL(a.url()).pathname.startsWith("/login"), a.url());
check("A (set up by Veritas) is asked for the no-PHI acknowledgment", (await dialog(a).count()) === 1 && /not a HIPAA-covered platform/.test(await dialog(a).innerText()));
await a.screenshot({ path: path.join(OUT, "no-phi-ack-asked.png"), fullPage: false });
await a.keyboard.press("Escape");
await a.waitForTimeout(400);
check("Escape does not dismiss it", (await dialog(a).count()) === 1);
const agree = a.locator('[data-testid="no-phi-acknowledgment-agree"]');
check('"I agree" is disabled until the box is checked', await agree.isDisabled());
await a.locator('[data-testid="no-phi-acknowledgment-check"]').check();
const before = Date.now();
await agree.click();
await a.waitForTimeout(1000);
const r = row(A.id);
check("after I agree the dialog closes", (await dialog(a).count()) === 0);
check("the record holds A's own click: ack 1, source self, the click's time", r.ack === 1 && r.src === "self" && Math.abs(Date.parse(r.at) - before) < 15000, JSON.stringify(r));
await a.screenshot({ path: path.join(OUT, "no-phi-ack-after.png"), fullPage: false });
await a.reload({ waitUntil: "networkidle" });
await a.waitForTimeout(800);
check("after a reload A is not asked again", (await dialog(a).count()) === 0);
await a.close();
const a2 = await signIn(A.email);
check("signing in again A is not asked again, and the time is unchanged", (await dialog(a2).count()) === 0 && row(A.id).at === r.at);
await a2.close();

// Self sign-up: never asked
const s = await signIn(selfEmail);
check("a self sign-up is never asked", !new URL(s.url()).pathname.startsWith("/login") && (await dialog(s).count()) === 0, s.url());
await s.close();

// Owner B: dark mode, public pages, Sign out
const b = await signIn(B.email, "dark");
check("dark mode: the dialog shows on a dark page", (await dialog(b).count()) === 1 && await b.evaluate(() => document.documentElement.classList.contains("dark")));
await b.screenshot({ path: path.join(OUT, "no-phi-ack-dark.png"), fullPage: false });
await b.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
await b.waitForTimeout(800);
check("a public page (Pricing) is not covered", (await dialog(b).count()) === 0);
await b.goBack({ waitUntil: "networkidle" });
await b.waitForTimeout(800);
check("back in the app B is still asked (nothing recorded)", (await dialog(b).count()) === 1 && Number(row(B.id).ack) === 0);
await b.getByRole("button", { name: "Sign out" }).click();
await b.waitForTimeout(1000);
const tokenLeft = await b.evaluate(() => localStorage.getItem("veritas_token"));
check("Sign out leaves to the sign-in page and records nothing", new URL(b.url()).pathname.startsWith("/login") && !tokenLeft && Number(row(B.id).ack) === 0, b.url());
await b.close();

await browser.close();
sdb.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
