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
  const q = String(query).trim();
  if (q.length < 2) return [];
  const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const words = q.split(/\s+/).map(squash).filter(Boolean);
  if (words.length === 0) return [];
  const out = [];
  for (const [name, info] of Object.entries(data)) {
    const fields = [name, info.vendor || "", info.category || "", ...(info.aliases || [])].map(squash);
    if (words.every((w) => fields.some((f) => f.includes(w)))) out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b)).slice(0, 50);
}

let pass = 0, fail = 0;
const check = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); cond ? pass++ : fail++; };

// --- Vendor normalization ---
const vendors = Object.values(DATA).map((x) => x.vendor);
check("no bare 'Siemens' vendor remains", !vendors.includes("Siemens"));
check("'Siemens Healthineers' is the single Siemens bucket", vendors.filter((v) => v === "Siemens Healthineers").length >= 40);

// --- Atellica entries intact (Lisa's Milford map depends on these keys). The FDA menu work (BUG-009) grew both menus
// after this check was written (106 -> 138, 123 -> 137), so it checks the floor and that testCount matches the menu. ---
for (const [k, floor] of [["Siemens Atellica CH 930", 106], ["Siemens Atellica CI 1900", 123]]) {
  const e = DATA[k];
  check(`${k} present with at least ${floor} tests and a matching testCount`, !!e && e.testCount >= floor && e.testCount === Object.keys(e.tests).length);
}

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

// --- REQ-101 (Lifepoint Georgetown, 2026-10-23): the names on the analyzer, typed any way, find the entry ---
for (const q of ["CA-600", "CA600", "ca 600", "Sysmex CA-660", "CA-620", "Sysmex CA-600 series"]) {
  check(`search '${q}' finds Siemens CA-600`, searchInstruments(DATA, q).includes("Siemens CA-600"));
}
for (const q of ["Sedimat-15", "Sedimat 15", "sedimat"]) {
  check(`search '${q}' finds Polymedco Sedimat 15 Plus`, searchInstruments(DATA, q).includes("Polymedco Sedimat 15 Plus"));
}
check("search 'Binax Legionella' finds the BinaxNOW Legionella card", searchInstruments(DATA, "Binax Legionella").includes("Abbott BinaxNOW Legionella Urinary Antigen Card"));
check("search 'Binax Strep pneumo' finds the BinaxNOW S. pneumoniae card", searchInstruments(DATA, "Binax Strep pneumo").includes("Abbott BinaxNOW Streptococcus pneumoniae Antigen Card"));
check("search 'Binax Legionella' does not return the Strep card", !searchInstruments(DATA, "Binax Legionella").includes("Abbott BinaxNOW Streptococcus pneumoniae Antigen Card"));
check("search 'sysmex' still lists the Sysmex XN-1000", searchInstruments(DATA, "sysmex").includes("Sysmex XN-1000"));
check("search 'blood gas' still finds Blood Gas instruments", searchInstruments(DATA, "blood gas").some((n) => DATA[n].category === "Blood Gas"));
check("search of punctuation only returns nothing", searchInstruments(DATA, "--").length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
