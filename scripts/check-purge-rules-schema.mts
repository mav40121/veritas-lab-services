// scripts/check-purge-rules-schema.mts
//
// Reads a structure-only schema copy (GET /api/admin/schema-db: tables and columns, no records) and reports any table the
// customer purge (server/customerPurge.ts) has no rule for, and any table without rowid. Opens the copy read-only, so the
// app's boot never runs against it. Exit 1 when anything is missing.
// Run: DB_PATH=.tmp-purgerules.db npx tsx scripts/check-purge-rules-schema.mts <schema.db>
import Database from "better-sqlite3";
import { unruledTables, purgeRule, appTables } from "../server/customerPurge";

const file = process.argv[2];
if (!file) { console.log("usage: check-purge-rules-schema.mts <schema.db>"); process.exit(2); }
const sqlite = new Database(file, { readonly: true, fileMustExist: true });
const tables = appTables(sqlite);
const system = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as any[]).map((r) => r.name as string).filter((n) => !tables.includes(n));
console.log(`system or transient tables left alone: ${system.length ? system.join(", ") : "none"}`);
const missing = unruledTables(sqlite);
const noRowid = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%WITHOUT ROWID%'").all() as any[]).map((r) => r.name);
const kinds: Record<string, number> = {};
for (const t of tables) { const r = purgeRule(t); const k = r ? r.kind : "none"; kinds[k] = (kinds[k] ?? 0) + 1; }
console.log(`tables: ${tables.length} | rules: ${JSON.stringify(kinds)}`);
console.log(`no rule: ${missing.length ? missing.join(", ") : "none"}`);
console.log(`without rowid: ${noRowid.length ? noRowid.join(", ") : "none"}`);
process.exit(missing.length || noRowid.length ? 1 : 0);
