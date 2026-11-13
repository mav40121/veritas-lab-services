// scripts/verify-site-data-claims-ui.mjs
//
// Browser receipt (Gate 3 step 8) for the site's data claims (Michael 2026-11-13, Q325 = 1; parking lot #96 and #120,
// before Lifepoint's legal and security review). Signed out, on a local production build, never production:
//   C1. home page: the no-PHI card keeps its patient-data sentence and no longer says there is "nothing for a breach, or
//       an inspector, to expose" (we do hold staff names and emails)
//   C2. FAQ: the export answer names the full download, which works after a subscription ends; the 2-year answer adds
//       deletion on request confirmed in writing within 30 days, and that backup copies expire within 2 years
//   C3. Privacy Policy section 7 says the same and the page carries the update date
//   C4. Trust page section 10 says the same and points to the backup schedule in section 8
//   C5. phone width: the FAQ has no sideways scroll; dark mode: the FAQ answer reads at 4.5:1 or better
// Screenshots go to OUT. Run: PW_BASE=http://localhost:5252 OUT=<dir> node scripts/verify-site-data-claims-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE, OUT = process.env.OUT || ".";
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const open = async (path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();
const openFaq = async (page, question) => {
  const trigger = page.getByRole("button", { name: question });
  await trigger.click();
  const item = trigger.locator("xpath=ancestor::*[@data-state][1]/..");
  await page.waitForTimeout(300);
  return { trigger, item };
};

try {
  // C1. Home page.
  const home = await open("/");
  const card = home.locator("p", { hasText: "never asks for, transmits, or stores protected health information" }).first();
  await card.waitFor({ timeout: 20000 });
  const cardText = squash(await card.innerText());
  check("C1. the no-PHI card keeps its patient-data sentence", cardText.includes("Every module works with statistical and compliance data only, never patient data."), cardText);
  check("C1. ... and no longer says there is nothing for a breach or an inspector to expose", !/breach|inspector, to expose/.test(cardText), cardText);
  await card.locator("xpath=ancestor::div[2]").screenshot({ path: `${OUT}/home-no-phi-card.png` });

  // C2. FAQ.
  const faq = await open("/faq");
  const q1 = "Can I export my data before canceling?";
  const q2 = "What happens after the 2-year retention period?";
  await faq.getByRole("button", { name: q1 }).click();
  await faq.getByRole("button", { name: q2 }).click();
  await faq.waitForTimeout(400);
  const body = squash(await faq.locator("body").innerText());
  check("C2. the export answer names the full download and that it works after a subscription ends",
    body.includes("download all of the lab's records at any time, including after a subscription ends") && body.includes("the same records as JSON"), body.slice(body.indexOf(q1), body.indexOf(q1) + 500));
  check("C2. the 2-year answer adds deletion on request, confirmed in writing within 30 days",
    body.includes("You can ask us to delete it sooner at any time, and we confirm the deletion in writing within 30 days."), body.slice(body.indexOf(q2), body.indexOf(q2) + 500));
  check("C2. ... and that backup copies expire within 2 years", body.includes("Copies already in our backups expire on our backup schedule, the last within 2 years."));
  const q3 = "Can I request deletion of my data before the retention period ends?";
  await faq.getByRole("button", { name: q3 }).click();
  await faq.waitForTimeout(300);
  const body3 = squash(await faq.locator("body").innerText());
  check("C2. the early-deletion answer says what goes and that it's confirmed in writing within 30 days",
    body3.includes("We delete your lab's records, its people's accounts and its stored files, and confirm the deletion in writing within 30 days."), body3.slice(body3.indexOf(q3), body3.indexOf(q3) + 400));
  const section = faq.locator("h3", { hasText: "Data Retention and Cancellation" }).locator("xpath=..");
  await section.screenshot({ path: `${OUT}/faq-retention-light.png` });

  // C3. Privacy Policy.
  const priv = await open("/privacy");
  const privText = squash(await priv.locator("body").innerText());
  check("C3. Privacy section 7: deletion confirmed in writing within 30 days", privText.includes("we will delete your data and confirm the deletion in writing within 30 days, except where retention is required by law."));
  check("C3. ... backup copies expire within 2 years of the deletion", privText.includes("Copies already in our backups are not altered; they expire on our backup schedule, the last within 2 years of the deletion."));
  check("C3. ... the page carries the update date", privText.includes("Updated November 13, 2026"));
  await priv.locator("section", { hasText: "7. Data Retention" }).screenshot({ path: `${OUT}/privacy-section-7.png` });

  // C4. Trust page.
  const trust = await open("/trust");
  const trustText = squash(await trust.locator("body").innerText());
  check("C4. Trust section 10: deleted and confirmed in writing within 30 days", trustText.includes("the data is deleted and the deletion confirmed in writing within 30 days"));
  check("C4. ... backup copies expire on section 8's schedule", trustText.includes("Copies already in the backups described in section 8 expire on that schedule, the last within two years."));
  await trust.locator("section", { hasText: "10. Your Records When You Leave" }).screenshot({ path: `${OUT}/trust-section-10.png` });

  // C5. Phone width and dark mode.
  const phone = await open("/faq", { viewport: { width: 390, height: 844 } });
  await phone.getByRole("button", { name: q2 }).click();
  await phone.waitForTimeout(300);
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("C5. phone width: the FAQ has no sideways scroll", overflow <= 1, `overflow ${overflow}px`);
  await phone.screenshot({ path: `${OUT}/faq-phone.png` });
  const dark = await open("/faq", { colorScheme: "dark" });
  await dark.evaluate(() => document.documentElement.classList.add("dark"));
  await dark.getByRole("button", { name: q2 }).click();
  await dark.waitForTimeout(300);
  const answer = dark.locator("p", { hasText: "You can ask us to delete it sooner" }).first();
  const ratio = await answer.evaluate((el) => {
    const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 4).map(Number);
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fg = rgb(getComputedStyle(el).color);
    let n = el, bg = null;
    while (n) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) { bg = c; break; } n = n.parentElement; }
    bg = bg || [255, 255, 255];
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (a + 0.05) / (b + 0.05);
  });
  check("C5. dark mode: the FAQ answer reads at 4.5:1 or better", ratio >= 4.5, ratio.toFixed(2));
  await dark.locator("h3", { hasText: "Data Retention and Cancellation" }).locator("xpath=..").screenshot({ path: `${OUT}/faq-retention-dark.png` });
} finally {
  await browser.close();
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
