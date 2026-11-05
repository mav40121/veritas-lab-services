// scripts/verify-site-copy-modules-ui.mjs
// Gate 3 receipt for the module and demo pages of the 2026-11-05 site review. Run against a LOCAL production build on a scratch database:
//   PW_BASE=http://localhost:5197 OUT=<dir> node scripts/verify-site-copy-modules-ui.mjs
// In a real browser, logged out: module pages describe what ships, and the demo pages agree with themselves. Light, dark and phone shots.
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

const map = await text("/veritamap");
for (const gone of ["PT Program", "Competency Module", "Manufacturer QC", "Reference Range Source", "SOP / Policy Location", "IQCP Implemented", "competency assignment"]) {
  check(`VeritaMap: no "${gone}"`, !map.includes(gone));
}
for (const has of ["Correlation Req'd", "Cal Verification", "SOP Review", "Lab-Established Values"]) {
  check(`VeritaMap: lists "${has}"`, map.includes(has));
}
await page.screenshot({ path: `${OUT}/site-modules-veritamap.png` });
await page.getByText("Lab-Established Values (in the row)").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/site-modules-veritamap-columns.png` });

for (const [p, name] of [["/veritacomp", "VeritaComp"], ["/veritapolicy", "VeritaDC"], ["/veritascan", "VeritaScan"], ["/veritastaff", "VeritaStaff"], ["/veritalab", "VeritaLab"], ["/veritapt", "VeritaPT"], ["/veritatrack", "VeritaTrack"], ["/veritaassure", "VeritaAssure"], ["/veritacheck", "VeritaCheck"]]) {
  const t = await text(p);
  check(`${p} renders and names ${name}`, t.includes(name));
  check(`${p}: no "inspector-ready"`, !/inspector-ready/i.test(t));
  if (p !== "/veritaassure") check(`${p}: no "one click"`, !/one[- ]click/i.test(t));
  check(`${p}: no "Staff Portal"`, !t.includes("Staff Portal"));
}
const comp = await text("/veritacomp");
check("VeritaComp: no auto-complete claim for VeritaScan", !/automatically (marks|completes|updates).{0,40}VeritaScan/i.test(comp));
await page.screenshot({ path: `${OUT}/site-modules-veritacomp.png` });
await text("/veritaassure");
await page.screenshot({ path: `${OUT}/site-modules-veritaassure.png` });

const ops = await text("/demo/operations");
check("Operations demo: no 129 techs", !/\b129\b/.test(ops));
await page.screenshot({ path: `${OUT}/site-modules-demo-operations.png` });
const lab = await text("/demo/compliance");
check("Compliance demo renders", lab.length > 500);
await page.screenshot({ path: `${OUT}/site-modules-demo-compliance.png` });
check("Demo selector renders", (await text("/demo")).length > 200);
check("No page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const dark = await darkCtx.newPage();
await dark.goto(`${BASE}/`);
await dark.evaluate(() => localStorage.setItem("theme", "dark"));
await dark.goto(`${BASE}/veritamap`, { waitUntil: "networkidle" });
await dark.getByText("Lab-Established Values (in the row)").first().scrollIntoViewIfNeeded();
await dark.screenshot({ path: `${OUT}/site-modules-veritamap-dark.png` });

const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const phone = await phoneCtx.newPage();
for (const p of ["/veritamap", "/veritacomp", "/veritaassure", "/demo/operations", "/demo/compliance"]) {
  await phone.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  check(`phone ${p}: no sideways scroll`, await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
}
await phone.goto(`${BASE}/veritamap`, { waitUntil: "networkidle" });
await phone.screenshot({ path: `${OUT}/site-modules-veritamap-phone.png` });

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
