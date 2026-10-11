// tests/integration/competency-waived-coverage.test.ts
//
// Receipt for BUG-037 (2026-10-11, found on the St. Charles demo dry run). VeritaComp's coverage map and
// "Competencies owed" read coverage only from method groups, which only technical programs have. A waived
// program ("2 of 4 methods per test") is built from a map with no method groups, so every waived instrument
// (glucose meters, urine dipstick readers) read as a gap even with a waived program in place, and a locked
// waived assessment never showed as assessed. Boots the REAL routes on a scratch DB and proves:
//   1. before any program: the waived meter is a gap
//   2. a waived program on map A covers map A's all-waived instruments, not a moderate one, not map B's meter
//   3. a locked passing waived assessment (30 days ago) marks the person's covered waived instruments assessed
//   4. one older than a year does not
//   5. technical coverage unchanged: a technical method group still covers the moderate instrument
// Run (from bash): DB_PATH=.tmp-cwc.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/competency-waived-coverage.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
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
  const email = `cwc-${Date.now()}@example.com`;
  const owner = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Waived Owner", hipaa_acknowledged: true })).j;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Waived Coverage Lab", plan: "hospital" })).j.labId;
  const L = `/api/labs/${labId}`;
  await call("POST", `${L}/staff/lab`, { labName: "Waived Coverage Lab", cliaNumber: "11D7654370", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
  const mapA = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, owner.token)).j.id;
  const mapB = (await call("POST", `${L}/veritamap/maps`, { name: "Outreach clinic" }, owner.token)).j.id;
  const t = (analyte: string, specialty: string, complexity: string) => ({ analyte, specialty, complexity, active: 1 });
  await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: mapA, defaultActive: 1, instruments: [
    { name: "Nova StatStrip Glucose Hospital Meter", category: "Point of Care", tests: [t("Glucose", "General Chemistry", "WAIVED")] },
    { name: "Clinitek Status", category: "Urinalysis", tests: [t("Protein", "Urinalysis", "WAIVED")] },
    { name: "Mini i-Sed", category: "Hematology", tests: [t("Sed Rate", "Hematology", "MODERATE")] },
  ] });
  await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: mapB, defaultActive: 1, instruments: [
    { name: "Accu-Chek Inform II", category: "Point of Care", tests: [t("Glucose", "General Chemistry", "WAIVED")] },
  ] });
  const instId = (name: string) => (sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id IN (?, ?)").get(name, mapA, mapB) as any)?.id;
  const emp = (await call("POST", `${L}/staff/employees`, { lastName: "Meter", firstName: "Mia", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).j;
  const now = new Date().toISOString();
  for (const n of ["Nova StatStrip Glucose Hospital Meter", "Clinitek Status", "Mini i-Sed", "Accu-Chek Inform II"])
    sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(emp.id, instId(n), now);
  check("fixture: two maps, one person assigned 3 waived + 1 moderate instruments", !!mapA && !!mapB && !!emp.id && [instId("Nova StatStrip Glucose Hospital Meter"), instId("Accu-Chek Inform II")].every(Boolean));

  const owedItems = async () => {
    const r = await call("GET", `${L}/competency/owed`, undefined, owner.token);
    const e = (r.j.employees || []).find((x: any) => x.employeeId === emp.id);
    return Object.fromEntries((e?.owed || []).map((o: any) => [o.instrumentName, o]));
  };
  let o = await owedItems();
  check("1. before any program the waived meter is a gap", o["Nova StatStrip Glucose Hospital Meter"]?.covered === false, JSON.stringify(o["Nova StatStrip Glucose Hospital Meter"]));

  const wp = await call("POST", `${L}/competency/programs`, { name: "Point of Care waived testing", department: "Point of Care", type: "waived", mapId: mapA }, owner.token);
  o = await owedItems();
  check("2a. the waived program on map A covers map A's waived meter and urine reader",
    o["Nova StatStrip Glucose Hospital Meter"]?.covered === true && o["Clinitek Status"]?.covered === true && o["Nova StatStrip Glucose Hospital Meter"]?.coverage?.programName === "Point of Care waived testing",
    `${wp.s} ${JSON.stringify(o["Nova StatStrip Glucose Hospital Meter"]?.coverage)}`);
  check("2b. it does not cover the moderate instrument or the meter on map B", o["Mini i-Sed"]?.covered === false && o["Accu-Chek Inform II"]?.covered === false,
    `${o["Mini i-Sed"]?.covered} ${o["Accu-Chek Inform II"]?.covered}`);
  check("2c. nothing assessed yet", Object.values(o).every((x: any) => x.assessed === false));

  const ce = Number(sqlite.prepare("INSERT INTO competency_employees (user_id, name, title, status, created_at, staff_employee_id) VALUES (?, 'Mia Meter', '', 'active', ?, ?)").run(owner.user.id, now, emp.id).lastInsertRowid);
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const assess = (date: string) => sqlite.prepare("INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, competency_type, status, locked, created_at) VALUES (?, ?, 'annual', ?, 'waived', 'pass', 1, ?)").run(wp.j.id, ce, date, now);
  assess(day(-400));
  o = await owedItems();
  check("4. a waived assessment older than a year does not count", o["Nova StatStrip Glucose Hospital Meter"]?.assessed === false);
  assess(day(-30));
  o = await owedItems();
  check("3. a locked passing waived assessment 30 days ago marks the covered waived instruments assessed (not the others)",
    o["Nova StatStrip Glucose Hospital Meter"]?.assessed === true && o["Clinitek Status"]?.assessed === true && o["Mini i-Sed"]?.assessed === false && o["Accu-Chek Inform II"]?.assessed === false,
    JSON.stringify(Object.fromEntries(Object.entries(o).map(([k, v]: any) => [k, [v.covered, v.assessed]]))));

  await call("POST", `${L}/competency/programs`, { name: "Hematology", department: "Hematology", type: "technical", mapId: mapA, methodGroups: [{ name: "Sed rate", instruments: ["Mini i-Sed"], analytes: ["Sed Rate"] }] }, owner.token);
  o = await owedItems();
  check("5. technical coverage unchanged: a method group still covers the moderate instrument", o["Mini i-Sed"]?.covered === true && o["Mini i-Sed"]?.coverage?.programName === "Hematology");

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
