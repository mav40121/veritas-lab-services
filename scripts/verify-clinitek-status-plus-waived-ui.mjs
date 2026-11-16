// scripts/verify-clinitek-status-plus-waived-ui.mjs
// Gate 3 browser receipt for the CLINITEK Status+ complexity correction (BUG-009, 2026-11-15;
// scripts/fda-menus/correct_clinitek_status_plus.py): the "Siemens CLINITEK Status+" library entry listed every test
// MODERATE, and FDA lists the Status+ as WAIVED (K091216), so a lab that added the analyzer started with every
// dipstick test MODERATE.
// Run against a LOCAL server on a scratch database (it registers an owner, provisions a lab and creates a map, so it
// refuses any other host):
//   PW_BASE=http://localhost:5324 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-clinitek-status-plus-waived-ui.mjs
//   1. after adding the Siemens CLINITEK Status+, Select Tests lists its 18 tests, and the 11 FDA lists as waived
//      show the WAIVED badge;
//   2. the 7 left for the naming work show MODERATE, as before;
//   3. dark mode reads the same, no page errors.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const KEY = "Siemens CLINITEK Status+";
const WAIVED = [
  "Urine qualitative dipstick Ph", "Urine qualitative dipstick bilirubin", "Urine qualitative dipstick blood",
  "Urine qualitative dipstick creatinine", "Urine qualitative dipstick glucose", "Urine qualitative dipstick ketone",
  "Urine qualitative dipstick leukocytes", "Urine qualitative dipstick nitrite", "Urine qualitative dipstick protein",
  "Urine qualitative dipstick urobilinogen", "Total solids (specific gravity)",
];
const MODERATE = [
  "Urine qualitative dipstick chemistries", "Protein, total, urine", "Nitrite, urine", "pH, urine", "Bilirubin, urine",
  "Urobilinogen, urine", "Creatinine",
];
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return j;
};

const email = `clinitek-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Clinitek", "status", "009!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Urinalysis Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9990010' WHERE id = ?").run(labId);
sdb.close();
const maps = [];
for (const name of ["Urinalysis", "Urinalysis dark"]) {
  const m = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name }, reg.token);
  maps.push(m.id);
}
check("scratch maps created", maps.every(Boolean), JSON.stringify(maps));

const browser = await chromium.launch();
const errors = [];
// Adds the Status+ to the map and returns each Select Tests row's name and badge text.
const addAndRead = async (dark, mapId, shot) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 1400 }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, d]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", d ? "dark" : "light"); }, [reg.token, reg.user, dark]);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${mapId}/build`, { waitUntil: "networkidle" });
  const search = page.locator("input[placeholder^='Type an instrument']").first();
  await search.waitFor({ timeout: 20000 });
  await search.fill("CLINITEK Status");
  await page.waitForTimeout(600);
  // A regex without the i flag matches capitals exactly, so the other spelling is never clicked.
  await page.locator("button").filter({ hasText: /Siemens CLINITEK Status\+/ }).first().click();
  await page.getByRole("button", { name: /^Add Instrument$/ }).click();
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: /Next: Select Tests/ }).click();
  await page.waitForTimeout(2500);
  const rows = await page.$$eval("span.text-sm.font-medium.flex-1", (els) => els.map((e) => ({
    name: (e.textContent || "").trim(),
    badge: ((e.nextElementSibling && e.nextElementSibling.textContent) || "").replace(/\s+/g, " ").trim(),
  })));
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  // The instrument's card alone, with the sticky header hidden so it doesn't cover the card's title row.
  await page.addStyleTag({ content: "header, nav.sticky, .sticky.top-0 { visibility: hidden !important; }" });
  const card = page.locator("span.text-sm.font-medium.flex-1").first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await ((await card.count()) ? card : page).screenshot({ path: path.join(OUT, shot), animations: "disabled" });
  await ctx.close();
  return { rows, isDark };
};
const badgeOf = (rows, name) => (rows.find((r) => r.name === name) || {}).badge || "(not listed)";

try {
  const { rows } = await addAndRead(false, maps[0], "clinitek-status-plus-select-tests.png");
  check(`1a. Select Tests lists the ${KEY}'s 18 tests, each once`, rows.length === 18 && new Set(rows.map((r) => r.name)).size === 18, `${rows.length} rows`);
  const notWaived = WAIVED.filter((n) => badgeOf(rows, n) !== "WAIVED").map((n) => `${n}=${badgeOf(rows, n)}`);
  check(`1b. the ${WAIVED.length} tests FDA lists as waived show WAIVED`, notWaived.length === 0, notWaived.join("; "));
  const notModerate = MODERATE.filter((n) => badgeOf(rows, n) !== "MODERATE").map((n) => `${n}=${badgeOf(rows, n)}`);
  check(`2. the ${MODERATE.length} left for the naming work show MODERATE`, notModerate.length === 0, notModerate.join("; "));
} catch (e) { check("light section ran to the end", false, String(e?.message || e).split("\n")[0]); }

try {
  const { rows, isDark } = await addAndRead(true, maps[1], "clinitek-status-plus-select-tests-dark.png");
  const notWaived = WAIVED.filter((n) => badgeOf(rows, n) !== "WAIVED");
  check("3a. dark mode: the page is dark and the same 11 show WAIVED", isDark && notWaived.length === 0, `dark=${isDark} ${notWaived.join("; ")}`);
} catch (e) { check("dark section ran to the end", false, String(e?.message || e).split("\n")[0]); }

check("3b. no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
