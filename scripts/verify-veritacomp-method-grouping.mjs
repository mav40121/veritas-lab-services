// scripts/verify-veritacomp-method-grouping.mjs
//
// Receipt for lab-chosen method grouping (Michael 2026-10-13 rule, mock approved 2026-10-14 Q168 = 1). LOCAL server +
// scratch DB only; every person, analyzer and competency below is a scratch-DB fixture.
//   1. suggestions: same make and model family only (Ortho 5600 Primary + Backup, XN-1000 + XN-450); never a manual
//      method; never across complexity (Clinitek Novus moderate + Clinitek Status waived)
//   2. limits enforced on the server: waived + moderate refused, a manual method refused, one analyzer refused, an
//      analyzer from another lab refused, an analyzer already grouped refused
//   3. grouping keeps history: Jennifer's earlier Ortho Primary sign-off shows on the new group; she has 2 methods, not 3
//   4. one sign-off covers the group: Kim (runs only the Backup) signs the group; one row per analyzer is written, the
//      view shows it once, and Competencies owed counts her Backup assessed
//   5. every screen treats the group as one: By instrument has one row (both people), opening the Backup opens the group
//   6. Unlock reopens the group sign-off (every row), and it signs again
//   7. Split keeps history: after a split Kim's Ortho 5600 Backup still shows her group sign-off
//   8. Keep separate: the suggestion stops showing
//   9. browser: settings page groups a suggestion with one click; the person page shows the GROUP badge, the note and
//      "Covers ..." on the sign form; By instrument shows the group row; light, dark and 390px, no horizontal scroll
// Run: PW_BASE=http://localhost:5167 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritacomp-method-grouping.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function makeLab(tag, insts) {
  const email = `${tag}-${Date.now()}@example.com`;
  const T = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: `${tag} Owner`, hipaa_acknowledged: true })).body.token;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `${tag} Lab`, plan: "hospital" })).body.labId;
  { const db = new Database(process.env.SCRATCH_DB); db.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email); db.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId); db.close(); }
  const L = `/api/labs/${labId}`;
  await call("POST", `${L}/staff/lab`, { labName: `${tag} Lab`, cliaNumber: "11D7654333", accreditationBody: "CLIA_ONLY", complexity: "high" }, T);
  const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, T)).body.id;
  await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: insts }, T);
  const ids = Object.fromEntries((new Database(process.env.SCRATCH_DB, { readonly: true }).prepare("SELECT id, instrument_name FROM veritamap_instruments WHERE map_id = ?").all(mapId)).map((r) => [r.instrument_name, r.id]));
  return { T, labId, L, ids };
}
const t = (analyte, specialty, complexity) => ({ analyte, specialty, complexity, active: 1 });
const A = await makeLab("grp", [
  { name: "Ortho 5600 Primary", category: "Chemistry", tests: [t("Sodium", "General Chemistry", "MODERATE")] },
  { name: "Ortho 5600 Backup", category: "Chemistry", tests: [t("Sodium", "General Chemistry", "MODERATE")] },
  { name: "Tosoh AIA-900", category: "Chemistry", tests: [t("TSH", "Endocrinology", "MODERATE")] },
  { name: "XN-1000", category: "Hematology", tests: [t("WBC", "Hematology", "MODERATE")] },
  { name: "XN-450", category: "Hematology", tests: [t("WBC", "Hematology", "MODERATE")] },
  { name: "Manual Differential", category: "Hematology", tests: [t("WBC Differential", "Hematology", "HIGH")] },
  { name: "Clinitek Novus", category: "Urinalysis", tests: [t("Urine pH", "Urinalysis", "MODERATE")] },
  { name: "Clinitek Status", category: "Urinalysis", tests: [t("Urine Glucose", "Urinalysis", "WAIVED")] },
]);
const B = await makeLab("grpother", [{ name: "Other Analyzer", category: "Chemistry", tests: [t("Sodium", "General Chemistry", "MODERATE")] }]);
const { T, L, ids } = A;
const OP = ids["Ortho 5600 Primary"], OB = ids["Ortho 5600 Backup"], TOS = ids["Tosoh AIA-900"], XN1 = ids["XN-1000"], XN4 = ids["XN-450"], MD = ids["Manual Differential"], CN = ids["Clinitek Novus"], CS = ids["Clinitek Status"];
const emp = async (firstName, lastName, extra = {}) => (await call("POST", `${L}/staff/employees`, { firstName, lastName, title: "MLS", performsTesting: true, highestComplexity: "H", hireDate: "2024-01-08", ...extra }, T)).body.id;
const jen = await emp("Jennifer", "Martinez"), kim = await emp("Kim", "Bravo");
const jordan = await emp("Jordan", "Ellis", { roles: [{ role: "TC", specialtyNumber: 7 }, { role: "TC", specialtyNumber: 8 }] });
await call("PUT", `${L}/staff/employees/${jen}/instruments`, { instrumentIds: [OP, OB, TOS] }, T);
await call("PUT", `${L}/staff/employees/${kim}/instruments`, { instrumentIds: [OB, XN1] }, T);
check("0. fixture: 8 analyzers, 2 testers, 1 signer", [OP, OB, TOS, XN1, XN4, MD, CN, CS, jen, kim, jordan].every(Boolean));
const els = (tag) => [
  { num: 1, specimenId: `S-${tag}`, observerInitials: "JE", passed: true }, { num: 2, evidence: "Critical called", date: today, passed: true },
  { num: 3, qcDate: today, passed: true }, { num: 4, dateObserved: today, observerInitials: "JE", passed: true },
  { num: 5, sampleType: "PT", sampleId: `PT-${tag}`, acceptable: true, passed: true }, { num: 6, quizId: "Q-1", score: 100, dateTaken: today, passed: true },
];
const put = (e, i, body) => call("PUT", `${L}/competency/employee/${e}/test-system/${i}`, body, T);
const sign = (e, i, body) => call("POST", `${L}/competency/employee/${e}/test-system/${i}/sign`, body, T);
const view = async (e) => (await call("GET", `${L}/competency/employee/${e}`, undefined, T)).body;
const tsOf = (v, i) => (v.testSystems || []).find((x) => x.instrumentId === i) || {};
const G = `${L}/competency/method-groups`;

