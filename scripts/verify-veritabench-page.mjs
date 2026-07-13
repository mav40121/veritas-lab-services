// scripts/verify-veritabench-page.mjs
//
// Receipt for the VeritaBench/VeritaPace page-hardening batch (2026-07-12):
//   #3  a failed data load set a loadError flag (was silently swallowed).
//   #20 the empty state + dashboard render are guarded so an error/loading state
//       never renders as an empty lab.
//   #14 the CFO leverage report (built server-side from the SAVED forecast) is
//       blocked when the on-screen form has unsaved edits, so the PDF cannot
//       contradict what the director sees.
//   #18 handleDelete + handleExport surface !res.ok instead of silently no-op'ing.
//   #2  the fabricated live-"peer" comparison language is removed (there is no
//       peer aggregation; benchmarks are static published ranges).
//   #12 the ratio is described in the direction the code computes it: productive
//       hours per billable test (lower is better), not "tests per paid hour".
//
//   node scripts/verify-veritabench-page.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaBenchPage.tsx"), "utf8");
const spec = fs.readFileSync(path.join(ROOT, "tests/playwright/veritabench-page-hardening.spec.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// #3 error flag
ok("#3 loadData sets loadError on !res.ok and on catch",
  /if \(res\.ok\) setMonths\(await res\.json\(\)\);\s*\n\s*else setLoadError\(true\);[\s\S]*?catch \{ setLoadError\(true\); \}/.test(src));
ok("#3 loadData clears loadError on entry (retry works)", /async function loadData\(\) \{\s*\n\s*setLoadError\(false\);/.test(src));
ok("#3 a distinct error banner (role=alert) with Retry is rendered",
  /role="alert"[\s\S]*?Couldn't load productivity data[\s\S]*?onClick=\{retryLoad\}/.test(src));

// #20 load/empty guards
ok("#20 the dashboard has a loading guard", /tab === "dashboard" && loading &&/.test(src));
ok("#20 the data-tab empty state is gated behind a loadError branch",
  /: loadError \? \([\s\S]*?not an empty lab[\s\S]*?\) : months\.length === 0 \?/.test(src));

// #14 stale CFO report guard
ok("#14 forecastDirty is derived from a saved snapshot", /const forecastDirty = fcSig !== fcSavedSnap;/.test(src));
ok("#14 generateReport refuses to run while the forecast is dirty",
  /if \(forecastDirty\) \{[\s\S]*?Save the goal first[\s\S]*?return;\s*\n\s*\}/.test(src));
ok("#14 the saved snapshot is refreshed after a successful save", /toast\(\{ title: "Goal saved" \}\); setFcSavedSnap\(fcSig\);/.test(src));

// #18 mutation error handling
ok("#18 handleDelete surfaces a failed delete", /if \(res\.ok\) \{ toast\(\{ title: "Deleted" \}\); loadData\(\); \}\s*\n\s*else \{ const e = await res\.json[\s\S]*?Delete failed/.test(src));
ok("#18 handleExport surfaces a failed export", /\} else \{\s*\n\s*const e = await res\.json\(\)\.catch[\s\S]*?Export failed/.test(src));

// #2 no fabricated peer-comparison language
for (const phrase of ["peer labs", "Peer Benchmarking", "peer groups", "peer comparisons"]) {
  ok(`#2 the phrase "${phrase}" is gone`, !src.includes(phrase));
}
ok("#2 benchmarks are framed as published facility-type reference ranges",
  /published .*reference ranges|facility-type reference ranges|Facility-Type Benchmarks/.test(src));

// #12 metric direction matches the code (ratio = productive_hours / billable_tests)
ok("#12 the inverted label 'per paid hour' is gone", !/per paid hour/.test(src));
ok("#12 no 'tests per productive hour' framing remains", !/tests[ -]per[ -]productive/.test(src));
ok("#12 copy states 'productive hours per billable test'", /productive hours per billable test/i.test(src));

// gate3 browser evidence
ok("spec added and asserts the honest metric on the public landing", /productive hours per billable test/.test(spec) && /getByRole\("alert"\)/.test(spec));

console.log(fails === 0 ? "\n=== VERITABENCH PAGE: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
