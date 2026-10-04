// Receipt for the VeritaMap CFR-by-specialty map (server/veritamapData.ts CFR_MAP).
// The bug: the catalog stamps specialty names (Electrolytes, Cardiac, Blood Bank, ...)
// that were NOT keys in CFR_MAP, so each fell through to a §493.945 (Microbiology)
// default - e.g. Sodium and Troponin were cited under the Microbiology regulation on the
// surveyor-facing export. CLAUDE.md §5 mandates the default be §493.931. This asserts the
// catalog specialties now resolve to the correct CLIA Part 493 Subpart I section.
// Run: node_modules/.bin/tsx scripts/verify-cfr-specialty-map.ts
import { CFR_MAP } from "../server/veritamapData";

let pass = 0, fail = 0;
function eq(specialty: string, want: string) {
  const got = CFR_MAP[specialty];
  if (got === want) { pass++; console.log(`  PASS  ${specialty} -> ${want}`); }
  else { fail++; console.log(`  FAIL  ${specialty}: got ${got ?? "(missing -> default)"} want ${want}`); }
}

console.log("--- catalog specialties that were previously missing (the bug) ---");
eq("Electrolytes", "§493.931");      // Na/K/Cl/CO2 = routine chemistry, not Micro
eq("Cardiac", "§493.931");           // Troponin/BNP/CK-MB = chemistry
eq("Point of Care", "§493.931");
eq("Chemistry", "§493.931");
eq("Immunology", "§493.927");        // general immunology
eq("Syphilis Serology", "§493.927");
eq("Blood Bank", "§493.959");        // immunohematology
eq("Hemostasis", "§493.941");        // coagulation
eq("Bacteriology", "§493.945");      // microbiology subspecialty
eq("Virology", "§493.945");

console.log("--- existing keys still correct ---");
eq("General Chemistry", "§493.931");
eq("Routine Chemistry", "§493.931");
eq("Hematology", "§493.941");
eq("Coagulation", "§493.941");
eq("General Immunology", "§493.927"); // NOT used for Hematology
eq("Immunohematology", "§493.959");
eq("Microbiology", "§493.945");
eq("Urinalysis", "§493.931");
eq("Blood Gas", "§493.931");

console.log(`\nTOTAL: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
