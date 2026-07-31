#!/usr/bin/env node
/**
 * verify-account-clia-mirror.js
 *
 * Receipt for the cross-lab identity-bleed fix (2026-07-31) in the
 * PUT /api/account/settings handler (server/routes.ts).
 *
 * The bug: the handler updated the labs row for the ACTIVE lab (correct) and
 * then unconditionally mirrored that lab's CLIA number + name onto the
 * caller's OWN users row ("for PDF generation"). When a consultant/member
 * edited a CLIENT lab they do not own (e.g. Troy Regional, owner user 57),
 * the client's CLIA got stamped onto the consultant's personal account
 * (user 17), and the admin report -- which groups hosted seats by
 * owner.clia_lab_name -- then showed the consultant's seats under the client
 * lab. That is exactly how "someone at Faith Medical showed as part of Troy".
 *
 * The fix: only run the users-row mirror when lab.owner_user_id === req.userId.
 *
 * This script re-implements the guard as a pure decision and asserts the
 * users row is written ONLY in the owner case, across the representative
 * inputs (including the concrete Troy case).
 */

// Mirror of the production guard. Returns the users-row write that WOULD run,
// or null when the mirror is correctly skipped.
function mirrorAccountIdentity({ lab, userId, submitted, prevUser }) {
  // labs row is always updated with `submitted` upstream; not modeled here.
  if (lab.owner_user_id === userId) {
    return {
      clia_number: submitted.clia_number || null,
      clia_lab_name: submitted.clia_lab_name || null,
      user_id: userId,
    };
  }
  // Skipped: the caller's account identity is left untouched.
  return null;
}

const cases = [
  {
    name: "owner edits their OWN lab -> mirror fires",
    lab: { id: 3, owner_user_id: 17 },
    userId: 17,
    submitted: { clia_number: "55D5555555", clia_lab_name: "Michaels Lab" },
    prevUser: { clia_number: "55D5555555", clia_lab_name: "Michaels Lab" },
    expectWrite: true,
    expectUserAfter: { clia_number: "55D5555555", clia_lab_name: "Michaels Lab" },
  },
  {
    name: "CONSULTANT edits Troy (owner 57) -> mirror SKIPPED, account preserved",
    lab: { id: 17, owner_user_id: 57 },
    userId: 17,
    submitted: { clia_number: "01D0303925", clia_lab_name: "Troy Regional Medical Center" },
    prevUser: { clia_number: "55D5555555", clia_lab_name: "Michaels Lab" },
    expectWrite: false,
    expectUserAfter: { clia_number: "55D5555555", clia_lab_name: "Michaels Lab" },
  },
  {
    name: "owner edits a DIFFERENT lab they also own -> mirror fires (intra-owner, unchanged)",
    lab: { id: 14, owner_user_id: 17 },
    userId: 17,
    submitted: { clia_number: "14D1414141", clia_lab_name: "Faith Medical Center" },
    prevUser: { clia_number: "55D5555555", clia_lab_name: "Michaels Lab" },
    expectWrite: true,
    expectUserAfter: { clia_number: "14D1414141", clia_lab_name: "Faith Medical Center" },
  },
  {
    name: "newly-created lab (owner === caller) -> mirror fires",
    lab: { id: 99, owner_user_id: 42 },
    userId: 42,
    submitted: { clia_number: "22D0000001", clia_lab_name: "Brand New Lab" },
    prevUser: { clia_number: null, clia_lab_name: null },
    expectWrite: true,
    expectUserAfter: { clia_number: "22D0000001", clia_lab_name: "Brand New Lab" },
  },
  {
    name: "seat user editing a lab owned by someone else -> mirror SKIPPED",
    lab: { id: 3, owner_user_id: 17 },
    userId: 59,
    submitted: { clia_number: "55D5555555", clia_lab_name: "Michaels Lab" },
    prevUser: { clia_number: "99D9999999", clia_lab_name: "Huiyuan Home Lab" },
    expectWrite: false,
    expectUserAfter: { clia_number: "99D9999999", clia_lab_name: "Huiyuan Home Lab" },
  },
];

let failures = 0;
for (const c of cases) {
  const write = mirrorAccountIdentity(c);
  const wrote = write !== null;
  // Apply the simulated write to derive the resulting user identity.
  const after = wrote
    ? { clia_number: write.clia_number, clia_lab_name: write.clia_lab_name }
    : { clia_number: c.prevUser.clia_number, clia_lab_name: c.prevUser.clia_lab_name };

  const writeOk = wrote === c.expectWrite;
  const afterOk =
    after.clia_number === c.expectUserAfter.clia_number &&
    after.clia_lab_name === c.expectUserAfter.clia_lab_name;

  if (writeOk && afterOk) {
    console.log(`PASS  ${c.name}`);
  } else {
    failures++;
    console.log(`FAIL  ${c.name}`);
    console.log(`        write expected=${c.expectWrite} got=${wrote}`);
    console.log(`        user  expected=${JSON.stringify(c.expectUserAfter)} got=${JSON.stringify(after)}`);
  }
}

console.log(`\n${cases.length - failures}/${cases.length} cases passed.`);
if (failures > 0) {
  console.error(`${failures} case(s) FAILED.`);
  process.exit(1);
}
console.log("All account-CLIA mirror guard cases passed.");
