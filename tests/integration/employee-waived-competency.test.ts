// tests/integration/employee-waived-competency.test.ts
//
// Receipt for parking #91 and BUG-040 (2026-10-12, before the St. Charles demo).
//   #91: the VeritaComp employee page showed the six CLIA elements for an all-waived test system (a glucose
//        meter). A waived test system is assessed by two of four methods; it now shows and saves those.
//   BUG-040: the coverage map ("Competencies owed") read assessed records only through method groups, so a
//        record signed on the employee page (items keyed by instrument) never counted as assessed.
// Boots the REAL routes on a scratch DB and proves:
//   1. the view marks the meter waived with four methods and no elements; the moderate system keeps six elements
//   2. the meter refuses an element body, and a passed method with no date
//   3. one passed method leaves the meter incomplete and blocks its sign-off with a "1 of 2" message
//   4. two passed methods complete it; the rows carry no element or method number
//   5. signing both methods marks BOTH test systems assessed (and covered) on /competency/owed (BUG-040)
//      (per-method sign-off, 2026-10-13: each method is signed on its own by an eligible VeritaStaff signer)
//   6. the printed record and the Survey Bundle PDF show the waived methods; a waived-only record prints no
//      empty element tables
// Run (from bash): DB_PATH=.tmp-ewc.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/employee-waived-competency.test.ts
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
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch {}
    return { s: r.status, j };
  };
  const email = `ewc-${Date.now()}@example.com`;
  const owner = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Waived Page Owner", hipaa_acknowledged: true })).j;
  const tk = owner.token;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Waived Page Lab", plan: "hospital" })).j.labId;
  const L = `/api/labs/${labId}`;
  await call("POST", `${L}/staff/lab`, { labName: "Waived Page Lab", cliaNumber: "11D7654371", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, tk);
  const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, tk)).j.id;
  const t = (analyte: string, specialty: string, complexity: string) => ({ analyte, specialty, complexity, active: 1 });
  await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
    { name: "Nova StatStrip Glucose Hospital Meter", category: "Point of Care", tests: [t("Glucose", "General Chemistry", "WAIVED")] },
    { name: "Mini i-Sed", category: "Hematology", tests: [t("Sed Rate", "Hematology", "MODERATE")] },
  ] });
  const instId = (name: string) => (sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id = ?").get(name, mapId) as any)?.id;
  const NOVA = instId("Nova StatStrip Glucose Hospital Meter"), SED = instId("Mini i-Sed");
  const now = new Date().toISOString(); const today = now.slice(0, 10);
  const mkEmp = async (last: string, first: string, insts: number[]) => {
    const e = (await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, tk)).j;
    for (const i of insts) sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(e.id, i, now);
    return e.id as number;
  };
  const mixed = await mkEmp("Mixed", "Morgan", [NOVA, SED]);
  const meterOnly = await mkEmp("Meter", "Lee", [NOVA]);
  // Signers (per-method sign-off): a general supervisor for the waived meter, a hematology TC for the moderate i-Sed.
  const gs = (await call("POST", `${L}/staff/employees`, { lastName: "Ellis", firstName: "Jordan", highestComplexity: "H", roles: [{ role: "GS" }] }, tk)).j.id;
  const tc = (await call("POST", `${L}/staff/employees`, { lastName: "Tate", firstName: "Casey", highestComplexity: "H", roles: [{ role: "TC", specialtyNumber: 8 }] }, tk)).j.id;
  check("fixture: one waived meter, one moderate system, two people", !!NOVA && !!SED && !!mixed && !!meterOnly);

  const view = async (emp: number) => (await call("GET", `${L}/competency/employee/${emp}`, undefined, tk)).j;
  const tsOf = (v: any, id: number) => (v.testSystems || []).find((x: any) => x.instrumentId === id) || {};
  let v = await view(mixed);
  const nova0 = tsOf(v, NOVA), sed0 = tsOf(v, SED);
  check("1a. the meter is waived: four methods, no elements",
    nova0.waived === true && (nova0.waivedMethods || []).length === 4 && (nova0.elements || []).length === 0 && nova0.waivedMethods?.[0]?.name === "Blind specimen testing",
    JSON.stringify({ waived: nova0.waived, methods: (nova0.waivedMethods || []).length, elements: (nova0.elements || []).length }));
  check("1b. the moderate system keeps the six elements", !sed0.waived && (sed0.elements || []).length === 6, `${(sed0.elements || []).length}`);

  const put = (emp: number, inst: number, body: any) => call("PUT", `${L}/competency/employee/${emp}/test-system/${inst}`, body, tk);
  const r2a = await put(mixed, NOVA, { elements: [{ num: 1, specimenId: "S1", passed: true }] });
  check("2a. the meter refuses an element body", r2a.s === 400 && /waived/i.test(r2a.j.error || ""), `${r2a.s} ${r2a.j.error}`);
  const r2b = await put(mixed, NOVA, { waivedMethods: [{ num: 1, evidence: "Blind sample BS-1", passed: true }] });
  check("2b. a passed method needs its date", r2b.s === 400 && /date/i.test(r2b.j.error || ""), `${r2b.s} ${r2b.j.error}`);

  const r3 = await put(mixed, NOVA, { waivedMethods: [{ num: 1, evidence: "Blind sample BS-1 within limits", date: today, initials: "JE", passed: true }, { num: 2 }, { num: 3 }, { num: 4 }] });
  v = await view(mixed);
  check("3a. one passed method: 1 of 2, not complete", r3.s === 200 && tsOf(v, NOVA).waivedPassed === 1 && tsOf(v, NOVA).complete === false, `${r3.s} ${JSON.stringify({ p: tsOf(v, NOVA).waivedPassed, c: tsOf(v, NOVA).complete })}`);
  const sedEls = [
    { num: 1, specimenId: "S-100", observerInitials: "JE", passed: true },
    { num: 2, evidence: "LIS result review", date: today, passed: true },
    { num: 3, qcDate: today, passed: true },
    { num: 4, dateObserved: today, observerInitials: "JE", passed: true },
    { num: 5, sampleType: "PT", sampleId: "PT-1", acceptable: true, passed: true },
    { num: 6, quizId: "Q-1", score: 100, dateTaken: today, passed: true },
  ];
  const rSed = await put(mixed, SED, { elements: sedEls });
  const signMethod = (emp: number, inst: number, signer: number) => call("POST", `${L}/competency/employee/${emp}/test-system/${inst}/sign`, { signerStaffEmployeeId: signer, signerInitials: "JE" }, tk);
  const r3b = await signMethod(mixed, NOVA, gs);
  check("3b. the meter's sign-off is blocked at 1 of 2", rSed.s === 200 && r3b.s === 409 && (r3b.j.incomplete || []).some((x: string) => /Nova.*1 of 2 waived methods passed/.test(x)), `${rSed.s} ${r3b.s} ${JSON.stringify(r3b.j.incomplete)}`);

  const r4 = await put(mixed, NOVA, { waivedMethods: [
    { num: 1, evidence: "Blind sample BS-1 within limits", date: today, initials: "JE", passed: true },
    { num: 3, evidence: "QC run, both levels in range", date: today, initials: "JE", passed: true },
  ] });
  v = await view(mixed);
  const rows = sqlite.prepare("SELECT method_number, element_number, waived_method_number FROM competency_assessment_items WHERE instrument_id = ?").all(NOVA) as any[];
  check("4a. two passed methods complete the meter", r4.s === 200 && tsOf(v, NOVA).waivedPassed === 2 && tsOf(v, NOVA).complete === true, JSON.stringify(tsOf(v, NOVA).waivedMethods?.map((m: any) => m.status)));
  check("4b. waived rows carry no element or method number", rows.length === 2 && rows.every((r) => r.method_number == null && r.element_number == null && r.waived_method_number != null), JSON.stringify(rows));
  check("4c. the moderate system's elements are unchanged (all PASS)", (tsOf(v, SED).elements || []).every((e: any) => e.status === "pass") && tsOf(v, SED).complete === true);

  const owedFor = async (emp: number) => {
    const r = await call("GET", `${L}/competency/owed`, undefined, tk);
    const e = (r.j.employees || []).find((x: any) => x.employeeId === emp);
    return Object.fromEntries((e?.owed || []).map((o: any) => [o.instrumentName, o]));
  };
  let o = await owedFor(mixed);
  check("5a. before signing nothing reads assessed", Object.values(o).every((x: any) => x.assessed === false));
  const r5a = await signMethod(mixed, NOVA, gs), r5b = await signMethod(mixed, SED, tc);
  const r5 = { s: r5a.s === 200 && r5b.s === 200 ? 200 : Math.max(r5a.s, r5b.s) };
  o = await owedFor(mixed);
  check("5b. signing both methods marks BOTH test systems assessed and covered (BUG-040)",
    r5.s === 200 && o["Nova StatStrip Glucose Hospital Meter"]?.assessed === true && o["Mini i-Sed"]?.assessed === true && o["Nova StatStrip Glucose Hospital Meter"]?.covered === true && o["Mini i-Sed"]?.covered === true,
    `${r5.s} ${JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, x]: any) => [k, [x.covered, x.assessed, x.coverage?.methodGroupName]])))}`);
  const oOther = await owedFor(meterOnly);
  check("5c. another person's meter is not marked by this record", oOther["Nova StatStrip Glucose Hospital Meter"]?.assessed === false);

  v = await view(mixed);
  const recHtml = buildEmployeeCompetencyRecordHTML({ labName: "Waived Page Lab", cliaNumber: "11D7654371", employee: v.employee, elementCount: v.elementCount, testSystems: v.testSystems });
  check("6a. the printed record shows the waived methods for the meter and elements for the moderate system",
    /Waived testing: 2 of 2 required methods passed\./.test(recHtml) && /Blind specimen testing \(/.test(recHtml) && /Monitoring of QC performance \(/.test(recHtml) && /<th>El 6<\/th>/.test(recHtml));

  const pdfInput = (emp: number) => {
    const a = sqlite.prepare(
      `SELECT a.*, p.name as program_name, p.department, p.type as program_type, e.name as employee_name, e.title as employee_title
       FROM competency_assessments a JOIN competency_programs p ON a.program_id = p.id JOIN competency_employees e ON a.employee_id = e.id
       WHERE e.staff_employee_id = ? AND p.is_implicit = 1 ORDER BY a.id DESC LIMIT 1`).get(emp) as any;
    const items = sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ?").all(a.id);
    return { assessment: a, items, methodGroups: [], checklistItems: [], labName: "Waived Page Lab", quizResults: [], cliaNumber: "11D7654371", elementDocuments: [] } as any;
  };
  const mixedPdf = buildCompetencyHTML(pdfInput(mixed));
  check("6b. Survey Bundle PDF (mixed record): element tables plus the waived section and page-1 waived summary",
    mixedPdf.includes("Element 1: Direct Observation") && mixedPdf.includes("Waived Test Systems - 2 of 4 Methods Required Per Test") && mixedPdf.includes("Waived test system (2 of 4 methods)"));

  await put(meterOnly, NOVA, { waivedMethods: [
    { num: 2, evidence: "Observed by supervisor", date: today, initials: "JE", passed: true },
    { num: 4, evidence: "Written test 10/10", date: today, initials: "JE", passed: true },
  ] });
  const r6 = await signMethod(meterOnly, NOVA, gs);
  const meterPdf = buildCompetencyHTML(pdfInput(meterOnly));
  check("6c. Survey Bundle PDF (waived-only record): waived summary and detail, no empty element tables",
    r6.s === 200 && meterPdf.includes("Waived Test Systems - 2 of 4 Methods Required Per Test") && !meterPdf.includes("Element 1: Direct Observation") && /Periodic observation of routine work/.test(meterPdf),
    `${r6.s} waivedSection=${meterPdf.includes("Waived Test Systems - 2 of 4 Methods Required Per Test")} element1=${meterPdf.includes("Element 1: Direct Observation")} observation=${/Periodic observation of routine work/.test(meterPdf)}${meterPdf.includes("Element 1: Direct Observation") ? " ctx=" + meterPdf.slice(Math.max(0, meterPdf.indexOf("Element 1: Direct Observation") - 200), meterPdf.indexOf("Element 1: Direct Observation") + 40).replace(/\s+/g, " ") : ""}`);
  const vm = await view(meterOnly);
  const meterRec = buildEmployeeCompetencyRecordHTML({ labName: "Waived Page Lab", employee: vm.employee, elementCount: vm.elementCount, testSystems: vm.testSystems });
  check("6d. the waived-only printed record uses one Waived methods column", meterRec.includes("<th>Waived methods</th>") && !meterRec.includes("<th>El 1</th>"));

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
