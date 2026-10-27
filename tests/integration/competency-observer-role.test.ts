// tests/integration/competency-observer-role.test.ts
//
// BUG-075 (Michael Q35 = 1, 2026-10-27): the Element 1 / 4 observer must be one of the lab's Laboratory Director,
// Technical Consultant or Technical Supervisor people in VeritaStaff, and every save path refuses anyone else on a new
// or changed value; a value already saved on the record is left alone (records moved over from paper keep their
// history). Scratch DB, made-up people.
// This pins:
//   1. the observer list: LD/TC/TS only (a GS is not on it), people who have left listed last with active false
//   2. the person page save (per-method PUT): a GS refused with nothing written; a TC (any case or punctuation), a
//      person who has left, and first + last initials of someone with a middle initial all save; N/A skips the check
//   3. an unmatched value saved before the check re-saves unchanged, and changing it to another unmatched value is refused
//   4. the program-assessment routes (lab-scoped POST / PUT and the legacy POST / PUT) follow the same rule
// Run: npm run test:competency-observer-role

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { observerProblem } from "../../server/competencyObserver";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };

  try {
    // 0. pure rule
    const obs = [{ employeeId: 1, name: "Chen, Morgan Q.", initials: "MQC", roles: ["LD"], active: true }];
    check("0. pure rule: full and first + last initials pass, others refused, kept values pass",
      observerProblem(obs, [{ element: 1, value: "m.q.c." }, { element: 4, value: "mc" }]) === null
      && /Element 4 observer "ZZ"/.test(observerProblem(obs, [{ element: 4, value: "ZZ" }]) || "")
      && observerProblem(obs, [{ element: 1, value: "ZZ" }], ["zz"]) === null
      && observerProblem(obs, [{ element: 1, value: "" }, { element: 1, value: null }]) === null);

    const email = `it-observer-${Date.now()}@example.com`;
    const owner = (await call("POST", "/api/auth/register", { email, password: ["Zq", "obs", "7x!"].join("-"), name: "IT Observer", hipaa_acknowledged: true })).j;
    const tk = owner.token;
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Observer Lab", plan: "hospital" })).j.labId);
    const L = `/api/labs/${labId}`;
    await call("POST", `${L}/staff/lab`, { labName: "Observer Lab", cliaNumber: "11D7654375", accreditationBody: "CLIA_ONLY", complexity: "high" }, tk, labId);
    const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, tk, labId)).j.id;
    await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
      { name: "Mini i-Sed", category: "Hematology", tests: [{ analyte: "Sed Rate", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
    ] });
    const SED = Number((sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = 'Mini i-Sed' AND map_id = ?").get(mapId) as any)?.id);
    const now = new Date().toISOString(); const today = now.slice(0, 10);
    const mk = async (body: any) => Number((await call("POST", `${L}/staff/employees`, body, tk, labId)).j.id);
    const tech = await mk({ lastName: "Reyes", firstName: "Ana", highestComplexity: "M", performsTesting: true, hireDate: "2020-01-06" });
    sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(tech, SED, now);
    const tc = await mk({ lastName: "Tate", firstName: "Casey", highestComplexity: "H", roles: [{ role: "TC", specialtyNumber: 8 }] });
    const gs = await mk({ lastName: "Ellis", firstName: "Jordan", highestComplexity: "H", roles: [{ role: "GS" }] });
    const ld = await mk({ lastName: "Chen", firstName: "Morgan", middleInitial: "Q", highestComplexity: "H", roles: [{ role: "LD" }] });
    const former = await mk({ lastName: "Brooks", firstName: "Taylor", highestComplexity: "H", roles: [{ role: "TS", specialtyNumber: 8 }] });
    sqlite.prepare("UPDATE staff_employees SET status = 'terminated', terminated_at = ? WHERE id = ?").run(now, former);
    check("0b. fixture: one moderate system, a tech, a TC, a GS, an LD with a middle initial, a TS who has left",
      SED > 0 && [tech, tc, gs, ld, former].every((x) => x > 0));

    // 1. observer list
    const list = (await call("GET", `${L}/staff/qualified-observers`, undefined, tk, labId)).j as any[];
    const ini = (list || []).map((o) => `${o.initials}${o.active ? "" : "*"}`).join(",");
    check("1. observer list: LD/TC/TS only, the person who left listed last as not active", ini === "MQC,CT,TB*", ini);

    // 2. person page save
    const els = (o1: any, o4: any, extra: any = {}) => [
      { num: 1, specimenId: "S-100", observerInitials: o1, passed: true, ...(extra[1] || {}) },
      { num: 2, evidence: "LIS result review", date: today, passed: true },
      { num: 3, qcDate: today, passed: true },
      { num: 4, dateObserved: today, observerInitials: o4, passed: true, ...(extra[4] || {}) },
      { num: 5, sampleType: "PT", sampleId: "PT-1", acceptable: true, passed: true },
      { num: 6, quizId: "Q-1", score: 100, dateTaken: today, passed: true },
    ];
    const put = (elements: any[]) => call("PUT", `${L}/competency/employee/${tech}/test-system/${SED}`, { elements }, tk, labId);
    const itemsBefore = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM competency_assessment_items").get() as any).n);
    const r2a = await put(els("JE", "CT"));
    const itemsAfter = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM competency_assessment_items").get() as any).n);
    check("2a. a GS as the Element 1 observer is refused, nothing written",
      r2a.s === 400 && /Element 1 observer "JE" is not a Laboratory Director, Technical Consultant or Technical Supervisor in VeritaStaff/.test(r2a.j.error || "") && itemsAfter === itemsBefore,
      `${r2a.s} ${r2a.j.error} items ${itemsBefore}->${itemsAfter}`);
    const r2b = await put(els("c.t.", "TB"));
    check("2b. a TC (lower case, dots) and a TS who has left both save", r2b.s === 200, `${r2b.s} ${r2b.j.error || ""}`);
    const r2c = await put(els("MC", "MQC"));
    check("2c. the LD saves under first + last and under full initials", r2c.s === 200, `${r2c.s} ${r2c.j.error || ""}`);
    const r2d = await put(els("CT", "JE", { 4: { na: true, naJustification: "No maintenance on this system" } }));
    check("2d. an N/A element is not checked", r2d.s === 200, `${r2d.s} ${r2d.j.error || ""}`);

    // 3. a value saved before the check (made-up "ZZ", as a moved-over record would carry) stays; changing it is checked
    sqlite.prepare(
      "UPDATE competency_assessment_items SET el1_observer_initials = 'ZZ' WHERE instrument_id = ? AND element_number = 1 AND signoff_id IS NULL"
    ).run(SED);
    const r3a = await put(els("ZZ", "CT", { 1: { specimenId: "S-101" } }));
    check("3a. an observer already on the record re-saves unchanged while other fields change", r3a.s === 200, `${r3a.s} ${r3a.j.error || ""}`);
    const r3b = await put(els("YY", "CT"));
    check("3b. changing it to another unmatched observer is refused", r3b.s === 400 && /"YY"/.test(r3b.j.error || ""), `${r3b.s} ${r3b.j.error}`);

    // 4. program-assessment routes
    const programId = Number((await call("POST", `${L}/competency/programs`, { name: "Hematology", department: "Hematology", type: "technical" }, tk, labId)).j.id);
    const item = (o1: string, o4: string) => [{ methodNumber: 1, elementNumber: 1, itemLabel: "Mini i-Sed", el1SpecimenId: "S-1", el1ObserverInitials: o1, el4DateObserved: today, el4ObserverInitials: o4, passed: true }];
    const aBefore = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM competency_assessments").get() as any).n);
    const r4a = await call("POST", `${L}/competency/assessments`, { programId, staffEmployeeId: tech, assessmentType: "initial", assessmentDate: today, items: item("CT", "JE") }, tk, labId);
    const aAfter = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM competency_assessments").get() as any).n);
    check("4a. lab POST: a GS as the Element 4 observer is refused, no record created",
      r4a.s === 400 && /Element 4 observer "JE"/.test(r4a.j.error || "") && aAfter === aBefore, `${r4a.s} ${r4a.j.error} ${aBefore}->${aAfter}`);
    const r4b = await call("POST", `${L}/competency/assessments`, { programId, staffEmployeeId: tech, assessmentType: "initial", assessmentDate: today, items: item("CT", "MQC") }, tk, labId);
    const aid = Number(r4b.j.id);
    check("4b. lab POST: qualified observers save", (r4b.s === 200 || r4b.s === 201) && aid > 0, `${r4b.s} ${r4b.j.error || ""}`);
    const r4c = await call("PUT", `${L}/competency/assessments/${aid}`, { items: item("JE", "MQC") }, tk, labId);
    check("4c. lab PUT: changing an observer to a GS is refused", r4c.s === 400 && /"JE"/.test(r4c.j.error || ""), `${r4c.s} ${r4c.j.error}`);
    sqlite.prepare("UPDATE competency_assessment_items SET el1_observer_initials = 'ZZ' WHERE assessment_id = ?").run(aid);
    const r4d = await call("PUT", `${L}/competency/assessments/${aid}`, { items: item("ZZ", "MQC") }, tk, labId);
    check("4d. lab PUT: an observer already on the record re-saves unchanged", r4d.s === 200, `${r4d.s} ${r4d.j.error || ""}`);

    // Legacy (no active lab) routes: the program's lab is used.
    const compEmp = Number((sqlite.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(tech, labId) as any)?.id);
    const r4e = await call("POST", `/api/competency/assessments`, { programId, employeeId: compEmp, assessmentType: "initial", assessmentDate: today, items: item("JE", "CT") }, tk);
    check("4e. legacy POST: a GS is refused", r4e.s === 400 && /"JE"/.test(r4e.j.error || ""), `${r4e.s} ${r4e.j.error}`);
    const r4f = await call("POST", `/api/competency/assessments`, { programId, employeeId: compEmp, assessmentType: "initial", assessmentDate: today, items: item("CT", "TB") }, tk);
    const lid = Number(r4f.j.id);
    check("4f. legacy POST: qualified observers save", (r4f.s === 200 || r4f.s === 201) && lid > 0, `${r4f.s} ${r4f.j.error || ""}`);
    const r4g = await call("PUT", `/api/competency/assessments/${lid}`, { items: item("CT", "YY") }, tk);
    check("4g. legacy PUT: changing an observer to an unmatched value is refused", r4g.s === 400 && /"YY"/.test(r4g.j.error || ""), `${r4g.s} ${r4g.j.error}`);
    const r4h = await call("PUT", `/api/competency/assessments/${lid}`, { items: item("MC", "TB") }, tk);
    check("4h. legacy PUT: qualified observers save", r4h.s === 200, `${r4h.s} ${r4h.j.error || ""}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
