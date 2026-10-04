// Verify receipt for the VeritaDC attestation-tracker roster status.
// Exercises the SAME deriveAttestationStatus the roster endpoint calls
// (server/policyAttestationStatus.ts) across every branch + the edge cases.
//
// Run: npx tsx scripts/verify-veritadc-attestation-tracker.ts
// Exits non-zero on any failed case so it can gate CI later.

import { deriveAttestationStatus, type AttestationRosterStatus } from "../server/policyAttestationStatus";

const TODAY = "2026-10-04";

interface Case {
  name: string;
  completedAt: string | null;
  dueDate: string | null;
  lastOpenedAt: string | null;
  expect: AttestationRosterStatus;
}

const cases: Case[] = [
  // 1. Completed always wins, regardless of due/opened state.
  { name: "attested (completed, no due, no open)", completedAt: "2026-10-01T12:00:00Z", dueDate: null, lastOpenedAt: null, expect: "attested" },
  { name: "attested wins over a past due date", completedAt: "2026-10-03T09:00:00Z", dueDate: "2026-09-01", lastOpenedAt: "2026-10-02T08:00:00Z", expect: "attested" },
  // 2. Overdue: not completed, due date strictly in the past.
  { name: "overdue (past due, never opened)", completedAt: null, dueDate: "2026-10-03", lastOpenedAt: null, expect: "overdue" },
  { name: "overdue even though opened (open does not clear overdue)", completedAt: null, dueDate: "2026-09-15", lastOpenedAt: "2026-09-20T10:00:00Z", expect: "overdue" },
  // 3. Due date == today is NOT overdue (strict <).
  { name: "due today, opened -> opened (not overdue)", completedAt: null, dueDate: TODAY, lastOpenedAt: "2026-10-04T07:00:00Z", expect: "opened" },
  { name: "due today, not opened -> assigned (not overdue)", completedAt: null, dueDate: TODAY, lastOpenedAt: null, expect: "assigned" },
  // 4. Opened but not signed (future due or no due).
  { name: "opened, future due", completedAt: null, dueDate: "2026-12-01", lastOpenedAt: "2026-10-04T06:30:00Z", expect: "opened" },
  { name: "opened, no due", completedAt: null, dueDate: null, lastOpenedAt: "2026-10-02T06:30:00Z", expect: "opened" },
  // 5. Assigned, never opened, no/future due.
  { name: "assigned, no due, never opened", completedAt: null, dueDate: null, lastOpenedAt: null, expect: "assigned" },
  { name: "assigned, future due, never opened", completedAt: null, dueDate: "2026-11-30", lastOpenedAt: null, expect: "assigned" },
];

let pass = 0;
let fail = 0;
for (const c of cases) {
  const got = deriveAttestationStatus({
    completedAt: c.completedAt,
    dueDate: c.dueDate,
    lastOpenedAt: c.lastOpenedAt,
    todayStr: TODAY,
  });
  const ok = got === c.expect;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}  (expected ${c.expect}, got ${got})`);
}

console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
