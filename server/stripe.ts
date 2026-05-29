import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";

if (!stripeSecretKey) {
  console.warn("[Stripe] STRIPE_SECRET_KEY is not set - Stripe payments will be disabled");
}

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2026-03-25.dahlia" as any })
  : null;

// Active live base prices (MEDIUM scenario, effective 2026-05-23).
// Stripe price IDs created via scripts/create-medium-stripe-prices.js.
export const PRICES = {
  perStudy:         "price_1TGXPo5dn6rqLgIxsnvNa2oi",   // $25 one-time
  waived:           "price_1TaQXR5dn6rqLgIxJVoI5Hsz",   // Clinic $999/yr
  community:        "price_1TaQXR5dn6rqLgIxHnDQt7fU",   // Community $2,125/yr
  hospital:         "price_1TaQXR5dn6rqLgIx5XOqsLKU",   // Hospital $4,995/yr
  large_hospital:   "price_1TKiEg5dn6rqLgIxZ9ktBavQ",   // Legacy Enterprise $2,999/yr; System tier is custom-quote (no published price)
  veritacheck_only: "price_1TaQXR5dn6rqLgIxsi2uMrxS",   // VC Unlimited $499/yr base; Y1 discounted to $299 via VC_UNLIMITED_FIRST_YEAR_COUPON
};

// Legacy Stripe price IDs preserved for grandfathered subscriptions.
// Never reference these for NEW checkouts. Existing customers ride them at
// renewal; the COLA grandfather policy (see memory) governs who qualifies.
export const GRANDFATHERED_PRICES = {
  veritacheck_only_v1: "price_1TGXPn5dn6rqLgIxfyoLXVKo", // $299/yr (single-rate, pre-MEDIUM)
  waived_v1:           "price_1TGXPl5dn6rqLgIx14yANdxj", // Clinic $499/yr
  community_v1:        "price_1TKiEg5dn6rqLgIxrBKvqbGb", // Community $999/yr
  hospital_v1:         "price_1TKiEg5dn6rqLgIxXioYyC5u", // Hospital $1,999/yr
  large_hospital_v1:   "price_1TKiEg5dn6rqLgIxZ9ktBavQ", // Enterprise $2,999/yr (also currently in PRICES.large_hospital pending System custom-quote flow)
  community_v0:        "price_1TGXPm5dn6rqLgIxHdfFVNfA", // $799/yr
  hospital_v0:         "price_1TGXPm5dn6rqLgIxC5UCBXLn", // $1,299/yr
  enterprise_v0:       "price_1TGXPm5dn6rqLgIxzahbIaQV", // $1,999/yr
};

// Tier-indexed additional-seat prices (MEDIUM scenario).
// Each tier has one rate; additional seats above the tier-included count
// are priced at that rate. To get a lower per-seat rate, upgrade tiers.
// Replaces the legacy band-based SEAT_PRICING for NEW checkouts.
export const SEAT_PRICES_BY_TIER: Record<string, { pricePerSeat: number; priceId: string }> = {
  waived:    { pricePerSeat: 500, priceId: "price_1TaQXS5dn6rqLgIxLlLKs1Bv" }, // Clinic    $500/seat
  community: { pricePerSeat: 425, priceId: "price_1TaQXS5dn6rqLgIx38gjkn6t" }, // Community $425/seat
  hospital:  { pricePerSeat: 333, priceId: "price_1TaQXT5dn6rqLgIxxFWywFOy" }, // Hospital  $333/seat
  // large_hospital (System): custom quote; no published add-on rate.
};

// Auto-applied coupon for VeritaCheck Unlimited subscriptions to deliver
// Y1 = $299 (Y2+ = $499 list). $200 off, duration: once.
export const VC_UNLIMITED_FIRST_YEAR_COUPON = "VCFIRSTYEAR";

