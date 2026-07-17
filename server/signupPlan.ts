// server/signupPlan.ts
//
// Signup plan gating. A self-service (non-seat) signup MUST NOT be able to grant
// itself a paid tier's access.
//
// Before 2026-07-17 the register handler wrote the visitor's PICKED tier straight
// into users.plan, and because the study-credit gate (studyCredits.ts) treats
// every paid tier as unlimited (isUnlimitedPlan), anyone who selected Community,
// Hospital, Enterprise, etc. at signup received that tier's UNLIMITED access for
// $0, with no Stripe subscription. Rachel Hermosilla (Troy Regional) is the case
// that surfaced it: her account sat on plan=community, subscription_status=free.
//
// Now: the account plan is always a GATED value (free / per_study, neither of
// which is in UNLIMITED_PLANS). The paid tier the visitor picked is recorded
// separately as users.signup_selected_tier -- interest, not entitlement -- so
// sales still knows which plan fits their lab. Paid access is granted ONLY by the
// Stripe webhook or admin provisioning, never by the signup form.

// Values the signup form may submit. Mirrors the register handler's prior
// `validPlans` list so an unknown/garbage submission still resolves to free.
export const SIGNUP_SUBMITTABLE_PLANS = [
  "free", "per_study", "clinic", "community", "hospital",
  "enterprise", "waived", "large_hospital", "veritacheck_only", "lab",
] as const;

// The only plans a self-service signup may HOLD. Both are credit-gated in
// studyCredits.ts (neither appears in UNLIMITED_PLANS), so neither grants
// unlimited access.
export const GATED_SIGNUP_PLANS: ReadonlySet<string> = new Set(["free", "per_study"]);

export interface SignupPlanResolution {
  // What goes into users.plan. Always a gated value for a self-service signup.
  plan: string;
  // The paid tier the visitor picked, recorded as interest (users.signup_selected_tier).
  // null when they picked a gated plan or submitted nothing recordable.
  selectedTier: string | null;
}

// Decide the plan a signup account may hold, and separately capture the paid tier
// the visitor picked. Pure and total: every input yields a gated plan.
export function resolveSignupPlan(reqPlan: unknown, isSeat: boolean): SignupPlanResolution {
  // Seat invites never carry a self-chosen plan: the seat-claim path overwrites
  // plan from the owner's record immediately after. Unchanged behavior, returned
  // explicitly so the caller has one code path.
  if (isSeat) return { plan: "free", selectedTier: null };

  const picked =
    typeof reqPlan === "string" && (SIGNUP_SUBMITTABLE_PLANS as readonly string[]).includes(reqPlan)
      ? reqPlan
      : null;

  // A gated pick (free / per_study) is honored. Every PAID tier, and any garbage
  // value, yields a free account.
  const plan = picked && GATED_SIGNUP_PLANS.has(picked) ? picked : "free";

  // Record only a PAID tier as interest. free / per_study / garbage record nothing.
  const selectedTier = picked && !GATED_SIGNUP_PLANS.has(picked) ? picked : null;

  return { plan, selectedTier };
}
