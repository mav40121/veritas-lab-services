// scripts/verify-veritacomp-quiz-results-scope.mjs
//
// Receipt for the cross-tenant IDOR fix on VeritaComp quiz results (2026-07-09
// security review). Before the fix:
//   - POST /api/veritacomp/quiz-results took quizId/assessmentId/employeeId from
//     the body and inserted a graded competency_quiz_results row with NO check
//     that those ids belong to the caller's lab -> any VeritaComp writer could
//     forge graded competency evidence into another lab's assessment.
//   - GET /api/veritacomp/assessments/:id/quiz-results returned any assessment's
//     graded quiz history by id with no lab scope -> cross-tenant read leak.
//
// This drives the NEGATIVE case only: pair the caller's token with ids that
// belong to a DIFFERENT lab and assert HTTP 404. The POST is non-mutating: the
// guard rejects before the INSERT runs. Skips (compile-safe) if env is absent.
//
// Env: BASE (default prod www), VERIFY_TOKEN (a VeritaComp-writer JWT),
// FOREIGN_QUIZ_ID (a quiz in another lab), FOREIGN_ASSESSMENT_ID (an assessment
// in another lab), FOREIGN_EMPLOYEE_ID (an employee in another lab).

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.VERIFY_TOKEN || "";
const QUIZ = process.env.FOREIGN_QUIZ_ID || "";
const ASSESS = process.env.FOREIGN_ASSESSMENT_ID || "";
const EMP = process.env.FOREIGN_EMPLOYEE_ID || "";

if (!TOKEN || (!QUIZ && !ASSESS)) {
  console.log("SKIP: set VERIFY_TOKEN + FOREIGN_QUIZ_ID/FOREIGN_ASSESSMENT_ID to run the live 404 check.");
  process.exit(0);
}

const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
let fails = 0;
async function check(label, method, url, body) {
  const r = await fetch(`${BASE}${url}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const ok = r.status === 404;
  console.log(`${ok ? "PASS" : "FAIL"}: ${label} -> HTTP ${r.status} (want 404)`);
  if (!ok) fails++;
}

if (QUIZ) {
  // Forge attempt: post a graded result for a foreign quiz. Guard must 404 before insert.
  await check(
    "POST quiz-results with foreign quizId",
    "POST",
    "/api/veritacomp/quiz-results",
    { quizId: Number(QUIZ), employeeId: Number(EMP || 999999999), assessmentId: ASSESS ? Number(ASSESS) : null, answers: [] },
  );
}
if (ASSESS) {
  await check("GET quiz-results for foreign assessment", "GET", `/api/veritacomp/assessments/${ASSESS}/quiz-results`);
}

console.log(fails === 0
  ? "\n=== VERITACOMP QUIZ-RESULTS SCOPE: ALL PASS (foreign ids rejected) ==="
  : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
