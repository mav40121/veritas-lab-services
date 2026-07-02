// Verify the safeDecodeParam fix for the VeritaMap analyte double-decode crash.
// Sentry: "URIError: URI malformed" on PUT .../amr-values/:inst/IG%25 (and BASO%),
// caused by decodeURIComponent running on a param Express had already decoded to
// a bare "%". Reproduces the old crash and asserts the new helper is safe.
// Run: node scripts/verify-safe-decode-param.mjs

function safeDecodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

let pass = 0;
let fail = 0;
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`);
  }
}

// 1. Reproduce the bug: the old code path throws on a "%"-suffixed analyte that
//    Express has already decoded to a bare "%".
let oldThrew = false;
try {
  decodeURIComponent("IG%");
} catch {
  oldThrew = true;
}
check("repro: decodeURIComponent('IG%') throws (the old bug)", oldThrew);

// 2. The fix must NOT throw and must return the correct analyte name.
//    Inputs are the value AS IT REACHES THE HANDLER (post Express decode).
const cases = [
  ["IG%", "IG%"], // Sentry case B (immature granulocytes percent)
  ["BASO%", "BASO%"], // Sentry case C (basophils percent)
  ["NEUT%", "NEUT%"],
  ["LYMPH%", "LYMPH%"],
  ["MONO%", "MONO%"],
  ["EOS%", "EOS%"],
  ["Glucose", "Glucose"], // regression: plain name unchanged
  ["Total Protein", "Total Protein"], // regression: space name unchanged
  ["IG%25", "IG%"], // a genuinely single-encoded value still decodes correctly
];
for (const [input, want] of cases) {
  let threw = false;
  let got;
  try {
    got = safeDecodeParam(input);
  } catch {
    threw = true;
  }
  check(`safeDecodeParam(${JSON.stringify(input)}) does not throw`, !threw);
  check(`safeDecodeParam(${JSON.stringify(input)}) === ${JSON.stringify(want)}`, got === want, `got ${JSON.stringify(got)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
