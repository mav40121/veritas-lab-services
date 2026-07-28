#!/usr/bin/env node
/**
 * verify-instrument-picker.js
 *
 * Receipt for the VeritaMap instrument-picker cleanup (VeritaMapBuildPage):
 *   - Vendor normalization in fdaInstrumentData.json (no bare "Siemens" split).
 *   - buildCascade() splits compound "A / B" categories so an instrument is
 *     discoverable under EACH real department (not a phantom compound dept).
 *   - searchInstruments() finds a model across the whole catalog by
 *     name/vendor/category, which is what lets a user type "Atellica" and pick
 *     the exact entry instead of falling to Other/Not Listed with 0 tests.
 *
 * Re-implements the pure client logic; keep in lockstep with VeritaMapBuildPage.tsx.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = JSON.parse(readFileSync(join(__dirname, "../client/src/lib/fdaInstrumentData.json"), "utf8"));

// --- pure logic mirrored from the component ---
function buildCascade(data) {
  const c = {};
  for (const [name, info] of Object.entries(data)) {
    const vendor = info.vendor || "Unknown";
    const depts = String(info.category).split("/").map((d) => d.trim()).filter(Boolean);
    for (const dept of depts) {
      if (!c[dept]) c[dept] = {};
      if (!c[dept][vendor]) c[dept][vendor] = [];
      if (!c[dept][vendor].includes(name)) c[dept][vendor].push(name);
    }
  }
  return c;
}
function searchInstruments(data, query) {
  const q = String(query).trim().toLowerCase();
  if (q.length < 2) return [];
  const out = [];
  for (const [name, info] of Object.entries(data)) {
    if (
      name.toLowerCase().includes(q) ||
      String(info.vendor || "").toLowerCase().includes(q) ||
      String(info.category || "").toLowerCase().includes(q)
    ) out.push(name);
  }
  return out.sort().slice(0, 50);
}

let pass = 0, fail = 0;
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); cond ? pass++ : fail++; };

// --- Vendor normalization ---
const vendors = Object.values(DATA).map((x) => x.vendor);
check("no bare 'Siemens' vendor remains", !vendors.includes("Siemens"));
check("'Siemens Healthineers' is the single Siemens bucket", vendors.filter((v) => v === "Siemens Healthineers").length >= 40);

// --- Atellica entries intact (Lisa's Milford map depends on these keys) ---
check("Siemens Atellica CH 930 present with 106 tests", DATA["Siemens Atellica CH 930"]?.testCount === 106);
check("Siemens Atellica CI 1900 present with 123 tests", DATA["Siemens Atellica CI 1900"]?.testCount === 123);

// --- Cascade compound-category split ---
const cascade = buildCascade(DATA);
check("no department key contains '/' (compound categories split)", Object.keys(cascade).every((d) => !d.includes("/")));
check(
  "Atellica CI Analyzer (Chemistry / Immunoassay) reachable under BOTH departments",
  (cascade["Chemistry"]?.["Siemens Healthineers"] || []).includes("Siemens Atellica CI Analyzer") &&
  (cascade["Immunoassay"]?.["Siemens Healthineers"] || []).includes("Siemens Atellica CI Analyzer")
);
check(
  "Atellica CH 930 reachable via Chemistry > Siemens Healthineers",
  (cascade["Chemistry"]?.["Siemens Healthineers"] || []).includes("Siemens Atellica CH 930")
);

// --- Global search ---
const atell = searchInstruments(DATA, "atellica");
check("search 'atellica' returns >= 7 Atellica models", atell.length >= 7);
check("search 'atellica' includes the CH 930", atell.includes("Siemens Atellica CH 930"));
check("search 'atellica' returns distinct keys (no dup rows)", new Set(atell).size === atell.length);
check("search by vendor 'siemens' finds Atellica CH 930", searchInstruments(DATA, "siemens").includes("Siemens Atellica CH 930"));
check("search shorter than 2 chars returns nothing", searchInstruments(DATA, "a").length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
