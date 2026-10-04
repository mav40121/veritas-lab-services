// Medical Director delegation ACCESS GATE (item 5, Phase 2).
//
// Reads the signed Letter of Delegation records (director_delegations, Phase 1) to decide
// whether a user may perform a director attestation: co-signing a QC period review, or
// closing a corrective action / finding. Authority comes from being the designated medical
// director, or from an active delegation that grants the specific responsibility AND whose
// position covers the item's complexity (Technical Supervisor covers high and moderate; a
// Technical Consultant covers moderate only). The account owner is a separate break-glass
// override, recorded distinctly.

import { db } from "./db";
import { positionCoversComplexity, type DelegationGate, type DelegationComplexity } from "./directorDelegation";

const client = () => (db as any).$client;
const up = (s: any) => String(s || "").toUpperCase();

export function isDesignatedMdUser(labId: number, userId: number): boolean {
  const r = client().prepare(
    `SELECT 1 FROM lab_members lm JOIN users u ON u.id = lm.user_id JOIN labs l ON l.id = lm.lab_id
     WHERE lm.lab_id = ? AND lm.user_id = ? AND lm.status = 'active'
       AND l.medical_director_email IS NOT NULL AND TRIM(l.medical_director_email) != ''
       AND lower(u.email) = lower(l.medical_director_email) LIMIT 1`
  ).get(labId, userId);
  return !!r;
}

export function isLabOwnerUser(labId: number, userId: number): boolean {
  return !!client().prepare("SELECT 1 FROM labs WHERE id = ? AND owner_user_id = ? LIMIT 1").get(labId, userId);
}

// The lab's highest test complexity (from VeritaMap). Conservative default 'high' when
// unknown, so an unresolved item requires the higher qualification (TS or MD), never less.
export function labHighestComplexity(labId: number): DelegationComplexity {
  try {
    const rows = client().prepare(
      "SELECT DISTINCT t.complexity AS c FROM veritamap_tests t JOIN veritamap_maps m ON m.id = t.map_id WHERE m.lab_id = ?"
    ).all(labId) as any[];
    if (rows.some((r) => up(r.c) === "HIGH")) return "high";
    if (rows.some((r) => up(r.c) === "MODERATE")) return "moderate";
  } catch { /* ignore */ }
  return "high";
}

// Per-item complexity for a QC control lot's analyte, from VeritaMap. Falls back to the
// lab's highest complexity (then to 'high') when the analyte is not matched.
export function complexityForAnalyte(labId: number, analyte: string | null | undefined): DelegationComplexity {
  if (analyte) {
    try {
      const rows = client().prepare(
        "SELECT t.complexity AS c FROM veritamap_tests t JOIN veritamap_maps m ON m.id = t.map_id WHERE m.lab_id = ? AND lower(t.analyte) = lower(?)"
      ).all(labId, analyte) as any[];
      if (rows.some((r) => up(r.c) === "HIGH")) return "high";
      if (rows.some((r) => up(r.c) === "MODERATE")) return "moderate";
      if (rows.length) return "moderate"; // WAIVED-only -> moderate scope
    } catch { /* ignore */ }
  }
  return labHighestComplexity(labId);
}

export interface AttestResult {
  ok: boolean;
  via: "medical_director" | "designee" | null;
  position?: string;
  delegationId?: number;
}

export function mayAttestAsDirectorOrDesignee(
  labId: number, userId: number, gate: DelegationGate, complexity: DelegationComplexity,
): AttestResult {
  if (isDesignatedMdUser(labId, userId)) return { ok: true, via: "medical_director" };
  const letters = client().prepare(
    "SELECT id, position, responsibilities_json FROM director_delegations WHERE lab_id = ? AND delegate_user_id = ? AND status = 'active'"
  ).all(labId, userId) as any[];
  for (const L of letters) {
    let resp: any = {};
    try { resp = JSON.parse(L.responsibilities_json || "{}"); } catch { /* ignore */ }
    if (resp[gate] === true && positionCoversComplexity(L.position, complexity)) {
      return { ok: true, via: "designee", position: L.position, delegationId: L.id };
    }
  }
  return { ok: false, via: null };
}
