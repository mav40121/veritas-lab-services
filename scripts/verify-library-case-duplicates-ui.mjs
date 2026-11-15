// scripts/verify-library-case-duplicates-ui.mjs
// Gate 3 browser receipt for the library's repeated entries (BUG-009 parked item, 2026-11-14;
// scripts/fda-menus/remove_case_duplicate_entries.py): "Abbott Architect c8000" and "Abbott Architect c16000" were the
// same entries as "Abbott ARCHITECT c8000" and "Abbott ARCHITECT c16000", so the build page's search offered each
// analyzer twice. The ARCHITECT entries stay.
// Run against a LOCAL server on a scratch database (it registers an owner, provisions a lab and creates a map, so it
// refuses any other host):
//   PW_BASE=http://localhost:5323 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-library-case-duplicates-ui.mjs
//   1. searching "c8000" and "c16000" each offers one Abbott ARCHITECT entry, with the library's test count, and the
//      help card gives the library's size (scripts/verify-library-count-copy.mjs checks every page's copy of it);
//   2. after adding the ARCHITECT c8000, Select Tests lists its 114 tests, each once;
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
const lib = JSON.parse(fs.readFileSync(new URL("../client/src/lib/fdaInstrumentData.json", import.meta.url), "utf8"));
const MODELS = [
  { search: "c8000", keep: "Abbott ARCHITECT c8000", pattern: /Abbott Architect c8000/i },
  { search: "c16000", keep: "Abbott ARCHITECT c16000", pattern: /Abbott Architect c16000/i },
];
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return j;
};

const email = `casedups-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Case", "dups", "009!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Chemistry Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9990009' WHERE id = ?").run(labId);
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
// The search result buttons whose text names the model in any capitals.
const offered = async (page, pattern) => (await page.locator("button").filter({ hasText: pattern }).allInnerTexts()).map((s) => s.replace(/\s+/g, " ").trim());

try {
  const { ctx, page, search } = await open(false);
  for (const [i, m] of MODELS.entries()) {
    await search.fill(m.search);
    await page.waitForTimeout(600);
    const rows = await offered(page, m.pattern);
    const n = lib[m.keep]?.testCount;
    check(`1${"ab"[i]}. searching "${m.search}" offers one Abbott entry, ${m.keep} with ${n} tests`,
      rows.length === 1 && rows[0].includes(m.keep) && new RegExp(`\\b${n} tests`).test(rows[0]), JSON.stringify(rows));
    if (i === 0) {
      const box = search.locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
      await ((await box.count()) ? box : page).screenshot({ path: path.join(OUT, "bug009-case-duplicates-search.png"), animations: "disabled" });
    }
  }
  const manual = Object.values(lib).filter((v) => v.category === "Manual Procedures").length;
  const sizeLine = `library of ${Object.keys(lib).length - manual} analyzers and ${manual} manual procedures`;
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  check(`1c. the help card gives the library's size: "${sizeLine}"`, body.includes(sizeLine), (body.match(/library of \d+ analyzers and \d+ manual procedures/) || ["(not found)"])[0]);
  await search.fill("c8000");
  await page.waitForTimeout(600);
  await page.locator("button", { hasText: MODELS[0].keep }).first().click();
  await page.getByRole("button", { name: /^Add Instrument$/ }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Next: Select Tests/ }).click();
  await page.waitForTimeout(2500);
  // Each test row's name is its own span (VeritaMapBuildPage TestList), so the list is read name by name.
  const names = (await page.locator("span.text-sm.font-medium.flex-1").allInnerTexts()).map((s) => s.trim());
  const want = lib[MODELS[0].keep].testCount;
  check(`2. Select Tests lists the ${MODELS[0].keep}'s ${want} tests, each once`, names.length === want && new Set(names).size === names.length, `${names.length} rows, ${new Set(names).size} distinct`);
  await page.screenshot({ path: path.join(OUT, "bug009-case-duplicates-select-tests.png"), animations: "disabled" });
  await ctx.close();
} catch (e) { check("light section ran to the end", false, String(e?.message || e).split("\n")[0]); }

try {
  const { ctx, page, search } = await open(true);
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await search.fill("c16000");
  await page.waitForTimeout(600);
  const rows = await offered(page, MODELS[1].pattern);
  check("3a. dark mode: the page is dark and the search offers one c16000 entry", dark && rows.length === 1, `dark=${dark} ${JSON.stringify(rows)}`);
  const box = search.locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await ((await box.count()) ? box : page).screenshot({ path: path.join(OUT, "bug009-case-duplicates-search-dark.png"), animations: "disabled" });
  await ctx.close();
} catch (e) { check("dark section ran to the end", false, String(e?.message || e).split("\n")[0]); }

check("3b. no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
