// Server-side helpers that apply the per-recipient license stamp to:
//   • ExcelJS workbooks (band on first sheet, About sheet, headerFooter on
//     every sheet, author metadata) — see applyLicenseToExcelJS.
//   • Puppeteer/HTML-to-PDF flows (license band injected after <body>, a
//     full Copyright + License Terms appendix injected before </body>, plus
//     a license band line added to the Puppeteer footerTemplate so it shows
//     on every page).
//
// The ExcelJS implementation lives in shared/licenseExceljs.ts so the
// browser-side admin export (client/src/pages/AdminReportPage.tsx) can use
// the same logic without pulling in any Node-only modules.

import {
  AUTHOR_META,
  COPYRIGHT_BLOCK,
  LICENSE_BAND,
  LICENSE_TERMS_BLOCK,
  normalizeLicenseContext,
  type LicenseContext,
} from "@shared/licenseText";
import { applyLicenseToExcelJSWorkbook } from "@shared/licenseExceljs";

export const applyLicenseToExcelJS = applyLicenseToExcelJSWorkbook;

// SheetJS (xlsx) shim. Documented no-op: every customer-facing XLSX in this
// repo is built with ExcelJS per STANDING_REQUIREMENTS.md ("ExcelJS only —
// NEVER SheetJS"). Kept exported so callers can be swapped if SheetJS is ever
// reintroduced for an internal-only flow.
export function applyLicenseToXlsxJS(
  _workbook: unknown,
  _ctx: Partial<LicenseContext> | null | undefined,
): void {
  // Intentionally empty. See module header for the rationale.
}

// ───────────────── Puppeteer / HTML-to-PDF helpers ─────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function licenseHtmlAppendixSection(
  ctx: Partial<LicenseContext> | null | undefined,
): string {
  const norm = normalizeLicenseContext(ctx);
  const planLine = norm.plan ? `<div>Plan: ${escHtml(norm.plan)}</div>` : "";
  return `
<section class="veritas-license-appendix" style="page-break-before:always;font-family:Helvetica,Arial,sans-serif;color:#1A1A1A;padding:8mm 0 0 0;">
  <h2 style="font-family:Helvetica,Arial,sans-serif;font-size:18px;color:#004F4F;margin:0 0 12px 0;">Copyright and License Terms</h2>
  <h3 style="font-size:12px;color:#004F4F;margin:14px 0 4px 0;">Copyright</h3>
  <p style="font-size:10px;line-height:1.45;margin:0 0 10px 0;">${escHtml(COPYRIGHT_BLOCK)}</p>
  <h3 style="font-size:12px;color:#004F4F;margin:14px 0 4px 0;">License terms</h3>
  <p style="font-size:10px;line-height:1.45;margin:0 0 10px 0;">${escHtml(LICENSE_TERMS_BLOCK)}</p>
  <h3 style="font-size:12px;color:#004F4F;margin:14px 0 4px 0;">Licensed to</h3>
  <div style="font-size:10px;color:#6E4A00;font-style:italic;font-weight:bold;line-height:1.5;">
    <div>${escHtml(norm.licensee)}</div>
    <div>${escHtml(norm.email)}</div>
    ${planLine}
    <div>Issued ${escHtml(norm.issueDate)}</div>
  </div>
  <p style="font-size:8px;color:#777;margin-top:18px;font-style:italic;">Veritas Lab Services, LLC · ${escHtml(AUTHOR_META)}</p>
</section>`;
}

export function licenseHtmlBandTop(
  ctx: Partial<LicenseContext> | null | undefined,
): string {
  const norm = normalizeLicenseContext(ctx);
  const band = LICENSE_BAND(norm.licensee, norm.email, norm.issueDate);
  return `
<div class="veritas-license-band" style="font-family:Helvetica,Arial,sans-serif;font-size:8px;color:#6E4A00;background:#FFF7E0;padding:4px 8px;border-bottom:1px solid #E6D9A8;text-align:center;">
  ${escHtml(band)}
</div>`;
}

// Inject the band right after <body> and the appendix right before </body>.
export function injectLicenseHtml(
  html: string,
  ctx: Partial<LicenseContext> | null | undefined,
): string {
  if (!html) return html;
  const norm = normalizeLicenseContext(ctx);
  let out = html;
  const band = licenseHtmlBandTop(norm);
  const appendix = licenseHtmlAppendixSection(norm);
  if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body([^>]*)>/i, (_m, attrs) => `<body${attrs}>${band}`);
  } else {
    out = band + out;
  }
  if (/<\/body>/i.test(out)) {
    out = out.replace(/<\/body>/i, `${appendix}</body>`);
  } else {
    out = out + appendix;
  }
  return out;
}

// Returns a footer template extended with the license band line. Pass the
// existing Puppeteer footer template; if empty, returns a band-only footer.
export function licenseAugmentedFooterTemplate(
  baseTemplate: string,
  ctx: Partial<LicenseContext> | null | undefined,
): string {
  const norm = normalizeLicenseContext(ctx);
  const band = LICENSE_BAND(norm.licensee, norm.email, norm.issueDate);
  const bandLine = `
  <div style="width:100%;text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:6px;color:#6E4A00;padding:0 15mm 2px 15mm;box-sizing:border-box;">${escHtml(band)}</div>`;
  if (!baseTemplate) {
    return `<div style="width:100%">${bandLine}</div>`;
  }
  if (/<div[^>]*>/.test(baseTemplate)) {
    return baseTemplate.replace(/<div([^>]*)>/, (_m, attrs) => `<div${attrs}>${bandLine}`);
  }
  return bandLine + baseTemplate;
}

export const LICENSE_PDF_METADATA = {
  author: AUTHOR_META,
  creator: AUTHOR_META,
  producer: "Veritas Lab Services - licenseStamp.ts",
} as const;

export type { LicenseContext };
