// scripts/verify-stewardship-ui.mjs
// Gate 3 receipt for the VeritaQA Stewardship tab (parking lot #81, Michael Veri 2026-11-23, Decision 14 = 2). Run against a
// LOCAL production build on a scratch database, with made-up people, a made-up lab and made-up totals (it registers people and
// provisions a lab, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5211 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-stewardship-ui.mjs
// In a real browser: a lab with no PI program opens the Stewardship tab from the setup screen; a new antibiogram; a file with a
// patient column is refused on screen by name; the LIS totals file previews, then saves, and the table shows 53, 88 and * for the
// 18-isolate cell; the release locks it; Excel downloads; a committee meeting logs; readiness reads met; settings show; with a PI
// department the tab sits in the tab bar. Light, dark and phone, with no sideways scroll on the phone and no page errors.
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5211", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
const PW = ["Steward", "made", "up", "81!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
fs.mkdirSync(OUT, { recursive: true });
const shot = async (target, name, fullPage = false) => {
  const file = path.join(OUT, `stewardship-${name}.png`);
  await target.screenshot({ path: file, ...(fullPage ? { fullPage: true } : {}), animations: "disabled" });
  console.log("shot:", file);
};

// ── A made-up lab and owner ─────────────────────────────────────────────
const stamp = Date.now();
const ownerEmail = `steward-owner-${stamp}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: PW, name: "Made Up Director", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Made-up Stewardship Lab", plan: "hospital" })).j.labId;
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(ownerEmail);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = ? WHERE id = ?").run(`99D${String(stamp).slice(-7)}`, labId); // unique per run: the scratch DB can be reused
});
check("made-up lab and owner", !!labId && !!owner.token);
const csvDir = fs.mkdtempSync(path.join(os.tmpdir(), "steward-ui-"));
const goodCsv = path.join(csvDir, "made_up_lis_totals.csv");
fs.writeFileSync(goodCsv, [
  "Organism,Group,Antimicrobial,Tested,Susceptible",
  "Escherichia coli,Gram-negative,Ampicillin,400,210",
  "Escherichia coli,Gram-negative,Ceftriaxone,412,362",
  "Enterobacter cloacae complex,Gram-negative,Ceftriaxone,18,13",
  "Staphylococcus aureus,Gram-positive,Oxacillin,188,109",
  "Staphylococcus aureus,Gram-positive,Vancomycin,188,188",
].join("\r\n"));
const phiCsv = path.join(csvDir, "made_up_patient_rows.csv");
fs.writeFileSync(phiCsv, "Patient Name,MRN,Organism,Antimicrobial,Tested,Susceptible\nMade Up,1,Escherichia coli,Ampicillin,1,1\n");

const browser = await chromium.launch();
const errors = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, owner.token)).j;
  await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", scheme); }, [owner.token, me, opts.colorScheme || "light"]);
  await page.goto(`${BASE}/labs/${labId}/veritabench/pi`);
  return page;
};
const tid = (p, id) => p.getByTestId(id);

try {
  // 1. No PI program yet: the setup screen opens the Stewardship tab
  const page = await open();
  await tid(page, "open-stewardship-first-time").waitFor({ timeout: 20000 });
  await tid(page, "open-stewardship-first-time").click();
  await tid(page, "stewardship-tab").waitFor({ timeout: 15000 });
  check("1. a lab with no PI program opens the Stewardship tab from the setup screen", await tid(page, "abg-empty").isVisible());
  await shot(page, "empty");

  // 2. A new antibiogram
  await tid(page, "abg-new").click();
  const form = tid(page, "abg-new-form");
  const inputs = form.locator("input");
  await inputs.nth(0).fill("Patient Name: Made Up");
  await inputs.nth(1).fill("2025-01-01");
  await inputs.nth(2).fill("2025-12-31");
  await inputs.nth(3).fill("All sources");
  await inputs.nth(4).fill("Made-up LIS report");
  await tid(page, "abg-create").click();
  await form.getByTestId("stewardship-error").waitFor({ timeout: 15000 });
  check("2a. a title holding a patient name is refused on the new-antibiogram form itself, nothing created", /looks like patient information \(patient name\)/.test(await form.getByTestId("stewardship-error").innerText()) && (await tid(page, "antibiogram-editor").count()) === 0);
  await shot(form, "phi-new-antibiogram");
  await inputs.nth(0).fill("Made-up 2025 antibiogram");
  await tid(page, "abg-create").click();
  await tid(page, "antibiogram-editor").waitFor({ timeout: 15000 });
  check("2. the draft opens in the editor", (await tid(page, "antibiogram-editor").innerText()).includes("Made-up 2025 antibiogram"));

  // 3. A file with patient columns is refused by name
  await tid(page, "abg-csv-input").setInputFiles(phiCsv);
  await tid(page, "stewardship-error").waitFor({ timeout: 15000 });
  const refusal = await tid(page, "stewardship-error").innerText();
  check("3. a patient-column file is refused on screen, naming the columns", /Columns not accepted: patient name, mrn/.test(refusal), refusal);
  await shot(page, "patient-file-refused");

  // 4. The LIS totals: preview, then save
  await tid(page, "abg-csv-input").setInputFiles(goodCsv);
  await tid(page, "abg-upload-preview").waitFor({ timeout: 15000 });
  check("4a. the preview shows 5 rows read", (await tid(page, "abg-upload-preview").innerText()).includes("5 rows read"));
  await shot(page, "upload-preview", true);
  await tid(page, "abg-upload-save").click();
  await tid(page, "abg-upload-preview").waitFor({ state: "detached", timeout: 15000 });
  const tableText = await tid(page, "antibiogram-editor").getByTestId("antibiogram-table").last().innerText();
  check("4b. the saved table: 53 and 88 for E. coli, 58 and 100 for S. aureus, * for the 18-isolate cell", /53/.test(tableText) && /88/.test(tableText) && /58/.test(tableText) && /100/.test(tableText) && /\*/.test(tableText) && /fewer than 30/.test(tableText), tableText);
  await shot(tid(page, "antibiogram-editor"), "draft-editor");
  const gridRows = await tid(page, "abg-grid").locator("tbody tr").count();
  const firstOrg = await tid(page, "abg-grid").getByLabel("Organism, row 1").inputValue();
  check("4b2. the typed grid now holds the 5 uploaded rows (it refills from what was saved, even in the same second)", gridRows === 5 && firstOrg === "Escherichia coli", `${gridRows} rows, first "${firstOrg}"`);

  // 4c. A grid organism holding a record number: refused under the grid, the saved totals unchanged
  const grid = tid(page, "abg-grid");
  await grid.getByLabel("Organism, row 1").fill("MRN 12345678");
  await tid(page, "abg-grid-save").click();
  const gridErr = tid(page, "antibiogram-editor").getByTestId("stewardship-error");
  await gridErr.waitFor({ timeout: 15000 });
  const gridErrBox = await gridErr.boundingBox(), gridBox = await grid.boundingBox(), saveBox = await tid(page, "abg-grid-save").boundingBox();
  check("4c. a grid organism holding a record number is refused just under the grid, above its Save totals", /medical record number/.test(await gridErr.innerText()) && gridErrBox && gridBox && saveBox && gridErrBox.y > gridBox.y && gridErrBox.y < saveBox.y);
  await shot(tid(page, "antibiogram-editor"), "phi-grid");
  await grid.getByLabel("Organism, row 1").fill("Escherichia coli");

  // 5. Release locks it
  await tid(page, "abg-release-open").click();
  const rf = tid(page, "abg-release-form");
  await rf.locator("input").nth(0).fill("Patient Name: Made Up");
  await rf.locator("input").nth(1).fill("Medical Director");
  await tid(page, "abg-release-confirm").click();
  await rf.getByTestId("stewardship-error").waitFor({ timeout: 15000 });
  check("5-. a release name holding a patient name is refused inside the release form, still a draft", /patient information/.test(await rf.getByTestId("stewardship-error").innerText()) && (await tid(page, "released-line").count()) === 0);
  await shot(rf, "phi-release");
  await rf.locator("input").nth(0).fill("Dr. Made Up");
  await rf.locator("input").nth(1).fill("Medical Director");
  await tid(page, "abg-release-confirm").click();
  await tid(page, "released-line").waitFor({ timeout: 15000 });
  check("5a. released: the line names the approver", (await tid(page, "released-line").innerText()).includes("approved by Dr. Made Up, Medical Director"));
  check("5b. released: no upload, grid or release controls remain", (await tid(page, "abg-csv-input").count()) === 0 && (await tid(page, "abg-grid").count()) === 0 && (await tid(page, "abg-release-open").count()) === 0 && (await tid(page, "abg-new-version").isVisible()));
  await shot(tid(page, "antibiogram-editor"), "released");

  // 6. Excel downloads
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), tid(page, "abg-excel").click()]);
  const dlPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(dlPath);
  check("6. Excel downloads with the version in its name", /^VeritaQA_Antibiogram_Made-up_2025_antibiogram_v1\.xlsx$/.test(dl.suggestedFilename()) && fs.statSync(dlPath).size > 5000, dl.suggestedFilename());

  // 7. Committee log
  await tid(page, "stewardship-section-committee").click();
  const mf = tid(page, "meeting-form");
  await mf.waitFor({ timeout: 15000 });
  await mf.locator("input").nth(1).fill("M. Tech, Microbiology");
  await mf.locator("input").nth(2).fill("https://example.com/made-up-minutes");
  await mf.locator("input").nth(3).fill("Discussed MRN 1234567");
  await tid(page, "meeting-add").click();
  await mf.getByTestId("stewardship-error").waitFor({ timeout: 15000 });
  check("7-. meeting notes holding a record number are refused inside the meeting form, nothing logged", /medical record number/.test(await mf.getByTestId("stewardship-error").innerText()) && (await tid(page, "meeting-empty").isVisible()));
  await shot(mf, "phi-meeting");
  await mf.locator("input").nth(3).fill("Reviewed the made-up antibiogram");
  await tid(page, "meeting-add").click();
  await tid(page, "meeting-list").waitFor({ timeout: 15000 });
  check("7. a meeting logs and lists", (await tid(page, "meeting-list").innerText()).includes("M. Tech, Microbiology"));
  const af = page.locator('[data-testid^="action-form-"]').first();
  await af.getByLabel("Action item", { exact: true }).fill("Send the antibiogram to pharmacy");
  await af.getByLabel("Owner", { exact: true }).fill("Pt name: Made Up");
  await af.getByLabel("Add action item").click();
  const actErr = tid(page, "meeting-list").getByTestId("stewardship-error");
  await actErr.waitFor({ timeout: 15000 });
  check("7a. an action owner holding a patient name is refused in that meeting's block, not on the meeting form", /patient information/.test(await actErr.innerText()) && (await mf.getByTestId("stewardship-error").count()) === 0);
  await shot(tid(page, "meeting-list"), "phi-action");
  await af.getByLabel("Owner", { exact: true }).fill("M. Tech");
  await af.getByLabel("Add action item").click();
  await tid(page, "meeting-list").getByText("Send the antibiogram to pharmacy").waitFor({ timeout: 15000 });
  check("7b. the corrected action item saves and the message clears", (await tid(page, "meeting-list").getByTestId("stewardship-error").count()) === 0);
  await shot(page, "committee");

  // 8. Readiness
  await tid(page, "stewardship-section-readiness").click();
  await tid(page, "readiness").waitFor({ timeout: 15000 });
  const st = async (k) => tid(page, `readiness-${k}`).getAttribute("data-state");
  check("8a. readiness: antibiogram met, committee met, actions met", (await st("antibiogram")) === "met" && (await st("committee")) === "met" && (await st("actions")) === "met");
  check("8b. readiness shows the CFR text and its as-of date", /42 CFR 485\.640\(b\)\(2\)\(i\)/.test(await tid(page, "readiness").innerText()) && /current as of 2026-11-19/.test(await tid(page, "readiness").innerText()));
  await shot(page, "readiness", true);

  // 9. Settings
  await tid(page, "stewardship-section-settings").click();
  await tid(page, "stewardship-settings").waitFor({ timeout: 15000 });
  check("9. settings show 30 and suppress for the owner, editable", (await tid(page, "setting-threshold").inputValue()) === "30" && (await tid(page, "setting-mode").inputValue()) === "suppress" && !(await tid(page, "setting-threshold").isDisabled()));
  await shot(page, "settings");

  // 10. With a PI department, the tab sits in the tab bar
  await call("POST", "/api/pi/departments", { name: "Made-up Microbiology" }, owner.token);
  await page.goto(`${BASE}/labs/${labId}/veritabench/pi`);
  await tid(page, "qa-tab-stewardship").waitFor({ timeout: 20000 });
  await tid(page, "qa-tab-stewardship").click();
  await tid(page, "abg-list").waitFor({ timeout: 15000 });
  check("10. with a PI program, the Stewardship tab is in the tab bar and lists the antibiogram", (await tid(page, "abg-list").innerText()).includes("Made-up 2025 antibiogram"));

  // 11. Dark and phone
  const dark = await open({ colorScheme: "dark" });
  await tid(dark, "qa-tab-stewardship").waitFor({ timeout: 20000 });
  await tid(dark, "qa-tab-stewardship").click();
  await tid(dark, "abg-list").waitFor({ timeout: 15000 });
  await dark.getByRole("button", { name: "Open" }).first().click();
  await tid(dark, "antibiogram-editor").waitFor({ timeout: 15000 });
  await shot(dark, "dark", true);
  check("11a. dark mode renders the editor", await tid(dark, "antibiogram-table").first().isVisible());
  const phone = await open({ viewport: { width: 390, height: 844 } });
  await tid(phone, "qa-tab-stewardship").waitFor({ timeout: 20000 });
  await tid(phone, "qa-tab-stewardship").click();
  await tid(phone, "abg-list").waitFor({ timeout: 15000 });
  await phone.getByRole("button", { name: "Open" }).first().click();
  await tid(phone, "antibiogram-editor").waitFor({ timeout: 15000 });
  const sideways = await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await shot(phone, "phone", true);
  check("11b. phone: no sideways scroll on the page (the table scrolls inside its box)", sideways);
  check("12. no page errors", errors.length === 0, errors.join(" | "));
} catch (e) {
  check("the run finished", false, String(e?.stack || e));
} finally {
  await browser.close();
}
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
