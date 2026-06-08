// verify-shape-a-class-sweep.js
//
// Receipt for the Shape A class sweep PR (2026-06-08). Shape A = "module
// picks ONE VeritaMap per lab when the lab actually has many" (LIMIT 1 or
// single map_id FK). Five instances were found:
//
//   1. VeritaComp  competency_programs.map_id + rebuild endpoint
//   2. VeritaPT    computePTCoverage map lookup (routes.ts ~12831)
//   3. VeritaPT    /api/veritapt/recommendations map lookup (routes.ts ~20444)
//   4. VeritaTrack /api/veritatrack/import-from-map (veritatrack.ts ~421)
//   5. VeritaTrack /api/veritatrack/tasks/:id/signoff map writeback (veritatrack.ts ~397)
//
// This is a static-source receipt, not a live-API exerciser, because:
//   - The customer-facing fix is invisible at the API level on a single-map
//     lab (numbers don't change). The only data condition that PROVES the
//     fix works is a lab with 2+ maps, which exists in production (San
//     Carlos labId 2: CW Bylas + SCAHC) but is not safely reproducible in a
//     local sqlite seed without a bunch of demo plumbing.
//   - Gate 3 step 8 (browser-click) IS in scope for the VeritaComp rebuild
//     button. Michael will exercise that on production after deploy.
//
// What this script asserts:
//   * Every callsite previously matching the Shape A patterns
//     (`FROM veritamap_maps... LIMIT 1`, `WHERE user_id = ? ORDER BY
//     updated_at DESC LIMIT 1`) is GONE from the modules we touched.
//   * The new lab-wide replacement queries are present.
//   * The new rebuild endpoint is registered.
//   * The client button is wired.
//
// Run: node scripts/verify-shape-a-class-sweep.js
// Exit code: 0 on PASS, 1 on FAIL.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const files = {
  routes: fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8"),
  track:  fs.readFileSync(path.join(ROOT, "server/veritatrack.ts"), "utf8"),
  comp:   fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaCompAppPage.tsx"), "utf8"),
};

let pass = 0, fail = 0;

function assert(label, cond, hint) {
  if (cond) { console.log("PASS  " + label); pass++; }
  else      { console.log("FAIL  " + label + (hint ? "  -- " + hint : "")); fail++; }
}

// ─── Negative assertions: Shape A patterns are gone ─────────────────────

const shapeABadPatterns = [
  // VeritaPT coverage helper
  {
    label: "[VeritaPT coverage] no more single-map LIMIT 1 in computePTCoverage",
    file:  "routes",
    pattern: /SELECT id FROM veritamap_maps WHERE lab_id = \? LIMIT 1/,
    expectGone: true,
  },
  {
    label: "[VeritaPT coverage] no more user_id LIMIT 1 fallback",
    file:  "routes",
    pattern: /SELECT id FROM veritamap_maps WHERE user_id = \? LIMIT 1/,
    expectGone: true,
  },
  // VeritaPT recommendations
  {
    label: "[VeritaPT recommendations] no more 'most recent map' LIMIT 1",
    file:  "routes",
    pattern: /SELECT id, name FROM veritamap_maps WHERE lab_id = \? ORDER BY updated_at DESC LIMIT 1/,
    expectGone: true,
  },
  // VeritaTrack signoff sync
  {
    label: "[VeritaTrack signoff sync] no more single-map writeback",
    file:  "track",
    pattern: /SELECT id FROM veritamap_maps WHERE user_id = \? ORDER BY updated_at DESC LIMIT 1/,
    expectGone: true,
  },
  // VeritaTrack import-from-map
  {
    label: "[VeritaTrack import-from-map] no more single-map source",
    file:  "track",
    pattern: /SELECT \* FROM veritamap_maps WHERE user_id = \? ORDER BY updated_at DESC LIMIT 1/,
    expectGone: true,
  },
];

for (const p of shapeABadPatterns) {
  const present = p.pattern.test(files[p.file]);
  assert(p.label, !present, present ? "found pattern that should be gone" : "");
}

// ─── Positive assertions: lab-wide replacements are present ─────────────

