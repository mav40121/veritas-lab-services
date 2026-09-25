// shared/ifu.ts
//
// IFU (Instructions For Use / manufacturer package insert) linkage for VeritaMap.
// Two layers:
//   1. A lab can store the exact assay IFU URL per analyte-on-instrument
//      (veritamap_instrument_tests.ifu_url). That is authoritative.
//   2. When no exact URL is stored, the UI offers a "Find IFU" link: a
//      manufacturer + analyte scoped web search. We deliberately do NOT hardcode
//      manufacturer eIFU-portal URLs: those change and most sit behind a login,
//      so a hardcoded link would rot or dead-end. A scoped search always works
//      and lands the current manufacturer document at the top. No fabricated URLs.
//
// manufacturerFromInstrument derives the vendor from the instrument name (which
// usually contains the maker or a well-known model line). Used only to label and
// scope the search; it never invents a document.

export const KNOWN_MANUFACTURERS = [
  "Siemens", "Roche", "Ortho", "QuidelOrtho", "Sysmex", "Stago", "Abbott",
  "Beckman Coulter", "Bio-Rad", "BD", "Werfen", "Nova Biomedical", "Radiometer",
  "Sebia", "Bio-Rad", "Diazyme",
] as const;

// Model / brand keyword -> manufacturer. Checked case-insensitively against the
// instrument name. Order matters only for readability; each key is distinctive.
const MODEL_TO_MFR: Record<string, string> = {
  // Siemens Healthineers
  "dimension": "Siemens", "atellica": "Siemens", "advia": "Siemens", "clinitek": "Siemens",
  "bn ": "Siemens", "ca-": "Siemens", "immulite": "Siemens", "epoc": "Siemens", "stratus": "Siemens",
  // Roche
  "cobas": "Roche", "elecsys": "Roche", "accu-chek": "Roche",
  // Ortho / QuidelOrtho
  "vitros": "Ortho", "ortho": "Ortho",
  // Sysmex
  "sysmex": "Sysmex", "xn-": "Sysmex", "xn ": "Sysmex", "xp-": "Sysmex", "cs-": "Sysmex", "cn-": "Sysmex",
  // Stago
  "stago": "Stago", "sta compact": "Stago", "sta-": "Stago",
  // Abbott
  "abbott": "Abbott", "alinity": "Abbott", "architect": "Abbott", "id now": "Abbott", "cell-dyn": "Abbott",
  // Beckman Coulter
  "beckman": "Beckman Coulter", "dxh": "Beckman Coulter", "dxi": "Beckman Coulter", "dxc": "Beckman Coulter", "au480": "Beckman Coulter", "au680": "Beckman Coulter", "access": "Beckman Coulter",
  // Bio-Rad
  "bio-rad": "Bio-Rad", "biorad": "Bio-Rad", "d-100": "Bio-Rad", "variant": "Bio-Rad",
  // BD
  "bd max": "BD", "bactec": "BD", "phoenix": "BD", "facs": "BD",
  // Werfen / Instrumentation Laboratory
  "acl ": "Werfen", "acl-": "Werfen", "gem ": "Werfen", "hemosil": "Werfen",
  // Nova / Radiometer / Sebia
  "nova ": "Nova Biomedical", "stat profile": "Nova Biomedical",
  "radiometer": "Radiometer", "abl": "Radiometer",
  "sebia": "Sebia", "capillarys": "Sebia",
};

export function manufacturerFromInstrument(instrumentName: string | null | undefined): string | null {
  const n = String(instrumentName || "").toLowerCase();
  if (!n.trim()) return null;
  // A named manufacturer in the string wins.
  for (const m of KNOWN_MANUFACTURERS) {
    if (n.includes(m.toLowerCase())) return m;
  }
  // Otherwise match a model / brand keyword.
  for (const [kw, mfr] of Object.entries(MODEL_TO_MFR)) {
    if (n.includes(kw)) return mfr;
  }
  return null;
}

// Manufacturer + instrument + analyte scoped search for the IFU. Always resolves;
// never a fabricated deep link.
export function ifuSearchUrl(instrumentName: string | null | undefined, analyte: string | null | undefined): string {
  const mfr = manufacturerFromInstrument(instrumentName) || "";
  const terms = [mfr, String(instrumentName || ""), String(analyte || ""), "assay IFU package insert instructions for use"]
    .map((s) => s.trim()).filter(Boolean);
  return "https://www.google.com/search?q=" + encodeURIComponent(terms.join(" "));
}

// Basic URL guard for a lab-entered IFU link (http/https only).
export function isValidIfuUrl(url: string | null | undefined): boolean {
  const u = String(url || "").trim();
  if (!u) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
