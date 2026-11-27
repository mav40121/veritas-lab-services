// shared/eSignature.ts
//
// What an electronic signature is for, and how it was made (S0, 2026-11-27; server/eSignature.ts). The server and the signature
// prompt (client/src/components/SignaturePrompt.tsx) read the same list. A hospital sign-in proof is bound to one purpose, so a
// proof asked for to decide a document's approval step can't attest one or sign a review. A new signature adds its purpose here.
// policy_decision is one approval step's approve or reject: the staff login's screen offers both under one signature, and the
// request itself says which (recorded as the signoff's action). policy_read_sign is a Staff login's read-and-sign under My sign-offs,
// one document or several under one signature (BUG-188, server/policyStaffSign.ts).
// B5: competency_observation is the observer signing Elements 1 and 4 (one or several at once); competency_method is the
// evaluator signing one method's competency (shared/competencyObservation.ts).

export const SIGNATURE_PURPOSES = [
  "policy_decision",
  "policy_bulk_approve",
  "policy_recertify",
  "policy_attest",
  "maintain_review",
  // B4 (server/verificationSignatures.ts VERIFICATION_PURPOSES): a VeritaCheck verification plan, package, study, package analyte
  // and sign-off group.
  "verification_plan",
  "verification_package",
  "verification_study",
  "verification_analyte",
  "verification_signoff_group",
  "qc_rules",
  "policy_read_sign",
  "competency_observation",
  "competency_method",
] as const;
export type SignaturePurpose = (typeof SIGNATURE_PURPOSES)[number];
export const isSignaturePurpose = (p: unknown): p is SignaturePurpose =>
  typeof p === "string" && (SIGNATURE_PURPOSES as readonly string[]).includes(p);

/** How a signature was made: the person's own password, or their hospital's sign-in asked for again at signing. */
export type SignatureMethod = "password" | "sso";

/** What the signing screen may offer this person (GET /api/auth/signature/method). */
export interface SignatureMethodInfo {
  /** A password can sign. False where the person's domain requires single sign-on. */
  password: boolean;
  /** Their hospital's sign-in, when their email domain has one switched on. */
  sso: { name: string; required: boolean } | null;
}

/** How long a hospital sign-in proof can be used to sign, from the moment the screen receives it. */
export const SIGN_PROOF_SECONDS = 120;

/** What a printout says about how a signature was made. Empty for a row saved before this was recorded. */
export function signedWithText(method: string | null | undefined, provider: string | null | undefined): string {
  if (method === "sso") return provider ? `Signed with ${provider} sign-in` : "Signed with hospital sign-in";
  if (method === "password") return "Signed with name and password";
  return "";
}

/** The hospital sign-in window's refusals, in plain words (server/ssoRoutes.ts signature round trip). */
export const SIGN_SSO_ERRORS: Record<string, string> = {
  expired: "That hospital sign-in took too long or was already used. Try again.",
  provider_refused: "Your hospital sign-in was cancelled or refused. Try again.",
  provider_unavailable: "Your hospital sign-in isn't answering. Try again in a minute.",
  token_rejected: "Your hospital sign-in couldn't be checked, so it can't sign. Try again.",
  not_configured: "Your organization's sign-in isn't set up for signing. Ask your administrator.",
  wrong_person: "You signed in to your hospital as someone else. Sign in as yourself to sign.",
  domain_not_allowed: "That hospital account isn't one this organization signs with.",
  not_fresh: "Your hospital didn't ask you to sign in again just now, so it can't count as your signature. Try again.",
  no_account: "Your VeritaAssure® account wasn't found.",
  support_account: "A Veritas support login can't sign for a lab.",
  account_inactive: "This account was turned off after a long time without a sign-in. Ask your lab owner to turn it back on.",
};
