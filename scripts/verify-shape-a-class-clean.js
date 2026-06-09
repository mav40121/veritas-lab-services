#!/usr/bin/env node
// scripts/verify-shape-a-class-clean.js
//
// Class-sweep receipt for Shape A mutation scope (2026-06-09).
// Greps the server for the bug pattern and fails CI if any new
// instance lands on a multi-lab table.
//
// The bug shape:
//   `WHERE id = ? AND user_id = ?` or `WHERE id = ? AND account_id = ?`
// on a table that has a lab_id column. Tables without lab_id
// (productivity_months, staffing_studies, pi_departments, pi_metrics,
// pi_entries) are intentional single-tenant scope; this script keeps
// them on the allowlist.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_DIR = path.join(__dirname, "..", "server");
const BAD_PATTERN = /WHERE id = \? AND (user_id|account_id) = \?/g;

// Tables without lab_id — intentional single-tenant scope. Lines that
// reference one of these table names get a pass.
const SINGLE_TENANT_TABLES = [
  "productivity_months",
  "staffing_studies",
  "pi_departments",
  "pi_metrics",
  "pi_entries",
];

// File-level allowlist: documentation files where the pattern appears
// in comments only.
const ALLOWED_FILES = new Set([
  "labAccessGuard.ts",
]);

let totalMatches = 0;
let problems = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
      walk(full);
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) continue;
    if (ALLOWED_FILES.has(entry.name)) continue;
    const text = fs.readFileSync(full, "utf-8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!BAD_PATTERN.test(line)) {
        BAD_PATTERN.lastIndex = 0;
        continue;
      }
      BAD_PATTERN.lastIndex = 0;
      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("#")) continue;
      // Skip if line references a single-tenant table
      const usesSingleTenant = SINGLE_TENANT_TABLES.some((t) => line.includes(t));
      if (usesSingleTenant) continue;
      // Skip demo routes — intentional fixed-demo-user scope
      if (full.includes("routes.ts") && lines.slice(Math.max(0, i - 12), i).some((l) => l.includes("/api/demo/"))) continue;
      totalMatches++;
      problems.push(`${path.relative(process.cwd(), full)}:${i + 1}\n  ${trimmed}`);
    }
  }
}

walk(SERVER_DIR);

if (problems.length === 0) {
  console.log("PASS: 0 Shape A mutation scope bugs found on multi-lab tables.");
  process.exit(0);
}

console.log(`FAIL: ${problems.length} Shape A mutation scope bug(s) found on multi-lab tables:\n`);
for (const p of problems) console.log(p + "\n");
console.log(`Fix: replace WHERE id = ? AND user_id|account_id = ? with resolveRowForMutation() from server/labAccessGuard.ts.`);
process.exit(1);
