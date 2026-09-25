// scripts/verify-ifu.mts
//
// Receipt for IFU linkage helpers (Build #4, 2026-09-25). Exercises
// shared/ifu.ts: manufacturer derivation from instrument names (incl. the labs'
// actual analyzers), the scoped IFU search URL, and the lab-URL guard.
//
// Run: npx tsx scripts/verify-ifu.mts   (exits non-zero on fail)

import { manufacturerFromInstrument, ifuSearchUrl, isValidIfuUrl } from "../shared/ifu";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

// manufacturer derivation on the labs' real instrument names
check("Siemens Dimension EXL -> Siemens", manufacturerFromInstrument("Siemens Dimension EXL") === "Siemens");
check("Dimension EXL 200 (no maker word) -> Siemens", manufacturerFromInstrument("Dimension EXL 200") === "Siemens");
check("Ortho VITROS 5600 -> Ortho", manufacturerFromInstrument("Ortho VITROS 5600") === "Ortho");
check("VITROS alone -> Ortho", manufacturerFromInstrument("VITROS 5600 5605211 B CLYDE") === "Ortho");
check("Sysmex XN-2000 -> Sysmex", manufacturerFromInstrument("Sysmex XN-2000") === "Sysmex");
check("Stago STA Compact Max -> Stago", manufacturerFromInstrument("Stago STA Compact Max") === "Stago");
check("Abbott ID NOW -> Abbott", manufacturerFromInstrument("Abbott ID NOW") === "Abbott");
check("cobas 6000 -> Roche", manufacturerFromInstrument("Roche cobas 6000") === "Roche");
check("Beckman DxH 900 -> Beckman Coulter", manufacturerFromInstrument("Beckman DxH 900") === "Beckman Coulter");
check("unknown instrument -> null", manufacturerFromInstrument("Acme Widget 3000") === null);
check("empty -> null", manufacturerFromInstrument("") === null);

// scoped search URL
const u = ifuSearchUrl("Siemens Dimension EXL", "Glucose");
check("search url is https google search", u.startsWith("https://www.google.com/search?q="));
check("search url includes manufacturer term", decodeURIComponent(u).includes("Siemens"));
check("search url includes analyte", decodeURIComponent(u).includes("Glucose"));
check("search url includes instrument", decodeURIComponent(u).includes("Dimension EXL"));
check("search url encodes spaces (no raw space)", !u.includes(" "));
const u2 = ifuSearchUrl("Acme Widget 3000", "Sodium"); // unknown mfr still resolves
check("unknown manufacturer still yields a usable search", u2.startsWith("https://www.google.com/search?q=") && decodeURIComponent(u2).includes("Sodium"));

// URL guard
check("valid https URL accepted", isValidIfuUrl("https://example.com/ifu.pdf") === true);
check("valid http URL accepted", isValidIfuUrl("http://example.com/ifu") === true);
check("empty rejected", isValidIfuUrl("") === false);
check("non-url rejected", isValidIfuUrl("not a url") === false);
check("javascript: scheme rejected", isValidIfuUrl("javascript:alert(1)") === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
