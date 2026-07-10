// scripts/verify-stripe-display-prices.mjs
//
// Receipt for the stale-display-price cleanup (2026-07-10). The live Stripe
// verification found the CHARGE path is correct (MEDIUM), but several DISPLAY /
// analytics maps still held the retired 2025 prices ($499/$999/$1,999). This
// fixes the self-serve tiers to MEDIUM and relabels the System tier, while
// intentionally leaving the grandfathered Enterprise $2,999 price where existing
// subscribers rely on it (PRICES.large_hospital + the GA4 large_hospital entry).
//
//   node scripts/verify-stripe-display-prices.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

const acct = read("client/src/pages/AccountSettingsPage.tsx");
const login = read("client/src/pages/LoginPage.tsx");
const routes = read("server/routes.ts");
const stripe = read("server/stripe.ts");

// GA4 begin_checkout values -> MEDIUM for self-serve tiers
ok("GA4 Clinic = 999",   /waived:\s*\{ item_name: "Clinic",\s*price: 999 \}/.test(acct));
ok("GA4 Community = 2125", /community:\s*\{ item_name: "Community",\s*price: 2125 \}/.test(acct));
ok("GA4 Hospital = 4995", /hospital:\s*\{ item_name: "Hospital",\s*price: 4995 \}/.test(acct));
ok("GA4 large_hospital 2999 intentionally kept (grandfathered Enterprise)", /large_hospital:\s*\{ item_name: "Enterprise",\s*price: 2999 \}/.test(acct));

// LoginPage signup tier picker
ok("LoginPage Clinic = 999",   /id: "clinic",[^\n]*price: 999,/.test(login));
ok("LoginPage Community = 2125", /id: "community",[^\n]*price: 2125,/.test(login));
ok("LoginPage Hospital = 4995",  /id: "hospital",[^\n]*price: 4995,/.test(login));
ok("LoginPage 4th tier relabeled System (custom)", /id: "enterprise", label: "System",\s*price: 0,/.test(login));

// routes.ts label + base_price + upsell
ok("PLAN_DISPLAY_NAMES large_hospital = System", /large_hospital: "System",/.test(routes));
ok("base_price Clinic 999 / Hospital 4995 / Community 2125 / System 0",
  /tier = "waived";\s*\r?\n\s*base_price = 999;/.test(routes) &&
  /tier = "hospital";\s*\r?\n\s*base_price = 4995;/.test(routes) &&
  /tier = "community";\s*\r?\n\s*base_price = 2125;/.test(routes) &&
  /tier = "large_hospital";\s*\r?\n\s*base_price = 0;/.test(routes));
ok("seat-limit upsell -> Community 2125 / Hospital 4995, no Enterprise 2999",
  /label: "Community", price: 2125/.test(routes) && /label: "Hospital", price: 4995/.test(routes) &&
  !/label: "Enterprise", price: 2999/.test(routes));

// No stale self-serve prices remain in the touched display sites
ok("no stale 499 / 1999 self-serve display price left",
  !/price: 499\b/.test(acct + login) && !/base_price = 499\b/.test(routes) &&
  !/price: 1999\b/.test(acct + login) && !/base_price = 1999\b/.test(routes));

// Charge path untouched: grandfathered Enterprise price preserved for existing subs
ok("PRICES.large_hospital preserved (grandfathered Enterprise; NOT removed)",
  /large_hospital:\s*"price_1TKiEg5dn6rqLgIxZ9ktBavQ"/.test(stripe));

console.log(fails === 0 ? "\n=== STALE DISPLAY PRICES: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
