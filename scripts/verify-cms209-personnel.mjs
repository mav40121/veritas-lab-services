// scripts/verify-cms209-personnel.mjs
//
// Receipt for the CMS-209 personnel + medical-director fix (2026-10-03):
//   1. Testing Personnel (TP) prints ONLY when the TP position is explicitly
//      assigned. performs_testing is a roster attribute, never a CLIA position,
//      so it no longer auto-marks people as TP or puts position-less staff on
//      the form.
//   2. The designated medical director ALWAYS carries the LD designation: matched
//      onto a roster employee by name, or synthesized as an LD-only row if they
//      are not on the VeritaStaff roster.
//
// Run: npx tsx scripts/verify-cms209-personnel.mjs
import { cms209Model } from "../server/pdfReport.ts";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fail++; console.log(`  FAIL  ${n}${d ? " -- " + d : ""}`); } };
const emp = (last, first, pt, roles) => ({ last_name: last, first_name: first, middle_initial: null, highest_complexity: "H", performs_testing: pt, qualifications_text: null, roles });

// Case A — Michael's lab 3 shape: MD "David McCormick" not on roster; three
// performs_testing techs with NO assigned role; one real TP holder.
const A = cms209Model({
  medicalDirectorName: "David McCormick",
  employees: [
    emp("Chen", "Robert", 1, []),
    emp("Martinez", "Jennifer", 1, []),
    emp("Williams", "Sarah", 1, []),
    emp("Nguyen", "David", 0, []),
    emp("Veri", "Michael", 1, [{ role: "TP", specialty_number: null }, { role: "GS", specialty_number: null }]),
  ],
});
const rowsA = A.blocks.flat();
ok("A: director name = David McCormick", A.directorName === "David McCormick", A.directorName);
ok("A: first row is the MD, LD checked", A.blocks[0]?.[0]?.name === "David McCormick" && A.blocks[0][0].ld === true);
ok("A: un-designated testers excluded (Chen/Martinez/Williams/Nguyen)", !rowsA.some(r => /Chen|Martinez|Williams|Nguyen/.test(r.name)));
ok("A: exactly one TP, and it is the explicit holder", rowsA.filter(r => r.tp).length === 1 && rowsA.find(r => r.tp)?.name === "Veri, Michael");

// Case B — MD matches a roster employee by name: that employee gets LD, no synthetic row.
const B = cms209Model({
  medicalDirectorName: "Michael Veri",
  employees: [emp("Veri", "Michael", 1, [{ role: "GS", specialty_number: null }])],
});
ok("B: director resolves to matched roster employee", B.directorName === "Veri, Michael", B.directorName);
ok("B: matched employee carries LD", B.blocks.flat().some(r => r.name === "Veri, Michael" && r.ld));
ok("B: exactly one LD (no duplicate synthetic row)", B.blocks.flat().filter(r => r.ld).length === 1);

// Case C — an explicit roster LD wins; MD designation does not duplicate.
const C = cms209Model({
  medicalDirectorName: "David McCormick",
  employees: [emp("Smith", "Jane", 0, [{ role: "LD", specialty_number: null }]), emp("Veri", "Michael", 1, [{ role: "TP", specialty_number: null }])],
});
ok("C: director from roster LD (Smith, Jane)", C.directorName === "Smith, Jane", C.directorName);
ok("C: no synthetic McCormick row", !C.blocks.flat().some(r => r.name === "David McCormick"));
ok("C: exactly one LD", C.blocks.flat().filter(r => r.ld).length === 1);

// Case D — explicit TP with performs_testing=0 is still included (fixes latent drop).
const D = cms209Model({
  medicalDirectorName: "",
  employees: [emp("Doe", "Ann", 0, [{ role: "TP", specialty_number: null }])],
});
ok("D: explicit TP with performs_testing=0 is included as TP", D.blocks.flat().some(r => r.name === "Doe, Ann" && r.tp));

// Case E — no MD designation, no roster LD: director blank, no synthetic row.
const E = cms209Model({ employees: [emp("Roe", "Ray", 1, [{ role: "TP", specialty_number: null }])] });
ok("E: no MD designation -> director blank, no synthetic LD row", E.directorName === "" && !E.blocks.flat().some(r => r.ld));

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
