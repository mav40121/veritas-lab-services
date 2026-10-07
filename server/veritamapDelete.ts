// Shared, transactional cascade for deleting a VeritaMap map.
//
// 2026-10-07 (Michael, lab 3): "Failed to delete map" on four demo maps. The
// delete ran as seven separate statements with no transaction; the instrument
// delete then hit the foreign key from staff_duty_change_events (VeritaStaff's
// "duty changed, competency owed" rows point at veritamap_instruments) and
// threw, leaving a shell: tests/values/instrument-tests already gone, the map
// and its instruments still there, every later click failing the same way.
// The same cascade was copy-pasted in five places. This is the one copy.
//
// Rules: everything happens inside ONE transaction (all or nothing; a refused
// delete leaves the map whole, never a shell). The two VeritaStaff tables that
// reference instruments are cleared with the map: an assignment to an
// instrument that no longer exists means nothing, and a duty-change event is a
// derived tracking row (detected/resolved), not a regulatory record; the
// competency assessment it may point at is untouched.
import type Database from "better-sqlite3";

export interface MapDeleteCounts {
  correlations: number;
  amr_values: number;
  analyte_values: number;
  instrument_tests: number;
  tests: number;
  staff_assignments: number;
  duty_change_events: number;
  instruments: number;
  maps: number;
}

export function deleteMapCascade(sqlite: Database.Database, mapId: number): MapDeleteCounts {
  const run = sqlite.transaction((mid: number): MapDeleteCounts => {
    const c: MapDeleteCounts = {
      correlations: 0, amr_values: 0, analyte_values: 0, instrument_tests: 0, tests: 0,
      staff_assignments: 0, duty_change_events: 0, instruments: 0, maps: 0,
    };
    c.correlations = sqlite.prepare(`
      DELETE FROM veritamap_test_correlations
      WHERE test_a_id IN (SELECT id FROM veritamap_tests WHERE map_id = ?)
         OR test_b_id IN (SELECT id FROM veritamap_tests WHERE map_id = ?)
    `).run(mid, mid).changes;
    c.amr_values = sqlite.prepare("DELETE FROM veritamap_amr_values WHERE map_id = ?").run(mid).changes;
    c.analyte_values = sqlite.prepare("DELETE FROM veritamap_analyte_values WHERE map_id = ?").run(mid).changes;
    c.instrument_tests = sqlite.prepare("DELETE FROM veritamap_instrument_tests WHERE map_id = ?").run(mid).changes;
    c.tests = sqlite.prepare("DELETE FROM veritamap_tests WHERE map_id = ?").run(mid).changes;
    // VeritaStaff rows that point at this map's instruments (the FK that failed).
    c.staff_assignments = sqlite.prepare(
      "DELETE FROM staff_employee_instruments WHERE instrument_id IN (SELECT id FROM veritamap_instruments WHERE map_id = ?)"
    ).run(mid).changes;
    c.duty_change_events = sqlite.prepare(
      "DELETE FROM staff_duty_change_events WHERE instrument_id IN (SELECT id FROM veritamap_instruments WHERE map_id = ?)"
    ).run(mid).changes;
    c.instruments = sqlite.prepare("DELETE FROM veritamap_instruments WHERE map_id = ?").run(mid).changes;
    c.maps = sqlite.prepare("DELETE FROM veritamap_maps WHERE id = ?").run(mid).changes;
    return c;
  });
  return run(mapId);
}

// After a refused delete: which tables still hold rows that reference this
// map or its instruments. Scans every table whose schema declares a foreign
// key to a veritamap_* table, so a future table that forgets to join the
// cascade is at least NAMED in the 409 instead of surfacing as a bare 500.
export function mapDeleteBlockers(sqlite: Database.Database, mapId: number): string[] {
  const out: string[] = [];
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%REFERENCES veritamap_%'")
    .all() as Array<{ name: string }>;
  for (const t of tables) {
    const fks = sqlite.prepare(`PRAGMA foreign_key_list(${t.name})`).all() as Array<{ table: string; from: string }>;
    for (const fk of fks) {
      if (!fk.table.startsWith("veritamap_")) continue;
      try {
        const n = fk.table === "veritamap_maps"
          ? (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t.name} WHERE ${fk.from} = ?`).get(mapId) as any).n
          : (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t.name} WHERE ${fk.from} IN (SELECT id FROM ${fk.table} WHERE map_id = ?)`).get(mapId) as any).n;
        if (n > 0) out.push(`${t.name} (${n})`);
      } catch { /* table without map_id lineage: skip */ }
    }
  }
  return out;
}
