// tests/integration/competency-needs-review.test.ts
//
// Michael 2026-11-05, Q179 = 1. Scratch DB, made-up people, real routes. Pins:
//   1. an unsigned element with data, no Pass and no N/A reads Needs review for everyone, and no stored value changes
//   2. the method reads needsReview, not ready to sign, and the counts follow; signable stays for Fail and Remediation Required
//   3. POST .../test-system/:id/sign refuses a Pass until every element is marked Pass or N/A, with the same text the form shows;
//      an N/A counts as marked; Fail and Remediation Required stay allowed on unmarked entries, with their action plan rule
//   4. a group sign-off is under the same rule; a waived method keeps its required-methods and specimen rules
//   5. the whole-record Sign & Complete, lab-scoped and legacy, is under the same rule for technical and waived program records
//   6. signed records print their real result; unsigned ones print Needs review (record PDF, program PDF, prior-year dialog)
//   7. imports and cohort records, which carry no entries to review, are left alone
// Run: npm run test:competency-needs-review
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { buildEmployeeCompetencyRecordHTML, buildCompetencyHTML } = await import("../../server/pdfReport");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const stamp = Date.now();
  const now = new Date().toISOString();
  const day = "2026-10-15";
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };
  const register = async (tag: string) => {
    const email = `nr-${tag.toLowerCase()}-${stamp}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `NR ${tag}`, hipaa_acknowledged: true });
    return { email, token: reg.j.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id) };
  };

  try {
    const OWNER = await register("Owner"), STAFF = await register("Staff");
    const tk = OWNER.token;
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: OWNER.email, labName: "Needs Review Lab", plan: "hospital" })).j.labId);
    const L = `/api/labs/${labId}`;
    await call("POST", `${L}/staff/lab`, { labName: "Needs Review Lab", cliaNumber: "11D7654390", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, tk);
    const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, tk)).j.id;
    const t = (analyte: string, complexity: string) => ({ analyte, specialty: "Hematology", complexity, active: 1 });
    const insts = ["Pass Refused", "Marked Later", "Na Marked", "Remediation", "Failed", "Plan Rule", "Incomplete Method", "Group Lead", "Group Member", "Second Person"];
    await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
      ...insts.map((name, i) => ({ name, category: "Hematology", tests: [t(`Analyte ${i}`, "MODERATE")] })),
      { name: "Meter Marked", category: "Point of Care", tests: [t("Glucose A", "WAIVED")] },
      { name: "Meter Unmarked", category: "Point of Care", tests: [t("Glucose B", "WAIVED")] },
    ] });
    const instOf = (name: string) => Number((sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id = ?").get(name, mapId) as any)?.id);
    const REFUSED = instOf("Pass Refused"), MARKED = instOf("Marked Later"), NA = instOf("Na Marked"), REMED = instOf("Remediation"), FAILED = instOf("Failed"), PLAN = instOf("Plan Rule"), INCOMPLETE = instOf("Incomplete Method"), LEAD = instOf("Group Lead"), MEMBER = instOf("Group Member"), SECOND = instOf("Second Person"), METER_OK = instOf("Meter Marked"), METER_NO = instOf("Meter Unmarked");
    const assign = (emp: number, list: number[]) => list.forEach((i) => sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(emp, i, now));
    const person = async (last: string, first: string, list: number[]) => {
      const id = Number((await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, tk)).j.id);
      assign(id, list);
      return id;
    };
    const pat = await person("Tester", "Pat", [REFUSED, MARKED, NA, REMED, FAILED, PLAN, INCOMPLETE, LEAD, MEMBER, METER_OK, METER_NO]);
    const kim = await person("Second", "Kim", [SECOND]);
    const tc = Number((await call("POST", `${L}/staff/employees`, { lastName: "Tate", firstName: "Casey", highestComplexity: "H", roles: [{ role: "TC", specialtyNumber: 8 }] }, tk)).j.id);
    const gs = Number((await call("POST", `${L}/staff/employees`, { lastName: "Ellis", firstName: "Jordan", highestComplexity: "H", roles: [{ role: "GS" }] }, tk)).j.id);
    sqlite.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 0, ?, ?, ?)`).run(labId, STAFF.id, now, now, now);
    sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'staff_portal', ?)`)
      .run(OWNER.id, STAFF.email, STAFF.id, now, now, `nr-${stamp}`, labId, pat);

    // Entries with data and no marks at all; `marks` adds Pass or N/A per element.
    const entries = (marks: Record<number, any> = {}) => [
      { num: 1, specimenId: "S-1", observerInitials: "CT", ...marks[1] },
      { num: 2, evidence: "Reviewed", date: day, ...marks[2] },
      { num: 3, qcDate: day, ...marks[3] },
      { num: 4, dateObserved: day, observerInitials: "CT", ...marks[4] },
      { num: 5, samples: [{ sampleType: "PT", sampleId: "PT-1" }], ...marks[5] },
      { num: 6, quizId: "Q-1", score: 90, dateTaken: day, ...marks[6] },
    ];
    const allPass = (nums = [1, 2, 3, 4, 5, 6]) => Object.fromEntries(nums.map((n) => [n, { passed: true }]));
    const put = (emp: number, inst: number, body: any) => call("PUT", `${L}/competency/employee/${emp}/test-system/${inst}`, body, tk);
    const view = async (emp: number, token = tk) => (await call("GET", `${L}/competency/employee/${emp}`, undefined, token)).j;
    const tsOf = (v: any, id: number) => (v.testSystems || []).find((x: any) => x.instrumentId === id) || {};
    const sign = (emp: number, inst: number, body: any = {}) => call("POST", `${L}/competency/employee/${emp}/test-system/${inst}/sign`, { signerStaffEmployeeId: tc, signerInitials: "CT", ...body }, tk);
    const rowsFor = (emp: number, inst: number) => sqlite.prepare(
      `SELECT i.* FROM competency_assessment_items i JOIN competency_assessments a ON a.id = i.assessment_id JOIN competency_employees ce ON ce.id = a.employee_id WHERE ce.staff_employee_id = ? AND i.instrument_id = ? ORDER BY i.id`
    ).all(emp, inst) as any[];
    const signoffCount = (emp: number, inst: number) => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM competency_method_signoffs WHERE staff_employee_id = ? AND instrument_id = ? AND revoked_at IS NULL").get(emp, inst) as any).n);
    check("0. fixture", labId > 0 && REFUSED > 0 && METER_NO > 0 && pat > 0 && tc > 0 && gs > 0);

    // ── 1. The label ──────────────────────────────────────────────────────────
    await put(pat, REFUSED, { elements: entries() });
    const before = JSON.stringify(rowsFor(pat, REFUSED));
    let v = await view(pat), ts = tsOf(v, REFUSED);
    check("1a. every unmarked element reads needs_review, none reads fail", ts.elements.every((e: any) => e.status === "needs_review"), JSON.stringify(ts.elements.map((e: any) => e.status)));
    check("1b. reading it changes nothing stored: passed stays 0 on every row", JSON.stringify(rowsFor(pat, REFUSED)) === before && rowsFor(pat, REFUSED).every((r) => r.passed === 0));
    const staffView = await view(pat, STAFF.token);
    check("1c. a Staff login reading their own record sees the same label", tsOf(staffView, REFUSED).elements.every((e: any) => e.status === "needs_review"));
    await put(pat, INCOMPLETE, { elements: entries().slice(0, 3) });
    const inc = tsOf(await view(pat), INCOMPLETE);
    check("1d. an element with no data stays Incomplete, an entered one Needs review", inc.elements[0].status === "needs_review" && inc.elements[3].status === "incomplete");

    // ── 2. Ready to sign ──────────────────────────────────────────────────────
    check("2a. a complete method with unmarked entries: needsReview, not readyToSign, still signable for Fail or Remediation", ts.needsReview === true && ts.readyToSign === false && ts.signable === true, JSON.stringify({ n: ts.needsReview, r: ts.readyToSign, s: ts.signable }));
    check("2b. an incomplete method is neither: it's still in progress", inc.needsReview === false && inc.readyToSign === false && inc.signable === false);
    await put(pat, MARKED, { elements: entries(allPass()) });
    const marked = tsOf(await view(pat), MARKED);
    check("2c. every element marked: readyToSign, no block message", marked.readyToSign === true && marked.needsReview === false && marked.passBlockMessage === null);
    const index = await call("GET", `${L}/competency/by-instrument`, undefined, tk);
    const rowFor = (id: number) => (index.j.instruments || []).find((r: any) => r.instrumentId === id) || {};
    check("2d. the By instrument index counts the same way", rowFor(REFUSED).ready === 0 && rowFor(REFUSED).needsReview === 1 && rowFor(MARKED).ready === 1 && rowFor(MARKED).needsReview === 0, JSON.stringify([rowFor(REFUSED), rowFor(MARKED)]));

    // ── 3. The Pass rule ──────────────────────────────────────────────────────
    const refused = await sign(pat, REFUSED, { determination: "pass" });
    check("3a. a Pass is refused on unmarked entries, naming the elements", refused.s === 409 && refused.j.code === "ELEMENTS_UNMARKED" && JSON.stringify(refused.j.unmarked) === "[1,2,3,4,5,6]" && /Elements 1, 2, 3, 4, 5 and 6 are not marked Pass or N\/A/.test(refused.j.error), `${refused.s} ${refused.j.error}`);
    check("3b. the refusal is word for word what the form shows", refused.j.error === ts.passBlockMessage, ts.passBlockMessage);
    check("3c. nothing was written: no sign-off, the rows aren't frozen", signoffCount(pat, REFUSED) === 0 && rowsFor(pat, REFUSED).every((r) => r.signoff_id == null));
    const noDet = await sign(pat, REFUSED);
    check("3d. no determination sent is treated as a Pass, and refused the same way", noDet.s === 409 && noDet.j.code === "ELEMENTS_UNMARKED", `${noDet.s}`);
    await put(pat, REFUSED, { elements: entries(allPass([1, 2, 3, 4, 5])) });
    const oneLeft = await sign(pat, REFUSED, { determination: "pass" });
    check("3e. one element left: refused, and it names just that one", oneLeft.s === 409 && JSON.stringify(oneLeft.j.unmarked) === "[6]" && /Element 6 is not marked/.test(oneLeft.j.error) && /Mark it and save/.test(oneLeft.j.error), oneLeft.j.error);
    await put(pat, REFUSED, { elements: entries(allPass()) });
    const allowed = await sign(pat, REFUSED, { determination: "pass" });
    check("3f. every element ticked: the Pass signs", allowed.s === 200 && allowed.j.determination === "pass" && signoffCount(pat, REFUSED) === 1, `${allowed.s} ${allowed.j.error ?? ""}`);
    const passSet = tsOf(await view(pat), REFUSED);
    check("3g. the signed Pass set reads PASS on every element", passSet.lastSignoff.elements.every((e: any) => e.status === "pass"));
    const signedMarked = await sign(pat, MARKED);
    check("3h. no determination sent on a fully marked method still signs, for existing API callers", signedMarked.s === 200 && signedMarked.j.determination === "pass", `${signedMarked.s}`);

    await put(pat, NA, { elements: entries({ ...allPass([1, 2, 4, 5, 6]), 3: { na: true, naJustification: "No QC on this method" } }) });
    const naTs = tsOf(await view(pat), NA);
    check("3i. an N/A counts as marked", naTs.elements[2].status === "na" && naTs.readyToSign === true && naTs.passBlockMessage === null, JSON.stringify(naTs.elements.map((e: any) => e.status)));
    const naSign = await sign(pat, NA, { determination: "pass" });
    check("3j. a Pass with an N/A element signs", naSign.s === 200, `${naSign.s} ${naSign.j.error ?? ""}`);

    await put(pat, REMED, { elements: entries() });
    const remedNoPlan = await sign(pat, REMED, { determination: "remediation" });
    check("3k. Remediation Required on unmarked entries keeps its action plan rule", remedNoPlan.s === 400 && /action plan/.test(remedNoPlan.j.error), `${remedNoPlan.s} ${remedNoPlan.j.error}`);
    const remed = await sign(pat, REMED, { determination: "remediation", remediationPlan: "Made-up retraining plan" });
    check("3l. Remediation Required is still allowed on unmarked entries", remed.s === 200 && remed.j.determination === "remediation", `${remed.s} ${remed.j.error ?? ""}`);
    const remedTs = tsOf(await view(pat), REMED);
    check("3m. that signed set keeps its real result: FAIL on the elements, not Needs review", remedTs.lastSignoff.elements.every((e: any) => e.status === "fail") && remedTs.needsRemediation === true, JSON.stringify(remedTs.lastSignoff.elements.map((e: any) => e.status)));
    await put(pat, FAILED, { elements: entries() });
    const failed = await sign(pat, FAILED, { determination: "fail", remediationPlan: "Made-up plan" });
    check("3n. Fail is still allowed on unmarked entries", failed.s === 200 && failed.j.determination === "fail", `${failed.s} ${failed.j.error ?? ""}`);
    await put(pat, PLAN, { elements: entries().slice(0, 5) });
    const missing = await sign(pat, PLAN, { determination: "remediation", remediationPlan: "Plan" });
    check("3o. an element with no data at all still blocks every determination, as before", missing.s === 409 && (missing.j.incomplete || []).some((x: string) => /element 6/.test(x)), `${missing.s} ${JSON.stringify(missing.j)}`);

    // ── 4. Group and waived ───────────────────────────────────────────────────
    const made = await call("POST", `${L}/competency/method-groups`, { name: "Made-up Group", instrumentIds: [LEAD, MEMBER] }, tk);
    const lead = Math.min(LEAD, MEMBER), other = Math.max(LEAD, MEMBER);
    await put(pat, other, { elements: entries() });
    const groupRefused = await sign(pat, other, { determination: "pass" });
    check("4a. a group sign-off is refused the same way, through any analyzer in the group", [200, 201].includes(made.s) && groupRefused.s === 409 && groupRefused.j.code === "ELEMENTS_UNMARKED" && signoffCount(pat, lead) === 0 && signoffCount(pat, other) === 0, `${made.s} ${groupRefused.s}`);
    await put(pat, other, { elements: entries(allPass()) });
    const groupOk = await sign(pat, other, { determination: "pass" });
    check("4b. marked, it signs one row per analyzer", groupOk.s === 200 && signoffCount(pat, lead) === 1 && signoffCount(pat, other) === 1, `${groupOk.s} ${groupOk.j.error ?? ""}`);

    await put(pat, METER_NO, { waivedMethods: [{ num: 2, evidence: "Observed", date: day }, { num: 3, evidence: "QC", date: day }] });
    const unmarkedMeter = tsOf(await view(pat), METER_NO);
    check("4c. waived: a method with data and no Pass reads Needs review, never Not passed", unmarkedMeter.waivedMethods[1].status === "needs_review" && unmarkedMeter.waivedMethods[2].status === "needs_review" && unmarkedMeter.waivedMethods[0].status === "unused", JSON.stringify(unmarkedMeter.waivedMethods.map((m: any) => m.status)));
    check("4d. two entered, none marked: Needs review, not ready to sign", unmarkedMeter.needsReview === true && unmarkedMeter.readyToSign === false && unmarkedMeter.signable === false);
    const meterRefused = await sign(pat, METER_NO, { signerStaffEmployeeId: gs, determination: "pass" });
    check("4e. the required-methods rule still refuses it", meterRefused.s === 409 && (meterRefused.j.incomplete || []).some((x: string) => /0 of 2 waived methods passed/.test(x)), `${meterRefused.s} ${JSON.stringify(meterRefused.j)}`);
    await put(pat, METER_OK, { waivedMethods: [
      { num: 1, specimens: [{ evidence: "BS-1", date: day, initials: "JE", passed: true }, { evidence: "BS-2", date: day, initials: "JE", passed: false }] },
      { num: 2, evidence: "Observed", date: day, initials: "JE", passed: true },
      { num: 3, evidence: "QC", date: day, initials: "JE", passed: true },
    ] });
    const meterWithExtra = tsOf(await view(pat), METER_OK);
    check("4f. every specimen rule stays: one specimen unmarked means method 1 isn't passed", meterWithExtra.waivedMethods[0].status === "needs_review" && meterWithExtra.waivedPassed === 2, JSON.stringify(meterWithExtra.waivedMethods.map((m: any) => m.status)));
    check("4g. two passed plus one unmarked: signable, but it reads Needs review and has no Pass block", meterWithExtra.signable === true && meterWithExtra.needsReview === true && meterWithExtra.readyToSign === false && meterWithExtra.passBlockMessage === null);
    const meterSign = await sign(pat, METER_OK, { signerStaffEmployeeId: gs, determination: "pass" });
    check("4h. the required-methods rule decides the Pass, so it signs", meterSign.s === 200, `${meterSign.s} ${meterSign.j.error ?? ""}`);
    const meterSigned = tsOf(await view(pat), METER_OK);
    const signedMethods = meterSigned.lastSignoff.waivedMethods;
    check("4i. the signed set keeps its real result for the unmarked method", signedMethods.find((m: any) => m.num === 1).status === "fail" && signedMethods.find((m: any) => m.num === 2).status === "pass", JSON.stringify(signedMethods.map((m: any) => [m.num, m.status])));

    // ── 5. The whole-record Sign & Complete ───────────────────────────────────
    const mgProg = (await call("POST", `${L}/competency/programs`, { name: "Made-up Technical", department: "Hematology", type: "technical", methodGroups: [{ name: "Made-up Group Row", instruments: ["Second Person"], analytes: [] }] }, tk)).j.id;
    const mgId = Number((sqlite.prepare("SELECT id FROM competency_method_groups WHERE program_id = ?").get(mgProg) as any).id);
    const kimComp = Number(((await call("GET", `${L}/competency/programs/${mgProg}/eligible-employees`, undefined, tk)).j.employees || [])[0]?.id) || Number((sqlite.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ?").get(kim) as any)?.id);
    const techItems = (marks: Record<number, any> = {}) => [1, 2, 3, 4, 5, 6].map((n) => ({
      methodNumber: n, elementNumber: n, methodGroupId: mgId, methodGroupName: "Made-up Group Row",
      ...(n === 1 ? { el1SpecimenId: "S" } : n === 2 ? { el2Evidence: "E", el2Date: day } : n === 3 ? { el3QcDate: day } : n === 4 ? { el4DateObserved: day } : n === 5 ? { el5SampleId: "P" } : { el6QuizId: "Q" }),
      ...marks[n],
    }));
    const newRecord = async (programId: number, status: string, items: any[], type = "technical", extra: any = {}) => (await call("POST", `${L}/competency/assessments`, { programId, employeeId: kimComp, assessmentType: "annual", assessmentDate: day, evaluatorName: "Made Up", competencyType: type, status, items, ...extra }, tk)).j.id as number;
    const signRecord = (id: number, body: any = {}, path = `${L}/competency/assessments/${id}/sign`) => call("POST", path, body, tk);
    const lockedOf = (id: number) => (sqlite.prepare("SELECT locked FROM competency_assessments WHERE id = ?").get(id) as any).locked;
    const passMarks = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, { passed: true }]));

    const unmarkedRec = await newRecord(mgProg, "pass", techItems());
    const recRefused = await signRecord(unmarkedRec);
    check("5a. lab-scoped Sign & Complete: a Pass record with unmarked rows is refused, naming them, and stays open", recRefused.s === 409 && recRefused.j.code === "ELEMENTS_UNMARKED" && /Made-up Group Row \(Elements 1, 2, 3, 4, 5 and 6\)/.test(recRefused.j.error) && lockedOf(unmarkedRec) === 0, `${recRefused.s} ${recRefused.j.error}`);
    const legacyRefused = await signRecord(unmarkedRec, {}, `/api/competency/assessments/${unmarkedRec}/sign`);
    check("5b. the legacy route is under the same rule", legacyRefused.s === 409 && legacyRefused.j.code === "ELEMENTS_UNMARKED" && lockedOf(unmarkedRec) === 0, `${legacyRefused.s} ${legacyRefused.j.error}`);
    const markedRec = await newRecord(mgProg, "pass", techItems(passMarks));
    const recOk = await signRecord(markedRec);
    check("5c. every row marked: it signs", recOk.s === 200 && lockedOf(markedRec) === 1, `${recOk.s} ${recOk.j.error ?? ""}`);
    const legacyRec = await newRecord(mgProg, "pass", techItems(passMarks));
    const legacyOk = await signRecord(legacyRec, {}, `/api/competency/assessments/${legacyRec}/sign`);
    check("5d. the legacy route signs a marked record", legacyOk.s === 200 && lockedOf(legacyRec) === 1, `${legacyOk.s}`);
    const naRec = await newRecord(mgProg, "pass", techItems({ ...passMarks, 3: { el3Na: true, el3NaJustification: "Not run", passed: false } }));
    const naRecOk = await signRecord(naRec);
    check("5e. an N/A row counts as marked", naRecOk.s === 200 && lockedOf(naRec) === 1, `${naRecOk.s} ${naRecOk.j.error ?? ""}`);
    const remedRec = await newRecord(mgProg, "remediation", techItems(), "technical", { remediationPlan: "Made-up plan" });
    const failRec = await newRecord(mgProg, "fail", techItems());
    const remedRecOk = await signRecord(remedRec), failRecOk = await signRecord(failRec);
    check("5f. a Remediation or Fail record signs with unmarked rows", remedRecOk.s === 200 && failRecOk.s === 200 && lockedOf(remedRec) === 1 && lockedOf(failRec) === 1, `${remedRecOk.s}/${failRecOk.s}`);

    const waivedProg = (await call("POST", `${L}/competency/programs`, { name: "Made-up Waived", department: "Hematology", type: "waived" }, tk)).j.id;
    const wItem = (num: number, passed: boolean) => ({ methodNumber: num, waivedMethodNumber: num, waivedEvidence: "E", waivedDate: day, waivedInitials: "ME", passed });
    const oneOfTwo = await newRecord(waivedProg, "pass", [wItem(1, true), wItem(3, false)], "waived");
    const waivedRefused = await signRecord(oneOfTwo);
    check("5g. a waived record with 1 of 2 passed can't be signed as a Pass", waivedRefused.s === 409 && /1 of 2 required waived methods/.test(waivedRefused.j.error) && lockedOf(oneOfTwo) === 0, `${waivedRefused.s} ${waivedRefused.j.error}`);
    const twoOfTwo = await newRecord(waivedProg, "pass", [wItem(1, true), wItem(3, true)], "waived");
    const waivedOk = await signRecord(twoOfTwo);
    check("5h. with 2 of 2 it signs", waivedOk.s === 200 && lockedOf(twoOfTwo) === 1, `${waivedOk.s} ${waivedOk.j.error ?? ""}`);
    const waivedRemed = await newRecord(waivedProg, "remediation", [wItem(1, false)], "waived", { remediationPlan: "Made-up plan" });
    check("5i. a waived Remediation record still signs", (await signRecord(waivedRemed)).s === 200);
    const paperEmpty = await newRecord(waivedProg, "pass", [], "waived");
    const paperOk = await signRecord(paperEmpty, { signed_on_paper_date: "2026-01-15", documentation: "Paper record in the made-up binder" });
    check("5j. a record signed on paper and entered with no rows has nothing to review, so it signs", paperOk.s === 200 && lockedOf(paperEmpty) === 1, `${paperOk.s} ${paperOk.j.error ?? ""}`);
    const todayEmpty = await newRecord(waivedProg, "pass", [], "waived");
    check("5k. the same empty record signed today is refused", (await signRecord(todayEmpty)).s === 409 && lockedOf(todayEmpty) === 0);
    const ntProg = (await call("POST", `${L}/competency/programs`, { name: "Made-up Non-technical", department: "General", type: "nontechnical", checklistItems: [{ description: "Made-up item" }] }, tk)).j.id;
    const ntRec = await newRecord(ntProg, "pass", [{ itemLabel: "A", ntItemLabel: "A", ntDateMet: day, ntEmployeeInitials: "PT", ntSupervisorInitials: "JE", passed: true }], "nontechnical");
    check("5l. a non-technical record has no element marks and is unchanged", (await signRecord(ntRec)).s === 200 && lockedOf(ntRec) === 1);

    // ── 6. What prints ────────────────────────────────────────────────────────
    // Someone new: Kim's whole-record signs above count as imported history on her method (BUG-120), so her method reads as signed.
    const uma = await person("Unsigned", "Uma", [SECOND]);
    await put(uma, SECOND, { elements: entries() });
    const umaV = await view(uma);
    const unsignedHtml = buildEmployeeCompetencyRecordHTML({ labName: "Needs Review Lab", cliaNumber: "11D7654390", employee: umaV.employee, elementCount: umaV.elementCount, testSystems: umaV.testSystems });
    const chips = (html: string, cls: string) => (html.match(new RegExp(`class="chip ${cls}"`, "g")) || []).length;
    check("6a. record PDF, unsigned: six Needs review chips and the result reads Needs review", /Needs review/.test(unsignedHtml) && chips(unsignedHtml, "c-amber") >= 7, String(chips(unsignedHtml, "c-amber")));
    check("6b. record PDF, unsigned: no FAIL chip and no Ready to sign", chips(unsignedHtml, "c-fail") === 0 && !/Ready to sign/.test(unsignedHtml));
    const patV = await view(pat);
    const signedHtml = buildEmployeeCompetencyRecordHTML({ labName: "Needs Review Lab", cliaNumber: "11D7654390", employee: patV.employee, elementCount: patV.elementCount, testSystems: patV.testSystems.filter((x: any) => [REMED, FAILED].includes(x.instrumentId)) });
    check("6c. record PDF, signed Remediation and Fail: their FAIL chips print, not Needs review", chips(signedHtml, "c-fail") >= 12 && /Remediation required/.test(signedHtml) && !/>Needs review</.test(signedHtml), String(chips(signedHtml, "c-fail")));
    const passHtml = buildEmployeeCompetencyRecordHTML({ labName: "Needs Review Lab", employee: patV.employee, elementCount: patV.elementCount, testSystems: patV.testSystems.filter((x: any) => x.instrumentId === REFUSED) });
    check("6d. record PDF, signed Pass: PASS chips and Competent", chips(passHtml, "c-pass") >= 7 && /Competent/.test(passHtml) && !/>Needs review</.test(passHtml), String(chips(passHtml, "c-pass")));

    const pdfInput = (assessmentId: number) => ({
      assessment: sqlite.prepare(`SELECT a.*, p.name as program_name, p.department, p.type as program_type, e.name as employee_name, e.title as employee_title FROM competency_assessments a JOIN competency_programs p ON a.program_id = p.id JOIN competency_employees e ON a.employee_id = e.id WHERE a.id = ?`).get(assessmentId),
      items: sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(assessmentId),
      methodGroups: [{ id: mgId, name: "Made-up Group Row", instruments: "[]", analytes: "[]" }], checklistItems: [], labName: "Needs Review Lab", quizResults: [], cliaNumber: "11D7654390", elementDocuments: [],
    }) as any;
    const openPdf = buildCompetencyHTML(pdfInput(unmarkedRec));
    check("6e. program PDF, unsigned record with a Pass status: the summary reads NEEDS REVIEW, never PASS, for unmarked rows", (openPdf.match(/>NEEDS REVIEW</g) || []).length === 6 && !/font-weight:700;color:#437A22">PASS</.test(openPdf), String((openPdf.match(/>NEEDS REVIEW</g) || []).length));
    const failOpenRec = await newRecord(mgProg, "fail", techItems());
    const failOpenPdf = buildCompetencyHTML(pdfInput(failOpenRec));
    check("6f. program PDF, unsigned record with a Fail status: unmarked rows still read NEEDS REVIEW, not FAIL", (failOpenPdf.match(/>NEEDS REVIEW</g) || []).length === 6, String((failOpenPdf.match(/>NEEDS REVIEW</g) || []).length));
    const lockedPdf = buildCompetencyHTML(pdfInput(failRec));
    check("6g. program PDF, signed record: no NEEDS REVIEW, it prints the recorded verdict", !/NEEDS REVIEW/.test(lockedPdf) && />FAIL</.test(lockedPdf));
    const legacyPaper = await newRecord(mgProg, "pass", techItems());
    sqlite.prepare("UPDATE competency_assessment_items SET evidence = 'Legacy text' WHERE assessment_id = ?").run(legacyPaper);
    const openCellPdf = buildCompetencyHTML(pdfInput(legacyPaper));
    check("6h. program PDF, an unsigned row scored the old way reads Needs review in its detail cell, not Fail", />Needs review</.test(openCellPdf) && !/class="fail-badge"/.test(openCellPdf));
    sqlite.prepare("UPDATE competency_assessments SET locked = 1 WHERE id = ?").run(legacyPaper);
    check("6i. once locked the same row prints Fail: signed records keep their result", /class="fail-badge"/.test(buildCompetencyHTML(pdfInput(legacyPaper))));

    const current = await newRecord(mgProg, "pass", techItems(passMarks), "technical", { assessmentDate: "2026-11-01" });
    const prior = await call("GET", `${L}/competency/assessments/${current}/prior-year-comparison`, undefined, tk);
    const priorOf = (id: number) => (prior.j.priors || []).find((p: any) => p.id === id);
    const signedPrior = (prior.j.priors || []).find((p: any) => p.locked && p.status === "fail");
    const openPrior = (prior.j.priors || []).find((p: any) => !p.locked);
    check("6j. prior-year dialog: an unsigned prior reads needs_review and a signed one keeps fail", openPrior?.elements?.["1"]?.status === "needs_review" && (!!signedPrior ? signedPrior.elements["1"].status === "fail" : (priorOf(failRec)?.elements?.["1"]?.status ?? "fail") === "fail"), JSON.stringify((prior.j.priors || []).map((p: any) => [p.id, p.locked, p.status, p.elements?.["1"]?.status])));

    // ── 7. Left alone ─────────────────────────────────────────────────────────
    const cohortWaived = await call("POST", `${L}/competency/assessments/cohort-commit`, { programId: waivedProg, employeeIds: [kimComp], assessmentType: "annual", assessmentDate: "2026-09-01", status: "pass", evaluatorName: "Made Up" }, tk);
    check("7a. a cohort record carries no entries to review, and still commits", cohortWaived.s === 200 && cohortWaived.j.inserted === 1, `${cohortWaived.s} ${JSON.stringify(cohortWaived.j)}`);
    const cohortTech = await call("POST", `${L}/competency/assessments/cohort-commit`, { programId: mgProg, employeeIds: [kimComp], assessmentType: "annual", assessmentDate: "2026-09-02", status: "pass", evaluatorName: "Made Up" }, tk);
    check("7b. a technical cohort is still refused (BUG-120), so no technical Pass goes that way", cohortTech.s === 400 && cohortTech.j.error === "shared_field_invalid", `${cohortTech.s}`);
    check("7c. nothing rewrote history: the signed Pass set's rows are still marked and frozen", rowsFor(pat, REFUSED).filter((r) => r.signoff_id != null).length === 6 && rowsFor(pat, REFUSED).filter((r) => r.signoff_id != null).every((r) => r.passed === 1));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
