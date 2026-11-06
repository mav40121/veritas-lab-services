// scripts/verify-demo-fixture-rename-ui.mjs
// Gate 3 receipt for Michael Q190 = 1: the demo lab fixture is Sample Regional Medical Center. Run against a LOCAL production build on a scratch database, with made-up people (it registers
// people and writes to the scratch database, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-demo-fixture-rename-ui.mjs
// In a real browser: the home page and every demo page carry the new name and "(fictional)" and no old name. All seven sample PDFs are clicked and read, with made-up analysts. The other demo
// PDFs and the workbook are read. Then the scratch database is put in production's state and the admin rename runs: the dry run changes nothing on the page, the write does. Light, dark and phone.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const NEW = "Sample Regional Medical Center", CLIA = "22D0999999";
const OLD_WORD = ["River", "side"].join(""), OLD = `${OLD_WORD} Regional Medical Center`, OLD_PREFIX = `${OLD_WORD} Regional`;
const REAL_ANALYSTS = /M\. Veri|J\. Hall|D\. McCormick/;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `site-demorename-${name}.png`), fullPage: false, animations: "disabled" });
const pdfText = (file, png) => {
  const py = "import fitz,json,re,sys\nd=fitz.open(sys.argv[1])\nif len(sys.argv)>2: d[0].get_pixmap(dpi=90).save(sys.argv[2])\nprint(json.dumps({'text':' '.join(re.sub(r'\\s+',' ',p.get_text()) for p in d),'meta':d.metadata}))";
  const out = spawnSync("python", ["-c", py, file, ...(png ? [png] : [])], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  if (out.status !== 0) throw new Error(out.stderr.slice(0, 400));
  return JSON.parse(out.stdout).text;
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const noOld = (text) => !text.includes(OLD_WORD);
const browser = await chromium.launch();
const errors = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  await page.evaluate((scheme) => localStorage.setItem("theme", scheme), opts.colorScheme || "light");
  return page;
};
const text = (page) => page.evaluate(() => document.body.innerText);
const go = async (page, p) => { await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" }); };
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// ── Public pages ─────────────────────────────────────────────────────────────
const page = await open();
await go(page, "/");
const home = await text(page);
check("home: the demo preview names the new lab, fictional", home.includes(`${NEW} (fictional)`.toUpperCase()) || home.includes(`${NEW} (fictional)`), home.slice(0, 200));
check("home: no old name", noOld(home));
await page.getByText(/Demo Preview/i).first().scrollIntoViewIfNeeded();
await shot(page, "home");

await go(page, "/demo/compliance");
await page.getByText(/Live Demo - /).first().waitFor({ timeout: 20000 });
const banner = await page.getByText(/Live Demo - /).first().innerText();
check("compliance demo: the banner names the new lab and says fictional", banner.includes(`Live Demo - ${NEW} (fictional) | A sample lab for demonstration only`), banner);
check("compliance demo: no em dash in the banner", !/—/.test(banner));
await shot(page, "compliance");
const tabLabels = ["VeritaCheck", "VeritaMap", "VeritaScan", "VeritaComp", "VeritaStaff", "VeritaPT", "VeritaLab", "VeritaDC", "VeritaQC", "VeritaTrack", "VeritaResponse"];
const tabsWithOld = [];
for (const label of tabLabels) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
  await page.waitForLoadState("networkidle");
  if (!noOld(await text(page))) tabsWithOld.push(label);
}
check("compliance demo: no tab shows the old name", tabsWithOld.length === 0, tabsWithOld.join(", "));
await page.getByRole("button", { name: /^VeritaMap/ }).first().click();
const mapTitle = page.getByRole("heading", { name: /2026 Compliance Map/ }).first();
await mapTitle.waitFor({ timeout: 15000 });
check("compliance demo: the map's title has the new name", (await mapTitle.innerText()) === "Sample Regional - 2026 Compliance Map", await mapTitle.innerText());

await go(page, "/demo/operations");
const ops = await text(page);
check("operations demo: says fictional", ops.includes(`${NEW} (fictional)`), ops.slice(0, 200));
check("operations demo: no old name", noOld(ops));
await go(page, "/demo/qc");
const qc = await text(page);
check("QC demo: names the new lab, fictional, and the fixture CLIA", qc.includes(`${NEW} (fictional), CLIA ${CLIA}`), qc.slice(0, 300));
check("QC demo: no old name", noOld(qc));
await shot(page, "qc");
await go(page, "/demo/cprt");
check("CPRT demo: no old name", noOld(await text(page)));

// ── The seven sample PDFs, by clicking ───────────────────────────────────────
await go(page, "/demo");
const selector = await text(page);
check("demo selector: names the new lab, fictional, and the fixture CLIA", selector.includes(`${NEW} (fictional), CLIA ${CLIA}`), selector.slice(0, 300));
check("demo selector: no old name", noOld(selector));
const samples = await page.locator('[data-testid^="button-sample-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
check("demo selector: seven sample reports", samples.length === 7, String(samples.length));
await page.locator('[data-testid^="button-sample-"]').first().scrollIntoViewIfNeeded();
await shot(page, "selector");
const seen = [];
for (const id of samples) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId(id).click()]);
  const file = path.join(OUT, `sample-${id}.pdf`);
  await dl.saveAs(file);
  seen.push({ id, text: pdfText(file, id.endsWith("correlation-method-comparison") ? path.join(OUT, "site-demorename-sample-pdf.png") : undefined) });
}
check("sample PDFs: every one names the new lab", seen.every((s) => s.text.includes(NEW)), seen.filter((s) => !s.text.includes(NEW)).map((s) => s.id).join(", "));
check("sample PDFs: none prints another lab's CLIA", seen.every((s) => (s.text.match(/\b\d{2}D\d{7}\b/g) || []).every((c) => c === CLIA)));
check("sample PDFs: no old name in any", seen.every((s) => noOld(s.text)), seen.filter((s) => !noOld(s.text)).map((s) => s.id).join(", "));
check("sample PDFs: no real person as analyst", seen.every((s) => !REAL_ANALYSTS.test(s.text)), seen.filter((s) => REAL_ANALYSTS.test(s.text)).map((s) => s.id).join(", "));
const allPdfText = seen.map((s) => s.text).join(" ");
// L. Brooks is the sensitivity sample's analyst, and that report type prints no analyst. The integration test checks the fixture.
for (const name of ["T. Alvarez, MLS(ASCP)", "R. Okafor, MLS(ASCP)"]) check(`sample PDFs: ${name} is on a report`, allPdfText.includes(name));