// ---------- 1. suggestions ----------
let mg = (await call("GET", G, undefined, T)).body;
const sugNames = (mg.suggestions || []).map((s) => s.members.map((m) => m.name).sort().join(" + ")).sort();
check("1a. suggestions are the two same-model pairs", JSON.stringify(sugNames) === JSON.stringify(["Ortho 5600 Backup + Ortho 5600 Primary", "XN-1000 + XN-450"]), JSON.stringify(sugNames));
check("1b. Manual Differential is marked a manual method", (mg.instruments || []).find((i) => i.id === MD)?.manual === true);

// ---------- 2. limits ----------
let r = await call("POST", G, { name: "Clinitek", instrumentIds: [CN, CS] }, T);
check("2a. waived + moderate refused", r.status === 400 && /waived/.test(r.body.error || ""), `${r.status} ${r.body.error}`);
r = await call("POST", G, { name: "Heme", instrumentIds: [XN1, MD] }, T);
check("2b. a manual method refused", r.status === 400 && /manual method/.test(r.body.error || ""), `${r.status} ${r.body.error}`);
r = await call("POST", G, { name: "One", instrumentIds: [TOS] }, T);
check("2c. one analyzer refused", r.status === 400 && /at least two/.test(r.body.error || ""), `${r.status} ${r.body.error}`);
r = await call("POST", G, { name: "Cross", instrumentIds: [TOS, B.ids["Other Analyzer"]] }, T);
check("2d. an analyzer from another lab refused (404)", r.status === 404, `${r.status} ${r.body.error}`);

