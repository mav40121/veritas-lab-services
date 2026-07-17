// scripts/verify-signup-plan-gating.mjs
//
// Receipt for the signup-gating fix. A self-service signup must NEVER end up
// holding a plan that grants unlimited access. Before 2026-07-17 the register
// handler wrote the visitor's picked tier straight into users.plan, so picking
// Community/Hospital/Enterprise at signup granted that tier's unlimited access
// for $0 (Rachel Hermosilla, Troy Regional).
//
// This drives the REAL resolveSignupPlan() and the REAL isUnlimitedPlan() over
// every submittable value and asserts: a self-service signup can only hold a
// gated plan, the picked PAID tier is recorded separately, and no input yields
// an unlimited plan. Then it re-implements the OLD behavior and proves this
// check would have caught it.
//
// Run: npx tsx scripts/verify-signup-plan-gating.mjs

import { resolveSignupPlan, GATED_SIGNUP_PLANS, SIGNUP_SUBMITTABLE_PLANS } from "../server/signupPlan.ts";
import { isUnlimitedPlan } from "../server/studyCredits.ts";

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

console.log("\nCase 1: every PAID tier a self-service signup can submit lands on a GATED plan");
const PAID = SIGNUP_SUBMITTABLE_PLANS.filter((p) => !GATED_SIGNUP_PLANS.has(p));
console.log(`  paid tiers under test: ${PAID.join(", ")}`);
for (const tier of PAID) {
  const r = resolveSignupPlan(tier, false);
  check(`pick "${tier}" -> plan is gated (not the paid tier)`, GATED_SIGNUP_PLANS.has(r.plan), `plan=${r.plan}`);
  check(`pick "${tier}" -> plan is NOT unlimited`, !isUnlimitedPlan(r.plan), `plan=${r.plan}`);
  check(`pick "${tier}" -> the paid tier is recorded as interest`, r.selectedTier === tier, `selectedTier=${r.selectedTier}`);
}

console.log("\nCase 2: gated picks are honored, and record no paid interest");
{
  const free = resolveSignupPlan("free", false);
  check(`pick "free" -> plan=free`, free.plan === "free");
  check(`pick "free" -> no selectedTier`, free.selectedTier === null, `${free.selectedTier}`);
  const ps = resolveSignupPlan("per_study", false);
  check(`pick "per_study" -> plan=per_study (honored)`, ps.plan === "per_study");
  check(`pick "per_study" -> NOT unlimited`, !isUnlimitedPlan(ps.plan));
  check(`pick "per_study" -> no selectedTier`, ps.selectedTier === null);
}

console.log("\nCase 3: garbage / missing / wrong-type input yields a free account, records nothing");
for (const junk of ["", "enterprise ", "COMMUNITY", "premium", null, undefined, 42, {}]) {
  const r = resolveSignupPlan(junk, false);
  check(`junk ${JSON.stringify(junk)} -> plan=free`, r.plan === "free", `plan=${r.plan}`);
  check(`junk ${JSON.stringify(junk)} -> NOT unlimited`, !isUnlimitedPlan(r.plan));
  check(`junk ${JSON.stringify(junk)} -> selectedTier=null`, r.selectedTier === null, `${r.selectedTier}`);
}

console.log("\nCase 4: seat invites are unchanged (plan forced free, no tier recorded)");
for (const tier of ["community", "enterprise", "free", "garbage"]) {
  const r = resolveSignupPlan(tier, true);
  check(`seat pick "${tier}" -> plan=free`, r.plan === "free", `plan=${r.plan}`);
  check(`seat pick "${tier}" -> no selectedTier`, r.selectedTier === null);
}

console.log("\nCase 5: totality. NO input, seat or not, ever yields an unlimited plan.");
{
  let anyUnlimited = false;
  for (const isSeat of [true, false]) {
    for (const v of [...SIGNUP_SUBMITTABLE_PLANS, "", "premium", null, undefined, 7]) {
      if (isUnlimitedPlan(resolveSignupPlan(v, isSeat).plan)) anyUnlimited = true;
    }
  }
  check("no signup input resolves to an unlimited plan", !anyUnlimited);
}

console.log("\nCase 6: prove the check bites. The OLD behavior (plan = picked tier) must FAIL it.");
{
  // Faithful re-implementation of the pre-fix line:
  //   const selectedPlan = seatInvite ? "free" : (validPlans.includes(reqPlan) ? reqPlan : "free");
  const oldResolve = (reqPlan, isSeat) =>
    isSeat ? "free" : (SIGNUP_SUBMITTABLE_PLANS.includes(reqPlan) ? reqPlan : "free");
  const oldCommunity = oldResolve("community", false);
  // Under the fix this is the leak; assert the OLD path produced an unlimited plan,
  // i.e. our fix genuinely changed behavior on the exact input that bit Rachel.
  const oldLeaks = isUnlimitedPlan(oldCommunity);
  check("OLD behavior granted unlimited on community (regression the fix removes)", oldLeaks, `old plan=${oldCommunity}`);
  const newCommunity = resolveSignupPlan("community", false).plan;
  check("NEW behavior does not", !isUnlimitedPlan(newCommunity), `new plan=${newCommunity}`);
  check("fix actually changed the community outcome", oldCommunity !== newCommunity, `${oldCommunity} -> ${newCommunity}`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
