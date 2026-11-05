// tests/integration/competency-waived-specimens.test.ts
//
// STANDING integration test for two RFGH requests (Cathy Thornton, 2026-11-04):
//   1. Waived blind specimen testing takes more than one specimen, on the person page and on the program form. The method passes only when every specimen passed, the first
//      specimen stays in the old columns so older readers keep working, and a method saved the old way still works.
//   2. A non-technical assessment can be a 6-Month or an Annual.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:competency-waived-specimens

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { waivedEvidenceText, waivedSpecimensFromRow } from "../../shared/competencyWaivedSpecimens";
import { assessmentTypeLabel } from "../../shared/competencyEvaluation";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Waiv", "chk", "77!"].join("-");
  const now = new Date().toISOString();
  const day = "2026-10-15";
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  try {
    const email = `waived-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Owner", hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Waived Lab", plan: "hospital", isWarehouse: true });
    const labId = prov.body.labId as number, token = reg.body.token as string, userId = Number(reg.body.user?.id);
    const L = `/api/labs/${labId}`;
    const staffLab = (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(labId) as any)?.id
      ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Waived Lab', '22D0000777', ?, ?, ?)").run(userId, labId, now, now).lastInsertRowid);
    const map = await call("POST", `${L}/veritamap/maps`, { name: "POC" }, token);
    await call("POST", `${L}/veritamap/maps/${map.body.id}/instruments`, { instrument_name: "Made-up meter", role: "Primary", category: "Point of Care", serial_number: "M1" }, token);
    const inst = Number((sqlite.prepare("SELECT id FROM veritamap_instruments WHERE map_id = ?").get(map.body.id) as any).id);
    await call("PUT", `${L}/veritamap/maps/${map.body.id}/instruments/${inst}/tests`, { tests: [{ analyte: "Made-up glucose", specialty: "General Chemistry", complexity: "WAIVED", active: 1 }] }, token);
    const emp = Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, title, hire_date, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, 'Tester', 'Tia', 'MLT', '2020-01-06', 1, 'active', ?, ?)"
    ).run(staffLab, labId, userId, now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at, created_by_user_id) VALUES (?, ?, ?, ?)").run(emp, inst, now, userId);
    const put = (body: any) => call("PUT", `${L}/competency/employee/${emp}/test-system/${inst}`, body, token);
    const method1 = async () => {
      const v = (await call("GET", `${L}/competency/employee/${emp}`, undefined, token)).body;
      const ts = (v.testSystems || []).find((t: any) => t.instrumentId === inst || t.id === inst);
      return ts?.waivedMethods?.[0];
    };
    const row1 = () => sqlite.prepare("SELECT * FROM competency_assessment_items WHERE instrument_id = ? AND waived_method_number = 1 ORDER BY id DESC LIMIT 1").get(inst) as any;
    const pass = (evidence: string, passed = true) => ({ evidence, date: day, initials: "MU", passed });

    // 1. The person page
    const saved = await put({ waivedMethods: [{ num: 1, specimens: [pass("BS-1 glucose 92"), pass("BS-2 glucose 180")] }] });
    check("1. two specimens save", saved.status === 200, `HTTP ${saved.status} ${saved.body.error ?? ""}`);
    let m = await method1();
    check("1. both come back", m?.specimens?.length === 2 && m.specimens[1].evidence === "BS-2 glucose 180", JSON.stringify(m?.specimens));
    check("1. every specimen passed, so the method passes", m?.status === "pass" && m?.passed === true, m?.status);
    check("1. the first stays in the old columns", row1().waived_evidence === "BS-1 glucose 92" && row1().waived_date === day && row1().waived_initials === "MU" && row1().passed === 1);
    await put({ waivedMethods: [{ num: 1, specimens: [pass("BS-1 glucose 92"), pass("BS-2 glucose 180", false)] }] });
    m = await method1();
    check("1. one specimen not passed means the method isn't", m?.status === "needs_review" && m?.passed === false && m?.specimens?.[1]?.passed === false && m?.specimens?.[0]?.passed === true, JSON.stringify({ s: m?.status, list: m?.specimens?.map((x: any) => x.passed) }));
    await put({ waivedMethods: [{ num: 1, specimens: [pass("BS-1 only")] }] });
    check("1. one specimen stores no list, the same as before", row1().waived_specimens_json === null && row1().waived_evidence === "BS-1 only");
    await put({ waivedMethods: [{ num: 1, specimens: [pass("BS-1"), { evidence: "", date: "", initials: "", passed: false }, pass("BS-3")] }] });
    check("1. a blank row is dropped", (await method1())?.specimens?.length === 2);
    const noDate = await put({ waivedMethods: [{ num: 1, specimens: [pass("BS-1"), { evidence: "BS-2", date: "", initials: "MU", passed: true }] }] });
    check("1. a passed specimen needs its date", noDate.status === 400 && /date each passed specimen/.test(noDate.body.error), `HTTP ${noDate.status}`);
    await put({ waivedMethods: [{ num: 1, evidence: "Old way", date: day, initials: "MU", passed: true }] });
    m = await method1();
    check("1. a method saved the old way still works", m?.status === "pass" && m?.evidence === "Old way" && m?.specimens?.length === 1, JSON.stringify(m?.specimens));
    await put({ waivedMethods: [{ num: 2, evidence: "Observed", date: day, initials: "MU", passed: true, specimens: [pass("ignored")] }] });
    const row2 = sqlite.prepare("SELECT * FROM competency_assessment_items WHERE instrument_id = ? AND waived_method_number = 2 ORDER BY id DESC LIMIT 1").get(inst) as any;
    check("1. only blind specimen testing takes a list", row2.waived_evidence === "Observed" && row2.waived_specimens_json === null, JSON.stringify(row2.waived_evidence));

    // What a printed record and a signed set say
    const text = waivedEvidenceText({ waived_evidence: "BS-1", waived_date: day, waived_initials: "MU", passed: 0, waived_specimens_json: JSON.stringify([pass("BS-1"), pass("BS-2", false)]) });
    check("1. the record spells out each specimen", text === "Specimen 1: BS-1, Pass, 10/15/2026, MU; Specimen 2: BS-2, Not passed, 10/15/2026, MU", text);
    check("1. one specimen prints as it always did", waivedEvidenceText({ waived_evidence: "BS-1", waived_specimens_json: null }) === "BS-1");
    check("1. an edit to the columns isn't shadowed by the list", waivedSpecimensFromRow({ waived_evidence: "Edited", waived_date: day, waived_initials: "MU", passed: 0, waived_specimens_json: JSON.stringify([pass("Old"), pass("BS-2")]) })[0].evidence === "Edited");
    check("1. a malformed list reads as the one specimen", waivedSpecimensFromRow({ waived_evidence: "BS-1", passed: 1, waived_specimens_json: "{not json" }).length === 1);

    // 1. The program form
    const compEmp = (await call("POST", `${L}/competency/employees`, { name: "Casey Tech", title: "MLT", hireDate: "2020-01-05" }, token)).body.id;
    const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up waived program", department: "Point of Care", type: "waived" }, token)).body.id;
    const item = (specimens: any[], passedClaim = true) => ({ methodNumber: 1, waivedMethodNumber: 1, waivedEvidence: specimens[0]?.evidence, waivedDate: day, waivedInitials: "MU", passed: passedClaim, waivedSpecimens: specimens });
    const made = await call("POST", `${L}/competency/assessments`, { programId: prog, employeeId: compEmp, assessmentType: "annual", assessmentDate: day, evaluatorName: "Made Up", items: [item([pass("BS-1"), pass("BS-2", false)])] }, token);
    check("1. the program form saves specimens", [200, 201].includes(made.status), `HTTP ${made.status} ${made.body.error ?? ""}`);
    const progRow = () => sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ? AND waived_method_number = 1").get(made.body.id) as any;
    check("1. the server decides the pass, not the request", progRow().passed === 0, String(progRow().passed));
    check("1. and keeps the whole list", JSON.parse(progRow().waived_specimens_json || "[]").length === 2);
    const edited = await call("PUT", `${L}/competency/assessments/${made.body.id}`, { items: [item([pass("BS-9")])] }, token);
    check("1. saving one specimen clears the list", edited.status === 200 && progRow().waived_specimens_json === null && progRow().waived_evidence === "BS-9" && progRow().passed === 1, `HTTP ${edited.status}`);
    const edited2 = await call("PUT", `${L}/competency/assessments/${made.body.id}`, { items: [item([pass("BS-1"), pass("BS-2")])] }, token);
    check("1. editing back to two keeps both", edited2.status === 200 && waivedSpecimensFromRow(progRow()).length === 2 && progRow().passed === 1);

    // A signed set spells out every specimen, which is what the record PDF prints
    const gs = (await call("POST", `${L}/staff/employees`, { lastName: "Ellis", firstName: "Jordan", highestComplexity: "H", roles: [{ role: "GS" }] }, token)).body.id;
    await put({ waivedMethods: [{ num: 1, specimens: [pass("BS-1 glucose 92"), pass("BS-2 glucose 180")] }, { num: 3, evidence: "QC run", date: day, initials: "MU", passed: true }] });
    const sign = await call("POST", `${L}/competency/employee/${emp}/test-system/${inst}/sign`, { signerStaffEmployeeId: gs, signerInitials: "JE" }, token);
    check("1. two methods passed, one with two specimens, can be signed", sign.status === 200, `HTTP ${sign.status} ${JSON.stringify(sign.body).slice(0, 160)}`);
    const signedView = (await call("GET", `${L}/competency/employee/${emp}`, undefined, token)).body;
    const signedTs = (signedView.testSystems || []).find((t: any) => t.instrumentId === inst || t.id === inst);
    const signedM1 = signedTs?.lastSignoff?.waivedMethods?.find((x: any) => x.num === 1);
    check("1. the signed set lists every specimen", /Specimen 1: BS-1 glucose 92/.test(signedM1?.evidence || "") && /Specimen 2: BS-2 glucose 180/.test(signedM1?.evidence || ""), JSON.stringify(signedM1?.evidence));
    const emptyAgain = await method1();
    check("1. the next competency starts empty", !emptyAgain?.evidence && !emptyAgain?.specimens, JSON.stringify(emptyAgain?.specimens));

    // 2. Non-technical
    const nt = (await call("POST", `${L}/competency/programs`, { name: "Made-up non-technical", department: "Phlebotomy", type: "nontechnical", checklistItems: [{ description: "Made-up item" }] }, token)).body.id;
    for (const type of ["6month", "annual"]) {
      const a = await call("POST", `${L}/competency/assessments`, { programId: nt, employeeId: compEmp, assessmentType: type, assessmentDate: day, evaluatorName: "Made Up", items: [] }, token);
      const saved2 = sqlite.prepare("SELECT assessment_type FROM competency_assessments WHERE id = ?").get(a.body.id) as any;
      check(`2. a non-technical ${assessmentTypeLabel(type)} saves`, [200, 201].includes(a.status) && saved2?.assessment_type === type, `HTTP ${a.status} ${a.body.error ?? ""}`);
    }
    check("2. they read properly", assessmentTypeLabel("6month") === "6-Month" && assessmentTypeLabel("annual") === "Annual");
    const cols = (sqlite.prepare("PRAGMA table_info(competency_assessment_items)").all() as any[]).map((c) => c.name);
    check("boot adds the column", cols.includes("waived_specimens_json"));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