// ---------- 3. grouping keeps history ----------
await put(jen, OP, { elements: els("JP") });
r = await sign(jen, OP, { signerStaffEmployeeId: jordan });
check("3a. before grouping: Jennifer's Ortho 5600 Primary initial signed on its own", r.status === 200, `${r.status} ${r.body.error || ""}`);
r = await call("POST", G, { name: "Ortho 5600", instrumentIds: [OP, OB] }, T);
const groupId = r.body.groupId;
check("3b. Ortho 5600 Primary + Backup grouped", r.status === 200 && !!groupId, `${r.status} ${r.body.error || ""}`);
r = await call("POST", G, { name: "Again", instrumentIds: [OB, TOS] }, T);
check("2e. an analyzer already in a group refused (409)", r.status === 409 && /already in the "Ortho 5600" group/.test(r.body.error || ""), `${r.status} ${r.body.error}`);
let vj = await view(jen);
const jg = tsOf(vj, OP);
check("3c. Jennifer now has 2 methods (Ortho 5600 group, Tosoh), not 3", (vj.testSystems || []).length === 2 && jg.instrumentName === "Ortho 5600" && (jg.groupMembers || []).length === 2, (vj.testSystems || []).map((x) => x.instrumentName).join(" | "));
check("3d. the group carries her earlier Primary initial; next is the 6-month", jg.lastSignoff?.milestone === "initial" && jg.nextMilestone === "six_month", JSON.stringify({ last: jg.lastSignoff?.milestone, next: jg.nextMilestone }));

// ---------- 4. one sign-off covers the group ----------
let vk = await view(kim);
check("4a. Kim runs only the Backup and sees the Ortho 5600 group", !!tsOf(vk, OP).groupMembers && !tsOf(vk, OB).instrumentId, (vk.testSystems || []).map((x) => `${x.instrumentId}:${x.instrumentName}`).join(" | "));
r = await put(kim, OB, { elements: els("KB") });
check("4b. entries saved through the Backup are stored on the group's lead analyzer", r.status === 200 && r.body.instrumentId === OP, JSON.stringify(r.body));
r = await sign(kim, OB, { signerStaffEmployeeId: jordan, signerInitials: "JE" });
const kimSign = r.body.signoffId;
const rows = new Database(process.env.SCRATCH_DB, { readonly: true }).prepare("SELECT instrument_id, group_id, group_signoff_id FROM competency_method_signoffs WHERE staff_employee_id = ? AND revoked_at IS NULL ORDER BY id").all(kim);
check("4c. one sign-off writes a row per analyzer (lead + Backup pointing at it)", r.status === 200 && rows.length === 2 && rows[0].instrument_id === OP && rows[1].instrument_id === OB && rows[1].group_signoff_id === kimSign && rows[0].group_id === groupId, JSON.stringify(rows));
vk = await view(kim);
check("4d. Kim's view shows the group sign-off once", (tsOf(vk, OP).signoffs || []).length === 1 && tsOf(vk, OP).lastSignoff?.id === kimSign);
const owed = (await call("GET", `${L}/competency/owed`, undefined, T)).body;
const ko = ((owed.employees || []).find((e) => e.employeeId === kim)?.owed || []).find((o) => o.instrumentName === "Ortho 5600 Backup");
check("4e. Competencies owed counts Kim's Ortho 5600 Backup assessed", ko?.assessed === true, JSON.stringify(ko));

// ---------- 5. one entry everywhere ----------
const idx = (await call("GET", `${L}/competency/by-instrument`, undefined, T)).body.instruments || [];
const og = idx.filter((x) => /Ortho 5600/.test(x.instrumentName));
check("5a. By instrument lists the group once, with both people", og.length === 1 && og[0].instrumentName === "Ortho 5600" && og[0].people === 2 && (og[0].groupMembers || []).length === 2, JSON.stringify(og));
const det = (await call("GET", `${L}/competency/instrument/${OB}`, undefined, T)).body;
check("5b. opening the Backup opens the group with Jennifer and Kim", det.instrument?.name === "Ortho 5600" && (det.people || []).length === 2, JSON.stringify({ name: det.instrument?.name, people: (det.people || []).map((p) => p.employee.name) }));

// ---------- 6. unlock ----------
r = await call("POST", `${L}/competency/employee/${kim}/test-system/${OB}/signoffs/${kimSign}/revoke`, {}, T);
const left = new Database(process.env.SCRATCH_DB, { readonly: true }).prepare("SELECT COUNT(*) n FROM competency_method_signoffs WHERE staff_employee_id = ? AND revoked_at IS NULL").get(kim).n;
vk = await view(kim);
check("6a. Unlock reopens every row of the group sign-off; the entries are back and signable", r.status === 200 && left === 0 && tsOf(vk, OP).signable === true, `${r.status} rows left ${left}`);
r = await sign(kim, OB, { signerStaffEmployeeId: jordan });
check("6b. signed again", r.status === 200);

