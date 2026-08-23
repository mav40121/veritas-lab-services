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

// Canonical VeritaTrack category -> VeritaMap date column. ONLY these categories
// correspond to a field the VeritaMap coverage view reads; every other category
// (QC Review, Equipment Calibration, HIPAA, Blood Bank Alarm Checks, ...) has no
// map field and is intentionally left unlinked. Both the "Correlation" category
// and its "Correlation / Method Comparison" label map to last_method_comp; both
// "Policy Review" and the "SOP Review" label map to last_sop_review, so the map
// can be derived from either the stored category or a generated task label.
export const CATEGORY_TO_MAP_FIELD: Record<string, string> = {
  "Calibration Verification": "last_cal_ver",
  "Correlation": "last_method_comp",
  "Correlation / Method Comparison": "last_method_comp",
  "Precision Verification": "last_precision",
  "Policy Review": "last_sop_review",
  "SOP Review": "last_sop_review",
};

// Parse the analyte out of a generated task name of the form "<Label> - <Analyte>"
// (e.g. "Precision Verification - Glucose" -> "Glucose"). Splits on the FIRST
// " - " so analyte names that themselves contain a hyphen (e.g. "25-hydroxyvitamin
// D (25-OH-D)") survive intact. Returns null when the name has no " - " separator.
export function analyteFromTaskName(name: string | null | undefined): string | null {
  if (!name) return null;
  const idx = name.indexOf(" - ");
  if (idx < 0) return null;
  return name.slice(idx + 3).trim() || null;
}

// Derive the {map_analyte, map_field} a task SHOULD carry when the caller did not
// supply a link. Returns null (leave unlinked) when the category is not map-tracked,
// the analyte cannot be resolved, the lab has no map, or the analyte is not on the
// lab's map. It links ONLY on an EXACT analyte match against a live veritamap_tests
// row, so a later sign-off's write-back (which matches by exact analyte string) is
// guaranteed to find its row instead of silently updating zero rows. `sqlite` is a
// better-sqlite3 handle.
export function deriveMapLink(
  sqlite: any,
  labId: number | null | undefined,
  category: string | null | undefined,
  analyte: string | null | undefined,
): { map_analyte: string; map_field: string } | null {
  if (labId == null) return null;
  const field = category ? CATEGORY_TO_MAP_FIELD[category] : undefined;
  if (!field) return null;
  const a = (analyte || "").trim();
  if (!a) return null;
  const maps = sqlite.prepare("SELECT id FROM veritamap_maps WHERE lab_id = ?").all(labId) as Array<{ id: number }>;
  if (maps.length === 0) return null;
  const placeholders = maps.map(() => "?").join(",");
  const hit = sqlite.prepare(
    `SELECT 1 FROM veritamap_tests WHERE map_id IN (${placeholders}) AND analyte = ? LIMIT 1`
  ).get(...maps.map((m: { id: number }) => m.id), a);
  return hit ? { map_analyte: a, map_field: field } : null;
}

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
