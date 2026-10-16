// scripts/verify-trust-page-ui.mjs
//
// Browser receipt: Trust page update (2026-10-16). LOCAL production build with the Content-Security-Policy enforced.
//   1. sections 8 Backups, 9 Availability, 10 Your Records When You Leave are on the page, with the status link
//   2. no placeholder text ([...pending...]) and no em dash
//   3. no CSP violations; light, dark and 390px screenshots, no horizontal scroll at 390px
// Run: PW_BASE=http://localhost:5197 OUT=<dir> node scripts/verify-trust-page-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE, OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const browser = await chromium.launch();
for (const [scheme, width, tag] of [["light", 1280, "light"], ["dark", 1280, "dark"], ["light", 390, "390"]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  const csp = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await page.goto(`${BASE}/trust`, { waitUntil: "networkidle" });
  const text = await page.locator("body").innerText();
  if (tag === "light") {
    check("1a. new sections present", ["8. Backups and Disaster Recovery", "9. Availability", "10. Your Records When You Leave", "14. Contact"].every((h) => text.includes(h)));
    const href = await page.locator('a[href="https://stats.uptimerobot.com/NkcaSEJU2B"]').count();
    check("1b. the status page link is on the page", href === 1, String(href));
    check("1c. continuous backup, 4-hour recovery target and the four PHI checks are stated", /about once a second/.test(text) && /recovery time target is 4 hours/.test(text) && /As you type/.test(text) && /On upload/.test(text) && /Nightly/.test(text));
    check("2. no placeholder text and no em dash", !/\[[A-Z ]+:? ?pending|\[STATUS|\[RECOVERY/i.test(text) && !text.includes("\u2014"));
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`3${tag === "light" ? "a" : tag === "dark" ? "b" : "c"}. ${tag}: no CSP violations${tag === "390" ? ", no horizontal scroll" : ""}`, csp.length === 0 && (tag !== "390" || !overflow), csp.slice(0, 2).join(" | "));
  await page.getByText("8. Backups and Disaster Recovery").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/trust-page-${tag}.png` });
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
