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

// ── Phase 3c: org subscription covers its member labs (additive) ────────────
// Option 1 bills the system once for all its labs, so an org-linked lab inherits
// the organization's subscription coverage. This is applied additively: we take
// the LATER of the lab's own expiry and the org's, so org coverage can only
// EXTEND a lab's access, never reduce it. Standalone labs (no org) are untouched.

// Pure: the later (more generous) of two ISO expiry strings. null means "no
// expiry on this side" and loses to any real date; two nulls stay null.
export function laterExpiry(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a ?? null;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

// SQLite: the subscription_expires_at of the organization that owns `labId`, or
// null when the lab is standalone (organization_id NULL) or the org tables are
// absent. Used by labScopeMiddleware to overlay org coverage onto the lab.
export function orgSubscriptionExpiryForLab(sqlite: any, labId: number): string | null {
  try {
    const row = sqlite
      .prepare("SELECT o.subscription_expires_at AS exp FROM labs l JOIN organizations o ON o.id = l.organization_id WHERE l.id = ? AND l.organization_id IS NOT NULL LIMIT 1")
      .get(labId) as any;
    return row?.exp ?? null;
  } catch {
    return null;
  }
}

// ── Phase 3d: build the org's Stripe subscription from the billing line items ─
// Option 1 = ONE subscription on the org with one item per line item. System
// tier is custom-quoted, so each item uses inline price_data (a negotiated
// annual unit_amount) rather than a catalog price. This is the pure request
// builder; the admin endpoint attaches org.stripe_customer_id and fires Stripe.

export type StripeSubItem = {
  price_data: {
    currency: string;
    unit_amount: number;
    recurring: { interval: "year" };
    product_data: { name: string };
  };
  quantity: number;
  metadata: Record<string, string>;
};

// Pure: one Stripe subscription item per billing line item. A zero-amount line
// (e.g. an included repository) is kept as a $0 item so the invoice still lists
// the site. The per-lab metadata lets the webhook/line map back to the lab.
export function buildOrgSubscriptionItems(items: NormalizedLineItem[], currency = "usd"): StripeSubItem[] {
  return items.map((it) => {
    const metadata: Record<string, string> = {};
    if (it.labId != null) metadata.labId = String(it.labId);
    return {
      price_data: {
        currency,
        unit_amount: it.annualAmountCents,
        recurring: { interval: "year" as const },
        product_data: { name: it.description || (it.labId != null ? `Lab ${it.labId}` : "System line item") },
      },
      quantity: 1,
      metadata,
    };
  });
}
