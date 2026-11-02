// tests/integration/competency-cohort-technical.test.ts
//
// BUG-120 (Michael Q91 = 1, 2026-11-02): Cohort Sign-off wrote one locked record per person with no per-analyzer detail.
// The person page never reads such a record, so a technical cohort left everyone showing the Initial as due (reproduced
// on a scratch DB: 200 inserted 1, 0 items, 0 method sign-offs, person page unchanged). Technical competencies are
// signed on the person's page; Cohort Sign-off refuses a technical program. Scratch DB, made-up people. This pins:
//   1. preview on a technical program: a shared error saying where technical is signed, every row blocked
//   2. commit on a technical program: 400 shared_field_invalid, nothing written, the person page unchanged
//   3. a waived program and a non-technical program still commit (one record each)
// Run: npm run test:competency-cohort-technical

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { TECHNICAL_COHORT_MESSAGE } from "../../server/competencyCohortSignoff";

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
    const email = `it-cohort-tech-${Date.now()}@example.com`;
    const tk = (await call("POST", "/api/auth/register", { email, password: ["Zq", "coh", "7x!"].join("-"), name: "IT Cohort Technical", hipaa_acknowledged: true })).j.token;
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Cohort Lab", plan: "hospital" })).j.labId);
    const L = `/api/labs/${labId}`;
    await call("POST", `${L}/staff/lab`, { labName: "Cohort Lab", cliaNumber: "11D7654384", accreditationBody: "CLIA_ONLY", complexity: "high" }, tk, labId);
    const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, tk, labId)).j.id;
    await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
      { name: "Hemo Counter", category: "Hematology", tests: [{ analyte: "WBC", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
    ] });
    const INST = Number((sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = 'Hemo Counter' AND map_id = ?").get(mapId) as any)?.id);
    const tech = Number((await call("POST", `${L}/staff/employees`, { lastName: "Lane", firstName: "Robin", highestComplexity: "M", performsTesting: true, hireDate: "2021-03-01" }, tk, labId)).j.id);
    sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(tech, INST, new Date().toISOString());
    const mkProgram = async (body: any) => Number((await call("POST", `${L}/competency/programs`, body, tk, labId)).j.id);
    const techP = await mkProgram({ name: "Hematology Competency", department: "Hematology", type: "technical", methodGroups: [{ name: "Hemo Counter", instruments: ["Hemo Counter"], analytes: ["WBC"] }] });
    const waivedP = await mkProgram({ name: "Waived Glucose", department: "Point of Care", type: "waived" });
    const nonTechP = await mkProgram({ name: "Safety", department: "General", type: "nontechnical", checklistItems: [{ description: "Fire extinguisher location" }] });
    const comp = Number(((await call("GET", `${L}/competency/programs/${techP}/eligible-employees`, undefined, tk, labId)).j.employees || [])[0]?.id);
    check("0. fixture: one moderate analyzer, one tech on it, technical, waived and non-technical programs", INST > 0 && tech > 0 && techP > 0 && waivedP > 0 && nonTechP > 0 && comp > 0);
    const shared = { employeeIds: [comp], assessmentType: "annual", assessmentDate: "2026-10-15", status: "pass", evaluatorName: "Kit Vance" };
    const count = (p: number) => Number((sqlite.prepare("SELECT COUNT(*) c FROM competency_assessments WHERE program_id = ?").get(p) as any).c);
    const view = async () => {
      const v = (await call("GET", `${L}/competency/employee/${tech}`, undefined, tk, labId)).j;
      const ts = (v.testSystems || []).find((t: any) => t.instrumentId === INST);
      return `${ts?.signoffs?.length}|${ts?.nextMilestone}|${ts?.signedCurrent}`;
    };
    const before = await view();

    // 1. preview
    const pv = await call("POST", `${L}/competency/assessments/cohort-preview`, { programId: techP, ...shared }, tk, labId);
    const err = (pv.j.sharedIssues || []).find((i: any) => i.severity === "error");
    check("1. preview on a technical program: a shared error saying where technical is signed, every row blocked",
      pv.s === 200 && err?.message === TECHNICAL_COHORT_MESSAGE && pv.j.shared?.programOk === false && pv.j.summary?.error === 1 && pv.j.summary?.ok === 0,
      `${pv.s} ${JSON.stringify(pv.j.summary)} ${err?.message || ""}`);

    // 2. commit
    const cm = await call("POST", `${L}/competency/assessments/cohort-commit`, { programId: techP, ...shared }, tk, labId);
    const after = await view();
    check("2. commit on a technical program: 400 shared_field_invalid, nothing written, the person page unchanged",
      cm.s === 400 && cm.j.error === "shared_field_invalid" && count(techP) === 0 && after === before && before === "0|initial|false",
      `${cm.s} ${cm.j.error} records ${count(techP)} view ${before} -> ${after}`);

    // 3. waived and non-technical still commit
    const w = await call("POST", `${L}/competency/assessments/cohort-commit`, { programId: waivedP, ...shared }, tk, labId);
    const n = await call("POST", `${L}/competency/assessments/cohort-commit`, { programId: nonTechP, ...shared }, tk, labId);
    check("3. a waived and a non-technical program still commit, one record each",
      w.s === 200 && w.j.inserted === 1 && n.s === 200 && n.j.inserted === 1 && count(waivedP) === 1 && count(nonTechP) === 1,
      `${w.s} ${JSON.stringify(w.j)} | ${n.s} ${JSON.stringify(n.j)}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
