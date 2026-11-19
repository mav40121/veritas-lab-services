// scripts/verify-tjc-safer-ui.mjs
//
// Browser receipt (Gate 3 step 8) for SAFER placement on TJC findings (Lifepoint ask, Michael 2026-11-19). On a LOCAL
// production build with a scratch database and a made-up lab and finding (it registers a user and provisions a lab, so it
// refuses any other host):
//   S1. a TJC finding shows the SAFER card with the 3 x 3 grid, "Not placed yet.", and the ESC checklist names the
//       placement as missing; Generate TJC ESC PDF is disabled
//   S2. Moderate / Pattern: the placement shows, no leadership or preventive analysis fields, Save stores it, the checklist
//       is complete and the button is enabled
//   S3. High / Pattern: the two fields open, marked required; the checklist names both as missing; the button is disabled
//   S4. both written and saved: stored; the checklist is complete; Generate TJC ESC PDF downloads a PDF whose text has the
//       placement and both sections
//   S5. a CAP finding shows no SAFER card
//   plus dark mode and a phone width with no sideways scroll. Screenshots go to RECEIPT_DIR, or OUT when unset. Run (from the repo):
//   PW_BASE=http://localhost:5291 SCRATCH_DB=<scratch db> RECEIPT_DIR=<dir> node scripts/verify-tjc-safer-ui.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5291", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
const SHOTS = process.env.RECEIPT_DIR || process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required: this check flags the made-up lab TJC in a scratch database.");
mkdirSync(SHOTS, { recursive: true });
const PW = ["Saf", "er", "77!"].join("-");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `safer-${name}.png`), fullPage: true, animations: "disabled" });
const details = (id) => scratch((d) => JSON.parse(d.prepare("SELECT type_details FROM findings WHERE id = ?").get(id)?.type_details || "{}"));

