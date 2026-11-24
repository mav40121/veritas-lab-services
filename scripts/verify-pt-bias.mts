// scripts/verify-pt-bias.mts
//
// Math receipt for shared/ptBias.ts (B11, 2026-11-24): difference, percent difference, SDI, the program's range on the same scale,
// and the two review flags, on numbers worked out by hand. Run: npx tsx scripts/verify-pt-bias.mts
import { PT_FLAG_RULES, ptBias, ptEventRuns, ptOneSide, ptSameEventFlag } from "../shared/ptBias";

let failures = 0;
const check = (name: string, cond: boolean, detail: unknown = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  :: ${JSON.stringify(detail)}`}`); if (!cond) failures++; };
const R = (your_result: any, peer_mean: any, peer_sd: any = null, acceptable_low: any = null, acceptable_high: any = null) => ptBias({ your_result, peer_mean, peer_sd, acceptable_low, acceptable_high });

// Glucose 98 against 95, SD 3, range 85 to 105
let b = R(98, 95, 3, 85, 105);
check("98 against 95 (SD 3): +3, +3.16%, SDI 1.00", b.difference === 3 && b.percent === 3.16 && b.sdi === 1 && b.side === "above", b);
check("its range 85 to 105 is -10.53% to +10.53% and -3.33 to +3.33 SDI", b.range_percent[0] === -10.53 && b.range_percent[1] === 10.53 && b.range_sdi[0] === -3.33 && b.range_sdi[1] === 3.33, b);
b = R(110, 96, 3);
check("110 against 96 (SD 3): +14, +14.58%, SDI 4.67; no range entered, none given", b.difference === 14 && b.percent === 14.58 && b.sdi === 4.67 && b.range_percent[0] === null && b.range_sdi[1] === null, b);
b = R(4.0, 4.1, 0.05);
check("4.0 against 4.1 (SD 0.05): -0.1, -2.44%, SDI -2.00, with no binary noise", b.difference === -0.1 && b.percent === -2.44 && b.sdi === -2 && b.side === "below", b);
check("the SDI is the one VeritaPT has always stored", [[98, 95, 3], [6.8, 6.7, 0.2], [1.02, 1, 0.05], [110, 96, 3]].every(([x, m, s]) => R(x, m, s).sdi === Math.round(((x - m) / s) * 100) / 100));

// What is missing stays missing
for (const [what, r] of [["no peer mean", R(98, null, 3)], ["no result", R(null, 95, 3)], ["neither", R(null, null)]] as const) check(`${what}: nothing is worked out, and nothing is zero`, Object.entries(r).every(([k, v]) => k.startsWith("range") ? (v as any[]).every((x) => x === null) : v === null), r);
b = R(98, 95, null, 85, 105);
check("no SD: difference and percent, no SDI", b.difference === 3 && b.percent === 3.16 && b.sdi === null && b.range_sdi[0] === null && b.range_percent[0] === -10.53, b);
check("an SD of 0 or below gives no SDI", R(98, 95, 0).sdi === null && R(98, 95, -1).sdi === null);
b = R(0.4, 0, 0.2);
check("a peer mean of 0: a difference and an SDI, no percent", b.difference === 0.4 && b.percent === null && b.sdi === 2 && b.side === "above", b);
b = R(-3, -2, 0.5);
check("a negative mean (base excess): below is below, -50%, SDI -2", b.difference === -1 && b.percent === -50 && b.sdi === -2 && b.side === "below", b);
check("a result on the mean is on neither side, and its difference is a real zero", R(95, 95, 3).side === "on" && R(95, 95, 3).difference === 0 && Object.is(R(95, 95, 3).percent, 0) && R(95, 95, 3).sdi === 0);
check("one end of a range entered: that end only", R(98, 95, 3, 85, null).range_percent[0] === -10.53 && R(98, 95, 3, 85, null).range_percent[1] === null);

// Same event
const S = (...sides: any[]) => sides.map((side) => ({ side }));
check("three above: a flag with its count", JSON.stringify(ptSameEventFlag(S("above", "above", "above"))) === '{"side":"above","count":3}');
check("two above: none", ptSameEventFlag(S("above", "above")) === null);
check("three on one side and one with no peer data: the three count", ptSameEventFlag(S("below", null, "below", "below"))?.count === 3);
check("two on one side and one with no peer data: none", ptSameEventFlag(S("below", null, "below")) === null);
check("both sides, or one on the mean: none", ptSameEventFlag(S("above", "above", "below")) === null && ptSameEventFlag(S("above", "above", "on", "above")) === null);
check("no peer data at all: none", ptSameEventFlag(S(null, null, null)) === null && ptOneSide([]) === null);

// Three events
const E = (...events: any[][]) => events.map((sides, i) => ({ i, results: S(...sides) }));
const runs = (...events: any[][]) => ptEventRuns(E(...events)).map((r) => `${r.side}:${r.events.map((e) => e.i).join("-")}`).join();
check("three in a row", runs(["above"], ["above"], ["above"]) === "above:0-1-2");
check("two in a row: none", runs(["above"], ["above"], ["below"]) === "");
check("four is one run of four", runs(["below"], ["below"], ["below"], ["below"]) === "below:0-1-2-3");
check("an event with no peer data isn't in the run and doesn't break it", runs(["above"], [null], ["above"], ["above"]) === "above:0-2-3");
check("an event on both sides, or on the mean, breaks it", runs(["above"], ["above"], ["above", "below"], ["above"], ["above"]) === "" && runs(["above"], ["above"], ["on"], ["above"]) === "");
check("an event with several results counts when they are all on one side", runs(["above", "above"], ["above"], ["above", null]) === "above:0-1-2");
check("two separate runs", runs(["above"], ["above"], ["above"], ["below"], ["below"], ["below"]) === "above:0-1-2,below:3-4-5");
check("the rules say flag for review, never biased or unacceptable", Object.values(PT_FLAG_RULES).every((t) => t.startsWith("Flag for review") && !/biased|unacceptable/i.test(t)));

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
