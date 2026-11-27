// server/qualifiedSigning.ts
//
// The signatures a view-only seat may make (B4 review, then BUG-204, 2026-11-27). Medical directors and their designees are
// usually on view-only seats: they review and sign, they don't enter data. authMiddleware's view_only gate (server/routes.ts)
// refuses every other write from a view-only seat. Each route here is a signature and not an edit, decides by the signer's own
// qualification in the record's own laboratory, and takes nothing in its body but the signature and what the signature says
// (the decision, the typed name, the corrective action a review records). So a director or designee on a view-only seat signs,
// and anyone else on one is refused by the route itself. Veritas support is refused before any of them runs
// (server/vlsSupport.ts), and Staff logins never reach this gate.
//
// POST only, exact paths, numeric ids: each route is written as Express names it, and every :param must be digits. A new
// signature joins only when it meets all three tests above; tests/integration/director-sign-view-only.test.ts reads Express's
// routes and fails if this list reaches any route it doesn't name.
export const QUALIFIED_SIGNING_ROUTES = [
  // VeritaCheck(R) verification records (B4): signerFor in server/verificationSignatures.ts, gate verify_method.
  "/api/labs/:labId/studies/:id/finalize",
  "/api/studies/:id/finalize",
  "/api/labs/:labId/veritacheck/signoff-groups/:id/sign",
  "/api/veritacheck/verifications/:id/sign",
  "/api/veritacheck/verifications/:id/plan/sign",
  "/api/veritacheck/verifications/:id/analytes/:analyteId/finalize",
  // VeritaQC monthly review co-sign (BUG-204): mayAttestAsDirectorOrDesignee, gate qc_period_cosign. Filing the review and the
  // co-sign setting stay refused.
  "/api/labs/:labId/qc/period-reviews/md-cosign",
  // VeritaResponse finding sign-off: mayAttestAsDirectorOrDesignee, gate finding_closure.
  "/api/labs/:labId/findings/:id/signoff",
  // VeritaMaintain monthly record review: recordReviewCapacity (mayAttestAsDirectorOrDesignee, gate equipment_record_review).
  "/api/labs/:labId/maintain-reviews",
  // VeritaComp(TM) (B5): the evaluator signs a method and the observer signs Elements 1 and 4, each as their own VeritaStaff(TM)
  // row in that lab (shared/competencySignoff.ts, server/competencyObserver.ts). A sign-off entered from paper still needs edit.
  "/api/labs/:labId/competency/employee/:employeeId/test-system/:instrumentId/sign",
  "/api/labs/:labId/competency/observations/sign",
] as const;

const PATTERNS = QUALIFIED_SIGNING_ROUTES.map((route) => new RegExp(`^${route.replace(/:[A-Za-z]+/g, "\\d+")}$`));

/** A request a view-only seat may make: POST to one of QUALIFIED_SIGNING_ROUTES, ids as digits. */
export function isQualifiedSigningRequest(method: string, path: string): boolean {
  return String(method).toUpperCase() === "POST" && PATTERNS.some((re) => re.test(String(path || "")));
}
