import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2025-02-24.acacia" })
  : null;

export const PRICES = {
  perStudy: process.env.STRIPE_PER_STUDY_PRICE_ID || "price_1TF58r9RRQb4lVw2VfbKhic8",
  annual:   process.env.STRIPE_ANNUAL_PRICE_ID   || "price_1TF58r9RRQb4lVw2chljaGYk",
  lab:      process.env.STRIPE_LAB_PRICE_ID      || "price_1TFRl19RRQb4lVw2KdK8v7TT",
};

// Plan definitions — used across routes and frontend
export const PLAN_LIMITS = {
  free:    { label: "Free",         studyCredits: 0,     maxAnalysts: 1,  price: "$0" },
  perStudy:{ label: "Per Study",    studyCredits: 1,     maxAnalysts: 1,  price: "$9/study" },
  annual:  { label: "Individual",   studyCredits: 99999, maxAnalysts: 1,  price: "$149/yr" },
  lab:     { label: "Lab Account",  studyCredits: 99999, maxAnalysts: 5,  price: "$499/yr" },
} as const;

export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_QEEjv2dFlbW2fGz8AEf2w1Fcc3JWkmqZ";

export const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.veritaslabservices.com";