// parking-lot #33 PR 6: view-only seat add-on (medical director or designee,
// technical consultant, technical supervisor; capped per tier 1/2/3 with this
// add-on for extras). Price is $99/yr/seat per CLAUDE.md sec 10. The Stripe
// price ID is read from env so Michael can create the product in the dashboard
// without a code change. Until STRIPE_VIEW_ONLY_ADDON_PRICE is set, view-only
// add-ons are billed manually via invoice and getViewOnlyAddOnPriceId returns
// null.
export const VIEW_ONLY_ADDON_UNIT_AMOUNT_CENTS = 9900;
export const VIEW_ONLY_ADDON_RATE_PER_YEAR = 99;
export function getViewOnlyAddOnPriceId(): string | null {
  return process.env.STRIPE_VIEW_ONLY_ADDON_PRICE || null;
}
export function getViewOnlyAddOnConfig(): { priceId: string | null; ratePerYear: number; unitAmountCents: number } {
  return {
    priceId: getViewOnlyAddOnPriceId(),
    ratePerYear: VIEW_ONLY_ADDON_RATE_PER_YEAR,
    unitAmountCents: VIEW_ONLY_ADDON_UNIT_AMOUNT_CENTS,
  };
}

// Legacy band-based seat add-on Stripe IDs. Preserved for any callsite that
// hasn't been migrated to SEAT_PRICES_BY_TIER. Existing subscriptions with
// these line items keep working at renewal.
export const LEGACY_SEAT_PRICES = {
  seats_2_5:   "price_1TGXPn5dn6rqLgIxdrreE5X4",   // $199/seat
  seats_6_10:  "price_1TGXPn5dn6rqLgIxEhLz7fmK",   // $179/seat
  seats_11_25: "price_1TGXPn5dn6rqLgIxtsRXHf80",   // $159/seat
  seats_26:    "price_1TGXPo5dn6rqLgIxo3Fj2Llr",   // $139/seat
};
export const SEAT_PRICES = LEGACY_SEAT_PRICES; // Back-compat alias.

// Plan definitions - canonical source of truth for pricing display.
export const PLAN_LIMITS = {
  free:             { label: "Free",                          studyCredits: 0,     maxAnalysts: 1,     price: "$0" },
  per_study:        { label: "Per Study",                     studyCredits: 1,     maxAnalysts: 1,     price: "$25/study" },
  waived:           { label: "Clinic",                        studyCredits: 99999, maxAnalysts: 2,     price: "$999/yr" },
  community:        { label: "Community",                     studyCredits: 99999, maxAnalysts: 5,     price: "$2,125/yr" },
  hospital:         { label: "Hospital",                      studyCredits: 99999, maxAnalysts: 15,    price: "$4,995/yr" },
  large_hospital:   { label: "System",                        studyCredits: 99999, maxAnalysts: 99999, price: "Custom" },
  veritacheck_only: { label: "VeritaCheck\u2122 Unlimited",   studyCredits: 99999, maxAnalysts: 1,     price: "$299 first year, $499/yr after" },
} as const;

// Legacy band-based seat pricing array. Preserved for back-compat with the
// legacy getSeatPrice() function. NEW callsites should call
// getSeatPriceForTier(plan) which uses the tier-indexed map above.
export const SEAT_PRICING = [
  { min: 2,  max: 5,  pricePerSeat: 199, priceId: LEGACY_SEAT_PRICES.seats_2_5 },
  { min: 6,  max: 10, pricePerSeat: 179, priceId: LEGACY_SEAT_PRICES.seats_6_10 },
  { min: 11, max: 25, pricePerSeat: 159, priceId: LEGACY_SEAT_PRICES.seats_11_25 },
  { min: 26, max: 999, pricePerSeat: 139, priceId: LEGACY_SEAT_PRICES.seats_26 },
];

// Tier-indexed lookup. USE THIS in new checkout flows. Pass the customer's
// selected tier (waived | community | hospital); returns the per-seat
// rate + Stripe price ID for that tier's add-on seat product.
export function getSeatPriceForTier(plan: string): { pricePerSeat: number; priceId: string } | null {
  return SEAT_PRICES_BY_TIER[plan] ?? null;
}

// Legacy band-based lookup. Preserved only so existing callers don't break
// during incremental migration; new code MUST call getSeatPriceForTier.
export function getSeatPrice(totalSeats: number): { pricePerSeat: number; priceId: string } | null {
  if (totalSeats <= 1) return null;
  const tier = SEAT_PRICING.find(t => totalSeats >= t.min && totalSeats <= t.max);
  return tier ? { pricePerSeat: tier.pricePerSeat, priceId: tier.priceId } : SEAT_PRICING[SEAT_PRICING.length - 1];
}

export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

export const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.veritaslabservices.com";
