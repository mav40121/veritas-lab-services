// scripts/verify-site-copy-faq-ui.mjs
// Gate 3 receipt for the FAQ and product articles of the 2026-11-05 site review. Run against a LOCAL production build on a scratch database:
//   PW_BASE=http://localhost:5197 OUT=<dir> node scripts/verify-site-copy-faq-ui.mjs
// In a real browser, logged out: the FAQ and the eight product articles render, say what the product and the regulations say, and link where they should.
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

const faqHtml = await page.request.get(`${BASE}/faq`).then((r) => r.text());
const faq = await text("/faq");
const all = `${faq}\n${faqHtml}`;
check("FAQ renders", faq.length > 2000);
check("FAQ page: no VeritaPolicy", !faq.includes("VeritaPolicy"));
for (const gone of ["PT Program", "Competency Module", "IQCP Implemented", "defensible", "federally mandated", "COM.01300", "GEN.54500"]) {
  check(`FAQ source: no "${gone}"`, !all.includes(gone));
}
check("FAQ: the demo link uses www", !/[^.]veritaslabservices\.com\/demo/.test(all.replace(/www\.veritaslabservices\.com/g, "")));
await page.screenshot({ path: `${OUT}/site-faq.png` });

const articles = [
  ["/resources/why-veritacheck-vs-legacy-verification", "Why", ["for the entire lab"]],
  ["/resources/veritacheck-vs-ep-evaluator", "EP Evaluator", ["does not cite 42 CFR"]],
  ["/resources/how-to-validate-veritacheck-clia", "VeritaCheck", ["COM.01300", "for CLIA Compliance"]],
  ["/resources/how-to-choose-lab-compliance-software", "software", []],
  ["/resources/how-veritaassure-trains-lab-leaders", "VeritaAssure", ["a real hospital lab"]],
  ["/resources/manual-logs-why-most-labs-should-stop", "log", ["CAP, TJC, and CLIA all require"]],
  ["/resources/laboratory-inventory-management", "nventory", []],
  ["/resources/cost-per-reportable-test-four-layer-framework", "CPRT", []],
];
for (const [p, must, gone] of articles) {
  const t = await text(p);
  check(`${p} renders`, t.includes(must) && t.length > 800);
  for (const g of gone) check(`${p}: no "${g}"`, !t.includes(g));
}
await page.goto(`${BASE}/resources/veritacheck-vs-ep-evaluator`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/site-faq-compare.png` });
await page.goto(`${BASE}/resources/how-to-validate-veritacheck-clia`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/site-faq-validate.png` });
check("No page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const dark = await darkCtx.newPage();
await dark.goto(`${BASE}/`);
await dark.evaluate(() => localStorage.setItem("theme", "dark"));
await dark.goto(`${BASE}/faq`, { waitUntil: "networkidle" });
await dark.screenshot({ path: `${OUT}/site-faq-dark.png` });

const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const phone = await phoneCtx.newPage();
for (const p of ["/faq", "/resources/veritacheck-vs-ep-evaluator", "/resources/how-to-validate-veritacheck-clia"]) {
  await phone.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  check(`phone ${p}: no sideways scroll`, await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
}
await phone.goto(`${BASE}/faq`, { waitUntil: "networkidle" });
await phone.screenshot({ path: `${OUT}/site-faq-phone.png` });

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
