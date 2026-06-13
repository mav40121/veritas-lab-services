// scripts/audit-delete-cascades.mjs
//
// FK-cascade audit. Two production 500s have now come from the same class:
// a DELETE handler removes a parent row but leaves child rows whose FK points
// at it, so SQLite throws a foreign-key constraint error (HTTP 500).
//   - PR #748: deleting a VeritaResponse finding left finding_effectiveness_checks
//   - 2026-06-13: deleting a VeritaCheck verification left veritacheck_verification_analytes
//
// This script builds the parent -> [child tables] map from the schema's
// FOREIGN KEY ... REFERENCES declarations, then scans the server route files
// for `DELETE FROM <parent> WHERE id = ?` handlers and flags any whose
// surrounding handler body does NOT also `DELETE FROM <child>` for every child.
//
// Heuristic (not a parser): it inspects a window of lines around each parent
// delete. False positives are possible (e.g. ON DELETE CASCADE in the table
// def, or a child cleared in a helper) — every hit must be eyeballed. Exit 1
// if any parent-delete is missing a child clear, so it can gate CI later.

import { readFileSync } from "node:fs";

const SCHEMA = "server/db.ts";
const ROUTE_FILES = [
  "server/routes.ts",
  "server/veritacheck_verification.ts",
];

// 1. Build child -> parent and parent -> [children] from FOREIGN KEY decls.
const schema = readFileSync(SCHEMA, "utf8");
// Track the current CREATE TABLE name so a FOREIGN KEY line maps to its child.
const lines = schema.split(/\r?\n/);
let currentTable = null;
const parentToChildren = new Map();
const fkColOfChild = new Map(); // `${child}->${parent}` -> column name (best effort)
for (const line of lines) {
  const create = line.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/);
  if (create) { currentTable = create[1]; continue; }
  const fk = line.match(/FOREIGN KEY\s*\(\s*(\w+)\s*\)\s*REFERENCES\s+(\w+)\s*\(/i);
  if (fk && currentTable) {
    const col = fk[1], parent = fk[2], child = currentTable;
    if (parent === child) continue; // self-ref, skip
    if (!parentToChildren.has(parent)) parentToChildren.set(parent, new Set());
    parentToChildren.get(parent).add(child);
    fkColOfChild.set(`${child}->${parent}`, col);
  }
}

// 2. Detect ON DELETE CASCADE tables (those self-clean, exclude from findings).
const cascadeChildren = new Set();
{
  let cur = null;
  for (const line of lines) {
    const create = line.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/);
    if (create) { cur = create[1]; continue; }
    if (cur && /ON DELETE CASCADE/i.test(line)) cascadeChildren.add(cur);
  }
}

// Allowlist of parent->child misses that are KNOWN and pending a product
// decision (delete the child vs. NULL its FK to preserve surveyor evidence).
// Keyed by `parent::child`. New misses NOT on this list fail the audit, so the
// FK-cascade class can't silently regrow. Revisit when Michael rules on each.
const ALLOWLIST = new Map([
  // Deleting a VeritaMap instrument must NOT wipe staff competency/duty history
  // — those are CLIA surveyor evidence. Correct fix is to NULL instrument_id,
  // not delete the row. Pending decision.
  ["veritamap_instruments::staff_duty_change_events", "preserve staff history — NULL the FK, not delete"],
  ["veritamap_instruments::staff_employee_instruments", "preserve staff-instrument competency link — NULL the FK, not delete"],
  // Deleting a competency assessment record: element documents belong to it,
  // likely safe to cascade, but unverified against a live 500. Pending.
  ["competency_assessments::competency_element_documents", "likely owned-cascade; verify before shipping"],
  // Deleting a competency QUIZ definition would wipe historical results +
  // assignments = who-passed-what evidence. Must preserve, not delete. Pending.
  ["competency_quizzes::competency_quiz_results", "preserve quiz-result evidence — do not cascade-delete"],
  ["competency_quizzes::competency_quiz_assignments", "preserve assignment evidence — do not cascade-delete"],
  // Deleting a policy document: its quiz questions are config attached to the
  // doc, likely safe to cascade, but 3 handlers + unverified. Pending.
  ["policy_documents::policy_quiz_questions", "likely owned-cascade; verify the 3 handlers before shipping"],
]);

// 3. Scan route files for `DELETE FROM <parent> WHERE id = ?` and check the
//    handler window for a delete of each child.
const findings = [];
const allowed = [];
for (const file of ROUTE_FILES) {
  let src;
  try { src = readFileSync(file, "utf8"); } catch { continue; }
  const srcLines = src.split(/\r?\n/);
  for (let i = 0; i < srcLines.length; i++) {
    const m = srcLines[i].match(/DELETE FROM\s+(\w+)\s+WHERE\s+id\s*=\s*\?/i);
    if (!m) continue;
    const parent = m[1];
    const children = parentToChildren.get(parent);
    if (!children || children.size === 0) continue;
    // Window: 25 lines above the parent delete (handlers clear children first).
    const start = Math.max(0, i - 25);
    const window = srcLines.slice(start, i + 2).join("\n");
    const missing = [];
    for (const child of children) {
      if (cascadeChildren.has(child)) continue; // self-cleans via ON DELETE CASCADE
      const clears = new RegExp(`DELETE FROM\\s+${child}\\b`).test(window);
      if (clears) continue;
      if (ALLOWLIST.has(`${parent}::${child}`)) { allowed.push({ file, line: i + 1, parent, child }); continue; }
      missing.push(child);
    }
    if (missing.length) {
      findings.push({ file, line: i + 1, parent, missing });
    }
  }
}

console.log("FK parent->children map (non-cascade children only):");
for (const [parent, kids] of parentToChildren) {
  const real = [...kids].filter(k => !cascadeChildren.has(k));
  if (real.length) console.log(`  ${parent} -> ${real.join(", ")}`);
}
console.log("");

if (allowed.length) {
  console.log(`${allowed.length} known/allowlisted miss(es) pending a product decision (delete vs preserve):`);
  for (const a of allowed) console.log(`  ${a.file}:${a.line}  ${a.parent} -> ${a.child}  [${ALLOWLIST.get(`${a.parent}::${a.child}`)}]`);
  console.log("");
}
if (!findings.length) {
  console.log("PASS: every `DELETE FROM <parent> WHERE id = ?` handler clears its non-cascade children (or is allowlisted).");
  process.exit(0);
}
console.log(`FAIL: ${findings.length} parent-delete handler(s) missing a child clear:\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}  DELETE FROM ${f.parent}`);
  console.log(`     missing child clears: ${f.missing.join(", ")}`);
}
process.exit(1);
