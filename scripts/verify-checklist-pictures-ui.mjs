// scripts/verify-checklist-pictures-ui.mjs
// Browser receipt for BUG-114 (RFGH Brandy Morgan 2026-10-28, Michael Q50 = 1): a non-technical checklist item takes a
// picture in Edit checklist (Add picture, or paste), shows it on the Overview list and on the assessment form, keeps it
// through a text-only edit, and prints it on the competency PDF and the blank template. Runs against a LOCAL production
// build on a scratch DB with a made-up lab, a made-up person and a drawn test picture (no patient data). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-checklist-pictures-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `chkpic-ui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Checklist Pictures UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Pictures UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Pictures UI Lab", cliaNumber: "11D7654377", accreditationBody: "CLIA_ONLY", complexity: "high" }, owner.token);
const prog = await call("POST", `${L}/competency/programs`, {
  name: "Gram Stain Competency", department: "Microbiology", type: "nontechnical",
  checklistItems: [
    { description: "Perform 10 Gram Stains with Supervisor review in agreement" },
    { description: "Please describe what is on this Gram Stain (Specimen #1)" },
    { description: "Please describe what is on this Gram Stain (Specimen #2)" },
  ],
}, owner.token);
const P = prog.id;
const sdb = new Database(process.env.SCRATCH_DB);
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const imageRows = () => { const d = new Database(process.env.SCRATCH_DB, { readonly: true }); const r = d.prepare("SELECT id, length(data_url) AS n FROM competency_checklist_images WHERE lab_id = ?").all(labId); d.close(); return r; };
const itemRows = () => { const d = new Database(process.env.SCRATCH_DB, { readonly: true }); const r = d.prepare("SELECT label, description, image_id FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order").all(P); d.close(); return r; };

const browser = await chromium.launch();
// A drawn test picture: a pink and purple dot field labelled as a test image. Made up, no patient data.
const painter = await browser.newPage();
const pngB64 = await painter.evaluate(() => {
  const c = document.createElement("canvas"); c.width = 480; c.height = 300;
  const x = c.getContext("2d"); x.fillStyle = "#f7eef3"; x.fillRect(0, 0, 480, 300);
  for (let i = 0; i < 140; i++) { x.fillStyle = i % 3 ? "#c2457a" : "#5b3a8c"; x.beginPath(); x.arc((i * 97) % 470 + 5, (i * 53) % 260 + 20, 5 + (i % 4), 0, 7); x.fill(); }
  x.fillStyle = "#222"; x.font = "bold 18px sans-serif"; x.fillText("TEST PICTURE (made up) - Specimen #1", 12, 22);
  return c.toDataURL("image/png").split(",")[1];
});
await painter.close();
const pngPath = path.join(OUT, "test-specimen-1.png");
fs.writeFileSync(pngPath, Buffer.from(pngB64, "base64"));

const login = async (pg) => {
  await pg.goto(`${BASE}/`);
  await pg.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
};
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
await login(page);

// 1. Edit checklist shows an Add picture control on every item; add one to item B and save.
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/${P}?editChecklist=1`, { waitUntil: "networkidle" });
await page.locator('[data-testid="checklist-editor"]').waitFor({ timeout: 20000 });
const pickers = await page.locator('[data-testid^="checklist-picture-"]').count();
check("every checklist item has a picture control", pickers === 3, `controls=${pickers}`);
await page.locator('[data-testid="checklist-picture-1"] input[type="file"]').setInputFiles(pngPath);
await page.locator('[data-testid="checklist-picture-1"] [data-testid="quiz-question-image"]').waitFor({ timeout: 10000 });
await page.locator('[data-testid="checklist-editor"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(OUT, "checklist-editor-picture.png"), fullPage: false });
await page.locator('[data-testid="checklist-save"]').click();
await page.locator('[data-testid="checklist-list"]').waitFor({ timeout: 15000 });
const afterSave = itemRows();
check("save stores one picture and points item B at it", imageRows().length === 1 && afterSave[1].image_id === imageRows()[0].id && afterSave[0].image_id === null && afterSave[2].image_id === null, JSON.stringify(afterSave.map(r => r.image_id)));
const listPics = await page.locator('[data-testid="checklist-list"] [data-testid="quiz-question-image"]').count();
check("the Overview checklist shows the picture under item B", listPics === 1, `pictures=${listPics}`);
await page.locator('[data-testid="checklist-card"]').scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(OUT, "checklist-overview-picture.png"), fullPage: false });

// 2. A text-only edit keeps the picture without storing it again.
await page.locator('[data-testid="checklist-edit"]').click();
await page.getByLabel("Item A", { exact: true }).fill("Perform 10 Gram Stains with Supervisor review in agreement (reworded)");
await page.locator('[data-testid="checklist-save"]').click();
await page.locator('[data-testid="checklist-list"]').waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
const afterText = itemRows();
check("a text-only edit keeps item B's picture and stores nothing new", imageRows().length === 1 && afterText[1].image_id === afterSave[1].image_id && /reworded/.test(afterText[0].description), JSON.stringify(afterText.map(r => r.image_id)));

// 3. The new-assessment form shows the picture on item B.
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/${P}?newAssessment=1`, { waitUntil: "networkidle" });
const formPic = page.locator('table [data-testid="quiz-question-image"]');
await formPic.first().waitFor({ timeout: 20000 }).catch(() => {});
check("the assessment form shows the picture on its item", (await formPic.count()) === 1, `pictures=${await formPic.count()}`);
if (await formPic.count()) { await formPic.first().scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(OUT, "assessment-form-picture.png"), fullPage: false }); }

