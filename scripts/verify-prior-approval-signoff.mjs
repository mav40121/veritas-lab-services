// scripts/verify-prior-approval-signoff.mjs
// Proves the VeritaComp prior-approval sign-off rule: a competency signed on
// paper on an earlier date and entered later. When the signed date is not today,
// written documentation is REQUIRED; completion_date stays the true in-system
// entry timestamp, and the historical date goes in signed_on_paper_date.
// Mirrors the exact decision logic in the sign endpoint (server/routes.ts).
// Run: node scripts/verify-prior-approval-signoff.mjs

let pass = 0, fail = 0;
const check = (n, c) => { if (c) { pass++; console.log("PASS  " + n); } else { fail++; console.log("FAIL  " + n); } };

// Mirror of the sign endpoint. Returns { error } (rejected) or the stored row.
function sign({ signed_on_paper_date, documentation }, nowIso) {
  const todayDate = nowIso.slice(0, 10);
  const signedOnPaperRaw = typeof signed_on_paper_date === "string" ? signed_on_paper_date.trim() : "";
  const isBackDated = !!signedOnPaperRaw && signedOnPaperRaw.slice(0, 10) !== todayDate;
  const doc = typeof documentation === "string" ? documentation.trim() : "";
  if (isBackDated && !doc) return { error: "Written documentation is required when the signed date is not today." };
  const signedOnPaper = isBackDated ? signedOnPaperRaw.slice(0, 10) : null;
  const priorNote = isBackDated ? doc : null;
  return { completion_date: nowIso, locked: 1, signed_on_paper_date: signedOnPaper, prior_approval_note: priorNote };
}

const NOW = "2026-07-06T17:00:00.000Z"; // entry timestamp
const TODAY = "2026-07-06";

// 1. Normal sign today, no documentation -> allowed, not a prior approval.
const r1 = sign({}, NOW);
check("today sign with no date needs no documentation", !r1.error && r1.signed_on_paper_date === null && r1.prior_approval_note === null);

// 2. Explicit today's date, no documentation -> allowed (same day is not back-dated).
const r2 = sign({ signed_on_paper_date: TODAY }, NOW);
check("explicit today's date needs no documentation", !r2.error && r2.signed_on_paper_date === null);

// 3. Past date, NO documentation -> REJECTED.
const r3 = sign({ signed_on_paper_date: "2025-07-06" }, NOW);
check("past date without documentation is rejected", !!r3.error && r3.error.includes("documentation is required"));

// 4. Past date WITH documentation -> allowed, stores both dates + the note.
const r4 = sign({ signed_on_paper_date: "2025-07-06", documentation: "Signed on paper 7/6/2025; scan attached. Entered late." }, NOW);
check("past date with documentation is accepted", !r4.error);
check("signed_on_paper_date stores the historical paper date", r4.signed_on_paper_date === "2025-07-06");
check("completion_date stays the true in-system entry timestamp (not the paper date)", r4.completion_date === NOW);
check("the documentation is stored as the prior-approval note", r4.prior_approval_note === "Signed on paper 7/6/2025; scan attached. Entered late.");
check("prior approval is locked on sign", r4.locked === 1);

// 5. A date that is not today but with only whitespace documentation -> REJECTED.
const r5 = sign({ signed_on_paper_date: "2026-01-15", documentation: "   " }, NOW);
check("whitespace-only documentation on a back-date is rejected", !!r5.error);

// 6. A full ISO timestamp for the paper date is normalized to its date part.
const r6 = sign({ signed_on_paper_date: "2025-12-01T00:00:00.000Z", documentation: "paper on file" }, NOW);
check("an ISO paper date is normalized to YYYY-MM-DD", !r6.error && r6.signed_on_paper_date === "2025-12-01");

// 7. Repro of the gap this fixes: the old endpoint always stamped completion_date = now
//    with no way to record the historical paper date, so a late-entered paper sign-off
//    looked like it happened today. Now the historical date is preserved.
check("repro: the historical date is preserved separately from the entry date", r4.signed_on_paper_date !== r4.completion_date.slice(0, 10));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
