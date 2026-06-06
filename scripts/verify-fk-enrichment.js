#!/usr/bin/env node
// verify-fk-enrichment.js
//
// Regression receipt for PR #569 + #570 (Phase B3 lite of the VeritaComp
// employee-table unification). Hits the lab-scoped program detail
// endpoint and asserts that the LEFT JOIN to staff_employees behaves
// correctly on both branches:
//
//   A. FK-matched comp_emp -> staff_employee_id + staff_first_name +
//      staff_last_name populate in the assessment rows; legacy
//      employee_name still present as the source-of-truth fallback.
//
//   B. FK-NULL comp_emp -> staff_employee_id is null; staff_first_name
//      and staff_last_name are null; legacy employee_name continues to
//      carry the rendering value.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<JWT for a lab member or owner> \
//   LAB_ID=2 \
//   PROGRAM_ID=14 \
//   node scripts/verify-fk-enrichment.js
//
// Exits non-zero on any branch failure.

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);
const PROGRAM_ID = Number(process.env.PROGRAM_ID || 0);

if (!TOKEN) { console.error("ERROR: TOKEN env var required"); process.exit(2); }
if (!LAB_ID) { console.error("ERROR: LAB_ID env var required"); process.exit(2); }
if (!PROGRAM_ID) { console.error("ERROR: PROGRAM_ID env var required"); process.exit(2); }

(async () => {
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/competency/programs/${PROGRAM_ID}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!r.ok) {
    console.error(`ERROR: ${r.status} ${await r.text()}`);
    process.exit(1);
  }
  const data = await r.json();
  const assessments = Array.isArray(data.assessments) ? data.assessments : [];
  console.log(`Program "${data.name}", ${assessments.length} assessments, ${(data.employees || []).length} employees`);

  // Each branch's row sample. Skip the branch if no row of that shape exists
  // in this program (cannot fail the script on absent data).
  const fkMatched = assessments.filter(a => a.staff_employee_id != null);
  const fkNull = assessments.filter(a => a.staff_employee_id == null);

  let pass = 0, fail = 0, skipped = 0;

  // Branch A: FK matched
  if (fkMatched.length === 0) {
    console.log("SKIPPED Branch A (no FK-matched assessments in this program)");
    skipped++;
  } else {
    const a = fkMatched[0];
    const okFkPresent = typeof a.staff_employee_id === "number" && a.staff_employee_id > 0;
    const okStaffFirst = typeof a.staff_first_name === "string" && a.staff_first_name.length > 0;
    const okStaffLast = typeof a.staff_last_name === "string" && a.staff_last_name.length > 0;
    const okEmpName = typeof a.employee_name === "string" && a.employee_name.length > 0;
    if (okFkPresent && okStaffFirst && okStaffLast && okEmpName) {
      console.log(`PASS Branch A (FK matched): asmt=${a.id} comp_emp=${a.employee_id} staff_emp=${a.staff_employee_id} staff="${a.staff_first_name} ${a.staff_last_name}" legacy="${a.employee_name}"`);
      pass++;
    } else {
      console.error(`FAIL Branch A: asmt=${a.id} fk=${okFkPresent} first=${okStaffFirst} last=${okStaffLast} legacy=${okEmpName}`);
      fail++;
    }
  }

  // Branch B: FK null
  if (fkNull.length === 0) {
    console.log("SKIPPED Branch B (no FK-NULL assessments in this program)");
    skipped++;
  } else {
    const a = fkNull[0];
    const okFkNull = a.staff_employee_id == null;
    const okStaffFirstNull = a.staff_first_name == null;
    const okStaffLastNull = a.staff_last_name == null;
    const okEmpName = typeof a.employee_name === "string" && a.employee_name.length > 0;
    if (okFkNull && okStaffFirstNull && okStaffLastNull && okEmpName) {
      console.log(`PASS Branch B (FK NULL): asmt=${a.id} comp_emp=${a.employee_id} staff_emp=null staff=null+null legacy="${a.employee_name}"`);
      pass++;
    } else {
      console.error(`FAIL Branch B: asmt=${a.id} fkNull=${okFkNull} firstNull=${okStaffFirstNull} lastNull=${okStaffLastNull} legacy=${okEmpName}`);
      fail++;
    }
  }

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed, ${skipped} skipped`);
  process.exit(fail === 0 ? 0 : 1);
})();
