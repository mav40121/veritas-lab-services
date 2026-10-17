// tests/integration/competency-evaluation.test.ts
//
// New-hire evaluations in VeritaComp (2026-10-16, Michael Q = 1 for Natalie Lamb, Sampson Regional, REQ-076: "Can you
// 'AI' upload my 30, 60, 90 day evals for each job title? ... I built one, but needed to edit the title to evaluation
// instead of competency."). An evaluation is a non-technical program with record_kind 'evaluation'. This pins:
//   1. due dates: hire date + 30/60/90 calendar days, date-only, across month and year ends and a leap day
//   2. a program is an evaluation only when it is non-technical and created as one; other programs stay competencies
//   3. an evaluation takes only the 30/60/90-day types, and no other program takes them
//   4. the people list for a non-technical program includes a new hire with no instrument, with the hire date
//   5. an evaluation's fail never shows up as an open competency reassessment (a competency's fail still does)
//   6. the PDF says Evaluation throughout (title, type and due date, checklist, sign-off) and never "competency";
//      a non-technical competency PDF is unchanged
// Run: npm run test:competency-evaluation

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { assessmentTypeLabel, assessmentTypeProblem, evaluationDueDate, isEvaluationProgram } from "../../shared/competencyEvaluation";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  // 1) due dates
  const due = (h: any, t: string) => evaluationDueDate(h, t);
  check("1a. 30/60/90 days from 2026-10-16", [due("2026-10-16", "30day"), due("2026-10-16", "60day"), due("2026-10-16", "90day")].join(",") === "2026-11-15,2026-12-15,2027-01-14",
    [due("2026-10-16", "30day"), due("2026-10-16", "60day"), due("2026-10-16", "90day")].join(","));
  check("1b. leap year: 2028-01-31 + 30 days = 2028-03-01", due("2028-01-31", "30day") === "2028-03-01", String(due("2028-01-31", "30day")));
  check("1c. a timestamp hire date uses its date only", due("2026-10-16T23:30:00.000Z", "30day") === "2026-11-15");
  check("1d. no due date for a missing or impossible hire date, or a non-evaluation type",
    due(null, "30day") === null && due("", "30day") === null && due("2026-02-30", "30day") === null && due("10/16/2026", "30day") === null && due("2026-10-16", "annual") === null);
  check("1e. labels", ["30day", "60day", "90day", "6month", "duty_change"].map(assessmentTypeLabel).join(",") === "30-Day,60-Day,90-Day,6-Month,Duty Change");
  check("2a. only a non-technical program marked evaluation is one",
    isEvaluationProgram({ type: "nontechnical", record_kind: "evaluation" }) && !isEvaluationProgram({ type: "nontechnical", record_kind: "competency" }) &&
    !isEvaluationProgram({ type: "technical", record_kind: "evaluation" }) && !isEvaluationProgram({ type: "nontechnical" }));
  const ev = { type: "nontechnical", record_kind: "evaluation" }, nt = { type: "nontechnical", record_kind: "competency" };
  check("3a. type rules", assessmentTypeProblem(ev, "60day") === null && assessmentTypeProblem(ev, "orientation") !== null && assessmentTypeProblem(nt, "90day") !== null && assessmentTypeProblem(nt, "orientation") === null && assessmentTypeProblem({ type: "technical" }, "initial") === null);

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
  const pw = ["Zq", "eval", "7x!"].join("-");

  try {
    const email = `it-evaluation-${Date.now()}@example.com`;
    await call("POST", "/api/auth/register", { email, password: pw, name: "IT Evaluation", hipaa_acknowledged: true });
    const ownerId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id);
    const L = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "IT Evaluation Lab", plan: "hospital" })).body.labId);
    const T = svc(ownerId);
    check("0. setup: lab and owner", L > 0);
    const programsUrl = `/api/labs/${L}/competency/programs`;

    // 2) creating
    const evalProg = await call("POST", programsUrl, { name: "Phlebotomist new-hire evaluation", department: "Specimen Processing", type: "nontechnical", recordKind: "evaluation",
      checklistItems: [{ description: "Patient identification" }, { description: "Order of draw" }] }, T, L);
    const EP = Number(evalProg.body.id);
    const evalRow = sqlite.prepare("SELECT type, record_kind FROM competency_programs WHERE id = ?").get(EP) as any;
    check("2b. a new-hire evaluation is created as a non-technical program marked evaluation, with its checklist",
      evalProg.status === 200 && evalRow?.type === "nontechnical" && evalRow?.record_kind === "evaluation" && evalProg.body.record_kind === "evaluation" &&
      Number((sqlite.prepare("SELECT COUNT(*) AS c FROM competency_checklist_items WHERE program_id = ?").get(EP) as any).c) === 2, `${evalProg.status} ${JSON.stringify(evalRow)}`);
    const badKind = await call("POST", programsUrl, { name: "Bad", department: "Chemistry", type: "technical", recordKind: "evaluation", methodGroups: [] }, T, L);
    check("2c. only a non-technical program can be an evaluation", badKind.status === 400, String(badKind.status));
    const ntProg = await call("POST", programsUrl, { name: "Chemistry non-technical competency", department: "Chemistry", type: "nontechnical", checklistItems: [{ description: "Tour Department" }] }, T, L);
    const NP = Number(ntProg.body.id);
    check("2d. a non-technical program without recordKind stays a competency",
      ntProg.status === 200 && (sqlite.prepare("SELECT record_kind FROM competency_programs WHERE id = ?").get(NP) as any)?.record_kind === "competency");
    const list = await call("GET", programsUrl, undefined, T, L);
    check("2e. the program list carries record_kind", list.status === 200 && list.body.find((p: any) => p.id === EP)?.record_kind === "evaluation");

    // 4) people: a new hire with no instrument
    const now = new Date().toISOString();
    const sl = Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, created_at, updated_at, tier2_lab_id) VALUES (?, 'IT Evaluation Lab', '11D1111111', ?, ?, ?)").run(ownerId, now, now, L).lastInsertRowid);
    const staffId = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, user_id, last_name, first_name, title, hire_date, status, tier2_lab_id, created_at, updated_at) VALUES (?, ?, 'Rivera', 'Sam', 'Phlebotomist', '2026-10-16', 'active', ?, ?, ?)").run(sl, ownerId, L, now, now).lastInsertRowid);
    const elig = await call("GET", `/api/labs/${L}/competency/programs/${EP}/eligible-employees`, undefined, T, L);
    const sam = (elig.body.employees || []).find((e: any) => e.staff_employee_id === staffId);
    check("4a. a new hire with no instrument is on the evaluation's people list, with the hire date",
      elig.status === 200 && !!sam && sam.hire_date === "2026-10-16" && Array.isArray(sam.instruments) && sam.instruments.length === 0, `${elig.status} ${JSON.stringify(sam)}`);
    const compEmpId = Number(sam?.id);

    // 3) assessment types
    const asmtUrl = `/api/labs/${L}/competency/assessments`;
    const body = (programId: number, assessmentType: string, status = "pass") => ({ programId, employeeId: compEmpId, assessmentType, assessmentDate: "2026-11-14", evaluatorName: "Pat Lead",
      evaluatorTitle: "Supervisor", evaluatorInitials: "PL", competencyType: "nontechnical", status, items: [] });
    const wrongOnEval = await call("POST", asmtUrl, body(EP, "orientation"), T, L);
    check("3b. an evaluation refuses a competency type", wrongOnEval.status === 400 && /30-day, 60-day or 90-day/.test(wrongOnEval.body.error || ""), `${wrongOnEval.status} ${JSON.stringify(wrongOnEval.body)}`);
    const ok30 = await call("POST", asmtUrl, body(EP, "30day"), T, L);
    check("3c. an evaluation takes the 30-day type", ok30.status === 200 && Number(ok30.body.id) > 0, `${ok30.status} ${JSON.stringify(ok30.body).slice(0, 160)}`);
    const wrongOnComp = await call("POST", asmtUrl, body(NP, "60day"), T, L);
    check("3d. a non-technical competency refuses the 60-day type", wrongOnComp.status === 400, String(wrongOnComp.status));
    const legacyWrong = await call("POST", "/api/competency/assessments", body(NP, "90day"), T, L);
    check("3e. the legacy create route applies the same rule", legacyWrong.status === 400, String(legacyWrong.status));

    // 5) compliance: an evaluation's fail is not an open competency reassessment
    const evalFail = await call("POST", asmtUrl, body(EP, "60day", "fail"), T, L);
    const statsA = await call("GET", `/api/labs/${L}/competency/reassessment-stats`, undefined, T, L);
    check("5a. an evaluation's fail is not an open reassessment", evalFail.status === 200 && statsA.status === 200 && statsA.body.totalOpen === 0, `${evalFail.status} ${JSON.stringify(statsA.body)}`);
    const compFail = await call("POST", asmtUrl, body(NP, "orientation", "fail"), T, L);
    const statsB = await call("GET", `/api/labs/${L}/competency/reassessment-stats`, undefined, T, L);
    check("5b. a competency's fail still is", compFail.status === 200 && statsB.body.totalOpen === 1, JSON.stringify(statsB.body));

    // 6) the PDF wording
    const { buildCompetencyHTML } = await import("../../server/pdfReport");
    const pdfFor = (recordKind: string, assessmentType: string) => buildCompetencyHTML({
      assessment: { id: 1, competency_type: "nontechnical", program_record_kind: recordKind, program_name: "Phlebotomist new-hire evaluation", department: "Specimen Processing",
        employee_name: "Sam Rivera", employee_hire_date: "2026-10-16", assessment_type: assessmentType, assessment_date: "2026-11-14", evaluator_name: "Pat Lead", evaluator_title: "Supervisor",
        evaluator_initials: "PL", status: "pass" },
      items: [{ nt_item_label: "A", nt_item_description: "Patient identification", nt_date_met: "2026-11-14", nt_employee_initials: "SR", nt_supervisor_initials: "PL" }],
      methodGroups: [], checklistItems: [], labName: "IT Evaluation Lab", quizResults: [], cliaNumber: "11D1111111",
    } as any);
    const visible = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const evalText = visible(pdfFor("evaluation", "30day"));
    check("6a. the evaluation PDF is titled New-Hire Evaluation with the 30-day type and due date",
      evalText.includes("New-Hire Evaluation") && evalText.includes("30-Day Evaluation (due 2026-11-15)"), evalText.slice(0, 300));
    check("6b. its checklist, verdict and sign-off say Evaluation",
      evalText.includes("New-Hire Evaluation Checklist") && evalText.includes("Evaluation Item") && evalText.includes("SATISFACTORY") && evalText.includes("EVALUATION COMPLETION"));
    const comp = evalText.match(/[^.]{0,60}competenc[^.]{0,60}/i);
    check("6c. the word competency appears nowhere on it", !comp, comp ? comp[0] : "");
    const ntText = visible(pdfFor("competency", "orientation"));
    check("6d. a non-technical competency PDF is unchanged", ntText.includes("Non-Technical Competency Assessment") && ntText.includes("Non-Technical Competency Checklist") && ntText.includes("COMPETENCY ASSESSMENT COMPLETION") && ntText.includes("PASS"));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
