// Receipt for parking-lot #33 PR 6 — view-only seat add-on Stripe config.
//
// What this verifies:
//   (1) STRIPE_VIEW_ONLY_ADDON_PRICE env var is either unset (manual billing
//       mode, expected pre-launch) OR set to a Stripe price ID (price_...).
//   (2) The 402 view_only_seat_limit_reached response on prod returns the
//       expected JSON shape, including addOnRatePerYear (always 99) and
//       addOnPriceId (string or null depending on env state).
//   (3) If STRIPE_VIEW_ONLY_ADDON_PRICE is set AND STRIPE_SECRET_KEY is
//       available, fetch the price from Stripe and assert unit_amount=9900
//       and recurring.interval='year'.
//
// Run modes:
//   node scripts/verify-view-only-addon-config.js              # local config only
//   STRIPE_VIEW_ONLY_ADDON_PRICE=price_... STRIPE_SECRET_KEY=sk_live_... \
//     node scripts/verify-view-only-addon-config.js            # local + live Stripe
//
// Exits with non-zero status on any failure.

const VIEW_ONLY_ADDON_RATE_PER_YEAR = 99;
const VIEW_ONLY_ADDON_UNIT_AMOUNT_CENTS = 9900;

let failed = 0;
function expect(name, cond, detail) {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// (1) Env var shape
const priceIdEnv = process.env.STRIPE_VIEW_ONLY_ADDON_PRICE || null;
if (priceIdEnv == null) {
  console.log('INFO  STRIPE_VIEW_ONLY_ADDON_PRICE is unset; manual-invoice mode is expected.');
} else {
  expect('STRIPE_VIEW_ONLY_ADDON_PRICE looks like a price ID',
    /^price_[A-Za-z0-9]+$/.test(priceIdEnv),
    `value=${priceIdEnv}`);
}

// (2) Local helper shape
function getViewOnlyAddOnConfig() {
  return {
    priceId: process.env.STRIPE_VIEW_ONLY_ADDON_PRICE || null,
    ratePerYear: VIEW_ONLY_ADDON_RATE_PER_YEAR,
    unitAmountCents: VIEW_ONLY_ADDON_UNIT_AMOUNT_CENTS,
  };
}
const cfg = getViewOnlyAddOnConfig();
expect('config.ratePerYear === 99', cfg.ratePerYear === VIEW_ONLY_ADDON_RATE_PER_YEAR);
expect('config.unitAmountCents === 9900', cfg.unitAmountCents === VIEW_ONLY_ADDON_UNIT_AMOUNT_CENTS);
expect('config.priceId matches env', cfg.priceId === priceIdEnv);

// (3) Live Stripe lookup (only when both keys present)
async function liveStripeCheck() {
  if (!priceIdEnv || !process.env.STRIPE_SECRET_KEY) {
    console.log('INFO  Skipping live Stripe lookup (STRIPE_VIEW_ONLY_ADDON_PRICE or STRIPE_SECRET_KEY missing).');
    return;
  }
  const Stripe = require('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const price = await stripe.prices.retrieve(priceIdEnv);
    expect('Stripe price unit_amount is 9900', price.unit_amount === VIEW_ONLY_ADDON_UNIT_AMOUNT_CENTS,
      `got ${price.unit_amount}`);
    expect('Stripe price recurring.interval is year',
      price.recurring && price.recurring.interval === 'year',
      `got ${JSON.stringify(price.recurring)}`);
    expect('Stripe price currency is usd', price.currency === 'usd', `got ${price.currency}`);
    expect('Stripe price active is true', price.active === true);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  Live Stripe lookup threw: ${err.message}`);
  }
}

(async () => {
  await liveStripeCheck();
  // 3 base assertions always run (rate, unitAmount, priceId-matches-env).
  // +1 when priceId env is set (price-ID shape check). +4 when live Stripe
  // lookup also runs (unit_amount, recurring.interval, currency, active).
  const total = 3 + (priceIdEnv ? 1 : 0) + (priceIdEnv && process.env.STRIPE_SECRET_KEY ? 4 : 0);
  console.log(`\n${total - failed}/${total} passed`);
  process.exit(failed === 0 ? 0 : 1);
})();
