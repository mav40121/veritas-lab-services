#!/usr/bin/env node
/**
 * create-medium-stripe-prices.js
 *
 * One-time script to create the Stripe Prices + Coupon required for the
 * MEDIUM pricing scenario (CLAUDE.md §10 update 2026-05-23).
 *
 * Uses the Stripe REST API directly via fetch (no SDK dependency, runs with
 * zero npm install).
 *
 * Creates:
 *   1. Clinic base                $999/yr   (recurring annual)
 *   2. Community base             $2,125/yr (recurring annual)
 *   3. Hospital base              $4,995/yr (recurring annual)
 *   4. Additional seat (Clinic)   $500/seat/yr
 *   5. Additional seat (Community)$425/seat/yr
 *   6. Additional seat (Hospital) $333/seat/yr
 *   7. VC Unlimited base          $499/yr   (Y2+ renewal price)
 *   8. Coupon VCFIRSTYEAR         $200 off once
 *
 * Existing base-price Products are looked up via API and reused; 3 new
 * Products are created for the tier-indexed seat lines.
 *
 * Run with:
 *   STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY node scripts/create-medium-stripe-prices.js
 *
 * Bash wrapper (CLAUDE.md §12 CREDENTIAL HANDLING):
 *   RAILWAY_TOKEN=<bootstrap_token>
 *   STRIPE_SECRET_KEY=$(curl -s -X POST https://backboard.railway.com/graphql/v2 \
 *     -H "Authorization: Bearer $RAILWAY_TOKEN" -H "Content-Type: application/json" \
 *     -d '{"query":"query { variables(projectId: \"...\", environmentId: \"...\", serviceId: \"...\") }"}' \
 *     | python -c "import sys,json; print(json.load(sys.stdin)['data']['variables']['STRIPE_SECRET_KEY'])")
 *   STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY node scripts/create-medium-stripe-prices.js
 *   unset STRIPE_SECRET_KEY RAILWAY_TOKEN
 */

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error("STRIPE_SECRET_KEY env var not set. See header comment.");
  process.exit(1);
}

const STRIPE_API = "https://api.stripe.com/v1";

