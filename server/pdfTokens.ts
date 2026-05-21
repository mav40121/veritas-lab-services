// Short-lived in-memory PDF token store. Shared between routes.ts and
// veritabench.ts so any module that generates a PDF can return a one-time
// token that the browser then GETs at /api/pdf/:token. The GET handler
// itself is defined once in routes.ts and reads from this same map.
//
// Why a token dance instead of streaming the PDF inline: native browser
// downloads bypass Adobe Acrobat's blob:// interception, which intermittently
// hijacked downloads in earlier revisions. Also keeps PDF generation
// authenticated (POST carries the Bearer token) while letting the actual
// transfer be a plain GET the browser can handle natively.

import crypto from "crypto";

export interface PdfTokenEntry { buffer: Buffer; filename: string; expires: number; }

export const pdfTokenStore = new Map<string, PdfTokenEntry>();

// Expiry window between "token stored" and "browser GETs the token URL".
// Was 60s, which sounded generous until the reorder-PDF flow surfaced the
// edge case: on a cold puppeteer launch the POST itself can take 30-60s,
// so by the time the response transfer completes, the new tab opens, and
// the browser actually navigates to /api/pdf/:token, the token has already
// expired ("PDF token expired or not found" in the new tab).
//
// 300s leaves room for cold starts plus normal browser delays. Tokens are
// single-use so this only matters in the window before first claim; the
// store grows at most O(unclaimed tokens) which the opportunistic prune
// below keeps bounded.
const TOKEN_EXPIRY_MS = 300_000;

export function storePdfToken(buffer: Buffer, filename: string): string {
  const token = crypto.randomUUID();
  pdfTokenStore.set(token, { buffer, filename, expires: Date.now() + TOKEN_EXPIRY_MS });
  // Prune expired entries opportunistically; no separate timer needed.
  for (const [k, v] of Array.from(pdfTokenStore)) {
    if (v.expires < Date.now()) pdfTokenStore.delete(k);
  }
  return token;
}
