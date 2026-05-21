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

export function storePdfToken(buffer: Buffer, filename: string): string {
  const token = crypto.randomUUID();
  pdfTokenStore.set(token, { buffer, filename, expires: Date.now() + 60_000 });
  // Prune expired entries opportunistically; no separate timer needed.
  for (const [k, v] of Array.from(pdfTokenStore)) {
    if (v.expires < Date.now()) pdfTokenStore.delete(k);
  }
  return token;
}
