import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2025-02-24.acacia" })
  : null;

export const PRICES = {
  perStudy:     process.env.STRIPE_PER_STUDY_PRICE_ID     || "price_1TG6eM9RRQb4lVw2273eN9LD",
  starter:      process.env.STRIPE_STARTER_PRICE_ID       || "price_1TG6eM9RRQb4lVw234JzGNsL",
  professional: process.env.STRIPE_PROFESSIONAL_PRICE_ID  || "price_1TG6eM9RRQb4lVw2NC1kLvnA",
  lab:          process.env.STRIPE_LAB_PRICE_ID           || "price_1TG6eN9RRQb4lVw2f0qNCCxb",
  complete:     process.env.STRIPE_COMPLETE_PRICE_ID      || "price_1TG6eN9RRQb4lVw2KGJkiefD",
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

export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_QEEjv2dFlbW2fGz8AEf2w1Fcc3JWkmqZ";

export const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.veritaslabservices.com";
