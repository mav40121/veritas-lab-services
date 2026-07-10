// scripts/verify-veritamap-save-error-handling.mjs
//
// Receipt for the VeritaMap silent-save fix (scorecard HIGH, 2026-07-10). The
// lab critical-value and per-instrument AMR save handlers did a bare
// `await fetch(...)` with no res.ok check, then updated local state
// unconditionally, so an auth-expiry / 500 / validation reject left the UI
// showing the value as "Saved" while the server rejected it, on the exact
// critical-value entry path VeritaMap is meant to protect. Both handlers now
// throw on !res.ok (with a destructive toast) and update state only on success;
// the manual Save button surfaces the existing error state on catch.
//
//   node scripts/verify-veritamap-save-error-handling.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaMapMapPage.tsx"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// Extract each handler body (from its declaration to the closing "}, [deps]);").
const grab = (name) => {
  const m = src.match(new RegExp(`const ${name} = useCallback\\(async[\\s\\S]*?\\}, \\[[^\\]]*\\]\\);`));
  return m ? m[0] : "";
};
const analyte = grab("handleSaveAnalyteValues");
const amr = grab("handleSaveAmrValues");

for (const [label, body, setter, toastTitle] of [
  ["analyte-values (critical values / ref range / units)", analyte, "setAnalyteValuesMap", "Critical values not saved"],
  ["amr-values (per instrument)", amr, "setAmrValuesMap", "AMR not saved"],
]) {
  ok(`${label}: handler found`, body.length > 0);
  ok(`${label}: guards on !res.ok`, /if \(!res\.ok\)/.test(body));
  ok(`${label}: throws on failure`, /throw new Error\(/.test(body));
  ok(`${label}: shows a destructive toast on failure`,
    new RegExp(`toast\\(\\{[\\s\\S]*?title: "${toastTitle}"[\\s\\S]*?variant: "destructive"`).test(body));
  // The state update must come AFTER the res.ok guard (success path only).
  const okIdx = body.indexOf("if (!res.ok)");
  const setIdx = body.indexOf(setter);
  ok(`${label}: state update (${setter}) is after the guard, not before`, okIdx > -1 && setIdx > okIdx);
  ok(`${label}: no bare pre-guard fetch-then-setState`,
    !new RegExp(`await fetch\\([\\s\\S]*?\\}\\);\\s*${setter}`).test(body));
}

// Manual "Save values" button surfaces the error state instead of swallowing it.
ok("manual Save button catches and sets the error autosave status",
  /\} catch \{\s*setAutosaveStatus\("error"\);\s*\} finally \{\s*setSaving\(false\);/.test(src));

// Bug-class sweep: no OTHER mutation writes analyte/amr state without a res.ok guard.
const badPattern = /await fetch\([^)]*\)[^;]*;\s*(setAnalyteValuesMap|setAmrValuesMap)\(/g;
ok("no remaining bare-fetch-then-setState anywhere in the file", !badPattern.test(src));

console.log(fails === 0 ? "\n=== VERITAMAP SAVE ERROR HANDLING: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
