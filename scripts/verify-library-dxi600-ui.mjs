// scripts/verify-library-dxi600-ui.mjs
// Gate 3 browser receipt for BUG-009 (2026-11-13): the corrupt "Beckman Coulter UniCel DxI 600" library entry
// (one scraped 1,839-character string and 7 reagent codes, all HIGH) is rebuilt from FDA's menu
// (scripts/fda-menus/rebuild_corrupt.py). Run against a LOCAL server on a scratch database (it registers an owner,
// provisions a lab and creates a map, so it refuses any other host):
//   PW_BASE=http://localhost:5321 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-library-dxi600-ui.mjs
// Expected values come from client/src/lib/fdaInstrumentData.json and scripts/fda-menus/rebuilt_corrupt_2026-11-13.json.
//   1. searching "DxI 600" offers the instrument with FDA's test count;
//   2. after adding it to a map, Select Tests lists FDA tests (Cortisol, Vitamin B12, Anti-Mullerian Hormone (AMH))
//      and none of the corrupt names (TSH3d, HCG5, the scraped "Access 2, Access 2i, ..." string);
//   3. Folate, red blood cell carries FDA's HIGH and Cortisol FDA's MODERATE;
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
const KEY = "Beckman Coulter UniCel DxI 600";
const lib = JSON.parse(fs.readFileSync(new URL("../client/src/lib/fdaInstrumentData.json", import.meta.url), "utf8"));
const man = JSON.parse(fs.readFileSync(new URL("./fda-menus/rebuilt_corrupt_2026-11-13.json", import.meta.url), "utf8"));
const removed = man.instruments[KEY].removed_corrupt.map((r) => r.name.replace(/\.\.\.$/, "").slice(0, 40));
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return j;
};

const email = `dxi600-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Dxi", "six", "009!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Library Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999009' WHERE id = ?").run(labId);
sdb.close();
const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Immunoassay" }, reg.token);
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
  await search.fill("DxI 600");
  await page.waitForTimeout(600);
  const result = page.locator("button", { hasText: KEY }).first();
  const text = (await result.isVisible().catch(() => false)) ? (await result.innerText()).replace(/\s+/g, " ") : "(no result)";
  const n = lib[KEY].testCount;
  check(`1. searching "DxI 600" offers ${KEY} with ${n} tests`, new RegExp(`\\b${n} tests`).test(text), text);
  await result.click();
  await page.getByRole("button", { name: /^Add Instrument$/ }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Next: Select Tests/ }).click();
  await page.waitForTimeout(2500);
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check("2a. Select Tests lists FDA tests (Cortisol, Vitamin B12, Anti-Mullerian Hormone (AMH))",
    ["Cortisol", "Vitamin B12", "Anti-Mullerian Hormone (AMH)"].every((t) => body.includes(t)), body.slice(0, 300));
  const left = removed.filter((r) => body.includes(r));
  check(`2b. none of the ${removed.length} corrupt names is listed`, left.length === 0, JSON.stringify(left));
  const rowText = async (name) => {
    const row = page.locator("label, li, div", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) }).filter({ hasText: /HIGH|MODERATE|WAIVED/ }).last();
    return (await row.count()) ? (await row.innerText()).replace(/\s+/g, " ") : "(no row)";
  };
  const folate = await rowText("Folate, red blood cell");
  check("3a. Folate, red blood cell (RBC folate) shows FDA's HIGH", /HIGH/.test(folate) && !/MODERATE/.test(folate), folate.slice(0, 120));
  const cortisol = await rowText("Cortisol");
  check("3b. Cortisol shows FDA's MODERATE", /MODERATE/.test(cortisol) && !/HIGH/.test(cortisol), cortisol.slice(0, 120));
  await page.screenshot({ path: path.join(OUT, "bug009-dxi600-select-tests.png"), animations: "disabled" });
  await ctx.close();
} catch (e) { check("light section ran to the end", false, String(e?.message || e).split("\n")[0]); }

try {
  const { ctx, page, search } = await open(true);
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await search.fill("DxI 600");
  await page.waitForTimeout(600);
  const text = (await page.locator("button", { hasText: KEY }).first().innerText().catch(() => "")).replace(/\s+/g, " ");
  check("4a. dark mode: the page is dark and the search offers the rebuilt entry", dark && new RegExp(`\\b${lib[KEY].testCount} tests`).test(text), `dark=${dark} ${text}`);
  const box = search.locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await ((await box.count()) ? box : page).screenshot({ path: path.join(OUT, "bug009-dxi600-search-dark.png"), animations: "disabled" });
  await ctx.close();
} catch (e) { check("dark section ran to the end", false, String(e?.message || e).split("\n")[0]); }

check("4b. no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
