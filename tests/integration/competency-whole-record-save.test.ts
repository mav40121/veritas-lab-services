// tests/integration/competency-whole-record-save.test.ts
//
// BUG-174 (Redington-Fairview 2026-11-17; Michael Q346 = 1). Scratch DB, made-up people, real routes. Pins:
//   1. saving a whole record from the program form (lab-scoped PUT and the older PUT) replaces only the form's own rows:
//      the person page's entries, a sign-off's frozen rows and a person-page waived row's specimens stay as they were
//   2. a record holding person-page entries isn't deleted from the record list (both DELETEs, 409 HOLDS_PERSON_PAGE_ENTRIES);
//      once those entries are cleared on the person page, and for a plain program record, the delete goes through
//   3. POST /api/admin/competency/restore-record-save puts back the rows one old-style save removed, exactly (same ids and
//      values): a dry run first, expectedTotal checked, one audit row, a rerun finds nothing; it skips an instrument the
//      person page has saved since and a revoked sign-off
//   4. GET /api/admin/competency/record-losses lists such saves and deleted records holding person-page rows, ids only
//   5. both admin routes refuse without the header, and bad audit ids are named
// Run: npm run test:competency-whole-record-save
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { logAudit } = await import("../../server/audit");
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
  const call = async (method: string, path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };
  const admin = (method: string, path: string, body?: unknown) => call(method, path, body, undefined, { "x-admin-secret": ADMIN });

  try {
    const email = `wr-owner-${stamp}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "WR Owner", hipaa_acknowledged: true });
    const tk = reg.j.token as string;
    const ownerId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Whole Record Lab", plan: "hospital" })).j.labId);
    const L = `/api/labs/${labId}`;
    await call("POST", `${L}/staff/lab`, { labName: "Whole Record Lab", cliaNumber: "11D7654391", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, tk);
    const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, tk)).j.id;
    const t = (analyte: string, complexity: string) => ({ analyte, specialty: "Hematology", complexity, active: 1 });
    await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
      { name: "Signed Analyzer", category: "Hematology", tests: [t("Analyte A", "MODERATE")] },
      { name: "Working Analyzer", category: "Hematology", tests: [t("Analyte B", "MODERATE")] },
      { name: "Second Analyzer", category: "Hematology", tests: [t("Analyte C", "MODERATE")] },
      { name: "Made-up Meter", category: "Point of Care", tests: [t("Glucose W", "WAIVED")] },
    ] });
    const instOf = (name: string) => Number((sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id = ?").get(name, mapId) as any)?.id);
    const A = instOf("Signed Analyzer"), B = instOf("Working Analyzer"), C = instOf("Second Analyzer"), W = instOf("Made-up Meter");
    const assign = (emp: number, list: number[]) => list.forEach((i) => sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(emp, i, now));
    const person = async (last: string, first: string, list: number[]) => {
      const id = Number((await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, tk)).j.id);
      assign(id, list);
      return id;
    };
    const pat = await person("Tester", "Pat", [A, B, W]);
    const kim = await person("Second", "Kim", [C]);
    const tc = Number((await call("POST", `${L}/staff/employees`, { lastName: "Tate", firstName: "Casey", highestComplexity: "H", roles: [{ role: "TC", specialtyNumber: 8 }] }, tk)).j.id);

    const entries = (marks: Record<number, any> = {}) => [
      { num: 1, specimenId: "S-1", observerInitials: "CT", ...marks[1] },
      { num: 2, evidence: "Reviewed", date: day, ...marks[2] },
      { num: 3, qcDate: day, ...marks[3] },
      { num: 4, dateObserved: day, observerInitials: "CT", ...marks[4] },
      { num: 5, samples: [{ sampleType: "PT", sampleId: "PT-1" }], ...marks[5] },
      { num: 6, quizId: "Q-1", score: 90, dateTaken: day, ...marks[6] },
    ];
    const allPass = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [n, { passed: true }]));
    const put = (emp: number, inst: number, body: any) => call("PUT", `${L}/competency/employee/${emp}/test-system/${inst}`, body, tk);
    const view = async (emp: number) => (await call("GET", `${L}/competency/employee/${emp}`, undefined, tk)).j;
    const tsOf = (v: any, id: number) => (v.testSystems || []).find((x: any) => x.instrumentId === id) || {};
    const rowsFor = (emp: number, inst: number) => sqlite.prepare(
      `SELECT i.* FROM competency_assessment_items i JOIN competency_assessments a ON a.id = i.assessment_id JOIN competency_employees ce ON ce.id = a.employee_id WHERE ce.staff_employee_id = ? AND i.instrument_id = ? ORDER BY i.id`
    ).all(emp, inst) as any[];
    const implicitOf = (emp: number) => Number((sqlite.prepare(
      `SELECT a.id FROM competency_assessments a JOIN competency_programs p ON p.id = a.program_id JOIN competency_employees ce ON ce.id = a.employee_id
        WHERE p.lab_id = ? AND p.is_implicit = 1 AND ce.staff_employee_id = ? ORDER BY a.id DESC LIMIT 1`
    ).get(labId, emp) as any)?.id);
    const formRows = (aid: number) => sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ? AND instrument_id IS NULL AND signoff_id IS NULL ORDER BY id").all(aid) as any[];
    const signedRows = (signoffId: number) => sqlite.prepare("SELECT * FROM competency_assessment_items WHERE signoff_id = ? ORDER BY id").all(signoffId) as any[];
    const formItems = (tag: string) => [
      ...[1, 2, 3, 4, 5, 6].map((el) => ({ methodNumber: el, methodGroupId: 900, elementNumber: el, methodGroupName: "Made-up Form Row", el1SpecimenId: el === 1 ? `${tag}-1` : undefined, passed: false })),
      { methodNumber: 1, waivedMethodNumber: 1, waivedEvidence: `${tag}-W`, waivedDate: day, waivedInitials: "MU", passed: true, waivedSpecimens: [{ evidence: `${tag}-BS-1`, date: day, initials: "MU", passed: true }, { evidence: `${tag}-BS-2`, date: day, initials: "MU", passed: true }] },
    ];

    // Pat: Signed Analyzer signed (frozen rows), Working Analyzer entered and unsigned, the meter's blind specimens entered.
    await put(pat, A, { elements: entries(allPass) });
    const signed = await call("POST", `${L}/competency/employee/${pat}/test-system/${A}/sign`, { fromPaper: true, paperLocation: "Made-up binder", signerStaffEmployeeId: tc, signerInitials: "CT", determination: "pass" }, tk);
    const signoffId = Number(signed.j.id ?? signed.j.signoffId ?? (sqlite.prepare("SELECT id FROM competency_method_signoffs WHERE staff_employee_id = ? AND instrument_id = ?").get(pat, A) as any)?.id);
    await put(pat, B, { elements: entries() });
    const pass = (evidence: string) => ({ evidence, date: day, initials: "MU", passed: true });
    const wSave = await put(pat, W, { waivedMethods: [{ num: 1, specimens: [pass("BS-1 made up"), pass("BS-2 made up")] }, { num: 2, evidence: "Made-up reference", date: day, initials: "MU", passed: true }] });
    const rec = implicitOf(pat);
    const bBefore = JSON.stringify(rowsFor(pat, B)), wBefore = JSON.stringify(rowsFor(pat, W)), aSignedBefore = JSON.stringify(signedRows(signoffId));
    check("0. fixture: a signed method, a working method, a waived method, one open record", rec > 0 && signed.s === 200 && signoffId > 0 && wSave.s === 200 && signedRows(signoffId).length === 6 && rowsFor(pat, B).length === 6 && rowsFor(pat, W).length >= 2,
      `rec ${rec} sign ${signed.s} ${signed.j.error ?? ""} so ${signoffId} w ${wSave.s} ${wSave.j.error ?? ""}`);

    // ── 1. The whole-record save ─────────────────────────────────────────────
    const scoped = await call("PUT", `${L}/competency/assessments/${rec}`, { evaluatorName: "Made Up", items: formItems("FORM1") }, tk);
    check("1a. the lab-scoped save goes through", scoped.s === 200, `${scoped.s} ${scoped.j.error ?? ""}`);
    check("1b. the working method's person-page rows are untouched (same ids, same values)", JSON.stringify(rowsFor(pat, B)) === bBefore);
    check("1c. the sign-off's frozen rows are untouched", JSON.stringify(signedRows(signoffId)) === aSignedBefore);
    check("1d. the meter's person-page rows keep their own blind specimens", JSON.stringify(rowsFor(pat, W)) === wBefore);
    const f1 = formRows(rec);
    check("1e. the form's own rows are the ones it sent", f1.length === 7 && f1.some((r) => r.el1_specimen_id === "FORM1-1") && f1.some((r) => String(r.waived_specimens_json || "").includes("FORM1-BS-2")), `${f1.length}`);
    let v = await view(pat);
    check("1f. the person page still reads its own entries, not the program rows", tsOf(v, B).fromLegacyProgram === false && tsOf(v, B).hasData === true && tsOf(v, B).elements.every((e: any) => e.status === "needs_review"), JSON.stringify({ l: tsOf(v, B).fromLegacyProgram, s: tsOf(v, B).elements?.map((e: any) => e.status) }));
    check("1g. the signed set still reads PASS on every element", (tsOf(v, A).lastSignoff?.elements || []).length === 6 && tsOf(v, A).lastSignoff.elements.every((e: any) => e.status === "pass"));
    const again = await call("PUT", `${L}/competency/assessments/${rec}`, { items: formItems("FORM2") }, tk);
    const f2 = formRows(rec);
    check("1h. a second save still replaces the form's own rows, and only those", again.s === 200 && f2.length === 7 && !f2.some((r) => r.el1_specimen_id === "FORM1-1") && f2.some((r) => r.el1_specimen_id === "FORM2-1") && JSON.stringify(rowsFor(pat, B)) === bBefore);
    const legacy = await call("PUT", `/api/competency/assessments/${rec}`, { items: formItems("FORM3") }, tk);
    check("1i. the older (unscoped) save keeps them too", legacy.s === 200 && JSON.stringify(rowsFor(pat, B)) === bBefore && JSON.stringify(signedRows(signoffId)) === aSignedBefore && JSON.stringify(rowsFor(pat, W)) === wBefore && formRows(rec).some((r) => r.el1_specimen_id === "FORM3-1"), `${legacy.s} ${legacy.j.error ?? ""}`);
    const statusOnly = await call("PUT", `${L}/competency/assessments/${rec}`, { evaluatorName: "Made Up Again" }, tk);
    check("1j. a save with no items leaves every row alone", statusOnly.s === 200 && formRows(rec).length === 7 && JSON.stringify(rowsFor(pat, B)) === bBefore);

    // ── 2. Deleting a record from the list ────────────────────────────────────
    await put(kim, C, { elements: entries() });
    const kimRec = implicitOf(kim);
    const del1 = await call("DELETE", `${L}/competency/assessments/${kimRec}`, undefined, tk);
    check("2a. a record holding person-page entries is refused (lab-scoped DELETE)", del1.s === 409 && del1.j.code === "HOLDS_PERSON_PAGE_ENTRIES" && del1.j.entries === 6 && /made on the person's own competency page/.test(del1.j.error), `${del1.s} ${del1.j.code} ${del1.j.entries}`);
    const del2 = await call("DELETE", `/api/competency/assessments/${kimRec}`, undefined, tk);
    check("2b. the older DELETE refuses the same way", del2.s === 409 && del2.j.code === "HOLDS_PERSON_PAGE_ENTRIES", `${del2.s} ${del2.j.code}`);
    check("2c. nothing was removed", rowsFor(kim, C).length === 6 && rowsFor(kim, C).every((r) => r.el1_specimen_id === "S-1" || r.element_number !== 1));
    const cleared = await put(kim, C, { elements: [] });
    const del3 = await call("DELETE", `${L}/competency/assessments/${kimRec}`, undefined, tk);
    check("2d. once the entries are cleared on the person page, the empty record deletes", cleared.s === 200 && del3.s === 200, `${cleared.s} ${del3.s} ${del3.j.error ?? ""}`);
    const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Program", department: "Hematology", type: "technical", methodGroups: [{ name: "Made-up Row", instruments: ["Second Analyzer"], analytes: [] }] }, tk)).j.id;
    const kimComp = Number((sqlite.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ?").get(kim) as any)?.id);
    const plain = (await call("POST", `${L}/competency/assessments`, { programId: prog, employeeId: kimComp, assessmentType: "annual", assessmentDate: day, evaluatorName: "Made Up", competencyType: "technical", status: "pass", items: formItems("PLAIN").slice(0, 6) }, tk)).j.id;
    const del4 = await call("DELETE", `${L}/competency/assessments/${plain}`, undefined, tk);
    check("2e. a plain program record (form rows only) still deletes", Number(plain) > 0 && del4.s === 200, `${plain} ${del4.s} ${del4.j.error ?? ""}`);
    const del5 = await call("DELETE", `${L}/competency/assessments/${rec}`, undefined, tk);
    check("2f. a record holding a sign-off's rows is refused too (by the sign-off rule or this one), and nothing goes", del5.s === 409 && ["ASSESSMENT_SIGNED", "HOLDS_PERSON_PAGE_ENTRIES"].includes(del5.j.code) && JSON.stringify(rowsFor(pat, B)) === bBefore && JSON.stringify(signedRows(signoffId)) === aSignedBefore, `${del5.s} ${del5.j.code}`);

    // ── 3. Restore from an old-style save ─────────────────────────────────────
    // What the save did before this fix: delete every row on the record, write the form's, log before and after.
    const oldStyleSave = (aid: number) => {
      const before = sqlite.prepare("SELECT * FROM competency_assessments WHERE id = ?").get(aid);
      const beforeItems = sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(aid);
      sqlite.prepare("DELETE FROM competency_assessment_items WHERE assessment_id = ?").run(aid);
      sqlite.prepare("INSERT INTO competency_assessment_items (assessment_id, method_number, method_group_id, element_number, el1_specimen_id, passed) VALUES (?, 1, 900, 1, 'OLD-FORM', 0)").run(aid);
      const afterItems = sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(aid);
      return logAudit({ userId: ownerId, ownerUserId: ownerId, module: "veritacomp", action: "update", entityType: "assessment", entityId: aid, entityLabel: "Pat Tester", before: { assessment: before, items: beforeItems }, after: { assessment: before, items: afterItems } });
    };
    const bRows = rowsFor(pat, B), wRows = rowsFor(pat, W), aRows = signedRows(signoffId);
    const audit1 = Number(oldStyleSave(rec));
    v = await view(pat);
    check("3a. fixture: the old-style save left the person page empty", rowsFor(pat, B).length === 0 && signedRows(signoffId).length === 0 && tsOf(v, B).hasData !== true, `${rowsFor(pat, B).length} ${signedRows(signoffId).length}`);
    const lossesBefore = await admin("GET", `/api/admin/competency/record-losses?labId=${labId}`);
    const loss1 = (lossesBefore.j.saves || []).find((s: any) => s.auditId === audit1);
    const lostExpected = bRows.length + wRows.length + aRows.length;
    check("4a. the loss sweep lists that save with its counts", lossesBefore.s === 200 && loss1 && loss1.lostRows === lostExpected && loss1.lostSignedRows === 6 && loss1.restorableNow === lostExpected && loss1.assessmentExists === true && loss1.labId === labId, JSON.stringify(loss1));
    check("4b. the earlier saves made with the fix lost nothing and aren't listed", (lossesBefore.j.saves || []).length === 1, `${(lossesBefore.j.saves || []).length}`);
    const json = JSON.stringify(lossesBefore.j);
    check("4c. no names or entry text in the sweep", !/Tester|Pat|Kim|Tate|Casey|S-1|Reviewed|BS-1 made up/.test(json));

    const dry = await admin("POST", "/api/admin/competency/restore-record-save", { auditId: audit1 });
    const gB = (dry.j.groups || []).find((g: any) => g.instrumentId === B && g.signoffId === null);
    const gS = (dry.j.groups || []).find((g: any) => g.signoffId === signoffId);
    check("3b. the dry run counts every row to put back, by method and by sign-off", dry.s === 200 && dry.j.dryRun === true && dry.j.total === lostExpected && gB?.action === "restore" && gB?.rows === 6 && gS?.action === "restore" && gS?.rows === 6 && dry.j.staffEmployeeId === pat && dry.j.assessmentId === rec, JSON.stringify({ s: dry.s, t: dry.j.total, g: dry.j.groups }));
    check("3c. the dry run writes nothing", rowsFor(pat, B).length === 0 && signedRows(signoffId).length === 0);
    const noCount = await admin("POST", "/api/admin/competency/restore-record-save", { auditId: audit1, dryRun: false });
    const wrong = await admin("POST", "/api/admin/competency/restore-record-save", { auditId: audit1, dryRun: false, expectedTotal: lostExpected - 1 });
    check("3d. apply without the dry run's total, or with another, is refused and writes nothing", noCount.s === 409 && noCount.j.code === "COUNT_CHANGED" && wrong.s === 409 && wrong.j.code === "COUNT_CHANGED" && rowsFor(pat, B).length === 0);
    const applied = await admin("POST", "/api/admin/competency/restore-record-save", { auditId: audit1, dryRun: false, expectedTotal: lostExpected });
    check("3e. apply restores every row", applied.s === 200 && applied.j.restored === lostExpected, `${applied.s} ${applied.j.restored} ${applied.j.error ?? ""}`);
    check("3f. the working method's rows are back exactly: same ids, same values", JSON.stringify(rowsFor(pat, B)) === JSON.stringify(bRows));
    check("3g. the sign-off's frozen rows and the meter's rows are back exactly", JSON.stringify(signedRows(signoffId)) === JSON.stringify(aRows) && JSON.stringify(rowsFor(pat, W)) === JSON.stringify(wRows));
    v = await view(pat);
    check("3h. the person page reads them again", tsOf(v, B).fromLegacyProgram === false && tsOf(v, B).elements.every((e: any) => e.status === "needs_review") && tsOf(v, A).lastSignoff.elements.every((e: any) => e.status === "pass") && (tsOf(v, W).waivedMethods?.[0]?.specimens || []).length === 2);
    const restoreAudit = sqlite.prepare("SELECT * FROM audit_log WHERE module = 'veritacomp' AND action = 'restore' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(String(rec)) as any;
    check("3i. one audit row records the restore, from the system, naming the audit it came from", !!restoreAudit && restoreAudit.user_id === 0 && String(restoreAudit.entity_label).includes(`#${audit1}`) && JSON.parse(restoreAudit.after_json).restoredItemIds.length === lostExpected);
    const rerun = await admin("POST", "/api/admin/competency/restore-record-save", { auditId: audit1 });
    check("3j. a second dry run finds nothing to put back", rerun.s === 200 && rerun.j.total === 0 && (rerun.j.groups || []).every((g: any) => g.action === "skip" && g.reason === "already_present"), JSON.stringify(rerun.j.groups));
    const lossesAfter = await admin("GET", `/api/admin/competency/record-losses?labId=${labId}`);
    check("4d. after the restore the sweep shows nothing left to restore for that save", (lossesAfter.j.saves || []).find((s: any) => s.auditId === audit1)?.restorableNow === 0);

    // Newer entries on the person page win; a revoked sign-off isn't brought back.
    const audit2 = Number(oldStyleSave(rec));
    await put(pat, B, { elements: entries({ 1: { specimenId: "NEWER" } }) });
    sqlite.prepare("UPDATE competency_method_signoffs SET revoked_at = ? WHERE id = ?").run(now, signoffId);
    const dry2 = await admin("POST", "/api/admin/competency/restore-record-save", { auditId: audit2 });
    const g2B = (dry2.j.groups || []).find((g: any) => g.instrumentId === B && g.signoffId === null);
    const g2S = (dry2.j.groups || []).find((g: any) => g.signoffId === signoffId);
    const g2W = (dry2.j.groups || []).find((g: any) => g.instrumentId === W && g.signoffId === null);
    check("3k. an instrument saved on the person page since is skipped", g2B?.action === "skip" && g2B?.reason === "newer_entries_on_person_page", JSON.stringify(g2B));
    check("3l. a revoked sign-off's rows are skipped", g2S?.action === "skip" && g2S?.reason === "signoff_revoked", JSON.stringify(g2S));
    check("3m. the rest is still put back", g2W?.action === "restore" && dry2.j.total === wRows.length, JSON.stringify({ w: g2W, t: dry2.j.total }));
    const applied2 = await admin("POST", "/api/admin/competency/restore-record-save", { auditId: audit2, dryRun: false, expectedTotal: dry2.j.total });
    check("3n. applying it leaves the newer entry alone", applied2.s === 200 && rowsFor(pat, B).some((r) => r.el1_specimen_id === "NEWER") && !rowsFor(pat, B).some((r) => r.el1_specimen_id === "S-1"), `${applied2.s}`);

    // Deleted records in the sweep (one made through the route above, one that held person-page rows before the guard).
    const deletedHolding = logAudit({ userId: ownerId, ownerUserId: ownerId, module: "veritacomp", action: "delete", entityType: "assessment", entityId: 99999, entityLabel: "-",
      before: { assessment: { id: 99999, program_id: (sqlite.prepare("SELECT program_id FROM competency_assessments WHERE id = ?").get(rec) as any).program_id, employee_id: kimComp, assessment_type: "initial", status: "pass" }, items: [{ id: 1, instrument_id: C, element_number: 1, el1_specimen_id: "GONE", passed: 0 }] } });
    const lossesDel = await admin("GET", `/api/admin/competency/record-losses?labId=${labId}`);
    const dPlain = (lossesDel.j.deletes || []).find((d: any) => d.assessmentId === Number(plain));
    const dHold = (lossesDel.j.deletes || []).find((d: any) => d.auditId === Number(deletedHolding));
    check("4e. a deleted plain program record is listed with no person-page rows", dPlain && dPlain.personPageRows === 0 && dPlain.programIsImplicit === false && dPlain.labId === labId, JSON.stringify(dPlain));
    check("4f. a deleted record that held person-page entries is listed with whose they were (ids only)", dHold && dHold.personPageRowsHoldingEntries === 1 && dHold.staffEmployeeId === kim && dHold.programIsImplicit === true && JSON.stringify(dHold.instrumentIdsWithEntries) === JSON.stringify([C]), JSON.stringify(dHold));
    check("4g. the totals count it", lossesDel.j.totals?.deletesHoldingPersonPageEntries === 1, JSON.stringify(lossesDel.j.totals));

    // ── 5. Guards ─────────────────────────────────────────────────────────────
    const noHeader1 = await call("GET", `/api/admin/competency/record-losses`);
    const noHeader2 = await call("POST", "/api/admin/competency/restore-record-save", { auditId: audit1 });
    check("5a. both admin routes refuse without the header", noHeader1.s === 403 && noHeader2.s === 403);
    const missing = await admin("POST", "/api/admin/competency/restore-record-save", { auditId: 987654321 });
    const notSave = await admin("POST", "/api/admin/competency/restore-record-save", { auditId: Number(deletedHolding) });
    const noId = await admin("POST", "/api/admin/competency/restore-record-save", {});
    check("5b. an unknown id, a non-save audit row and no id are each named", missing.s === 404 && missing.j.code === "AUDIT_NOT_FOUND" && notSave.s === 400 && notSave.j.code === "NOT_A_RECORD_SAVE" && noId.s === 400 && noId.j.code === "AUDIT_ID_REQUIRED", `${missing.s} ${notSave.s} ${noId.s}`);
  } catch (e: any) {
    failures++;
    console.log("FAIL  threw: " + (e?.stack || e));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main();
