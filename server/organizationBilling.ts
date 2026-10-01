// server/organizationBilling.ts
//
// Phase 3b of the System/Organization entity work (docs/SYSTEM_ENTITY_DESIGN.md).
//
// Option 1 (Michael, 2026-10-01): org-level billing is ONE subscription/renewal
// on the organization with PER-LAB line items. The system gets one invoice and
// one renewal; each lab is a line item so the customer can allocate cost to each
// site internally. System tier is custom-quoted, so each line item's annual
// amount is a negotiated input, not a computed rate.
//
// This module is the pure core: validate incoming line items and compute the
// single-invoice rollup. It fires no Stripe calls and reads no DB; the admin
// endpoint persists the result. Mirrored by scripts/verify-org-billing.mjs.

export type BillingLineItemInput = {
  labId?: number | null;
  description?: string | null;
  annualAmountCents?: number;
};

export type NormalizedLineItem = {
  labId: number | null;
  description: string | null;
  annualAmountCents: number;
};

// Pure: validate + normalize the incoming line items. An amount must be a
// non-negative integer number of cents (whole cents only; no floats). A line
// item may be lab-scoped (labId set) or org-level (labId null, e.g. a system
// fee). Returns { items, errors }; callers reject when errors is non-empty.
export function normalizeLineItems(input: BillingLineItemInput[]): {
  items: NormalizedLineItem[];
  errors: string[];
} {
  const errors: string[] = [];
  const items: NormalizedLineItem[] = [];
  if (!Array.isArray(input) || input.length === 0) {
    errors.push("lineItems[] (at least one) is required");
    return { items, errors };
  }
  input.forEach((li, i) => {
    const cents = li?.annualAmountCents;
    if (typeof cents !== "number" || !Number.isInteger(cents) || cents < 0) {
      errors.push(`lineItems[${i}].annualAmountCents must be a non-negative integer (cents)`);
      return;
    }
    const labId = li?.labId == null ? null : Number(li.labId);
    if (labId != null && (!Number.isInteger(labId) || labId <= 0)) {
      errors.push(`lineItems[${i}].labId must be a positive integer or null`);
      return;
    }
    items.push({
      labId,
      description: li?.description != null ? String(li.description) : null,
      annualAmountCents: cents,
    });
  });
  return { items, errors };
}

// Pure: the single-invoice rollup for the organization. Totals the line items
// (the one amount the system is billed) and returns the per-lab breakdown (what
// each site costs, for internal allocation). Dollars are derived for display.
export function computeOrgInvoice(items: NormalizedLineItem[]): {
  lineCount: number;
  labCount: number;
  totalCents: number;
  totalDollars: number;
  perLab: NormalizedLineItem[];
} {
  const totalCents = items.reduce((s, it) => s + (it.annualAmountCents || 0), 0);
  const perLab = items.filter((it) => it.labId != null);
  return {
    lineCount: items.length,
    labCount: perLab.length,
    totalCents,
    totalDollars: Math.round(totalCents) / 100,
    perLab,
  };
}
