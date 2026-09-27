// scripts/verify-policy-signature-report.mts
//
// Receipt for LHF-7 (combined per-policy signature report). Exercises the pure
// roster join that fuses writer attestations with Staff Portal kiosk signatures:
//   - a completed attestation -> Signed; an open one -> Pending
//   - a completed attestation on an OLD version -> Signed + "Signed an earlier version"
//   - every kiosk staff signature -> Signed (no assigned date)
//   - ordering: Pending first (what a surveyor/director chases), then Signed,
//     each block alphabetical by name
//   - the summary counts (total / signed / pending / writers / staff)
//
// Run: npx tsx scripts/verify-policy-signature-report.mts   (exits non-zero on fail)

import { buildSignatureReportRows, signatureReportSummary } from "../server/policySignatureReport";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

// A representative document: two writers assigned (one signed current, one still
// pending), one writer who signed an OLD version, and two bench-staff kiosk signs.
const attestations = [
  { assignee_name: "Rivera, Ana", assignee_email: "ana@lab.test", assigned_at: "2026-09-01T10:00:00Z", completed_at: "2026-09-03T14:00:00Z", is_stale_version: false },
  { assignee_name: "Baker, Tom", assignee_email: "tom@lab.test", assigned_at: "2026-09-01T10:00:00Z", completed_at: null, is_stale_version: false },
  { assignee_name: "Chen, Wei", assignee_email: "wei@lab.test", assigned_at: "2026-06-01T10:00:00Z", completed_at: "2026-06-05T09:00:00Z", is_stale_version: true },
];
const staffSignatures = [
  { signer_name: "Zimmer, Kay", signer_title: "MLT", signed_at: "2026-09-10T08:00:00Z" },
  { signer_name: "Adams, Lee", signer_title: "Phlebotomist", signed_at: "2026-09-11T08:00:00Z" },
];

const rows = buildSignatureReportRows({ attestations, staffSignatures });
const sum = signatureReportSummary(rows);

// 1) Row count = attestations + staff signatures.
check("row count = 3 writers + 2 staff", rows.length === 5, String(rows.length));

// 2) Summary math.
check("summary total = 5", sum.total === 5);
check("summary signed = 4 (2 writers current+stale, 2 staff)", sum.signed === 4, String(sum.signed));
check("summary pending = 1 (Baker)", sum.pending === 1, String(sum.pending));
check("summary writers = 3", sum.writers === 3, String(sum.writers));
check("summary staff = 2", sum.staff === 2, String(sum.staff));

// 3) Pending sorts to the top.
check("first row is Pending", rows[0].status === "Pending", rows[0].name);
check("only one Pending row and it is Baker", rows.filter((r) => r.status === "Pending").length === 1 && rows[0].name === "Baker, Tom");

// 4) Signed block is alphabetical by name (Adams, Chen, Rivera, Zimmer).
const signedNames = rows.filter((r) => r.status === "Signed").map((r) => r.name);
check("signed block alphabetical", JSON.stringify(signedNames) === JSON.stringify(["Adams, Lee", "Chen, Wei", "Rivera, Ana", "Zimmer, Kay"]), signedNames.join(" | "));

// 5) Stale-version note only on the old-version signer (Chen), not the current one.
const chen = rows.find((r) => r.name === "Chen, Wei")!;
const rivera = rows.find((r) => r.name === "Rivera, Ana")!;
check("stale signer flagged", chen.note === "Signed an earlier version", chen.note);
check("current signer not flagged", rivera.note === "", `"${rivera.note}"`);

// 6) Kiosk rows: staff kind, title in detail, no assigned date, signed.
const kay = rows.find((r) => r.name === "Zimmer, Kay")!;
check("kiosk row kind", kay.kind === "Staff sign (kiosk)", kay.kind);
check("kiosk row detail = title", kay.detail === "MLT", kay.detail);
check("kiosk row has no assigned date", kay.assignedAt === "", `"${kay.assignedAt}"`);
check("kiosk row signed date is date-only", kay.signedAt === "2026-09-10", kay.signedAt);

// 7) Writer row carries email in detail and yyyy-mm-dd dates.
check("writer detail = email", rivera.detail === "ana@lab.test", rivera.detail);
check("writer signed date date-only", rivera.signedAt === "2026-09-03", rivera.signedAt);
check("writer assigned date date-only", rivera.assignedAt === "2026-09-01", rivera.assignedAt);

// 8) Empty inputs -> empty rows, zeroed summary (no crash, no fabricated rows).
{
  const empty = buildSignatureReportRows({ attestations: [], staffSignatures: [] });
  const es = signatureReportSummary(empty);
  check("empty inputs -> 0 rows", empty.length === 0);
  check("empty summary all zero", es.total === 0 && es.signed === 0 && es.pending === 0 && es.writers === 0 && es.staff === 0);
}

// 9) Missing name/date fields degrade to safe placeholders, not crashes.
{
  const rowsX = buildSignatureReportRows({
    attestations: [{ assignee_name: null, assignee_email: null, assigned_at: null, completed_at: null }],
    staffSignatures: [{ signer_name: null, signer_title: null, signed_at: null }],
  });
  const w = rowsX.find((r) => r.kind.startsWith("Writer"))!;
  const s = rowsX.find((r) => r.kind.startsWith("Staff"))!;
  check("missing writer name -> placeholder", w.name === "(unknown)", w.name);
  check("missing staff name -> placeholder", s.name === "(staff member)", s.name);
  check("null dates -> empty strings", w.assignedAt === "" && w.signedAt === "" && s.signedAt === "");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
