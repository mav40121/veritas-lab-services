// scripts/verify-library-c4000-ui.mjs
// Gate 3 browser receipt for BUG-009's ARCHITECT c4000 correction (Michael 2026-11-13, Q329 = 1;
// scripts/fda-menus/correct_c4000.py, plan scripts/fda-menus/c4000_plan_2026-11-13.json): the entry drops the 84 tests
// FDA records only on Abbott immunoassay analyzers or on no ARCHITECT system, and gains 13 FDA tests.
// Run against a LOCAL server on a scratch database (it registers an owner, provisions a lab and creates a map, so it
// refuses any other host):
//   PW_BASE=http://localhost:5323 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-library-c4000-ui.mjs
//   1. searching "c4000" offers the instrument with the library's test count (102);
//   2. after adding it, Select Tests lists kept tests and FDA's adds, and none of the removed tests;
//   3. Calprotectin carries FDA's HIGH;
//   4. dark mode, no page errors.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const KEY = "Abbott ARCHITECT c4000";
const lib = JSON.parse(fs.readFileSync(new URL("../client/src/lib/fdaInstrumentData.json", import.meta.url), "utf8"));
const plan = JSON.parse(fs.readFileSync(new URL("./fda-menus/c4000_plan_2026-11-13.json", import.meta.url), "utf8"));
const removedSet = new Set(plan.remove.map((r) => r.test));
const staying = Object.keys(lib[KEY].tests).filter((t) => !removedSet.has(t)); // the same list on the old library and the new
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const whole = (name) => new RegExp(`(^|[^A-Za-z0-9])${esc(name)}([^A-Za-z0-9]|$)`);
// A removed name that is a whole word inside a test that stays (e.g. a short code) can't be told apart on the page.
const removed = plan.remove.map((r) => r.test).filter((n) => !staying.some((s) => whole(n).test(s)));
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return j;
};

const email = `c4000-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Arch", "c4k", "009!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Chemistry Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9994000' WHERE id = ?").run(labId);
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
  await search.fill("c4000");
  await page.waitForTimeout(600);
  const result = page.locator("button", { hasText: KEY }).first();
  const text = (await result.isVisible().catch(() => false)) ? (await result.innerText()).replace(/\s+/g, " ") : "(no result)";
  const n = lib[KEY].testCount;
  check(`1. searching "c4000" offers ${KEY} with ${n} tests`, n === 102 && new RegExp(`\\b${n} tests`).test(text), text);
  await result.click();
  await page.getByRole("button", { name: /^Add Instrument$/ }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Next: Select Tests/ }).click();
  await page.waitForTimeout(2500);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const kept = ["Triglycerides", "HbA1c", "Immunoglobulin A", "Vitamin D", "Digoxin"];
  check(`2a. kept tests are listed (${kept.join(", ")})`, kept.every((t) => whole(t).test(body)), kept.filter((t) => !whole(t).test(body)).join(", "));
  const added = ["Cystatin C", "Procalcitonin (PCT)", "Calprotectin", "Fibrinogen"];
  check(`2b. FDA's adds are listed (${added.join(", ")})`, added.every((t) => body.includes(t)), added.filter((t) => !body.includes(t)).join(", "));
  const left = removed.filter((r) => whole(r).test(body));
  check(`2c. none of the ${removed.length} removed tests checked is listed (of ${plan.remove.length})`, left.length === 0, JSON.stringify(left));
  const row = page.locator("label, li, div", { hasText: /^Calprotectin/ }).filter({ hasText: /HIGH|MODERATE|WAIVED/ }).last();
  const calText = (await row.count()) ? (await row.innerText()).replace(/\s+/g, " ") : "(no row)";
  check("3. Calprotectin shows FDA's HIGH", /HIGH/.test(calText) && !/MODERATE/.test(calText), calText.slice(0, 120));
  await page.screenshot({ path: path.join(OUT, "bug009-c4000-select-tests.png"), animations: "disabled" });
  await ctx.close();
} catch (e) { check("light section ran to the end", false, String(e?.message || e).split("\n")[0]); }

try {
  const { ctx, page, search } = await open(true);
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await search.fill("c4000");
  await page.waitForTimeout(600);
  const text = (await page.locator("button", { hasText: KEY }).first().innerText().catch(() => "")).replace(/\s+/g, " ");
  check("4a. dark mode: the page is dark and the search offers the corrected entry", dark && new RegExp(`\\b${lib[KEY].testCount} tests`).test(text), `dark=${dark} ${text}`);
  const box = search.locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await ((await box.count()) ? box : page).screenshot({ path: path.join(OUT, "bug009-c4000-search-dark.png"), animations: "disabled" });
  await ctx.close();
} catch (e) { check("dark section ran to the end", false, String(e?.message || e).split("\n")[0]); }

check("4b. no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
