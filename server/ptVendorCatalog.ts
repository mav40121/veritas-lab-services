// server/ptVendorCatalog.ts
//
// VeritaPT vendor program catalog (docs: enrollment modal Program Name dropdown).
// The catalog (pt_vendor_programs) holds, per vendor, the real programs offered
// and the analytes each program includes, so a lab picks a real vendor program
// instead of typing free text. Rows are loaded ONLY from vendor-sourced,
// operator-VERIFIED data via the admin loader; this module is the pure validator
// for that payload. No catalog data is defined here. Mirrored by
// scripts/verify-pt-vendor-catalog.mjs.

export const PT_VENDORS = ["CAP", "API", "WSLH", "Other"] as const;

// Canonical PT categories (disciplines). Must stay in sync with the client's
// PT_CATEGORIES in VeritaPTAppPage.tsx and the recommendation engine's
// CATEGORY_PROGRAMS keys.
export const PT_CATEGORIES = [
  "General Chemistry",
  "Special Chemistry",
  "Endocrinology",
  "Toxicology / TDM",
  "Hematology",
  "Coagulation",
  "Blood Bank / Immunohematology",
  "Microbiology",
  "Immunology / Serology",
  "Urinalysis",
] as const;

export interface VendorProgramInput {
  vendor?: string;
  programCode?: string | null;
  programName?: string;
  ptCategory?: string;
  analytes?: unknown;
  source?: string | null;
}

export interface NormalizedVendorProgram {
  vendor: string;
  programCode: string | null;
  programName: string;
  ptCategory: string;
  analytes: string[];
  source: string | null;
}

// Pure: validate + normalize a catalog payload. Each program needs a known
// vendor, a non-empty program name, and a recognized PT category; analytes is a
// string list (deduped, trimmed). Duplicate (vendor, programName) within the
// payload is rejected so the loader never fights its own UNIQUE constraint.
export function validateVendorPrograms(
  programs: VendorProgramInput[],
  opts: { vendors?: readonly string[]; categories?: readonly string[] } = {},
): { items: NormalizedVendorProgram[]; errors: string[] } {
  const vendors = opts.vendors ?? PT_VENDORS;
  const categories = opts.categories ?? PT_CATEGORIES;
  const items: NormalizedVendorProgram[] = [];
  const errors: string[] = [];
  if (!Array.isArray(programs) || programs.length === 0) {
    errors.push("programs[] (at least one) is required");
    return { items, errors };
  }
  const seen = new Set<string>();
  programs.forEach((p, i) => {
    const vendor = String(p?.vendor ?? "").trim();
    const programName = String(p?.programName ?? "").trim();
    const ptCategory = String(p?.ptCategory ?? "").trim();
    if (!vendors.includes(vendor)) { errors.push(`programs[${i}].vendor must be one of ${vendors.join(", ")}`); return; }
    if (!programName) { errors.push(`programs[${i}].programName is required`); return; }
    if (!categories.includes(ptCategory)) { errors.push(`programs[${i}].ptCategory "${ptCategory}" is not a recognized PT category`); return; }
    const key = `${vendor}||${programName.toLowerCase()}`;
    if (seen.has(key)) { errors.push(`programs[${i}] duplicate vendor+programName "${vendor} / ${programName}"`); return; }
    seen.add(key);
    const analytes = Array.isArray(p?.analytes)
      ? Array.from(new Set((p.analytes as unknown[]).map((a) => String(a).trim()).filter(Boolean)))
      : [];
    items.push({
      vendor,
      programCode: p?.programCode != null && String(p.programCode).trim() ? String(p.programCode).trim() : null,
      programName,
      ptCategory,
      analytes,
      source: p?.source != null ? String(p.source) : null,
    });
  });
  return { items, errors };
}