function formEncode(obj, prefix = "") {
  const pairs = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const k = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === "object" && !Array.isArray(value)) {
      pairs.push(formEncode(value, k));
    } else {
      pairs.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(value))}`);
    }
  }
  return pairs.join("&");
}

async function stripeCall(method, path, body) {
  const url = `${STRIPE_API}${path}`;
  const init = {
    method,
    headers: {
      "Authorization": `Bearer ${stripeKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (body) init.body = formEncode(body);
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Stripe ${method} ${path} failed: ${res.status} ${text}`);
  }
  return JSON.parse(text);
}

const EXISTING_BASE_PRICES = {
  veritacheck_unlimited: "price_1TGXPn5dn6rqLgIxfyoLXVKo",
  clinic:                "price_1TGXPl5dn6rqLgIx14yANdxj",
  community:             "price_1TKiEg5dn6rqLgIxrBKvqbGb",
  hospital:              "price_1TKiEg5dn6rqLgIxXioYyC5u",
};

async function getProductId(priceId) {
  const price = await stripeCall("GET", `/prices/${priceId}`);
  const productRef = typeof price.product === "string" ? price.product : price.product?.id;
  if (!productRef) throw new Error(`Could not resolve product for ${priceId}`);
  return productRef;
}

async function createBasePrice(productId, unitAmount, nickname) {
  const price = await stripeCall("POST", "/prices", {
    product: productId,
    unit_amount: unitAmount,
    currency: "usd",
    "recurring[interval]": "year",
    nickname,
    "metadata[created_by]": "create-medium-stripe-prices.js",
    "metadata[created_at]": new Date().toISOString(),
  });
  return price.id;
}

async function createSeatProductAndPrice(tierLabel, unitAmount) {
  const product = await stripeCall("POST", "/products", {
    name: `VeritaAssure Additional Seat - ${tierLabel} tier`,
    description: `Additional active seat priced at the ${tierLabel} tier per-seat rate. Tier-indexed model (MEDIUM scenario, 2026-05-23).`,
    "metadata[tier]": tierLabel.toLowerCase(),
    "metadata[created_by]": "create-medium-stripe-prices.js",
  });
  const price = await stripeCall("POST", "/prices", {
    product: product.id,
    unit_amount: unitAmount,
    currency: "usd",
    "recurring[interval]": "year",
    nickname: `${tierLabel} additional seat $${unitAmount / 100}/seat/yr`,
    "metadata[created_by]": "create-medium-stripe-prices.js",
    "metadata[created_at]": new Date().toISOString(),
  });
  return { productId: product.id, priceId: price.id };
}

async function createVcFirstYearCoupon() {
  const coupon = await stripeCall("POST", "/coupons", {
    id: "VCFIRSTYEAR",
    amount_off: 20000,
    currency: "usd",
    duration: "once",
    name: "VC Unlimited Year 1 Discount",
    "metadata[created_by]": "create-medium-stripe-prices.js",
    "metadata[purpose]": "Y1 = $299, Y2+ = $499",
  });
  return coupon.id;
}

(async () => {
  console.log("=== Resolving existing Stripe Products ===");
  const productIds = {};
  for (const [tier, priceId] of Object.entries(EXISTING_BASE_PRICES)) {
    productIds[tier] = await getProductId(priceId);
    console.log(`  ${tier.padEnd(22)} -> product ${productIds[tier]}`);
  }

  console.log("\n=== Creating MEDIUM base prices ===");
  const clinicId = await createBasePrice(productIds.clinic, 99900, "Clinic MEDIUM $999/yr (created 2026-05-23)");
  console.log(`  clinic           $999/yr   -> ${clinicId}`);
  const communityId = await createBasePrice(productIds.community, 212500, "Community MEDIUM $2,125/yr (created 2026-05-23)");
  console.log(`  community        $2,125/yr -> ${communityId}`);
  const hospitalId = await createBasePrice(productIds.hospital, 499500, "Hospital MEDIUM $4,995/yr (created 2026-05-23)");
  console.log(`  hospital         $4,995/yr -> ${hospitalId}`);
  const vcUnlimitedId = await createBasePrice(productIds.veritacheck_unlimited, 49900, "VC Unlimited MEDIUM $499/yr base, Y2+ renewal (created 2026-05-23)");
  console.log(`  vc_unlimited     $499/yr   -> ${vcUnlimitedId}`);

  console.log("\n=== Creating tier-indexed additional-seat Products + Prices ===");
  const clinicSeat = await createSeatProductAndPrice("Clinic", 50000);
  console.log(`  Clinic seat      $500/seat -> price ${clinicSeat.priceId} / product ${clinicSeat.productId}`);
  const communitySeat = await createSeatProductAndPrice("Community", 42500);
  console.log(`  Community seat   $425/seat -> price ${communitySeat.priceId} / product ${communitySeat.productId}`);
  const hospitalSeat = await createSeatProductAndPrice("Hospital", 33300);
  console.log(`  Hospital seat    $333/seat -> price ${hospitalSeat.priceId} / product ${hospitalSeat.productId}`);

  console.log("\n=== Creating VCFIRSTYEAR coupon ===");
  const couponId = await createVcFirstYearCoupon();
  console.log(`  coupon id        -> ${couponId}`);

  console.log("\n=== Summary (paste into server/stripe.ts) ===");
  console.log(`PRICES.waived            = "${clinicId}";          // Clinic $999/yr`);
  console.log(`PRICES.community         = "${communityId}";       // Community $2,125/yr`);
  console.log(`PRICES.hospital          = "${hospitalId}";        // Hospital $4,995/yr`);
  console.log(`PRICES.veritacheck_only  = "${vcUnlimitedId}";     // VC Unlimited $499/yr base (Y1 discounted via VCFIRSTYEAR)`);
  console.log(`SEAT_PRICES_BY_TIER.clinic    = "${clinicSeat.priceId}";    // $500/seat/yr`);
  console.log(`SEAT_PRICES_BY_TIER.community = "${communitySeat.priceId}"; // $425/seat/yr`);
  console.log(`SEAT_PRICES_BY_TIER.hospital  = "${hospitalSeat.priceId}";  // $333/seat/yr`);
  console.log(`COUPON                   = "${couponId}";          // Auto-apply at VC Unlimited checkout`);
})().catch((err) => {
  console.error("ERROR:", err.message || err);
  process.exit(1);
});
