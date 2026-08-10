// VeritaTrack <-> VeritaMap sign-off sync helpers.
//
// Extracted from veritatrack.ts so they can be unit-tested without loading the
// live DB. Both fix defects surfaced by the SCAHC report 2026-07-29 (map showed
// a cal ver as "not done" after a VeritaTrack sign-off):
//   1. preserveMapLink: a routine task edit was severing an imported task's map
//      linkage (the edit form omits map_analyte/map_field, and the PUT wrote
//      `x || null`), so later sign-offs stopped updating the map.
//   2. applyMapSignoffWriteback: the write-back matched the map row by exact
//      analyte string inside a swallowed try/catch with no row-count check, so
//      a 0-row / errored update still returned "signed off" and the map stayed
//      red with no signal.

// Only overwrite the map linkage when the field is explicitly present in the
// request body; otherwise keep whatever is on the existing row. An explicit
// null/"" still clears it (leaves room for a future "unlink" action).
export function preserveMapLink(
  body: { map_analyte?: unknown; map_field?: unknown } | null | undefined,
  existing: { map_analyte?: unknown; map_field?: unknown } | null | undefined,
): { map_analyte: string | null; map_field: string | null } {
  const keep = (bodyVal: unknown, existingVal: unknown): string | null =>
    bodyVal !== undefined ? ((bodyVal as string) || null) : ((existingVal as string) || null);
  return {
    map_analyte: keep(body?.map_analyte, existing?.map_analyte),
    map_field: keep(body?.map_field, existing?.map_field),
  };
}

// The four date columns a sign-off may write. Allowlisted BEFORE the field name
// is interpolated into SQL, so only these columns can ever be written.
export const MAP_SIGNOFF_FIELDS = ["last_cal_ver", "last_method_comp", "last_precision", "last_sop_review"];

// Write a sign-off date back to every matching VeritaMap test row for the
// SIGN-OFF's lab (signoffLabId, resolved by the caller from task.lab_id) and
// REPORT the outcome. `sqlite` is a better-sqlite3 handle.
export function applyMapSignoffWriteback(
  sqlite: any,
  signoffLabId: number | null,
  userId: number,
  mapAnalyte: string,
  mapField: string,
  completedDate: string,
): { linked: boolean; updated: number; warning?: string } {
  if (!MAP_SIGNOFF_FIELDS.includes(mapField)) {
    return { linked: true, updated: 0, warning: `Sign-off recorded. The linked map field "${mapField}" is not one the map tracks, so the map was not changed.` };
  }
  try {
    // #107-class fix (2026-08-10): scope the writeback to the sign-off's own lab
    // (signoffLabId = task.lab_id), NOT the owner's home lab (users.lab_id).
    // users.lab_id can drift from the active lab, so a multi-lab owner signing
    // off a map-linked task on Lab B was writing the completion date onto Lab A's
    // veritamap_tests and never updating Lab B. The user_id fallback stays for
    // legacy rows whose lab cannot be resolved.
    const maps = signoffLabId != null
      ? sqlite.prepare("SELECT id FROM veritamap_maps WHERE lab_id = ?").all(signoffLabId) as Array<{ id: number }>
      : sqlite.prepare("SELECT id FROM veritamap_maps WHERE user_id = ?").all(userId) as Array<{ id: number }>;
    if (maps.length === 0) {
      return { linked: true, updated: 0, warning: "Sign-off recorded, but no VeritaMap was found for this lab to update." };
    }
    const placeholders = maps.map(() => "?").join(",");
    const info = sqlite.prepare(
      `UPDATE veritamap_tests SET ${mapField} = ?, updated_at = datetime('now') WHERE map_id IN (${placeholders}) AND analyte = ?`
    ).run(completedDate, ...maps.map((m: { id: number }) => m.id), mapAnalyte);
    const updated = Number(info.changes) || 0;
    if (updated === 0) {
      return { linked: true, updated: 0, warning: `Sign-off recorded, but no map test named "${mapAnalyte}" was found, so the map still shows this as not done. Check the analyte name on the map, or enter the date on the map directly.` };
    }
    return { linked: true, updated };
  } catch (e: any) {
    console.error("veritatrack signoff map writeback failed:", e?.message || e);
    return { linked: true, updated: 0, warning: "Sign-off recorded, but the map could not be updated automatically. Please set the date on the map directly." };
  }
}
