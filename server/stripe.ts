import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";

if (!stripeSecretKey) {
  console.warn("[Stripe] STRIPE_SECRET_KEY is not set - Stripe payments will be disabled");
}

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2026-03-25.dahlia" as any })
  : null;

// New tiered pricing - base plans (annual)
export const PRICES = {
  perStudy:        "price_1TGXPo5dn6rqLgIxsnvNa2oi",   // $25 one-time
  waived:          "price_1TGXPl5dn6rqLgIx14yANdxj",   // $499/yr
  community:       "price_1TKiEg5dn6rqLgIxrBKvqbGb",   // $999/yr  (was $799 -- grandfathered)
  hospital:        "price_1TKiEg5dn6rqLgIxXioYyC5u",   // $1,999/yr (was $1,299 -- grandfathered)
  large_hospital:  "price_1TKiEg5dn6rqLgIxZ9ktBavQ",   // $2,999/yr (was $1,999 -- grandfathered)
  veritacheck_only: "price_1TGXPn5dn6rqLgIxfyoLXVKo",  // $299/yr
};

// Per-seat add-on prices (annual, per seat)
export const SEAT_PRICES = {
  seats_2_5:   "price_1TGXPn5dn6rqLgIxdrreE5X4",   // $199/seat
  seats_6_10:  "price_1TGXPn5dn6rqLgIxEhLz7fmK",   // $179/seat
  seats_11_25: "price_1TGXPn5dn6rqLgIxtsRXHf80",   // $159/seat
  seats_26:    "price_1TGXPo5dn6rqLgIxo3Fj2Llr",   // $139/seat
};

// Plan definitions - canonical source of truth for pricing
export const PLAN_LIMITS = {
  free:             { label: "Free",                 studyCredits: 0,     maxAnalysts: 1,   price: "$0" },
  per_study:        { label: "Per Study",            studyCredits: 1,     maxAnalysts: 1,   price: "$25/study" },
  waived:           { label: "Waived",               studyCredits: 99999, maxAnalysts: 1,   price: "$499/yr" },
  community:        { label: "Community",            studyCredits: 99999, maxAnalysts: 10,  price: "$799/yr" },
  hospital:         { label: "Hospital",             studyCredits: 99999, maxAnalysts: 25,  price: "$1,299/yr" },
  large_hospital:   { label: "Large Hospital",       studyCredits: 99999, maxAnalysts: 50,  price: "$1,999/yr" },
  veritacheck_only: { label: "VeritaCheck\u2122 Unlimited", studyCredits: 99999, maxAnalysts: 1,   price: "$299/yr" },
} as const;

// Seat pricing tiers
export const SEAT_PRICING = [
  { min: 2,  max: 5,  pricePerSeat: 199, priceId: SEAT_PRICES.seats_2_5 },
  { min: 6,  max: 10, pricePerSeat: 179, priceId: SEAT_PRICES.seats_6_10 },
  { min: 11, max: 25, pricePerSeat: 159, priceId: SEAT_PRICES.seats_11_25 },
  { min: 26, max: 999, pricePerSeat: 139, priceId: SEAT_PRICES.seats_26 },
];

export function getSeatPrice(totalSeats: number): { pricePerSeat: number; priceId: string } | null {
  if (totalSeats <= 1) return null;
  const tier = SEAT_PRICING.find(t => totalSeats >= t.min && totalSeats <= t.max);
  return tier ? { pricePerSeat: tier.pricePerSeat, priceId: tier.priceId } : SEAT_PRICING[SEAT_PRICING.length - 1];
}

export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

export const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.veritaslabservices.com";
