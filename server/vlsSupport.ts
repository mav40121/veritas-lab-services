// Veritas support access (2026-10-08, docs/design/VLS_Support_Access_Design.docx).
//
// A Veritas Lab Services person (users.vls_support = 1) may reach any lab whose
// owner has left labs.vls_support_access on, with admin-level SETUP access, no
// seat, no billing, and no place on the lab's roster. labScopeMiddleware grants
// it (alongside the org-admin path) and marks req.scope.viaVlsSupport.
//
// What it may never do is SIGN for the lab: attestations, approvals, sign-offs,
// medical director designation, ownership, billing. CLIA puts those on the
// director and the lab's own qualified staff. vlsSupportBlocked() is the single
// list of those routes; labScopeMiddleware refuses them for a Veritas user
// (403 VLS_SUPPORT_CANNOT_SIGN) before any handler runs.
//
// Every change a Veritas user makes is recorded in vls_support_activity (one
// row per non-GET request) and stamped acting_as='vls_support' on any audit row
// it writes, through vlsContext.
import { AsyncLocalStorage } from "node:async_hooks";

export type VlsContext = { actingAs: "vls_support"; labId: number; userId: number };
export const vlsContext = new AsyncLocalStorage<VlsContext>();

export function isVlsSupportUser(sqlite: any, userId: number): boolean {
  try {
    const r = sqlite.prepare("SELECT vls_support FROM users WHERE id = ?").get(userId) as any;
    return Number(r?.vls_support) === 1;
  } catch { return false; }
}

export function labAllowsVlsSupport(sqlite: any, labId: number): boolean {
  try {
    const r = sqlite.prepare("SELECT vls_support_access FROM labs WHERE id = ?").get(labId) as any;
    return r ? Number(r.vls_support_access ?? 1) === 1 : false;
  } catch { return false; }
}

// Routes a Veritas user may NOT call. Matched on the server's OWN route
// definition (METHOD + req.route.path, e.g. "POST /api/labs/:labId/qc/period-reviews"),
// never on the raw URL: case, a leading zero in the lab id, or a %-encoded
// character cannot slip past it. Built from a full inventory of signature,
// attestation, approval, ownership and member-governance routes (2026-10-08).
//
// The three lab-scoped CREATES (studies, verification packages, competency
// assessments) are refused because the row they make would carry the Veritas
// user's own id, and an older unscoped sign route ("is this row yours?") would
// then let them sign it. Those are the lab's own records, not setup.
const ALWAYS: Record<string, string> = {
  // Ownership, the director role, governance of who signs, and this switch.
  "POST /api/labs/:labId/transfer-ownership": "transfer ownership of a lab",
  "PUT /api/labs/:labId/medical-director": "designate the medical director",
  "PATCH /api/labs/:labId/vls-support": "change its own access to a lab",
  "POST /api/labs/:labId/director-delegations": "write a medical director delegation",
  "PUT /api/labs/:labId/director-delegations/:id": "edit a medical director delegation",
  "DELETE /api/labs/:labId/director-delegations/:id": "discard a medical director delegation draft",
  "POST /api/labs/:labId/director-delegations/:id/sign": "sign a medical director delegation",
  "POST /api/labs/:labId/director-delegations/:id/revoke": "revoke a medical director delegation",
  "PATCH /api/labs/:labId/members/:memberId": "change a member role",
  "PATCH /api/labs/:labId/members/:memberId/email": "change a member login email",
  "PATCH /api/labs/:labId/members/:memberId/permissions": "change member permissions",
  "DELETE /api/labs/:labId/members/:memberId": "remove a member",
  "POST /api/labs/:labId/seat-invites/:id/reissue": "reissue an invitation link",
  "POST /api/labs/:labId/seat-invites/:id/dismiss": "cancel an invitation",
  // VeritaQC
  "POST /api/labs/:labId/qc/period-reviews": "sign the monthly QC review",
  "POST /api/labs/:labId/qc/period-reviews/md-cosign": "co-sign the monthly QC review",
  "POST /api/labs/:labId/qc/md-cosign-setting": "change the QC co-sign requirement",
  "POST /api/labs/:labId/qc/corrective-actions/:id/resolve": "close out a QC corrective action",
  // VeritaComp
  "POST /api/labs/:labId/competency/assessments": "create a competency assessment",
  "PUT /api/labs/:labId/competency/assessments/:id": "edit a competency assessment",
  "POST /api/labs/:labId/competency/assessments/:id/sign": "sign a competency assessment",
  "POST /api/labs/:labId/competency/assessments/:id/unlock": "unlock a signed competency assessment",
  "POST /api/labs/:labId/competency/employee/:employeeId/sign": "sign an employee competency record",
  "POST /api/labs/:labId/competency/assessments/bulk-commit": "commit signed competency records",
  "POST /api/labs/:labId/competency/assessments/cohort-commit": "commit signed competency records",
  // VeritaCheck
  "POST /api/labs/:labId/studies": "create a study",
  "POST /api/labs/:labId/studies/:id/finalize": "sign off a study",
  "POST /api/labs/:labId/studies/:id/amend": "reopen a signed study",
  "POST /api/labs/:labId/veritacheck/signoff-groups/:id/sign": "sign a study sign-off group",
  "POST /api/labs/:labId/veritacheck/verifications": "create a verification package",
  // VeritaMap
  "POST /api/labs/:labId/veritamap/maps/:id/analyte-values/:analyte/mec-review": "record MEC review of critical values",
  "POST /api/labs/:labId/veritamap/maps/:id/analyte-values/:analyte/attest-ref": "attest a reference range",
  "POST /api/labs/:labId/veritamap/maps/:id/analyte-values/:analyte/unlock-ref": "unlock an attested reference range",
  "POST /api/labs/:labId/veritamap/maps/:id/amr-values/:instId/:analyte/attest": "attest an AMR",
  "POST /api/labs/:labId/veritamap/maps/:id/amr-values/:instId/:analyte/unlock": "unlock an attested AMR",
  // VeritaPolicy
  "POST /api/labs/:labId/veritapolicy/documents/:id/approve": "approve a policy",
  "POST /api/labs/:labId/veritapolicy/documents/:id/reject": "reject a policy",
  "POST /api/labs/:labId/veritapolicy/documents/:id/recertify": "recertify a policy",
  "POST /api/labs/:labId/veritapolicy/attestations/:id/complete": "attest a policy",
  "POST /api/labs/:labId/veritapolicy/attestations/:id/score-quiz": "score a policy attestation quiz",
  "POST /api/labs/:labId/veritapolicy/delegations": "delegate policy approval",
  "POST /api/labs/:labId/veritapolicy/delegations/:id/revoke": "revoke a policy approval delegation",
  "POST /api/labs/:labId/veritapolicy/manuals/:manualId/approvers": "choose policy approvers",
  "DELETE /api/labs/:labId/veritapolicy/manuals/:manualId/approvers/:approverId": "remove a policy approver",
  "POST /api/labs/:labId/veritapolicy/workflows/:id/steps": "change a policy approval workflow",
  "DELETE /api/labs/:labId/veritapolicy/documents/:id": "delete a policy and its signatures",
  "DELETE /api/labs/:labId/veritapolicy/documents/:id/attestations/:assignmentId": "delete a policy attestation",
  // VeritaMaintain, VeritaResponse
  "POST /api/labs/:labId/equipment/:id/events": "log maintenance as performed",
  "POST /api/labs/:labId/findings/:id/signoff": "sign off a finding",
  "PUT /api/labs/:labId/findings/:id/effectiveness-checks/:checkId": "verify a corrective action",
};

