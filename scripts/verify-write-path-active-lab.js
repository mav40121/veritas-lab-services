#!/usr/bin/env node
// scripts/verify-write-path-active-lab.js
//
// Write-path active-lab guard (2026-06-11).
//
// The bug class behind PR #722: a create endpoint INSERTs a row, then
// dual-writes lab_id from the OWNER's default lab instead of the lab the
// request is actually scoped to:
//
//   UPDATE <table> SET lab_id = (SELECT lab_id FROM users WHERE id = ?) WHERE id = ?
//
// For a single-lab user this is harmless (default lab == active lab). For a
// multi-lab owner working in a non-default lab via X-Active-Lab-Id, the new
// row is stamped with the WRONG lab and then hidden by the (correct) lab-
// scoped reads. The fix is to resolve the active lab:
//
//   const activeLab = resolveActiveLabForRequest(dataUserId, req);
//   UPDATE <table> SET lab_id = ? WHERE id = ?   // activeLab?.id ?? <fallback>
//
// The existing Shape-A guard (verify-shape-a-class-clean.js) does NOT catch
// this: it allow-lists any line near "INSERT INTO", and this dual-write sits
// right after the INSERT. Hence this separate guard.
//
// Mechanism: count create-time dual-writes across server/, EXCLUDING the
// `... AND lab_id IS NULL` backfill guards (those intentionally fill legacy
// NULL rows from the default lab and must NOT be changed). Compare the count
// against the pinned BASELINE. CI fails if the count goes UP (a new instance
// was introduced) or DOWN without lowering BASELINE (a fix landed but the
// ratchet was not advanced). Drive BASELINE to 0 via the module-batch PRs.
//
// Inventory at BASELINE=20 (2026-06-11, after #722 fixed veritascan_scans):
//   server/routes.ts        : veritamap_maps, cumsum_trackers, pt_enrollments_v2,
//                             aa_records, findings, competency_programs x2,
//                             competency_employees, competency_quizzes x2,
//                             lab_certificates x3, lab_certificate_documents,
//                             pt_enrollments, pt_events, pt_corrective_actions  (17)
//   server/veritabench.ts   : inventory_items                                    (1)
//   server/veritatrack.ts   : veritatrack_tasks, veritatrack_signoffs            (2)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.join(__dirname, "..", "server");

// The create-time default-lab dual-write. Parens and ? escaped for regex.
const DUAL_WRITE = /SET lab_id = \(SELECT lab_id FROM users WHERE id = \?\) WHERE id = \?/;

// Number of known, not-yet-fixed instances. LOWER THIS as module-batch PRs
// land. When it reaches 0, flip the comparison to a hard zero-tolerance gate.
const BASELINE = 20;

let found = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
      walk(full);
      continue;
    }
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".js")) continue;
    const lines = fs.readFileSync(full, "utf-8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      // Skip comments (so this guard's own header / doc comments never count).
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("#")) continue;
      if (!DUAL_WRITE.test(line)) continue;
      // Exclude backfill guards: `... WHERE id = ? AND lab_id IS NULL` fill
      // legacy NULL rows from the default lab on purpose. Not the bug.
      if (line.includes("IS NULL")) continue;
      const table = (line.match(/UPDATE\s+([A-Za-z_][A-Za-z0-9_]*)/) || [])[1] || "?";
      found.push(`${path.relative(process.cwd(), full)}:${i + 1} [${table}]\n  ${trimmed}`);
    }
  }
}

walk(SERVER_DIR);

const count = found.length;
console.log(`write-path active-lab dual-writes found: ${count} (baseline ${BASELINE})\n`);
for (const f of found) console.log(f + "\n");

if (count > BASELINE) {
  console.log(
    `FAIL: ${count - BASELINE} NEW create-time default-lab dual-write(s) introduced.\n` +
    `Fix: resolve the active lab instead of the owner's default lab, e.g.\n` +
    `  const activeLab = resolveActiveLabForRequest(dataUserId, req);\n` +
    `  UPDATE <table> SET lab_id = ? WHERE id = ?   // activeLab?.id ?? <fallback>\n` +
    `If this row is a deliberate single-tenant write, add "IS NULL" backfill semantics or an allow comment.`
  );
  process.exit(1);
}

if (count < BASELINE) {
  console.log(
    `FAIL: count dropped to ${count} but BASELINE is still ${BASELINE}.\n` +
    `A fix landed without advancing the ratchet. Lower BASELINE to ${count} in this PR ` +
    `(scripts/verify-write-path-active-lab.js) so the gain is locked in.`
  );
  process.exit(1);
}

console.log(`PASS: ${count} known instance(s), none new. Drive BASELINE to 0 via module-batch PRs.`);
process.exit(0);
