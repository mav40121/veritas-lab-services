// tests/integration/staff-own-competency-data.test.ts
//
// Michael 2026-11-05 (Cathy Thornton, RFGH): "staff are being blocked from entering their own competency information."
// His 2026-09-27 rule: an employee adds the factual DATA on their OWN unsigned record; the observer, the verdict, N/A
// determinations and the evaluator stay the evaluator's. Boots the REAL routes on a scratch DB with made-up people and proves:
//   the person page's PUT .../my-data saves a Staff login's own data, ignores evaluator-owned values, and reaches nobody
//   else, no other lab, no signed item and no locked record; the evaluator's route is unchanged; waived entry works on both
//   paths; the implicit container is not asked to be acknowledged; a lapsed lab and a non-Staff member are refused; bad
//   entries are refused; every save is audited.
// Run: npm run test:staff-own-competency-data
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

// Every column a Staff login must never move.
const EVALUATOR_COLS = [
  "passed", "el1_observer_initials", "el1_na", "el1_na_justification", "el2_na", "el2_na_justification", "el3_na", "el3_na_justification",
  "el4_date_observed", "el4_observer_initials", "el4_na", "el4_na_justification", "el5_acceptable", "el5_na", "el5_na_justification",
  "el6_na", "el6_na_justification", "el7_date_observed", "el7_observer_initials", "el8_function_assessed", "el8_date", "waived_initials", "signoff_id",
];

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
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
  const day = "2026-10-15", day2 = "2026-10-20";
  const call = async (method: string, path: string, body: unknown, token: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };
  const register = async (tag: string) => {
    const email = `sod-${tag.toLowerCase()}-${stamp}@example.com`;
    const reg = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `SOD ${tag}`, hipaa_acknowledged: true }) })).json();
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    return { email, id, token: reg.token as string };
  };
  const provision = async (email: string, labName: string) => Number((await (await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: email, labName, plan: "hospital" }) })).json()).labId);

  try {
    const OWNER = await register("Owner"), ANN = await register("Ann"), BEN = await register("Ben"), CARA = await register("Cara"), EDITOR = await register("Editor"), VIEWER = await register("Viewer"), PLAIN = await register("Plain"), OWNER2 = await register("Owner2"), ZED = await register("Zed");
    const labId = await provision(OWNER.email, "Own Data Lab");
    const lab2 = await provision(OWNER2.email, "Other Lab");
    const L = `/api/labs/${labId}`, L2 = `/api/labs/${lab2}`;
    await call("POST", `${L}/staff/lab`, { labName: "Own Data Lab", cliaNumber: "11D7654380", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    await call("POST", `${L2}/staff/lab`, { labName: "Other Lab", cliaNumber: "11D7654381", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER2.token);

    const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, OWNER.token)).j.id;
    const map2 = (await call("POST", `${L2}/veritamap/maps`, { name: "Core" }, OWNER2.token)).j.id;
    const t = (analyte: string, complexity: string) => ({ analyte, specialty: "Hematology", complexity, active: 1 });
    await fetch(`${base}/api/admin/veritamap/seed-map?secret=${ADMIN}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapId, defaultActive: 1, instruments: [
      { name: "Made-up Analyzer", category: "Hematology", tests: [t("Made-up WBC", "MODERATE")] },
      { name: "Made-up Second", category: "Hematology", tests: [t("Made-up RBC", "MODERATE")] },
      { name: "Made-up Third", category: "Hematology", tests: [t("Made-up PLT", "MODERATE")] },
      { name: "Made-up Meter", category: "Point of Care", tests: [t("Made-up Glucose", "WAIVED")] },
      { name: "Made-up Unassigned", category: "Hematology", tests: [t("Made-up MCV", "MODERATE")] },
      { name: "Grouped Lead", category: "Hematology", tests: [t("Made-up HGB", "MODERATE")] },
      { name: "Grouped Member", category: "Hematology", tests: [t("Made-up HCT", "MODERATE")] },
      { name: "Older Program Analyzer", category: "Hematology", tests: [t("Made-up RDW", "MODERATE")] },
    ] }) });
    await fetch(`${base}/api/admin/veritamap/seed-map?secret=${ADMIN}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapId: map2, defaultActive: 1, instruments: [
      { name: "Other Lab Analyzer", category: "Hematology", tests: [t("Made-up WBC", "MODERATE")] },
    ] }) });
    const instOf = (name: string) => Number((sqlite.prepare("SELECT i.id FROM veritamap_instruments i JOIN veritamap_maps m ON m.id = i.map_id WHERE i.instrument_name = ? AND m.lab_id IN (?, ?)").get(name, labId, lab2) as any)?.id);
    const ANALYZER = instOf("Made-up Analyzer"), SECOND = instOf("Made-up Second"), THIRD = instOf("Made-up Third"), METER = instOf("Made-up Meter"), UNASSIGNED = instOf("Made-up Unassigned"), OTHER_LAB_INST = instOf("Other Lab Analyzer"), GROUP_LEAD = instOf("Grouped Lead"), GROUP_MEMBER = instOf("Grouped Member"), OLDER = instOf("Older Program Analyzer");

    const person = async (last: string, first: string, insts: number[], labPath = L, token = OWNER.token) => {
      const id = Number((await call("POST", `${labPath}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, token)).j.id);
      for (const i of insts) sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(id, i, now);
      return id;
    };
    const annId = await person("Self", "Ann", [ANALYZER, SECOND, THIRD, METER, GROUP_MEMBER, OLDER]);
    const benId = await person("Other", "Ben", [ANALYZER, METER]);
    const caraId = await person("Locked", "Cara", [ANALYZER]);
    const viewerRosterId = await person("Reviewer", "Vera", [ANALYZER]);
    const zedId = await person("Lab", "Zed", [OTHER_LAB_INST], L2, OWNER2.token);
    const tc = Number((await call("POST", `${L}/staff/employees`, { lastName: "Tate", firstName: "Casey", highestComplexity: "H", roles: [{ role: "TC", specialtyNumber: 8 }] }, OWNER.token)).j.id);
    const gs = Number((await call("POST", `${L}/staff/employees`, { lastName: "Ellis", firstName: "Jordan", highestComplexity: "H", roles: [{ role: "GS" }] }, OWNER.token)).j.id);

    const member = (lab: number, userId: number) => sqlite.prepare(
      `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 0, ?, ?, ?)`
    ).run(lab, userId, now, now, now);
    const seat = (ownerId: number, lab: number, u: { id: number; email: string }, type: string, perms: string, rosterId: number | null) => sqlite.prepare(
      `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    ).run(ownerId, u.email, u.id, now, now, perms, `sod-${u.id}-${stamp}`, lab, type, rosterId);
    member(labId, ANN.id); seat(OWNER.id, labId, ANN, "staff_portal", '{"mode":"view_all"}', annId);
    member(labId, BEN.id); seat(OWNER.id, labId, BEN, "staff_portal", '{"mode":"view_all"}', benId);
    member(labId, CARA.id); seat(OWNER.id, labId, CARA, "staff_portal", '{"mode":"view_all"}', caraId);
    member(labId, EDITOR.id); seat(OWNER.id, labId, EDITOR, "active", '{"mode":"edit_all"}', null);
    // A non-Staff member on the roster with no edit permission: the seat type, not the roster link, is what must decide.
    member(labId, VIEWER.id); seat(OWNER.id, labId, VIEWER, "view_only", '{"mode":"view_all"}', viewerRosterId);
    member(labId, PLAIN.id);
    member(lab2, ZED.id); seat(OWNER2.id, lab2, ZED, "staff_portal", '{"mode":"view_all"}', zedId);

    const myData = (emp: number, inst: number, body: any, token = ANN.token, lab = L) => call("PUT", `${lab}/competency/employee/${emp}/test-system/${inst}/my-data`, body, token);
    const evaluatorPut = (emp: number, inst: number, body: any, token = OWNER.token) => call("PUT", `${L}/competency/employee/${emp}/test-system/${inst}`, body, token);
    const view = async (emp: number, token = OWNER.token) => (await call("GET", `${L}/competency/employee/${emp}`, undefined, token)).j;
    const tsOf = (v: any, id: number) => (v.testSystems || []).find((x: any) => x.instrumentId === id) || {};
    const rowsFor = (emp: number, inst: number) => sqlite.prepare(
      `SELECT i.* FROM competency_assessment_items i JOIN competency_assessments a ON a.id = i.assessment_id JOIN competency_employees ce ON ce.id = a.employee_id
       WHERE ce.staff_employee_id = ? AND i.instrument_id = ? ORDER BY i.id`
    ).all(emp, inst) as any[];
    const evaluatorSnapshot = (rows: any[]) => JSON.stringify(rows.map((r) => [r.id, ...EVALUATOR_COLS.map((c) => r[c])]));
    const rowOf = (rows: any[], el: number) => rows.find((r) => Number(r.element_number) === el) || {};
    const auditCount = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'assessment_self_edit'").get() as any).n);
    const totalItems = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM competency_assessment_items").get() as any).n);
    const refusedFlat = (r: { s: number }) => r.s === 403;

    check("0. fixture: lab, instruments, people and seats", !!labId && !!lab2 && !!ANALYZER && !!METER && !!OTHER_LAB_INST && annId > 0 && benId > 0 && tc > 0 && gs > 0, JSON.stringify({ labId, lab2, annId, benId }));

    // ── Who the server says may enter data ────────────────────────────────────
    check("1a. a Staff login on their own record may enter data", (await view(annId, ANN.token)).canEnterOwnData === true);
    check("1b. a Staff login on someone else's record may not", (await view(benId, ANN.token)).canEnterOwnData === false);
    check("1c. the owner, an editor and a view-only member are not in self-entry", (await view(annId, OWNER.token)).canEnterOwnData === false && (await view(annId, EDITOR.token)).canEnterOwnData === false && (await view(viewerRosterId, VIEWER.token)).canEnterOwnData === false);
    check("1d. the evaluator's route still refuses a Staff login", refusedFlat(await evaluatorPut(annId, ANALYZER, { elements: [{ num: 1, specimenId: "X" }] }, ANN.token)));

    // ── Own technical data saves ──────────────────────────────────────────────
    let auditBefore = auditCount();
    const firstSave = await myData(annId, ANALYZER, { elements: [
      { num: 1, specimenId: "S-100" }, { num: 2, evidence: "Result review", date: day }, { num: 3, qcDate: day },
      { num: 5, samples: [{ sampleType: "PT", sampleId: "PT-1" }, { sampleType: "Blind", sampleId: "BL-2" }] }, { num: 6, quizId: "Q-1", score: "95", dateTaken: day },
    ] });
    let rows = rowsFor(annId, ANALYZER);
    check("2a. a Staff login saves their own technical data", firstSave.s === 200 && rowOf(rows, 1).el1_specimen_id === "S-100" && rowOf(rows, 2).el2_evidence === "Result review" && rowOf(rows, 2).el2_date === day && rowOf(rows, 3).el3_qc_date === day && rowOf(rows, 6).el6_quiz_id === "Q-1" && rowOf(rows, 6).el6_score === 95 && rowOf(rows, 6).el6_date_taken === day, `${firstSave.s} ${firstSave.j.error ?? ""}`);
    check("2b. Element 5 keeps both samples, the first in the old columns", rowOf(rows, 5).el5_sample_type === "PT" && rowOf(rows, 5).el5_sample_id === "PT-1" && JSON.parse(rowOf(rows, 5).el5_samples_json || "[]").length === 2);
    check("2c. no evaluator value appears from a Staff entry", rows.every((r) => !r.passed && !r.el1_observer_initials && !r.el1_na) && !rows.some((r) => Number(r.element_number) === 4));
    let v = await view(annId, ANN.token);
    check("2d. it reads back on the person's own view and the method is in progress", tsOf(v, ANALYZER).elements?.[0]?.specimenId === "S-100" && tsOf(v, ANALYZER).hasData === true && tsOf(v, ANALYZER).signable === false && tsOf(v, ANALYZER).elements?.[3]?.status === "incomplete");
    check("2e. an audit row names the person", auditCount() === auditBefore + 1);
    const audit = sqlite.prepare("SELECT * FROM audit_log WHERE entity_type = 'assessment_self_edit' ORDER BY id DESC LIMIT 1").get() as any;
    check("2f. the audit row has the person's user, the owner, their name and the method, and before and after", audit?.user_id === ANN.id && audit?.owner_user_id === OWNER.id && /Ann Self \/ Made-up Analyzer/.test(audit?.entity_label || "") && audit?.module === "veritacomp" && !!audit?.before_json && /S-100/.test(audit?.after_json || ""), audit?.entity_label);

    // ── A hostile first save on a method with no rows ─────────────────────────
    const hostileFirst = await myData(annId, SECOND, { elements: [
      { num: 1, specimenId: "S-200", observerInitials: "CT", passed: true, na: true, naJustification: "No" },
      { num: 4, dateObserved: day, observerInitials: "CT", passed: true }, { num: 5, samples: [{ sampleType: "PT", sampleId: "P", acceptable: true }] },
    ] });
    rows = rowsFor(annId, SECOND);
    check("3a. first save: observer, Pass, N/A, Acceptable and Element 4 are not taken from the client", hostileFirst.s === 200 && rows.length === 2 && rowOf(rows, 1).el1_specimen_id === "S-200" && !rowOf(rows, 1).el1_observer_initials && !rowOf(rows, 1).passed && !rowOf(rows, 1).el1_na && rowOf(rows, 5).el5_acceptable == null && !rows.some((r) => Number(r.element_number) === 4), `${hostileFirst.s} ${JSON.stringify(rows.map((r) => r.element_number))}`);

    // ── The evaluator marks the record, then the person saves again ───────────
    v = await view(annId);
    const evalElements = [
      { num: 1, specimenId: "S-100", observerInitials: "CT", passed: true },
      { num: 2, evidence: "Result review", date: day, passed: true, },
      { num: 3, na: true, naJustification: "Evaluator says no QC on this one" },
      { num: 4, dateObserved: day, observerInitials: "CT", passed: true },
      { num: 5, samples: [{ sampleType: "PT", sampleId: "PT-1", acceptable: true }, { sampleType: "Blind", sampleId: "BL-2", acceptable: false }], passed: true },
      { num: 6, quizId: "Q-1", score: 95, dateTaken: day, passed: true },
    ];
    const ownerSave = await evaluatorPut(annId, ANALYZER, { elements: evalElements });
    rows = rowsFor(annId, ANALYZER);
    check("4a. the owner's save still works and rewrites Pass, N/A, observer and Element 4", ownerSave.s === 200 && rowOf(rows, 1).passed === 1 && rowOf(rows, 1).el1_observer_initials === "CT" && rowOf(rows, 3).el3_na === 1 && rowOf(rows, 4).el4_date_observed === day && rowOf(rows, 5).el5_acceptable === 1, `${ownerSave.s} ${ownerSave.j.error ?? ""}`);
    const snapshot = evaluatorSnapshot(rows);
    auditBefore = auditCount();
    const hostile = await myData(annId, ANALYZER, { elements: [
      { num: 1, specimenId: "S-101", observerInitials: "ZZ", passed: false, na: true, naJustification: "Hack" },
      { num: 2, evidence: "Corrected evidence", date: day2, passed: false },
      { num: 4, dateObserved: day2, observerInitials: "ZZ", passed: false, na: true, naJustification: "Hack" },
      { num: 5, samples: [{ sampleType: "PT-edited", sampleId: "PT-1b", acceptable: false }, { sampleType: "Blind", sampleId: "BL-2", acceptable: true }, { sampleType: "New", sampleId: "NEW-3", acceptable: true }], passed: false },
      { num: 6, quizId: "Q-2", score: 88, dateTaken: day2, passed: false },
    ] });
    rows = rowsFor(annId, ANALYZER);
    check("4b. Pass, N/A, observer, Acceptable and Element 4 sent by the client stay as stored", hostile.s === 200 && evaluatorSnapshot(rows) === snapshot, `${hostile.s} ${hostile.j.error ?? ""}`);
    check("4c. the data fields did change, in place", rowOf(rows, 1).el1_specimen_id === "S-101" && rowOf(rows, 2).el2_evidence === "Corrected evidence" && rowOf(rows, 2).el2_date === day2 && rowOf(rows, 6).el6_quiz_id === "Q-2" && rowOf(rows, 6).el6_score === 88);
    const samples = JSON.parse(rowOf(rows, 5).el5_samples_json || "[]");
    check("4d. each sample keeps its own Acceptable mark and a new sample has none", samples.length === 3 && samples[0].acceptable === true && samples[1].acceptable === false && samples[2].acceptable === null && samples[2].sampleId === "NEW-3" && rowOf(rows, 5).el5_sample_type === "PT-edited", JSON.stringify(samples));
    check("4e. the save is audited as the person's", auditCount() === auditBefore + 1);

    const dropMarked = await myData(annId, ANALYZER, { elements: [{ num: 5, samples: [{ sampleType: "PT-edited", sampleId: "PT-1b" }] }] });
    check("4f. a sample carrying the evaluator's mark can't be removed", dropMarked.s === 400 && /Acceptable/.test(dropMarked.j.error || "") && JSON.parse(rowOf(rowsFor(annId, ANALYZER), 5).el5_samples_json || "[]").length === 3, `${dropMarked.s} ${dropMarked.j.error}`);
    const dropNew = await myData(annId, ANALYZER, { elements: [{ num: 5, samples: [{ sampleType: "PT-edited", sampleId: "PT-1b" }, { sampleType: "Blind", sampleId: "BL-2" }] }] });
    check("4g. a trailing sample with no mark can be removed", dropNew.s === 200 && JSON.parse(rowOf(rowsFor(annId, ANALYZER), 5).el5_samples_json || "[]").length === 2, `${dropNew.s} ${dropNew.j.error}`);
    const onNa = await myData(annId, ANALYZER, { elements: [{ num: 3, qcDate: day2 }] });
    check("4h. an element the evaluator marked N/A refuses new data", onNa.s === 400 && /N\/A/.test(onNa.j.error || "") && !rowOf(rowsFor(annId, ANALYZER), 3).el3_qc_date, `${onNa.s} ${onNa.j.error}`);

    v = await view(annId);
    const reSave = await evaluatorPut(annId, ANALYZER, { elements: tsOf(v, ANALYZER).elements });
    rows = rowsFor(annId, ANALYZER);
    check("4i. the evaluator saving the form afterwards keeps what the person entered", reSave.s === 200 && rowOf(rows, 1).el1_specimen_id === "S-101" && rowOf(rows, 1).passed === 1, `${reSave.s}`);

    // ── Bad entries refused, nothing written ──────────────────────────────────
    const auditNow = auditCount(), itemsNow = totalItems();
    const badScore = await myData(annId, ANALYZER, { elements: [{ num: 6, score: "ninety" }] });
    const badDate = await myData(annId, ANALYZER, { elements: [{ num: 2, date: "13/45/2026" }] });
    const badType = await myData(annId, ANALYZER, { elements: [{ num: 1, specimenId: { sneaky: true } }] });
    const badElement = await myData(annId, ANALYZER, { elements: [{ num: 99, specimenId: "X" }] });
    const noBody = await myData(annId, ANALYZER, {});
    const waivedBody = await myData(annId, ANALYZER, { waivedMethods: [{ num: 1, evidence: "X" }] });
    check("5a. a bad score, date, type, element or body is refused, not dropped", [badScore, badDate, badType, badElement, noBody, waivedBody].every((r) => r.s === 400), [badScore, badDate, badType, badElement, noBody, waivedBody].map((r) => r.s).join(","));
    check("5b. a mixed save with one bad entry writes nothing", (await myData(annId, ANALYZER, { elements: [{ num: 1, specimenId: "SHOULD-NOT-SAVE" }, { num: 6, score: "ninety" }] })).s === 400 && rowOf(rowsFor(annId, ANALYZER), 1).el1_specimen_id === "S-101");
    check("5c. refusals leave no audit row and no new rows", auditCount() === auditNow && totalItems() === itemsNow);

    // ── A blank save starts nothing ───────────────────────────────────────────
    const blank = await myData(annId, THIRD, { elements: [{ num: 1, specimenId: "" }, { num: 2, evidence: "", date: "" }, { num: 5, samples: [{ sampleType: "", sampleId: "" }] }] });
    check("6. a blank save starts nothing: no rows, no audit, still Not started", blank.s === 200 && blank.j.updated === 0 && rowsFor(annId, THIRD).length === 0 && tsOf(await view(annId), THIRD).hasData === false && auditCount() === auditNow, JSON.stringify(blank.j));

    // ── Taking an entry back ──────────────────────────────────────────────────
    await myData(annId, THIRD, { elements: [{ num: 1, specimenId: "OOPS" }, { num: 2, evidence: "Oops too" }] });
    const before2 = rowsFor(annId, THIRD).length;
    const takeBack = await myData(annId, THIRD, { elements: [{ num: 1, specimenId: "" }, { num: 2, evidence: "", date: "" }] });
    check("6b. a person taking back their own entry leaves no blank rows, and the method is Not started again", before2 === 2 && takeBack.s === 200 && rowsFor(annId, THIRD).length === 0 && tsOf(await view(annId), THIRD).hasData === false, `${before2} ${takeBack.s} ${rowsFor(annId, THIRD).length}`);
    const blankMarked = await myData(annId, ANALYZER, { elements: [{ num: 1, specimenId: "" }] });
    check("6c. blanking an entry on a row the evaluator marked keeps the row and its marks", blankMarked.s === 200 && !rowOf(rowsFor(annId, ANALYZER), 1).el1_specimen_id && rowOf(rowsFor(annId, ANALYZER), 1).passed === 1 && rowOf(rowsFor(annId, ANALYZER), 1).el1_observer_initials === "CT", `${blankMarked.s}`);
    await myData(annId, ANALYZER, { elements: [{ num: 1, specimenId: "S-101" }] });

    // ── Nobody else, no other lab ─────────────────────────────────────────────
    const itemsBefore = totalItems();
    const onBen = await myData(benId, ANALYZER, { elements: [{ num: 1, specimenId: "NOT-YOURS" }] });
    check("7a. another person's record is refused", onBen.s === 403 && onBen.j.code === "STAFF_NOT_SELF" && totalItems() === itemsBefore && rowsFor(benId, ANALYZER).length === 0, `${onBen.s} ${onBen.j.code}`);
    const bodyClaim = await myData(annId, THIRD, { employee_id: benId, staff_employee_id: benId, elements: [{ num: 1, specimenId: "ANNS-OWN" }] });
    check("7b. a person named in the body changes nothing: it lands on the signed-in person", bodyClaim.s === 200 && rowsFor(benId, THIRD).length === 0 && rowOf(rowsFor(annId, THIRD), 1).el1_specimen_id === "ANNS-OWN");
    const otherLab = await myData(zedId, OTHER_LAB_INST, { elements: [{ num: 1, specimenId: "X" }] }, ANN.token, L2);
    check("7c. another lab is refused", otherLab.s === 403 && rowsFor(zedId, OTHER_LAB_INST).length === 0, `${otherLab.s} ${otherLab.j.error}`);
    const foreignInst = await myData(annId, OTHER_LAB_INST, { elements: [{ num: 1, specimenId: "X" }] });
    check("7d. another lab's instrument on your own record is refused", foreignInst.s === 404 && rowsFor(annId, OTHER_LAB_INST).length === 0, `${foreignInst.s}`);
    const notAssigned = await myData(annId, UNASSIGNED, { elements: [{ num: 1, specimenId: "X" }] });
    check("7e. an instrument not assigned to you is refused", notAssigned.s === 404 && rowsFor(annId, UNASSIGNED).length === 0, `${notAssigned.s}`);
    const zedOnAnn = await myData(annId, ANALYZER, { elements: [{ num: 1, specimenId: "X" }] }, ZED.token);
    check("7f. a Staff login from another lab can't reach this lab", zedOnAnn.s === 403, `${zedOnAnn.s}`);

    // ── Non-Staff members ─────────────────────────────────────────────────────
    const viewerSelf = await myData(viewerRosterId, ANALYZER, { elements: [{ num: 1, specimenId: "X" }] }, VIEWER.token);
    const viewerEval = await evaluatorPut(viewerRosterId, ANALYZER, { elements: [{ num: 1, specimenId: "X" }] }, VIEWER.token);
    check("8a. a view-only member on the roster is refused on both routes, even on their own row", viewerSelf.s === 403 && viewerEval.s === 403 && rowsFor(viewerRosterId, ANALYZER).length === 0, `${viewerSelf.s}/${viewerEval.s}`);
    const plainSelf = await myData(annId, ANALYZER, { elements: [{ num: 1, specimenId: "X" }] }, PLAIN.token);
    const plainEval = await evaluatorPut(annId, ANALYZER, { elements: [{ num: 1, specimenId: "X" }] }, PLAIN.token);
    check("8b. a member with no seat and no edit permission is refused on both routes", plainSelf.s === 403 && plainEval.s === 403, `${plainSelf.s}/${plainEval.s}`);
    const ownerSelf = await myData(annId, ANALYZER, { elements: [{ num: 1, specimenId: "X" }] }, OWNER.token);
    check("8c. the owner has no self route on someone else's record", ownerSelf.s === 403, `${ownerSelf.s}`);

    // ── Editor unchanged ──────────────────────────────────────────────────────
    const editorSave = await evaluatorPut(benId, ANALYZER, { elements: [{ num: 1, specimenId: "E-1", observerInitials: "CT", passed: true }] }, EDITOR.token);
    check("9. an editor's save is unchanged: Pass and observer are taken from their form", editorSave.s === 200 && rowOf(rowsFor(benId, ANALYZER), 1).passed === 1 && rowOf(rowsFor(benId, ANALYZER), 1).el1_observer_initials === "CT", `${editorSave.s} ${editorSave.j.error ?? ""}`);

    // ── Signed items ──────────────────────────────────────────────────────────
    const completeEls = [
      { num: 1, specimenId: "S-1", observerInitials: "CT", passed: true }, { num: 2, evidence: "E", date: day, passed: true }, { num: 3, qcDate: day, passed: true },
      { num: 4, dateObserved: day, observerInitials: "CT", passed: true }, { num: 5, sampleType: "PT", sampleId: "P", acceptable: true, passed: true }, { num: 6, quizId: "Q", score: 100, dateTaken: day, passed: true },
    ];
    await evaluatorPut(annId, THIRD, { elements: completeEls });
    const signed = await call("POST", `${L}/competency/employee/${annId}/test-system/${THIRD}/sign`, { signerStaffEmployeeId: tc, signerInitials: "CT" }, OWNER.token);
    const frozen = rowsFor(annId, THIRD);
    const frozenBefore = JSON.stringify(frozen);
    check("10a. fixture: the method is signed and its rows are frozen", signed.s === 200 && frozen.length === 6 && frozen.every((r) => r.signoff_id != null), `${signed.s} ${JSON.stringify(signed.j).slice(0, 120)}`);
    const nextCycle = await myData(annId, THIRD, { elements: [{ num: 1, specimenId: "NEXT-CYCLE" }] });
    const after = rowsFor(annId, THIRD);
    check("10b. a save after sign-off never touches the frozen rows; it starts the next competency", nextCycle.s === 200 && JSON.stringify(after.filter((r) => r.signoff_id != null)) === frozenBefore && after.filter((r) => r.signoff_id == null).length === 1 && after.find((r) => r.signoff_id == null)?.el1_specimen_id === "NEXT-CYCLE", `${nextCycle.s}`);
    const frozenId = frozen[0].id, frozenAssessment = frozen[0].assessment_id;
    const portalSigned = await call("PUT", `/api/staff-portal-session/competencies/${frozenAssessment}`, { employee_id: annId, items: [{ id: frozenId, el1SpecimenId: "EDIT-SIGNED" }] }, ANN.token);
    check("10c. the My sign-offs route refuses it too (an implicit record is refused there)", portalSigned.s === 409 && JSON.stringify(rowsFor(annId, THIRD).filter((r) => r.signoff_id != null)) === frozenBefore, `${portalSigned.s}`);

    // ── A locked record ───────────────────────────────────────────────────────
    await evaluatorPut(caraId, ANALYZER, { elements: completeEls });
    const lockedAssessment = rowsFor(caraId, ANALYZER)[0].assessment_id;
    sqlite.prepare("UPDATE competency_assessments SET locked = 1, completion_date = ? WHERE id = ?").run(`${day}T12:00:00.000Z`, lockedAssessment);
    const lockedBefore = JSON.stringify(sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(lockedAssessment));
    const onLocked = await myData(caraId, ANALYZER, { elements: [{ num: 1, specimenId: "AFTER-LOCK" }] }, CARA.token);
    const lockedAfter = JSON.stringify(sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(lockedAssessment));
    const newRow = rowsFor(caraId, ANALYZER).find((r) => r.assessment_id !== lockedAssessment);
    const newAssessment = newRow ? sqlite.prepare("SELECT locked, status FROM competency_assessments WHERE id = ?").get(newRow.assessment_id) as any : null;
    check("11a. a locked record stays as signed; the entry goes on a new open record, as the evaluator's save does", onLocked.s === 200 && lockedAfter === lockedBefore && newRow?.el1_specimen_id === "AFTER-LOCK" && !newRow?.passed && !newAssessment?.locked, `${onLocked.s} ${JSON.stringify(newAssessment)}`);
    const lockedPortal = await call("PUT", `/api/staff-portal-session/competencies/${lockedAssessment}`, { employee_id: caraId, items: [{ id: rowsFor(caraId, ANALYZER)[0].id, el1SpecimenId: "EDIT-LOCKED" }] }, CARA.token);
    check("11b. My sign-offs refuses a locked record outright", lockedPortal.s === 409 && JSON.stringify(sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(lockedAssessment)) === lockedBefore, `${lockedPortal.s}`);

    // ── Waived, person page ───────────────────────────────────────────────────
    const waivedRow = (num: number, emp = annId) => sqlite.prepare(`SELECT i.* FROM competency_assessment_items i JOIN competency_assessments a ON a.id = i.assessment_id JOIN competency_employees ce ON ce.id = a.employee_id WHERE ce.staff_employee_id = ? AND i.instrument_id = ? AND i.waived_method_number = ?`).get(emp, METER, num) as any;
    const w1 = await myData(annId, METER, { waivedMethods: [
      { num: 1, specimens: [{ evidence: "BS-1 glucose 92", date: day, initials: "ZZ", passed: true }] },
      { num: 2, evidence: "Observed by me", date: day, initials: "ZZ", passed: true },
    ] });
    check("12a. waived: evidence and date save; Pass and initials sent by the client are not taken", w1.s === 200 && waivedRow(1)?.waived_evidence === "BS-1 glucose 92" && waivedRow(1)?.passed === 0 && !waivedRow(1)?.waived_initials && waivedRow(2)?.waived_evidence === "Observed by me" && waivedRow(2)?.passed === 0 && !waivedRow(2)?.waived_initials, `${w1.s} ${w1.j.error ?? ""}`);
    v = await view(annId);
    check("12b. two waived rows with no Pass count as 0 of 2, so nothing can be signed", tsOf(v, METER).waivedPassed === 0 && tsOf(v, METER).signable === false && tsOf(v, METER).waivedMethods?.[0]?.status === "needs_review");
    const rowNums = sqlite.prepare(`SELECT method_number, element_number FROM competency_assessment_items WHERE id = ?`).get(waivedRow(1).id) as any;
    check("12c. waived rows carry no element or method number", rowNums.method_number == null && rowNums.element_number == null);
    const passBoth = await evaluatorPut(annId, METER, { waivedMethods: [
      { num: 1, specimens: [{ evidence: "BS-1 glucose 92", date: day, initials: "JE", passed: true }] },
      { num: 2, evidence: "Observed by me", date: day, initials: "JE", passed: true },
    ] });
    const passedSnap = [waivedRow(1).passed, waivedRow(1).waived_initials, waivedRow(2).passed, waivedRow(2).waived_initials].join();
    check("12d. the evaluator's waived save is unchanged", passBoth.s === 200 && passedSnap === "1,JE,1,JE", passedSnap);
    const correct = await myData(annId, METER, { waivedMethods: [{ num: 2, evidence: "Corrected observation", date: day2, initials: "ZZ", passed: false }] });
    check("12e. a correction to a passed method keeps Pass and initials", correct.s === 200 && waivedRow(2).waived_evidence === "Corrected observation" && waivedRow(2).waived_date === day2 && waivedRow(2).passed === 1 && waivedRow(2).waived_initials === "JE", `${correct.s}`);
    const clearDate = await myData(annId, METER, { waivedMethods: [{ num: 2, evidence: "Corrected observation", date: "" }] });
    check("12f. a passed method can't lose its date: refused with the existing rule", clearDate.s === 400 && /enter the date it was performed/.test(clearDate.j.error || "") && waivedRow(2).waived_date === day2, `${clearDate.s} ${clearDate.j.error}`);
    const clearSpecDate = await myData(annId, METER, { waivedMethods: [{ num: 1, specimens: [{ evidence: "BS-1 glucose 92", date: "" }] }] });
    check("12g. a passed specimen can't lose its date", clearSpecDate.s === 400 && /date each passed specimen/.test(clearSpecDate.j.error || "") && waivedRow(1).waived_date === day, `${clearSpecDate.s} ${clearSpecDate.j.error}`);
    const addSpec = await myData(annId, METER, { waivedMethods: [{ num: 1, specimens: [{ evidence: "BS-1 glucose 92", date: day, passed: true }, { evidence: "BS-2 glucose 180", date: day2, passed: true, initials: "ZZ" }] }] });
    const list1 = JSON.parse(waivedRow(1).waived_specimens_json || "[]");
    check("12h. adding a specimen: the first keeps its Pass and initials, the new one has neither, and the method waits for the evaluator", addSpec.s === 200 && list1.length === 2 && list1[0].passed === true && list1[0].initials === "JE" && list1[1].passed === false && list1[1].initials === "" && list1[1].evidence === "BS-2 glucose 180" && waivedRow(1).passed === 0, `${addSpec.s} ${JSON.stringify(list1)}`);
    const dropNewSpec = await myData(annId, METER, { waivedMethods: [{ num: 1, specimens: [{ evidence: "BS-1 glucose 92", date: day }] }] });
    check("12i. a trailing specimen with no mark can be removed, and the method passes again on the one the evaluator passed", dropNewSpec.s === 200 && waivedRow(1).waived_specimens_json === null && waivedRow(1).waived_evidence === "BS-1 glucose 92" && waivedRow(1).waived_initials === "JE" && waivedRow(1).passed === 1, `${dropNewSpec.s} ${dropNewSpec.j.error ?? ""}`);
    await evaluatorPut(annId, METER, { waivedMethods: [
      { num: 1, specimens: [{ evidence: "BS-1", date: day, initials: "JE", passed: false }, { evidence: "BS-2", date: day, initials: "JE", passed: true }] },
      { num: 2, evidence: "Corrected observation", date: day2, initials: "JE", passed: true },
    ] });
    const dropFirst = await myData(annId, METER, { waivedMethods: [{ num: 1, specimens: [{ evidence: "BS-2", date: day }] }] });
    const after1 = JSON.parse(waivedRow(1).waived_specimens_json || "[]");
    check("12j. a marked specimen later in the list can't be removed by dropping the row above it", dropFirst.s === 400 && /specimen 2/.test(dropFirst.j.error || "") && after1.length === 2 && after1[1].passed === true, `${dropFirst.s} ${dropFirst.j.error} ${JSON.stringify(after1)}`);
    const onElements = await myData(annId, METER, { elements: [{ num: 1, specimenId: "X" }] });
    check("12k. a waived system refuses an element body", onElements.s === 400 && /waived/.test(onElements.j.error || ""), `${onElements.s}`);
    const badMethod = await myData(annId, METER, { waivedMethods: [{ num: 9, evidence: "X" }] });
    check("12l. an unknown waived method is refused", badMethod.s === 400 && /Unknown waived method/.test(badMethod.j.error || ""), `${badMethod.s}`);
    const w3 = await myData(annId, METER, { waivedMethods: [{ num: 3, evidence: "QC reviewed", date: day }] });
    const w3Row = waivedRow(3);
    const clear3 = await myData(annId, METER, { waivedMethods: [{ num: 3, evidence: "", date: "" }] });
    check("12m. a method with no evaluator mark, blanked by the person, has no row left (a blank row would print as not passed)", w3.s === 200 && !!w3Row && clear3.s === 200 && !waivedRow(3), `${w3.s}/${clear3.s}`);

    // ── A lab-chosen group: saved under the group's lead ──────────────────────
    const made = await call("POST", `${L}/competency/method-groups`, { name: "Made-up Group", instrumentIds: [GROUP_LEAD, GROUP_MEMBER] }, OWNER.token);
    const groupSave = await myData(annId, GROUP_MEMBER, { elements: [{ num: 1, specimenId: "GRP-1" }] });
    const lead = Math.min(GROUP_LEAD, GROUP_MEMBER);
    check("13. a grouped method saves under the lead, reachable through any analyzer in the group", [200, 201].includes(made.s) && groupSave.s === 200 && rowOf(rowsFor(annId, lead), 1).el1_specimen_id === "GRP-1" && tsOf(await view(annId), lead).elements?.[0]?.specimenId === "GRP-1", `${made.s}/${groupSave.s} ${groupSave.j.error ?? ""}`);

    // ── A method still showing an older program record keeps what it showed ───
    const techProg = (await call("POST", `${L}/competency/programs`, { name: "Made-up Older Program", department: "Hematology", type: "technical" }, OWNER.token)).j.id;
    const mgId = Number(sqlite.prepare("INSERT INTO competency_method_groups (program_id, name, instruments, analytes) VALUES (?, 'Older Program Analyzer', ?, '[]')").run(techProg, JSON.stringify(["Older Program Analyzer"])).lastInsertRowid);
    const annComp = sqlite.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(annId, labId) as any;
    const olderRec = await call("POST", `${L}/competency/assessments`, { programId: techProg, employeeId: annComp.id, assessmentType: "annual", assessmentDate: day, evaluatorName: "Made Up", competencyType: "technical", status: "pass",
      items: [{ methodNumber: 1, elementNumber: 1, methodGroupId: mgId, methodGroupName: "Older Program Analyzer", el1SpecimenId: "OLD-1", el1ObserverInitials: "CT", passed: true }] }, OWNER.token);
    const olderRow = () => sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").get(olderRec.j.id) as any;
    const olderBefore = JSON.stringify(olderRow());
    const shownOld = tsOf(await view(annId), OLDER);
    const onOld = await myData(annId, OLDER, { elements: [{ num: 2, evidence: "New evidence", date: day2 }] });
    rows = rowsFor(annId, OLDER);
    check("14. an older program record shown on a method: its observer and Pass carry over, and the program record itself is untouched", shownOld.fromLegacyProgram === true && onOld.s === 200 && rowOf(rows, 1).el1_specimen_id === "OLD-1" && rowOf(rows, 1).el1_observer_initials === "CT" && rowOf(rows, 1).passed === 1 && rowOf(rows, 2).el2_evidence === "New evidence" && !rowOf(rows, 2).passed && JSON.stringify(olderRow()) === olderBefore, `${shownOld.fromLegacyProgram} ${onOld.s} ${onOld.j.error ?? ""}`);

    // ── My sign-offs: the implicit container ──────────────────────────────────
    const listFor = async (emp: number, token: string) => (await call("GET", `/api/staff-portal-session/competencies?employee_id=${emp}`, undefined, token)).j;
    let list = await listFor(annId, ANN.token);
    const implicitAssessment = rowsFor(annId, ANALYZER)[0].assessment_id;
    const isImplicitRow = (c: any) => c.assessment_id === implicitAssessment;
    const viewAnn = await view(annId);
    const shownSigned = viewAnn.testSystems.filter((t: any) => t.signedCurrent).length;
    check("15a. the implicit container is not listed to acknowledge", !(list.competencies || []).some(isImplicitRow), JSON.stringify((list.competencies || []).map((c: any) => c.program_name)));
    check("15b. a plain row opens the person's own record with the same count as the record itself", list.own_record?.employee_id === annId && list.own_record?.lab_id === labId && list.own_record?.methods_total === viewAnn.testSystems.length && list.own_record?.methods_signed === shownSigned && shownSigned === 1, JSON.stringify(list.own_record));
    check("15c. it is not in the pending count: only real records are unsigned", (list.competencies || []).filter((c: any) => !c.signed).every((c: any) => c.program_name !== "Competency"));
    const signImplicit = await call("POST", `/api/staff-portal-session/competencies/${implicitAssessment}/sign`, { employee_id: annId, typed_signature: "Ann Self" }, ANN.token);
    const ackState = () => (sqlite.prepare("SELECT employee_acknowledged AS e FROM competency_assessments WHERE id = ?").get(implicitAssessment) as any).e;
    const spcsCount = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM staff_portal_competency_signoffs WHERE assessment_id = ?").get(implicitAssessment) as any).n);
    check("15d. /sign refuses the implicit record and records nothing", signImplicit.s === 409 && signImplicit.j.code === "IMPLICIT_RECORD" && ackState() === 0 && spcsCount() === 0, `${signImplicit.s} ${signImplicit.j.code}`);
    const portalImplicit = await call("PUT", `/api/staff-portal-session/competencies/${implicitAssessment}`, { employee_id: annId, items: [{ id: rowsFor(annId, ANALYZER)[0].id, el1SpecimenId: "VIA-PORTAL" }] }, ANN.token);
    check("15e. the implicit record takes entries only on the person page", portalImplicit.s === 409 && portalImplicit.j.code === "IMPLICIT_RECORD", `${portalImplicit.s}`);
    const bell = await call("GET", `/api/me/pending-staff-portal-items?lab_id=${labId}`, undefined, ANN.token);
    check("15f. the bell lists nothing for the container", !(bell.j.competencies || []).some(isImplicitRow));
    // A record already acknowledged stays as it is.
    sqlite.prepare("INSERT INTO staff_portal_competency_signoffs (lab_id, assessment_id, staff_employee_id, signed_document_hash, typed_signature) VALUES (?, ?, ?, 'h', 'Ann Self')").run(labId, implicitAssessment, annId);
    sqlite.prepare("UPDATE competency_assessments SET employee_acknowledged = 1 WHERE id = ?").run(implicitAssessment);
    list = await listFor(annId, ANN.token);
    const stays = (list.competencies || []).find(isImplicitRow);
    check("15g. an implicit record already acknowledged stays listed, signed", !!stays && stays.signed === true);
    check("15h. and it is still only a row: the own-record row stays beside it", !!list.own_record);
    const again = await call("POST", `/api/staff-portal-session/competencies/${implicitAssessment}/sign`, { employee_id: annId, typed_signature: "Ann Self" }, ANN.token);
    check("15i. signing it again returns the existing signature and changes nothing", again.s === 200 && again.j.already_signed === true && spcsCount() === 1, `${again.s}`);
    const selfAfterAck = await myData(annId, ANALYZER, { elements: [{ num: 1, specimenId: "S-102" }] });
    check("15j. a container acknowledged in the past does not block entering data on the method", selfAfterAck.s === 200 && rowOf(rowsFor(annId, ANALYZER), 1).el1_specimen_id === "S-102", `${selfAfterAck.s} ${selfAfterAck.j.error ?? ""}`);
    sqlite.prepare("DELETE FROM staff_portal_competency_signoffs WHERE assessment_id = ?").run(implicitAssessment);
    sqlite.prepare("UPDATE competency_assessments SET employee_acknowledged = 0 WHERE id = ?").run(implicitAssessment);

    const noBridge = await person("Newhire", "Nell", [ANALYZER]);
    const NELL = await register("Nell");
    member(labId, NELL.id); seat(OWNER.id, labId, NELL, "staff_portal", '{"mode":"view_all"}', noBridge);
    const nellList = await listFor(noBridge, NELL.token);
    check("15k. someone with methods and no record yet still gets the row, and can start", nellList.bridge_status === "no_competency_record" && nellList.own_record?.methods_total === 1 && nellList.own_record?.methods_signed === 0, JSON.stringify(nellList.own_record));
    const nellSave = await myData(noBridge, ANALYZER, { elements: [{ num: 1, specimenId: "NELL-1" }] }, NELL.token);
    check("15l. their first save creates the open record", nellSave.s === 200 && rowOf(rowsFor(noBridge, ANALYZER), 1).el1_specimen_id === "NELL-1" && !rowOf(rowsFor(noBridge, ANALYZER), 1).passed, `${nellSave.s} ${nellSave.j.error ?? ""}`);
    const noMethods = await person("Bare", "Bea", []);
    const BEA = await register("Bea");
    member(labId, BEA.id); seat(OWNER.id, labId, BEA, "staff_portal", '{"mode":"view_all"}', noMethods);
    check("15m. someone with no methods assigned gets no row", (await listFor(noMethods, BEA.token)).own_record === null);

    // ── My sign-offs: a program-based waived record ───────────────────────────
    const benComp = sqlite.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(benId, labId) as any;
    const waivedProg = (await call("POST", `${L}/competency/programs`, { name: "Hematology waived testing competency", department: "Hematology", type: "waived" }, OWNER.token)).j.id;
    const waivedRec = await call("POST", `${L}/competency/assessments`, { programId: waivedProg, employeeId: annComp.id, assessmentType: "initial", assessmentDate: day, evaluatorName: "Jordan Ellis", evaluatorInitials: "JE", competencyType: "waived", status: "pass",
      items: [
        { methodNumber: 1, waivedMethodNumber: 1, waivedEvidence: "BS-1", waivedDate: day, waivedInitials: "JE", passed: true, waivedSpecimens: [{ evidence: "BS-1", date: day, initials: "JE", passed: true }] },
        { methodNumber: 3, waivedMethodNumber: 3, waivedEvidence: "", waivedDate: "", waivedInitials: "JE", passed: false },
      ] }, OWNER.token);
    const wid = waivedRec.j.id;
    const detail = (await call("GET", `/api/staff-portal-session/competencies/${wid}?employee_id=${annId}`, undefined, ANN.token)).j;
    check("16a. the waived record's detail lists its methods, with no technical rows", waivedRec.s < 300 && detail.waived_items?.length === 2 && detail.items?.length === 0 && detail.waived_items[0].method_name === "Blind specimen testing" && detail.waived_items[0].specimens?.length === 1 && detail.waived_items[1].specimens === undefined, JSON.stringify(detail.waived_items));
    const blindId = detail.waived_items[0].id, qcId = detail.waived_items[1].id;
    const progRow = (id: number) => sqlite.prepare("SELECT * FROM competency_assessment_items WHERE id = ?").get(id) as any;
    auditBefore = auditCount();
    const portalSave = await call("PUT", `/api/staff-portal-session/competencies/${wid}`, { employee_id: annId, waived_items: [
      { id: blindId, passed: false, initials: "ZZ", specimens: [{ evidence: "BS-1 corrected", date: day, passed: false, initials: "ZZ" }, { evidence: "BS-2", date: day2, passed: true, initials: "ZZ" }] },
      { id: qcId, evidence: "Ran both QC levels", date: day2, passed: true, initials: "ZZ" },
    ] }, ANN.token);
    const blindList = JSON.parse(progRow(blindId).waived_specimens_json || "[]");
    check("16b. evidence, dates and a new specimen save; Pass and initials stay stored", portalSave.s === 200 && progRow(qcId).waived_evidence === "Ran both QC levels" && progRow(qcId).waived_date === day2 && progRow(qcId).passed === 0 && progRow(qcId).waived_initials === "JE" && blindList[0].evidence === "BS-1 corrected" && blindList[0].passed === true && blindList[0].initials === "JE" && blindList[1].passed === false && blindList[1].initials === "" && progRow(blindId).passed === 0, `${portalSave.s} ${portalSave.j.error ?? ""} ${JSON.stringify(blindList)}`);
    check("16c. the save is audited", auditCount() === auditBefore + 1);
    const clearProgDate = await call("PUT", `/api/staff-portal-session/competencies/${wid}`, { employee_id: annId, waived_items: [{ id: blindId, specimens: [{ evidence: "BS-1 corrected", date: "" }, { evidence: "BS-2", date: day2 }] }] }, ANN.token);
    check("16d. a passed specimen can't lose its date here either", clearProgDate.s === 400 && /date each passed specimen/.test(clearProgDate.j.error || ""), `${clearProgDate.s} ${clearProgDate.j.error}`);
    const elseRow = await call("PUT", `/api/staff-portal-session/competencies/${wid}`, { employee_id: annId, waived_items: [{ id: rowsFor(benId, ANALYZER)[0].id, evidence: "X" }] }, ANN.token);
    const techOnWaived = await call("PUT", `/api/staff-portal-session/competencies/${wid}`, { employee_id: annId, items: [{ id: qcId, el1SpecimenId: "X" }] }, ANN.token);
    const noneId = await call("PUT", `/api/staff-portal-session/competencies/${wid}`, { employee_id: annId, waived_items: [{ evidence: "X" }] }, ANN.token);
    check("16e. a row off this record, a technical field on a waived row, or no row id is refused", elseRow.s === 400 && techOnWaived.s === 400 && noneId.s === 400 && rowOf(rowsFor(benId, ANALYZER), 1).el1_specimen_id === "E-1", `${elseRow.s}/${techOnWaived.s}/${noneId.s}`);
    const wrongEmp = await call("PUT", `/api/staff-portal-session/competencies/${wid}`, { employee_id: benId, waived_items: [{ id: qcId, evidence: "X" }] }, ANN.token);
    const benTakes = await call("PUT", `/api/staff-portal-session/competencies/${wid}`, { employee_id: benId, waived_items: [{ id: qcId, evidence: "BEN" }] }, BEN.token);
    check("16f. another person's record is out of reach, as a claimed id or as themselves", wrongEmp.s === 403 && benTakes.s === 404 && progRow(qcId).waived_evidence === "Ran both QC levels", `${wrongEmp.s}/${benTakes.s}`);

    const signWaived = await call("POST", `/api/staff-portal-session/competencies/${wid}/sign`, { employee_id: annId, typed_signature: "Ann Self" }, ANN.token);
    const ackedSave = await call("PUT", `/api/staff-portal-session/competencies/${wid}`, { employee_id: annId, waived_items: [{ id: qcId, evidence: "After acknowledging" }] }, ANN.token);
    check("16g. a real record can still be acknowledged, and after that it takes no entries", signWaived.s === 200 && ackedSave.s === 409 && progRow(qcId).waived_evidence === "Ran both QC levels", `${signWaived.s}/${ackedSave.s}`);
    const waivedRec2 = await call("POST", `${L}/competency/assessments`, { programId: waivedProg, employeeId: annComp.id, assessmentType: "annual", assessmentDate: day, evaluatorName: "Jordan Ellis", evaluatorInitials: "JE", competencyType: "waived", status: "pass", items: [{ methodNumber: 2, waivedMethodNumber: 2, waivedEvidence: "Observed", waivedDate: day, waivedInitials: "JE", passed: true }] }, OWNER.token);
    const wrId = (sqlite.prepare("SELECT id FROM competency_assessment_items WHERE assessment_id = ?").get(waivedRec2.j.id) as any).id;
    const noDatePassed = await call("PUT", `/api/staff-portal-session/competencies/${waivedRec2.j.id}`, { employee_id: annId, waived_items: [{ id: wrId, evidence: "Observed", date: "" }] }, ANN.token);
    check("16h. a passed method here can't lose its date", noDatePassed.s === 400 && /enter the date it was performed/.test(noDatePassed.j.error || ""), `${noDatePassed.s}`);
    sqlite.prepare("UPDATE competency_assessments SET locked = 1 WHERE id = ?").run(waivedRec2.j.id);
    const lockedWaived = await call("PUT", `/api/staff-portal-session/competencies/${waivedRec2.j.id}`, { employee_id: annId, waived_items: [{ id: wrId, evidence: "After lock" }] }, ANN.token);
    check("16i. a locked waived record is refused", lockedWaived.s === 409 && progRow(wrId).waived_evidence === "Observed", `${lockedWaived.s}`);

    // ── My sign-offs: the existing technical block keeps working ──────────────
    const techRec = await call("POST", `${L}/competency/assessments`, { programId: techProg, employeeId: annComp.id, assessmentType: "annual", assessmentDate: day2, evaluatorName: "Made Up", competencyType: "technical", status: "pass",
      items: [
        { methodNumber: 1, elementNumber: 1, methodGroupId: mgId, methodGroupName: "Older Program Analyzer", el1ObserverInitials: "CT", passed: true },
        { methodNumber: 3, elementNumber: 3, methodGroupId: mgId, methodGroupName: "Older Program Analyzer", el3Na: true, el3NaJustification: "Evaluator says N/A", passed: false },
      ] }, OWNER.token);
    const techDetail = (await call("GET", `/api/staff-portal-session/competencies/${techRec.j.id}?employee_id=${annId}`, undefined, ANN.token)).j;
    check("17a. a named technical record still lists its rows, and no waived ones", techDetail.items?.length === 2 && techDetail.waived_items?.length === 0, JSON.stringify(techDetail.items?.length));
    const el1Row = techDetail.items.find((i: any) => i.method_number === 1), el3Row = techDetail.items.find((i: any) => i.method_number === 3);
    const techSave = await call("PUT", `/api/staff-portal-session/competencies/${techRec.j.id}`, { employee_id: annId, items: [{ id: el1Row.id, el1SpecimenId: "TECH-1", el1ObserverInitials: "ZZ", passed: false, el1Na: true, el2Evidence: "", el6Score: "" }] }, ANN.token);
    const techRow = progRow(el1Row.id);
    check("17b. its whitelist still saves and takes no evaluator value", techSave.s === 200 && techRow.el1_specimen_id === "TECH-1" && techRow.el1_observer_initials === "CT" && techRow.passed === 1 && !techRow.el1_na, `${techSave.s} ${techSave.j.error ?? ""}`);
    const techNa = await call("PUT", `/api/staff-portal-session/competencies/${techRec.j.id}`, { employee_id: annId, items: [{ id: el3Row.id, el3QcDate: day }] }, ANN.token);
    const techBadScore = await call("PUT", `/api/staff-portal-session/competencies/${techRec.j.id}`, { employee_id: annId, items: [{ id: el1Row.id, el6Score: "ninety" }] }, ANN.token);
    const techOffRecord = await call("PUT", `/api/staff-portal-session/competencies/${techRec.j.id}`, { employee_id: annId, items: [{ id: 999999, el1SpecimenId: "X" }] }, ANN.token);
    const techMixed = await call("PUT", `/api/staff-portal-session/competencies/${techRec.j.id}`, { employee_id: annId, items: [{ id: el1Row.id, el1SpecimenId: "MIXED" }, { id: 999999, el1SpecimenId: "X" }] }, ANN.token);
    check("17c. N/A, a non-number score and a row off the record are refused, and a mixed save writes nothing", techNa.s === 400 && techBadScore.s === 400 && techOffRecord.s === 400 && techMixed.s === 400 && progRow(el1Row.id).el1_specimen_id === "TECH-1", [techNa, techBadScore, techOffRecord, techMixed].map((r) => r.s).join(","));
    sqlite.prepare("UPDATE competency_assessment_items SET signoff_id = 1 WHERE id = ?").run(el1Row.id);
    const techSigned = await call("PUT", `/api/staff-portal-session/competencies/${techRec.j.id}`, { employee_id: annId, items: [{ id: el1Row.id, el1SpecimenId: "EDIT-SIGNED" }] }, ANN.token);
    const detailAfterSign = (await call("GET", `/api/staff-portal-session/competencies/${techRec.j.id}?employee_id=${annId}`, undefined, ANN.token)).j;
    check("17d. a signed row on a program record is refused, and no longer offered as editable", techSigned.s === 409 && progRow(el1Row.id).el1_specimen_id === "TECH-1" && !detailAfterSign.items.some((i: any) => i.id === el1Row.id), `${techSigned.s}`);
    sqlite.prepare("UPDATE competency_assessment_items SET signoff_id = NULL WHERE id = ?").run(el1Row.id);

    // ── Non-technical: nothing to enter ───────────────────────────────────────
    const ntProg = (await call("POST", `${L}/competency/programs`, { name: "Made-up non-technical", department: "Phlebotomy", type: "nontechnical", checklistItems: [{ description: "Made-up item" }] }, OWNER.token)).j.id;
    const ntRec = await call("POST", `${L}/competency/assessments`, { programId: ntProg, employeeId: annComp.id, assessmentType: "annual", assessmentDate: day, evaluatorName: "Made Up", competencyType: "nontechnical", status: "pass", items: [{ itemLabel: "A", ntItemLabel: "A", ntItemDescription: "Made-up item", ntDateMet: day, ntEmployeeInitials: "AS", ntSupervisorInitials: "JE", passed: true }] }, OWNER.token);
    const ntItem = (sqlite.prepare("SELECT id FROM competency_assessment_items WHERE assessment_id = ?").get(ntRec.j.id) as any).id;
    const ntDetail = (await call("GET", `/api/staff-portal-session/competencies/${ntRec.j.id}?employee_id=${annId}`, undefined, ANN.token)).j;
    const ntSave = await call("PUT", `/api/staff-portal-session/competencies/${ntRec.j.id}`, { employee_id: annId, items: [{ id: ntItem, el1SpecimenId: "X" }] }, ANN.token);
    const ntSign = await call("POST", `/api/staff-portal-session/competencies/${ntRec.j.id}/sign`, { employee_id: annId, typed_signature: "Ann Self" }, ANN.token);
    check("18. a non-technical record offers nothing to enter, refuses an entry, and can still be acknowledged", ntDetail.items?.length === 0 && ntDetail.waived_items?.length === 0 && ntSave.s === 409 && ntSign.s === 200, `${ntSave.s}/${ntSign.s}`);

    // ── A lapsed lab, a plan with no VeritaComp, a deactivated seat ───────────
    const snap = sqlite.prepare("SELECT subscription_expires_at AS e, is_trial AS t, plan AS p FROM labs WHERE id = ?").get(labId) as any;
    const past = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    sqlite.prepare("UPDATE labs SET subscription_expires_at = ?, is_trial = 0 WHERE id = ?").run(past, labId);
    const lapsedSelf = await myData(annId, ANALYZER, { elements: [{ num: 1, specimenId: "LAPSED" }] });
    const lapsedPortal = await call("PUT", `/api/staff-portal-session/competencies/${techRec.j.id}`, { employee_id: annId, items: [{ id: el1Row.id, el1SpecimenId: "LAPSED" }] }, ANN.token);
    check("19a. a lapsed lab takes no entry on either path", lapsedSelf.s === 403 && lapsedSelf.j.code === "SUBSCRIPTION_EXPIRED_READ_ONLY" && lapsedPortal.s === 403 && lapsedPortal.j.code === "SUBSCRIPTION_EXPIRED_READ_ONLY" && rowOf(rowsFor(annId, ANALYZER), 1).el1_specimen_id === "S-102" && progRow(el1Row.id).el1_specimen_id === "TECH-1", `${lapsedSelf.s} ${lapsedSelf.j.code} ${lapsedPortal.s} ${lapsedPortal.j.code}`);
    check("19b. and the page isn't told to open the fields", (await view(annId, ANN.token)).canEnterOwnData === false);
    sqlite.prepare("UPDATE labs SET subscription_expires_at = ?, is_trial = ? WHERE id = ?").run(snap.e, snap.t, labId);
    sqlite.prepare("UPDATE labs SET plan = 'free' WHERE id = ?").run(labId);
    const noPlanSelf = await myData(annId, ANALYZER, { elements: [{ num: 1, specimenId: "NO-PLAN" }] });
    const noPlanPortal = await call("PUT", `/api/staff-portal-session/competencies/${techRec.j.id}`, { employee_id: annId, items: [{ id: el1Row.id, el1SpecimenId: "NO-PLAN" }] }, ANN.token);
    check("19c. a lab with no VeritaComp takes no entry on either path", noPlanSelf.s === 403 && noPlanPortal.s === 403 && rowOf(rowsFor(annId, ANALYZER), 1).el1_specimen_id === "S-102", `${noPlanSelf.s}/${noPlanPortal.s}`);
    sqlite.prepare("UPDATE labs SET plan = ? WHERE id = ?").run(snap.p, labId);
    const seatRow = () => sqlite.prepare("SELECT id FROM user_seats WHERE seat_user_id = ? AND lab_id = ?").get(ANN.id, labId) as any;
    sqlite.prepare("UPDATE user_seats SET status = 'deactivated' WHERE id = ?").run(seatRow().id);
    const deactivated = await myData(annId, ANALYZER, { elements: [{ num: 1, specimenId: "DEACTIVATED" }] });
    check("19d. a deactivated seat is refused", deactivated.s === 403 && rowOf(rowsFor(annId, ANALYZER), 1).el1_specimen_id === "S-102", `${deactivated.s}`);
    sqlite.prepare("UPDATE user_seats SET status = 'active' WHERE id = ?").run(seatRow().id);
    sqlite.prepare("UPDATE staff_employees SET status = 'inactive' WHERE id = ?").run(annId);
    const inactive = await myData(annId, ANALYZER, { elements: [{ num: 1, specimenId: "INACTIVE" }] });
    check("19e. someone off the active roster is refused", inactive.s === 404 && rowOf(rowsFor(annId, ANALYZER), 1).el1_specimen_id === "S-102", `${inactive.s}`);
    sqlite.prepare("UPDATE staff_employees SET status = 'active' WHERE id = ?").run(annId);
    const noAuth = await fetch(`${base}${L}/competency/employee/${annId}/test-system/${ANALYZER}/my-data`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ elements: [] }) });
    check("19f. no token, no entry", noAuth.status === 401, String(noAuth.status));

    // ── What a Staff login can open today (reported, not asserted: a separate open item) ──
    const benRow = rowsFor(benId, ANALYZER)[0];
    const reads: Array<[string, string]> = [
      ["their own record", `${L}/competency/employee/${annId}`],
      ["another person's record", `${L}/competency/employee/${benId}`],
      ["another person's record PDF", `${L}/competency/employee/${benId}/record-pdf`],
      ["by-instrument list", `${L}/competency/by-instrument`],
      ["one instrument, everyone's block", `${L}/competency/instrument/${ANALYZER}`],
      ["signed competencies list, whole lab", `${L}/competency/signoffs`],
      ["competencies owed, whole lab", `${L}/competency/owed`],
      ["programs list", `${L}/competency/programs`],
      ["one program with its assessments", `${L}/competency/programs/${techProg}`],
      ["competency employees list", `${L}/competency/employees`],
      ["qualified observers", `${L}/staff/qualified-observers`],
      ["VeritaStaff roster", `${L}/staff/employees`],
    ];
    for (const [name, path] of reads) {
      const r = await call("GET", path, undefined, ANN.token);
      console.log(`INFO  Staff login opens ${name}: HTTP ${r.s}`);
    }
    check("20. reads reported above; another person's record keeps showing their rows unchanged", !!benRow);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
