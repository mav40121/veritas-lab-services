// tests/integration/staff-own-competency-data.test.ts
//
// Michael 2026-11-05 (Cathy Thornton, RFGH): "staff are being blocked from entering their own competency information."
// His 2026-09-27 rule: an employee adds the factual DATA on their OWN unsigned record; the observer, the verdict, N/A
// determinations and the evaluator stay the evaluator's. Boots the REAL routes on a scratch DB with made-up people and proves:
//   the person page's PUT .../my-data saves a Staff login's own data, ignores evaluator-owned values, and reaches nobody
//   else, no other lab, no signed item and no locked record; the evaluator's route is unchanged; waived entry works on both
//   paths; the implicit container is not asked to be acknowledged; a lapsed lab and a non-Staff member are refused; bad
//   entries are refused; every save is audited.
// Michael 2026-11-05, Q182 = 1: a Staff login reads only their own competency data, in every lab; owners, editors and every other seat
// type are unchanged. Sections 21 to 41 check each read as Staff (own and someone else's) and as an editor, every other door to the same
// data, a sweep of every GET route, fail-closed seats, seats in two labs, and what a Staff login must keep.
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
  const call = async (method: string, path: string, body: unknown, token: string, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
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
    ).run(ownerId, u.email, u.id, now, now, perms, `sod-${u.id}-${lab}-${type}-${stamp}`, lab, type, rosterId);
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
    const benAsAnn = await call("GET", `${L}/competency/employee/${benId}`, undefined, ANN.token);
    check("1b. a Staff login is refused someone else's record, and nothing tells the page to open fields", benAsAnn.s === 403 && benAsAnn.j.code === "STAFF_OWN_ONLY" && benAsAnn.j.canEnterOwnData === undefined, `${benAsAnn.s}`);
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

    // ── Michael Q182 = 1: a Staff login reads only their own competency data ───
    const { staffOwnScope } = await import("../../server/competencySelfEntry");
    const zorkId = await person("Quillfeather", "Zork", [ANALYZER, METER]);
    await evaluatorPut(zorkId, ANALYZER, { elements: completeEls.map((e) => (e.num === 1 ? { ...e, specimenId: "ZQ-SPECIMEN-1" } : e)) });
    const zorkSigned = await call("POST", `${L}/competency/employee/${zorkId}/test-system/${ANALYZER}/sign`, { signerStaffEmployeeId: tc, signerInitials: "CT" }, OWNER.token);
    await evaluatorPut(zorkId, ANALYZER, { elements: [{ num: 1, specimenId: "ZQ-SPECIMEN-2", observerInitials: "CT", passed: true }] });
    const zorkComp = sqlite.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(zorkId, labId) as any;
    const zorkRec = await call("POST", `${L}/competency/assessments`, { programId: techProg, employeeId: zorkComp.id, assessmentType: "annual", assessmentDate: day, evaluatorName: "Made Up", competencyType: "technical", status: "fail", remediationPlan: "ZQ-REMEDIATION",
      items: [{ methodNumber: 1, elementNumber: 1, methodGroupId: mgId, methodGroupName: "Older Program Analyzer", el1SpecimenId: "ZQ-SPECIMEN-3", el1ObserverInitials: "CT", passed: true }] }, OWNER.token);
    const zRec = zorkRec.j.id;
    const notOnAnnsRecord = Number((await call("POST", `${L}/staff/employees`, { lastName: "Vance", firstName: "Nora", highestComplexity: "H", roles: [{ role: "TS", specialtyNumber: 8 }] }, OWNER.token)).j.id);
    sqlite.prepare("INSERT INTO staff_duty_change_events (lab_id, employee_id, instrument_id, detected_at) VALUES (?, ?, ?, ?)").run(labId, zorkId, METER, now);
    const dueSoon = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const rosterLab = (emp: number) => (sqlite.prepare("SELECT lab_id FROM staff_employees WHERE id = ?").get(emp) as any).lab_id;
    for (const emp of [zorkId, annId]) {
      if (!sqlite.prepare("SELECT 1 FROM staff_competency_schedules WHERE employee_id = ?").get(emp)) sqlite.prepare("INSERT INTO staff_competency_schedules (employee_id, lab_id) VALUES (?, ?)").run(emp, rosterLab(emp));
      sqlite.prepare("UPDATE staff_competency_schedules SET annual_due_at = ? WHERE employee_id = ?").run(dueSoon, emp);
    }
    const quiz = await call("POST", `/api/veritacomp/programs/${techProg}/quizzes`, { title: "Made-up quiz", questions: [{ id: "q1", question: "Which?", options: ["a", "b"], correct_answer: "a" }] }, OWNER.token);
    sqlite.prepare("UPDATE competency_quizzes SET lab_id = ? WHERE id = ?").run(labId, quiz.j.id);
    const assigned = await call("POST", `/api/veritacomp/quizzes/${quiz.j.id}/assignments`, { staff_employee_ids: [zorkId, annId] }, OWNER.token);
    check("21. fixture: a coworker with a signed method, entries, a program record, a due milestone and a quiz", zorkSigned.s === 200 && zorkRec.s === 200 && !!zRec && assigned.s === 200 && notOnAnnsRecord > 0, `${zorkSigned.s} ${zorkRec.s} ${assigned.s}`);

    const COWORKER = /Quillfeather|ZQ-[A-Z]+|\bBen\b/;
    const clean = (r: { j: any }) => !COWORKER.test(JSON.stringify(r.j));
    const asAnn = (path: string) => call("GET", path, undefined, ANN.token);
    const asEditor = (path: string) => call("GET", path, undefined, EDITOR.token);
    const refused = (r: { s: number; j: any }) => r.s === 403 && r.j.code === "STAFF_OWN_ONLY";

    // ── The eleven reads, as Staff (own and someone else's) and as an editor ──
    let own = await asAnn(`${L}/competency/employee/${annId}`);
    let other = await asAnn(`${L}/competency/employee/${zorkId}`);
    let ed = await asEditor(`${L}/competency/employee/${zorkId}`);
    check("22a. full record: their own opens, with who may sign taken out", own.s === 200 && own.j.employee?.id === annId && own.j.testSystems?.length > 0 && own.j.testSystems.every((t: any) => Array.isArray(t.signers) && t.signers.length === 0) && clean(own), `${own.s}`);
    check("22b. full record: another person's is refused", refused(other) && clean(other), `${other.s} ${other.j.code}`);
    check("22c. full record: an editor opens anyone's, with who may sign", ed.s === 200 && ed.j.employee?.id === zorkId && ed.j.testSystems?.some((t: any) => t.signers?.length > 0), `${ed.s}`);

    own = await asAnn(`${L}/competency/employee/${annId}/record-pdf`);
    other = await asAnn(`${L}/competency/employee/${zorkId}/record-pdf`);
    ed = await asEditor(`${L}/competency/employee/${zorkId}/record-pdf`);
    check("23. record PDF: their own works, another person's is refused, an editor's works", own.s === 200 && !!own.j.token && refused(other) && ed.s === 200 && !!ed.j.token, `${own.s}/${other.s}/${ed.s}`);

    own = await asAnn(`${L}/competency/by-instrument`);
    ed = await asEditor(`${L}/competency/by-instrument`);
    const byInst = (r: any, id: number) => (r.j.instruments || []).find((x: any) => x.instrumentId === id);
    check("24a. by instrument: only the methods assigned to them, each counted on them alone", own.s === 200 && own.j.instruments?.length > 0 && own.j.instruments.every((r: any) => r.people === 1) && !!byInst(own, ANALYZER) && !byInst(own, UNASSIGNED), JSON.stringify((own.j.instruments || []).map((r: any) => [r.instrumentName, r.people])));
    check("24b. by instrument: an editor sees every instrument and everyone's counts", ed.s === 200 && byInst(ed, ANALYZER)?.people >= 4 && !!byInst(ed, UNASSIGNED), `${byInst(ed, ANALYZER)?.people}`);

    own = await asAnn(`${L}/competency/instrument/${ANALYZER}`);
    other = await asAnn(`${L}/competency/instrument/${UNASSIGNED}`);
    ed = await asEditor(`${L}/competency/instrument/${ANALYZER}`);
    check("25a. one instrument: only their own block, with who may sign taken out", own.s === 200 && own.j.people?.length === 1 && own.j.people[0].employee.id === annId && own.j.people[0].testSystem.signers?.length === 0 && clean(own), `${own.s} ${own.j.people?.length}`);
    check("25b. one instrument they aren't assigned to is refused", refused(other), `${other.s}`);
    check("25c. one instrument: an editor sees everyone's block", ed.s === 200 && ed.j.people?.some((p: any) => p.employee.id === zorkId) && ed.j.people?.some((p: any) => p.employee.id === benId) && ed.j.people?.some((p: any) => p.testSystem.signers?.length > 0), `${ed.j.people?.length}`);

    own = await asAnn(`${L}/competency/signoffs`);
    ed = await asEditor(`${L}/competency/signoffs`);
    check("26. signed competencies: only their own; an editor sees the whole lab", own.s === 200 && own.j.signoffs?.length > 0 && own.j.signoffs.every((r: any) => r.employeeId === annId) && ed.s === 200 && ed.j.signoffs?.some((r: any) => r.employeeId === zorkId), `${own.j.signoffs?.length}/${ed.j.signoffs?.length}`);

    own = await asAnn(`${L}/competency/owed`);
    ed = await asEditor(`${L}/competency/owed`);
    check("27. competencies owed: only their own, and the totals count only them; an editor sees everyone", own.s === 200 && own.j.employees?.length === 1 && own.j.employees[0].employeeId === annId && own.j.totals?.employees === 1 && clean(own) && ed.j.employees?.some((e: any) => e.employeeId === zorkId) && ed.j.totals?.employees > 1, `${own.j.employees?.length}/${ed.j.employees?.length}`);

    own = await asAnn(`${L}/competency/programs`);
    ed = await asEditor(`${L}/competency/programs`);
    const staffProgKeys = "department,id,myAssessmentCount,name,record_kind,type";
    const techProgRow = (own.j as any[]).find?.((p: any) => p.id === techProg);
    const ownInTech = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM competency_assessments WHERE program_id = ? AND employee_id = ?").get(techProg, annComp.id) as any).n);
    check("28a. programs list: names and their own count, with nothing about anyone else", own.s === 200 && techProgRow?.name === "Made-up Older Program" && techProgRow?.myAssessmentCount === ownInTech && ownInTech > 0 && (own.j as any[]).every((p: any) => Object.keys(p).sort().join() === staffProgKeys) && clean(own), JSON.stringify(techProgRow));
    check("28b. programs list: the implicit container isn't listed to a Staff login", !(own.j as any[]).some((p: any) => p.name === "Competency"));
    check("28c. programs list: an editor still gets the counts and method groups", ed.s === 200 && (ed.j as any[]).find((p: any) => p.id === techProg)?.assessmentCount > ownInTech && Array.isArray((ed.j as any[]).find((p: any) => p.id === techProg)?.methodGroups) && typeof (ed.j as any[])[0]?.employeeCount === "number");

    own = await asAnn(`${L}/competency/programs/${techProg}`);
    ed = await asEditor(`${L}/competency/programs/${techProg}`);
    check("29a. one program: only their own assessments, results and employee row", own.s === 200 && own.j.assessments?.length === ownInTech && own.j.assessments.every((a: any) => a.staff_employee_id === annId) && own.j.employees?.length === 1 && own.j.employees[0].staff_employee_id === annId && clean(own), `${own.j.assessments?.length}`);
    check("29b. one program: an editor sees everyone's assessments and items", ed.s === 200 && ed.j.assessments?.some((a: any) => a.staff_employee_id === zorkId && a.items?.some((i: any) => i.el1_specimen_id === "ZQ-SPECIMEN-3")) && ed.j.employees?.length > 1);
    await call("POST", `${L}/competency/programs/${techProg}/not-applicable`, { employeeId: benComp.id, reason: "Made-up reason" }, OWNER.token);
    own = await asAnn(`${L}/competency/programs/${techProg}`);
    ed = await asEditor(`${L}/competency/programs/${techProg}`);
    check("29c. one program: another person's Not applicable mark stays off a Staff login's copy", (own.j.notApplicable || []).length === 0 && ed.j.notApplicable?.some((r: any) => r.employee_id === benComp.id), JSON.stringify(ed.j.notApplicable));

    own = await asAnn(`${L}/competency/employees`);
    ed = await asEditor(`${L}/competency/employees`);
    check("30. competency employees: only their own row; an editor sees everyone", own.s === 200 && own.j.length === 1 && own.j[0].staff_employee_id === annId && ed.s === 200 && ed.j.length > 2 && ed.j.some((e: any) => e.staff_employee_id === zorkId), `${own.j.length}/${ed.j.length}`);

    own = await asAnn(`${L}/staff/qualified-observers`);
    const beaObservers = await call("GET", `${L}/staff/qualified-observers`, undefined, BEA.token);
    ed = await asEditor(`${L}/staff/qualified-observers`);
    check("31a. qualified observers: only who is named on their own record", own.s === 200 && own.j.length === 1 && own.j[0].employeeId === tc && !own.j.some((o: any) => o.employeeId === notOnAnnsRecord), JSON.stringify(own.j.map((o: any) => o.name)));
    check("31b. qualified observers: nobody when nobody has observed them", beaObservers.s === 200 && beaObservers.j.length === 0, JSON.stringify(beaObservers.j));
    check("31c. qualified observers: an editor gets the whole list", ed.s === 200 && ed.j.some((o: any) => o.employeeId === tc) && ed.j.some((o: any) => o.employeeId === notOnAnnsRecord));

    own = await asAnn(`${L}/staff/employees`);
    ed = await asEditor(`${L}/staff/employees`);
    check("32a. roster: only their own row", own.s === 200 && own.j.length === 1 && own.j[0].id === annId && !!own.j[0].competencyStatus, `${own.j.length}`);
    check("32b. roster: an editor gets everyone with their competency status", ed.s === 200 && ed.j.length > 3 && ed.j.find((e: any) => e.id === zorkId)?.competencyStatus != null);

    // ── The same data by another door ─────────────────────────────────────────
    const zorkDoors: Array<[string, string, string, any?]> = [
      ["assessment PDF", "GET", `${L}/competency/assessments/${zRec}/pdf`],
      ["assessment PDF, older route", "GET", `/api/veritacomp/assessments/${zRec}/pdf`],
      ["assessment PDF, POST route", "POST", `/api/competency/pdf/${zRec}`, {}],
      ["assessment", "GET", `/api/veritacomp/assessments/${zRec}`],
      ["assessment quiz results", "GET", `/api/veritacomp/assessments/${zRec}/quiz-results`],
      ["assessment documents", "GET", `${L}/competency/assessments/${zRec}/element-documents`],
      ["prior-year comparison", "GET", `${L}/competency/assessments/${zRec}/prior-year-comparison`],
      ["assessment audit log", "GET", `${L}/competency/assessments/${zRec}/audit-log`],
      ["survey bundle", "POST", `${L}/competency/survey-bundle`, { periodMonths: null }],
      ["competency register", "GET", `${L}/staff/competency-register.xlsx`],
      ["reassessment stats", "GET", `${L}/competency/reassessment-stats`],
      ["duty-change events", "GET", `${L}/staff/duty-change-events`],
      ["reminder preview", "GET", `${L}/competency/reminder-preview`],
      ["import summary", "GET", `${L}/competency/method-history/summary`],
      ["import template", "GET", `${L}/competency/method-history/template.xlsx`],
      ["method groups", "GET", `${L}/competency/method-groups`],
      ["eligible employees", "GET", `${L}/competency/programs/${techProg}/eligible-employees`],
      ["suggested method groups", "GET", `${L}/competency/programs/${techProg}/employees/${zorkComp.id}/suggested-method-groups`],
      ["competency employee's instruments", "GET", `${L}/competency/employees/${zorkComp.id}/staff-instruments`],
      ["one roster row", "GET", `${L}/staff/employees/${zorkId}`],
      ["one roster row, older route", "GET", `/api/staff/employees/${zorkId}`],
      ["roster row's instruments", "GET", `${L}/staff/employees/${zorkId}/instruments`],
      ["former staff", "GET", `${L}/staff/employees-terminated`],
      ["who runs an instrument", "GET", `${L}/staff/instruments/${ANALYZER}/employees`],
      ["who runs several instruments", "GET", `${L}/staff/instruments-bulk/employees?ids=${ANALYZER}`],
    ];
    for (const [name, method, path, body] of zorkDoors) {
      const s = await call(method, path, body, ANN.token);
      const e = await call(method, path, body, EDITOR.token);
      check(`33. ${name}: refused to a Staff login, open to an editor`, refused(s) && e.s === 200, `${s.s} ${s.j.code} / ${e.s}`);
    }
    const annRec = (sqlite.prepare("SELECT a.id FROM competency_assessments a WHERE a.employee_id = ? AND a.program_id = ? ORDER BY a.id LIMIT 1").get(annComp.id, techProg) as any).id;
    for (const [name, method, path, body] of [
      ["own assessment PDF", "GET", `${L}/competency/assessments/${annRec}/pdf`],
      ["own assessment PDF, older route", "GET", `/api/veritacomp/assessments/${annRec}/pdf`],
      ["own assessment", "GET", `/api/veritacomp/assessments/${annRec}`],
      ["own assessment documents", "GET", `${L}/competency/assessments/${annRec}/element-documents`],
      ["own quiz results", "GET", `/api/veritacomp/assessments/${annRec}/quiz-results`],
      ["own prior-year comparison", "GET", `${L}/competency/assessments/${annRec}/prior-year-comparison`],
      ["own roster row", "GET", `${L}/staff/employees/${annId}`],
      ["own instruments", "GET", `${L}/staff/employees/${annId}/instruments`],
      ["own competency employee's instruments", "GET", `${L}/competency/employees/${annComp.id}/staff-instruments`],
    ] as Array<[string, string, string, any?]>) {
      const r = await call(method, path, body, ANN.token);
      check(`34. ${name}: still opens`, r.s === 200 && clean(r), `${r.s} ${r.j.error ?? ""}`);
    }
    const filteredDoors: Array<[string, string, (j: any) => boolean, (j: any) => boolean]> = [
      ["programs list, older route", `/api/competency/programs`, (j) => j.some((p: any) => p.id === techProg) && j.every((p: any) => p.employeeCount === undefined), (j) => j.some((p: any) => typeof p.employeeCount === "number")],
      ["one program, older route", `/api/competency/programs/${techProg}`, (j) => j.assessments.length === ownInTech, (j) => j.assessments.some((a: any) => a.staff_employee_id === zorkId)],
      ["competency employees, older route", `/api/competency/employees`, (j) => j.length === 1 && j[0].staff_employee_id === annId, (j) => j.some((e: any) => e.staff_employee_id === zorkId)],
      ["roster, older route", `/api/staff/employees`, (j) => j.length === 1 && j[0].id === annId, (j) => j.some((e: any) => e.id === zorkId)],
      ["program's assessments, older route", `/api/veritacomp/programs/${techProg}/assessments`, (j) => j.length === ownInTech && j.every((a: any) => a.employee_id === annComp.id), (j) => j.some((a: any) => a.employee_id === zorkComp.id)],
      ["quiz assignments", `/api/veritacomp/quizzes/${quiz.j.id}/assignments`, (j) => j.assignments.length === 1 && j.assignments[0].staff_employee_id === annId, (j) => j.assignments.some((a: any) => a.staff_employee_id === zorkId)],
      ["VeritaTrack worklist, competency milestones", `${L}/veritatrack/worklist`, (j) => j.cross_module.filter((c: any) => c.source === "veritacomp").every((c: any) => /Self/.test(c.label)) && j.cross_module.some((c: any) => c.source === "veritacomp"), (j) => j.cross_module.some((c: any) => /Quillfeather/.test(c.label))],
    ];
    for (const [name, path, staffOk, editorOk] of filteredDoors) {
      const s = await asAnn(path);
      const e = await asEditor(path);
      check(`35. ${name}: a Staff login gets only their own, an editor everyone's`, s.s === 200 && clean(s) && staffOk(s.j) && e.s === 200 && editorOk(e.j), `${s.s}/${e.s} ${JSON.stringify(s.j).slice(0, 160)}`);
    }
    // No one is overdue on the fixture yet, and the dashboard's list needs someone overdue to mean anything: Ben, long on the roster, has no initial.
    sqlite.prepare("UPDATE staff_employees SET created_at = '2019-03-01T00:00:00.000Z' WHERE id = ?").run(benId);
    const dashS = await asAnn(`${L}/competency/dashboard-stats`);
    const dashE = await asEditor(`${L}/competency/dashboard-stats`);
    check("35. dashboard stats: a Staff login is counted alone, and an editor sees the overdue list", dashS.s === 200 && dashS.j.total === 1 && clean(dashS) && !(dashS.j.overdueIds || []).includes(benId) && dashE.s === 200 && dashE.j.total > 1 && dashE.j.overdueIds?.includes(benId), `${dashS.j.total}/${dashE.j.total} ${JSON.stringify(dashE.j.overdueIds)}`);
    const portalPeople = await call("GET", "/api/staff-portal-session/employees", undefined, ANN.token);
    check("35. the portal's employee list holds only the person", portalPeople.s === 200 && portalPeople.j.employees?.length === 1 && portalPeople.j.employees[0].id === annId, JSON.stringify(portalPeople.j.employees));

    // ── The answer key stays with whoever builds the quiz (Michael Q185 = 1) ──
    const keyUrl = (id: number) => `/api/veritacomp/quizzes/${id}?withAnswers=1`;
    const noKey = (r: { j: any }) => !JSON.stringify(r.j).includes("correct_answer");
    const keyStaff = await asAnn(keyUrl(quiz.j.id));
    check("35a. a Staff login can't read a quiz's answer key", keyStaff.s === 403 && keyStaff.j.code === "STAFF_NO_ANSWER_KEY" && noKey(keyStaff), `${keyStaff.s} ${keyStaff.j.code}`);
    const keyTrue = await asAnn(`/api/veritacomp/quizzes/${quiz.j.id}?withAnswers=true`);
    check("35b. the other spelling of the flag is refused too", keyTrue.s === 403 && noKey(keyTrue), `${keyTrue.s}`);
    const takeView = await asAnn(`/api/veritacomp/quizzes/${quiz.j.id}`);
    check("35c. they can still open the quiz to take it, with no answers in it", takeView.s === 200 && takeView.j.questions?.length === 1 && noKey(takeView), `${takeView.s}`);
    const keyEditor = await asEditor(keyUrl(quiz.j.id));
    check("35d. an editor still reads the answer key", keyEditor.s === 200 && keyEditor.j.questions?.[0]?.correct_answer === "a", `${keyEditor.s}`);
    const keyOwner = await call("GET", keyUrl(quiz.j.id), undefined, OWNER.token);
    check("35e. the owner still reads the answer key", keyOwner.s === 200 && keyOwner.j.questions?.[0]?.correct_answer === "a", `${keyOwner.s}`);
    const sysQuiz = Number(sqlite.prepare("INSERT INTO competency_quizzes (user_id, title, questions, created_at) VALUES (0, 'Made-up default quiz', ?, ?)").run(JSON.stringify([{ id: "s1", question: "Which?", options: ["a", "b"], correct_answer: "a" }]), now).lastInsertRowid);
    const keySys = await asAnn(keyUrl(sysQuiz));
    check("35f. a built-in quiz's answer key is refused to a Staff login as well", keySys.s === 403 && noKey(keySys), `${keySys.s}`);
    sqlite.prepare("DELETE FROM competency_quizzes WHERE id = ?").run(sysQuiz);
    // The other route that hands back answers scores a result, and it's for editors. A Staff login takes quizzes through My sign-offs.
    const scoreDoor = await call("POST", "/api/veritacomp/quiz-results", { quizId: quiz.j.id, employeeId: annComp.id, answers: [] }, ANN.token);
    check("35g. a Staff login can't get the answers by posting an empty result", scoreDoor.s === 403 && noKey(scoreDoor), `${scoreDoor.s}`);

    // ── The rest of a person's staff file: real rows, so a refusal or a filter can't pass on an empty list (Michael Q186 = 1) ──
    const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    const staffDoc = (emp: number, docType: string, title: string, expires: string | null, credits: number | null) => sqlite.prepare(
      "INSERT INTO staff_employee_documents (employee_id, doc_type, title, url, expiration_date, created_at, credits, activity_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(emp, docType, title, `https://example.test/${encodeURIComponent(title)}`, expires, now, credits, credits ? inDays(-10) : null);
    staffDoc(zorkId, "license", "ZQ-LICENSE", inDays(20), null);
    staffDoc(zorkId, "ce_credit", "ZQ-COURSE", null, 3);
    staffDoc(annId, "license", "Ann own license", inDays(20), null);
    staffDoc(annId, "ce_credit", "Ann own course", null, 2);
    const studyBy = (analyst: string, testName: string, studyLab: number | null = labId, owner: number | null = OWNER.id) => sqlite.prepare(
      `INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at)
       VALUES (?, ?, ?, 'Made-up Analyzer', ?, ?, 'method_comparison', 0.1, '[]', '[]', 'completed', ?)`
    ).run(owner, studyLab, testName, analyst, day, now);
    studyBy("Quillfeather, Zork", "ZQ-STUDY");
    studyBy("Self, Ann", "Ann own study");
    const staffLabOf = (emp: number) => Number((sqlite.prepare("SELECT lab_id FROM staff_employees WHERE id = ?").get(emp) as any).lab_id);
    const noSpecialtyRole = (emp: number) => sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number, all_specialties) VALUES (?, ?, 'TC', NULL, 0)").run(emp, staffLabOf(emp));
    noSpecialtyRole(zorkId);
    sqlite.prepare(
      `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id)
       VALUES (?, ?, NULL, ?, 'pending', '{"mode":"view_all"}', ?, ?, 'staff_portal', ?)`
    ).run(OWNER.id, `zork-invite-${stamp}@example.test`, now, `sod-zork-invite-${stamp}`, labId, zorkId);
    const reminderSaved = await call("PUT", `${L}/competency/reminder-config`, { enabled: true, supervisor_recipients: [{ email: `zork-super-${stamp}@example.test`, name: "Zork Quillfeather" }], escalation_recipients: [] }, OWNER.token);
    check("35h. the coworker has documents, CE, a study, a CMS 209 gap, an invite and a place on the reminder list", reminderSaved.s === 200, `${reminderSaved.s}`);
    // Non-technical due dates name people (Q216 = 1). A real row, so the sweep below has one to leak.
    sqlite.prepare("INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, status, locked, completion_date, created_at) VALUES (?, ?, 'annual', ?, 'pass', 1, ?, ?)").run(ntProg, zorkComp.id, inDays(-30), inDays(-30), now);
    const ntSet = await call("PUT", `${L}/competency/nontechnical-frequency`, { months: 24 }, OWNER.token);
    const ntOwner = await call("GET", `${L}/competency/nontechnical-due`, undefined, OWNER.token);
    check("35i. the coworker has a non-technical due date the owner can read", ntSet.s === 200 && /Quillfeather/.test(JSON.stringify(ntOwner.j)), `${ntSet.s} ${JSON.stringify(ntOwner.j).slice(0, 160)}`);

    // ── A sweep of every read, so a door nobody thought of still fails ────────
    const fillPath = (path: string): string | null => {
      let unknown = false;
      const out = path.replace(/:([A-Za-z_]+)/g, (_m, name, offset) => {
        const prev = path.slice(0, offset).split("/").filter(Boolean).pop() || "";
        if (name === "labId") return String(labId);
        if (name === "employeeId" || name === "employee_id") return String(path.includes("/programs/") ? zorkComp.id : zorkId);
        if (name === "programId") return String(techProg);
        if (name === "instrumentId") return String(ANALYZER);
        if (name === "assessmentId" || name === "assessment_id") return String(zRec);
        if (name === "quizId") return String(quiz.j.id);
        if (name === "id" && prev === "employees") return String(path.includes("/competency/") ? zorkComp.id : zorkId);
        if (name === "id" && prev === "programs") return String(techProg);
        if (name === "id" && prev === "assessments") return String(zRec);
        if (name === "id" && prev === "quizzes") return String(quiz.j.id);
        unknown = true; return "1";
      });
      return unknown ? null : out;
    };
    // Decided, so these stay open. Schedule names (Michael Q186 = 1): staff normally see who's working. The lab's VeritaCheck study lists and coverage:
    // a study is the lab's record, and who ran it isn't a personnel matter. A new route doesn't go on this list without a decision like those.
    const LEFT_ALONE = new Set(["/api/labs/:labId/schedule/staff", "/api/studies", "/api/labs/:labId/studies", "/api/labs/:labId/veritacheck/coverage"]);
    const gets: string[] = [];
    for (const layer of (app as any).router.stack) {
      const r = layer.route;
      if (!r?.methods?.get) continue;
      for (const p of Array.isArray(r.path) ? r.path : [r.path]) if (typeof p === "string" && p.startsWith("/api/") && !/^\/api\/(admin|demo|pdf|zip)|\/export-all/.test(p)) gets.push(p);
    }
    const leaks: string[] = [];
    let swept = 0;
    for (const path of gets) {
      const url = fillPath(path);
      if (!url || LEFT_ALONE.has(path)) continue;
      swept++;
      const r = await fetch(base + url, { headers: { Authorization: `Bearer ${ANN.token}` } });
      const text = await r.text();
      if (/Quillfeather|ZQ-[A-Z]+/.test(text)) leaks.push(`${r.status} ${path}`);
    }
    check(`36. no read (${swept} tried) shows a Staff login the coworker's name or entries`, swept > 200 && leaks.length === 0, leaks.join(" | "));
    for (const path of Array.from(LEFT_ALONE)) console.log(`INFO  stays open by decision: ${path}`);

    // ── Fail closed ───────────────────────────────────────────────────────────
    const nobodyReads = (emp: number): string[] => [
      `${L}/competency/employee/${emp}`, `${L}/competency/employee/${emp}/record-pdf`, `${L}/competency/by-instrument`, `${L}/competency/instrument/${ANALYZER}`,
      `${L}/competency/signoffs`, `${L}/competency/owed`, `${L}/competency/programs`, `${L}/competency/programs/${techProg}`, `${L}/competency/employees`,
      `${L}/staff/qualified-observers`, `${L}/staff/employees`,
    ];
    const seesNobody = (j: any) => !/Quillfeather|ZQ-[A-Z]+|\bBen\b|\bAnn\b|Tate/.test(JSON.stringify(j));
    const failClosed = async (name: string, token: string, emp: number) => {
      const results = await Promise.all(nobodyReads(emp).map(async (p) => [p, await call("GET", p, undefined, token)] as const));
      const bad = results.filter(([, r]) => !(r.s === 403 || r.s === 200) || !seesNobody(r.j)).map(([p, r]) => `${r.s} ${p}`);
      check(`37. ${name}: all eleven reads show nobody`, bad.length === 0, bad.join(" | "));
    };
    const NOLINK = await register("Nolink");
    member(labId, NOLINK.id); seat(OWNER.id, labId, NOLINK, "staff_portal", '{"mode":"view_all"}', null);
    await failClosed("a Staff seat with no staff record linked", NOLINK.token, zorkId);
    const noLinkMe = await call("GET", "/api/labs/me", undefined, NOLINK.token);
    const noLinkHere = (noLinkMe.j as any[]).find((m: any) => m.labId === labId);
    check("37a. the unlinked seat is reported to the page as own-only with no record", noLinkHere?.competencyOwnOnly === true && noLinkHere?.ownEmployeeId === null, JSON.stringify(noLinkHere?.competencyOwnOnly));
    const keyNoLink = await call("GET", keyUrl(quiz.j.id), undefined, NOLINK.token);
    check("37a2. the unlinked seat can't read the answer key", keyNoLink.s === 403 && noKey(keyNoLink), `${keyNoLink.s}`);
    const annSeat = () => sqlite.prepare("SELECT id FROM user_seats WHERE seat_user_id = ? AND lab_id = ? AND seat_type = 'staff_portal'").get(ANN.id, labId) as any;
    sqlite.prepare("UPDATE user_seats SET status = 'deactivated' WHERE id = ?").run(annSeat().id);
    await failClosed("a deactivated Staff seat that still has a lab membership", ANN.token, zorkId);
    check("37b. a deactivated seat can't open its old record either", refused(await asAnn(`${L}/competency/employee/${annId}`)));
    const keyDeactivated = await asAnn(keyUrl(quiz.j.id));
    check("37b2. a deactivated seat can't read the answer key", keyDeactivated.s === 403 && noKey(keyDeactivated), `${keyDeactivated.s}`);
    sqlite.prepare("UPDATE user_seats SET status = 'active' WHERE id = ?").run(annSeat().id);
    check("37c. restored, the seat reads its own record again", (await asAnn(`${L}/competency/employee/${annId}`)).s === 200);
    const LABLESS = await register("Labless");
    member(labId, LABLESS.id);
    sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, NULL, 'staff_portal', ?)`).run(OWNER.id, LABLESS.email, LABLESS.id, now, now, `sod-labless-${stamp}`, zorkId);
    await failClosed("an older Staff seat with no lab on it", LABLESS.token, zorkId);
    check("37d. no lab to check against: someone with only a Staff seat sees nobody; an owner isn't limited", JSON.stringify(staffOwnScope(sqlite, ANN.id, null)) === '{"employeeId":null}' && staffOwnScope(sqlite, OWNER.id, null) === null);

    // ── Per lab: seats in two labs ────────────────────────────────────────────
    const annLab2 = await person("Self", "Ann", [OTHER_LAB_INST], L2, OWNER2.token);
    member(lab2, ANN.id); seat(OWNER2.id, lab2, ANN, "staff_portal", '{"mode":"view_all"}', annLab2);
    check("38a. seats in two labs: lab one holds them to that lab's row", (await asAnn(`${L}/competency/employee/${annId}`)).s === 200 && refused(await asAnn(`${L}/competency/employee/${annLab2}`)) && refused(await asAnn(`${L}/competency/employee/${zorkId}`)));
    check("38b. seats in two labs: lab two holds them to that lab's row", (await asAnn(`${L2}/competency/employee/${annLab2}`)).s === 200 && refused(await asAnn(`${L2}/competency/employee/${annId}`)) && refused(await asAnn(`${L2}/competency/employee/${zedId}`)));
    const rosterL2 = await asAnn(`${L2}/staff/employees`);
    check("38c. seats in two labs: each roster is that lab's own row", rosterL2.j.length === 1 && rosterL2.j[0].id === annLab2 && (await asAnn(`${L}/staff/employees`)).j[0].id === annId, JSON.stringify(rosterL2.j.map?.((e: any) => e.id)));
    const annMe = await call("GET", "/api/labs/me", undefined, ANN.token);
    const annHere = (annMe.j as any[]).find((m: any) => m.labId === labId), annThere = (annMe.j as any[]).find((m: any) => m.labId === lab2);
    check("38d. seats in two labs: the page is told the right row for each lab", annHere?.competencyOwnOnly === true && annHere?.ownEmployeeId === annId && annThere?.competencyOwnOnly === true && annThere?.ownEmployeeId === annLab2, `${annHere?.ownEmployeeId}/${annThere?.ownEmployeeId}`);
    const annOldRoute = await call("GET", `/api/competency/programs/${techProg}`, undefined, ANN.token, { "X-Active-Lab-Id": String(lab2) });
    check("38e. a program from lab one read while lab two is active is still held to lab one's row", annOldRoute.s === 200 && annOldRoute.j.assessments?.length === ownInTech && clean(annOldRoute), `${annOldRoute.s} ${annOldRoute.j.assessments?.length}`);
    const annOtherAssessment = await call("GET", `/api/veritacomp/assessments/${zRec}`, undefined, ANN.token, { "X-Active-Lab-Id": String(lab2) });
    check("38f. another person's assessment in lab one stays refused while lab two is active", refused(annOtherAssessment), `${annOtherAssessment.s}`);
    const MIX = await register("Mix");
    const mixRow = await person("Mixed", "Mo", [OTHER_LAB_INST], L2, OWNER2.token);
    member(labId, MIX.id); seat(OWNER.id, labId, MIX, "active", '{"mode":"edit_all"}', null);
    member(lab2, MIX.id); seat(OWNER2.id, lab2, MIX, "staff_portal", '{"mode":"view_all"}', mixRow);
    const mixEd = await call("GET", `${L}/competency/employee/${zorkId}`, undefined, MIX.token);
    const mixStaff = await call("GET", `${L2}/competency/employee/${zedId}`, undefined, MIX.token);
    const mixOwn = await call("GET", `${L2}/competency/employee/${mixRow}`, undefined, MIX.token);
    check("38g. an editor in one lab and a Staff login in another: everyone here, only themselves there", mixEd.s === 200 && refused(mixStaff) && mixOwn.s === 200, `${mixEd.s}/${mixStaff.s}/${mixOwn.s}`);
    const mixStaffOwner = await call("GET", `${L}/competency/employee/${zorkId}`, undefined, OWNER2.token);
    check("38h. another lab's owner with no place here isn't let in", mixStaffOwner.s === 403);
    member(labId, OWNER2.id); seat(OWNER.id, labId, OWNER2, "staff_portal", '{"mode":"view_all"}', benId);
    const o2Here = await call("GET", `${L}/competency/employee/${zorkId}`, undefined, OWNER2.token);
    const o2Own = await call("GET", `${L2}/competency/employee/${zedId}`, undefined, OWNER2.token);
    check("38i. an owner with a Staff seat in someone else's lab: limited there, unlimited in their own", refused(o2Here) && o2Own.s === 200, `${o2Here.s}/${o2Own.s}`);
    // A stored row is checked in its own lab, whichever lab is active: MIX is an editor in lab one and a Staff login in lab two.
    const zedComp = (sqlite.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(zedId, lab2) as any)?.id
      ?? Number(sqlite.prepare("INSERT INTO competency_employees (user_id, lab_id, name, title, status, created_at, staff_employee_id) VALUES (?, ?, 'Zed Lab', '', 'active', ?, ?)").run(OWNER2.id, lab2, now, zedId).lastInsertRowid);
    const l2Prog = (await call("POST", `${L2}/competency/programs`, { name: "Made-up Lab Two Program", department: "Hematology", type: "technical" }, OWNER2.token)).j.id;
    const l2Rec = (await call("POST", `${L2}/competency/assessments`, { programId: l2Prog, employeeId: zedComp, assessmentType: "annual", assessmentDate: day, evaluatorName: "Made Up", competencyType: "technical", status: "pass", items: [{ methodNumber: 1, elementNumber: 1, itemLabel: "Made-up", el1SpecimenId: "ZED-SPECIMEN", el1ObserverInitials: "", passed: false }] }, OWNER2.token)).j.id;
    const lab1Active = { "X-Active-Lab-Id": String(labId) };
    const mixL2Prog = await call("GET", `/api/competency/programs/${l2Prog}`, undefined, MIX.token, lab1Active);
    const mixL2Assessment = await call("GET", `/api/veritacomp/assessments/${l2Rec}`, undefined, MIX.token, lab1Active);
    const mixL2Pdf = await call("GET", `${L2}/competency/assessments/${l2Rec}/pdf`, undefined, MIX.token);
    const mixL2List = await call("GET", `/api/veritacomp/programs/${l2Prog}/assessments`, undefined, MIX.token, lab1Active);
    check("38j. lab two's program, read with lab one active, still holds an editor of lab one to their own Staff row there", mixL2Prog.s === 200 && mixL2Prog.j.assessments?.length === 0 && !/ZED-SPECIMEN/.test(JSON.stringify(mixL2Prog.j)) && mixL2List.s === 200 && mixL2List.j.length === 0, `${mixL2Prog.s} ${mixL2Prog.j.assessments?.length} ${mixL2List.j.length}`);
    check("38k. lab two's assessment and PDF are refused them too", refused(mixL2Assessment) && refused(mixL2Pdf), `${mixL2Assessment.s}/${mixL2Pdf.s}`);
    seat(OWNER2.id, lab2, OWNER2, "staff_portal", '{"mode":"view_all"}', zedId);
    sqlite.prepare("UPDATE lab_members SET role = 'staff' WHERE lab_id = ? AND user_id = ?").run(lab2, OWNER2.id);
    const ownerSelfSeat = await call("GET", `${L2}/competency/employee/${annLab2}`, undefined, OWNER2.token);
    sqlite.prepare("UPDATE lab_members SET role = 'owner' WHERE lab_id = ? AND user_id = ?").run(lab2, OWNER2.id);
    check("38l. a lab's owner holding a Staff seat in their own lab isn't limited, whatever their membership role says", ownerSelfSeat.s === 200, `${ownerSelfSeat.s}`);

    // ── Unchanged for everyone else ───────────────────────────────────────────
    const seesEveryone = async (name: string, token: string) => {
      const rec = await call("GET", `${L}/competency/employee/${zorkId}`, undefined, token);
      const emps = await call("GET", `${L}/competency/employees`, undefined, token);
      const prog = await call("GET", `${L}/competency/programs/${techProg}`, undefined, token);
      const roster = await call("GET", `${L}/staff/employees`, undefined, token);
      check(`39. ${name}: sees everyone`, rec.s === 200 && emps.j.length > 2 && prog.j.assessments?.some((a: any) => a.staff_employee_id === zorkId) && roster.j.length > 3, `${rec.s} ${emps.j.length} ${roster.j.length}`);
    };
    await seesEveryone("the owner", OWNER.token);
    await seesEveryone("an editor", EDITOR.token);
    await seesEveryone("a view-only reviewer", VIEWER.token);
    await seesEveryone("a member with no seat", PLAIN.token);
    const CARD = await register("Card");
    const cardRow = await person("Holder", "Card", [ANALYZER]);
    member(labId, CARD.id); seat(OWNER.id, labId, CARD, "active", '{"mode":"edit_all"}', cardRow);
    await seesEveryone("an editor with a staff card", CARD.token);
    check("39a. an editor with a staff card has no own-only limit on the page", ((await call("GET", "/api/labs/me", undefined, CARD.token)).j as any[]).find((m: any) => m.labId === labId)?.competencyOwnOnly === false);
    const BOTH = await register("Both");
    const bothRow = await person("Both", "Bo", [ANALYZER]);
    member(labId, BOTH.id); seat(OWNER.id, labId, BOTH, "staff_portal", '{"mode":"view_all"}', bothRow); seat(OWNER.id, labId, BOTH, "active", '{"mode":"edit_all"}', null);
    await seesEveryone("someone holding an editor seat and a Staff seat in the same lab", BOTH.token);
    const REVIEWER = await register("Reviewer");
    const reviewerRow = await person("Viewer", "Vic", [ANALYZER]);
    member(labId, REVIEWER.id); seat(OWNER.id, labId, REVIEWER, "staff_portal", '{"mode":"view_all"}', reviewerRow); seat(OWNER.id, labId, REVIEWER, "view_only", '{"mode":"view_all"}', null);
    await seesEveryone("someone holding a view-only seat and a Staff seat in the same lab", REVIEWER.token);
    const COMPEDIT = await register("Compedit");
    const compEditRow = await person("Edits", "Comp", [ANALYZER]);
    member(labId, COMPEDIT.id); seat(OWNER.id, labId, COMPEDIT, "staff_portal", '{"mode":"view_all","overrides":{"veritacomp":"edit"}}', compEditRow);
    await seesEveryone("a Staff seat given edit on VeritaComp (it assigns quizzes from the roster)", COMPEDIT.token);
    const STAFFEDIT = await register("Staffedit");
    const staffEditRow = await person("Edits", "Staff", [ANALYZER]);
    member(labId, STAFFEDIT.id); seat(OWNER.id, labId, STAFFEDIT, "staff_portal", '{"mode":"view_all","overrides":{"veritastaff":"edit"}}', staffEditRow);
    const staffEditRoster = await call("GET", `${L}/staff/employees`, undefined, STAFFEDIT.token);
    const staffEditRec = await call("GET", `${L}/competency/employee/${zorkId}`, undefined, STAFFEDIT.token);
    check("39b. a Staff seat given edit on VeritaStaff keeps the roster but is still limited in VeritaComp", staffEditRoster.j.length > 3 && refused(staffEditRec), `${staffEditRoster.j.length}/${staffEditRec.s}`);
    const keyCompEdit = await call("GET", keyUrl(quiz.j.id), undefined, COMPEDIT.token);
    check("39c. a Staff seat given edit on VeritaComp builds quizzes, so it keeps the answer key", keyCompEdit.s === 200 && keyCompEdit.j.questions?.[0]?.correct_answer === "a", `${keyCompEdit.s}`);
    const keyStaffEdit = await call("GET", keyUrl(quiz.j.id), undefined, STAFFEDIT.token);
    check("39d. edit on VeritaStaff doesn't open the answer key", keyStaffEdit.s === 403 && noKey(keyStaffEdit), `${keyStaffEdit.s}`);
    const DEMOTED = await register("Demoted");
    const demotedRow = await person("Demoted", "Dee", [ANALYZER]);
    member(labId, DEMOTED.id); seat(OWNER.id, labId, DEMOTED, "staff_portal", '{"mode":"view_all"}', demotedRow); seat(OWNER.id, labId, DEMOTED, "active", '{"mode":"edit_all"}', null);
    sqlite.prepare("UPDATE user_seats SET status = 'deactivated' WHERE seat_user_id = ? AND seat_type = 'active'").run(DEMOTED.id);
    const demotedRec = await call("GET", `${L}/competency/employee/${zorkId}`, undefined, DEMOTED.token);
    const demotedSelf = await call("GET", `${L}/competency/employee/${demotedRow}`, undefined, DEMOTED.token);
    check("39c. a deactivated editor seat beside a live Staff seat lifts nothing", refused(demotedRec) && demotedSelf.s === 200, `${demotedRec.s}/${demotedSelf.s}`);
    const STAFFCUT = await register("Staffcut");
    const staffCutRow = await person("Staffcut", "Sam", [ANALYZER]);
    member(labId, STAFFCUT.id); seat(OWNER.id, labId, STAFFCUT, "staff_portal", '{"mode":"view_all","overrides":{"veritacomp":"edit"}}', staffCutRow);
    sqlite.prepare("UPDATE user_seats SET status = 'deactivated' WHERE seat_user_id = ?").run(STAFFCUT.id);
    check("39d. a deactivated Staff seat's old edit permission lifts nothing", refused(await call("GET", `${L}/competency/employee/${zorkId}`, undefined, STAFFCUT.token)));
    const ADMINSEAT = await register("Adminseat");
    const adminRow = await person("Admin", "Ada", [ANALYZER]);
    sqlite.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'admin', '{}', 'active', 0, ?, ?, ?)`).run(labId, ADMINSEAT.id, now, now, now);
    seat(OWNER.id, labId, ADMINSEAT, "staff_portal", '{"mode":"view_all"}', adminRow);
    await seesEveryone("a lab admin who also holds a Staff seat", ADMINSEAT.token);
    const ORGADMIN = await register("Orgadmin");
    const orgRow = await person("Org", "Ollie", [ANALYZER]);
    const orgId = Number(sqlite.prepare("INSERT INTO organizations (name) VALUES ('Made-up System')").run().lastInsertRowid);
    sqlite.prepare("UPDATE labs SET organization_id = ? WHERE id = ?").run(orgId, labId);
    sqlite.prepare("INSERT INTO organization_members (organization_id, user_id, org_role, status) VALUES (?, ?, 'org_admin', 'active')").run(orgId, ORGADMIN.id);
    seat(OWNER.id, labId, ORGADMIN, "staff_portal", '{"mode":"view_all"}', orgRow);
    await seesEveryone("an org admin who also holds a Staff seat", ORGADMIN.token);
    sqlite.prepare("UPDATE labs SET organization_id = NULL WHERE id = ?").run(labId);

    // ── A feature that really needs the names ─────────────────────────────────
    const TRACKER = await register("Tracker");
    const trackerRow = await person("Tracks", "Terry", [ANALYZER]);
    member(labId, TRACKER.id); seat(OWNER.id, labId, TRACKER, "staff_portal", '{"mode":"view_all","overrides":{"veritatrack":"edit"}}', trackerRow);
    const pickerNames = await call("GET", `${L}/staff/employees?names=1`, undefined, TRACKER.token);
    const pickerKeys = Array.from(new Set((pickerNames.j as any[]).flatMap((e: any) => Object.keys(e)))).sort().join();
    check("40a. a Staff seat that may edit tasks gets names for the owner picker: id, name and title, nothing else", pickerNames.s === 200 && pickerNames.j.length > 3 && pickerKeys === "first_name,id,last_name,middle_initial,title" && pickerNames.j.some((e: any) => e.id === zorkId), pickerKeys);
    const pickerPlain = await call("GET", `${L}/staff/employees`, undefined, TRACKER.token);
    check("40b. the same seat's plain roster is still only their own row", pickerPlain.j.length === 1 && pickerPlain.j[0].id === trackerRow, `${pickerPlain.j.length}`);
    const pickerOldRoute = await call("GET", `/api/staff/employees?names=1`, undefined, TRACKER.token);
    check("40c. the older route gives the same picker names", pickerOldRoute.s === 200 && pickerOldRoute.j.length > 3 && Object.keys(pickerOldRoute.j[0]).sort().join() === "first_name,id,last_name,middle_initial,title", `${pickerOldRoute.s}`);
    const annNames = await asAnn(`${L}/staff/employees?names=1`);
    check("40d. asking for names without edit on those modules gets only their own row", annNames.j.length === 1 && annNames.j[0].id === annId, `${annNames.j.length}`);
    const editorNames = await asEditor(`${L}/staff/employees?names=1`);
    check("40e. an editor's picker is unchanged: the full roster", editorNames.j.length > 3 && !!editorNames.j[0].competencyStatus);

    // ── What a Staff login must keep ──────────────────────────────────────────
    const keepSave = await myData(annId, ANALYZER, { elements: [{ num: 2, evidence: "After Q182", date: day }] });
    check("41a. a Staff login's own save still works", keepSave.s === 200 && rowOf(rowsFor(annId, ANALYZER), 2).el2_evidence === "After Q182", `${keepSave.s} ${keepSave.j.error ?? ""}`);
    const myList = await listFor(annId, ANN.token);
    check("41b. My sign-offs still lists their records and their own-record row", !!myList.own_record && myList.competencies?.length > 0, `${myList.competencies?.length}`);
    const myQuizzes = await call("GET", `/api/staff-portal-session/quizzes?employee_id=${annId}`, undefined, ANN.token);
    const myAssignment = (myQuizzes.j.assignments || myQuizzes.j.quizzes || []).find((q: any) => q.quiz_id === quiz.j.id || q.id != null);
    check("41c. their quiz is still listed", myQuizzes.s === 200 && !!myAssignment, JSON.stringify(myQuizzes.j).slice(0, 200));
    const myAssignmentId = myAssignment?.assignment_id ?? myAssignment?.id;
    const quizOpen = await call("GET", `/api/staff-portal-session/quizzes/${myAssignmentId}?employee_id=${annId}`, undefined, ANN.token);
    const quizTaken = await call("POST", `/api/staff-portal-session/quizzes/${myAssignmentId}/attempt`, { employee_id: annId, answers: [{ question_id: "q1", selected_answer: "a" }], typed_signature: "Ann Self" }, ANN.token);
    check("41d. they can still open and take it", quizOpen.s === 200 && quizTaken.s === 200, `${quizOpen.s}/${quizTaken.s} ${quizTaken.j.error ?? ""}`);
    const annAck = await call("POST", `/api/staff-portal-session/competencies/${techRec.j.id}/sign`, { employee_id: annId, typed_signature: "Ann Self" }, ANN.token);
    check("41e. Sign Competencies still works", annAck.s === 200, `${annAck.s} ${annAck.j.error ?? ""}`);
    const annStaffCard = await call("GET", `${L}/staff/employees/${annId}/documents`, undefined, ANN.token);
    check("41f. their own credential documents still open", annStaffCard.s === 200, `${annStaffCard.s}`);

    // ── The rest of a person's staff file (Michael Q186 = 1) ──────────────────
    const text = (r: { j: any }) => JSON.stringify(r.j);
    const fileBody = (method: string) => (method === "POST" ? {} : undefined);
    const fileReads: Array<[string, string, (emp: number) => string, (r: { j: any }) => boolean, (r: { j: any }) => boolean]> = [
      ["credential documents", "GET", (e) => `${L}/staff/employees/${e}/documents`, (r) => text(r).includes("Ann own license"), (r) => text(r).includes("ZQ-LICENSE")],
      ["CE summary", "GET", (e) => `${L}/staff/employees/${e}/ceu-summary`, (r) => r.j.earned === 2, (r) => r.j.earned === 3 && text(r).includes("ZQ-COURSE")],
      ["VeritaCheck studies", "GET", (e) => `${L}/staff/employees/${e}/veritacheck-studies`, (r) => text(r).includes("Ann own study"), (r) => text(r).includes("ZQ-STUDY")],
      ["CE transcript", "POST", (e) => `${L}/veritaceu/employees/${e}/transcript`, (r) => !!r.j.token, (r) => !!r.j.token],
    ];
    for (const [name, method, url, mineOk, theirsOk] of fileReads) {
      const theirs = await call(method, url(zorkId), fileBody(method), ANN.token);
      check(`42a. ${name}: a Staff login can't open a coworker's`, refused(theirs) && clean(theirs), `${theirs.s}`);
      const mine = await call(method, url(annId), fileBody(method), ANN.token);
      check(`42b. ${name}: a Staff login opens their own`, mine.s === 200 && mineOk(mine) && clean(mine), `${mine.s} ${text(mine).slice(0, 160)}`);
      for (const [who, token] of [["an editor", EDITOR.token], ["the owner", OWNER.token], ["a Staff seat with edit on VeritaStaff", STAFFEDIT.token], ["a Staff seat with edit on VeritaComp", COMPEDIT.token], ["a lab admin who also holds a Staff seat", ADMINSEAT.token]] as const) {
        const seen = await call(method, url(zorkId), fileBody(method), token);
        check(`42c. ${name}: ${who} still opens anyone's`, seen.s === 200 && theirsOk(seen), `${seen.s} ${text(seen).slice(0, 160)}`);
      }
      for (const [who, token] of [["no staff record linked", NOLINK.token], ["a deactivated Staff seat", STAFFCUT.token], ["no lab on the seat", LABLESS.token]] as const) {
        const seen = await call(method, url(zorkId), fileBody(method), token);
        check(`42d. ${name}: ${who} is refused`, refused(seen) && clean(seen), `${seen.s}`);
      }
    }

    const ceuUrl = `${L}/veritaceu/roster-summary`;
    const ceuAnn = await asAnn(ceuUrl);
    check("43a. CE roster: only their own row, and the totals count only them", ceuAnn.s === 200 && ceuAnn.j.ownOnly === true && ceuAnn.j.roster?.length === 1 && ceuAnn.j.roster[0].employeeId === annId && ceuAnn.j.roster[0].earned === 2 && ceuAnn.j.employeeCount === 1 && ceuAnn.j.metCount + ceuAnn.j.shortCount === 1 && clean(ceuAnn), text(ceuAnn).slice(0, 200));
    for (const [who, token] of [["an editor", EDITOR.token], ["the owner", OWNER.token], ["a Staff seat with edit on VeritaStaff", STAFFEDIT.token], ["a Staff seat with edit on VeritaComp", COMPEDIT.token]] as const) {
      const seen = await call("GET", ceuUrl, undefined, token);
      check(`43b. CE roster: ${who} sees the whole lab`, seen.s === 200 && seen.j.ownOnly === false && seen.j.employeeCount > 3 && seen.j.roster?.find((r: any) => r.employeeId === zorkId)?.earned === 3, `${seen.s} ${seen.j.employeeCount}`);
    }
    for (const [who, token] of [["no staff record linked", NOLINK.token], ["a deactivated Staff seat", STAFFCUT.token], ["no lab on the seat", LABLESS.token]] as const) {
      const seen = await call("GET", ceuUrl, undefined, token);
      check(`43c. CE roster: ${who} sees nobody, with no error`, seen.s === 200 && seen.j.ownOnly === true && seen.j.roster?.length === 0 && seen.j.employeeCount === 0 && seesNobody(seen.j), `${seen.s} ${text(seen).slice(0, 160)}`);
    }

    const credUrl = `${L}/staff/credentials-dashboard-stats`;
    const credAnn = await asAnn(credUrl);
    check("44a. expiring credentials: only their own are counted and named", credAnn.s === 200 && credAnn.j.total === 1 && credAnn.j.expiring30 === 1 && credAnn.j.expiringEmployeeIds?.join() === String(annId) && credAnn.j.expiringSample?.length === 1 && credAnn.j.expiringSample[0].docTitle === "Ann own license" && clean(credAnn), text(credAnn).slice(0, 240));
    for (const [who, token] of [["an editor", EDITOR.token], ["a Staff seat with edit on VeritaStaff", STAFFEDIT.token], ["a Staff seat with edit on VeritaComp", COMPEDIT.token]] as const) {
      const seen = await call("GET", credUrl, undefined, token);
      check(`44b. expiring credentials: ${who} sees the lab's`, seen.s === 200 && seen.j.total >= 2 && seen.j.expiringEmployeeIds?.includes(zorkId) && seen.j.expiringEmployeeIds?.includes(annId) && text(seen).includes("ZQ-LICENSE"), `${seen.s} ${seen.j.total}`);
    }
    for (const [who, token] of [["no staff record linked", NOLINK.token], ["a deactivated Staff seat", STAFFCUT.token], ["no lab on the seat", LABLESS.token]] as const) {
      const seen = await call("GET", credUrl, undefined, token);
      check(`44c. expiring credentials: ${who} sees nobody, with no error`, seen.s === 200 && seen.j.total === 0 && seen.j.expiringSample?.length === 0 && seesNobody(seen.j), `${seen.s} ${text(seen).slice(0, 160)}`);
    }

    for (const url of [`${L}/staff/cms209`, `/api/staff/cms209`]) {
      const annPdf = await call("POST", url, {}, ANN.token);
      check(`45a. ${url}: a Staff login can't generate the lab's personnel report`, refused(annPdf), `${annPdf.s}`);
      for (const [who, token] of [["no staff record linked", NOLINK.token], ["a deactivated Staff seat", STAFFCUT.token]] as const) {
        const seen = await call("POST", url, {}, token);
        check(`45b. ${url}: ${who} is refused`, refused(seen), `${seen.s}`);
      }
      for (const [who, token] of [["an editor", EDITOR.token], ["the owner", OWNER.token], ["a Staff seat with edit on VeritaStaff", STAFFEDIT.token], ["a Staff seat with edit on VeritaComp", COMPEDIT.token]] as const) {
        const seen = await call("POST", url, {}, token);
        check(`45c. ${url}: ${who} still generates it`, seen.s === 200 && !!seen.j.token, `${seen.s} ${text(seen).slice(0, 160)}`);
      }
    }

    noSpecialtyRole(annId);
    for (const url of [`${L}/staff/cms209-readiness`, `/api/staff/cms209-readiness`]) {
      const annGaps = await asAnn(url);
      check(`46a. ${url}: only their own gap, and no coworker's name`, annGaps.s === 200 && annGaps.j.ownOnly === true && annGaps.j.gaps?.length === 1 && annGaps.j.gaps[0].employeeId === annId && clean(annGaps), text(annGaps).slice(0, 200));
      for (const [who, token] of [["an editor", EDITOR.token], ["a Staff seat with edit on VeritaStaff", STAFFEDIT.token], ["a Staff seat with edit on VeritaComp", COMPEDIT.token]] as const) {
        const seen = await call("GET", url, undefined, token);
        check(`46b. ${url}: ${who} sees every gap`, seen.s === 200 && seen.j.ownOnly === false && seen.j.gaps?.some((g: any) => g.employeeId === zorkId) && seen.j.gaps?.some((g: any) => g.employeeId === annId), `${seen.s} ${text(seen).slice(0, 160)}`);
      }
      for (const [who, token] of [["no staff record linked", NOLINK.token], ["a deactivated Staff seat", STAFFCUT.token]] as const) {
        const seen = await call("GET", url, undefined, token);
        check(`46c. ${url}: ${who} sees no gaps, with no error`, seen.s === 200 && seen.j.gaps?.length === 0 && seesNobody(seen.j), `${seen.s} ${text(seen).slice(0, 160)}`);
      }
    }

    const inviteUrl = `${L}/staff-portal-invites`;
    const inviteAnn = await asAnn(inviteUrl);
    check("47a. Staff login list: only their own seat, not everyone's email", inviteAnn.s === 200 && inviteAnn.j.invites?.length === 1 && inviteAnn.j.invites[0].email === ANN.email && inviteAnn.j.invites[0].staff_employee_id === annId && clean(inviteAnn) && !text(inviteAnn).includes(BEN.email) && !text(inviteAnn).includes("zork-invite"), text(inviteAnn).slice(0, 240));
    for (const [who, token] of [["an editor", EDITOR.token], ["the owner", OWNER.token], ["a Staff seat with edit on VeritaStaff", STAFFEDIT.token], ["a Staff seat with edit on VeritaComp", COMPEDIT.token]] as const) {
      const seen = await call("GET", inviteUrl, undefined, token);
      check(`47b. Staff login list: ${who} sees everyone's`, seen.s === 200 && seen.j.invites?.length > 2 && text(seen).includes(ANN.email) && text(seen).includes("zork-invite"), `${seen.s} ${seen.j.invites?.length}`);
    }
    const inviteNoLink = await call("GET", inviteUrl, undefined, NOLINK.token);
    check("47c. Staff login list: a seat with no staff record sees only its own row", inviteNoLink.s === 200 && inviteNoLink.j.invites?.length === 1 && inviteNoLink.j.invites[0].email === NOLINK.email, text(inviteNoLink).slice(0, 200));
    const inviteCut = await call("GET", inviteUrl, undefined, STAFFCUT.token);
    check("47d. Staff login list: a deactivated Staff seat sees nobody", inviteCut.s === 200 && inviteCut.j.invites?.length === 0, text(inviteCut).slice(0, 200));

    const reminderUrl = `${L}/competency/reminder-config`;
    const reminderAnn = await asAnn(reminderUrl);
    check("48a. reminder settings name who gets the emails, so a Staff login is refused", refused(reminderAnn) && clean(reminderAnn), `${reminderAnn.s}`);
    const reminderStaffEdit = await call("GET", reminderUrl, undefined, STAFFEDIT.token);
    check("48b. edit on VeritaStaff doesn't open them", refused(reminderStaffEdit), `${reminderStaffEdit.s}`);
    for (const [who, token] of [["an editor", EDITOR.token], ["the owner", OWNER.token], ["a Staff seat with edit on VeritaComp", COMPEDIT.token]] as const) {
      const seen = await call("GET", reminderUrl, undefined, token);
      check(`48c. reminder settings: ${who} still reads them`, seen.s === 200 && seen.j.supervisor_recipients?.[0]?.name === "Zork Quillfeather", `${seen.s}`);
    }

    const scheduleAnn = await asAnn(`${L}/schedule/staff`);
    const scheduleEditor = await asEditor(`${L}/schedule/staff`);
    check("49. schedule names stay open: a Staff login gets the same list of who's working as an editor (Michael's decision)", scheduleAnn.s === 200 && scheduleAnn.j.length > 1 && text(scheduleAnn) === text(scheduleEditor), text(scheduleAnn).slice(0, 200));

    // ── VeritaCheck studies stay in the URL's lab: they match on the analyst's name, and the same name turns up in other labs ──
    const sisterLab = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, created_at, updated_at) VALUES ('Made-up Sister Lab', ?, ?, ?)").run(OWNER.id, now, now).lastInsertRowid);
    studyBy("Self, Ann", "CROSS other customer", lab2, OWNER2.id);
    studyBy("Ann Self", "CROSS sister lab", sisterLab, OWNER.id);
    studyBy("Self, Ann", "CROSS no lab owner two", null, OWNER2.id);
    studyBy("Self, Ann", "CROSS no lab no owner", null, null);
    studyBy("Self, Ann", "NOLAB owner one", null, OWNER.id);
    const studyNames = (r: { j: any }) => (r.j.studies || []).map((s: any) => s.test_name ?? s.testName).sort().join("|");
    const studiesOf = (emp: number, labPath = L) => `${labPath}/staff/employees/${emp}/veritacheck-studies`;
    const ownerReads = await call("GET", studiesOf(annId), undefined, OWNER.token);
    check("50a. owner: this lab's study and their own no-lab study, nothing from another customer or their sister lab", ownerReads.s === 200 && studyNames(ownerReads) === "Ann own study|NOLAB owner one" && ownerReads.j.counts?.total === 2, `${ownerReads.s} ${studyNames(ownerReads)} ${ownerReads.j.counts?.total}`);
    const editorReads = await asEditor(studiesOf(annId));
    check("50b. editor: this lab's study only", editorReads.s === 200 && studyNames(editorReads) === "Ann own study" && editorReads.j.counts?.total === 1, `${editorReads.s} ${studyNames(editorReads)}`);
    const annReads = await asAnn(studiesOf(annId));
    check("50c. a Staff login's own read: this lab's study only", annReads.s === 200 && studyNames(annReads) === "Ann own study" && annReads.j.counts?.total === 1, `${annReads.s} ${studyNames(annReads)}`);
    const otherOwnerReads = await call("GET", studiesOf(annLab2, L2), undefined, OWNER2.token);
    check("50d. the other customer's owner: their lab's study and their own no-lab study, none of the first lab's", otherOwnerReads.s === 200 && studyNames(otherOwnerReads) === "CROSS no lab owner two|CROSS other customer" && otherOwnerReads.j.counts?.total === 2, `${otherOwnerReads.s} ${studyNames(otherOwnerReads)}`);
    const annInLab2 = await asAnn(studiesOf(annLab2, L2));
    // ── The members list (Michael Q192 = 1) ───────────────────────────────────
    const membersUrl = `${L}/members`;
    sqlite.prepare("UPDATE labs SET medical_director_email = ?, medical_director_name = 'Made Up Director' WHERE id = ?").run(`director-${stamp}@example.test`, labId);
    const memberEmails = (r: { j: any }) => (r.j.members || []).map((m: any) => m.email);
    const annMembers = await asAnn(membersUrl);
    check("51a. members: a Staff login gets its own row and nobody else's", annMembers.s === 200 && annMembers.j.ownOnly === true && memberEmails(annMembers).join() === ANN.email && !text(annMembers).includes(BEN.email) && !text(annMembers).includes(EDITOR.email) && !text(annMembers).includes(OWNER.email), text(annMembers).slice(0, 240));
    check("51b. members: no pending invitations, no seat counts and no director's name for a Staff login", annMembers.j.pendingInvites?.length === 0 && annMembers.j.seatLimits === null && annMembers.j.seatCounts === null && annMembers.j.staffPortal === null && annMembers.j.medicalDirector === null && !text(annMembers).includes("zork-invite") && !text(annMembers).includes("Made Up Director") && clean(annMembers));
    for (const [who, token] of [["an editor", EDITOR.token], ["the owner", OWNER.token], ["a Staff seat with edit on VeritaStaff", STAFFEDIT.token], ["a Staff seat with edit on VeritaComp", COMPEDIT.token], ["a lab admin who also holds a Staff seat", ADMINSEAT.token]] as const) {
      const seen = await call("GET", membersUrl, undefined, token);
      check(`51c. members: ${who} still gets the whole list`, seen.s === 200 && seen.j.ownOnly === false && memberEmails(seen).includes(ANN.email) && memberEmails(seen).includes(BEN.email) && text(seen).includes("zork-invite") && !!seen.j.seatCounts && seen.j.medicalDirector?.name === "Made Up Director", `${seen.s} ${memberEmails(seen).length}`);
    }
    // Their owner pickers and assign list need the names.
    for (const [who, perms] of [["VeritaScan", '{"mode":"view_all","overrides":{"veritascan":"edit"}}'], ["VeritaDC", '{"mode":"view_all","overrides":{"veritapolicy":"edit"}}']] as const) {
      const PICKER = await register(`Picker${who}`);
      member(labId, PICKER.id); seat(OWNER.id, labId, PICKER, "staff_portal", perms, await person("Picks", who, [ANALYZER]));
      const seen = await call("GET", membersUrl, undefined, PICKER.token);
      check(`51d. members: a Staff seat with edit on ${who} keeps the names its pickers need`, seen.s === 200 && seen.j.ownOnly === false && memberEmails(seen).includes(BEN.email), `${seen.s}`);
    }
    const otherEdit = await register("Otheredit");
    member(labId, otherEdit.id); seat(OWNER.id, labId, otherEdit, "staff_portal", '{"mode":"view_all","overrides":{"veritatrack":"edit"}}', await person("Tracks", "Other", [ANALYZER]));
    const otherEditSeen = await call("GET", membersUrl, undefined, otherEdit.token);
    check("51e. members: edit on a module that doesn't pick from this list doesn't open it", otherEditSeen.j.ownOnly === true && memberEmails(otherEditSeen).join() === otherEdit.email, text(otherEditSeen).slice(0, 160));
    const noLinkMembers = await call("GET", membersUrl, undefined, NOLINK.token);
    check("51f. members: a Staff seat with no staff record linked still gets its own row", noLinkMembers.s === 200 && noLinkMembers.j.ownOnly === true && memberEmails(noLinkMembers).join() === NOLINK.email, text(noLinkMembers).slice(0, 160));
    const cutMembers = await call("GET", membersUrl, undefined, STAFFCUT.token);
    check("51g. members: a deactivated Staff seat that still has a membership gets only its own row", cutMembers.s === 200 && cutMembers.j.ownOnly === true && memberEmails(cutMembers).join() === STAFFCUT.email, text(cutMembers).slice(0, 160));
    const DIRECTOR = await register("Directorstaff");
    member(labId, DIRECTOR.id); seat(OWNER.id, labId, DIRECTOR, "staff_portal", '{"mode":"view_all"}', await person("Director", "Dana", [ANALYZER]));
    sqlite.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(DIRECTOR.email, labId);
    const directorMembers = await call("GET", membersUrl, undefined, DIRECTOR.token);
    check("51h. members: a Staff login who is the director still sees their own badge", directorMembers.j.ownOnly === true && directorMembers.j.medicalDirector?.email === DIRECTOR.email, text(directorMembers).slice(0, 160));
    sqlite.prepare("UPDATE labs SET medical_director_email = NULL, medical_director_name = NULL WHERE id = ?").run(labId);

    check("50e. the same person's Staff seat in the other lab: that lab's study only", annInLab2.s === 200 && studyNames(annInLab2) === "CROSS other customer", `${annInLab2.s} ${studyNames(annInLab2)}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