// A made-up lab and two made-up findings
const stamp = Date.now();
const email = `safer-owner-${stamp}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Director", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up SAFER UI Lab", plan: "hospital" })).j.labId;
scratch((d) => {
  d.prepare("UPDATE labs SET accreditation_tjc = 1, accreditation_cap = 1, has_completed_onboarding = 1, clia_number = '99D9999993' WHERE id = ?").run(labId);
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
});
const H = { "X-Active-Lab-Id": String(labId) };
const post = async (body) => {
  const r = await fetch(`${BASE}/api/labs/${labId}/findings`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${owner.token}`, ...H }, body: JSON.stringify(body) });
  return (await r.json()).id;
};
const base3 = { description: "Made-up: reagent refrigerator temperature log missing three weekend days.", root_cause: "Made-up: no backup reader on weekends; no patient impact found.", corrective_action: "Made-up: weekend reader assigned; supervisor reviews the log daily." };
const tjcId = await post({ accreditor: "TJC", anchor_date: "2026-11-02", standard_ref: "Made-up RFI 1", ...base3 });
const capId = await post({ accreditor: "CAP", anchor_date: "2026-11-02", standard_ref: "Made-up CAP item", ...base3 });
check("setup: a made-up TJC lab with a TJC and a CAP finding", !!labId && !!tjcId && !!capId, JSON.stringify({ labId, tjcId, capId }));

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const errors = [];
const openAs = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, owner.token)).j;
  await page.evaluate(([tk, usr, scheme, lab]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(usr)); localStorage.setItem(`onboarding_dismissed_${usr.id}`, "1"); localStorage.setItem("theme", scheme); localStorage.setItem("veritas_active_lab_id", String(lab)); }, [owner.token, me.user ?? me, opts.colorScheme || "light", labId]);
  return page;
};
const url = (id) => `${BASE}/labs/${labId}/veritaresponse/${id}`;
const checklist = (page) => page.getByTestId("tjc-esc-element").evaluateAll((els) => els.map((e) => ({ t: e.textContent.trim(), p: e.getAttribute("data-present") })));
const genButton = (page) => page.getByRole("button", { name: /Generate TJC ESC PDF/ });
const save = async (page) => { await page.getByRole("button", { name: /^Save$/ }).click(); await page.waitForTimeout(1500); };
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const page = await openAs();
await page.goto(url(tjcId), { waitUntil: "networkidle" });
await page.getByTestId("tjc-safer-card").waitFor({ timeout: 20000 });
// S1
const cells = await page.locator('[data-testid^="safer-"][aria-pressed]').count();
const cl1 = await checklist(page);
check("S1a. the SAFER card shows a 3 x 3 grid and 'Not placed yet.'", cells === 9 && /Not placed yet/.test(await page.getByTestId("tjc-safer-current").innerText()), String(cells));
check("S1b. the ESC checklist names the placement as missing", cl1.some((e) => e.t.startsWith("SAFER placement") && e.p === "0"), JSON.stringify(cl1));
check("S1c. Generate TJC ESC PDF is disabled", await genButton(page).isDisabled());
await shot(page, "1-unplaced");
// S2
await page.getByTestId("safer-moderate-pattern").click();
check("S2a. Moderate / Pattern shows as the placement, with no High-row fields", /Moderate \/ Pattern/.test(await page.getByTestId("tjc-safer-current").innerText()) && (await page.getByTestId("tjc-safer-high").count()) === 0);
await save(page);
const d2 = details(tjcId);
check("S2b. Save stores it", d2.safer_likelihood === "moderate" && d2.safer_scope === "pattern", JSON.stringify(d2));
const cl2 = await checklist(page);
check("S2c. the checklist is complete and the button enabled", cl2.length === 4 && cl2.every((e) => e.p === "1") && !(await genButton(page).isDisabled()), JSON.stringify(cl2));
await shot(page, "2-moderate");
// S3
await page.getByTestId("safer-high-pattern").click();
const highText = await page.getByTestId("tjc-safer-high").innerText();
check("S3a. High / Pattern opens both fields, marked required", /Leadership involvement \(required for a High likelihood to harm\)/.test(highText) && /Preventive analysis \(required for a High likelihood to harm\)/.test(highText), highText.slice(0, 200));
const cl3 = await checklist(page);
check("S3b. the checklist names both as missing and the button is disabled", cl3.filter((e) => e.p === "0").map((e) => e.t.split(" (")[0]).join("|") === "Leadership involvement|Preventive analysis" && await genButton(page).isDisabled(), JSON.stringify(cl3));
await shot(page, "3-high-missing");
// S4
await page.getByTestId("tjc-leadership").fill("Made-up: the lab director and the CNO review the log weekly for three months.");
await page.getByTestId("tjc-preventive-analysis").fill("Made-up: every refrigerator and freezer log in the lab was checked; two more had weekend gaps and were added.");
await save(page);
const d4 = details(tjcId);
check("S4a. both fields saved with the High / Pattern placement", d4.safer_likelihood === "high" && d4.safer_scope === "pattern" && /CNO/.test(d4.leadership_involvement || "") && /freezer/.test(d4.preventive_analysis || ""), JSON.stringify(d4));
const cl4 = await checklist(page);
check("S4b. the checklist is complete (6 items) and the button enabled", cl4.length === 6 && cl4.every((e) => e.p === "1") && !(await genButton(page).isDisabled()), JSON.stringify(cl4));
await shot(page, "4-high-done");
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), genButton(page).click()]);
const pdfPath = path.join(SHOTS, "safer-esc-high-pattern.pdf");
await dl.saveAs(pdfPath);
let pdfText = "";
try { pdfText = execFileSync("python", ["-E", "-c", "import sys,fitz;print(''.join(p.get_text() for p in fitz.open(sys.argv[1])))", pdfPath], { encoding: "utf8" }); } catch (e) { pdfText = `PDF_TEXT_ERROR ${e.message}`; }
check("S4c. the downloaded ESC PDF prints the placement and both sections", /High \/ Pattern/.test(pdfText) && /Leadership Involvement/i.test(pdfText) && /Preventive Analysis/i.test(pdfText) && /CNO review the log weekly|CNO/.test(pdfText), pdfText.slice(0, 300));
// S5
await page.goto(url(capId), { waitUntil: "networkidle" });
await page.getByText("Made-up CAP item").first().waitFor({ timeout: 20000 }).catch(() => {});
check("S5. a CAP finding shows no SAFER card", (await page.getByTestId("tjc-safer-card").count()) === 0);
// Dark mode and phone width
const dark = await openAs({ colorScheme: "dark" });
await dark.goto(url(tjcId), { waitUntil: "networkidle" });
await dark.getByTestId("tjc-safer-card").waitFor({ timeout: 20000 });
await dark.getByTestId("tjc-safer-card").scrollIntoViewIfNeeded();
await dark.screenshot({ path: path.join(SHOTS, "safer-5-dark.png"), animations: "disabled" });
check("dark: the card renders with the placement", /High \/ Pattern/.test(await dark.getByTestId("tjc-safer-current").innerText()));
const phone = await openAs({ viewport: { width: 390, height: 844 } });
await phone.goto(url(tjcId), { waitUntil: "networkidle" });
await phone.getByTestId("tjc-safer-card").waitFor({ timeout: 20000 });
await phone.getByTestId("tjc-safer-card").scrollIntoViewIfNeeded();
await phone.screenshot({ path: path.join(SHOTS, "safer-6-phone.png"), animations: "disabled" });
check("phone: no sideways page scroll", await noSideways(phone));
check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
writeFileSync(path.join(SHOTS, "safer-result.txt"), `${passes} PASS, ${failures} FAIL\n`);
console.log(failures === 0 ? `\nALL PASS (${passes})` : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
