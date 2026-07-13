// scripts/verify-veritabench-pi.mjs
//
// Receipt for the VeritaQA/PI page-hardening batch (2026-07-12):
//   #3  a failed load set a loadError flag; the first-time setup wizard is gated
//       on !loadError and a distinct error view/banner renders, so a load failure
//       is not mistaken for a brand-new account.
//   #19 switching department/year re-sets loading around the reload, so the prior
//       department's data is not shown under the new department's header.
//   #16 handleSaveAll counts per-entry failures and reports partial failure
//       accurately (was always "Saved"), keeping typed values on screen on failure.
//   #18 handleDeleteMetric surfaces !res.ok; handleAddFromLibrary counts what
//       actually landed instead of always claiming success.
//
//   node scripts/verify-veritabench-pi.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaBenchPIPage.tsx"), "utf8");
const spec = fs.readFileSync(path.join(ROOT, "tests/playwright/veritabench-pi-hardening.spec.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// #3 load error handling
ok("#3 loadDepartments sets loadError on !res.ok and on catch",
  /else \{ setLoadError\(true\); \}\s*\n\s*\} catch \{ setLoadError\(true\); \} finally \{ setLoading\(false\); \}/.test(src));
ok("#3 metrics/entries/dashboard loaders set loadError on failure",
  (src.match(/catch \{ setLoadError\(true\); \}/g) || []).length >= 4 &&
  /\} else \{ setLoadError\(true\); \}/.test(src));
ok("#3 the first-time setup wizard is gated on !loadError",
  /const isFirstTime = !loading && !loadError && departments\.length === 0;/.test(src));
ok("#3 a load-error view renders instead of the setup wizard when nothing loaded",
  /if \(loadError && !loading && departments\.length === 0\) \{[\s\S]*?role="alert"[\s\S]*?not a new or empty account/.test(src));
ok("#3 a partial-load error banner renders in the normal view", /Some PI data couldn't be loaded/.test(src));

// #19 pending / loading on dept-year switch
ok("#19 the department/year effect re-sets loading around the reload",
  /setLoading\(true\);\s*\n\s*setLoadError\(false\);\s*\n\s*Promise\.all\(\[loadMetrics\(\), loadEntries\(\), loadDashboard\(\)\]\)\.finally\(\(\) => setLoading\(false\)\);/.test(src));
ok("#19 retryAll re-runs the loads", /function retryAll\(\) \{[\s\S]*?Promise\.all\(\[loadMetrics\(\), loadEntries\(\), loadDashboard\(\)\]\)/.test(src));

// #16 save-all partial failure
ok("#16 handleSaveAll counts attempted and failed entries", /let attempted = 0, failed = 0;/.test(src) && /if \(!res\.ok\) failed\+\+;/.test(src));
ok("#16 handleSaveAll reports partial failure instead of always 'Saved'",
  /if \(failed === 0\) \{[\s\S]*?loadEntries\(\);[\s\S]*?\} else \{[\s\S]*?Saved \$\{attempted - failed\} of \$\{attempted\}/.test(src));
ok("#16 handleSaveAll keeps typed values on partial failure (no reload in the else branch)",
  /Saved \$\{attempted - failed\} of \$\{attempted\}[\s\S]*?remain on screen; press Save All to retry/.test(src));

// #18 mutation error handling
ok("#18 handleDeleteMetric surfaces a failed delete", /\} else \{ const e = await res\.json\(\)\.catch[\s\S]*?Delete failed/.test(src));
ok("#18 handleAddFromLibrary counts added vs failed", /let added = 0, failed = 0;/.test(src) && /if \(res\.ok\) added\+\+; else failed\+\+;/.test(src));
ok("#18 handleAddFromLibrary reports partial failure", /Added \$\{added\} of \$\{added \+ failed\}/.test(src));

// gate3 browser evidence
ok("spec added and mocks a 500 to assert the error state (not the setup wizard)",
  /pi\/departments/.test(spec) && /getByRole\("alert"\)/.test(spec) && /500/.test(spec));

console.log(fails === 0 ? "\n=== VERITABENCH PI: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
