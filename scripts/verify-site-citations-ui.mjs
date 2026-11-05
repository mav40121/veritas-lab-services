// scripts/verify-site-citations-ui.mjs
// Gate 3 receipt for the citations and TEa changes of the 2026-11-05 site review. Run against a LOCAL server on a scratch database, with made-up
// people (it registers an owner and provisions a lab, so never point it at production). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-site-citations-ui.mjs
// In a real browser: the public TEa lookup shows the eCFR values; the free PDFs download; the VeritaCheck TEa dropdown offers Prothrombin Time and the
// three added toxicology presets; a sample report generates. Light, dark and phone shots.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const PW = ["Cite", "chk", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try { return await r.json(); } catch { return {}; }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${BASE}/resources/clia-tea-lookup`, { waitUntil: "networkidle" });
const search = page.locator("input").first();
for (const [term, expected] of [["Vancomycin", "2 mcg/mL"], ["Antibody Identification", "80%"], ["White Blood Cell Differential", "3 SD"], ["Cell Identification", "80%"], ["Tobramycin", "20%"], ["Valproic", "20%"], ["Albumin", "8%"]]) {
  await search.fill(term);
  await page.waitForTimeout(150);
  const t = await page.locator("body").innerText();
  check(`TEa lookup: ${term} shows ${expected}`, t.includes(term) && t.includes(expected));
}
await search.fill("D-Dimer");
await page.waitForTimeout(150);
await search.fill("Vancomycin");
await page.waitForTimeout(150);
await page.screenshot({ path: `${OUT}/site-citations-tea-lookup.png` });
await search.fill("");

await page.goto(`${BASE}/resources`, { waitUntil: "networkidle" });
check("Resources: Compliance Matrix card is offered", (await page.locator("body").innerText()).includes("Compliance Matrix"));
const matrixLink = page.locator('a[href="/api/downloads/clsi-compliance-matrix"]').first();
await matrixLink.scrollIntoViewIfNeeded();
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), matrixLink.click()]);
check("Compliance Matrix downloads from the card", /Compliance_Matrix/.test(dl.suggestedFilename()), dl.suggestedFilename());
await dl.saveAs(`${OUT}/matrix.pdf`);
const pdf = await fetch(`${BASE}/clia-tea-reference-2026.pdf`);
check("TEa reference PDF is served", pdf.status === 200, String(pdf.status));

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
const sample = page.getByRole("button", { name: /Download sample PDF/ }).first();
await sample.scrollIntoViewIfNeeded();
const popupOrDownload = Promise.race([page.waitForEvent("download", { timeout: 60000 }).then(() => "download"), ctx.waitForEvent("page", { timeout: 60000 }).then(() => "page")]);
await sample.click();
check("Sample report generates in the browser", ["download", "page"].includes(await popupOrDownload));

const email = `cite-ui-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Citations UI Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
if (labId) sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999999' WHERE id = ?").run(labId);
const user = sdb.prepare("SELECT id, email, name, plan FROM users WHERE email = ?").get(email);
await page.goto(`${BASE}/`);
await page.evaluate(([t, u, id]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [reg.token, user, user.id]);
await page.goto(`${BASE}/study/new`, { waitUntil: "networkidle" });
const preset = page.getByRole("combobox").filter({ hasText: /ALT|Alanine|Albumin|Glucose|§493|±/ }).first();
await preset.scrollIntoViewIfNeeded();
await preset.click();
const options = (await page.getByRole("option").allInnerTexts()).join(" | ");
for (const a of ["Prothrombin Time", "Tobramycin", "Valproic", "Vancomycin"]) check(`VeritaCheck TEa dropdown offers ${a}`, options.includes(a));
check("CEA preset unit is ng/mL", /CEA[^|]*ng\/mL/.test(options) && !/CEA[^|]*ng\/dL/.test(options));
await page.getByRole("option", { name: /Vancomycin/ }).scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/site-citations-dropdown.png` });
await page.getByRole("option", { name: /Vancomycin/ }).click();
check("Choosing Vancomycin sets it on the study form", (await preset.innerText()).includes("Vancomycin"), await preset.innerText());
await page.keyboard.press("Escape");
await page.goto(`${BASE}/getting-started`, { waitUntil: "networkidle" });
check("Getting Started, signed in: Compliance Matrix link is offered", (await page.locator('a[href="/api/downloads/clsi-compliance-matrix"]').count()) === 1);
check("No page errors", errors.length === 0, errors.slice(0, 2).join(" | "));

const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const dark = await darkCtx.newPage();
await dark.goto(`${BASE}/`);
await dark.evaluate(() => localStorage.setItem("theme", "dark"));
await dark.goto(`${BASE}/resources/clia-tea-lookup`, { waitUntil: "networkidle" });
await dark.screenshot({ path: `${OUT}/site-citations-tea-dark.png` });

const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const phone = await phoneCtx.newPage();
for (const p of ["/resources/clia-tea-lookup", "/resources"]) {
  await phone.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  check(`phone ${p}: no sideways scroll`, await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
}
await phone.goto(`${BASE}/resources/clia-tea-lookup`, { waitUntil: "networkidle" });
await phone.screenshot({ path: `${OUT}/site-citations-tea-phone.png` });

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
