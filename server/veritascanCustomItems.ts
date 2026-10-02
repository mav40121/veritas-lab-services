// server/veritascanCustomItems.ts
//
// Validation for per-lab VeritaScan custom questions (parking-lot #55). Labs
// author their own scan items alongside the curated 173-item master set
// (client/src/lib/veritaScanData.ts). These are stored per-lab and scored in a
// SEPARATE section that does NOT count toward the standardized readiness %, so
// this module only validates the authored content and the per-scan status value.
//
// The ten domains mirror ScanDomain in client/src/lib/veritaScanData.ts. A
// custom item MAY be tagged with one of them for the lab's own organization, but
// it is optional: custom items always render and score in their own section
// regardless of the tag. The five statuses mirror ScanStatus there.

export const SCAN_DOMAINS = [
  "Quality Systems & QC",
  "Calibration & Verification",
  "Proficiency Testing",
  "Personnel & Competency",
  "Test Management & Procedures",
  "Equipment & Maintenance",
  "Safety & Environment",
  "Blood Bank & Transfusion",
  "Point of Care Testing",
  "Leadership & Governance",
] as const;

export const CUSTOM_ITEM_STATUSES = [
  "Compliant",
  "Needs Attention",
  "Immediate Action",
  "N/A",
  "Not Assessed",
] as const;

export const QUESTION_MAX = 500;
export const CITATION_MAX = 300;

export interface CustomItemInput {
  question?: unknown;
  domain?: unknown;
  tjc?: unknown;
  cap?: unknown;
  cfr?: unknown;
  aabb?: unknown;
  cola?: unknown;
}

export interface CleanCustomItem {
  question: string;
  domain: string | null;
  tjc: string | null;
  cap: string | null;
  cfr: string | null;
  aabb: string | null;
  cola: string | null;
}

// Trim, drop-to-null when empty, cap length. Non-string inputs are coerced.
function cleanOptional(v: unknown, cap: number): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, cap);
}

export function validateCustomItem(
  input: CustomItemInput,
): { ok: true; value: CleanCustomItem } | { ok: false; error: string } {
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) return { ok: false, error: "question is required" };
  if (question.length > QUESTION_MAX) {
    return { ok: false, error: `question must be ${QUESTION_MAX} characters or fewer` };
  }

  let domain: string | null = null;
  if (input.domain !== undefined && input.domain !== null && String(input.domain).trim() !== "") {
    const d = String(input.domain).trim();
    if (!(SCAN_DOMAINS as readonly string[]).includes(d)) {
      return { ok: false, error: "domain is not a recognized VeritaScan domain" };
    }
    domain = d;
  }

  return {
    ok: true,
    value: {
      question,
      domain,
      tjc: cleanOptional(input.tjc, CITATION_MAX),
      cap: cleanOptional(input.cap, CITATION_MAX),
      cfr: cleanOptional(input.cfr, CITATION_MAX),
      aabb: cleanOptional(input.aabb, CITATION_MAX),
      cola: cleanOptional(input.cola, CITATION_MAX),
    },
  };
}

export function isValidCustomStatus(s: unknown): boolean {
  return typeof s === "string" && (CUSTOM_ITEM_STATUSES as readonly string[]).includes(s);
}
