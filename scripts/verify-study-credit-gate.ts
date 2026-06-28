// scripts/verify-study-credit-gate.ts
//
// Verifies the free-study credit decision table (server/studyCredits.ts) that
// gates both VeritaCheck create flows. Run: npx tsx scripts/verify-study-credit-gate.ts
//
// Invariants under test:
//  - Every PAID/subscription plan (including the demo lab's `lab`) is UNLIMITED
//    and is never credit-gated. This is what protects paying customers + the demo.
//  - free / per_study consume credits, pooled across the owner user and the lab.
//  - A new account (2 credits) can run exactly 2, then is blocked.

import Database from "better-sqlite3";
import { resolveStudyAccess, isUnlimitedPlan, UNLIMITED_PLANS, STUDY_CREDIT_FREE_GRANT, consumeStudyCredit } from "../server/studyCredits";

let pass = 0, fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log("  PASS", name); }
  else { fail++; console.log("  FAIL", name); }
}

// 1. Every paid/subscription plan is unlimited (protects customers + demo lab `lab`).
for (const p of ["clinic", "community", "hospital", "large_hospital", "enterprise", "veritacheck_only", "unlimited", "lab", "waived", "annual", "professional", "complete", "starter"]) {
  check(`unlimited plan: ${p}`, isUnlimitedPlan(p) && resolveStudyAccess({ ownerPlan: p, ownerCredits: 0 }).unlimited === true);
}

// 2. free / per_study are NOT unlimited (credit-gated).
check("free is credit-gated", !isUnlimitedPlan("free"));
check("per_study is credit-gated", !isUnlimitedPlan("per_study"));
check("unknown/null plan is credit-gated", !isUnlimitedPlan(undefined) && !isUnlimitedPlan(null));

// 3. New free account (the grant) can run exactly STUDY_CREDIT_FREE_GRANT studies, then blocked.
check("grant is 2", STUDY_CREDIT_FREE_GRANT === 2);
check("free w/ 2 credits -> allowed, credits=2", (() => { const a = resolveStudyAccess({ ownerPlan: "free", ownerCredits: 2 }); return !a.unlimited && a.credits === 2; })());
check("free w/ 1 credit  -> allowed, credits=1", (() => { const a = resolveStudyAccess({ ownerPlan: "free", ownerCredits: 1 }); return !a.unlimited && a.credits === 1; })());
check("free w/ 0 credits  -> BLOCKED (credits<=0)", (() => { const a = resolveStudyAccess({ ownerPlan: "free", ownerCredits: 0 }); return !a.unlimited && a.credits <= 0; })());

// 4. Credit pooling across owner user + lab (handles new-signup grant on user AND per_study webhook on lab).
check("pool: owner 2 + lab 0 = 2", resolveStudyAccess({ ownerPlan: "free", ownerCredits: 2, labCredits: 0 }).credits === 2);
check("pool: owner 0 + lab 1 = 1", resolveStudyAccess({ ownerPlan: "per_study", ownerCredits: 0, labCredits: 1 }).credits === 1);
check("pool: owner 1 + lab 1 = 2", resolveStudyAccess({ ownerPlan: "free", ownerCredits: 1, labCredits: 1 }).credits === 2);

// 5. lab plan wins over owner plan (lab-scoped routes carry the authoritative plan).
check("lab plan 'enterprise' over owner 'free' -> unlimited", resolveStudyAccess({ labPlan: "enterprise", ownerPlan: "free", ownerCredits: 0 }).unlimited === true);
check("lab plan 'free' + owner 'free', 0 credits -> blocked", (() => { const a = resolveStudyAccess({ labPlan: "free", ownerPlan: "free", ownerCredits: 0, labCredits: 0 }); return !a.unlimited && a.credits <= 0; })());

// 6. Demo lab safety: plan 'lab' is in the unlimited set.
check("demo lab plan 'lab' is unlimited", UNLIMITED_PLANS.has("lab"));

// 7. consumeStudyCredit against a REAL in-memory SQLite (exercises the actual
// SQL: lab-first decrement, user fallback when the lab pool is empty, the
// null-lab path, and the both-empty no-op that must never go negative).
{
  const sql: any = new Database(":memory:");
  sql.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, study_credits INTEGER NOT NULL DEFAULT 0)");
  sql.exec("CREATE TABLE labs  (id INTEGER PRIMARY KEY, study_credits INTEGER NOT NULL DEFAULT 0)");
  const setU = (c: number) => sql.prepare("INSERT OR REPLACE INTO users (id, study_credits) VALUES (1, ?)").run(c);
  const setL = (c: number) => sql.prepare("INSERT OR REPLACE INTO labs  (id, study_credits) VALUES (1, ?)").run(c);
  const getU = () => (sql.prepare("SELECT study_credits c FROM users WHERE id=1").get() as any).c;
  const getL = () => (sql.prepare("SELECT study_credits c FROM labs  WHERE id=1").get() as any).c;

  // lab-first: when the lab pool has credits, decrement the LAB, leave the user alone.
  setU(2); setL(2); consumeStudyCredit(sql, 1, 1);
  check("consume lab-first: lab 2->1", getL() === 1);
  check("consume lab-first: user untouched (stays 2)", getU() === 2);

  // fallback: lab pool empty -> decrement the user instead.
  setU(2); setL(0); consumeStudyCredit(sql, 1, 1);
  check("consume fallback: lab stays 0", getL() === 0);
  check("consume fallback: user 2->1", getU() === 1);

  // null lab id -> user pool only.
  setU(2); consumeStudyCredit(sql, 1, null);
  check("consume null-lab: user 2->1", getU() === 1);

  // both empty -> no-op, never negative (the gate is what blocks, not this).
  setU(0); setL(0); consumeStudyCredit(sql, 1, 1);
  check("consume both-empty: lab stays 0 (no negative)", getL() === 0);
  check("consume both-empty: user stays 0 (no negative)", getU() === 0);

  sql.close();
}

console.log(`\nVERIFY: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
