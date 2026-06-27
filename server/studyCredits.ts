// server/studyCredits.ts
//
// Unified free-study credit model for VeritaCheck. Subscription plans are
// uncapped; only `free` and `per_study` accounts consume study credits. Every
// new account is granted STUDY_CREDIT_FREE_GRANT credits at signup
// (server/storage.ts createUser). Both authenticated create flows share this
// single source of truth so they cannot drift:
//   - single studies:  POST /api/labs/:labId/studies (server/routes.ts)
//   - bundled verifications: createVerificationRow (server/veritacheck_verification.ts)
//
// EXPLICIT ALLOWLIST (per CLAUDE.md plan-gate rule, never a blocklist).
// UNLIMITED_PLANS enumerates every PAID plan identifier. Anything not on it
// (i.e. `free` and `per_study`) is credit-gated. The list is deliberately a
// superset of the older per-flow allowlists so that no paying customer, the
// demo lab (`lab`), or any legacy plan is ever blocked.

export const UNLIMITED_PLANS: ReadonlySet<string> = new Set([
  // current published tiers
  "clinic", "community", "hospital", "large_hospital", "enterprise",
  // VeritaCheck Unlimited + demo + waived
  "veritacheck_only", "unlimited", "lab", "waived",
  // legacy / alias plan identifiers (preserved per the never-delete rule)
  "annual", "professional", "complete", "starter",
]);

export const STUDY_CREDIT_FREE_GRANT = 2;

export function isUnlimitedPlan(plan?: string | null): boolean {
  return !!plan && UNLIMITED_PLANS.has(plan);
}

// Effective access for the account behind a request. `labPlan` wins over
// `ownerPlan` (lab-scoped routes carry the authoritative lab plan). Credits are
// pooled across the owner user and the lab so both the new-signup grant (on the
// user) and the per_study webhook top-up (on the lab) count.
export function resolveStudyAccess(opts: {
  labPlan?: string | null;
  ownerPlan?: string | null;
  ownerCredits?: number | null;
  labCredits?: number | null;
}): { unlimited: boolean; credits: number } {
  const plan = opts.labPlan || opts.ownerPlan;
  if (isUnlimitedPlan(plan)) return { unlimited: true, credits: Number.POSITIVE_INFINITY };
  const credits = (opts.ownerCredits ?? 0) + (opts.labCredits ?? 0);
  return { unlimited: false, credits };
}

// Consume one study credit, lab pool first then the owner user. Raw
// better-sqlite3 client. Call ONLY after a successful create and only when the
// account is not unlimited. Safe no-op if both pools are already empty (the
// gate is what blocks; this never goes negative).
export function consumeStudyCredit(sqlite: any, ownerUserId: number, labId: number | null): void {
  if (labId != null) {
    const lab = sqlite.prepare("SELECT study_credits FROM labs WHERE id = ?").get(labId) as any;
    if (lab && (lab.study_credits ?? 0) > 0) {
      sqlite.prepare("UPDATE labs SET study_credits = study_credits - 1 WHERE id = ?").run(labId);
      return;
    }
  }
  const u = sqlite.prepare("SELECT study_credits FROM users WHERE id = ?").get(ownerUserId) as any;
  if (u && (u.study_credits ?? 0) > 0) {
    sqlite.prepare("UPDATE users SET study_credits = study_credits - 1 WHERE id = ?").run(ownerUserId);
  }
}
