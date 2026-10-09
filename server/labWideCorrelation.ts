// server/labWideCorrelation.ts
//
// BUG-011 part C (Michael, Q43 = 1, 2026-10-09): correlation counts every map in
// the lab, not just the map being viewed. 42 CFR 493.1281 applies to the
// laboratory (its CLIA certificate); how a lab splits its menu into maps does not
// change it. Production audit 2026-10-09: Milford runs glucose on its Chemistry
// map and on StatStrip meters kept on its Blood Bank map; Georgetown runs A/B
// Influenza on two maps. Neither showed a correlation requirement.
//
// labWideCorrelation() takes the map's own analyte -> instruments list and adds
// the same lab's OTHER maps, but only for tests that are the same test
// (sameTestKeys) as one on this map. Each added instrument carries map_id and
// map_name so the row can say which map it is on. The same physical analyzer
// listed on two maps (same serial number, or the same name when neither has a
// serial) counts once, so a copied "test" map cannot create a requirement.
// Maps without a lab (legacy, user-scoped) keep the per-map behavior.

import { correlationGroupsFor, sameTestKeys, type CorrelationGroupInfo } from "@shared/presetAnalytes";

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const physicalKey = (i: any) => (i?.serial_number ? `sn:${norm(i.serial_number)}` : `name:${norm(i?.instrument_name ?? i?.name)}`);

export interface LabWideCorrelation {
  /** Correlation group per analyte on THIS map (counts instruments across the lab). */
  groups: Record<string, CorrelationGroupInfo>;
  /** This map's instruments plus same-test instruments from the lab's other maps (other_map: true, map_name). */
  all: Record<string, any[]>;
}

export function labWideCorrelation(sqlite: any, mapId: number | string, local: Record<string, any[]>): LabWideCorrelation {
  const all: Record<string, any[]> = {};
  for (const [a, xs] of Object.entries(local)) all[a] = [...xs];
  const map = sqlite.prepare("SELECT lab_id FROM veritamap_maps WHERE id = ?").get(Number(mapId)) as any;
  if (map?.lab_id) {
    const localTestKeys = new Set<string>();
    for (const a of Object.keys(local)) for (const k of sameTestKeys(a)) localTestKeys.add(k);
    // The map's own analyzers, read from the database (callers do not all load
    // serial numbers). Same analyzer = same serial, or same name when either has none.
    const ids = [...new Set(Object.values(local).flat().map((x: any) => Number(x.instrument_id ?? x.id)).filter((n) => Number.isFinite(n)))];
    const localSerials = new Set<string>();
    const localNames = new Map<string, boolean>(); // name -> some unit on this map has no serial
    if (ids.length) {
      const inst = sqlite.prepare(`SELECT instrument_name, serial_number FROM veritamap_instruments WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as any[];
      for (const x of inst) {
        const sn = norm(x.serial_number);
        if (sn) localSerials.add(sn);
        const nm = norm(x.instrument_name);
        localNames.set(nm, (localNames.get(nm) ?? false) || !sn);
      }
    }
    const sameAsLocal = (r: any) => {
      const sn = norm(r.serial_number), nm = norm(r.instrument_name);
      if (sn && localSerials.has(sn)) return true;
      return localNames.has(nm) && (!sn || localNames.get(nm) === true);
    };
    const rows = sqlite.prepare(`
      SELECT it.analyte, i.id AS instrument_id, i.instrument_name, i.role, i.serial_number, mp.id AS map_id, mp.name AS map_name
        FROM veritamap_instrument_tests it
        JOIN veritamap_instruments i ON i.id = it.instrument_id
        JOIN veritamap_maps mp ON mp.id = it.map_id
       WHERE mp.lab_id = ? AND mp.id <> ? AND it.active = 1
    `).all(map.lab_id, Number(mapId)) as any[];
    for (const r of rows) {
      if (!sameTestKeys(r.analyte).some((k) => localTestKeys.has(k))) continue;
      if (sameAsLocal(r)) continue; // the same analyzer is already on this map
      const pk = physicalKey(r);
      const list = (all[r.analyte] ??= []);
      const id = `x:${pk}`;
      if (list.some((x) => x.id === id)) continue; // listed on two other maps: count once
      list.push({ id, instrument_id: r.instrument_id, instrument_name: r.instrument_name, role: r.role, serial_number: r.serial_number || null, map_id: r.map_id, map_name: r.map_name, other_map: true });
    }
  }
  const groups = correlationGroupsFor(all);
  return { groups, all };
}

/** "XN-1000 [Primary] as LYMPH% on map "Hematology"" for the reason text and tooltips. */
export function describeCorrelationInstrument(i: any, analyte: string, rowAnalyte: string): string {
  const name = i.instrument_name ?? i.name;
  return `${name} [${i.role}]${analyte !== rowAnalyte ? ` as ${analyte}` : ""}${i.other_map ? ` on map "${i.map_name}"` : ""}`;
}

/** The other instruments a row is compared with: same-name tests on other maps, and peers anywhere in the lab. */
export function correlationPeerInstruments(all: Record<string, any[]>, rowAnalyte: string, peers: string[]) {
  return [rowAnalyte, ...peers].flatMap((a) =>
    (all[a] ?? []).filter((x) => a !== rowAnalyte || x.other_map).map((x) => ({ analyte: a, instrument_name: x.instrument_name ?? x.name, role: x.role, map_name: x.other_map ? x.map_name : null })),
  );
}
