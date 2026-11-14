// scripts/verify-c29-inspections-ui.mjs
// Browser receipt for site review C-29 (Michael 2026-11-13, pick 1): the site counts Michael's work as "inspections"
// everywhere, as about 40 places and the cold letters already did; "Joint Commission surveyor" stays his title.
// Read-only: it only loads public pages. Run against a LOCAL production build:
//   PW_BASE=http://localhost:5322 OUT=<dir> node scripts/verify-c29-inspections-ui.mjs
//   1. each changed page carries the new words and none of the old (page text, hidden accordion text included);
//   2. /veritaassure's served meta description (what a crawler reads) and the one in the browser are the new one;
//   3. dark mode, no page errors.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE, OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("Run this against a local build.");
const OLD = ["Facilities surveyed", "200 surveys", "TJC surveys conducted", "200 laboratory surveys", "hundred surveys", "200+ Joint Commission surveys"];
const NEW_DESC = "built by a former Joint Commission surveyor with 200+ facility inspections.";
const PAGES = [
  ["/", ["Facility inspections"]],
  ["/services", ["over 200 facility inspections nationally", "over 200 inspections at", "200+ facility inspections nationally", "TJC Laboratory"]],
  ["/faq", ["more than 200 laboratory inspections across the country"]],
  ["/resources/cost-per-reportable-test-four-layer-framework", ["more than two hundred inspections with The Joint Commission"]],
  ["/veritaassure", []],
];
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };

const served = await (await fetch(`${BASE}/veritaassure`)).text();
const servedDesc = (served.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
check("2a. /veritaassure served meta description is the new one", servedDesc.includes(NEW_DESC) && !servedDesc.includes("surveys."), servedDesc);

const browser = await chromium.launch();
const errors = [];
for (const dark of [false, true]) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  if (dark) { await page.goto(`${BASE}/`); await page.evaluate(() => localStorage.setItem("theme", "dark")); }
  for (const [p, want] of PAGES) {
    try {
      await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      if (p === "/faq") {
        // The FAQ is an accordion that leaves a closed answer out of the page; open the one that changed.
        await page.getByRole("button", { name: "Who built VeritaAssure® ?" }).or(page.getByRole("button", { name: /^Who built VeritaAssure/ })).first().click();
        await page.waitForTimeout(400);
      }
      const text = (await page.evaluate(() => document.body.textContent || "")).replace(/\s+/g, " ");
      if (!dark) {
        const missing = want.filter((w) => !text.includes(w));
        check(`1. ${p}: carries the new words`, missing.length === 0, JSON.stringify(missing));
        const left = OLD.filter((o) => text.includes(o));
        check(`1. ${p}: none of the old words`, left.length === 0, JSON.stringify(left));
      }
      if (p === "/veritaassure") {
        const d = await page.evaluate(() => document.querySelector('meta[name="description"]')?.getAttribute("content") || "");
        if (!dark) check("2b. /veritaassure description in the browser is the new one", d.includes(NEW_DESC), d);
      }
      if (p === "/") {
        const stat = page.getByText("Facility inspections", { exact: true }).first();
        if (dark) check("3a. dark mode: the home page is dark and shows the stat", await page.evaluate(() => document.documentElement.classList.contains("dark")) && await stat.isVisible(), "");
        await stat.scrollIntoViewIfNeeded().catch(() => {});
        await page.evaluate(() => window.scrollBy(0, -250));
        await page.screenshot({ path: path.join(OUT, `c29-home-stat-${dark ? "dark" : "light"}.png`), animations: "disabled" });
      }
      if (p === "/services" && !dark) {
        await page.getByText("200+ facility inspections nationally").first().scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -300));
        await page.screenshot({ path: path.join(OUT, "c29-services-bio-light.png"), animations: "disabled" });
      }
    } catch (e) { check(`${p} (${dark ? "dark" : "light"}) loaded`, false, String(e?.message || e).split("\n")[0]); }
  }
  await ctx.close();
}
check("3b. no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
