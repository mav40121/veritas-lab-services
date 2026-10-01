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
