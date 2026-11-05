// scripts/verify-site-copy-regulatory-ui.mjs
// Gate 3 receipt for the regulatory articles and Study Guide of the 2026-11-05 site review. Run against a LOCAL production build on a scratch database:
//   PW_BASE=http://localhost:5197 OUT=<dir> node scripts/verify-site-copy-regulatory-ui.mjs
// In a real browser, logged out: the articles render, state Michael's position on PT limits (Q174 = 1), and no longer carry the citations the review found wrong.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE || "http://localhost:5197", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const text = async (p) => { await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" }); return page.locator("body").innerText(); };

const PT = /typical and recommended|more conservative|easier[- ]to[- ]defend|(?:PT limit|CLIA PT|\bTEa\b)[^.]{0,120}defensible|defensible[^.]{0,120}(?:PT limit|CLIA PT|\bTEa\b)/;
const pages = [
  ["/resources/clia-tea-what-lab-directors-dont-know", "TEa", ["2025 final rule", "2025 Final Rule"]],
  ["/resources/clia-calibration-verification-method-comparison", "alibration", ["August 4", "CAMLAB"]],
  ["/resources/calibration-verification-requirements-clia", "alibration", ["COM.30450"]],
  ["/resources/ep26-reagent-lot-verification", "EP26", []],
  ["/resources/how-to-perform-method-comparison-study", "omparison", ["COM.30650", "COM.30700"]],
  ["/resources/tjc-laboratory-inspection-what-to-expect", "Joint Commission", ["CAMLAB"]],
  ["/resources/quality-control-testing-into-compliance", "Quality Control", []],
  ["/resources/verifying-reference-intervals", "eference", []],
  ["/resources/precision-verification-report-interpretation-guide", "recision", []],
  ["/resources/proficiency-testing-clia-pt-referral", "roficiency", []],
  ["/resources/post-analytical-critical-values-corrected-reports", "ritical", []],
  ["/resources/clia-brochures-every-lab-leader-should-read", "rochure", []],
  ["/resources/clia-tea-lookup", "TEa", ["RCPA"]],
  ["/study-guide", "Study", []],
];
for (const [p, must, gone] of pages) {
  const t = await text(p);
  check(`${p} renders`, t.includes(must) && t.length > 500);
  check(`${p}: no PT limit recommendation wording`, !PT.test(t), (t.match(PT) || [""])[0]);
  for (const g of gone) check(`${p}: no "${g}"`, !t.includes(g));
}
const tea = await text("/resources/clia-tea-what-lab-directors-dont-know");
check("TEa article says the criterion is the lab's and CMS's position", /CMS-3355-F/.test(tea) && /performance goals/i.test(tea));
check("TEa article gives the rule's dates", /July 11, 2022/.test(tea) && /July 11, 2024/.test(tea));
await page.getByText(/performance goals/i).first().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/site-reg-tea-article.png` });
const cal = await text("/resources/clia-calibration-verification-method-comparison");
check("Cal ver article: six months plus twenty days from July 15 is Feb 4", /Next deadline: Feb 4/.test(cal));
await page.getByText(/Next deadline: Feb 4/).first().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/site-reg-calver.png` });
await text("/study-guide");
await page.screenshot({ path: `${OUT}/site-reg-study-guide.png` });
check("No page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const dark = await darkCtx.newPage();
await dark.goto(`${BASE}/`);
await dark.evaluate(() => localStorage.setItem("theme", "dark"));
await dark.goto(`${BASE}/resources/clia-tea-what-lab-directors-dont-know`, { waitUntil: "networkidle" });
await dark.screenshot({ path: `${OUT}/site-reg-tea-dark.png` });

const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const phone = await phoneCtx.newPage();
for (const p of ["/resources/clia-tea-what-lab-directors-dont-know", "/resources/clia-calibration-verification-method-comparison", "/study-guide"]) {
  await phone.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  check(`phone ${p}: no sideways scroll`, await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
}
await phone.goto(`${BASE}/resources/clia-tea-what-lab-directors-dont-know`, { waitUntil: "networkidle" });
await phone.screenshot({ path: `${OUT}/site-reg-tea-phone.png` });

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
