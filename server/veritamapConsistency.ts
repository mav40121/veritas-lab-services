// server/veritamapConsistency.ts
//
// Standing consistency guard for VeritaMap's two complexity stores. The
// compliance view + Excel export read the denormalized `veritamap_tests`; the
// build page writes `veritamap_instrument_tests` (the source of truth).
// rebuildMapTests keeps them synced (upsert as of PR #928), but this audit is
// the belt-and-suspenders: it re-derives the expected veritamap_tests from
// instrument_tests for every LIVE map and flags any divergence, so a stale row
// can never hide until a survey. Runs nightly (emails info@ on any divergence)
// and on demand via GET /api/admin/veritamap/consistency-audit.
//
// Root incident (2026-07-07): a replaced instrument (MEDTOX PROFILE II-A, WAIVED)
// left a frozen veritamap_tests row that INSERT OR IGNORE never overwrote when
// PROFILE V (MODERATE) took its place. See reference_veritamap_complexity_stores.

const RANK: Record<string, number> = { WAIVED: 0, MODERATE: 1, HIGH: 2 };

export interface ConsistencyIssue {
  mapId: number;
  labId: number | null;
  mapName: string;
  analyte: string;
  detail: string;
}

export interface ConsistencyResult {
  ok: boolean;
  checkedMaps: number;
  labs: number;
  totalIssues: number;
  issues: {
    complexityDrift: ConsistencyIssue[];
    specialtyDrift: ConsistencyIssue[];
    orphans: ConsistencyIssue[];
    missing: ConsistencyIssue[];
  };
}

// Read-only. Re-derives the expected veritamap_tests from veritamap_instrument_tests
// across every existing map and reports divergence. Ignores rows whose map_id no
// longer exists (orphaned children of deleted maps read by nothing).
export function auditVeritamapConsistency(sqlite: any): ConsistencyResult {
  const maps = sqlite.prepare("SELECT id, lab_id, name FROM veritamap_maps").all() as Array<{ id: number; lab_id: number | null; name: string }>;
  const mapById = new Map<number, { lab_id: number | null; name: string }>();
  for (const m of maps) mapById.set(m.id, { lab_id: m.lab_id, name: m.name });
  const liveMapIds = new Set<number>(maps.map((m) => m.id));

  const complexityDrift: ConsistencyIssue[] = [];
  const specialtyDrift: ConsistencyIssue[] = [];
  const orphans: ConsistencyIssue[] = [];
  const missing: ConsistencyIssue[] = [];

  const instFor = sqlite.prepare("SELECT complexity, specialty FROM veritamap_instrument_tests WHERE map_id = ? AND lower(analyte) = lower(?) AND active = 1");
  const mk = (mapId: number, analyte: string, detail: string): ConsistencyIssue => ({
    mapId, labId: mapById.get(mapId)?.lab_id ?? null, mapName: mapById.get(mapId)?.name ?? "", analyte, detail,
  });

  // A/B/C: each active veritamap_tests row vs its backing instrument rows.
  const vtRows = sqlite.prepare("SELECT map_id, analyte, specialty, complexity FROM veritamap_tests WHERE active = 1").all() as Array<any>;
  for (const t of vtRows) {
    if (!liveMapIds.has(t.map_id)) continue;
    const inst = instFor.all(t.map_id, t.analyte) as Array<{ complexity: string; specialty: string }>;
    if (inst.length === 0) { orphans.push(mk(t.map_id, t.analyte, "veritamap_tests row has no backing active instrument test")); continue; }
    const wantCx = inst.map((i) => String(i.complexity || "").toUpperCase()).reduce((a, b) => ((RANK[b] ?? -1) > (RANK[a] ?? -1) ? b : a));
    if (String(t.complexity || "").toUpperCase() !== wantCx) complexityDrift.push(mk(t.map_id, t.analyte, `complexity ${t.complexity} should be ${wantCx}`));
    const specs = new Set(inst.map((i) => i.specialty || ""));
    if (specs.size === 1 && !specs.has(t.specialty || "")) specialtyDrift.push(mk(t.map_id, t.analyte, `specialty ${t.specialty} should be ${[...specs][0]}`));
  }

  // D: instrument analytes with no veritamap_tests row (compliance view would omit them).
  const seen = new Set<string>();
  for (const r of sqlite.prepare("SELECT map_id, analyte FROM veritamap_tests WHERE active = 1").all() as Array<any>) {
    seen.add(`${r.map_id}:${String(r.analyte || "").toLowerCase()}`);
  }
  for (const r of sqlite.prepare("SELECT DISTINCT map_id, analyte FROM veritamap_instrument_tests WHERE active = 1").all() as Array<any>) {
    if (!liveMapIds.has(r.map_id)) continue;
    if (!seen.has(`${r.map_id}:${String(r.analyte || "").toLowerCase()}`)) missing.push(mk(r.map_id, r.analyte, "instrument analyte missing from veritamap_tests"));
  }

  const totalIssues = complexityDrift.length + specialtyDrift.length + orphans.length + missing.length;
  return {
    ok: totalIssues === 0,
    checkedMaps: maps.length,
    labs: new Set(maps.map((m) => m.lab_id)).size,
    totalIssues,
    issues: { complexityDrift, specialtyDrift, orphans, missing },
  };
}

