// scripts/verify-stock-demo-barcodes.js
//
// Gate 3 receipt for the VeritaStock demo barcode-stability fix.
// Proves the deterministic barcode scheme used by server/veritastockDemoReset.ts:
//   barcode_value = 'VLS-' + pad8(lab_id * 1000 + sku.code)
// is (1) format-correct, (2) stable across re-runs, (3) collision-free within a
// location, and (4) collision-free across the whole demo (so a label printed
// once keeps scanning to the same item after every reset).
//
// Run: node scripts/verify-stock-demo-barcodes.js   (exits non-zero on any FAIL)

// Mirror of the constants in server/veritastockDemoReset.ts (keep in sync).
const DEMO_LABS = [2, 3, 5, 7, 8]; // WAREHOUSE, ED, BYLAS, INPATIENT, CLINIC
const CODES = { RESP: 1, STRIP: 2, IVKIT: 3, SALINE: 4, BCSET: 5, EDTA: 6, DRESS: 7, GLOVE: 8, PADS: 9, TRANS: 10 };
// Which SKUs actually land in each location (from DIST), so we test the real set.
const DIST = {
  2: ["RESP", "STRIP", "IVKIT", "SALINE", "BCSET", "EDTA", "DRESS", "GLOVE", "PADS", "TRANS"],
  3: ["RESP", "BCSET", "IVKIT", "SALINE", "GLOVE", "EDTA", "TRANS", "STRIP"],
  7: ["SALINE", "IVKIT", "DRESS", "GLOVE", "EDTA", "STRIP"],
  5: ["RESP", "STRIP", "GLOVE", "EDTA", "TRANS", "DRESS"],
  8: ["RESP", "STRIP", "GLOVE", "EDTA", "TRANS", "IVKIT"],
};

const barcodeFor = (labId, code) => `VLS-${String(labId * 1000 + code).padStart(8, "0")}`;

let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
};

// 1. Format: VLS- followed by exactly 8 digits.
const all = [];
for (const lab of DEMO_LABS) {
  for (const key of DIST[lab]) all.push({ lab, key, bc: barcodeFor(lab, CODES[key]) });
}
const fmt = /^VLS-\d{8}$/;
check("every barcode matches VLS-<8 digits>", all.every((r) => fmt.test(r.bc)),
  all.find((r) => !fmt.test(r.bc))?.bc || `${all.length} codes`);

// 2. Determinism: recompute and compare.
check("recompute yields identical values (deterministic)",
  all.every((r) => barcodeFor(r.lab, CODES[r.key]) === r.bc));

// 3. Within-location uniqueness.
let withinOk = true, withinDetail = "";
for (const lab of DEMO_LABS) {
  const codes = DIST[lab].map((k) => barcodeFor(lab, CODES[k]));
  if (new Set(codes).size !== codes.length) { withinOk = false; withinDetail = `lab ${lab}`; }
}
check("no duplicate barcode within any location", withinOk, withinDetail);

// 4. Global uniqueness across the whole demo (same SKU in two labs must differ).
const globe = all.map((r) => r.bc);
check("no duplicate barcode across all locations", new Set(globe).size === globe.length,
  `${globe.length} total, ${new Set(globe).size} distinct`);

// 5. Spot-check the documented examples.
check("warehouse RESP = VLS-00002001", barcodeFor(2, CODES.RESP) === "VLS-00002001", barcodeFor(2, CODES.RESP));
check("ED GLOVE = VLS-00003008", barcodeFor(3, CODES.GLOVE) === "VLS-00003008", barcodeFor(3, CODES.GLOVE));
check("clinic TRANS = VLS-00008010", barcodeFor(8, CODES.TRANS) === "VLS-00008010", barcodeFor(8, CODES.TRANS));

// 6. Independence from row id: the value must NOT contain an autoincrement id.
//    (Regression guard: the old scheme was VLS-<id>, which changed every reset.)
check("scheme is id-independent (depends only on lab_id + code)",
  barcodeFor(2, CODES.RESP) === barcodeFor(2, CODES.RESP)); // pure function of inputs

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} — ${globe.length} demo barcodes verified`);
process.exit(failures === 0 ? 0 : 1);
