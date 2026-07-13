// scripts/verify-veritabench-staffing.mjs
//
// Receipt for the VeritaShift/Staffing page-hardening batch (2026-07-12):
//   #3/#20 loadStudies + loadGrid set a loadError flag; the list view shows a
//          loading state and a distinct error card with Retry instead of the
//          "No staffing studies yet" empty state on a failed load.
//   #17    loadStudyData sets a detailError flag and the study detail view shows
//          a load-error banner instead of rendering as a study with no data.
//   #4     the by-hour grid autosave surfaces a failed POST and does NOT reload
//          stale server data over the unsaved entries (was silent data loss).
//   #15    a "Gap identified" determination now requires its documented plan
//          (the note the placeholder already labeled "Required").
//   #18    handleCreate / handleDelete / handleExport surface !res.ok.
//
//   node scripts/verify-veritabench-staffing.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaBenchStaffingPage.tsx"), "utf8");
const spec = fs.readFileSync(path.join(ROOT, "tests/playwright/veritabench-staffing-hardening.spec.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// #3/#20 list load
ok("#3 loadStudies sets loadError on !res.ok and on catch",
  /if \(res\.ok\) setStudies\(await res\.json\(\)\);\s*\n\s*else setLoadError\(true\);\s*\n\s*\} catch \{ setLoadError\(true\); \}/.test(src));
ok("#3 loadGrid sets loadError on failure", /if \(!res\.ok\) \{ setLoadError\(true\); return; \}/.test(src) && /\} catch \{ setLoadError\(true\); \}/.test(src));
ok("#20 the list view has a loading early return", /if \(loading\) \{\s*\n\s*return \([\s\S]*?Loading\.\.\./.test(src));
ok("#20 the list view has a loadError early return with role=alert + Retry",
  /if \(loadError\) \{[\s\S]*?role="alert"[\s\S]*?Couldn't load staffing studies[\s\S]*?onClick=\{retryList\}/.test(src));
ok("#3 retryList clears the error and reloads", /function retryList\(\) \{\s*\n\s*setLoadError\(false\);[\s\S]*?loadStudies\(\);\s*\n\s*loadGrid\(\);/.test(src));

// #17 detail load
ok("#17 loadStudyData sets detailError on !res.ok and on catch",
  /setDetailError\(false\);[\s\S]*?else \{ setDetailError\(true\); \}\s*\n\s*\} catch \{ setDetailError\(true\); \}/.test(src));
ok("#17 the study detail view shows a load-error banner",
  /detailError && \([\s\S]*?role="alert"[\s\S]*?Couldn't load this study's hourly data/.test(src));

// #4 silent autosave
ok("#4 handleSaveData surfaces a failed autosave and returns before reload",
  /if \(!res\.ok\) \{[\s\S]*?Autosave failed[\s\S]*?return;\s*\n\s*\}/.test(src));
ok("#4 handleSaveData only reloads after a confirmed successful save",
  /Only refresh from the server after a confirmed successful save\.\s*\n\s*loadStudyData\(selectedStudy\.id\);/.test(src));

// #15 gap plan required
ok("#15 a gap determination requires a documented plan (non-empty note)",
  /if \(!clear && determination === "gap_identified" && !note\.trim\(\)\) \{[\s\S]*?Plan required[\s\S]*?return;\s*\n\s*\}/.test(src));

// #18 mutation error handling
ok("#18 handleCreate surfaces a failed create", /if \(res\.ok\) \{ toast\(\{ title: "Study created" \}\); loadStudies\(\); \}\s*\n\s*else \{ const e = await res\.json[\s\S]*?Create failed/.test(src));
ok("#18 handleDelete surfaces a failed delete", /\} else \{ const e = await res\.json\(\)\.catch[\s\S]*?Delete failed/.test(src));
ok("#18 handleExport surfaces a failed export", /\} else \{\s*\n\s*const e = await res\.json\(\)\.catch[\s\S]*?Export failed/.test(src));

// #6 (parked) — the CFR citation must be left as-is for Michael's ruling
ok("#6 parked: 493.1445(e)(5) citation is left unchanged", src.includes("493.1445(e)(5)"));

// gate3 browser evidence
ok("spec added and mocks a 500 to assert the error state",
  /staffing-studies/.test(spec) && /getByRole\("alert"\)/.test(spec) && /500/.test(spec));

console.log(fails === 0 ? "\n=== VERITABENCH STAFFING: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
