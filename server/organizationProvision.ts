// server/organizationProvision.ts
//
// Phase 3a of the System/Organization entity work (docs/SYSTEM_ENTITY_DESIGN.md).
//
// The provision-system batch primitive stands up a whole system in one admin
// call: an organization, its member labs, a repository lab, the owner's
// org_owner membership, and the seat pool. It replaces the per-lab manual
// sequence for systems (Forrest General, Lifepoint, Sanford). It composes the
// Phase 1/2 primitives and writes NO billing (that is Phase 3b); the billing
// owner user must already exist.
//
// The pure core (planProvisionLabs + accreditationFlagsFor) is mirrored by
// scripts/verify-provision-system.mjs.

export type ProvisionLabInput = {
  labName?: string;
  cliaNumber?: string;
  plan?: string;
  accreditation?: string;
  isRepository?: boolean;
};

export type ProvisionLabPlan = {
  cliaNumber: string;
  labName: string;
  isRepository: boolean;
  action: "create" | "reuse" | "error";
  error?: string;
};

// Pure: map an accreditation body string to the labs table's four flag columns.
// Mirrors the mapping used by POST /api/labs/me/add. Unknown/empty -> all 0.
export function accreditationFlagsFor(body: string | null | undefined): {
  accreditation_cap: number;
  accreditation_tjc: number;
  accreditation_cola: number;
  accreditation_aabb: number;
} {
  const b = String(body || "").toUpperCase();
  return {
    accreditation_cap: b === "CAP" ? 1 : 0,
    accreditation_tjc: b === "TJC" ? 1 : 0,
    accreditation_cola: b === "COLA" ? 1 : 0,
    accreditation_aabb: b === "AABB" ? 1 : 0,
  };
}

// Pure: classify each requested lab against the CLIA numbers already in the DB.
//  - no existing lab with that CLIA           -> "create"
//  - existing lab owned by this same owner    -> "reuse" (idempotent re-link)
//  - existing lab owned by SOMEONE ELSE       -> "error" (never hijack a CLIA)
//  - missing name/CLIA, or a CLIA repeated in the request -> "error"
// existingByClia maps a CLIA number to the owner_user_id of the lab that holds
// it. This makes provisioning idempotent (re-running the same payload reuses)
// and safe (a CLIA belonging to another account is rejected, not stolen).
export function planProvisionLabs(
  labs: ProvisionLabInput[],
  ownerUserId: number,
  existingByClia: Map<string, number>,
): ProvisionLabPlan[] {
  const plan: ProvisionLabPlan[] = [];
  const seen = new Set<string>();
  for (const l of labs || []) {
    const cliaNumber = String(l?.cliaNumber || "").trim();
    const labName = String(l?.labName || "").trim();
    const isRepository = !!l?.isRepository;
    if (!cliaNumber || !labName) {
      plan.push({ cliaNumber, labName, isRepository, action: "error", error: "labName and cliaNumber required" });
      continue;
    }
    if (seen.has(cliaNumber)) {
      plan.push({ cliaNumber, labName, isRepository, action: "error", error: "duplicate cliaNumber in request" });
      continue;
    }
    seen.add(cliaNumber);
    if (!existingByClia.has(cliaNumber)) {
      plan.push({ cliaNumber, labName, isRepository, action: "create" });
    } else if (existingByClia.get(cliaNumber) === ownerUserId) {
      plan.push({ cliaNumber, labName, isRepository, action: "reuse" });
    } else {
      plan.push({ cliaNumber, labName, isRepository, action: "error", error: "cliaNumber already belongs to another owner" });
    }
  }
  return plan;
}

// Phase 2d follow-on (Michael 2026-10-01, option 1): decide whether and how to
// grant the OPERATOR (Michael) an org_admin membership on a provisioned system,
// so his account is the seat-free master overview. Phase 2d (labVisibleToUser)
// confers visibility of every lab in an org from an active org_owner/org_admin
// membership, and an org membership creates NO user_seats row, so this costs no
// writer seat. Pure; mirrored by scripts/verify-operator-overview-grant.mjs.
//
//   "insert"  -> no membership yet; add org_admin/active
//   "promote" -> a non-owner membership exists but is not active org_admin; set it
//   "skip"    -> operator account missing, operator IS the org owner, operator is
//                already an active org_admin, or operator is the org_owner
//                (never demote an owner)
export function operatorOverviewGrant(args: {
  ownerUserId: number;
  operatorUserId: number | null;
  existing: { orgRole: string; status: string } | null;
}): "insert" | "promote" | "skip" {
  const { ownerUserId, operatorUserId, existing } = args;
  if (operatorUserId == null) return "skip"; // operator account not found by email
  if (operatorUserId === ownerUserId) return "skip"; // already the org_owner
  if (!existing) return "insert";
  if (existing.orgRole === "org_owner") return "skip"; // never demote an owner
  if (existing.orgRole === "org_admin" && existing.status === "active") return "skip"; // already set
  return "promote"; // reactivate a deactivated row, or raise org_admin from another role
}
