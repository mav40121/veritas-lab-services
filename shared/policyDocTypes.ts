// shared/policyDocTypes.ts
//
// VeritaDC document types (Michael 2026-11-03, Q151/Q154; parity plan Phase 1 item 2). Heywood's MediaLab library types
// every document, and each type decides whether it needs periodic review and whether staff read and sign it (a form or a
// job aid skips both there). Each lab sets its own rule per type in policy_doc_type_settings; a type the lab has not set,
// and a document with no type, behave exactly as before (periodic review on, read-and-sign on).

export const POLICY_DOC_TYPES = [
  { key: "policy", label: "Policy" },
  { key: "procedure", label: "Procedure" },
  { key: "form", label: "Form" },
  { key: "job_aid", label: "Job aid" },
  { key: "iqcp", label: "IQCP" },
  { key: "manufacturer_insert", label: "Manufacturer's insert" },
  { key: "template", label: "Template" },
  { key: "attachment", label: "Attachment" },
  { key: "other", label: "Other" },
] as const;

export type PolicyDocType = (typeof POLICY_DOC_TYPES)[number]["key"];

export const isPolicyDocType = (s: unknown): s is PolicyDocType =>
  typeof s === "string" && POLICY_DOC_TYPES.some((t) => t.key === s);

export const docTypeLabel = (s: string | null | undefined) => POLICY_DOC_TYPES.find((t) => t.key === s)?.label ?? null;

export type DocTypeRule = {
  doc_type: PolicyDocType;
  label: string;
  requires_periodic_review: boolean;
  requires_read_and_sign: boolean;
  default_review_months: number | null; // null = the lab's usual interval
  set_by_lab: boolean;
};

/** The rule for every type: the lab's own where set, otherwise today's behavior. */
export function docTypeRules(
  rows: { doc_type: string; requires_periodic_review: number | null; requires_read_and_sign: number | null; default_review_months: number | null }[]
): DocTypeRule[] {
  return POLICY_DOC_TYPES.map((t) => {
    const r = rows.find((x) => x.doc_type === t.key);
    return {
      doc_type: t.key,
      label: t.label,
      requires_periodic_review: r?.requires_periodic_review == null ? true : r.requires_periodic_review === 1,
      requires_read_and_sign: r?.requires_read_and_sign == null ? true : r.requires_read_and_sign === 1,
      default_review_months: r?.default_review_months ?? null,
      set_by_lab: !!r,
    };
  });
}

// Review intervals a lab may set as a type's default (months), matching the upload picker.
export const DOC_TYPE_REVIEW_MONTHS = [6, 12, 24, 36] as const;
