// scripts/audit-sql-columns.mjs
//
// Static guard against the bug class behind the 2026-07-06 audit-log 500
// (SqliteError "no such column: u.lab_name"): a prepared statement that
// references a column or table that does not exist. Such a query is only
// caught when a user actually hits the endpoint. This audit extracts every
// STATIC SQL string passed to .prepare(...) in server/*.ts and prepares it
// against a real schema, so column/table typos surface at build time instead
// of in production.
//
// Dynamic queries (those built with ${...} interpolation) cannot be validated
// this way and are SKIPPED and COUNTED (never silently dropped).
//
// Usage: node scripts/audit-sql-columns.mjs <schemaDbPath>
//   schemaDbPath: a SQLite file whose schema matches PRODUCTION. Use a real,
//   accumulated schema: a /api/admin/backup-db snapshot, or a long-lived dev
//   veritas.db that has been through the migrations over time.
//
//   Do NOT point this at a freshly-booted empty DB. Several ALTER migrations
//   are guarded on data/column preconditions (e.g. the inventory_lots lab_id
//   backfill), so a from-scratch boot yields an INCOMPLETE schema and dozens
//   of false positives. This is also why it is a manual pre-ship check rather
//   than a CI gate: CI has no faithful schema to validate against without the
//   admin secret. (The from-scratch gap is itself a disaster-recovery note:
//   rebuilding prod's volume from boot alone would miss those columns.)

import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const dbPath = process.argv[2];
if (!dbPath) { console.error("usage: node scripts/audit-sql-columns.mjs <schemaDbPath>"); process.exit(2); }
const db = new Database(dbPath, { readonly: true });

// Extract the string argument that immediately follows each `.prepare(`.
// Returns { sql, dynamic } or null when the argument is not a string literal.
function extractPrepareArgs(src) {
  const out = [];
  let i = 0;
  const needle = ".prepare(";
  while ((i = src.indexOf(needle, i)) !== -1) {
    let j = i + needle.length;
    while (j < src.length && /\s/.test(src[j])) j++;
    const q = src[j];
    if (q === "`" || q === '"' || q === "'") {
      let k = j + 1;
      let buf = "";
      while (k < src.length) {
        const c = src[k];
        if (c === "\\") { buf += c + (src[k + 1] || ""); k += 2; continue; }
        if (c === q) break;
        buf += c;
        k++;
      }
      out.push({ sql: buf, dynamic: q === "`" && buf.includes("${"), line: src.slice(0, i).split("\n").length });
      i = k + 1;
    } else {
      out.push(null); // argument is a variable/expression, not a literal
      i = j;
    }
  }
  return out;
}

const files = readdirSync("server").filter((f) => f.endsWith(".ts")).map((f) => join("server", f));
let staticCount = 0, dynamicCount = 0, nonLiteral = 0, okCount = 0;
const failures = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const arg of extractPrepareArgs(src)) {
    if (arg === null) { nonLiteral++; continue; }
    if (arg.dynamic) { dynamicCount++; continue; }
    const sql = arg.sql.trim();
    if (!sql) { nonLiteral++; continue; }
    // Only DML/queries; skip PRAGMA/CREATE/ALTER (schema ops validate trivially
    // and can reference not-yet-created objects during boot).
    if (/^\s*(PRAGMA|CREATE|ALTER|DROP|BEGIN|COMMIT|VACUUM)\b/i.test(sql)) { okCount++; continue; }
    staticCount++;
    try {
      db.prepare(sql);
      okCount++;
    } catch (e) {
      const msg = String(e.message);
      const tableMatch = msg.match(/no such table:\s*([A-Za-z0-9_]+)/i);
      // Migration rebuilds create a transient <name>_new / _old / _tmp table,
      // copy into it, then rename it into place, so it never exists in the
      // final schema snapshot. Those "no such table" hits are expected.
      const isMigrationTemp = tableMatch && /_(new|old|tmp|temp|backup|bak|v2|migration)$/i.test(tableMatch[1]);
      if (/no such column/i.test(msg) || (/no such table/i.test(msg) && !isMigrationTemp)) {
        failures.push({ file, line: arg.line, msg, sql: sql.replace(/\s+/g, " ").slice(0, 160) });
      } else {
        // Migration temp tables, or non-schema errors that are almost always
        // extraction artifacts (truncated SQL, unknown function). Count as OK.
        okCount++;
      }
    }
  }
}

console.log(`Validated ${staticCount} static queries against ${dbPath}`);
console.log(`  dynamic (\${...}) skipped: ${dynamicCount}`);
console.log(`  non-literal args skipped: ${nonLiteral}`);
console.log(`  schema-shape failures: ${failures.length}`);
for (const f of failures) {
  console.log(`\nFAIL ${f.file}:${f.line}`);
  console.log(`  ${f.msg}`);
  console.log(`  ${f.sql}`);
}
db.close();
process.exit(failures.length === 0 ? 0 : 1);