// ── The other demo downloads ─────────────────────────────────────────────────
const fetchPdf = async (label, method, url, body) => {
  const r = await fetch(`${BASE}${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json();
  const p = await fetch(`${BASE}/api/pdf/${j.token}`);
  const file = path.join(OUT, `${label}.pdf`);
  fs.writeFileSync(file, Buffer.from(await p.arrayBuffer()));
  return pdfText(file, path.join(OUT, `site-demorename-${label}.png`));
};
const cms = await fetchPdf("cms209", "GET", "/api/demo/staff/cms209");
check("CMS 209: new name, fictional address, fixture CLIA, no old name", cms.includes(NEW) && cms.includes("Sampletown") && cms.includes(CLIA) && noOld(cms), cms.slice(0, 300));
const comp = await fetchPdf("competency", "GET", "/api/demo/competency/pdf");
check("competency PDF: new name, no old name", comp.includes(NEW) && noOld(comp), comp.slice(0, 300));
await go(page, "/demo/compliance");
await page.getByRole("button", { name: /^VeritaScan/ }).first().click();
const [scanDownload] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: "Executive Summary PDF" }).click()]);
check("VeritaScan PDF: the file name has the new name", /Sample_Regional/.test(scanDownload.suggestedFilename()) && noOld(scanDownload.suggestedFilename()), scanDownload.suggestedFilename());
const scanFile = path.join(OUT, "scan.pdf");
await scanDownload.saveAs(scanFile);
const scan = pdfText(scanFile, path.join(OUT, "site-demorename-scan.png"));
check("VeritaScan PDF: new name, no old name", scan.includes("Sample Regional") && noOld(scan), scan.slice(0, 300));
await page.getByRole("button", { name: /^VeritaMap/ }).first().click();
const [mapDownload] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: /Export|Excel|Download/ }).first().click()]);
check("workbook button: the saved file has the new name", mapDownload.suggestedFilename() === "VeritaMap_Sample_Regional.xlsx", mapDownload.suggestedFilename());
const studies = await (await fetch(`${BASE}/api/demo/studies`)).json();
const studyList = Array.isArray(studies) ? studies : studies.studies || [];
const studyPdf = await fetch(`${BASE}/api/demo/studies/${studyList[0].id}/pdf`);
const studyJson = await studyPdf.json();
const studyFile = path.join(OUT, "study.pdf");
fs.writeFileSync(studyFile, Buffer.from(await (await fetch(`${BASE}/api/pdf/${studyJson.token}`)).arrayBuffer()));
const study = pdfText(studyFile);
check("study PDF: new name, no old name", study.includes(NEW) && noOld(study), study.slice(0, 300));
const xlsx = await fetch(`${BASE}/api/demo/map/excel`);
check("workbook: the file name has the new name", /Sample_Regional/.test(xlsx.headers.get("content-disposition") || "") && noOld(xlsx.headers.get("content-disposition") || ""), xlsx.headers.get("content-disposition"));
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(Buffer.from(await xlsx.arrayBuffer()));
let cells = "";
wb.eachSheet((s) => { cells += ` ${s.headerFooter?.oddHeader || ""} ${s.headerFooter?.oddFooter || ""}`; s.eachRow((row) => row.eachCell((c) => { cells += ` ${c.text}`; })); });
check("workbook: every sheet has the new name and none the old", cells.includes(NEW) && noOld(cells));

// ── Signed in: the quiz placeholder ──────────────────────────────────────────
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return j;
};
const email = `demorename-${Date.now()}@example.test`;
const owner = await call("POST", "/api/auth/register", { email, password: ["Demo", "rename", "77!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Placeholder Lab", plan: "hospital" })).labId;
const prog = (await call("POST", `/api/labs/${labId}/competency/programs`, { name: "Made-up Program", department: "Chemistry", type: "technical", methodGroups: [{ name: "Made-up Group", instruments: ["Made-up Analyzer"], analytes: [] }] }, owner.token)).id;
await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Quiz", questions: [{ id: "q1", question: "Made-up question?", options: ["A. one", "B. two"], correct_answer: "A", explanation: "" }] }, owner.token);
scratch((d) => { d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email); d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999995' WHERE id = ?").run(labId); });
const signedIn = await open();
const me = await call("GET", "/api/auth/me", undefined, owner.token);
await signedIn.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, me]);
await go(signedIn, `/labs/${labId}/veritacomp-app/${prog}?tab=quizzes`);
await signedIn.getByText("Made-up Quiz").first().click();
await signedIn.getByRole("button", { name: "Edit Quiz" }).click();
await signedIn.getByRole("heading", { name: "Edit Quiz" }).waitFor({ timeout: 15000 });
const placeholder = await signedIn.locator('input[placeholder*="MLA Competency Quiz"]').getAttribute("placeholder");
check("Edit Quiz: the placeholder names nobody real", placeholder === 'e.g. "Sample Lab MLA Competency Quiz"', placeholder);
await signedIn.locator('input[placeholder*="MLA Competency Quiz"]').scrollIntoViewIfNeeded();
await shot(signedIn, "quiz-placeholder");

// ── Production's state, then the admin rename ────────────────────────────────
const emDash = "—";
const demoId = scratch((d) => d.prepare("SELECT id FROM users WHERE email = 'demo@veritaslabservices.com'").get().id);
scratch((d) => {
  d.prepare("UPDATE users SET clia_lab_name = ? WHERE id = ?").run(OLD, demoId);
  d.prepare("UPDATE veritamap_maps SET name = ? WHERE user_id = ?").run(`${OLD_PREFIX} ${emDash} 2026 Compliance Map`, demoId);
  d.prepare("UPDATE veritascan_scans SET name = ? WHERE user_id = ?").run(`${OLD_PREFIX} ${emDash} 2026 Annual Inspection Readiness`, demoId);
});
const rename = async (body) => {
  const r = await fetch(`${BASE}/api/admin/demo-fixture/rename`, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-secret": ADMIN }, body: JSON.stringify(body) });
  return { s: r.status, j: await r.json() };
};
const showMap = async () => {
  await go(page, "/demo/compliance");
  await page.getByRole("button", { name: /^VeritaMap/ }).first().click();
  const h = page.getByRole("heading", { name: /2026 Compliance Map/ }).first();
  await h.waitFor({ timeout: 15000 });
  return h.innerText();
};
check("before the write: the page still shows the stored old title", (await showMap()).startsWith(OLD_PREFIX));
const dry = await rename({ dryRun: true });
check("dry run: counts the fixture and writes nothing", dry.s === 200 && dry.j.dryRun === true && dry.j.total >= 3 && (await showMap()).startsWith(OLD_PREFIX), JSON.stringify(dry.j).slice(0, 200));
check("dry run: no names in the answer", !/River|Sample Regional/.test(JSON.stringify(dry.j)));
const refused = await rename({ dryRun: false });
check("a write with no confirm words is refused", refused.s === 400 && refused.j.code === "CONFIRM_REQUIRED" && (await showMap()).startsWith(OLD_PREFIX));
const wrote = await rename({ dryRun: false, confirm: NEW });
check("the write changes what it counted", wrote.s === 200 && wrote.j.changed === dry.j.total && wrote.j.remaining === 0, JSON.stringify(wrote.j).slice(0, 200));
const after = await showMap();
check("after the write: the page shows the new title with no em dash", after === "Sample Regional - 2026 Compliance Map", after);
check("after the write: the page has no old name", noOld(await text(page)));
await shot(page, "map-after-write");

// ── Dark and phone ───────────────────────────────────────────────────────────
const dark = await open({ colorScheme: "dark" });
await go(dark, "/demo/compliance");
await dark.getByText(/Live Demo - /).first().waitFor({ timeout: 20000 });
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
check("dark: the banner says fictional", (await dark.getByText(/Live Demo - /).first().innerText()).includes("(fictional)"));
await shot(dark, "compliance-dark");
await go(dark, "/demo");
await dark.locator('[data-testid^="button-sample-"]').first().scrollIntoViewIfNeeded();
await shot(dark, "selector-dark");

const phone = await open({ viewport: { width: 390, height: 844 } });
await go(phone, "/demo/compliance");
await phone.getByText(/Live Demo - /).first().waitFor({ timeout: 20000 });
check("phone: the banner says fictional", (await phone.getByText(/Live Demo - /).first().innerText()).includes("(fictional)"));
check("phone: no sideways scroll", await noSideways(phone));
await shot(phone, "compliance-phone");
check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
