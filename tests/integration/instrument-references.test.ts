// tests/integration/instrument-references.test.ts
//
// GET /api/admin/veritamap/instruments/:instId/references (server/instrumentReferences.ts), the check run before an
// analyzer row is removed from a map (Athol 2026-11-13, Michael Q326 = 1). Made-up labs on a fresh database. It checks:
//   1. the route refuses without the admin header or with a wrong one, a bad id, and an id that doesn't exist
//   2. an analyzer nothing points at reads total 0, with its own test and AMR rows counted apart
//   3. an analyzer with one row in each referencing table reads each count and the total; another analyzer's rows and
//      another lab's method groups aren't counted; a method group naming it by text (case and spaces aside) is counted
//   4. every table in the database with an instrument_id or map_instrument_id column is on the list or is the
//      analyzer's own rows (a new one fails here until it is added)
//   5. it writes nothing (every table's row count is the same after, no record_views row) and names no one
// Run: rm -f .tmp-instrefs.db && DB_PATH=.tmp-instrefs.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/instrument-references.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const refs = await import("../../server/instrumentReferences");
  const sqlite = (db as any).$client;
  sqlite.pragma("foreign_keys = OFF");
  let fillSeq = 0;
  const colsOf = (t: string) => sqlite.prepare(`PRAGMA table_info("${t}")`).all() as { name: string; notnull: number; dflt_value: any }[];
  const insert = (table: string, values: Record<string, unknown>) => {
    const cols = colsOf(table);
    const names = new Set(cols.map((c) => c.name));
    for (const k of Object.keys(values)) if (!names.has(k)) throw new Error(`${table} has no column ${k}`);
    const row: Record<string, unknown> = { ...values };
    // A filled-in id is a new number each time, so a UNIQUE(person, analyzer) pair never collides.
    for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-13T00:00:00Z" : /_id$/i.test(c.name) ? 500000 + ++fillSeq : /count|is_|number|^expires$/i.test(c.name) ? 1 : `made-up-${++fillSeq}`;
    const keys = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
  };

  const owner = insert("users", { email: "instrefs-owner@example.test", name: "Made-up Owner", plan: "hospital", seat_count: 0 });
  const labA = insert("labs", { lab_name: "Made-up Lab A", owner_user_id: owner, plan: "hospital", clia_number: "00D0000091" });
  const labB = insert("labs", { lab_name: "Made-up Lab B", owner_user_id: owner, plan: "hospital", clia_number: "00D0000092" });
  const map = insert("veritamap_maps", { user_id: owner, name: "Made-up Chemistry", lab_id: labA });
  const inst = (name: string) => insert("veritamap_instruments", { map_id: map, instrument_name: name, role: "Primary", category: "Chemistry" });
  const busy = inst("Made-up Analyzer 1"), quiet = inst("Made-up Analyzer 2");
  for (const i of [busy, quiet]) {
    insert("veritamap_instrument_tests", { instrument_id: i, map_id: map, analyte: "Sodium", specialty: "Routine Chemistry", complexity: "MODERATE" });
    insert("veritamap_amr_values", { map_id: map, instrument_id: i, analyte: "Sodium" });
  }
  insert("veritamap_instrument_tests", { instrument_id: quiet, map_id: map, analyte: "Potassium", specialty: "Routine Chemistry", complexity: "MODERATE" });
  // One row in each referencing table for the busy analyzer, two in the first, and one for the quiet analyzer's neighbour
  // id (quiet + 1000) that must never be counted for either.
  for (const r of refs.INSTRUMENT_REFERENCES) {
    insert(r.table, { [r.column]: busy });
    insert(r.table, { [r.column]: quiet + 1000 });
  }
  insert(refs.INSTRUMENT_REFERENCES[0].table, { [refs.INSTRUMENT_REFERENCES[0].column]: busy });
  const progA = insert("competency_programs", { user_id: owner, name: "Made-up Chemistry program", lab_id: labA });
  const progB = insert("competency_programs", { user_id: owner, name: "Made-up other lab program", lab_id: labB });
  insert("competency_method_groups", { program_id: progA, name: "Group 1", instruments: JSON.stringify(["  made-up analyzer 1 ", "Something Else"]) });
  insert("competency_method_groups", { program_id: progA, name: "Group 2", instruments: "not json" });
  insert("competency_method_groups", { program_id: progB, name: "Other lab", instruments: JSON.stringify(["Made-up Analyzer 1"]) });

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const get = async (id: string | number, secret: string | null = process.env.ADMIN_SECRET || "") => {
    const r = await fetch(`${base}/api/admin/veritamap/instruments/${id}/references`, { headers: secret == null ? {} : { "x-admin-secret": secret } });
    return { status: r.status, cache: r.headers.get("cache-control"), j: await r.json().catch(() => ({})) as any };
  };
  const tables = () => (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[]).map((r) => r.name as string);
  const counts = () => Object.fromEntries(tables().map((t) => [t, Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n)]));

  try {
    const before = counts();

    // 1. Refusals.
    const noHdr = await get(busy, null);
    check("1. no admin header is refused", noHdr.status === 403, String(noHdr.status));
    const badHdr = await get(busy, "wrong-secret");
    check("1. a wrong admin header is refused", badHdr.status === 403, String(badHdr.status));
    const qs = await fetch(`${base}/api/admin/veritamap/instruments/${busy}/references?secret=${process.env.ADMIN_SECRET}`);
    check("1. the secret in the query string isn't accepted", qs.status === 403, String(qs.status));
    for (const bad of ["abc", "0", "-3", "1.5"]) {
      const r = await get(bad);
      check(`1. a bad id (${bad}) is 400`, r.status === 400, String(r.status));
    }
    const missing = await get(999999);
    check("1. an id that doesn't exist is 404", missing.status === 404, String(missing.status));

    // 2. Nothing points at the quiet analyzer.
    const q = await get(quiet);
    check("2. an analyzer nothing points at reads total 0", q.status === 200 && q.j.total === 0 && Object.values(q.j.counts || {}).every((n) => n === 0), JSON.stringify(q.j));
    check("2. ... every listed table is in the answer", Object.keys(q.j.counts || {}).length === refs.INSTRUMENT_REFERENCES.length);
    check("2. ... its own test and AMR rows are counted apart", q.j.ownRows?.tests === 2 && q.j.ownRows?.amrValues === 1, JSON.stringify(q.j.ownRows));
    check("2. ... map and lab are named by id", q.j.instrumentId === quiet && q.j.mapId === map && q.j.labId === labA, JSON.stringify(q.j));
    check("2. ... no method group names it", q.j.competencyMethodGroupsNamingIt === 0);
    check("2. ... not cached", q.cache === "no-store", String(q.cache));

    // 3. The busy analyzer.
    const b = await get(busy);
    const first = refs.INSTRUMENT_REFERENCES[0].table;
    const eachRight = refs.INSTRUMENT_REFERENCES.every((r) => b.j.counts?.[r.table] === (r.table === first ? 2 : 1));
    check("3. each referencing table's count is its own rows only", b.status === 200 && eachRight, JSON.stringify(b.j.counts));
    check("3. ... the total adds them up", b.j.total === refs.INSTRUMENT_REFERENCES.length + 1, String(b.j.total));
    check("3. ... its own rows", b.j.ownRows?.tests === 1 && b.j.ownRows?.amrValues === 1, JSON.stringify(b.j.ownRows));
    check("3. ... a method group in its lab naming it (case and spaces aside) counts; another lab's doesn't", b.j.competencyMethodGroupsNamingIt === 1, String(b.j.competencyMethodGroupsNamingIt));

    // 4. Every table holding an analyzer id is on the list.
    const own = new Set(["veritamap_instrument_tests", "veritamap_amr_values"]);
    const listed = new Set(refs.INSTRUMENT_REFERENCES.map((r) => `${r.table}.${r.column}`));
    const unlisted: string[] = [];
    for (const t of tables()) for (const c of colsOf(t)) {
      if ((c.name === "instrument_id" || c.name === "map_instrument_id") && !own.has(t) && !listed.has(`${t}.${c.name}`)) unlisted.push(`${t}.${c.name}`);
    }
    check("4. every instrument_id / map_instrument_id column is listed or is the analyzer's own rows", unlisted.length === 0, unlisted.join(", "));
    const listedMissing = refs.INSTRUMENT_REFERENCES.filter((r) => !colsOf(r.table).some((c) => c.name === r.column)).map((r) => `${r.table}.${r.column}`);
    check("4. every listed table and column exists", listedMissing.length === 0, listedMissing.join(", "));

    // 5. Read-only, no names.
    const after = counts();
    const changed = Object.keys(after).filter((t) => after[t] !== before[t]);
    check("5. it writes nothing", changed.length === 0, changed.join(", "));
    check("5. ... no record_views row", Number(sqlite.prepare("SELECT COUNT(*) AS n FROM record_views").get().n) === 0);
    const body = JSON.stringify(b.j) + JSON.stringify(q.j);
    check("5. ... names no analyzer, lab or person", !/Made-up/i.test(body), body.slice(0, 200));
  } finally {
    server.close();
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
