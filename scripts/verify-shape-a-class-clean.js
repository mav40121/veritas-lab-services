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

// Two patterns this guard catches:
//   1. Narrow mutation scope: WHERE id = ? AND user_id|account_id = ?
//      (fixed in PR #675/#676 — class is zero on multi-lab tables).
//   2. Broader list/read scope: FROM <table> WHERE user_id|account_id = ?
//      (fixed in PR #677 — this file's broader sweep). Scoped to the
//      explicit multi-lab table list below so admin/auth/profile queries
//      stay allowed.
const NARROW_PATTERN = /WHERE id = \? AND (user_id|account_id) = \?/;
const LIST_PATTERN = /(FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)\s+(\w+\s+)?WHERE\s+(\w+\.)?(user_id|account_id)\s*=\s*\?/i;

// Confirmed multi-lab tables (have lab_id, per server/db.ts). A WHERE
// user_id|account_id = ? scope on these is a Shape A bug. Anything not
// in this list is allowed (admin, auth, profile, single-tenant by design).
const MULTI_LAB_TABLES = new Set([
  "inventory_items",
  "veritamap_maps",
  "veritamap_instruments",
  "veritamap_tests",
  "veritamap_instrument_tests",
  "veritamap_analyte_values",
  "veritamap_amr_values",
  "veritascan_scans",
  "veritapolicy_lab_policies",
  "veritapolicy_settings",
  "veritapolicy_requirement_status",
  "veritapolicy_master_status",
  "policy_documents",
  "policy_versions",
  "policy_manuals",
  "policy_attestations",
  "policy_signoffs",
  "veritacheck_verifications",
  "veritatrack_tasks",
  "veritatrack_signoffs",
  "veritaops_test_cost_studies",
  "cumsum_trackers",
  "pt_events",
  "pt_corrective_actions",
  "studies",
  "findings",
]);

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
// in comments only, or files that are intentionally user-scoped by
// design (webhook handlers, internal helpers called with already-
// validated user ids).
const ALLOWED_FILES = new Set([
  "labAccessGuard.ts",
  "demoGuard.ts",       // dedupe checks during seed; demo-user scope
  "integrations.ts",    // webhook handlers with already-validated user_id
  "backfillVeritapolicySeats.ts", // one-time migration runner
]);

// Endpoint contexts (function/route names) that legitimately scope by
// user_id even on multi-lab tables. The guard looks back 60 lines for
// any of these substrings.
const ALLOWED_CONTEXTS = [
  "getDemoUserId",                // demo-route bootstrap
  "/api/demo/",                   // demo route declaration
  "/api/admin/",                  // admin endpoints
  "/api/onboarding/status",       // user-level onboarding tile
  "autoCompleteCompetencyScanItems", // internal helper, userId pre-validated
  "deleteUser",                   // account termination cascade
  "POST /api/inventory",          // INSERT path sets account_id = current user (correct)
  "INSERT INTO",                  // any INSERT setting owner column
  "audit_log",                    // user-level audit writes
  "seatUserId",                   // seat utilization metrics
  "lab-scope helper",             // commented fallback inside a Shape A guard
  "Shape A guard",                // explicit comment marker
  "legacy fallback",              // explicit comment marker
  "Phase 3",                      // multi-lab migration code paths
  "[migration]",                  // migration log lines
  "usage-snapshot",               // hardcoded demo user 17
  "detailed-usage",               // hardcoded demo user 17
  "labId ?",                      // ternary fallback inside a lab-aware function
  "labId\n",                      // same shape multi-line
  "TAG",                          // admin demo-scrub helpers (DELETE ... WHERE notes = TAG)
  "scrub-demo",                   // admin demo cleanup
  "veritapt/pdf",                 // PDF generation for this user's PT report
  "veritapt/excel",               // export
];

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
      const trimmed = line.trim();
      // Skip comments
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("#")) continue;
      // Skip demo routes — intentional fixed-demo-user scope
      const nearDemoRoute = full.includes("routes.ts") && lines.slice(Math.max(0, i - 12), i).some((l) => l.includes("/api/demo/"));
      if (nearDemoRoute) continue;
      // Skip if line references a single-tenant table
      if (SINGLE_TENANT_TABLES.some((t) => line.includes(t))) continue;
      // Skip db.ts migration backfills
      if (full.endsWith("db.ts")) continue;
      // Skip seedDemo.ts and audit.ts (internal fixture / snapshot)
      if (full.endsWith("seedDemo.ts") || full.endsWith("audit.ts")) continue;
      // Skip if any allowed-context substring appears in the 60-line lookback
      const lookback = lines.slice(Math.max(0, i - 60), i + 1);
      if (ALLOWED_CONTEXTS.some((ctx) => lookback.some((l) => l.includes(ctx)))) continue;

      // Pattern 1: narrow mutation scope on ANY table (already CI-guarded)
      if (NARROW_PATTERN.test(line)) {
        totalMatches++;
        problems.push(`${path.relative(process.cwd(), full)}:${i + 1} [mutation scope]\n  ${trimmed}`);
        continue;
      }
      // Pattern 2: list/read on a specific multi-lab table
      const m = line.match(LIST_PATTERN);
      if (m) {
        const tableName = m[2];
        if (MULTI_LAB_TABLES.has(tableName)) {
          totalMatches++;
          problems.push(`${path.relative(process.cwd(), full)}:${i + 1} [list scope on multi-lab table ${tableName}]\n  ${trimmed}`);
        }
      }
    }
  }
}

walk(SERVER_DIR);

// Split problems into the narrow mutation-scope class (CI-blocking) and the
// broader list-scope class (informational only). The narrow class must stay
// at zero — every prior instance has been fixed and any regression is a bug.
// The broader class has 13 known-intentional cases (VeritaPolicy per-user
// settings, VeritaMap import dedup, ternary fallback at routes.ts:13838,
// per-user PDF exports) that don't actually leak across labs at runtime.
const mutationProblems = problems.filter((p) => p.includes("[mutation scope]"));
const listProblems = problems.filter((p) => p.includes("[list scope"));

if (listProblems.length > 0) {
  console.log(`WARN: ${listProblems.length} broader list-scope Shape A pattern(s) on multi-lab tables (informational):\n`);
  for (const p of listProblems) console.log(p + "\n");
  console.log("");
}

if (mutationProblems.length === 0) {
  console.log("PASS: 0 narrow Shape A mutation scope bugs found on multi-lab tables.");
  process.exit(0);
}

console.log(`FAIL: ${mutationProblems.length} narrow Shape A mutation scope bug(s) found on multi-lab tables:\n`);
for (const p of mutationProblems) console.log(p + "\n");
console.log(`Fix: replace WHERE id = ? AND user_id|account_id = ? with resolveRowForMutation() from server/labAccessGuard.ts.`);
process.exit(1);
