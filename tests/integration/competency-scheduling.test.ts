// tests/integration/competency-scheduling.test.ts
//
// STANDING integration test for the competency-scheduling engine wiring (2026-10-03).
//
// It boots the REAL Express routes against a throwaway SQLite DB and drives real HTTP:
// set up a staff lab, create a testing employee, record competency milestones, and
// assert the staff_competency_schedules due dates the recording endpoint persists.
// This proves the endpoint feeds the right lab/employee fields into the regulatory
// engine (server/competencySchedule.ts) and stores the correct columns -- the gap the
// pure-function receipt (scripts/verify-competency-cadence.ts) cannot cover.
//
// Core regressions it locks down:
//   1. CLIA non-waived sets a 1st-annual due (the old inline math skipped it).
//   2. A waived-only tester gets NO 6-month due (no over-application).
//   3. NYS non-waived is HIRE-anchored (six-month = hire+6, not initial+6).
//   4. The create-time seed only hire-anchors NYS non-waived; others stay null.
//
// Run: see package.json "test:competency-scheduling".

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
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
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;

  const req = (method: string, path: string, body?: unknown, token?: string) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const post = (p: string, b?: unknown, t?: string) => req("POST", p, b, t);
  const put = (p: string, b?: unknown, t?: string) => req("PUT", p, b, t);

  try {
    // Register the owner, then grant a paid plan directly in the throwaway DB so the
    // VeritaStaff subscription gate (hasStaffAccess) + requireWriteAccess both pass.
    const email = `it-comp-${Date.now()}@example.com`;
    const regRes = await post("/api/auth/register", {
      email, password: "testpass123", name: "Competency IT",
      hipaa_acknowledged: true, plan: "free",
      hospital_name: "IT Hospital", hospital_state: "MA", bed_count: 100,
    });
    const reg: any = await regRes.json().catch(() => ({}));
    const token = reg?.token;
    const userId = reg?.user?.id;
    check("register ok", regRes.status === 200 && !!token && !!userId, `status=${regRes.status}`);
    (db as any).$client.prepare("UPDATE users SET plan='hospital' WHERE id=?").run(userId);

    // ── CLIA (non-NYS) lab ────────────────────────────────────────────────────
    const labRes = await post("/api/staff/lab", {
      labName: "IT CLIA Lab", cliaNumber: "22D0000001",
      accreditationBody: "CLIA_ONLY", includesNys: false, complexity: "high",
    }, token);
    check("CLIA lab setup ok", labRes.status === 200, `status=${labRes.status} ${JSON.stringify(await labRes.clone().json().catch(()=>({}))).slice(0,160)}`);

    // Create a non-waived testing employee hired 2026-01-01.
    const emp1Res = await post("/api/staff/employees", {
      lastName: "Testa", firstName: "Nina", hireDate: "2026-01-01",
      highestComplexity: "H", performsTesting: true, roles: [],
    }, token);
    const emp1: any = await emp1Res.json().catch(() => ({}));
    check("CLIA employee created", emp1Res.status === 200 && !!emp1?.id, `status=${emp1Res.status}`);
    // Create-time seed for CLIA non-NYS = all null (waits for the recorded initial).
    const s1 = emp1?.competencySchedule || {};
    check("CLIA create seed: six_month_due null", s1.six_month_due_at == null, `six=${s1.six_month_due_at}`);
    check("CLIA create seed: annual_due null", s1.annual_due_at == null, `annual=${s1.annual_due_at}`);

    // Record the INITIAL competency -> six-month due = initial + 6 months.
    const r1 = await put(`/api/staff/competency/${emp1.id}`, { initialCompletedAt: "2026-05-15" }, token);
    const sched1: any = await r1.json().catch(() => ({}));
    check("CLIA initial -> six_month_due = 2026-11-15", r1.status === 200 && sched1.six_month_due_at === "2026-11-15", `six=${sched1.six_month_due_at}`);
    check("CLIA initial -> first_annual/annual still null", sched1.first_annual_due_at == null && sched1.annual_due_at == null, `fa=${sched1.first_annual_due_at} an=${sched1.annual_due_at}`);

    // Record the 6-MONTH too -> 1st-annual due = six-month completion + 6 months.
    // (The OLD inline CLIA math skipped the 1st annual entirely; this is the fix.)
    const r2 = await put(`/api/staff/competency/${emp1.id}`, { initialCompletedAt: "2026-05-15", sixMonthCompletedAt: "2026-11-20" }, token);
    const sched2: any = await r2.json().catch(() => ({}));
    check("CLIA 6-month -> first_annual_due = 2027-05-20 (1st-annual fix)", r2.status === 200 && sched2.first_annual_due_at === "2027-05-20", `fa=${sched2.first_annual_due_at}`);

    // ── Flip the lab to NYS, then prove hire-anchoring ──────────────────────────
    const nysLabRes = await post("/api/staff/lab", {
      labName: "IT CLIA Lab", cliaNumber: "22D0000001",
      accreditationBody: "CLIA_ONLY", includesNys: true, complexity: "high",
    }, token);
    check("NYS flip ok", nysLabRes.status === 200, `status=${nysLabRes.status}`);

    const emp2Res = await post("/api/staff/employees", {
      lastName: "Yorke", firstName: "Sam", hireDate: "2026-01-01",
      highestComplexity: "H", performsTesting: true, roles: [],
    }, token);
    const emp2: any = await emp2Res.json().catch(() => ({}));
    check("NYS employee created", emp2Res.status === 200 && !!emp2?.id, `status=${emp2Res.status}`);
    // NYS non-waived create seed IS hire-anchored: six=hire+6=2026-07-01.
    check("NYS create seed: six_month_due = 2026-07-01 (hire+6)", (emp2?.competencySchedule || {}).six_month_due_at === "2026-07-01", `six=${(emp2?.competencySchedule||{}).six_month_due_at}`);

    // Record the initial on a DIFFERENT date; six-month stays hire-anchored (hire+6),
    // NOT initial+6 (which would be 2026-09-01). This is the NYS-vs-national distinction.
    const r3 = await put(`/api/staff/competency/${emp2.id}`, { initialCompletedAt: "2026-03-01" }, token);
    const sched3: any = await r3.json().catch(() => ({}));
    check("NYS initial(Mar 1) -> six_month_due stays 2026-07-01 (hire-anchored)", r3.status === 200 && sched3.six_month_due_at === "2026-07-01", `six=${sched3.six_month_due_at}`);

    // ── Waived tester: NO 6-month, annual only ──────────────────────────────────
    const emp3Res = await post("/api/staff/employees", {
      lastName: "Ward", firstName: "Lee", hireDate: "2026-01-01",
      highestComplexity: "W", performsTesting: true, roles: [],
    }, token);
    const emp3: any = await emp3Res.json().catch(() => ({}));
    check("Waived employee created", emp3Res.status === 200 && !!emp3?.id, `status=${emp3Res.status}`);
    // Waived create seed = all null even on an NYS lab (waived never hire-anchored).
    check("Waived create seed: six_month_due null", (emp3?.competencySchedule || {}).six_month_due_at == null, `six=${(emp3?.competencySchedule||{}).six_month_due_at}`);

    const r4 = await put(`/api/staff/competency/${emp3.id}`, { initialCompletedAt: "2026-05-15" }, token);
    const sched4: any = await r4.json().catch(() => ({}));
    check("Waived initial -> six_month_due null (no over-application)", r4.status === 200 && sched4.six_month_due_at == null, `six=${sched4.six_month_due_at}`);
    check("Waived initial -> annual_due = 2027-05-15", sched4.annual_due_at === "2027-05-15", `annual=${sched4.annual_due_at}`);
  } finally {
    server.close();
  }

  console.log(`\nTOTAL: ${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
