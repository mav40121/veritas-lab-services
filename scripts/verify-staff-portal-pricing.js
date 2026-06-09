// scripts/verify-staff-portal-pricing.js
//
// Receipt for the Staff Portal pricing structure locked 2026-06-08.
// Exercises getStaffPortalBand on the boundary staff counts and asserts
// the band selection. Also computes the COPC quote ($2,272 with COLA2026
// at 10%) end to end and confirms it matches the email sent to Stephanie.
//
// Run: node scripts/verify-staff-portal-pricing.js
// Exit 0 on PASS, 1 on any FAIL.

// Inline ports of the helpers in server/stripe.ts (kept here so the
// script runs without the TS compile step).
const STAFF_PORTAL_BANDS = {
  small:  { maxStaff: 25,  ratePerYear: 149 },
  medium: { maxStaff: 100, ratePerYear: 399 },
  large:  { maxStaff: 250, ratePerYear: 799 },
};

function getStaffPortalBand(staffCount) {
  if (!Number.isFinite(staffCount) || staffCount <= 0) return "small";
  if (staffCount <= STAFF_PORTAL_BANDS.small.maxStaff)  return "small";
  if (staffCount <= STAFF_PORTAL_BANDS.medium.maxStaff) return "medium";
  if (staffCount <= STAFF_PORTAL_BANDS.large.maxStaff)  return "large";
  return null;
}

function rateFor(staffCount) {
  const band = getStaffPortalBand(staffCount);
  return band === null ? null : STAFF_PORTAL_BANDS[band].ratePerYear;
}

let pass = 0, fail = 0;
function assert(label, cond, hint) {
  if (cond) { console.log("PASS  " + label); pass++; }
  else      { console.log("FAIL  " + label + (hint ? "  -- " + hint : "")); fail++; }
}

// ── Band selection by staff count ───────────────────────────────────────

assert("0 staff (edge) -> Small",  getStaffPortalBand(0) === "small");
assert("1 staff -> Small",         getStaffPortalBand(1) === "small");
assert("25 staff (band ceiling) -> Small",  getStaffPortalBand(25) === "small");
assert("26 staff -> Medium",       getStaffPortalBand(26) === "medium");
assert("75 staff (COPC) -> Medium", getStaffPortalBand(75) === "medium");
assert("100 staff (band ceiling) -> Medium", getStaffPortalBand(100) === "medium");
assert("101 staff -> Large",       getStaffPortalBand(101) === "large");
assert("250 staff (band ceiling) -> Large", getStaffPortalBand(250) === "large");
assert("251 staff -> null (System tier)", getStaffPortalBand(251) === null);
assert("1000 staff -> null (System tier)", getStaffPortalBand(1000) === null);

// ── Rate selection ──────────────────────────────────────────────────────

assert("Small rate = $149", rateFor(25) === 149);
assert("Medium rate = $399", rateFor(100) === 399);
assert("Large rate = $799", rateFor(250) === 799);
assert("Above-Large rate = null", rateFor(300) === null);

// ── COPC end-to-end quote math ──────────────────────────────────────────
// Stephanie's 75-staff lab at Community tier, with COLA2026 10% discount.
// Email sent: "approximately $2,272/yr"

const communityBase = 2125;
const staffPortal = rateFor(75);
const subtotal = communityBase + staffPortal;
const colaDiscount = Math.round(subtotal * 0.10);
const total = subtotal - colaDiscount;

assert("COPC staff portal lands at Medium ($399)", staffPortal === 399);
assert("COPC subtotal = $2,524", subtotal === 2524);
assert("COLA2026 discount = ~$252", colaDiscount === 252);
assert("COPC total = ~$2,272 (matches email)", total === 2272);

// ── Sanity: vs MediaLab cost ─────────────────────────────────────────────

const mediaLabPerUser = 41.30;
const copcMediaLabCost = 75 * mediaLabPerUser;
const savingsVsMediaLab = copcMediaLabCost + 1730 + 1250 - total; // EP eval + Inspection Proof + total
assert("COPC saves over $3,800/yr vs MediaLab+evaluator stack",
  savingsVsMediaLab > 3800,
  `actual savings: $${savingsVsMediaLab.toFixed(2)}`);

// ── % of base tier sanity ───────────────────────────────────────────────

const clinicBase = 999, hospitalBase = 4995;
assert("Small band is 14-19% of Clinic tier",
  (149 / clinicBase) >= 0.14 && (149 / clinicBase) <= 0.19,
  `${((149 / clinicBase) * 100).toFixed(1)}%`);
assert("Medium band is 14-19% of Community tier",
  (399 / communityBase) >= 0.14 && (399 / communityBase) <= 0.19,
  `${((399 / communityBase) * 100).toFixed(1)}%`);
assert("Large band is 14-19% of Hospital tier",
  (799 / hospitalBase) >= 0.14 && (799 / hospitalBase) <= 0.19,
  `${((799 / hospitalBase) * 100).toFixed(1)}%`);

console.log("");
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
