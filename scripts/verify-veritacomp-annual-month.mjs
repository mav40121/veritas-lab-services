// scripts/verify-veritacomp-annual-month.mjs
//
// Receipt for the lab annual competency month (Michael Q157 = 1, 2026-10-13; Sampson REQ-057: "I want all my repeat
// annual competencies due the end of October each year"). LOCAL server + scratch DB only; every person and record
// below is a scratch-DB fixture.
//   1. GET starts off; PUT rejects month 13; PUT October saves and re-figures VeritaStaff's stored annual due dates
//      (2026-11-20 -> 2026-10-31); turning it off puts the natural date back
//   2. per-method: an annual signed 2026-09-15 is next due 2026-10-31 (natural 2027-09-15); an annual already due in
//      October stays; a new initial's 6-month is not moved
//   3. VeritaStaff saves after the month is set land in the month too
//   4. browser: the VeritaComp page shows the setting card (October saved); the person page explains the moved date;
//      light, dark and 390px with no horizontal page scroll
// Run: PW_BASE=http://localhost:5167 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritacomp-annual-month.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const email = `ann-${Date.now()}@example.com`;
const T = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Annual Owner", hipaa_acknowledged: true })).body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Annual Month Lab", plan: "hospital" })).body.labId;
{ const db = new Database(process.env.SCRATCH_DB); db.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email); db.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId); db.close(); }
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Annual Month Lab", cliaNumber: "11D7654322", accreditationBody: "CLIA_ONLY", complexity: "high" }, T);
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, T)).body.id;
const t = (analyte, specialty, complexity) => ({ analyte, specialty, complexity, active: 1 });
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
  { name: "Beckman Coulter AU5800", category: "Chemistry", tests: [t("Sodium", "General Chemistry", "MODERATE")] },
  { name: "Roche cobas c 311", category: "Chemistry", tests: [t("Glucose", "General Chemistry", "MODERATE")] },
  { name: "Siemens CLINITEK Status+", category: "Urinalysis", tests: [t("Urine Glucose", "Urinalysis", "WAIVED")] },
] });
const inst = Object.fromEntries((new Database(process.env.SCRATCH_DB, { readonly: true }).prepare("SELECT id, instrument_name FROM veritamap_instruments WHERE map_id = ?").all(mapId)).map((r) => [r.instrument_name, r.id]));
const CHEM = inst["Beckman Coulter AU5800"], C311 = inst["Roche cobas c 311"], UA = inst["Siemens CLINITEK Status+"];
const emp = async (firstName, lastName, extra = {}) => (await call("POST", `${L}/staff/employees`, { firstName, lastName, title: "MLS", performsTesting: true, highestComplexity: "M", hireDate: "2023-12-01", ...extra }, T)).body.id;
const pat = await emp("Pat", "Alpha"), lee = await emp("Lee", "Delta");
const jordan = await emp("Jordan", "Rivera", { roles: [{ role: "TC", specialtyNumber: 7 }] });
const sam = await emp("Sam", "Ortiz", { roles: [{ role: "GS" }] });
await call("PUT", `${L}/staff/employees/${pat}/instruments`, { instrumentIds: [CHEM, C311, UA] }, T);
check("0. fixture: lab, three methods, two testers, two signers", [CHEM, C311, UA, pat, lee, jordan, sam].every(Boolean));

// VeritaStaff: Lee's recorded history, last annual 2025-11-20 -> natural next annual 2026-11-20.
const sched = (e, body) => call("PUT", `${L}/staff/competency/${e}`, { recordedAs: "existing", ...body }, T);
let s = await sched(lee, { initialCompletedAt: "2024-01-10", sixMonthCompletedAt: "2024-07-10", firstAnnualCompletedAt: "2025-01-10", lastAnnualCompletedAt: "2025-11-20" });
check("0b. Lee's VeritaStaff schedule saved; annual due 2026-11-20 with no month", s.status === 200 && s.body.annual_due_at === "2026-11-20", `${s.status} ${s.body.annual_due_at} ${s.body.error || ""}`);

// ---------- 1. the setting ----------
let g = await call("GET", `${L}/competency/annual-month`, undefined, T);
check("1a. starts off", g.status === 200 && g.body.month === null && g.body.staffLabConfigured === true, JSON.stringify(g.body));
let p = await call("PUT", `${L}/competency/annual-month`, { month: 13 }, T);
check("1b. month 13 is refused", p.status === 400, `${p.status} ${p.body.error}`);
p = await call("PUT", `${L}/competency/annual-month`, { month: 10 }, T);
const leeAnnual = () => new Database(process.env.SCRATCH_DB, { readonly: true }).prepare("SELECT annual_due_at FROM staff_competency_schedules WHERE employee_id = ?").get(lee).annual_due_at;
check("1c. October saved; Lee's stored annual due re-figured to 2026-10-31", p.status === 200 && p.body.month === 10 && p.body.updated >= 1 && leeAnnual() === "2026-10-31", `${p.status} ${JSON.stringify(p.body)} lee=${leeAnnual()}`);
p = await call("PUT", `${L}/competency/annual-month`, { month: null }, T);
check("1d. turning it off puts Lee's natural date back (2026-11-20)", p.status === 200 && p.body.month === null && leeAnnual() === "2026-11-20", `lee=${leeAnnual()}`);
await call("PUT", `${L}/competency/annual-month`, { month: 10 }, T);

