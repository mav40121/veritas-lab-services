// Centralized CLIA number validation. Used by both client and server so the
// rules cannot drift between the two surfaces.
//
// Format reference (CMS):
//   - 10 characters total
//   - Positions 1-2: numeric state code (01-99 plus territory codes)
//   - Position 3: literal letter "D" (denotes CLIA)
//   - Positions 4-10: seven numeric digits
//   - Example: "22D0070843"
//
// The validator is intentionally format-only. It does not consult the CMS
// public CLIA registry. That can be added later if real-world existence
// becomes a product requirement; format catches the overwhelming majority
// of typos.

export interface CliaValidationResult {
  ok: boolean;
  /** Cleaned, uppercased value when ok=true. Undefined on failure. */
  normalized?: string;
  /** User-facing message when ok=false. Undefined on success. */
  error?: string;
}

const CLIA_REGEX = /^\d{2}D\d{7}$/;

export const CLIA_FORMAT_HINT =
  "Must be 10 characters: 2 digits, then 'D', then 7 digits. Example: 22D0070843.";

/**
 * Normalize and validate a CLIA number string.
 *
 * Normalization steps applied before regex match:
 *   - Strip leading/trailing whitespace
 *   - Strip embedded spaces, tabs, hyphens (common when copy-pasted)
 *   - Uppercase the entire string so a lowercase "d" is accepted
 *
 * Returns { ok: true, normalized } on success, otherwise { ok: false, error }.
 *
 * Empty strings and null/undefined inputs return ok:false with the format hint.
 * Callers that want to allow "no CLIA yet" should check for empty before
 * calling this function.
 */
export function validateClia(input: unknown): CliaValidationResult {
  if (input === null || input === undefined) {
    return { ok: false, error: CLIA_FORMAT_HINT };
  }
  const raw = String(input);
  // Strip whitespace and dashes anywhere in the string, then uppercase.
  const cleaned = raw.replace(/[\s\-]/g, "").toUpperCase();
  if (cleaned.length === 0) {
    return { ok: false, error: CLIA_FORMAT_HINT };
  }
  if (!CLIA_REGEX.test(cleaned)) {
    return { ok: false, error: CLIA_FORMAT_HINT };
  }
  return { ok: true, normalized: cleaned };
}

/**
 * Convenience: returns true when the input is either empty (after trim) or a
 * valid CLIA. Used for forms where CLIA is optional but, if provided, must
 * be well-formed.
 */
export function isCliaValidOrEmpty(input: unknown): boolean {
  if (input === null || input === undefined) return true;
  const raw = String(input).trim();
  if (raw.length === 0) return true;
  return validateClia(raw).ok;
}
