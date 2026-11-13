// server/instrumentReferences.ts
//
// What points at one VeritaMap analyzer row (veritamap_instruments.id) from other modules, so a correction that removes an
// analyzer can be checked first (Athol 2026-11-13, Michael Q326 = 1: our 11/6 load put a cobas c 311 and e 411 on lab 39's
// Chemistry map, and Athol runs two cobas pure systems). DELETE .../instruments/:instId clears staff assignments and
// duty-change rows and leaves the rest pointing at a missing row, so any count here means stop and look.
// GET /api/admin/veritamap/instruments/:instId/references (header x-admin-secret only). Read-only, counts only: no names,
// no record contents. Also counts the analyzer's own test and AMR rows, and competency method groups that name it by text.

type Sqlite = any;

/** Tables that hold a veritamap_instruments id, and the column. A new one belongs here. */
export const INSTRUMENT_REFERENCES: Array<{ table: string; column: string; what: string }> = [
  { table: "staff_employee_instruments", column: "instrument_id", what: "VeritaStaff instrument assignments" },
  { table: "staff_duty_change_events", column: "instrument_id", what: "VeritaStaff duty-change reevaluations" },
  { table: "competency_assessment_items", column: "instrument_id", what: "VeritaComp per-method competency items" },
  { table: "competency_method_signoffs", column: "instrument_id", what: "VeritaComp per-method sign-offs" },
  { table: "competency_method_history", column: "instrument_id", what: "VeritaComp method history" },
  { table: "competency_instrument_group_members", column: "instrument_id", what: "VeritaComp method group members" },
  { table: "iqcp_plans", column: "instrument_id", what: "IQCP plans" },
  { table: "veritacheck_outside_records", column: "instrument_id", what: "VeritaCheck outside records" },
  { table: "veritacheck_verifications", column: "map_instrument_id", what: "VeritaCheck instrument verifications" },
  { table: "lab_equipment", column: "map_instrument_id", what: "VeritaMaintain equipment linked to the map" },
  { table: "qc_results", column: "map_instrument_id", what: "VeritaQC runs" },
];

export interface InstrumentReferences {
  instrumentId: number;
  mapId: number;
  labId: number | null;
  counts: Record<string, number>;
  total: number;
  ownRows: { tests: number; amrValues: number };
  competencyMethodGroupsNamingIt: number;
}

const hasColumn = (sqlite: Sqlite, table: string, column: string): boolean => {
  try { return (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as any[]).some((c) => c.name === column); } catch { return false; }
};

export function instrumentReferences(sqlite: Sqlite, instrumentId: number): InstrumentReferences | null {
  const inst = sqlite.prepare("SELECT i.id, i.map_id, i.instrument_name, m.lab_id FROM veritamap_instruments i LEFT JOIN veritamap_maps m ON m.id = i.map_id WHERE i.id = ?").get(instrumentId) as any;
  if (!inst) return null;
  const counts: Record<string, number> = {};
  for (const r of INSTRUMENT_REFERENCES) {
    if (!hasColumn(sqlite, r.table, r.column)) { counts[r.table] = 0; continue; }
    counts[r.table] = Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM "${r.table}" WHERE "${r.column}" = ?`).get(instrumentId).n);
  }
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const tests = Number(sqlite.prepare("SELECT COUNT(*) AS n FROM veritamap_instrument_tests WHERE instrument_id = ?").get(instrumentId).n);
  const amrValues = Number(sqlite.prepare("SELECT COUNT(*) AS n FROM veritamap_amr_values WHERE instrument_id = ?").get(instrumentId).n);
  // Method groups name analyzers by text (competency_method_groups.instruments, a JSON list), in the lab's programs.
  let byName = 0;
  if (inst.lab_id != null) {
    const rows = sqlite.prepare(
      "SELECT g.instruments FROM competency_method_groups g JOIN competency_programs p ON p.id = g.program_id WHERE p.lab_id = ?"
    ).all(inst.lab_id) as any[];
    for (const r of rows) {
      let list: any[] = [];
      try { list = JSON.parse(r.instruments || "[]"); } catch { list = []; }
      if (list.some((n) => String(n).trim().toLowerCase() === String(inst.instrument_name).trim().toLowerCase())) byName++;
    }
  }
  return { instrumentId, mapId: Number(inst.map_id), labId: inst.lab_id == null ? null : Number(inst.lab_id), counts, total, ownRows: { tests, amrValues }, competencyMethodGroupsNamingIt: byName };
}

export function registerInstrumentReferenceRoutes(app: any, deps: { sqlite: () => Sqlite; adminSecret: string | undefined }) {
  app.get("/api/admin/veritamap/instruments/:instId/references", (req: any, res: any) => {
    const secret = req.headers["x-admin-secret"] as string | undefined;
    if (!deps.adminSecret || !secret || secret !== deps.adminSecret) return res.status(403).json({ error: "Forbidden" });
    const id = Number(req.params.instId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "instId must be a positive integer" });
    const out = instrumentReferences(deps.sqlite(), id);
    if (!out) return res.status(404).json({ error: "Instrument not found" });
    res.setHeader("Cache-Control", "no-store");
    res.json(out);
  });
}
