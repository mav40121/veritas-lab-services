// scripts/verify-competency-register-ui.mjs
// Gate 3 browser receipt for the Testing Personnel Competency Register and the "How competency timing works" panel
// (Michael Q74 = 1, plan part C, 2026-10-11). As the lab owner: VeritaComp shows the timing panel (collapses and
// re-opens), the "Competency Register" button downloads an .xlsx whose sheets and rows are right, and the same
// button on the VeritaStaff roster downloads it too. Run against a LOCAL server on a scratch database (it registers
// an owner and provisions a lab; never point it at production). Usage:
//   PW_BASE=http://localhost:5157 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-competency-register-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE || "http://localhost:5157", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `crui-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Register Owner", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Register Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Register Lab", cliaNumber: "11D7654330", accreditationBody: "CLIA_ONLY", complexity: "high" }, token);
const nora = (await call("POST", `${L}/staff/employees`, { lastName: "Hale", firstName: "Nora", title: "MLS", highestComplexity: "H", performsTesting: true, hireDate: "2026-01-05" }, token)).id;
const eli = (await call("POST", `${L}/staff/employees`, { lastName: "Moss", firstName: "Eli", title: "MLT", highestComplexity: "H", performsTesting: true, hireDate: "2012-06-01" }, token)).id;
await call("PUT", `${L}/staff/competency/${nora}`, { recordedAs: "new_hire", trainingCompletedAt: "2026-03-20", trainingDocumentedBy: "J. Trainer", initialCompletedAt: "2026-04-06", initialSignedBy: "T. Supervisor" }, token);
await call("PUT", `${L}/staff/competency/${eli}`, { recordedAs: "existing", lastAnnualCompletedAt: "2026-03-01", lastAnnualSignedBy: "T. Supervisor" }, token);
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
check("fixture: lab + new hire + existing staff", !!labId && !!nora && !!eli);

const browser = await chromium.launch();
const open = async (path, { dark = false, width = 1400 } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([tk, u, lab]) => { localStorage.setItem("veritas_token", tk); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(lab)); localStorage.setItem("theme", "light"); }, [token, me, labId]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  return { page, ctx };
};
const readXlsx = async (download) => {
  const p = `${OUT}/crui_download.xlsx`;
  await download.saveAs(p);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(p);
  return wb;
};

// VeritaComp: panel + download
let { page, ctx } = await open(`/labs/${labId}/veritacomp-app`);
const panel = page.getByTestId("competency-timing-panel");
await panel.waitFor({ timeout: 30000 });
const ptext = (await panel.innerText()).replace(/\s+/g, " ");
check("VeritaComp: timing panel shows the rule (initial before patient testing; 6-month at initial + 6; 1st annual at initial + 12) and the CFR sources",
  /before patient testing/.test(ptext) && /initial \+ 6 months/.test(ptext) && /initial \+ 12 months/.test(ptext) && /493\.1451\(b\)\(9\)/.test(ptext) && /HR\.01\.04\.01/.test(ptext), ptext.slice(0, 200));
const overflowDesk = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const lastBtnRight = await page.evaluate(() => Math.max(...Array.from(document.querySelectorAll("button")).filter((b) => /New Program/.test(b.textContent || "")).map((b) => b.getBoundingClientRect().right)));
check("desktop (1400): header buttons stay inside the page (no overflow; New Program fully visible)", overflowDesk <= 1 && lastBtnRight <= 1400, `overflow ${overflowDesk}px, New Program right edge ${Math.round(lastBtnRight)}`);
await page.screenshot({ path: `${OUT}/crui_comp_panel_light.png` });
await page.getByTestId("competency-timing-toggle").click();
check("panel collapses", !(await page.getByText("The clock starts at the initial.").isVisible()));
await page.getByTestId("competency-timing-toggle").click();
check("panel re-opens", await page.getByText("The clock starts at the initial.").isVisible());
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByTestId("button-competency-register").first().click()]);
const fname = dl.suggestedFilename();
const wb = await readXlsx(dl);
const tp = wb.getWorksheet("Testing Personnel");
const names = [];
for (let i = 2; i <= tp.rowCount; i++) names.push(String(tp.getRow(i).getCell(1).value));
check("VeritaComp: 'Competency Register' downloads Competency_Register_Register_Lab_<date>.xlsx with About first and both people", /^Competency_Register_Register_Lab_\d{4}-\d{2}-\d{2}\.xlsx$/.test(fname) && wb.worksheets[0].name === "About" && names.join("|") === "Hale, Nora|Moss, Eli", `${fname} | ${wb.worksheets.map((w) => w.name).join(",")} | ${names.join("|")}`);
await ctx.close();

({ page, ctx } = await open(`/labs/${labId}/veritacomp-app`, { dark: true }));
await page.getByTestId("competency-timing-panel").waitFor({ timeout: 30000 });
await page.screenshot({ path: `${OUT}/crui_comp_panel_dark.png` });
await ctx.close();

({ page, ctx } = await open(`/labs/${labId}/veritacomp-app`, { width: 390 }));
await page.getByTestId("competency-timing-panel").waitFor({ timeout: 30000 });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await page.screenshot({ path: `${OUT}/crui_comp_mobile.png` });
check("phone width (390): VeritaComp has no horizontal page scroll", overflow <= 1, `overflow ${overflow}px`);
await ctx.close();

({ page, ctx } = await open(`/labs/${labId}/veritastaff-app`, { width: 390 }));
await page.getByTestId("button-competency-register").waitFor({ timeout: 30000 });
const overflowStaff = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
await page.screenshot({ path: `${OUT}/crui_staff_mobile.png` });
check("phone width (390): VeritaStaff roster has no horizontal page scroll", overflowStaff <= 1, `overflow ${overflowStaff}px`);
await ctx.close();

// VeritaStaff roster: same download
({ page, ctx } = await open(`/labs/${labId}/veritastaff-app`));
const btn = page.getByTestId("button-competency-register");
await btn.waitFor({ timeout: 30000 });
const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), btn.click()]);
const wb2 = await readXlsx(dl2);
check("VeritaStaff roster: 'Competency Register' downloads the same workbook", wb2.worksheets.map((w) => w.name).join("|") === "About|Testing Personnel|Duty-Change Reevaluations");
await page.screenshot({ path: `${OUT}/crui_staff_header_light.png`, clip: { x: 0, y: 0, width: 1400, height: 260 } });
await ctx.close();
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
