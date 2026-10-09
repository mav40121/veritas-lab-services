// Unit-of-measure wording for VeritaStock and inventory screens (2026-10-08).
//
// Every inventory screen used to pluralize a unit by appending a bare "s", so a
// lab whose items are counted in boxes saw "0 boxs", and "each" became "eachs"
// (Sampson Regional, Natalie Lamb's 64 chemistry items). One rule for every
// screen and the vendor order document:
//   - quantity 1 (or -1) keeps the singular; any other quantity, or no quantity
//     (a column label like "On Order (boxes)"), uses the plural
//   - "each", "ea", and abbreviations (mL, uL, g, mg, kg, L, oz, lb, cm, mm, IU,
//     U, mEq) never change
//   - a unit that already ends in a single "s" is taken as already plural
//     ("tests", "pcs") and left alone; "ss" gets "es" ("glass" -> "glasses")
//   - s / x / z / ch / sh endings get "es" (box -> boxes, pouch -> pouches)
//   - consonant + y gets "ies" (battery -> batteries); vowel + y gets "s"
//   - multi-word units pluralize the last word ("reagent pack" -> "reagent packs")
//   - an all-capitals unit gets a capital suffix ("BOX" -> "BOXES")
//   - a blank unit reads "unit" / "units"

const INVARIANT = new Set([
  "each", "ea", "ea.",
  "ml", "l", "ul", "µl", "μl", "dl", "g", "mg", "kg", "ug", "µg", "μg", "oz", "lb", "lbs",
  "cm", "mm", "m", "in", "ft", "iu", "u", "meq", "mmol", "mol",
]);

function pluralWord(word: string): string {
  const lower = word.toLowerCase();
  if (INVARIANT.has(lower)) return word;
  const upper = word.length > 1 && word === word.toUpperCase() && /[A-Z]/.test(word);
  const suffix = (s: string) => (upper ? s.toUpperCase() : s);
  if (/ss$/.test(lower)) return word + suffix("es");
  if (/s$/.test(lower)) return word; // already plural: "tests", "pcs"
  if (/(x|z|ch|sh)$/.test(lower)) return word + suffix("es");
  if (/[^aeiou]y$/.test(lower)) return word.slice(0, -1) + suffix("ies");
  return word + suffix("s");
}

/** "box" with a quantity: 1 -> "box", 0 / 2 / no quantity -> "boxes". */
export function unitLabel(unit: string | null | undefined, quantity?: number | null): string {
  const u = String(unit ?? "").trim();
  if (!u) return quantity !== undefined && quantity !== null && Math.abs(Number(quantity)) === 1 ? "unit" : "units";
  if (quantity !== undefined && quantity !== null && Math.abs(Number(quantity)) === 1) return u;
  const parts = u.split(/(\s+)/);
  parts[parts.length - 1] = pluralWord(parts[parts.length - 1]);
  return parts.join("");
}
