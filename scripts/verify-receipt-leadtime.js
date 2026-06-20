// scripts/verify-receipt-leadtime.js
//
// Math receipt for the actual-lead-time computation logged by /receive
// (server/veritabench.ts). actual_lead_time_days = received - placed (whole
// days), or null when no order-placed date was on file. Mirrors the server
// logic so a change in one must change the other.
//
//   node scripts/verify-receipt-leadtime.js

function actualLeadTime(placedDate, receivedDate) {
  if (!placedDate) return null;
  const p = Date.parse(placedDate);
  const r = Date.parse(receivedDate);
  if (Number.isNaN(p) || Number.isNaN(r)) return null;
  return Math.round((r - p) / 86400000);
}

const cases = [
  { name: "12-day lead", placed: "2026-06-01", received: "2026-06-13", expect: 12 },
  { name: "same-day receipt", placed: "2026-06-10", received: "2026-06-10", expect: 0 },
  { name: "no placed date (legacy PO) -> null", placed: null, received: "2026-06-13", expect: null },
  { name: "received before placed (data error) -> negative, surfaced not hidden", placed: "2026-06-13", received: "2026-06-10", expect: -3 },
  { name: "crosses month boundary", placed: "2026-05-28", received: "2026-06-11", expect: 14 },
  { name: "unparseable placed date -> null", placed: "not-a-date", received: "2026-06-13", expect: null },
];

let failed = 0;
for (const c of cases) {
  const got = actualLeadTime(c.placed, c.received);
  if (got !== c.expect) {
    failed++;
    console.log(`FAIL  ${c.name}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
  } else {
    console.log(`PASS  ${c.name} -> ${JSON.stringify(got)}`);
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
