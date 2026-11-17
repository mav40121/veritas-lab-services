// server/vcCheckout.ts
//
// BUG-173 (2026-11-17, design approved by Michael "1"): VeritaCheck® Unlimited checkout for a lab.
// POST /api/stripe/checkout stamps metadata.labId and the webhook writes plan = priceType, a card subscription id and a
// one-year expiry to that lab. Two refusals, for priceType "veritacheck_only" only, run before the route touches Stripe:
//   - 403 NOT_LAB_OWNER: the lab the webhook would write to isn't owned by the person checking out, so a seat user can't
//     change their employer's lab plan;
//   - 409 ALREADY_SUBSCRIBED: that lab already has a live card subscription (a subscription id, status 'active', and an
//     expiry that is blank or still ahead), so a second checkout would bill the lab twice.
// A comped Unlimited lab (plan set by hand, no subscription id) and a lapsed one may check out.
// tests/integration/vc-checkout.test.ts pins it.

export interface VcCheckoutRefusal {
  status: 403 | 409;
  body: { error: string; code: "NOT_LAB_OWNER" | "ALREADY_SUBSCRIBED" };
}

// The lab the checkout route stamps on the session's metadata.labId, in the route's order: the lab named in the body
// when the person is an active member of it, else users.default_lab_id, else none.
export function checkoutMetadataLabId(sqlite: any, userId: number, bodyLabId: unknown): number | null {
  if (bodyLabId) {
    const requested = parseInt(String(bodyLabId)) || 0;
    if (requested) {
      const member = sqlite.prepare(
        "SELECT id FROM lab_members WHERE user_id = ? AND lab_id = ? AND status = 'active' LIMIT 1"
      ).get(userId, requested);
      if (member) return requested;
    }
  }
  const u = sqlite.prepare("SELECT default_lab_id FROM users WHERE id = ?").get(userId) as any;
  return u?.default_lab_id ? Number(u.default_lab_id) : null;
}

// The lab the webhook writes the plan to: the metadata lab, else (a session with no labId) the person's primary active
// membership, the webhook's own fallback. Null when neither exists; the webhook then writes the user row only.
export function checkoutTargetLabId(sqlite: any, userId: number, bodyLabId: unknown): number | null {
  const stamped = checkoutMetadataLabId(sqlite, userId, bodyLabId);
  if (stamped) return stamped;
  const lm = sqlite.prepare(
    "SELECT lab_id FROM lab_members WHERE user_id = ? AND is_primary_lab = 1 AND status = 'active' LIMIT 1"
  ).get(userId) as any;
  return lm?.lab_id ? Number(lm.lab_id) : null;
}

// A lab paying by card through Stripe: a subscription id on file and status 'active'. GET /api/labs/me sends this as
// hasCardSubscription (a boolean, never the id).
export function hasActiveCardSubscription(row: { stripe_subscription_id?: string | null; subscription_status?: string | null } | null | undefined): boolean {
  if (!row) return false;
  return String(row.stripe_subscription_id ?? "").trim() !== "" && row.subscription_status === "active";
}

// VeritaCheck Unlimited's first year (BUG-173 follow-up, 2026-11-17). The base price is $499 a year and VCFIRSTYEAR takes
// $200 off once, so the first year is $299. A discount code used to REPLACE that coupon (10% off once billed $449.10), so
// the buyer now gets whichever makes the first year cheaper: the code, or the $200 first-year discount. A tie goes to the
// first-year discount; the price never goes below $0. Stripe coupons carry either a percent or an amount (in cents).
export const VC_BASE_CENTS = 49900;
export const VC_FIRST_YEAR_OFF_CENTS = 20000;

export function vcFirstYear({ percentOff, amountOffCents }: { percentOff?: number | null; amountOffCents?: number | null }): { use: "code" | "first_year"; firstYearCents: number } {
  const withFirstYear = Math.max(0, VC_BASE_CENTS - VC_FIRST_YEAR_OFF_CENTS);
  const pct = Number(percentOff) || 0;
  const amt = Number(amountOffCents) || 0;
  let withCode = VC_BASE_CENTS;
  if (pct > 0) withCode = Math.round(VC_BASE_CENTS * (1 - Math.min(pct, 100) / 100));
  else if (amt > 0) withCode = VC_BASE_CENTS - Math.round(amt);
  withCode = Math.max(0, withCode);
  return withCode < withFirstYear ? { use: "code", firstYearCents: withCode } : { use: "first_year", firstYearCents: withFirstYear };
}

// What POST /api/discount/validate adds for a valid code on VeritaCheck Unlimited, so the screen can show the first year
// the buyer will really pay; nothing for any other priceType.
export function vcFirstYearFields(priceType: unknown, code: { percentOff?: number | null; amountOffCents?: number | null }): { firstYearCents?: number; appliedAs?: "code" | "first_year" } {
  if (priceType !== "veritacheck_only") return {};
  const pick = vcFirstYear(code);
  return { firstYearCents: pick.firstYearCents, appliedAs: pick.use };
}

// What a VeritaCheck Unlimited checkout session gets, from the code's coupon as the route found it (codeCouponId is set
// only when the code resolved to a Stripe coupon). Never a trial: a trial would let someone run studies and cancel before
// the first charge, so a code's trial_days doesn't apply here. codeUsed says whether the code itself went on the session
// (only then does the route count a use of it).
export function vcCheckoutCoupon({ codeCouponId, percentOff, amountOffCents, firstYearCouponId }: {
  codeCouponId?: string | null; percentOff?: number | null; amountOffCents?: number | null; firstYearCouponId: string;
}): { couponId: string; trialDays: null; codeUsed: boolean; firstYearCents: number } {
  if (!codeCouponId) return { couponId: firstYearCouponId, trialDays: null, codeUsed: false, firstYearCents: VC_BASE_CENTS - VC_FIRST_YEAR_OFF_CENTS };
  const pick = vcFirstYear({ percentOff, amountOffCents });
  return pick.use === "code"
    ? { couponId: codeCouponId, trialDays: null, codeUsed: true, firstYearCents: pick.firstYearCents }
    : { couponId: firstYearCouponId, trialDays: null, codeUsed: false, firstYearCents: pick.firstYearCents };
}

// Null when the checkout may go ahead; otherwise the refusal to send.
export function vcCheckoutRefusal(sqlite: any, userId: number, bodyLabId: unknown, now: number = Date.now()): VcCheckoutRefusal | null {
  const labId = checkoutTargetLabId(sqlite, userId, bodyLabId);
  if (!labId) return null;
  const lab = sqlite.prepare(
    "SELECT owner_user_id, stripe_subscription_id, subscription_status, subscription_expires_at FROM labs WHERE id = ?"
  ).get(labId) as any;
  if (!lab) return null;
  if (Number(lab.owner_user_id) !== Number(userId)) {
    return { status: 403, body: { error: "Only the lab's owner can subscribe this lab.", code: "NOT_LAB_OWNER" } };
  }
  if (hasActiveCardSubscription(lab)) {
    const exp = lab.subscription_expires_at ? new Date(lab.subscription_expires_at).getTime() : null;
    // An expiry that doesn't read as a date counts as still ahead: the subscription id and active status say it's live.
    const lapsed = exp != null && Number.isFinite(exp) && exp <= now;
    if (!lapsed) {
      return { status: 409, body: { error: "This lab already has an active VeritaCheck® Unlimited subscription.", code: "ALREADY_SUBSCRIBED" } };
    }
  }
  return null;
}
