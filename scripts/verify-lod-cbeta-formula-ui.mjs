// scripts/verify-lod-cbeta-formula-ui.mjs
// Browser receipt for BUG-190 (owner pick 2026-11-27, option 1): the detection-limit factor. Run against a LOCAL
// production build on a scratch database with made-up values (it registers an owner, provisions a lab and writes to
// SCRATCH_DB, so it refuses any other host):
//   PW_BASE=http://localhost:5217 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-lod-cbeta-formula-ui.mjs
// In a real browser:
//   1. the sensitivity form refuses low-level lines with and without a sample label mixed
//   2. Run Study on two labeled low-level samples: the results screen shows cp from the EP17-A2 formula with L, K and
//      its working, a Sample column, and no "Table A1"; Download PDF prints the same working with the director
//      review block on page 1; light and dark screenshots
//   3. a study saved before the change (its input names no method) shows the factor it was saved with (1.749), the
//      note that it keeps its saved result, and no "Table A1"; light and dark screenshots
//   4. a phone: the results screen has no sideways scroll
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5217", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token, labId) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return j;
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true, animations: "disabled" });

// ── A made-up lab ─────────────────────────────────────────────────────────────
const email = `lodcbeta-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Lod", "factor", "190!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Sensitivity Lab", plan: "hospital" })).labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999190' WHERE id = ?").run(labId);
});
const BLANKS = [0.004, 0.006, 0.005, 0.007, 0.005, 0.004, 0.006, 0.005, 0.008, 0.005, 0.006, 0.004, 0.005, 0.007, 0.006, 0.005, 0.004, 0.006, 0.005, 0.007];
const LOW20 = [0.019, 0.023, 0.020, 0.025, 0.021, 0.018, 0.022, 0.024, 0.020, 0.021, 0.023, 0.019, 0.022, 0.020, 0.024, 0.021, 0.018, 0.023, 0.022, 0.020];
const S2 = [0.031, 0.029, 0.033, 0.030, 0.028, 0.032, 0.030, 0.034, 0.029, 0.031];

// A study saved before the change, as main 25796039 saved it: no method in its input, the table's results.
const legacyInput = { mode: "establishment", blanks: BLANKS.map((v, i) => ({ value: v, lot: i < 10 ? "LotA" : "LotB" })), lowLevel: LOW20.map((value) => ({ value })), cvThreshold: 0.2, biasThreshold: 0.25 };
const legacyResults = { type: "sensitivity", mode: "establishment", lob: { parametric: 0.007386944411085372, nonParametric: 0.007050000000000001, meanBlank: 0.005500000000000001, sdBlank: 0.001147078669352809, nBlank: 20 },
  lod: { value: 0.010924988233892725, lobUsed: 0.007386944411085372, cBeta: 1.749, sdLowLevel: 0.0020228952674713283, nLowLevel: 20 }, loq: null, overallPass: true,
  summary: "Analytical sensitivity established per CLSI EP17-A2. LoB = 0.007 (parametric, n=20); LoD = 0.011 (n=20 low-level replicates, Cβ=1.749). PASSED the establishment criterion." };
const legacy = await call("POST", `/api/labs/${labId}/studies`, {
  testName: "Made-up Troponin (saved before)", instrument: "Made-up analyzer", analyst: "-", date: "2026-11-01", studyType: "sensitivity", cliaAllowableError: 0, teaIsPercentage: 0,
  teaUnit: "ng/mL", cliaAbsoluteFloor: null, cliaAbsoluteUnit: "ng/mL", cliaPresetLabel: "Set by study type", dataPoints: JSON.stringify({ input: legacyInput, results: legacyResults }),
  instruments: JSON.stringify(["Made-up analyzer"]), status: "pass", createdAt: new Date().toISOString(),
}, reg.token, labId);
check("0. a lab and a study saved before the change", !!labId && Number(legacy.id) > 0, JSON.stringify(legacy).slice(0, 200));

const browser = await chromium.launch();
const pageErrors = [];
const failedCalls = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failedCalls.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [reg.token, reg.user]);
  return page;
};
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.message || e).split("\n")[0]); } };
const pdfText = (file) => execFileSync("python", ["-E", "-c", "import sys, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nprint('\\f'.join(p.get_text() for p in fitz.open(sys.argv[1])))", file]).toString("utf-8").split("\f").map((t) => t.replace(/\s+/g, " "));
const fillForm = async (page, testName, lowLevelText) => {
  await page.goto(`${BASE}/labs/${labId}/study/new`, { waitUntil: "networkidle" });
  await page.getByTestId("input-test-name").fill(testName);
  await page.getByTestId("select-study-type").click();
  await page.getByRole("option", { name: /Sensitivity Verification/i }).click();
  await page.getByPlaceholder("e.g. Troponin I").fill("Made-up Troponin");
  await page.getByPlaceholder("e.g. ng/mL").fill("ng/mL");
  await page.getByRole("tab", { name: "Data Entry" }).click();
  await page.getByPlaceholder(/^0\.005/).fill(BLANKS.map((v, i) => `${v},${i < 10 ? "LotA" : "LotB"}`).join("\n"));
  await page.getByPlaceholder(/^0\.020/).fill(lowLevelText);
};
let newUrl = "";

// ── 1. The form refuses mixed sample labels ───────────────────────────────────
await section("1", async () => {
  const page = await open();
  await fillForm(page, "Made-up mixed labels", "0.020,,S1\n0.021,,S1\n0.022\n0.023\n0.024");
  await page.getByTestId("button-submit-study").click();
  const toast = page.getByText("Give every low-level line a sample label, or leave them all without one.").first();
  await toast.waitFor({ timeout: 10000 });
  check("1. the form refuses low-level lines with and without a sample label, and stays on the form", (await toast.isVisible()) && /\/study\/new/.test(page.url()), page.url());
  await page.context().close();
});

// ── 2. A new study, two samples ───────────────────────────────────────────────
await section("2", async () => {
  const page = await open();
  const lowText = [...LOW20.slice(0, 10).map((v) => `${v},LotA,S1`), ...S2.map((v) => `${v},,S2`)].join("\n");
  await fillForm(page, "Made-up Troponin (new)", lowText);
  await page.getByTestId("button-submit-study").click();
  await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
  await page.getByText("LoD detail", { exact: true }).waitFor({ timeout: 20000 });
  newUrl = page.url();
  const body = await page.locator("body").innerText();
  const working = await page.getByTestId("text-lod-factor-working").innerText();
  check("2a. the screen labels the factor cp (EP17-A2 formula) and shows 1.668", body.includes("cp (EP17-A2 formula)") && (await page.getByTestId("text-lod-factor").innerText()) === "1.668", working);
  check("2b. ... with L 20 and K 2", /L \(low-level results\)\s*20/.test(body) && /K \(low-level samples\)\s*2/.test(body));
  check("2c. ... and how cp was worked out, the SD pooled", working === "LoD = LoB + cp × SD(low level), where cp = 1.645 / (1 - 1/(4 x (L - K))) = 1.668 (L = 20 results, K = 2 samples; CLSI EP17-A2). SD(low level) is pooled within the samples.", working);
  check("2d. ... the low-level table has a Sample column with S1 and S2", (await page.locator("th", { hasText: /^Sample$/ }).count()) === 1 && body.includes("S2"));
  check("2e. ... no \"Table A1\" anywhere on the screen", !/table a1/i.test(body));
  const row = scratch((d) => d.prepare("SELECT data_points FROM studies WHERE test_name = 'Made-up Troponin (new)' ORDER BY id DESC LIMIT 1").get());
  const dp = JSON.parse(row.data_points);
  check("2f. the saved study records the method and K", dp.input.cbetaMethod === "ep17_formula" && dp.results.lod.cbetaMethod === "ep17_formula" && dp.results.lod.nLowLevelSamples === 2);
  await shot(page, "lod-new-study-light");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("button-download-pdf-sensitivity").click()]);
  const file = path.join(OUT, "lod-new-study.pdf");
  await dl.saveAs(file);
  const pages = pdfText(file);
  check("2g. Download PDF prints the same working", pages[0].includes("LoD = LoB + cp x SD(low level), where cp = 1.645 / (1 - 1/(4 x (L - K))) = 1.668 (L = 20 results, K = 2 samples; CLSI EP17-A2). SD(low level) is pooled within the samples."), pages[0].slice(0, 400));
  check("2h. ... the director review block on page 1, no \"Table A1\"", pages[0].includes("LABORATORY DIRECTOR OR DESIGNEE REVIEW") && !/Table A1/i.test(pages.join(" ")));
  await page.context().close();
  const dark = await open({ colorScheme: "dark" });
  await dark.goto(newUrl, { waitUntil: "networkidle" });
  await dark.getByText("LoD detail", { exact: true }).waitFor({ timeout: 20000 });
  const bg = await dark.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check("2i. dark mode: the page is dark and the working reads", /rgb\((\d+), (\d+), (\d+)\)/.test(bg) && Number(bg.match(/\d+/)[0]) < 60 && (await dark.getByTestId("text-lod-factor-working").isVisible()), bg);
  await shot(dark, "lod-new-study-dark");
  await dark.context().close();
});

// ── 3. The study saved before ─────────────────────────────────────────────────
await section("3", async () => {
  const url = `${BASE}/labs/${labId}/study/${legacy.id}/results`;
  for (const scheme of ["light", "dark"]) {
    const page = await open({ colorScheme: scheme });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByText("LoD detail", { exact: true }).waitFor({ timeout: 20000 });
    const body = await page.locator("body").innerText();
    const working = await page.getByTestId("text-lod-factor-working").innerText();
    if (scheme === "light") {
      check("3a. a study saved before shows the factor it was saved with, 1.749, labeled as saved", (await page.getByTestId("text-lod-factor").innerText()) === "1.749" && body.includes("cβ (as saved)"));
      check("3b. ... its LoD and verdict as saved (0.011, PASS) and the summary as main wrote it", body.includes("LoD = 0.011 (n=20 low-level replicates, Cβ=1.749)") && /Verdict\s*PASS/.test(body));
      check("3c. ... the note says it keeps its saved result, with no \"Table A1\"", working.includes("keeps the result it was saved with") && !/table a1/i.test(body), working);
      check("3d. ... no K, no Sample column", !body.includes("K (low-level samples)") && (await page.locator("th", { hasText: /^Sample$/ }).count()) === 0);
    }
    await shot(page, `lod-saved-before-${scheme}`);
    await page.context().close();
  }
});

// ── 4. A phone ────────────────────────────────────────────────────────────────
await section("4", async () => {
  const page = await open({ viewport: { width: 390, height: 844 } });
  await page.goto(newUrl, { waitUntil: "networkidle" });
  await page.getByText("LoD detail", { exact: true }).waitFor({ timeout: 20000 });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("4. a phone: the results screen has no sideways scroll", wide <= 0, `${wide}px`);
  await shot(page, "lod-new-study-phone");
  await page.context().close();
});

check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
const unexpected = failedCalls.filter((c) => !/\/api\/(onboarding|notifications)/.test(c));
check("no failed API calls", unexpected.length === 0, unexpected.join(" | "));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
