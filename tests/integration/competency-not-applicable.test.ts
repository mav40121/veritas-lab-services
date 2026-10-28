// tests/integration/competency-not-applicable.test.ts
//
// BUG-115 (2026-10-28, RFGH Brandy Morgan: "To mark an employee N/A for something they do not perform ... how do I do
// so without inactivating them mistakenly?"). Every VeritaComp program lists every active person in the lab, and the
// only way off one (the Employees-tab X) deactivated the person in EVERY program. A person can now be marked Not
// applicable on one program. This pins the server side:
//   1. marking is per program: the person stays active, keeps VeritaStaff, and other programs still apply
//   2. a new assessment for them on that program is refused (lab and legacy routes); New Assessment does not offer them
//   3. clearing it makes the program apply again; marking twice changes nothing; each real change is audit-logged once
//   4. another lab cannot mark or clear; a reason is optional and capped
//   5. deleting the program removes its Not applicable rows
// Run: npm run test:competency-not-applicable

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

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
  const call = async (method: string, p: string, body?: any, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const svc = (uid: number) => jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const pw = ["Zq", "notap", "7x!"].join("-");
  const reg = async (tag: string) => {
    const email = `it-na-${tag}-${Date.now()}@example.com`;
    await call("POST", "/api/auth/register", { email, password: pw, name: `IT ${tag}`, hipaa_acknowledged: true });
    return { email, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id) };
  };

  try {
    const owner = await reg("owner");
    const other = await reg("other");
    const L = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "IT NA Lab", plan: "hospital" })).body.labId);
    const L2 = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: other.email, labName: "IT Other Lab", plan: "hospital" })).body.labId);
    const T = svc(owner.id), T2 = svc(other.id);
    await call("POST", `/api/labs/${L}/staff/lab`, { labName: "IT NA Lab", cliaNumber: "11D7654378", accreditationBody: "CLIA_ONLY", complexity: "high" }, T, L);
    check("0. setup: two labs, two owners", L > 0 && L2 > 0 && L !== L2);

    const mkProgram = async (name: string) => Number((await call("POST", `/api/labs/${L}/competency/programs`, { name, department: "Microbiology", type: "nontechnical", checklistItems: [{ description: "Perform 10 Gram stains with supervisor review" }] }, T, L)).body.id);
    const P = await mkProgram("Gram Stain Competency");
    const P2 = await mkProgram("Bactec FX operation");
    // Two made-up people in VeritaStaff; New Assessment bridges them into VeritaComp.
    const s1 = (await call("POST", `/api/labs/${L}/staff/employees`, { lastName: "Reyes", firstName: "Ana", highestComplexity: "M", performsTesting: true, hireDate: "2020-01-06" }, T, L)).body.id;
    const s2 = (await call("POST", `/api/labs/${L}/staff/employees`, { lastName: "Tate", firstName: "Casey", highestComplexity: "M", performsTesting: true, hireDate: "2021-03-01" }, T, L)).body.id;
    const eligible = async (pid: number) => ((await call("GET", `/api/labs/${L}/competency/programs/${pid}/eligible-employees`, undefined, T, L)).body.employees || []) as any[];
    const before = await eligible(P);
    const E1 = Number(before.find((e) => e.staff_employee_id === s1)?.id);
    const E2 = Number(before.find((e) => e.staff_employee_id === s2)?.id);
    check("0b. setup: New Assessment offers both people", E1 > 0 && E2 > 0 && before.length === 2, JSON.stringify(before.map((e) => e.name)));

    const naUrl = `/api/labs/${L}/competency/programs/${P}/not-applicable`;
    const auditCount = () => Number((sqlite.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE entity_type = 'program_not_applicable'").get() as any).c);
    const a0 = auditCount();
    const mark = await call("POST", naUrl, { employeeId: E1, reason: "Does not read Gram stains" }, T, L);
    check("1a. marking Ana Not applicable on Gram Stain succeeds and is listed", mark.status === 200 && mark.body.notApplicable?.length === 1 && mark.body.notApplicable[0].employee_id === E1 && mark.body.notApplicable[0].reason === "Does not read Gram stains", JSON.stringify(mark.body));
    const empRow = sqlite.prepare("SELECT status FROM competency_employees WHERE id = ?").get(E1) as any;
    const staffRow = sqlite.prepare("SELECT status FROM staff_employees WHERE id = ?").get(s1) as any;
    check("1b. she stays active in VeritaComp and in VeritaStaff", empRow.status === "active" && staffRow.status === "active", `${empRow.status} / ${staffRow.status}`);
    const detail = await call("GET", `/api/labs/${L}/competency/programs/${P}`, undefined, T, L);
    check("1c. the program detail carries the Not applicable list", detail.status === 200 && detail.body.notApplicable?.map((r: any) => r.employee_id).join(",") === String(E1));
    const detail2 = await call("GET", `/api/labs/${L}/competency/programs/${P2}`, undefined, T, L);
    check("1d. the other program does not mark her", detail2.body.notApplicable?.length === 0 && (await eligible(P2)).some((e) => e.id === E1));

    const after = await eligible(P);
    check("2a. New Assessment on Gram Stain no longer offers her, still offers Casey", !after.some((e) => e.id === E1) && after.some((e) => e.id === E2), JSON.stringify(after.map((e) => e.name)));
    const asmtBody = (emp: number, pid: number) => ({ programId: pid, employeeId: emp, assessmentType: "initial", assessmentDate: "2026-10-28", evaluatorName: "Pat Lead", evaluatorTitle: "Technical Supervisor", evaluatorInitials: "PL", competencyType: "nontechnical", status: "pass", items: [] });
    const refused = await call("POST", `/api/labs/${L}/competency/assessments`, asmtBody(E1, P), T, L);
    check("2b. a new assessment for her on Gram Stain is refused, naming why", refused.status === 400 && /Not applicable/.test(refused.body.error || ""), `${refused.status} ${JSON.stringify(refused.body)}`);
    const legacyRefused = await call("POST", `/api/competency/assessments`, asmtBody(E1, P), T);
    check("2c. the legacy route refuses it too", legacyRefused.status === 400 && /Not applicable/.test(legacyRefused.body.error || ""), `${legacyRefused.status} ${JSON.stringify(legacyRefused.body).slice(0, 160)}`);
    const otherProg = await call("POST", `/api/labs/${L}/competency/assessments`, asmtBody(E1, P2), T, L);
    check("2d. an assessment for her on the other program still saves", otherProg.status === 200, `${otherProg.status} ${JSON.stringify(otherProg.body).slice(0, 160)}`);
    const casey = await call("POST", `/api/labs/${L}/competency/assessments`, asmtBody(E2, P), T, L);
    check("2e. Casey's assessment on Gram Stain saves", casey.status === 200, String(casey.status));

    const again = await call("POST", naUrl, { employeeId: E1 }, T, L);
    const rows = sqlite.prepare("SELECT reason FROM competency_program_not_applicable WHERE program_id = ? AND employee_id = ?").all(P, E1) as any[];
    check("3a. marking twice keeps one row (and the first reason)", again.status === 200 && rows.length === 1 && rows[0].reason === "Does not read Gram stains", JSON.stringify(rows));
    const cleared = await call("DELETE", `${naUrl}/${E1}`, undefined, T, L);
    check("3b. Applies again clears it and New Assessment offers her again", cleared.status === 200 && cleared.body.notApplicable?.length === 0 && (await eligible(P)).some((e) => e.id === E1), String(cleared.status));
    const nowOk = await call("POST", `/api/labs/${L}/competency/assessments`, asmtBody(E1, P), T, L);
    check("3c. her Gram Stain assessment now saves", nowOk.status === 200, String(nowOk.status));
    const a1 = auditCount();
    check("3d. one audit row per real change (mark, clear), none for the repeat", a1 === a0 + 2, `${a0} -> ${a1}`);

    const crossMark = await call("POST", `/api/labs/${L2}/competency/programs/${P}/not-applicable`, { employeeId: E2 }, T2, L2);
    check("4a. another lab's URL cannot mark on this program (404)", crossMark.status === 404, String(crossMark.status));
    const p3 = Number((await call("POST", `/api/labs/${L2}/competency/programs`, { name: "Other", department: "Microbiology", type: "nontechnical", checklistItems: [{ description: "Item" }] }, T2, L2)).body.id);
    const crossEmp = await call("POST", `/api/labs/${L2}/competency/programs/${p3}/not-applicable`, { employeeId: E2 }, T2, L2);
    check("4b. another lab cannot mark this lab's person on its own program (404)", crossEmp.status === 404 && Number((sqlite.prepare("SELECT COUNT(*) AS c FROM competency_program_not_applicable WHERE employee_id = ?").get(E2) as any).c) === 0, String(crossEmp.status));
    const longReason = await call("POST", naUrl, { employeeId: E2, reason: "x".repeat(201) }, T, L);
    check("4c. a reason over 200 characters is refused and nothing is marked", longReason.status === 400 && Number((sqlite.prepare("SELECT COUNT(*) AS c FROM competency_program_not_applicable WHERE program_id = ?").get(P) as any).c) === 0, String(longReason.status));
    const noReason = await call("POST", naUrl, { employeeId: E2 }, T, L);
    check("4d. a reason is optional", noReason.status === 200 && noReason.body.notApplicable?.[0]?.reason === null, JSON.stringify(noReason.body));

    const del = await call("DELETE", `/api/labs/${L}/competency/programs/${P}`, undefined, T, L);
    check("5a. deleting the program removes its Not applicable rows", del.status === 200 && Number((sqlite.prepare("SELECT COUNT(*) AS c FROM competency_program_not_applicable WHERE program_id = ?").get(P) as any).c) === 0, String(del.status));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