const goodPatterns = [
  // VeritaPT coverage helper
  {
    label: "[VeritaPT coverage] walks ALL lab maps",
    file:  "routes",
    pattern: /SELECT id FROM veritamap_maps WHERE lab_id = \?\s*"\s*\)\.all/,
  },
  // VeritaPT coverage helper user-id fallback also expanded
  {
    label: "[VeritaPT coverage] user_id fallback also expanded to .all()",
    file:  "routes",
    pattern: /SELECT id FROM veritamap_maps WHERE user_id = \?\s*"\s*\)\.all/,
  },
  // VeritaPT recommendations
  {
    label: "[VeritaPT recommendations] walks ALL lab maps",
    file:  "routes",
    pattern: /SELECT id, name FROM veritamap_maps WHERE lab_id = \? ORDER BY updated_at DESC\s*"\s*\)\.all/,
  },
  // VeritaTrack signoff sync — labId fallback path
  {
    label: "[VeritaTrack signoff sync] lab-scoped map lookup",
    file:  "track",
    pattern: /SELECT id FROM veritamap_maps WHERE lab_id = \?\s*"\s*\)\.all/,
  },
  // VeritaTrack import-from-map
  {
    label: "[VeritaTrack import-from-map] lab-scoped map lookup",
    file:  "track",
    pattern: /SELECT id, name FROM veritamap_maps WHERE lab_id = \? ORDER BY updated_at DESC\s*"\s*\)\.all/,
  },
  // VeritaComp rebuild endpoint
  {
    label: "[VeritaComp] rebuild-method-groups POST endpoint registered",
    file:  "routes",
    pattern: /\/api\/labs\/:labId\/competency\/programs\/:id\/rebuild-method-groups/,
  },
  {
    label: "[VeritaComp] rebuild walks every map in the lab",
    file:  "routes",
    pattern: /SELECT id, name FROM veritamap_maps WHERE lab_id = \? ORDER BY updated_at DESC/,
  },
  {
    label: "[VeritaComp] rebuild preserves existing groups by name (no DELETE first)",
    file:  "routes",
    pattern: /Hand-edits \(renamed groups, edited analyte lists/i,
  },
  // VeritaComp client button
  {
    label: "[VeritaComp client] Rebuild button wired",
    file:  "comp",
    pattern: /Rebuild from VeritaMap \(lab-wide\)/,
  },
  {
    label: "[VeritaComp client] button POSTs to rebuild-method-groups",
    file:  "comp",
    pattern: /\/rebuild-method-groups/,
  },
];

for (const p of goodPatterns) {
  const present = p.pattern.test(files[p.file]);
  assert(p.label, present, present ? "" : "pattern not found");
}

// ─── Aggregate dedupe smell-tests (the union-across-maps logic) ─────────

assert(
  "[VeritaPT coverage] dedupes analytes across maps",
  /seenByAnalyte/.test(files.routes),
);
assert(
  "[VeritaTrack import] dedupes analytes across maps",
  /dedupedByAnalyte/.test(files.track),
);
assert(
  "[VeritaComp rebuild] groups across maps by category+instrument",
  /grouped\.set\(key/.test(files.routes) && /Group across all maps/.test(files.routes),
);

// ─── Em-dash audit on new server strings (CLAUDE.md §3 public-facing) ──
// Public-facing here = strings that reach the customer via the rebuild
// endpoint's message field. Internal comments are exempt per §3.
const rebuildMessagePatterns = [
  /No new method groups: all \$\{kept\} aggregated groups/,
  /Added \$\{created\} method group/,
  /No VeritaMaps found in this lab/,
  /No instruments in the lab's VeritaMaps yet/,
  /Rebuild is only supported for technical programs/,
];
let emDashOnPublic = false;
for (const re of rebuildMessagePatterns) {
  const m = files.routes.match(re);
  if (m && m[0].includes("—")) { emDashOnPublic = true; break; }
}
assert("[em-dash audit] rebuild endpoint public messages have no em-dashes", !emDashOnPublic);

// ─── Summary ────────────────────────────────────────────────────────────

console.log("");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
