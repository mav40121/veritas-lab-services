// scripts/verify-competency-linked-docs-ui.mjs
// Gate 3 step 8 receipt for BUG-116 (2026-11-10): VeritaComp's paperclip "Linked documents" dialog listed Element 1 to
// 6, with the technical element names, on a non-technical record, and the non-technical PDF printed no links. Runs
// against a LOCAL production build on a scratch DB with a made-up lab, person and URL (it registers an owner and writes
// to SCRATCH_DB, so it refuses any other host):
//   PW_BASE=http://localhost:5219 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-competency-linked-docs-ui.mjs
// In a real browser:
//   1. a non-technical record's dialog shows one Supporting documents list and no element; Link stores a document,
//      the list shows it, and the record's PDF prints it
//   2. a technical record's dialog still shows Element 1 to 6
//   3. dark mode and a phone
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5219", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.message || e).split("\n")[0]); } };

// ── A made-up lab, a non-technical program with one record, a technical program with one record ──
const email = `complinks-ui-${Date.now()}@example.test`;
const owner = await call("POST", "/api/auth/register", { email, password: ["Comp", "links", "16!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Linked Docs Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Made-up Linked Docs Lab", cliaNumber: "99D9999116", accreditationBody: "CLIA_ONLY", complexity: "high" }, owner.token);
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const nt = await call("POST", `${L}/competency/programs`, { name: "Made-up Safety Competency", department: "Made-up Core", type: "nontechnical", checklistItems: [{ description: "Made-up fire extinguisher location" }] }, owner.token);
const tech = await call("POST", `${L}/competency/programs`, { name: "Made-up Chemistry Competency", department: "Made-up Chemistry", type: "technical" }, owner.token);
const emp = await call("POST", `${L}/competency/employees`, { name: "Casey Tech (made up)", title: "MLT", hireDate: "2026-01-05" }, owner.token);
const ntItems = (() => { const d = new Database(process.env.SCRATCH_DB, { readonly: true }); const r = d.prepare("SELECT label, description FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order").all(nt.id); d.close(); return r; })();
const ntA = await call("POST", `${L}/competency/assessments`, {
  programId: nt.id, employeeId: emp.id, assessmentType: "initial", assessmentDate: "2026-11-10", evaluatorName: "Pat Lead (made up)", evaluatorTitle: "Technical Supervisor", evaluatorInitials: "PL", competencyType: "nontechnical", status: "pass",
  items: ntItems.map((i) => ({ itemLabel: i.label, itemDescription: i.description, ntItemLabel: i.label, ntItemDescription: i.description, ntDateMet: "2026-11-10", ntEmployeeInitials: "CT", ntSupervisorInitials: "PL", dateMet: "2026-11-10", employeeInitials: "CT", supervisorInitials: "PL" })),
}, owner.token);
const techA = await call("POST", `${L}/competency/assessments`, {
  programId: tech.id, employeeId: emp.id, assessmentType: "initial", assessmentDate: "2026-11-10", evaluatorName: "Pat Lead (made up)", evaluatorTitle: "Technical Supervisor", evaluatorInitials: "PL", competencyType: "technical", status: "pass", items: [],
}, owner.token);
check("setup: two programs and a record on each", !!nt.id && !!tech.id && !!ntA.id && !!techA.id, JSON.stringify({ nt: nt.id, tech: tech.id, ntA: ntA.id, techA: techA.id }));
const docRows = (aid) => { const d = new Database(process.env.SCRATCH_DB, { readonly: true }); const r = d.prepare("SELECT element_number, doc_type, title, url FROM competency_element_documents WHERE assessment_id = ?").all(aid); d.close(); return r; };

const browser = await chromium.launch();
const pageErrors = [];
const failedCalls = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => pageErrors.push(String(e)));
  pg.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failedCalls.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  await pg.goto(`${BASE}/`);
  await pg.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
  return pg;
};
const openDocs = async (pg, programId) => {
  await pg.goto(`${BASE}/labs/${labId}/veritacomp-app/${programId}`, { waitUntil: "networkidle" });
  await pg.getByRole("button", { name: "Assessments", exact: true }).click();
  await pg.getByTitle("Linked documents").first().click();
  const dlg = pg.getByRole("dialog").filter({ hasText: "Linked Documents" });
  await dlg.waitFor({ timeout: 15000 });
  return dlg;
};
const pdfText = (file) => execFileSync("python", ["-E", "-c", "import sys, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nprint('\\n'.join(p.get_text() for p in fitz.open(sys.argv[1])))", file]).toString("utf-8");
const URL1 = "https://files.example.test/made-up-safety-signoff.pdf";