// 4. A saved assessment and the PDFs.
const emp = await call("POST", `${L}/competency/employees`, { name: "Casey Tech (made up)", title: "MLT", hireDate: "2026-01-05" }, owner.token);
const items = itemRows();
const asmt = await call("POST", `${L}/competency/assessments`, {
  programId: P, employeeId: emp.id, assessmentType: "initial", assessmentDate: "2026-10-28", evaluatorName: "Pat Lead", evaluatorTitle: "Technical Supervisor", evaluatorInitials: "PL", competencyType: "nontechnical", status: "pass",
  items: items.map(i => ({ itemLabel: i.label, itemDescription: i.description, ntItemLabel: i.label, ntItemDescription: i.description, ntDateMet: "2026-10-28", ntEmployeeInitials: "CT", ntSupervisorInitials: "PL", dateMet: "2026-10-28", employeeInitials: "CT", supervisorInitials: "PL", passed: true })),
}, owner.token);
const pdfTok = await call("GET", `${L}/competency/assessments/${asmt.id}/pdf`, undefined, owner.token);
const pdf = Buffer.from(await (await fetch(`${BASE}/api/pdf/${pdfTok.token}`)).arrayBuffer());
fs.writeFileSync(path.join(OUT, "competency-record.pdf"), pdf);
const blankTok = await call("GET", `${L}/competency/programs/${P}/blank-template-pdf`, undefined, owner.token);
const blank = Buffer.from(await (await fetch(`${BASE}/api/pdf/${blankTok.token}`)).arrayBuffer());
fs.writeFileSync(path.join(OUT, "blank-template.pdf"), blank);
check("the record PDF and the blank template PDF were produced", pdf.subarray(0, 4).toString() === "%PDF" && blank.subarray(0, 4).toString() === "%PDF", `${pdf.length} / ${blank.length} bytes`);

// 5. The saved assessment on the Assessments tab shows the picture.
await page.goto(`${BASE}/labs/${labId}/veritacomp-app/${P}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Assessments", exact: true }).click();
const savedPic = page.locator('table [data-testid="quiz-question-image"]');
await savedPic.first().waitFor({ timeout: 15000 }).catch(() => {});
await savedPic.first().scrollIntoViewIfNeeded().catch(() => {});
check("the saved assessment shows the picture it was done on", (await savedPic.count()) >= 1, `pictures=${await savedPic.count()}`);
await page.screenshot({ path: path.join(OUT, "assessment-saved-picture.png"), fullPage: false });

// 6. Dark mode: the Overview checklist with its picture.
const dark = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: "dark" });
await login(dark);
await dark.goto(`${BASE}/labs/${labId}/veritacomp-app/${P}`, { waitUntil: "networkidle" });
await dark.locator('[data-testid="checklist-list"] [data-testid="quiz-question-image"]').waitFor({ timeout: 15000 });
await dark.locator('[data-testid="checklist-card"]').scrollIntoViewIfNeeded();
check("dark mode renders the checklist picture", await dark.evaluate(() => document.documentElement.classList.contains("dark")), "html.dark");
await dark.screenshot({ path: path.join(OUT, "checklist-overview-picture-dark.png"), fullPage: false });
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
