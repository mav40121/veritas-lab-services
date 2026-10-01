// scripts/verify-pt-vendor-catalog.mjs
//
// Gate-3 receipt for the VeritaPT vendor-catalog loader validator
// (server/ptVendorCatalog.ts validateVendorPrograms). Mirrors the pure logic.
// If you change it there, change this mirror too.
//
// Run: node scripts/verify-pt-vendor-catalog.mjs

const PT_VENDORS = ["CAP", "API", "WSLH", "Other"];
const PT_CATEGORIES = [
  "General Chemistry", "Special Chemistry", "Endocrinology", "Toxicology / TDM",
  "Hematology", "Coagulation", "Blood Bank / Immunohematology", "Microbiology",
  "Immunology / Serology", "Urinalysis",
];

function validateVendorPrograms(programs, opts = {}) {
  const vendors = opts.vendors ?? PT_VENDORS;
  const categories = opts.categories ?? PT_CATEGORIES;
  const items = []; const errors = [];
  if (!Array.isArray(programs) || programs.length === 0) { errors.push("programs[] (at least one) is required"); return { items, errors }; }
  const seen = new Set();
  programs.forEach((p, i) => {
    const vendor = String(p?.vendor ?? "").trim();
    const programName = String(p?.programName ?? "").trim();
    const ptCategory = String(p?.ptCategory ?? "").trim();
    if (!vendors.includes(vendor)) { errors.push(`programs[${i}].vendor`); return; }
    if (!programName) { errors.push(`programs[${i}].programName`); return; }
    if (!categories.includes(ptCategory)) { errors.push(`programs[${i}].ptCategory`); return; }
    const key = `${vendor}||${programName.toLowerCase()}`;
    if (seen.has(key)) { errors.push(`programs[${i}] duplicate`); return; }
    seen.add(key);
    const analytes = Array.isArray(p?.analytes) ? Array.from(new Set(p.analytes.map((a) => String(a).trim()).filter(Boolean))) : [];
    items.push({ vendor, programCode: p?.programCode != null && String(p.programCode).trim() ? String(p.programCode).trim() : null, programName, ptCategory, analytes, source: p?.source != null ? String(p.source) : null });
  });
  return { items, errors };
}

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; console.log(`  PASS  ${name} (= ${g})`); } else { fail++; console.log(`  FAIL  ${name}: got ${g}, want ${w}`); } };

// empty / shape
eq("empty -> error", validateVendorPrograms([]).errors.length > 0, true);
eq("unknown vendor rejected", validateVendorPrograms([{ vendor: "Roche", programName: "X", ptCategory: "Hematology" }]).errors.length, 1);
eq("missing programName rejected", validateVendorPrograms([{ vendor: "CAP", programName: "", ptCategory: "Hematology" }]).errors.length, 1);
eq("bad category rejected", validateVendorPrograms([{ vendor: "CAP", programName: "X", ptCategory: "Virology" }]).errors.length, 1);

// a clean row
const ok = validateVendorPrograms([{ vendor: "API", programCode: "100", programName: "Chemistry", ptCategory: "General Chemistry", analytes: ["Sodium", "Potassium", "Sodium"], source: "apipt.org 2026" }]);
eq("clean row: no errors", ok.errors.length, 0);
eq("clean row: normalized", ok.items[0], { vendor: "API", programCode: "100", programName: "Chemistry", ptCategory: "General Chemistry", analytes: ["Sodium", "Potassium"], source: "apipt.org 2026" });
eq("analytes deduped + trimmed", ok.items[0].analytes, ["Sodium", "Potassium"]);

// programCode optional -> null; analytes optional -> []
const minimal = validateVendorPrograms([{ vendor: "CAP", programName: "C-A Chemistry", ptCategory: "General Chemistry" }]);
eq("no programCode -> null", minimal.items[0].programCode, null);
eq("no analytes -> []", minimal.items[0].analytes, []);

// duplicate vendor+programName within payload rejected (case-insensitive)
const dup = validateVendorPrograms([
  { vendor: "CAP", programName: "Chemistry", ptCategory: "General Chemistry" },
  { vendor: "CAP", programName: "chemistry", ptCategory: "General Chemistry" },
]);
eq("dup same vendor+name -> 1 error, 1 item", [dup.items.length, dup.errors.length], [1, 1]);

// same name under DIFFERENT vendor is allowed
const twoVendors = validateVendorPrograms([
  { vendor: "CAP", programName: "Chemistry", ptCategory: "General Chemistry" },
  { vendor: "API", programName: "Chemistry", ptCategory: "General Chemistry" },
]);
eq("same name, different vendor -> both kept", twoVendors.items.length, 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
