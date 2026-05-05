// Single source of truth for the per-recipient license stamp applied to every
// PDF / XLSX the website generates. Mirrors the language in
// stamp_veritas_pdf.py and stamp_veritas_xlsx.py so a customer who saves a file
// and later opens the standalone Python stamper sees identical legal text.
//
// Texts here are user-facing: middot separators only, no em-dashes.

export const AUTHOR_META = "Michael Veri / Veritas Lab Services, LLC";

export const COPYRIGHT_BLOCK =
  "© 2026 Veritas Lab Services, LLC. VeritaAssure™ and " +
  "VeritaPolicy™ are trademarks of Veritas Lab Services, LLC. " +
  "All rights reserved. The structure, organization, original written " +
  "content, and visual design of this document are the copyrighted " +
  "work of Veritas Lab Services, LLC. Public-domain U.S. federal " +
  "regulations and standards-body identifiers used for navigation are " +
  "not claimed. TJC, COLA, DNV NIAHO, HFAP, CMS, and other accreditor " +
  "or agency names are trademarks or marks of their respective owners " +
  "and are referenced for crosswalk purposes only; no copyrighted " +
  "manual content is reproduced.";

export const LICENSE_TERMS_BLOCK =
  "This document is licensed for single-facility internal use by the " +
  "named licensee below. Redistribution, resale, sublicensing, public " +
  "posting, and creation of derivative works are prohibited. Internal " +
  "copies for survey preparation, staff training, and operational use " +
  "at the licensed facility are permitted. Governing law: Commonwealth " +
  "of Massachusetts. Violations may result in termination of license " +
  "and statutory damages under 17 U.S.C. §§ 504-505.";

export function LICENSE_BAND(licensee: string, email: string, issueDate: string): string {
  const safeLicensee = (licensee || "Demo Preview").trim();
  const safeEmail = (email || "anonymous").trim();
  const safeDate = (issueDate || new Date().toISOString().slice(0, 10)).trim();
  return (
    `© 2026 Veritas Lab Services, LLC · ` +
    `Licensed to ${safeLicensee} (${safeEmail}) · ` +
    `Issued ${safeDate} · ` +
    `Single-facility internal use only · Do not redistribute`
  );
}

export interface LicenseContext {
  licensee: string;
  email: string;
  issueDate: string;
  plan?: string;
}

export function normalizeLicenseContext(
  ctx: Partial<LicenseContext> | null | undefined,
): LicenseContext {
  return {
    licensee: (ctx?.licensee || "Demo Preview").trim(),
    email: (ctx?.email || "anonymous").trim(),
    issueDate: (ctx?.issueDate || new Date().toISOString().slice(0, 10)).trim(),
    plan: ctx?.plan ? String(ctx.plan).trim() : undefined,
  };
}
