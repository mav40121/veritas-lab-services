// scripts/verify-veritacomp-by-instrument.mjs
//
// Receipt for the read-only "By instrument" competency view (Michael Q154 = 2, 2026-10-13). LOCAL server + scratch DB
// only; every person, instrument and competency below is a scratch-DB test fixture.
//   1. by-instrument index: the assigned instrument shows 2 people / 0 signed / 1 ready to sign; an unassigned one shows 0 people
//   2. instrument detail: both assigned people listed; each person's block is IDENTICAL to the same instrument's block
//      on that person's employee view (one record, two views)
//   3. lab scoping: another lab's owner gets 404 for this lab's instrument; a bad id gets 404
//   4. browser: index lists the instruments; the instrument page shows person tabs and element rows with PASS for the
//      completed person; clicking the other person switches the panel; "Open ... record" goes to the employee page;
//      the unassigned instrument shows the empty state
//   5. light, dark and 390px render with no horizontal page scroll (screenshots for the PR)
// Run: PW_BASE=http://localhost:5166 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritacomp-by-instrument.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };

async function makeLab(tag) {
  const email = `${tag}-${Date.now()}@example.com`;
  const owner = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `${tag} Owner`, hipaa_acknowledged: true })).body;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `${tag} Lab`, plan: "hospital" })).body.labId;
  const db = new Database(process.env.SCRATCH_DB);
  db.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
  db.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
  db.close();
  return { email, token: owner.token, labId };
}

const A = await makeLab("byinst");
const L = `/api/labs/${A.labId}`, T = A.token;
await call("POST", `${L}/staff/lab`, { labName: "By Instrument Lab", cliaNumber: "11D7654398", accreditationBody: "CLIA_ONLY", complexity: "high" }, T);
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, T)).body.id;
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
  { name: "Beckman Coulter AU5800", category: "Chemistry", tests: [{ analyte: "Sodium", specialty: "General Chemistry", complexity: "MODERATE", active: 1 }, { analyte: "Potassium", specialty: "General Chemistry", complexity: "MODERATE", active: 1 }] },
  { name: "Sysmex XN-1000", category: "Hematology", tests: [{ analyte: "WBC", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
] });
const insts = new Database(process.env.SCRATCH_DB, { readonly: true }).prepare("SELECT id, instrument_name FROM veritamap_instruments WHERE map_id = ? ORDER BY id").all(mapId);
const chem = insts.find((i) => /AU5800/.test(i.instrument_name)).id, heme = insts.find((i) => /XN-1000/.test(i.instrument_name)).id;
const pat = (await call("POST", `${L}/staff/employees`, { firstName: "Pat", lastName: "Alpha", title: "MLS", performsTesting: true }, T)).body.id;
const kim = (await call("POST", `${L}/staff/employees`, { firstName: "Kim", lastName: "Bravo", title: "MLT", performsTesting: true }, T)).body.id;
for (const id of [pat, kim]) await call("PUT", `${L}/staff/employees/${id}/instruments`, { instrumentIds: [chem] }, T);
const elements = [
  { num: 1, specimenId: "S-100", observerInitials: "MV", passed: true },
  { num: 2, evidence: "Reported K 6.2 critical", date: "2026-10-01", passed: true },
  { num: 3, qcDate: "2026-09-28", passed: true },
  { num: 4, dateObserved: "2026-09-29", observerInitials: "MV", passed: true },
  { num: 5, sampleType: "PT", sampleId: "CHM-26A-01", acceptable: true, passed: true },
  { num: 6, quizId: "Q-CHEM-1", score: 100, dateTaken: "2026-10-02", passed: true },
];
const save = await call("PUT", `${L}/competency/employee/${pat}/test-system/${chem}`, { elements }, T);
check("0. fixture: Pat's AU5800 competency saved through the employee endpoint", save.status === 200, `${save.status} ${JSON.stringify(save.body).slice(0, 120)}`);

