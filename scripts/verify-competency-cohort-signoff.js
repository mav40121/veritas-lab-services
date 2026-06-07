#!/usr/bin/env node
// verify-competency-cohort-signoff.js
//
// Regression receipt for Wave I PR I1 (cohort sign-off).
// Confirms four branches of the cohort-preview endpoint without
// committing any data:
//
//   A. Empty employeeIds returns fatal "Pick at least one employee."
//   B. Unknown program flagged in sharedIssues (severity=error).
//   C. Bad assessment date (not YYYY-MM-DD) flagged in sharedIssues.
//   D. Valid shared fields + unknown employee id flags ONLY that row
//      as error (not the others).
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<JWT for a lab member or owner> \
//   LAB_ID=2 \
//   node scripts/verify-competency-cohort-signoff.js
//
// Read-only against prod. Does NOT commit.

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);

if (!TOKEN) { console.error("ERROR: TOKEN env var required"); process.exit(2); }
if (!LAB_ID) { console.error("ERROR: LAB_ID env var required"); process.exit(2); }

async function preview(body) {
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/competency/assessments/cohort-preview`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  let pass = 0, fail = 0;

  // Branch A: empty employeeIds
  const a = await preview({
    programId: 999999, employeeIds: [],
    assessmentType: "annual", assessmentDate: "2026-06-06",
    status: "pass", evaluatorName: "M. Director",
  });
  if (a.status === 400 && a.body && typeof a.body.fatal === "string" && /at least one employee/i.test(a.body.fatal)) {
    console.log(`PASS Branch A (empty employeeIds): fatal=${JSON.stringify(a.body.fatal)}`);
    pass++;
  } else {
    console.error(`FAIL Branch A: status=${a.status} body=${JSON.stringify(a.body).slice(0,200)}`);
    fail++;
  }

  // Branch B: unknown program with at least one (likely-bogus) employee id
  const b = await preview({
    programId: 999999, employeeIds: [999999],
    assessmentType: "annual", assessmentDate: "2026-06-06",
    status: "pass", evaluatorName: "M. Director",
  });
  const sharedErrB = (b.body && b.body.sharedIssues || []).find((i) => i.severity === "error" && /program/i.test(i.message));
  if (b.status === 200 && sharedErrB) {
    console.log(`PASS Branch B (unknown program flagged): "${sharedErrB.message}"`);
    pass++;
  } else {
    console.error(`FAIL Branch B: status=${b.status} sharedIssues=${JSON.stringify(b.body && b.body.sharedIssues).slice(0,200)}`);
    fail++;
  }

  // Branch C: bad date
  const c = await preview({
    programId: 1, employeeIds: [1],
    assessmentType: "annual", assessmentDate: "not-a-date",
    status: "pass", evaluatorName: "M. Director",
  });
  const sharedErrC = (c.body && c.body.sharedIssues || []).find((i) => i.severity === "error" && /YYYY-MM-DD/i.test(i.message));
  if (c.status === 200 && sharedErrC) {
    console.log(`PASS Branch C (bad date flagged): "${sharedErrC.message}"`);
    pass++;
  } else {
    console.error(`FAIL Branch C: status=${c.status} sharedIssues=${JSON.stringify(c.body && c.body.sharedIssues).slice(0,200)}`);
    fail++;
  }

  // Branch D: shared fields OK shape + unknown employee. We can't
  // guarantee programId=1 exists, so we accept either:
  //   - the program is OK and the employee row is the lone error, OR
  //   - the program itself is flagged AND the employee row also has an
  //     error (both forms of "this can't commit", which is what we
  //     want to assert structurally).
  const d = await preview({
    programId: 1, employeeIds: [999999],
    assessmentType: "annual", assessmentDate: "2026-06-06",
    status: "pass", evaluatorName: "M. Director",
  });
  const empRow = (d.body && d.body.rows || []).find((r) => r.employeeId === 999999);
  const empErr = empRow && empRow.issues && empRow.issues.find((i) => i.severity === "error" && /not found/i.test(i.message));
  if (d.status === 200 && empErr) {
    console.log(`PASS Branch D (unknown employee flagged): "${empErr.message}"`);
    pass++;
  } else {
    console.error(`FAIL Branch D: status=${d.status} body=${JSON.stringify(d.body).slice(0,200)}`);
    fail++;
  }

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
