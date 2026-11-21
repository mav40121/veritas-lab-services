// One rule for "this band has a reference range a director can attest" (Heywood, 2026-11-21). A one-sided range is a
// complete verified range: "<200 mg/dL" is stored as a high of 200 with no low, ">60" as a low with no high. The attest
// route, the map page's Attest link and the Excel export's "Pending director attestation" cell each required BOTH ends,
// so Heywood's 13 one-sided Chemistry bands (cholesterol, LDL, ethanol, RF, two ALP bands) could never be attested:
// the page offered no link and the server answered "an empty range cannot be attested".
// scripts/verify-ref-range-entered.mts and tests/integration/veritamap-attest-one-sided.test.ts pin it.
const filled = (v: unknown): boolean => v !== null && v !== undefined && String(v).trim() !== "";

export function refRangeEntered(row: { ref_range_low?: unknown; ref_range_high?: unknown } | null | undefined): boolean {
  return !!row && (filled(row.ref_range_low) || filled(row.ref_range_high));
}

// How many of an analyte's bands hold a range, and how many of those are attested. The map page shows it under the band
// picker, because each band is attested on its own and the panel opens on the first band, so an attested band elsewhere
// read as "not saved" when the panel reopened.
export function bandAttestCounts(bands: Array<{ ref_range_low?: unknown; ref_range_high?: unknown; ref_locked?: unknown }>): { withRange: number; attested: number } {
  const withRange = bands.filter((b) => refRangeEntered(b));
  return { withRange: withRange.length, attested: withRange.filter((b) => !!b.ref_locked).length };
}
