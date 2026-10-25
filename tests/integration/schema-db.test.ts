// tests/integration/schema-db.test.ts
//
// GET /api/admin/schema-db (2026-10-25; Lifepoint questionnaire "customer data is not used for testing or
// development"). Testing and SQL checks use a structure-only copy instead of a production download. Pins:
//   1. the admin secret is required
//   2. the file is a SQLite database with every table, index, view and trigger of the source, and the same columns
//   3. it holds no records: every table is empty and a value stored in the source is nowhere in the file
//   4. the download is audit-logged as admin.schema_db_download
// Run: npm run test:schema-db

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

(globalThis as any).require ??= createRequire(import.meta.url);
const Database = (globalThis as any).require("better-sqlite3");

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const marker = "schema-probe-person@example.com";
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS zz_schema_probe (id INTEGER PRIMARY KEY, email TEXT NOT NULL, lab_id INTEGER);
    CREATE INDEX IF NOT EXISTS zz_schema_probe_lab ON zz_schema_probe (lab_id);
    CREATE VIEW IF NOT EXISTS zz_schema_probe_v2 AS SELECT * FROM zz_schema_probe_v1;
    CREATE VIEW IF NOT EXISTS zz_schema_probe_v1 AS SELECT id, email FROM zz_schema_probe;
    CREATE TRIGGER IF NOT EXISTS zz_schema_probe_t AFTER INSERT ON zz_schema_probe BEGIN SELECT 1; END;
  `);
  sqlite.prepare("INSERT INTO zz_schema_probe (email, lab_id) VALUES (?, 7)").run(marker);
  try {
    const no = await fetch(base + "/api/admin/schema-db");
    const wrong = await fetch(base + "/api/admin/schema-db", { headers: { "x-admin-secret": "not-the-secret" } });
    check("1. the admin secret is required", no.status === 403 && wrong.status === 403, `${no.status}/${wrong.status}`);

    const r = await fetch(base + "/api/admin/schema-db", { headers: { "x-admin-secret": String(process.env.ADMIN_SECRET) } });
    const buf = Buffer.from(await r.arrayBuffer());
    check("2a. 200 with a SQLite file", r.status === 200 && buf.subarray(0, 15).toString() === "SQLite format 3", String(r.status));
    const copy = new Database(buf);
    const objs = (d: any) => (d.prepare("SELECT type, name FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all() as any[]).map((o) => `${o.type} ${o.name}`);
    const src = objs(sqlite), got = new Set(objs(copy));
    const missing = src.filter((o: string) => !got.has(o));
    check("2b. every table, index, view and trigger is rebuilt (a view that depends on a later one too)", missing.length === 0 && src.length > 50, missing.join(", ") || `${src.length} objects`);
    const tables = (copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as any[]).map((t) => t.name as string);
    const cols = (d: any, t: string) => (d.prepare(`PRAGMA table_info("${t}")`).all() as any[]).map((c) => `${c.name}:${c.type}:${c.notnull}`).join(",");
    const differ = tables.filter((t) => cols(copy, t) !== cols(sqlite, t));
    check("2c. each table has the same columns as the source", differ.length === 0, differ.join(", "));
    check("2d. the header names the object count and nothing missing", r.headers.get("x-schema-objects") === String(got.size) && r.headers.get("x-schema-missing") === "", `${r.headers.get("x-schema-objects")} / "${r.headers.get("x-schema-missing")}"`);

    const srcRows = (sqlite.prepare("SELECT COUNT(*) AS n FROM zz_schema_probe").get() as any).n;
    const nonEmpty = tables.filter((t) => (copy.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as any).n > 0);
    check("3a. every table in the copy is empty", nonEmpty.length === 0 && srcRows === 1, nonEmpty.join(", "));
    check("3b. a value stored in the source is nowhere in the file", !buf.includes(Buffer.from(marker)));
    copy.close();

    const audit = sqlite.prepare("SELECT entity_label FROM audit_log WHERE entity_type = 'admin.schema_db_download' ORDER BY id DESC LIMIT 1").get() as any;
    check("4. the download is audit-logged", !!audit && /structure only, no records/.test(audit.entity_label), audit?.entity_label);
  } finally {
    sqlite.exec("DROP VIEW IF EXISTS zz_schema_probe_v2; DROP VIEW IF EXISTS zz_schema_probe_v1; DROP TABLE IF EXISTS zz_schema_probe;");
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
