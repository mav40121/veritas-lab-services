// scripts/verify-passthreshold-select-value.mjs
//
// Receipt for the 2026-08-27 "pass threshold does not save, blanks out" fix in
// VeritaCheck (semi-quantitative and qualitative assay modes). A Radix Select
// renders blank when its controlled `value` does not string-match one of its
// SelectItem values. The options are 2-decimal ("0.80","0.90","0.95","1.00")
// but the value was String(number), which strips trailing zeros ("0.8","0.9",
// "1"), so 80% / 90% / 100% never matched and the control blanked out (only 95%
// survived, because String(0.95) === "0.95"). Fix: bind value as
// number.toFixed(2) so it reproduces the padded option strings exactly.
//
// Run: node scripts/verify-passthreshold-select-value.mjs   (exits non-zero on fail)

const SEMI = ["0.80", "0.90", "0.95"];   // semiQuantPassThreshold options
const QUAL = ["0.90", "0.95", "1.00"];   // qualPassThreshold options

let fail = 0;
const chk = (label, got, want) => {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  got=${JSON.stringify(got)}`);
  if (!ok) fail++;
};

// The fix: toFixed(2) of each option's numeric value reproduces the option string.
for (const opt of [...new Set([...SEMI, ...QUAL])]) {
  chk(`toFixed(2) round-trips ${opt}`, parseFloat(opt).toFixed(2), opt);
}

// Document the old bug: String() dropped trailing zeros for the padded options,
// so these NEVER matched their SelectItem and blanked out.
chk("OLD String(0.80) failed to match '0.80'", String(0.80) === "0.80", false);
chk("OLD String(0.90) failed to match '0.90'", String(0.90) === "0.90", false);
chk("OLD String(1.00) failed to match '1.00'", String(1.0) === "1.00", false);
// 0.95 happened to survive under String(), which is why only 95% "worked".
chk("OLD String(0.95) matched '0.95' (why 95% worked)", String(0.95) === "0.95", true);

if (fail) { console.error(`\n${fail} FAIL(s)`); process.exit(1); }
console.log("\nAll pass-threshold select value checks passed.");
