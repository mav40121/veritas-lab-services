import Stripe from "stripe";

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || "";

export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2025-02-24.acacia" })
  : null;

export const PRICES = {
  perStudy: process.env.STRIPE_PER_STUDY_PRICE_ID || "price_1TF58r9RRQb4lVw2VfbKhic8",
  annual: process.env.STRIPE_ANNUAL_PRICE_ID || "price_1TF58r9RRQb4lVw2chljaGYk",
};

export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_QEEjv2dFlbW2fGz8AEf2w1Fcc3JWkmqZ";

export const FRONTEND_URL = process.env.FRONTEND_URL || "https://www.perplexity.ai";
