import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";

if (!stripeSecretKey) {
  console.warn("[Stripe] STRIPE_SECRET_KEY is not set — Stripe payments will be disabled");
}

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2025-02-24.acacia" })
  : null;

export const PRICES = {
  perStudy:     process.env.STRIPE_PRICE_PER_STUDY     || "",
  starter:      process.env.STRIPE_PRICE_STARTER       || "",
  professional: process.env.STRIPE_PRICE_PROFESSIONAL  || "",
  lab:          process.env.STRIPE_PRICE_LAB           || "",
  complete:     process.env.STRIPE_PRICE_COMPLETE      || "",
};

// Plan definitions — used across routes and frontend
export const PLAN_LIMITS = {
  free:         { label: "Free",                 studyCredits: 0,     maxAnalysts: 1,   price: "$0" },
  per_study:    { label: "Per Study",            studyCredits: 1,     maxAnalysts: 1,   price: "$25/study" },
  starter:      { label: "Starter",              studyCredits: 99999, maxAnalysts: 1,   price: "$299/yr" },
  professional: { label: "Professional",         studyCredits: 99999, maxAnalysts: 1,   price: "$599/yr" },
  lab:          { label: "Lab",                  studyCredits: 99999, maxAnalysts: 10,  price: "$2,499/yr" },
  complete:     { label: "VeritaAssure Complete", studyCredits: 99999, maxAnalysts: 10,  price: "$3,999/yr" },
} as const;

export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

export const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.veritaslabservices.com";
