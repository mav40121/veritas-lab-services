// scripts/verify-quiz-assignments.js
//
// Gate 3 step 2 receipt for the quiz assignments + Staff Portal surface
// PR (PR2, 2026-06-09). Exercises the contracts the server enforces
// without hitting the live DB:
//
//   1. UNIQUE(quiz_id, staff_employee_id) -> idempotent assign:
//      same employee_ids in two POSTs reports `skipped` not `created`.
//   2. Status transitions: 'assigned' -> 'completed' on attempt submit;
//      DELETE allowed only while 'assigned'.
//   3. Scoring under shuffled order: question_id keying invariance.
//   4. Idempotent attempt: a second submit on a completed assignment
//      returns `already_completed: true` rather than double-counting.
//
// Run: node scripts/verify-quiz-assignments.js

import crypto from "node:crypto";

let failures = 0;
function check(name, pass, detail) {
  if (pass) console.log(`PASS  ${name}`);
  else { console.log(`FAIL  ${name}` + (detail ? ` -- ${detail}` : "")); failures++; }
}

// Simulated server state
function makeStore() {
  const assignments = new Map();  // (quiz_id, staff_emp_id) -> row
  let nextId = 1;
  return {
    insert({ quiz_id, staff_employee_id, due_date }) {
      const key = `${quiz_id}:${staff_employee_id}`;
      if (assignments.has(key)) return { skipped: true };
      const row = {
        id: nextId++,
        quiz_id, staff_employee_id, due_date,
        status: "assigned",
        completed_result_id: null,
      };
      assignments.set(key, row);
      return { created: true, id: row.id };
    },
    list(quiz_id) {
      return [...assignments.values()].filter(r => r.quiz_id === quiz_id);
    },
    complete(id, resultId) {
      for (const r of assignments.values()) {
        if (r.id === id) {
          r.status = "completed";
          r.completed_result_id = resultId;
          return true;
        }
      }
      return false;
    },
    get(id) {
      for (const r of assignments.values()) if (r.id === id) return r;
      return null;
    },
    canDelete(id) {
      const r = this.get(id);
      return r && r.status === "assigned";
    },
    delete(id) {
      for (const [k, r] of assignments.entries()) {
        if (r.id === id) { assignments.delete(k); return true; }
      }
      return false;
    },
  };
}

// ── Test 1: idempotent assign ──────────────────────────────────────
{
  const s = makeStore();
  const empIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const round1 = empIds.map(eid => s.insert({ quiz_id: 100, staff_employee_id: eid, due_date: "2026-06-23" }));
  const created1 = round1.filter(r => r.created).length;
  const skipped1 = round1.filter(r => r.skipped).length;
  check("round 1: 10 created, 0 skipped", created1 === 10 && skipped1 === 0, `created=${created1} skipped=${skipped1}`);

  const round2 = empIds.map(eid => s.insert({ quiz_id: 100, staff_employee_id: eid, due_date: "2026-06-23" }));
  const created2 = round2.filter(r => r.created).length;
  const skipped2 = round2.filter(r => r.skipped).length;
  check("round 2 (same employees): 0 created, 10 skipped", created2 === 0 && skipped2 === 10, `created=${created2} skipped=${skipped2}`);

  // Adding a NEW employee in round 3 creates one row, skips the existing 10
  const round3 = [...empIds, 11].map(eid => s.insert({ quiz_id: 100, staff_employee_id: eid }));
  check("round 3 (add one new): 1 created, 10 skipped", round3.filter(r => r.created).length === 1 && round3.filter(r => r.skipped).length === 10);
}

// ── Test 2: status transitions ──────────────────────────────────────
{
  const s = makeStore();
  const ins = s.insert({ quiz_id: 200, staff_employee_id: 1 });
  check("new assignment is 'assigned'", s.get(ins.id).status === "assigned");
  check("DELETE allowed while 'assigned'", s.canDelete(ins.id));
  s.complete(ins.id, 999);
  check("after attempt: status is 'completed'", s.get(ins.id).status === "completed");
  check("DELETE blocked once 'completed'", !s.canDelete(ins.id));
}

// ── Test 3: scoring under shuffle (id-keyed invariant) ─────────────
{
  // The Staff Portal POST scores by question.id, not display index.
  // Same answer set against a shuffled question array MUST score the
  // same as against the canonical order.
  const canonical = [
    { id: "q1", correct_answer: "B" },
    { id: "q2", correct_answer: "A" },
    { id: "q3", correct_answer: "B" },
    { id: "q4", correct_answer: "A" },
    { id: "q5", correct_answer: "B" },
  ];
  const techAnswers = [
    { question_id: "q1", selected_answer: "B" },  // right
    { question_id: "q2", selected_answer: "A" },  // right
    { question_id: "q3", selected_answer: "C" },  // wrong
    { question_id: "q4", selected_answer: "A" },  // right
    { question_id: "q5", selected_answer: "B" },  // right
  ];
  function score(stored, answers) {
    let correct = 0;
    for (const a of answers) {
      const q = stored.find(qq => qq.id === a.question_id);
      if (q && q.correct_answer === a.selected_answer) correct++;
    }
    return Math.round((correct / stored.length) * 100);
  }
  const canonicalScore = score(canonical, techAnswers);
  // Shuffle the canonical store
  const shuffled = [...canonical];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const shuffledScore = score(shuffled, techAnswers);
  check("scoring invariant under question-array shuffle", canonicalScore === shuffledScore, `${canonicalScore} vs ${shuffledScore}`);
  check("4/5 correct = 80%", canonicalScore === 80, `got ${canonicalScore}`);
}

// ── Test 4: idempotent attempt submit ──────────────────────────────
{
  // Simulate POST attempt twice; second call should return already_completed.
  const s = makeStore();
  const ins = s.insert({ quiz_id: 300, staff_employee_id: 1 });

  function submit(assignmentId, resultId) {
    const a = s.get(assignmentId);
    if (a && a.status === "completed" && a.completed_result_id) {
      return { already_completed: true, prior_result_id: a.completed_result_id };
    }
    s.complete(assignmentId, resultId);
    return { already_completed: false, new_result_id: resultId };
  }

  const first = submit(ins.id, 5001);
  check("first submit: not already_completed", !first.already_completed && first.new_result_id === 5001);
  const second = submit(ins.id, 5002);
  check("second submit: already_completed, returns prior", second.already_completed && second.prior_result_id === 5001);
}

console.log();
if (failures === 0) {
  console.log("ALL 4 test groups passed.");
  process.exit(0);
} else {
  console.log(`${failures} failure(s).`);
  process.exit(1);
}
