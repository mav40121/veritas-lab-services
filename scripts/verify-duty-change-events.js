#!/usr/bin/env node
// verify-duty-change-events.js
//
// Regression receipt for Wave H PR H4 (duty-change reassessment workflow).
// Confirms the diff-and-emit path on the instrument-assignment PUT:
//
//   A. Adding an instrument to an employee's assignment list emits a
//      staff_duty_change_event row visible on the GET endpoint.
//   B. Re-PUTing the same set does NOT emit a duplicate event.
//   C. Removing an instrument does NOT emit an event (removals are
//      intentionally ignored under standard CLIA reading).
//   D. Adding a SECOND new instrument adds a second event.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<JWT for a lab owner> \
//   LAB_ID=2 \
//   EMP_ID=42 \
//   INSTR_ID_A=11 INSTR_ID_B=12 \
//   node scripts/verify-duty-change-events.js
//
// Exits non-zero on any branch failure. NOTE: mutates the employee's
// instrument assignments. Use a disposable test employee.

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);
const EMP_ID = Number(process.env.EMP_ID || 0);
const INSTR_A = Number(process.env.INSTR_ID_A || 0);
const INSTR_B = Number(process.env.INSTR_ID_B || 0);

if (!TOKEN) { console.error("ERROR: TOKEN env var required"); process.exit(2); }
if (!LAB_ID || !EMP_ID || !INSTR_A || !INSTR_B) {
  console.error("ERROR: LAB_ID, EMP_ID, INSTR_ID_A, INSTR_ID_B all required");
  process.exit(2);
}

const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function putAssignment(ids) {
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/staff/employees/${EMP_ID}/instruments`, {
    method: "PUT", headers: H, body: JSON.stringify({ instrumentIds: ids }),
  });
  if (!r.ok) throw new Error(`PUT failed: ${r.status} ${await r.text()}`);
  return r.json();
}
async function getOpenEvents() {
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/staff/duty-change-events`, { headers: H });
  if (!r.ok) throw new Error(`GET failed: ${r.status} ${await r.text()}`);
  return r.json();
}

(async () => {
  let pass = 0, fail = 0;

  // Baseline: clear the employee's assignments.
  await putAssignment([]);
  const baseline = await getOpenEvents();
  const baselineForEmp = baseline.filter(e => e.employeeId === EMP_ID).length;
  console.log(`Baseline: ${baselineForEmp} open events for emp_id=${EMP_ID} before mutations.`);

  // ── Branch A: add INSTR_A, expect +1 event ──
  const putA = await putAssignment([INSTR_A]);
  console.log(`Branch A PUT: dutyChangeEventsCreated=${putA.dutyChangeEventsCreated}`);
  const afterA = await getOpenEvents();
  const afterAForEmp = afterA.filter(e => e.employeeId === EMP_ID).length;
  if (afterAForEmp === baselineForEmp + 1 && putA.dutyChangeEventsCreated === 1) {
    console.log(`PASS Branch A (add 1 instrument): +1 open event`);
    pass++;
  } else {
    console.error(`FAIL Branch A: baseline+${afterAForEmp - baselineForEmp} (expected baseline+1)`);
    fail++;
  }

  // ── Branch B: re-PUT the same set, expect 0 new events ──
  const putB = await putAssignment([INSTR_A]);
  const afterB = await getOpenEvents();
  const afterBForEmp = afterB.filter(e => e.employeeId === EMP_ID).length;
  if (putB.dutyChangeEventsCreated === 0 && afterBForEmp === afterAForEmp) {
    console.log(`PASS Branch B (idempotent re-PUT): no new events`);
    pass++;
  } else {
    console.error(`FAIL Branch B: dutyChangeEventsCreated=${putB.dutyChangeEventsCreated} (expected 0)`);
    fail++;
  }

  // ── Branch C: remove INSTR_A, expect 0 new events ──
  const putC = await putAssignment([]);
  const afterC = await getOpenEvents();
  const afterCForEmp = afterC.filter(e => e.employeeId === EMP_ID).length;
  if (putC.dutyChangeEventsCreated === 0 && afterCForEmp === afterBForEmp) {
    console.log(`PASS Branch C (removal does not emit event): no new events on remove`);
    pass++;
  } else {
    console.error(`FAIL Branch C: dutyChangeEventsCreated=${putC.dutyChangeEventsCreated} (expected 0)`);
    fail++;
  }

  // ── Branch D: add INSTR_B (fresh), expect +1 event ──
  const putD = await putAssignment([INSTR_B]);
  const afterD = await getOpenEvents();
  const afterDForEmp = afterD.filter(e => e.employeeId === EMP_ID).length;
  if (putD.dutyChangeEventsCreated === 1 && afterDForEmp === afterCForEmp + 1) {
    console.log(`PASS Branch D (add fresh instrument): +1 open event`);
    pass++;
  } else {
    console.error(`FAIL Branch D: dutyChangeEventsCreated=${putD.dutyChangeEventsCreated} (expected 1)`);
    fail++;
  }

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
