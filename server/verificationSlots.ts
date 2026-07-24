// server/verificationSlots.ts
//
// Per-analyte study-slot seeding for VeritaCheck verification packages
// (2026-07-24, Longstreth feedback: link one study per analyte, not one per
// element). A verification's Performance Elements each need a study slot PER
// analyte on the package, bound by analyte_id. Carryover is the exception: it
// is sample-path based, so one instrument-wide study covers every analyte, and
// it is never multiplied per analyte.
//
// The FIRST analyte on a package adopts any orphan slot (analyte_id IS NULL,
// scope 'analyte') that was seeded at package creation, preserving a study that
// may already be linked to it. Later analytes insert fresh slots. Seeding is
// idempotent per (verification_id, element, analyte_id).
//
// Extracted as a pure helper so scripts/verify-verification-slots.mjs can
// exercise the adopt-vs-insert branching against an in-memory database.

// Elements that are NOT multiplied per analyte. Carryover (EP10) is
// sample-path based; one instrument-wide study covers the whole package.
export const INSTRUMENT_WIDE_ELEMENTS = new Set<string>(["carryover"]);

export interface SeedSlotsOptions {
  verificationId: number | string;
  analyteId: number;
  analyteName: string;
  elements: string[];                        // the package's element keys
  protocolFor: (element: string) => string | null; // CLSI protocol per element
  now?: string;                              // injectable for tests
}

/**
 * Seed one study slot per per-analyte element for `analyteId`. Returns how many
 * slots were newly inserted vs adopted from an existing orphan. Runs in a
 * single transaction.
 */
export function seedSlotsForAnalyte(sqlite: any, opts: SeedSlotsOptions): { inserted: number; adopted: number } {
  const elems = (opts.elements || []).filter(e => !INSTRUMENT_WIDE_ELEMENTS.has(e));
  const now = opts.now || new Date().toISOString();
  let inserted = 0;
  let adopted = 0;

  const hasForAnalyte = sqlite.prepare(
    "SELECT id FROM veritacheck_verification_studies WHERE verification_id = ? AND element = ? AND analyte_id = ?",
  );
  const findOrphan = sqlite.prepare(
    "SELECT id FROM veritacheck_verification_studies WHERE verification_id = ? AND element = ? AND analyte_id IS NULL AND scope = 'analyte' LIMIT 1",
  );
  const adopt = sqlite.prepare(
    "UPDATE veritacheck_verification_studies SET analyte_id = ?, analyte = ?, updated_at = ? WHERE id = ?",
  );
  const insert = sqlite.prepare(
    `INSERT INTO veritacheck_verification_studies
       (verification_id, element, analyte, analyte_id, scope, clsi_protocol, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'analyte', ?, ?, ?)`,
  );

  const tx = sqlite.transaction(() => {
    for (const element of elems) {
      if (hasForAnalyte.get(opts.verificationId, element, opts.analyteId)) continue; // idempotent
      const orphan = findOrphan.get(opts.verificationId, element) as { id: number } | undefined;
      if (orphan) {
        adopt.run(opts.analyteId, opts.analyteName, now, orphan.id);
        adopted++;
      } else {
        insert.run(opts.verificationId, element, opts.analyteName, opts.analyteId, opts.protocolFor(element), now, now);
        inserted++;
      }
    }
  });
  tx();
  return { inserted, adopted };
}
