// tests/integration/competency-hire-date-from-staff.test.ts
//
// BUG-090 (Sampson, 2026-10-20). Natalie Lamb: "For the new hire evals, it's not pulling in the hire date from the
// staff tab." Natalie Edge's VeritaComp row was bridged from VeritaStaff on 10/13, before her VeritaStaff hire date
// (10/19) existed, so the copy stayed blank and the evaluation showed no hire date and no due date.
// This pins:
//   1. the pure rule: a linked row takes the VeritaStaff hire date when VeritaStaff has one; an unlinked row, or a
//      linked row whose VeritaStaff date is blank, keeps its own
//   2. the employee lists the evaluation form reads (lab employees list, program detail) carry the VeritaStaff date,
//      and follow a later VeritaStaff change with no copy step
//   3. the assessment reads and the evaluation PDF carry the VeritaStaff date, and the shared SQL expression is valid
// Run: npm run test:competency-hire-date-from-staff

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { EMPLOYEE_HIRE_DATE_SQL, preferStaffHireDate } from "../../server/competencyHireDate";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  // 1) pure rule
  const staff = new Map<number, string | null>([[1, "2026-10-19"], [2, null]]);
  const out = preferStaffHireDate([
    { id: "linked", staff_employee_id: 1, hire_date: null },
    { id: "linked-stale", staff_employee_id: 1, hire_date: "2026-01-01" },
    { id: "linked-blank-staff", staff_employee_id: 2, hire_date: "2025-05-05" },
    { id: "unlinked", staff_employee_id: null, hire_date: "2024-04-04" },
  ], staff).map((r) => r.hire_date).join(",");
  check("1. linked rows take the VeritaStaff date; blank VeritaStaff or unlinked rows keep their own",
    out === "2026-10-19,2026-10-19,2025-05-05,2024-04-04", out);

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const call = async (method: string, p: string, body?: any, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* PDF or HTML */ }
    return { status: r.status, body: json, type: r.headers.get("content-type") || "" };
  };
  const svc = (uid: number) => jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const pw = ["Zq", "hire", "7x!"].join("-");

  try {
    const email = `it-hire-date-${Date.now()}@example.com`;
    await call("POST", "/api/auth/register", { email, password: pw, name: "IT Hire Date", hipaa_acknowledged: true });
    const ownerId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id);
    const L = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "IT Hire Date Lab", plan: "hospital" })).body.labId);
    const T = svc(ownerId);
    check("0. setup: lab and owner", L > 0 && ownerId > 0);

    // The Sampson shape: a VeritaStaff person with a hire date, linked to a VeritaComp row whose copy is blank.
    const now = new Date().toISOString();
    const S = Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, hire_date, status, created_at, updated_at, tier2_lab_id) VALUES (?, ?, 'Rivera', 'Sam', '2026-10-19', 'active', ?, ?, ?)"
    ).run(L, ownerId, now, now, L).lastInsertRowid);
    const C = Number(sqlite.prepare(
      "INSERT INTO competency_employees (user_id, lab_id, name, title, hire_date, lis_initials, status, created_at, staff_employee_id) VALUES (?, ?, 'Sam Rivera', '', NULL, NULL, 'active', ?, ?)"
    ).run(ownerId, L, now, S).lastInsertRowid);
    const U = Number(sqlite.prepare(
      "INSERT INTO competency_employees (user_id, lab_id, name, title, hire_date, lis_initials, status, created_at) VALUES (?, ?, 'Pat Unlinked', '', '2024-04-04', NULL, 'active', ?)"
    ).run(ownerId, L, now).lastInsertRowid);

    // 2) employee lists
    const list = await call("GET", `/api/labs/${L}/competency/employees`, undefined, T, L);
    const hire = (rows: any[], id: number) => (rows || []).find((e: any) => e.id === id)?.hire_date ?? null;
    check("2a. the lab employee list shows the VeritaStaff date for the linked person", list.status === 200 && hire(list.body, C) === "2026-10-19", `${list.status} ${hire(list.body, C)}`);
    check("2b. an unlinked person keeps their own date", hire(list.body, U) === "2024-04-04", String(hire(list.body, U)));
    check("2c. the stored copy is untouched (the read takes VeritaStaff, nothing is rewritten)",
      (sqlite.prepare("SELECT hire_date FROM competency_employees WHERE id = ?").get(C) as any).hire_date === null);

    const ev = await call("POST", `/api/labs/${L}/competency/programs`, { name: "Lab Assistant new-hire evaluation", department: "Specimen Processing", type: "nontechnical", recordKind: "evaluation",
      checklistItems: [{ description: "Orientation checklist", stage: "30day" }, { description: "Second department", stage: "60day" }] }, T, L);
    const EP = Number(ev.body.id);
    const detail = await call("GET", `/api/labs/${L}/competency/programs/${EP}`, undefined, T, L);
    check("2d. the evaluation program's employee list (what the form reads) shows the VeritaStaff date",
      ev.status === 200 && detail.status === 200 && hire(detail.body.employees, C) === "2026-10-19", `${ev.status}/${detail.status} ${hire(detail.body.employees, C)}`);

    sqlite.prepare("UPDATE staff_employees SET hire_date = '2026-10-20' WHERE id = ?").run(S);
    const list2 = await call("GET", `/api/labs/${L}/competency/employees`, undefined, T, L);
    check("2e. a later VeritaStaff change shows at once, with no copy step", hire(list2.body, C) === "2026-10-20", String(hire(list2.body, C)));
    sqlite.prepare("UPDATE staff_employees SET hire_date = '2026-10-19' WHERE id = ?").run(S);

    // 3) assessment reads, PDF, and the shared expression
    const expr = sqlite.prepare(`SELECT ${EMPLOYEE_HIRE_DATE_SQL} AS h FROM competency_employees e WHERE e.id = ?`).get(C) as any;
    check("3a. the shared SQL expression is valid and returns the VeritaStaff date", expr?.h === "2026-10-19", JSON.stringify(expr));
    const partial = await call("POST", `/api/labs/${L}/competency/assessments`, {
      programId: EP, employeeId: C, assessmentType: "30day", assessmentDate: "2026-10-20", evaluatorName: "Pat Lead", evaluatorInitials: "PL",
      competencyType: "nontechnical", status: "pass",
      items: [{ itemLabel: "A", itemDescription: "Orientation checklist", ntItemLabel: "A", ntItemDescription: "Orientation checklist", ntDateMet: "2026-10-20",
        ntEmployeeInitials: "", ntSupervisorInitials: "PL", dateMet: "2026-10-20", employeeInitials: "", supervisorInitials: "PL", passed: false }],
    }, T, L);
    const AID = Number(partial.body.id);
    check("3b. a partly filled evaluation saves (progress can be saved along the way)", partial.status === 200 && AID > 0, `${partial.status} ${JSON.stringify(partial.body).slice(0, 120)}`);
    const detail2 = await call("GET", `/api/labs/${L}/competency/programs/${EP}`, undefined, T, L);
    const a = (detail2.body.assessments || []).find((x: any) => x.id === AID);
    check("3c. the saved evaluation reads back under the chosen person with the VeritaStaff hire date",
      a?.employee_id === C && a?.employee_hire_date === "2026-10-19", JSON.stringify({ emp: a?.employee_id, hd: a?.employee_hire_date }));
    check("3d. the unfinished item is stored as not met (the list shows the record In progress)",
      Array.isArray(a?.items) && a.items.length === 1 && Number(a.items[0].passed) === 0, JSON.stringify(a?.items?.map((i: any) => i.passed)));
    const pdf = await call("GET", `/api/labs/${L}/competency/assessments/${AID}/pdf`, undefined, T, L);
    check("3e. the evaluation PDF route still runs with the new hire-date query", pdf.status === 200, `${pdf.status} ${pdf.type}`);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
