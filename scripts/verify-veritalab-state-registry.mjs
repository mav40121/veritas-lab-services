// scripts/verify-veritalab-state-registry.mjs
//
// Receipt for the VeritaLab state-registry regulatory corrections (audit #11 +
// #12, 2026-07-11), each verified against authoritative sources:
//
//   #11 Florida: SB 622 repealed Fla. Stat. Ch. 483 Part I effective 2018-07-01,
//   so FL no longer licenses the FACILITY (defers to CLIA). FL still licenses
//   PERSONNEL under Fla. Stat. Ch. 483 Part III (FL Board of Clinical Laboratory
//   Personnel). The row flipped 'yes' -> 'no' with the facility fields nulled and
//   a personnel note.
//
//   #12 Personnel-license states: per the ASCLS personnel-licensure list, the
//   CLIA-only 'no' rows for GA, HI, LA, MT, ND, NV, TN, WV now carry a note that
//   the state separately licenses laboratory PERSONNEL.
//
//   node scripts/verify-veritalab-state-registry.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "server/stateRegistryData.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// Isolate the FL row (from state_code 'FL' to the next state_code).
const flMatch = src.match(/state_code: 'FL',[\s\S]*?last_verified: [^\n]+/);
const fl = flMatch ? flMatch[0] : "";

// #11 Florida
ok("#11 FL row is now licensure_required: 'no' (facility repealed)", /licensure_required: 'no',/.test(fl));
ok("#11 FL notes cite the 2018 SB 622 facility repeal", /repealed clinical laboratory FACILITY licensure effective July 1, 2018/.test(fl) && /SB 622 repealed Fla\. Stat\. Ch\. 483 Part I/.test(fl));
ok("#11 FL notes preserve the PERSONNEL licensure under Part III", /PERSONNEL[\s\S]*?Fla\. Stat\. Ch\. 483 Part III/.test(fl));
ok("#11 FL facility fields nulled (no stale AHCA application/fee)", /authority_name: null,/.test(fl) && /application_form_name: null,/.test(fl) && /fee_description: null,/.test(fl));
ok("#11 FL source_citation updated to SB 622 + Part III", /SB 622 \(2018\) repealed Fla\. Stat\. Ch\. 483 Part I/.test(fl));
ok("#11 FL last_verified stamped 2026-07-11 (not the stale TODAY constant)", /last_verified: VERIFIED_2026_07_11/.test(fl));

// #12 personnel-license states
ok("#12 PERSONNEL_LICENSE_STATES = exactly the 8 flagged states",
  /const PERSONNEL_LICENSE_STATES = new Set<string>\(\['GA', 'HI', 'LA', 'MT', 'ND', 'NV', 'TN', 'WV'\]\);/.test(src));
ok("#12 PERSONNEL_LICENSE_NOTE states the separate personnel-license requirement",
  /separately licenses clinical laboratory PERSONNEL, a distinct requirement from facility licensure/.test(src));
ok("#12 bulk 'no' rows append the personnel note for the flagged states",
  /notes: PERSONNEL_LICENSE_STATES\.has\(code\) \? CLIA_ONLY_NOTE \+ PERSONNEL_LICENSE_NOTE : CLIA_ONLY_NOTE,/.test(src));
ok("#12 flagged states get the 2026-07-11 verify date",
  /last_verified: PERSONNEL_LICENSE_STATES\.has\(code\) \? VERIFIED_2026_07_11 : TODAY,/.test(src));

// hygiene: no em-dash in the new note constants / FL row
ok("no em-dash in the FL row or personnel note",
  !/—/.test(fl) && !/separately licenses clinical laboratory PERSONNEL[^']*—/.test(src));

console.log(fails === 0 ? "\n=== STATE REGISTRY: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