// Nightly entrypoint (scheduled in server/index.ts). Emails info@ on any divergence.
export async function runNightlyVeritamapConsistency(): Promise<void> {
  const { db } = await import("./db");
  const result = auditVeritamapConsistency((db as any).$client);
  if (result.ok) {
    console.log(`[veritamap-consistency] OK: ${result.checkedMaps} maps, 0 divergence`);
    return;
  }
  console.error(`[veritamap-consistency] DIVERGENCE: ${result.totalIssues} issue(s)`, JSON.stringify(result.issues).slice(0, 2000));
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const rows: Array<[string, ConsistencyIssue]> = [
      ...result.issues.complexityDrift.map((i) => ["Complexity drift", i] as [string, ConsistencyIssue]),
      ...result.issues.specialtyDrift.map((i) => ["Specialty drift", i] as [string, ConsistencyIssue]),
      ...result.issues.orphans.map((i) => ["Orphan row", i] as [string, ConsistencyIssue]),
      ...result.issues.missing.map((i) => ["Missing analyte", i] as [string, ConsistencyIssue]),
    ];
    const tableRows = rows.slice(0, 100).map(([kind, i]) =>
      `<tr><td style="padding:4px 8px">${kind}</td><td style="padding:4px 8px">lab ${i.labId} / map ${i.mapId} (${i.mapName})</td><td style="padding:4px 8px">${i.analyte}</td><td style="padding:4px 8px">${i.detail}</td></tr>`
    ).join("");
    await resend.emails.send({
      from: "VeritaAssure System <info@veritaslabservices.com>",
      to: "info@veritaslabservices.com",
      subject: `[VeritaAssure] VeritaMap consistency: ${result.totalIssues} divergence(s)`,
      html: `<p>The nightly VeritaMap consistency check found <strong>${result.totalIssues}</strong> divergence(s) between the compliance view (veritamap_tests) and the instrument source of truth (veritamap_instrument_tests) across ${result.checkedMaps} maps.</p>
             <p>Repair: dry-run then apply <code>POST /api/admin/veritamap/resync-complexity</code> for complexity, or re-save the affected instrument on the build page (rebuildMapTests heals all fields).</p>
             <table style="border-collapse:collapse;font-size:12px"><thead><tr><th style="padding:4px 8px;text-align:left">Type</th><th style="padding:4px 8px;text-align:left">Location</th><th style="padding:4px 8px;text-align:left">Analyte</th><th style="padding:4px 8px;text-align:left">Detail</th></tr></thead><tbody>${tableRows}</tbody></table>
             ${rows.length > 100 ? `<p>and ${rows.length - 100} more</p>` : ""}`,
    });
    console.log("[veritamap-consistency] divergence alert emailed to info@veritaslabservices.com");
  } catch (e: any) {
    console.error("[veritamap-consistency] alert email failed:", e?.message || e);
  }
}
