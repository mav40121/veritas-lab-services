// scripts/verify-consumption-burn.js
//
// Math receipt for Keystone Layer-2 Phase 2: learned burn + actual-vs-estimated
// turns/days-on-hand. Mirrors the consumption-summary endpoint + the client
// tile logic exactly. Proves: learned burn = window consumption / window days;
// the >= N-events threshold flips a location from "estimated" to "actual"; and
// the turns/days numbers recompute off the chosen daily-consumption-value basis.
//
//   node scripts/verify-consumption-burn.js

const ACTUAL_THRESHOLD = 5; // must match server/routes.ts consumption-summary

// --- mirrors the server summary aggregation -----------------------------------
function summarize(events, windowDays) {
  const perItem = {};
  let eventCount = 0, totalValue = 0;
  for (const ev of events) {
    eventCount++;
    totalValue += ev.qty * (ev.unit_cost || 0);
    const pi = perItem[ev.item_id] || { events: 0, qty: 0, value: 0 };
    pi.events++; pi.qty += ev.qty; pi.value += ev.qty * (ev.unit_cost || 0);
    perItem[ev.item_id] = pi;
  }
  for (const k of Object.keys(perItem)) perItem[k].learned_burn = round2(perItem[k].qty / windowDays);
  return {
    window_days: windowDays,
    event_count: eventCount,
    is_actual: eventCount >= ACTUAL_THRESHOLD,
    actual_daily_value: round2(totalValue / windowDays),
    per_item: perItem,
  };
}
const round2 = (n) => Math.round(n * 100) / 100;

// --- mirrors the client tile pick (actual when is_actual, else estimate) ------
function turnsTile(summary, valueOnHand, estimateDailyValue) {
  const useActual = !!(summary.is_actual && summary.actual_daily_value > 0);
  const dailyVal = useActual ? summary.actual_daily_value : estimateDailyValue;
  if (!(dailyVal > 0) || !(valueOnHand > 0)) return null;
  return {
    basis: useActual ? "actual" : "estimated",
    turns: Number(((dailyVal * 365) / valueOnHand).toFixed(1)),
    days: Math.round(valueOnHand / dailyVal),
  };
}

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

// --- learned burn = window consumption / window days --------------------------
// Item 1: 120 units consumed over 60 days -> 2/day.
const s1 = summarize([
  { item_id: 1, qty: 40, unit_cost: 0.85 },
  { item_id: 1, qty: 40, unit_cost: 0.85 },
  { item_id: 1, qty: 40, unit_cost: 0.85 },
  { item_id: 2, qty: 30, unit_cost: 7.2 },
  { item_id: 2, qty: 30, unit_cost: 7.2 },
], 60);
check("learned burn item1 = 2/day (120/60)", s1.per_item[1].learned_burn, 2);
check("learned burn item2 = 1/day (60/60)", s1.per_item[2].learned_burn, 1);
check("event_count = 5", s1.event_count, 5);
check(">=5 events -> is_actual true", s1.is_actual, true);

// --- actual turns recompute ---------------------------------------------------
// actual daily value = (120*0.85 + 60*7.2)/60 = (102 + 432)/60 = 8.9/day.
check("actual_daily_value = 8.9", s1.actual_daily_value, 8.9);
const t1 = turnsTile(s1, 5000, 4.0 /* estimate */);
check("tile uses ACTUAL basis at >=5 events", t1.basis, "actual");
check("actual turns = 8.9*365/5000 = 0.6", t1.turns, Number(((8.9 * 365) / 5000).toFixed(1)));
check("actual days = 5000/8.9 = 562", t1.days, Math.round(5000 / 8.9));

// --- below threshold falls back to ESTIMATE + label ---------------------------
const s2 = summarize([
  { item_id: 1, qty: 10, unit_cost: 0.85 },
  { item_id: 1, qty: 10, unit_cost: 0.85 },
], 60); // only 2 events
check("<5 events -> is_actual false", s2.is_actual, false);
const t2 = turnsTile(s2, 5000, 4.0);
check("tile falls back to ESTIMATE basis", t2.basis, "estimated");
check("estimated turns use entered daily value (4.0)", t2.turns, Number(((4.0 * 365) / 5000).toFixed(1)));

// --- empty window -> no events, estimated, no tile when no estimate -----------
const s0 = summarize([], 60);
check("no events -> is_actual false", s0.is_actual, false);
check("no events + no estimate -> tile null", turnsTile(s0, 5000, 0), null);

// --- learned-burn correction hero (actual differs from entered estimate) ------
// 180 over 60 = 3/day learned vs an entered estimate of 2/day -> Apply corrects.
const sHero = summarize([
  { item_id: 9, qty: 60, unit_cost: 0.85 },
  { item_id: 9, qty: 60, unit_cost: 0.85 },
  { item_id: 9, qty: 60, unit_cost: 0.85 },
], 60);
check("hero learned burn = 3/day differs from entered 2", sHero.per_item[9].learned_burn !== 2 && sHero.per_item[9].learned_burn === 3, true);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