// ---------- 7. split keeps history ----------
r = await call("DELETE", `${G}/${groupId}`, undefined, T);
vk = await view(kim);
const kb = tsOf(vk, OB);
check("7. after Split, Kim's Ortho 5600 Backup is its own method and still shows the group sign-off", r.status === 200 && kb.instrumentName === "Ortho 5600 Backup" && kb.lastSignoff?.milestone === "initial" && !kb.groupMembers, JSON.stringify({ s: r.status, name: kb.instrumentName, last: kb.lastSignoff?.milestone }));

// ---------- 8. keep separate ----------
r = await call("POST", `${G}/keep-separate`, { instrumentIds: [OP, OB] }, T);
mg = (await call("GET", G, undefined, T)).body;
check("8. Keep separate: the Ortho pair is no longer suggested; the XN pair still is", r.status === 200 && (mg.suggestions || []).length === 1 && /XN/.test(mg.suggestions[0].members[0].name), JSON.stringify((mg.suggestions || []).map((s) => s.key)));

// ---------- 9. browser ----------
const browser = await chromium.launch();
let first = true;
for (const [scheme, width] of [["light", 1400], ["dark", 1400], ["light", 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, T]);
  await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [T, me, A.labId]);
  const tag = `[${scheme} ${width}px]`;
  await page.goto(`${BASE}/labs/${A.labId}/veritacomp-app/method-groups`, { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
  if (first) {
    const nm = await page.getByTestId("suggestion-name").first().inputValue();
    check(`9a. ${tag} the XN suggestion's starting name is "XN-1000 / XN-450"`, nm === "XN-1000 / XN-450", nm);
    await page.getByTestId("group-these").first().click(); await page.waitForTimeout(1200);
    const groupsText = await page.getByTestId("lab-groups").innerText();
    check(`9b. ${tag} "Group these" groups the XN pair from the page`, /XN-1000 \/ XN-450/.test(groupsText) && /GROUP/.test(groupsText), groupsText.replace(/\s+/g, " ").slice(0, 160));
  }
  check(`${tag} method groups page: no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: `${OUT}/grp_settings_${scheme}_${width}.png`, fullPage: true });
  await page.goto(`${BASE}/labs/${A.labId}/veritacomp-app/employee/${kim}`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  await page.getByTestId("test-system-tab").filter({ hasText: "XN-1000 / XN-450" }).click(); await page.waitForTimeout(400);
  const badge = await page.getByTestId("group-badge").count();
  const note = await page.getByTestId("group-note").innerText().catch(() => "");
  check(`9c. ${tag} person page: GROUP badge and "Grouped by the lab" note on Kim's XN group`, badge >= 1 && /Grouped by the lab: XN-1000 and XN-450/.test(note), note);
  if (first) {
    await put(kim, XN1, { elements: els("KX") });
    await page.reload({ waitUntil: "networkidle" }); await page.waitForTimeout(900);
    await page.getByTestId("test-system-tab").filter({ hasText: "XN-1000 / XN-450" }).click(); await page.waitForTimeout(400);
    const covers = await page.getByTestId("sign-covers").innerText().catch(() => "");
    check(`9d. ${tag} sign form says it covers XN-1000 and XN-450`, /Covers XN-1000 and XN-450/.test(covers), covers);
  }
  check(`${tag} person page: no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: `${OUT}/grp_person_${scheme}_${width}.png`, fullPage: true });
  await page.goto(`${BASE}/labs/${A.labId}/veritacomp-app/instruments`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  const rowsTxt = (await page.getByTestId("instrument-row").allInnerTexts()).map((x) => x.replace(/\s+/g, " "));
  check(`9e. ${tag} By instrument: one XN group row with the GROUP badge`, rowsTxt.filter((x) => /XN-1000/.test(x)).length === 1 && rowsTxt.some((x) => /XN-1000 \/ XN-450 GROUP/.test(x)), rowsTxt.filter((x) => /XN/.test(x)).join(" | "));
  await page.screenshot({ path: `${OUT}/grp_index_${scheme}_${width}.png`, fullPage: true });
  first = false;
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