// ---------- 2. per-method ----------
const els = [
  { num: 1, specimenId: "S-1", observerInitials: "JR", passed: true }, { num: 2, evidence: "Critical called", date: today, passed: true },
  { num: 3, qcDate: today, passed: true }, { num: 4, dateObserved: today, observerInitials: "JR", passed: true },
  { num: 5, sampleType: "PT", sampleId: "PT-1", acceptable: true, passed: true }, { num: 6, quizId: "Q-1", score: 100, dateTaken: today, passed: true },
];
const put = (e, i, body) => call("PUT", `${L}/competency/employee/${e}/test-system/${i}`, body, T);
const sign = (e, i, body) => call("POST", `${L}/competency/employee/${e}/test-system/${i}/sign`, body, T);
const view = async (e) => (await call("GET", `${L}/competency/employee/${e}`, undefined, T)).body;
const tsOf = (v, i) => (v.testSystems || []).find((x) => x.instrumentId === i) || {};
await put(pat, CHEM, { elements: els });
let r = await sign(pat, CHEM, { signerStaffEmployeeId: jordan, milestone: "annual", signedDate: "2026-09-15", documentation: "Paper annual in the competency binder" });
await put(pat, UA, { waivedMethods: [{ num: 1, evidence: "Blind BS-1", date: today, initials: "SO", passed: true }, { num: 4, evidence: "Written test", date: today, initials: "SO", passed: true }] });
const r2 = await sign(pat, UA, { signerStaffEmployeeId: sam });
await put(pat, C311, { elements: els });
const r3 = await sign(pat, C311, { signerStaffEmployeeId: jordan });
let v = await view(pat);
const chem = tsOf(v, CHEM), ua = tsOf(v, UA), c311 = tsOf(v, C311);
check("2a. annual signed 2026-09-15: next annual due 2026-10-31 (natural 2027-09-15), moved into October",
  r.status === 200 && chem.nextMilestone === "annual" && chem.nextDue?.targetDate === "2026-10-31" && chem.nextDue?.naturalTargetDate === "2027-09-15" && chem.nextDue?.annualMonth === 10,
  `${r.status} ${JSON.stringify(chem.nextDue)}`);
check("2b. the late ceiling moves by the same number of days (CLIA-only: ceiling = target)", chem.nextDue?.latest === "2026-10-31", `${chem.nextDue?.latest}`);
check(`2c. waived initial today: annual ${ua.nextDue?.targetDate} is already in October and is not moved`,
  r2.status === 200 && ua.nextMilestone === "annual" && /^\d{4}-10-/.test(ua.nextDue?.targetDate || "") && !ua.nextDue?.naturalTargetDate, JSON.stringify(ua.nextDue));
check("2d. a new initial's 6-month is never moved", r3.status === 200 && c311.nextMilestone === "six_month" && !c311.nextDue?.naturalTargetDate, JSON.stringify(c311.nextDue));

// ---------- 3. VeritaStaff saves after the month is set ----------
s = await sched(lee, { initialCompletedAt: "2024-01-10", sixMonthCompletedAt: "2024-07-10", firstAnnualCompletedAt: "2025-01-10", lastAnnualCompletedAt: "2026-02-03" });
check("3. a VeritaStaff save with October set: annual done 2026-02-03 -> due 2026-10-31 (natural 2027-02-03)", s.status === 200 && s.body.annual_due_at === "2026-10-31", `${s.status} ${s.body.annual_due_at}`);

// ---------- 4. browser ----------
const browser = await chromium.launch();
for (const [scheme, width] of [["light", 1400], ["dark", 1400], ["light", 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, T]);
  await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [T, me, labId]);
  const tag = `[${scheme} ${width}px]`;
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  const card = page.getByTestId("annual-month-card");
  check(`4a. ${tag} VeritaComp page shows the annual month card with October saved`, (await card.count()) === 1 && (await page.getByTestId("annual-month-select").inputValue()) === "10");
  check(`${tag} VeritaComp page: no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${OUT}/ann_card_${scheme}_${width}.png` });
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app/employee/${pat}`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  await page.getByTestId("test-system-tab").filter({ hasText: "Beckman Coulter AU5800" }).click(); await page.waitForTimeout(400);
  const note = await page.getByTestId("method-next-due").innerText().catch(() => "");
  check(`4b. ${tag} person page: "Annual due 10/31/2026 (moved earlier into the lab's annual month, October; 09/15/2027 without it)"`,
    /Annual due 10\/31\/2026/.test(note) && /annual month, October; 09\/15\/2027 without it/.test(note), note);
  check(`${tag} person page: no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.getByTestId("method-signed").screenshot({ path: `${OUT}/ann_person_${scheme}_${width}.png` });
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
