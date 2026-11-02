// scripts/verify-bug120-imported-history-ui.mjs
// Browser receipt for BUG-120 (Michael Q92 = 1, 2026-11-02): after a Bulk Import of a made-up tech's Initial and Annual
// for a technical program naming her analyzer, her VeritaComp page shows the Annual as signed, marked as imported history
// from that program, with the next Annual due a year later. Made-up lab, analyzer and people on a scratch DB only. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-bug120-imported-history-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `bug120h-ui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Bug120 History UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "History UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "History UI Lab", cliaNumber: "11D7654388", accreditationBody: "CLIA_ONLY", complexity: "high" }, owner.token);
const map = await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token);
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: map.id, defaultActive: 1, instruments: [
  { name: "Hemo Counter", category: "Hematology", tests: [{ analyte: "WBC", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
] });
const robin = await call("POST", `${L}/staff/employees`, { lastName: "Lane", firstName: "Robin", highestComplexity: "M", performsTesting: true, hireDate: "2015-03-01" }, owner.token);
const sdb = new Database(process.env.SCRATCH_DB);
const inst = sdb.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = 'Hemo Counter' AND map_id = ?").get(map.id);
sdb.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(robin.id, inst.id, new Date().toISOString());
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
await call("POST", `${L}/competency/programs`, { name: "Hematology Competency", department: "Hematology", type: "technical",
  methodGroups: [{ name: "Hemo Counter", instruments: ["Hemo Counter"], analytes: ["WBC"] }] }, owner.token);
const tpl = await fetch(`${BASE}${L}/competency/assessments/bulk-template`, { headers: { Authorization: `Bearer ${owner.token}` } });
const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await tpl.arrayBuffer()));
const ws = wb.getWorksheet("Assessments");
[["Robin Lane", "Hematology Competency", "initial", "2015-04-01", "pass", "Kit Vance"],
 ["Robin Lane", "Hematology Competency", "annual", "2026-03-15", "pass", "Kit Vance"]]
  .forEach((vals, i) => vals.forEach((v, c) => { ws.getRow(i + 2).getCell(c + 1).value = v; }));
const fd = new FormData(); fd.append("file", new Blob([Buffer.from(await wb.xlsx.writeBuffer())]), "history.xlsx");
const commit = await (await fetch(`${BASE}${L}/competency/assessments/bulk-commit`, { method: "POST", headers: { Authorization: `Bearer ${owner.token}` }, body: fd })).json();
check("setup: made-up lab, one analyzer, Robin on it, Initial and Annual imported", commit.imported === 2, JSON.stringify(commit).slice(0, 120));

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, colorScheme: scheme });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app/employee/${robin.id}`, { waitUntil: "networkidle" });
  if (scheme === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  const note = page.getByTestId("method-imported").first();
  await note.waitFor({ timeout: 15000 });
  const banner = note.locator("xpath=ancestor::div[contains(@class,'rounded-md')][1]");
  const text = await banner.innerText();
  if (scheme === "light") {
    check("Robin's page: Annual signed 03/15/2026 by Kit Vance, imported from Hematology Competency",
      /Annual signed 03\/15\/2026/.test(text) && /Kit Vance/.test(text) && /Imported history from Hematology Competency/.test(text), text.replace(/\s+/g, " "));
    check("next Annual due 03/15/2027, not overdue; the 2015 Initial listed as earlier",
      /Annual due 03\/15\/2027/.test(text) && !/overdue/i.test(text) && /Earlier: Initial 04\/01\/2015/.test(text), text.replace(/\s+/g, " "));
  }
  await banner.screenshot({ path: path.join(OUT, `bug120-imported-${scheme}.png`) });
  check(`${scheme} mode: the imported line renders`, await note.isVisible());
  await page.close();
}
await browser.close();
sdb.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
