// verify-veritamap-intelligence.mjs — pins the VeritaMap "Intelligence" panel
// computation (computeIntelligence in client/src/pages/VeritaMapMapPage.tsx) so
// the panel AGREES WITH THE GRID: correlations + cal verifications are OUTSTANDING
// worklists (empty as studies land), and Tests Fully Compliant is the real count
// (previously hardcoded 0). Waived tests are excluded; correlations need 2+
// instruments. Includes a source drift guard.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
let ok = true;
const assert = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + ": " + name); if (!cond) ok = false; };

// ── Drift guard: the fix must be present in source ───────────────────────────
const src = readFileSync(join(HERE, "..", "client", "src", "pages", "VeritaMapMapPage.tsx"), "utf8");
assert("source: correlations filtered to outstanding (method_comp not ok)",
  /instruments\.length >= 2 &&[\s\S]{0,80}getDateStatus\(t\.last_method_comp, 6\) !== "ok"/.test(src));
assert("source: cal ver outstanding (last_cal_ver not ok)",
  /calVerRequired = nonWaived\.filter\([\s\S]{0,80}getDateStatus\(t\.last_cal_ver, 6\) !== "ok"/.test(src));
assert("source: compliantTests no longer hardcoded to 0 in the panel path (uses localTests)",
  /localTests\.length > 0[\s\S]{0,60}computeIntelligence\(localTests\)/.test(src));

// ── Faithful re-implementation of getDateStatus + computeIntelligence ────────
function getDateStatus(dateStr, maxMonths, warningDays = 30) {
  if (!dateStr) return "missing";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "missing";
  const diffDays = (Date.now() - d.getTime()) / 86400000;
  const maxDays = maxMonths * 30.44 + 20;
  if (diffDays > maxDays) return "overdue";
  if (diffDays > maxDays - warningDays) return "due-soon";
  return "ok";
}
function computeIntelligence(tests) {
  const nonWaived = tests.filter((t) => t.complexity !== "WAIVED");
  const correlationsRequired = nonWaived
    .filter((t) => t.instruments && t.instruments.length >= 2 && getDateStatus(t.last_method_comp, 6) !== "ok")
    .map((t) => ({ analyte: t.analyte, instruments: t.instruments }));
  const calVerRequired = nonWaived.filter((t) => getDateStatus(t.last_cal_ver, 6) !== "ok").length;
  const compliantTests = nonWaived.filter((t) => getDateStatus(t.last_cal_ver, 6) === "ok" && getDateStatus(t.last_method_comp, 6) === "ok").length;
  return { correlationsRequired, calVerRequired, compliantTests };
}

const today = new Date().toISOString().slice(0, 10);
const OLD = "2020-01-01";
const two = [{ instrument_name: "A" }, { instrument_name: "B" }];
const one = [{ instrument_name: "A" }];

// Mixed fixture
const mixed = [
  { analyte: "Glucose",   complexity: "MODERATE", instruments: two, last_cal_ver: today, last_method_comp: today }, // compliant
  { analyte: "Potassium", complexity: "MODERATE", instruments: two, last_cal_ver: null,  last_method_comp: null },  // both outstanding
  { analyte: "Sodium",    complexity: "MODERATE", instruments: two, last_cal_ver: today, last_method_comp: null },  // method comp outstanding
  { analyte: "Calcium",   complexity: "WAIVED",   instruments: two, last_cal_ver: null,  last_method_comp: null },  // waived -> excluded
  { analyte: "Chloride",  complexity: "MODERATE", instruments: one, last_cal_ver: OLD,   last_method_comp: null },  // single instrument
];
const r = computeIntelligence(mixed);
const corrAnalytes = r.correlationsRequired.map((c) => c.analyte).sort();
assert("mixed: correlations outstanding = [Potassium, Sodium]", JSON.stringify(corrAnalytes) === JSON.stringify(["Potassium", "Sodium"]));
assert("mixed: single-instrument Chloride NOT in correlations", !corrAnalytes.includes("Chloride"));
assert("mixed: waived Calcium NOT in correlations", !corrAnalytes.includes("Calcium"));
assert("mixed: cal ver outstanding = 2 (Potassium null, Chloride old)", r.calVerRequired === 2);
assert("mixed: fully compliant = 1 (Glucose only)", r.compliantTests === 1);

// All done: every non-waived test has both dates current
const done = mixed.map((t) => t.complexity === "WAIVED" ? t : ({ ...t, last_cal_ver: today, last_method_comp: today, instruments: two }));
const r2 = computeIntelligence(done);
assert("all done: 0 correlations outstanding", r2.correlationsRequired.length === 0);
assert("all done: 0 cal verifications outstanding", r2.calVerRequired === 0);
assert("all done: fully compliant = 4 non-waived", r2.compliantTests === 4);

// The old bug: nothing done -> compliant must be 0 (not by hardcode, by computation)
const none = mixed.map((t) => ({ ...t, last_cal_ver: null, last_method_comp: null }));
assert("nothing done: compliant computed as 0", computeIntelligence(none).compliantTests === 0);

console.log(ok ? "\nALL PASS" : "\nFAILURES PRESENT");
process.exit(ok ? 0 : 1);