const idx = (await call("GET", `${L}/competency/by-instrument`, undefined, T)).body.instruments || [];
const rc = idx.find((r) => r.instrumentId === chem), rh = idx.find((r) => r.instrumentId === heme);
check("1. index: AU5800 has 2 people, none signed yet, 1 ready to sign (per-method sign-off)", rc && rc.people === 2 && rc.signed === 0 && rc.ready === 1, JSON.stringify(rc));
check("1. index: unassigned XN-1000 has 0 people and still shows its complexity (MODERATE)", rh && rh.people === 0 && rh.complexity === "MODERATE", JSON.stringify(rh));

const det = (await call("GET", `${L}/competency/instrument/${chem}`, undefined, T)).body;
const names = (det.people || []).map((p) => p.employee.name);
check("2. detail: both assigned people listed", names.length === 2 && names.includes("Pat Alpha") && names.includes("Kim Bravo"), names.join(", "));
for (const id of [pat, kim]) {
  const ev = (await call("GET", `${L}/competency/employee/${id}`, undefined, T)).body;
  const fromEmp = ev.testSystems.find((t) => t.instrumentId === chem);
  const fromInst = det.people.find((p) => p.employee.id === id)?.testSystem;
  check(`2. ${ev.employee.name}: instrument view block identical to employee view block`, JSON.stringify(fromEmp) === JSON.stringify(fromInst), `complete ${fromInst?.complete}`);
}

const B = await makeLab("otherlab");
const cross = await call("GET", `/api/labs/${B.labId}/competency/instrument/${chem}`, undefined, B.token);
check("3. another lab cannot read this lab's instrument", cross.status === 404, String(cross.status));
const bad = await call("GET", `${L}/competency/instrument/999999`, undefined, T);
check("3. unknown instrument id returns 404", bad.status === 404, String(bad.status));

const browser = await chromium.launch();
let first = true;
for (const [scheme, width] of [["light", 1400], ["dark", 1400], ["light", 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, T]);
  await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [T, me, A.labId]);
  const tag = `[${scheme} ${width}px]`;
  await page.goto(`${BASE}/labs/${A.labId}/veritacomp-app/instruments`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
  const rows = await page.getByTestId("instrument-row").count();
  check(`4. ${tag} index lists the lab's instruments`, rows === 2, `rows ${rows}`);
  check(`5. ${tag} index: no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: `${OUT}/byinst_index_${scheme}_${width}.png`, fullPage: true });
  await page.goto(`${BASE}/labs/${A.labId}/veritacomp-app/instrument/${chem}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
  const tabs = await page.getByTestId("person-tab").count();
  const statuses = await page.getByTestId("element-status").allInnerTexts();
  check(`4. ${tag} instrument page: 2 person tabs, sorted by last name; first person (Pat, complete) shows 6 PASS`, tabs === 2 && statuses.length === 6 && statuses.every((s) => s === "PASS"), `tabs ${tabs}, ${statuses.join("/")}`);
  await page.getByTestId("person-tab").filter({ hasText: "Kim Bravo" }).click(); await page.waitForTimeout(400);
  const st2 = await page.getByTestId("element-status").allInnerTexts();
  check(`4. ${tag} clicking Kim (no data) switches the panel to 6 Incomplete`, st2.length === 6 && st2.every((s) => /Incomplete/i.test(s)), st2.join("/"));
  check(`5. ${tag} instrument page: no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: `${OUT}/byinst_detail_${scheme}_${width}.png`, fullPage: true });
  if (first) {
    first = false;
    await page.getByTestId("open-person-record").click(); await page.waitForTimeout(800);
    check(`4. ${tag} "Open record" goes to the selected person's employee page`, page.url().endsWith(`/labs/${A.labId}/veritacomp-app/employee/${kim}`), page.url().replace(BASE, ""));
    await page.goto(`${BASE}/labs/${A.labId}/veritacomp-app/instrument/${heme}`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
    check(`4. ${tag} unassigned instrument shows the empty state`, (await page.getByTestId("instrument-empty").count()) === 1);
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