// ── 1. Non-technical record ──
const page = await open();
await section("non-technical dialog", async () => {
  const dlg = await openDocs(page, nt.id);
  const text = (await dlg.innerText()).replace(/\s+/g, " ");
  check("non-technical: one Supporting documents list", (await dlg.getByTestId("docs-record").count()) === 1 && text.includes("Supporting documents"), text.slice(0, 200));
  check("non-technical: no Element 1 to 6 and no technical element names (it listed all six)", (await dlg.locator('[data-testid^="docs-element-"]').count()) === 0 && !/Element \d/.test(text) && !/Direct observation/i.test(text), text.slice(0, 200));
  await page.screenshot({ path: path.join(OUT, "bug116-1-nontech-dialog.png") });
  await dlg.getByTestId("docs-record").getByRole("button", { name: /Link/ }).click();
  const link = page.getByRole("dialog").filter({ hasText: "Link Document" });
  await link.waitFor({ timeout: 10000 });
  check("non-technical: the link form's title names no element", !/Element/.test(await link.innerText()));
  await link.getByRole("combobox").first().click();
  await page.getByRole("option").first().click();
  await link.getByPlaceholder("e.g. 2026 Chemistry Quiz, Pearson").fill("Made-up safety sign-off sheet");
  await link.getByPlaceholder("https://...").fill(URL1);
  await link.getByRole("button", { name: "Link", exact: true }).click();
  await dlg.getByText("Made-up safety sign-off sheet").waitFor({ timeout: 10000 });
  const rows = docRows(ntA.id);
  check("non-technical: Link stores the document (under element 1, the route's range)", rows.length === 1 && rows[0].element_number === 1 && rows[0].url === URL1, JSON.stringify(rows));
  check("non-technical: the list shows it", (await dlg.getByTestId("docs-record").innerText()).includes("Made-up safety sign-off sheet"));
  await page.screenshot({ path: path.join(OUT, "bug116-2-nontech-dialog-linked.png") });
  const tok = await call("GET", `${L}/competency/assessments/${ntA.id}/pdf`, undefined, owner.token);
  const buf = Buffer.from(await (await fetch(`${BASE}/api/pdf/${tok.token}`)).arrayBuffer());
  const file = path.join(OUT, "bug116-nontech-record.pdf");
  fs.writeFileSync(file, buf);
  const t = pdfText(file).replace(/\s+/g, " ");
  check("non-technical: the record's PDF prints the link (it printed none)", buf.subarray(0, 4).toString() === "%PDF" && t.includes("Linked documents (1)") && t.includes("Made-up safety sign-off sheet") && t.includes("made-up-safety-signoff"), t.slice(0, 160));
});

// ── 2. Technical record ──
await section("technical dialog", async () => {
  await page.keyboard.press("Escape");
  const dlg = await openDocs(page, tech.id);
  check("technical: still Element 1 to 6", (await dlg.locator('[data-testid^="docs-element-"]').count()) === 6 && (await dlg.getByTestId("docs-record").count()) === 0);
  await page.screenshot({ path: path.join(OUT, "bug116-3-tech-dialog.png") });
});

// ── 3. Dark and phone ──
await section("dark", async () => {
  const dark = await open({ colorScheme: "dark" });
  const dlg = await openDocs(dark, nt.id);
  check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
  check("dark: the Supporting documents list shows the link", (await dlg.getByTestId("docs-record").innerText()).includes("Made-up safety sign-off sheet"));
  await dark.screenshot({ path: path.join(OUT, "bug116-4-nontech-dialog-dark.png") });
});
await section("phone", async () => {
  const phone = await open({ viewport: { width: 390, height: 844 } });
  const dlg = await openDocs(phone, nt.id);
  const box = await dlg.boundingBox();
  check("phone: the dialog fits the screen", !!box && box.x >= -1 && box.x + box.width <= 391, JSON.stringify(box));
  await phone.screenshot({ path: path.join(OUT, "bug116-5-nontech-dialog-phone.png") });
});

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
check("no failed API calls", failedCalls.length === 0, failedCalls.slice(0, 4).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
