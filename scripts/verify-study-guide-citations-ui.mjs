// scripts/verify-study-guide-citations-ui.mjs
// Gate 3 browser receipt for BUG-012 (2026-10-09): the public Study Guide page cites
// real CFR paragraphs and states the CFR's twice-a-year comparison requirement.
// Read-only (public page, no sign-in). Usage:
//   PW_BASE=http://localhost:5152 OUT=<dir> node scripts/verify-study-guide-citations-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE || "http://localhost:5152", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  await page.goto(`${BASE}/study-guide`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  const body = await page.locator("body").innerText();
  check(`${mode}: no nonexistent paragraph 493.1253(b)(1)(iii)`, !/493\.1253\(b\)\(1\)\(iii\)/.test(body));
  check(`${mode}: reportable range cites 493.1253(b)(1)(i)(C)`, /493\.1253\(b\)\(1\)\(i\)\(C\)/.test(body));
  check(`${mode}: correlation cites 493.1281(a)`, /493\.1281\(a\)/.test(body));
  const rowText = async (name) => ((await page.locator("tr", { hasText: name }).first().innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  check(`${mode}: precision row cites 493.1253(b)(1)(i)(B)`, /493\.1253\(b\)\(1\)\(i\)\(B\)/.test(await rowText("Is my instrument producing consistent")));
  check(`${mode}: reference range row cites 493.1253(b)(1)(ii)`, /493\.1253\(b\)\(1\)\(ii\)/.test(await rowText("Can we adopt the manufacturer")));
  check(`${mode}: correlation frequency is twice a year, not annually`, /twice a year while two instruments or methods run the same test/.test(body) && !/annually recommended/i.test(body));
  const row = page.locator("tr", { hasText: "Correlation / Method Comparison" }).first();
  if (await row.count()) { await row.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/study_guide_correlation_${mode}.png` }); }
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
