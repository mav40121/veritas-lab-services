#!/usr/bin/env node
// Receipt for the policy attestation-quiz GATE decision (PR 1, MediaLab parity #39).
// Mirrors the inline logic in server/routes.ts
//   POST /api/labs/:labId/veritapolicy/attestations/:id/complete
// The lab opts in (quiz_requires_pass = 1) AND sets a numeric threshold; only
// then is completion blocked. Record-only (0), ungated (null), and misconfigured
// (gating on but no threshold) never block. Keep this function identical to the
// endpoint; if the endpoint logic changes, change this too.

function gateDecision({ quiz_requires_pass, quiz_pass_threshold, quiz_score }) {
  if (quiz_requires_pass !== 1 || quiz_pass_threshold == null) return { allow: true, reason: "not_gated" };
  if (quiz_score == null) return { allow: false, reason: "quiz_required" };
  if (quiz_score < quiz_pass_threshold) return { allow: false, reason: "quiz_not_passed" };
  return { allow: true, reason: "passed" };
}

const cases = [
  { name: "ungated (requires_pass null)",            in: { quiz_requires_pass: null, quiz_pass_threshold: null, quiz_score: null }, allow: true,  reason: "not_gated" },
  { name: "record-only (requires_pass 0)",           in: { quiz_requires_pass: 0,    quiz_pass_threshold: null, quiz_score: 10 },   allow: true,  reason: "not_gated" },
  { name: "gating on but threshold unset (misconfig)", in: { quiz_requires_pass: 1,  quiz_pass_threshold: null, quiz_score: 0 },    allow: true,  reason: "not_gated" },
  { name: "gated 80, no quiz taken (no score)",      in: { quiz_requires_pass: 1, quiz_pass_threshold: 80,  quiz_score: null },     allow: false, reason: "quiz_required" },
  { name: "gated 80, score 79 (just below)",         in: { quiz_requires_pass: 1, quiz_pass_threshold: 80,  quiz_score: 79 },       allow: false, reason: "quiz_not_passed" },
  { name: "gated 80, score 80 (at threshold)",       in: { quiz_requires_pass: 1, quiz_pass_threshold: 80,  quiz_score: 80 },       allow: true,  reason: "passed" },
  { name: "gated 80, score 100",                     in: { quiz_requires_pass: 1, quiz_pass_threshold: 80,  quiz_score: 100 },      allow: true,  reason: "passed" },
  { name: "gated 100, score 99 (strict threshold)",  in: { quiz_requires_pass: 1, quiz_pass_threshold: 100, quiz_score: 99 },       allow: false, reason: "quiz_not_passed" },
  { name: "gated 1, score 0 (lowest threshold)",     in: { quiz_requires_pass: 1, quiz_pass_threshold: 1,   quiz_score: 0 },        allow: false, reason: "quiz_not_passed" },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const r = gateDecision(c.in);
  const ok = r.allow === c.allow && r.reason === c.reason;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}  ->  allow=${r.allow} reason=${r.reason}`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${cases.length} passed`);
process.exit(fail === 0 ? 0 : 1);
