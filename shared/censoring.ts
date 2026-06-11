// shared/censoring.ts
//
// 2026-06-10 (PR B): single source of truth for the pure censoring
// helpers used by BOTH the client data-entry grid and the server PDF
// renderer. Previously these lived only in server/censoring.ts; the
// client needs parseCensoredInput + displayPointValue + isCensored to
// let directors type "<17" / ">500" and echo the marker back.
//
// A censored result is tagged in the data_points blob as:
//   { censored: true, censor_direction: 'below'|'above', censor_value: number }
//
// server/censoring.ts re-exports these and adds the math-only helpers
// (censorValueForMath, applyCensoringToVector, policyLabel,
// policyNarrative) that the client does not need.

export type CensoringPolicy = "exclude" | "substitute_lld" | "substitute_lld_half";

export interface CensoredPoint {
  censored: true;
  censor_direction: "below" | "above";
  censor_value: number;
}

export function isCensored(p: any): p is CensoredPoint {
  return !!p && p.censored === true && typeof p.censor_value === "number" && Number.isFinite(p.censor_value)
    && (p.censor_direction === "below" || p.censor_direction === "above");
}

/**
 * Parse a string input like "17", "<17", or ">500" into a structured
 * shape. Used by the client when the director enters values, and by
 * server bulk-import paths.
 *
 * Returns null only when the body is not a finite number (e.g. "" or
 * "abc"); callers treat null as "clear the cell".
 */
export function parseCensoredInput(s: string): { value?: number; censored?: CensoredPoint } | null {
  if (typeof s !== "string") return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  let direction: "below" | "above" | null = null;
  let body = trimmed;
  if (trimmed.startsWith("<")) {
    direction = "below";
    body = trimmed.slice(1).trim();
  } else if (trimmed.startsWith(">")) {
    direction = "above";
    body = trimmed.slice(1).trim();
  }
  const n = Number(body);
  if (!Number.isFinite(n)) return null;
  if (direction) {
    return { censored: { censored: true, censor_direction: direction, censor_value: n } };
  }
  return { value: n };
}

/**
 * Display a point as a string for tables / PDFs. Censored points
 * render as "<17" or ">500"; numeric points (in the {value} envelope)
 * render with `digits` decimals. Kept byte-identical to the original
 * server implementation so existing receipts (scripts/verify-censoring.mjs)
 * stay green.
 *
 * NOTE: this reads `point.value`, not a bare number. The data-entry grid
 * stores a censored cell as the censored object itself and a numeric cell
 * as a bare number, so the client renders bare numbers directly and only
 * calls this for censored objects (where `digits` is irrelevant).
 */
export function displayPointValue(point: any, digits = 3): string {
  if (isCensored(point)) {
    const sign = point.censor_direction === "below" ? "<" : ">";
    return `${sign}${point.censor_value}`;
  }
  if (typeof point?.value === "number" && Number.isFinite(point.value)) {
    return point.value.toFixed(digits);
  }
  return "-";
}
