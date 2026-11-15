// scripts/verify-library-duplicate-names-ui.mjs
// Gate 3 browser receipt for BUG-009's duplicate-names removal (Michael Q330, 2026-11-14;
// scripts/fda-menus/remove_duplicate_names.py, plan scripts/fda-menus/dup_names_plan_2026-11-14.json): 21 library entries
// listed one test under two names ("Calcium" and "Calcium, total"), and a new instrument starts with every library test
// switched on, so a lab adding one got the test twice. The entry keeps one name per test.
// Run against a LOCAL server on a scratch database (it registers an owner, provisions a lab and creates a map, so it
// refuses any other host):
//   PW_BASE=http://localhost:5323 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-library-duplicate-names-ui.mjs
//   1. searching "Vista 1500" offers the Siemens Dimension Vista 1500 with the library's count (178 - 8 = 170);
//   2. after adding it, Select Tests lists each kept name once and none of the 8 removed names, 170 rows in all;
//   3. dark mode, no page errors.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const KEY = "Siemens Dimension Vista 1500";
const lib = JSON.parse(fs.readFileSync(new URL("../client/src/lib/fdaInstrumentData.json", import.meta.url), "utf8"));
const plan = JSON.parse(fs.readFileSync(new URL("./fda-menus/dup_names_plan_2026-11-14.json", import.meta.url), "utf8"));
const spec = plan.instruments[KEY];
const kept = spec.groups.map((g) => g.keep);
const removed = spec.groups.flatMap((g) => g.remove);
const want = spec.before_count - removed.length;
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return j;
};

const email = `dupnames-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Dup", "names", "330!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Chemistry Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9993300' WHERE id = ?").run(labId);
sdb.close();
const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Chemistry" }, reg.token);
check("scratch map created", !!map.id, JSON.stringify(map).slice(0, 160));

const browser = await chromium.launch();
const errors = [];
const open = async (dark) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, d]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", d ? "dark" : "light"); }, [reg.token, reg.user, dark]);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${map.id}/build`, { waitUntil: "networkidle" });
  const search = page.locator("input[placeholder^='Type an instrument']").first();
  await search.waitFor({ timeout: 20000 });
  return { ctx, page, search };
};

try {
  const { ctx, page, search } = await open(false);
  await search.fill("Vista 1500");
  await page.waitForTimeout(600);
  const result = page.locator("button", { hasText: KEY }).first();
  const text = (await result.isVisible().catch(() => false)) ? (await result.innerText()).replace(/\s+/g, " ") : "(no result)";
  check(`1. searching "Vista 1500" offers ${KEY} with ${want} tests (${spec.before_count} - ${removed.length})`, lib[KEY].testCount === want && new RegExp(`\\b${want} tests`).test(text), text);
  await result.click();
  await page.getByRole("button", { name: /^Add Instrument$/ }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Next: Select Tests/ }).click();
  await page.waitForTimeout(2500);
  // Each test row's name is its own span (VeritaMapBuildPage TestList), so the list is read name by name.
  const names = (await page.locator("span.text-sm.font-medium.flex-1").allInnerTexts()).map((s) => s.trim());
  const count = (n) => names.filter((x) => x === n).length;
  check(`2a. each kept name is listed once (${kept.join("; ")})`, kept.every((k) => count(k) === 1), kept.map((k) => `${k}=${count(k)}`).join(", "));
  const left = removed.filter((r) => count(r) > 0);
  check(`2b. none of the ${removed.length} removed names is listed (${removed.join("; ")})`, left.length === 0, JSON.stringify(left));
  check(`2c. Select Tests lists ${want} tests, each once`, names.length === want && new Set(names).size === names.length, `${names.length} rows, ${new Set(names).size} distinct`);
  await page.screenshot({ path: path.join(OUT, "bug009-duplicate-names-select-tests.png"), animations: "disabled" });
  await ctx.close();
} catch (e) { check("light section ran to the end", false, String(e?.message || e).split("\n")[0]); }

try {
  const { ctx, page, search } = await open(true);
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await search.fill("Vista 1500");
  await page.waitForTimeout(600);
  const text = (await page.locator("button", { hasText: KEY }).first().innerText().catch(() => "")).replace(/\s+/g, " ");
  check("3a. dark mode: the page is dark and the search offers the corrected entry", dark && new RegExp(`\\b${want} tests`).test(text), `dark=${dark} ${text}`);
  const box = search.locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await ((await box.count()) ? box : page).screenshot({ path: path.join(OUT, "bug009-duplicate-names-search-dark.png"), animations: "disabled" });
  await ctx.close();
} catch (e) { check("dark section ran to the end", false, String(e?.message || e).split("\n")[0]); }

check("3b. no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
