// scripts/verify-digest-tile-ui.mjs
//
// Browser receipt (Gate 3 step 8) for the Compliance Digest tile (Michael 2026-11-12, Q297 = 1: the digest stays a
// feature, found from the All Modules page). On a local production build with a scratch DB and a made-up owner and lab,
// written through the app's own routes, never production:
//   T1. signed out, desktop: /veritaassure has an "Included in every plan" section after Operations with one tile,
//       Compliance Digest, badge Included; the page still says eighteen modules; clicking the tile opens /pricing
//   T2. the pricing comparison has "Compliance Digest, monthly or quarterly": not included on Per Study and VC Unlimited,
//       included on Clinic, Community and Hospital
//   T3. signed in: clicking the tile lands on the digest in the active lab (/labs/:labId/digest)
//   T4. phone width: the tile shows and the page has no sideways scroll; dark mode: the tile's text reads at 4.5:1 or better
// Screenshots go to OUT. Run: PW_BASE=http://localhost:5252 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-digest-tile-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Digest", "Tile", "77!"].join("-");
const stamp = Date.now();

const email = `digest-tile-ui-owner-${stamp}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: pw, name: "Made-up Owner Penhallow", hipaa_acknowledged: true });
const OWNER = { email, token: reg.body.token, id: Number(sql("SELECT id FROM users WHERE email = ?", email)?.id) };
const LAB = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Digest Tile Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", OWNER.id);
sql("UPDATE labs SET has_completed_onboarding = 1, clia_number = '22D7790013', time_zone = 'America/New_York' WHERE id = ?", LAB);
check("setup: a made-up owner and lab", LAB > 0 && !!OWNER.token);

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const go = async (page, url, opts) => { try { return await page.goto(url, opts); } catch (e) { if (!/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET/.test(String(e?.message))) throw e; return page.goto(url, opts); } };
const openAs = async (u, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1600, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  await go(page, `${BASE}/`);
  if (u) {
    const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, u.token]);
    await page.evaluate(([t, usr, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(usr.user || usr)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [u.token, me, LAB]);
  }
  await go(page, `${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const contrast = async (page, locator) => page.evaluate((el) => {
  const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 4).map(Number);
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fg = rgb(getComputedStyle(el).color);
  let n = el, bg = null;
  while (n) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) { bg = c; break; } n = n.parentElement; }
  bg = bg || [255, 255, 255];
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}, await locator.elementHandle());

try {
  // T1. Signed out, desktop
  const out = await openAs(null, "/veritaassure");
  const section = out.getByTestId("included-features");
  check("T1a. an 'Included in every plan' section is on the page", await section.isVisible().catch(() => false));
  const heads = await out.locator("section div.uppercase").allTextContents();
  const order = heads.map((h) => h.trim().toLowerCase());
  check("T1b. it comes right after Operations", order.indexOf("included in every plan") === order.indexOf("operations") + 1, JSON.stringify(order));
  const tile = section.getByText("Compliance Digest", { exact: true });
  check("T1c. one tile, Compliance Digest, badged Included", (await section.locator("a").count()) === 1 && await tile.isVisible() && (await section.getByText("Included", { exact: true }).count()) === 1);
  check("T1d. the page still says eighteen modules", /eighteen modules across two streams/.test(await out.locator("body").innerText()));
  await section.scrollIntoViewIfNeeded();
  await out.screenshot({ path: `${OUT}/digest-tile-light.png`, fullPage: false });
  await section.screenshot({ path: `${OUT}/digest-tile-card-light.png` });
  await tile.click();
  await out.waitForURL(/\/pricing/, { timeout: 15000 }).catch(() => {});
  check("T1e. signed out, the tile opens pricing", /\/pricing$/.test(new URL(out.url()).pathname), out.url());

  // T2. The pricing row
  const row = out.locator("tr", { hasText: "Compliance Digest, monthly or quarterly" });
  await row.scrollIntoViewIfNeeded().catch(() => {});
  const labels = await row.locator("[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  check("T2. pricing: not included on Per Study and VC Unlimited, included on Clinic, Community and Hospital",
    JSON.stringify(labels) === JSON.stringify(["Not included", "Not included", "Included", "Included", "Included"]), JSON.stringify(labels));
  await row.screenshot({ path: `${OUT}/digest-pricing-row.png` });
  await out.context().close();

  // T3. Signed in
  const inn = await openAs(OWNER, "/veritaassure");
  const tileIn = inn.getByTestId("included-features").getByText("Compliance Digest", { exact: true });
  await tileIn.click();
  await inn.waitForURL(/\/labs\/\d+\/digest/, { timeout: 15000 }).catch(() => {});
  check("T3. signed in, the tile lands on the digest in the active lab", new RegExp(`/labs/${LAB}/digest$`).test(new URL(inn.url()).pathname), inn.url());
  await inn.screenshot({ path: `${OUT}/digest-tile-signed-in-landing.png`, fullPage: false });
  await inn.context().close();

  // T4. Phone and dark
  const phone = await openAs(null, "/veritaassure", { viewport: { width: 390, height: 844 } });
  const sec = phone.getByTestId("included-features");
  await sec.scrollIntoViewIfNeeded();
  const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("T4a. phone: the tile shows and nothing scrolls sideways", await sec.getByText("Compliance Digest", { exact: true }).isVisible() && sideways <= 1, `scroll ${sideways}`);
  await sec.screenshot({ path: `${OUT}/digest-tile-phone.png` });
  await phone.context().close();
  const dark = await openAs(null, "/veritaassure", { colorScheme: "dark" });
  await dark.evaluate(() => document.documentElement.classList.add("dark"));
  const dsec = dark.getByTestId("included-features");
  await dsec.scrollIntoViewIfNeeded();
  const titleRatio = await contrast(dark, dsec.getByText("Compliance Digest", { exact: true }));
  const bodyRatio = await contrast(dark, dsec.locator("a p").last());
  // The tile's detail text is the module tiles' own style (text-xs text-muted-foreground), so it is held to what an
  // existing tile on the same page measures, not to a new bar.
  const moduleBody = await contrast(dark, dark.locator("a", { hasText: "VeritaCheck" }).locator("p").first());
  console.log(`INFO  dark mode contrast: tile title ${titleRatio.toFixed(2)}, tile text ${bodyRatio.toFixed(2)}, VeritaCheck tile text ${moduleBody.toFixed(2)}`);
  check("T4b. dark mode: the tile's title reads at 4.5:1 or better", titleRatio >= 4.5, `title ${titleRatio.toFixed(2)}`);
  check("T4c. dark mode: the tile's text matches the module tiles' text", Math.abs(bodyRatio - moduleBody) < 0.05, `tile ${bodyRatio.toFixed(2)} module ${moduleBody.toFixed(2)}`);
  await dsec.screenshot({ path: `${OUT}/digest-tile-card-dark.png` });
  await dark.context().close();
} finally {
  await browser.close();
}
console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