const present = (v: any) => v !== undefined && v !== null && v !== "" && v !== false && v !== 0;
const anyKey = (b: any, keys: string[]) => !!b && keys.some((k) => present(b[k]));
const QUAL_KEYS = ["qualificationsVerifiedAt", "qualificationsVerifiedBy", "qualifications_verified_at", "qualifications_verified_by"];
const IQCP_KEYS = ["approvedByName", "approved_by_name", "approved_by_user_id"];

// Routes that both set things up AND sign: refused only when the request
// carries a signature field.
const WHEN_SIGNING: Record<string, { test: (b: any) => boolean; what: string }> = {
  "PUT /api/labs/:labId/staff/competency/:employeeId": { test: (b) => JSON.stringify(b || {}).includes("\"signed_by"), what: "sign a staff competency record" },
  "POST /api/labs/:labId/pt/aa-records": { test: (b) => anyKey(b, ["director_id", "director_reviewed_at"]), what: "record a director PT review" },
  "PUT /api/labs/:labId/pt/aa-records/:id": { test: (b) => anyKey(b, ["director_id", "director_reviewed_at"]), what: "record a director PT review" },
  "POST /api/labs/:labId/findings": { test: (b) => anyKey(b, ["signed_by", "signed_at"]) || (present(b?.status) && b.status !== "open"), what: "create a closed or signed finding" },
  "PATCH /api/labs/:labId/iqcp/plans/:id": { test: (b) => anyKey(b, IQCP_KEYS) || b?.status === "complete", what: "approve an IQCP" },
  "PUT /api/labs/:labId/iqcp/plans/:id": { test: (b) => anyKey(b, IQCP_KEYS) || b?.status === "complete", what: "approve an IQCP" },
  "POST /api/labs/:labId/staff/employees": { test: (b) => anyKey(b, QUAL_KEYS), what: "verify staff qualifications" },
  "PUT /api/labs/:labId/staff/employees/:id": { test: (b) => anyKey(b, QUAL_KEYS), what: "verify staff qualifications" },
  "POST /api/labs/:labId/studies/:id/points/:idx/exclude": { test: (b) => anyKey(b, ["justification"]), what: "override a study verdict" },
  "POST /api/labs/:labId/members": { test: (b) => b?.role === "medical_director", what: "invite a medical director" },
  "POST /api/labs/:labId/staff-portal-invites": { test: (b) => b?.deliverEmail === false, what: "take a staff invitation link instead of emailing it" },
};

// Every exact route pattern refused or conditionally refused (receipt + PR).
export const VLS_SUPPORT_REFUSED_ROUTES = [...Object.keys(ALWAYS), ...Object.keys(WHEN_SIGNING).map((k) => `${k} (when signing)`)];

export function vlsSupportBlocked(method: string, routePath: string | undefined, body: any): string | null {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
  // No route pattern (should not happen inside a route): refuse every write.
  if (!routePath) return "make this change";
  const key = `${m} ${routePath}`;
  if (ALWAYS[key]) return ALWAYS[key];
  const cond = WHEN_SIGNING[key];
  if (cond && cond.test(body)) return cond.what;
  return null;
}

export function recordVlsActivity(sqlite: any, labId: number, userId: number, method: string, path: string, status: number, note: string | null = null) {
  try {
    sqlite.prepare("INSERT INTO vls_support_activity (lab_id, user_id, method, path, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))")
      .run(labId, userId, method, path.slice(0, 300), status, note);
  } catch { /* activity logging must never break the request */ }
}
