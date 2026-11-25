// server/verificationLinks.ts
//
// Counts, for an admin, of VeritaCheck verification slots whose linked study, analyzer or analyte isn't the verification's own: both in
// the same laboratory, or, where either has no laboratory, the owner rule. Reads only; counts and laboratory ids only.

type SqliteLike = any;

/** SQL: row `r` (a study, a map) goes with row `v` (a verification). Aliases only, never user text. */
export function sameLabOrOwnerSql(r: string, v: string): string {
  return `(CASE WHEN ${r}.lab_id IS NOT NULL AND ${v}.lab_id IS NOT NULL THEN ${r}.lab_id = ${v}.lab_id
    ELSE ${r}.user_id = ${v}.user_id OR ${r}.user_id = (SELECT slo_l.owner_user_id FROM labs slo_l WHERE slo_l.id = ${v}.lab_id) END)`;
}

/** Counts and laboratory ids only, for GET /api/admin/veritacheck/foreign-slot-counts. Writes nothing. */
export function foreignSlotCounts(sqlite: SqliteLike) {
  const totals = { verifications: 0, linkedSlots: 0, foreignSlots: 0, sameOwner: 0, otherOwner: 0, missingStudies: 0, foreignAnalyzers: 0, missingAnalyzers: 0, analytesNotOnPackage: 0 };
  const byLab: Record<string, { isDemo: boolean | null; foreignSlots: number; sameOwner: number; otherOwner: number; foreignAnalyzers: number; analytesNotOnPackage: number }> = {};
  const lab = (id: number | null, isDemo: number | null) => (byLab[String(id ?? "none")] ??= { isDemo: id == null || isDemo == null ? null : isDemo === 1, foreignSlots: 0, sameOwner: 0, otherOwner: 0, foreignAnalyzers: 0, analytesNotOnPackage: 0 });
  totals.verifications = Number(sqlite.prepare("SELECT COUNT(*) AS n FROM veritacheck_verifications").get().n);
  const slots = sqlite.prepare(
    `SELECT v.lab_id, l.is_demo, s.id AS study, ${sameLabOrOwnerSql("s", "v")} AS own,
            COALESCE(l.owner_user_id, v.user_id) AS v_owner, COALESCE(sl.owner_user_id, s.user_id) AS s_owner
       FROM veritacheck_verification_studies vs JOIN veritacheck_verifications v ON v.id = vs.verification_id
       LEFT JOIN labs l ON l.id = v.lab_id LEFT JOIN studies s ON s.id = vs.study_id LEFT JOIN labs sl ON sl.id = s.lab_id
      WHERE vs.study_id IS NOT NULL`
  ).all() as any[];
  for (const r of slots) {
    totals.linkedSlots++;
    if (r.study == null) { totals.missingStudies++; continue; }
    if (r.own) continue;
    const key = r.s_owner != null && r.s_owner === r.v_owner ? "sameOwner" : "otherOwner", at = lab(r.lab_id, r.is_demo);
    totals.foreignSlots++; totals[key]++;
    at.foreignSlots++; at[key]++;
  }
  const analyzers = sqlite.prepare(
    `SELECT v.lab_id, l.is_demo, i.id AS analyzer, ${sameLabOrOwnerSql("m", "v")} AS own
       FROM veritacheck_verifications v LEFT JOIN labs l ON l.id = v.lab_id
       LEFT JOIN veritamap_instruments i ON i.id = v.map_instrument_id LEFT JOIN veritamap_maps m ON m.id = i.map_id
      WHERE v.map_instrument_id IS NOT NULL`
  ).all() as any[];
  for (const r of analyzers) {
    if (r.analyzer == null) totals.missingAnalyzers++;
    else if (!r.own) { totals.foreignAnalyzers++; lab(r.lab_id, r.is_demo).foreignAnalyzers++; }
  }
  const analytes = sqlite.prepare(
    `SELECT v.lab_id, l.is_demo FROM veritacheck_verification_studies vs JOIN veritacheck_verifications v ON v.id = vs.verification_id
       LEFT JOIN labs l ON l.id = v.lab_id
      WHERE vs.analyte_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM veritacheck_verification_analytes a WHERE a.id = vs.analyte_id AND a.verification_id = vs.verification_id)`
  ).all() as any[];
  for (const r of analytes) { totals.analytesNotOnPackage++; lab(r.lab_id, r.is_demo).analytesNotOnPackage++; }
  return { ...totals, byLab };
}
