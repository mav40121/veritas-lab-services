// Receipt for LHF-3: per-analyte presence flags for reference range, critical
// value, and AMR on the whole-lab menu. Mirrors the pure derivation in the
// buildLabwideData SQL: a flag is present when a low OR high bound is non-null.
const key = (v) => `${v.map_id}:${String(v.analyte || "").toLowerCase()}`;
function derive(analyteValues, amrValues) {
  const ref = new Set(), crit = new Set(), amr = new Set();
  for (const v of analyteValues) {
    const k = key(v);
    if (v.ref_range_low != null || v.ref_range_high != null) ref.add(k);
    if (v.critical_low != null || v.critical_high != null) crit.add(k);
  }
  for (const v of amrValues) if (v.amr_low != null || v.amr_high != null) amr.add(key(v));
  return { ref, crit, amr };
}
const analytes = [
  { map_id: 1, analyte: "Glucose" },   // full
  { map_id: 1, analyte: "Sodium" },    // ref only
  { map_id: 1, analyte: "Lead" },      // critical only
  { map_id: 1, analyte: "TSH" },       // nothing
];
const analyteValues = [
  { map_id: 1, analyte: "Glucose", ref_range_low: 70, ref_range_high: 99, critical_low: 40, critical_high: 500 },
  { map_id: 1, analyte: "Sodium", ref_range_low: 135, ref_range_high: 145, critical_low: null, critical_high: null },
  { map_id: 1, analyte: "Lead", ref_range_low: null, ref_range_high: null, critical_low: null, critical_high: 20 },
];
const amrValues = [{ map_id: 1, analyte: "Glucose", amr_low: 5, amr_high: 700 }];
const { ref, crit, amr } = derive(analyteValues, amrValues);
const missingRef = analytes.filter((a) => !ref.has(key(a))).length;
const missingCrit = analytes.filter((a) => !crit.has(key(a))).length;
const missingAmr = analytes.filter((a) => !amr.has(key(a))).length;

let pass = 0, fail = 0;
const check = (n, got, want) => { const ok = got === want; console.log(`${ok?"PASS":"FAIL"}  ${n}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`); ok?pass++:fail++; };
check("Glucose has ref range", ref.has("1:glucose"), true);
check("Glucose has critical", crit.has("1:glucose"), true);
check("Glucose has AMR", amr.has("1:glucose"), true);
check("Sodium has ref range", ref.has("1:sodium"), true);
check("Sodium missing critical", crit.has("1:sodium"), false);
check("Lead missing ref range (both null)", ref.has("1:lead"), false);
check("Lead has critical (high only)", crit.has("1:lead"), true);
check("TSH missing everything", ref.has("1:tsh") || crit.has("1:tsh") || amr.has("1:tsh"), false);
check("missing reference range count", missingRef, 2);   // Lead, TSH
check("missing critical count", missingCrit, 2);          // Sodium, TSH
check("missing AMR count", missingAmr, 3);                // Sodium, Lead, TSH
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
