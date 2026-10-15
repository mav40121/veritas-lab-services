// tests/integration/competency-named-group-coverage.test.ts
//
// Receipt for BUG-043 and Michael's rule (2026-10-12): "If there are no new or unique skills, the competency covers
// both. Same rationale as 'you are competencied for potassium, therefore sodium is covered.'" /competency/owed used to
// treat a method group as covering ANY instrument that shared an analyte with it or whose department was in the group's
// name, so an XN-1000 assessment credited the manual differential, a Beckman AU group credited an Ortho VITROS, and a
// Clinitek Novus group credited the waived Clinitek Status. A group now covers only the analyzers it NAMES; a lab puts
// analyzers with no unique skills between them in one group. Also: saving a program's method groups keeps the ids of
// groups that stay (assessment items point at them). Boots the REAL routes on a scratch DB and proves:
//   1. analyzers keep their own groups (Novus, Wet Mount, AU5800)
//   2. a waived device that only SHARES tests with another analyzer's group is not covered by it (Status)
//   3. a waived device that only shares a DEPARTMENT with a group is not covered by it (pregnancy test)
//   4. with a waived program on the map, both waived devices read "Waived testing"
//   5. a passing assessment on the Novus group marks the Novus assessed but NOT the Clinitek Status
//   6. a waived device a group names is still covered by that group
//   7. a moderate analyzer on a different platform is NOT covered by a group that only shares a test (VITROS vs AU5800)
//   8. two analyzers named in ONE group are both covered by it (XN-1000 / XN-450); the manual differential is not
//   9. a passing assessment on that group marks XN-1000 and XN-450 assessed, not the manual differential
//  10. PUT method groups keeps an existing group's id (its assessment item still points at it), adds the new one,
//      and removes a group no longer listed
// Run (from bash): DB_PATH=.tmp-ncg.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/competency-named-group-coverage.test.ts
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
  const email = `wcg-${Date.now()}@example.com`;
  const owner = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Coverage Owner", hipaa_acknowledged: true })).j;
  const tk = owner.token;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Coverage Lab", plan: "hospital" })).j.labId;
  const ownerId = (sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(labId) as any).owner_user_id;
  const L = `/api/labs/${labId}`;
  await call("POST", `${L}/staff/lab`, { labName: "Coverage Lab", cliaNumber: "11D7654372", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, tk);
  const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, tk)).j.id;
  const t = (analyte: string, specialty: string, complexity: string) => ({ analyte, specialty, complexity, active: 1 });
  await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
    { name: "Clinitek Novus", category: "Urinalysis", tests: [t("pH", "General Chemistry", "MODERATE"), t("Specific Gravity", "General Chemistry", "MODERATE"), t("Color", "General Chemistry", "WAIVED")] },
    { name: "Clinitek Status", category: "Urinalysis", tests: [t("pH", "General Chemistry", "WAIVED"), t("Specific Gravity", "General Chemistry", "WAIVED"), t("Color", "General Chemistry", "WAIVED")] },
    { name: "Urine Pregnancy Test (Manual)", category: "Manual Procedures", tests: [t("hCG, Urine", "General Immunology", "WAIVED")] },
    { name: "Wet Mount", category: "Manual Procedures", tests: [t("Wet Prep", "Bacteriology", "MODERATE")] },
    { name: "Nova StatStrip Glucose Hospital Meter", category: "Point of Care", tests: [t("Glucose", "General Chemistry", "WAIVED")] },
    { name: "Beckman Coulter AU5800", category: "Chemistry", tests: [t("Glucose", "General Chemistry", "MODERATE")] },
    { name: "Ortho VITROS 5600", category: "Chemistry", tests: [t("Glucose", "General Chemistry", "MODERATE"), t("Potassium", "General Chemistry", "MODERATE")] },
    { name: "Sysmex XN-1000", category: "Hematology", tests: [t("Hemoglobin", "Hematology", "MODERATE"), t("Differential", "Hematology", "MODERATE")] },
    { name: "Sysmex XN-450", category: "Hematology", tests: [t("Hemoglobin", "Hematology", "MODERATE"), t("Differential", "Hematology", "MODERATE")] },
    { name: "Manual Differential", category: "Hematology", tests: [t("Differential", "Hematology", "HIGH")] },
  ] });
  const instId = (name: string) => (sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id = ?").get(name, mapId) as any)?.id;
  const VITROS = instId("Ortho VITROS 5600"), XN1 = instId("Sysmex XN-1000"), XN4 = instId("Sysmex XN-450"), MDIFF = instId("Manual Differential");
  const NOVUS = instId("Clinitek Novus"), STATUS = instId("Clinitek Status"), UPT = instId("Urine Pregnancy Test (Manual)"), WET = instId("Wet Mount"), METER = instId("Nova StatStrip Glucose Hospital Meter"), AU = instId("Beckman Coulter AU5800");
  const now = new Date().toISOString(); const today = now.slice(0, 10);
  const emp = (await call("POST", `${L}/staff/employees`, { lastName: "Williams", firstName: "Sarah", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, tk)).j.id as number;
  for (const i of [NOVUS, STATUS, UPT, WET, METER, AU, VITROS, XN1, XN4, MDIFF]) sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(emp, i, now);

  const prog = (name: string, type: string, mapRef: number | null) => Number(sqlite.prepare(
    "INSERT INTO competency_programs (user_id, lab_id, name, type, map_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(ownerId, labId, name, type, mapRef, now, now).lastInsertRowid);
  const group = (programId: number, name: string, instruments: string[], analytes: string[]) => Number(sqlite.prepare(
    "INSERT INTO competency_method_groups (program_id, name, instruments, analytes) VALUES (?, ?, ?, ?)").run(programId, name, JSON.stringify(instruments), JSON.stringify(analytes)).lastInsertRowid);
  const tech = prog("2026 Annual Competency - Urinalysis", "technical", mapId);
  const novusGroup = group(tech, "Clinitek Novus", ["Clinitek Novus"], ["pH", "Specific Gravity"]);
  group(tech, "Manual Procedures - Wet Mount / Wet Prep", ["Wet Mount"], ["Wet Prep"]);
  group(tech, "Chemistry - AU5800", ["Beckman Coulter AU5800"], ["Glucose"]);
  group(tech, "Point of Care - Nova StatStrip", ["Nova StatStrip Glucose Hospital Meter"], ["Glucose"]);
  const xnGroup = group(tech, "Hematology - XN-1000 / XN-450", ["Sysmex XN-1000", "Sysmex XN-450"], ["Hemoglobin", "Differential"]);

  const owed = async () => {
    const r = await call("GET", `${L}/competency/owed`, undefined, tk);
    const e = (r.j.employees || []).find((x: any) => x.employeeId === emp);
    return Object.fromEntries((e?.owed || []).map((o: any) => [o.instrumentName, o]));
  };
  const lbl = (o: any) => o?.covered ? `${o.coverage?.methodGroupName}` : "GAP";
  let o = await owed();
  check("1. moderate analyzers keep their own groups (Novus, Wet Mount, AU5800)",
    lbl(o["Clinitek Novus"]) === "Clinitek Novus" && lbl(o["Wet Mount"]) === "Manual Procedures - Wet Mount / Wet Prep" && lbl(o["Beckman Coulter AU5800"]) === "Chemistry - AU5800",
    JSON.stringify({ novus: lbl(o["Clinitek Novus"]), wet: lbl(o["Wet Mount"]), au: lbl(o["Beckman Coulter AU5800"]) }));
  check("2. the waived Clinitek Status is NOT covered by the Novus group through shared pH/SG (no waived program yet: gap)",
    lbl(o["Clinitek Status"]) === "GAP", lbl(o["Clinitek Status"]));
  check("3. the waived pregnancy test is NOT covered by the Wet Mount group through the shared department (gap)",
    lbl(o["Urine Pregnancy Test (Manual)"]) === "GAP", lbl(o["Urine Pregnancy Test (Manual)"]));
  check("6. a waived device that a group names is still covered by it (Nova StatStrip)",
    lbl(o["Nova StatStrip Glucose Hospital Meter"]) === "Point of Care - Nova StatStrip", lbl(o["Nova StatStrip Glucose Hospital Meter"]));

  prog("2026 Annual Competency - Waived Testing", "waived", mapId);
  o = await owed();
  check("4. with a waived program on the map, both waived devices read 'Waived testing'",
    lbl(o["Clinitek Status"]) === "Waived testing" && lbl(o["Urine Pregnancy Test (Manual)"]) === "Waived testing",
    JSON.stringify({ status: lbl(o["Clinitek Status"]), upt: lbl(o["Urine Pregnancy Test (Manual)"]) }));

  const ce = Number(sqlite.prepare("INSERT INTO competency_employees (user_id, lab_id, name, staff_employee_id, created_at) VALUES (?, ?, ?, ?, ?)").run(ownerId, labId, "Sarah Williams", emp, now).lastInsertRowid);
  const a = Number(sqlite.prepare("INSERT INTO competency_assessments (program_id, employee_id, assessment_date, created_at, locked, status) VALUES (?, ?, ?, ?, 1, 'pass')").run(tech, ce, today, now).lastInsertRowid);
  sqlite.prepare("INSERT INTO competency_assessment_items (assessment_id, method_group_id, passed) VALUES (?, ?, 1)").run(a, novusGroup);
  o = await owed();
  check("5. a passing Novus assessment marks the Novus assessed but NOT the Clinitek Status",
    o["Clinitek Novus"]?.assessed === true && o["Clinitek Status"]?.assessed === false,
    JSON.stringify({ novus: o["Clinitek Novus"]?.assessed, status: o["Clinitek Status"]?.assessed }));


  check("7. a moderate analyzer on another platform is NOT covered by a group that only shares a test (VITROS vs AU5800 glucose)",
    lbl(o["Ortho VITROS 5600"]) === "GAP", lbl(o["Ortho VITROS 5600"]));
  check("8. XN-1000 and XN-450, named in one group, are both covered by it; the manual differential is not",
    lbl(o["Sysmex XN-1000"]) === "Hematology - XN-1000 / XN-450" && lbl(o["Sysmex XN-450"]) === "Hematology - XN-1000 / XN-450" && lbl(o["Manual Differential"]) === "GAP",
    JSON.stringify({ xn1: lbl(o["Sysmex XN-1000"]), xn4: lbl(o["Sysmex XN-450"]), mdiff: lbl(o["Manual Differential"]) }));
  const a2 = Number(sqlite.prepare("INSERT INTO competency_assessments (program_id, employee_id, assessment_date, created_at, locked, status) VALUES (?, ?, ?, ?, 1, 'pass')").run(tech, ce, today, now).lastInsertRowid);
  sqlite.prepare("INSERT INTO competency_assessment_items (assessment_id, method_group_id, passed) VALUES (?, ?, 1)").run(a2, xnGroup);
  o = await owed();
  check("9. a passing XN group assessment marks XN-1000 and XN-450 assessed, not the manual differential",
    o["Sysmex XN-1000"]?.assessed === true && o["Sysmex XN-450"]?.assessed === true && o["Manual Differential"]?.assessed === false,
    JSON.stringify({ xn1: o["Sysmex XN-1000"]?.assessed, xn4: o["Sysmex XN-450"]?.assessed, mdiff: o["Manual Differential"]?.assessed }));

  // 10. PUT method groups keeps ids: keep the Novus and XN groups, drop the others, add a Manual Differential group.
  const groupsNow = () => sqlite.prepare("SELECT id, name FROM competency_method_groups WHERE program_id = ? ORDER BY id").all(tech) as any[];
  const keepNames = ["Clinitek Novus", "Hematology - XN-1000 / XN-450"];
  const put = await call("PUT", `${L}/competency/programs/${tech}`, { methodGroups: [
    { name: "Clinitek Novus", instruments: ["Clinitek Novus"], analytes: ["pH", "Specific Gravity"] },
    { name: "Hematology - XN-1000 / XN-450", instruments: ["Sysmex XN-1000", "Sysmex XN-450"], analytes: ["Hemoglobin", "Differential"] },
    { name: "Hematology - Manual Differential", instruments: ["Manual Differential"], analytes: ["Differential"] },
  ] }, tk);
  const after = groupsNow();
  const idOf = (n: string) => after.find((g: any) => g.name === n)?.id;
  const itemsOnOld = (sqlite.prepare("SELECT COUNT(*) AS n FROM competency_assessment_items WHERE method_group_id IN (?, ?)").get(novusGroup, xnGroup) as any).n;
  o = await owed();
  check("10. PUT keeps the Novus and XN group ids (their assessment items still point at them), adds Manual Differential, removes the rest",
    put.s === 200 && idOf("Clinitek Novus") === novusGroup && idOf("Hematology - XN-1000 / XN-450") === xnGroup && !!idOf("Hematology - Manual Differential") &&
    after.length === 3 && itemsOnOld === 2 && o["Sysmex XN-450"]?.assessed === true && lbl(o["Manual Differential"]) === "Hematology - Manual Differential",
    `${put.s} ${JSON.stringify(after)} items ${itemsOnOld}`);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
