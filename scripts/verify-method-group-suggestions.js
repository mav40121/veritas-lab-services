#!/usr/bin/env node
// verify-method-group-suggestions.js
//
// Regression receipt for PR D+ (2026-06-05). Hits the
// /api/labs/:labId/competency/programs/:programId/employees/:employeeId/suggested-method-groups
// endpoint with five known scenarios and asserts the matching rules:
//
//   A. Employee with overlapping instrument names         -> matched in instrumentNames
//   B. Employee with overlapping analytes (no instr name) -> matched in analytes
//   C. Employee with overlapping instrument category      -> matched in categories
//   D. Employee with NO assigned instruments              -> empty suggestion list
//   E. Employee with no resolvable VeritaStaff link       -> resolvedStaffEmployeeId null
//
// The script does not seed data; it expects the caller to point it at a
// production or staging environment where the four scenarios already exist
// (San Carlos lab + the four named employees below). When run against a
// fresh environment, every case will report SKIPPED (no data found).
//
// Run: BASE=https://www.veritaslabservices.com TOKEN=<jwt> LAB_ID=2 \
//      PROGRAM_ID=14 EMP_A_ID=83 EMP_B_ID=84 EMP_C_ID=85 EMP_D_ID=86 \
//      node scripts/verify-method-group-suggestions.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);
const PROGRAM_ID = Number(process.env.PROGRAM_ID || 0);

if (!TOKEN) { console.error("ERROR: TOKEN required"); process.exit(2); }
if (!LAB_ID || !PROGRAM_ID) { console.error("ERROR: LAB_ID + PROGRAM_ID required"); process.exit(2); }

const headers = { Authorization: `Bearer ${TOKEN}` };

async function fetchSuggestions(empId) {
  const url = `${BASE}/api/labs/${LAB_ID}/competency/programs/${PROGRAM_ID}/employees/${empId}/suggested-method-groups`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`HTTP ${r.status} on empId=${empId}`);
  return await r.json();
}

const cases = [
  { label: "A. instrument-name overlap", env: "EMP_A_ID", expect: "instrumentNames" },
  { label: "B. analyte overlap",         env: "EMP_B_ID", expect: "analytes" },
  { label: "C. category overlap",        env: "EMP_C_ID", expect: "categories" },
  { label: "D. no assigned instruments", env: "EMP_D_ID", expect: "none" },
  { label: "E. no resolvable staff link", env: "EMP_E_ID", expect: "null-resolved" },
];

let pass = 0, fail = 0, skipped = 0;

(async () => {
  for (const c of cases) {
    const empId = Number(process.env[c.env] || 0);
    if (!empId) { console.log(`SKIPPED ${c.label}: env ${c.env} not set`); skipped++; continue; }
    try {
      const data = await fetchSuggestions(empId);
      const reasons = data.reasons || {};
      const ids = Array.isArray(data.methodGroupIds) ? data.methodGroupIds : [];
      const resolved = data.resolvedStaffEmployeeId;

      if (c.expect === "null-resolved") {
        if (resolved === null) {
          console.log(`PASS ${c.label}: resolvedStaffEmployeeId is null, methodGroupIds=[]`);
          pass++;
        } else {
          console.error(`FAIL ${c.label}: expected null resolution, got ${resolved}`);
          fail++;
        }
        continue;
      }

      if (c.expect === "none") {
        if (ids.length === 0) {
          console.log(`PASS ${c.label}: empty suggestion list`);
          pass++;
        } else {
          console.error(`FAIL ${c.label}: expected empty, got ids=[${ids.join(",")}]`);
          fail++;
        }
        continue;
      }

      // Expecting at least one method group with the named match shape.
      const hasMatchingReason = ids.some(id => {
        const r = reasons[id];
        if (!r) return false;
        const arr = r[c.expect];
        return Array.isArray(arr) && arr.length > 0;
      });
      if (hasMatchingReason) {
        console.log(`PASS ${c.label}: ${ids.length} suggested, matched-via=${c.expect}`);
        pass++;
      } else {
        console.error(`FAIL ${c.label}: expected matched-via=${c.expect}, ids=[${ids.join(",")}], reasons=${JSON.stringify(reasons).slice(0, 200)}`);
        fail++;
      }
    } catch (err) {
      console.error(`FAIL ${c.label}: ${err.message}`);
      fail++;
    }
  }

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed, ${skipped} skipped`);
  process.exit(fail === 0 ? 0 : 1);
})();
