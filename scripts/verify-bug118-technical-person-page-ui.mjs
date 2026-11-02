// scripts/verify-bug118-technical-person-page-ui.mjs
// Browser receipt for BUG-118 (Michael Q90 = 1, 2026-11-02): a technical program's New Assessment no longer opens the
// whole-record form (an Annual signed there never moved the person's due date). Every way in (the header button, the
// Assessments tab button, the ?newAssessment=1 link and More > "Assessment in a program") opens a person picker, and
// picking a person opens their competency page. Waived programs keep the form. Made-up lab, analyzer and people on a
// scratch DB only. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-bug118-technical-person-page-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
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

const email = `bug118-ui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Bug118 UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Picker UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Picker UI Lab", cliaNumber: "11D7654382", accreditationBody: "CLIA_ONLY", complexity: "high" }, owner.token);
const map = await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token);
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: map.id, defaultActive: 1, instruments: [
  { name: "Hemo Counter", category: "Hematology", tests: [{ analyte: "WBC", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
] });
const robin = await call("POST", `${L}/staff/employees`, { lastName: "Lane", firstName: "Robin", highestComplexity: "M", performsTesting: true, hireDate: "2021-03-01" }, owner.token);
const sam = await call("POST", `${L}/staff/employees`, { lastName: "Ortiz", firstName: "Sam", highestComplexity: "M", performsTesting: true, hireDate: "2022-05-02" }, owner.token);
const sdb = new Database(process.env.SCRATCH_DB);
const inst = sdb.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = 'Hemo Counter' AND map_id = ?").get(map.id);
for (const s of [robin, sam]) sdb.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(s.id, inst.id, new Date().toISOString());
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
// A program person who is not in VeritaStaff (older VeritaComp-only row).
sdb.prepare("INSERT INTO competency_employees (user_id, lab_id, name, title, status, created_at, staff_employee_id) VALUES (?, ?, 'Pat Quill', '', 'active', ?, NULL)").run(uid, labId, new Date().toISOString());
const tech = await call("POST", `${L}/competency/programs`, { name: "Hematology Competency", department: "Hematology", type: "technical",
  methodGroups: [{ name: "Hemo Counter", instruments: ["Hemo Counter"], analytes: ["WBC"] }] }, owner.token);
const waived = await call("POST", `${L}/competency/programs`, { name: "Waived Glucose", department: "Point of Care", type: "waived" }, owner.token);
const elig = (await call("GET", `${L}/competency/programs/${tech.id}/eligible-employees`, undefined, owner.token)).employees || [];
const samComp = elig.find((e) => e.staff_employee_id === sam.id)?.id;
const robinComp = elig.find((e) => e.staff_employee_id === robin.id)?.id;
await call("POST", `${L}/competency/programs/${tech.id}/not-applicable`, { employeeId: samComp, reason: "Does not run the counter" }, owner.token);
check("setup: technical and waived programs, Robin and Sam on the analyzer, Sam Not applicable, Pat not in VeritaStaff",
  !!tech?.id && !!waived?.id && !!samComp && !!robinComp, `tech ${tech?.id}, waived ${waived?.id}`);
const assessments = () => sdb.prepare("SELECT COUNT(*) c FROM competency_assessments WHERE program_id IN (?, ?)").get(tech.id, waived.id).c;

const browser = await chromium.launch();
const open = async (url, scheme = "light") => {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, colorScheme: scheme });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
  await page.goto(`${BASE}/labs/${labId}${url}`, { waitUntil: "networkidle" });
  return page;
};
const picker = (page) => page.getByTestId("technical-person-picker");
const formOpen = async (page) => (await page.getByRole("dialog").filter({ hasText: /New (Technical|Waived) Assessment/ }).count()) > 0;

// 1. Header button on the technical program opens the picker, not the form; Robin listed, Sam not, Pat named.
const p1 = await open(`/veritacomp-app/${tech.id}`);
await p1.getByRole("button", { name: "New Assessment" }).first().click();
await picker(p1).waitFor({ timeout: 10000 });
const robinBtn = p1.getByTestId(`technical-person-pick-${robin.id}`);
const unlinked = await p1.getByTestId("technical-person-picker-unlinked").innerText();
check("technical program: New Assessment opens the person picker and not the form", await picker(p1).isVisible() && !(await formOpen(p1)));
check("picker lists Robin, leaves out Sam (Not applicable), and names Pat as not in VeritaStaff",
  await robinBtn.isVisible() && (await p1.getByTestId(`technical-person-pick-${sam.id}`).count()) === 0 && /Pat Quill/.test(unlinked), unlinked);
await picker(p1).screenshot({ path: path.join(OUT, "bug118-picker-light.png") });

// 2. Picking Robin opens Robin's person page.
await robinBtn.click();
await p1.waitForURL(`**/labs/${labId}/veritacomp-app/employee/${robin.id}`, { timeout: 10000 });
await p1.getByTestId("element-5").waitFor({ timeout: 15000 });
check("picking Robin opens Robin's competency page", p1.url().endsWith(`/veritacomp-app/employee/${robin.id}`), p1.url());
await p1.close();

// 3. The ?newAssessment=1 link (used by More > Assessment in a program) opens the picker too.
const p3 = await open(`/veritacomp-app/${tech.id}?newAssessment=1`);
await picker(p3).waitFor({ timeout: 10000 });
check("?newAssessment=1 on a technical program opens the picker, not the form", await picker(p3).isVisible() && !(await formOpen(p3)));
await p3.close();

// 4. The Assessments tab's own New Assessment button.
const p4 = await open(`/veritacomp-app/${tech.id}`);
await p4.getByRole("button", { name: "Assessments" }).click();
await p4.getByRole("button", { name: "New Assessment" }).last().click();
await picker(p4).waitFor({ timeout: 10000 });
check("Assessments tab button opens the picker", await picker(p4).isVisible() && !(await formOpen(p4)));
await p4.close();

// 5. More > Assessment in a program, choose the technical program, Continue: picker.
const p5 = await open(`/veritacomp-app`);
await p5.getByTestId("veritacomp-more").click();
await p5.getByRole("menuitem", { name: "Assessment in a program" }).click();
await p5.getByRole("combobox").click();
await p5.getByRole("option", { name: /Hematology Competency/ }).click();
await p5.getByRole("button", { name: "Continue" }).click();
await picker(p5).waitFor({ timeout: 10000 });
check("More > Assessment in a program > technical program opens the picker", await picker(p5).isVisible() && !(await formOpen(p5)));
await p5.close();

// 6. Null branch: a waived program still opens the form.
const p6 = await open(`/veritacomp-app/${waived.id}`);
await p6.getByRole("button", { name: "New Assessment" }).first().click();
await p6.getByRole("dialog").first().waitFor({ timeout: 10000 });
check("waived program: New Assessment still opens the form", await formOpen(p6) && (await picker(p6).count()) === 0);
await p6.close();

// 7. Empty branch, everyone Not applicable: with Robin also marked, the picker says so and how to undo it.
await call("POST", `${L}/competency/programs/${tech.id}/not-applicable`, { employeeId: robinComp, reason: "Moved to Micro" }, owner.token);
const p7 = await open(`/veritacomp-app/${tech.id}`, "dark");
await p7.evaluate(() => document.documentElement.classList.add("dark"));
await p7.getByRole("button", { name: "New Assessment" }).first().click();
await p7.getByTestId("technical-person-picker-empty").waitFor({ timeout: 10000 });
const empty7 = await p7.getByTestId("technical-person-picker-empty").innerText();
await picker(p7).screenshot({ path: path.join(OUT, "bug118-picker-empty-dark.png") });
check("everyone Not applicable: the picker says so and points to Applies again (dark mode)", /marked Not applicable/.test(empty7) && /Applies again/.test(empty7), empty7);
await p7.close();

// 8. Empty branch, nobody in VeritaStaff: a second made-up lab with a technical program and no staff.
const email2 = `bug118-ui2-${Date.now()}@example.com`;
const owner2 = await call("POST", "/api/auth/register", { email: email2, password: "Testpass123", name: "Bug118 UI Two", hipaa_acknowledged: true });
const lab2 = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email2, labName: "Empty Picker Lab", plan: "hospital" })).labId;
const tech2 = await call("POST", `/api/labs/${lab2}/competency/programs`, { name: "Chemistry Competency", department: "Chemistry", type: "technical" }, owner2.token);
const uid2 = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email2).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid2);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab2);
const p8 = await browser.newPage({ viewport: { width: 1300, height: 900 } });
await p8.goto(`${BASE}/`);
await p8.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner2.token, owner2.user]);
await p8.goto(`${BASE}/labs/${lab2}/veritacomp-app/${tech2.id}?newAssessment=1`, { waitUntil: "networkidle" });
await p8.getByTestId("technical-person-picker-empty").waitFor({ timeout: 10000 });
const empty8 = await p8.getByTestId("technical-person-picker-empty").innerText();
check("nobody in VeritaStaff: the picker says to add them there first", /No one in this program is in VeritaStaff/.test(empty8), empty8);
await p8.close();

check("no assessment record was written by any of the above", assessments() === 0, String(assessments()));
await browser.close();
sdb.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
