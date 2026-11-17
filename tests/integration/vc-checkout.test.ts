// tests/integration/vc-checkout.test.ts
//
// BUG-173 (2026-11-17, design approved by Michael "1"): a comped VeritaCheck® Unlimited lab (plan set by hand, no card
// subscription) had no screen that reached VeritaCheck Unlimited checkout, and the server would have taken a second
// checkout for a lab that already pays by card, or a seat user's checkout onto their employer's lab (the webhook writes
// plan = priceType to whichever lab metadata.labId names). Boots the REAL routes on a scratch DB with made-up people and
// labs, and NO Stripe key, so no request can reach Stripe. It checks:
//   1. the helper (server/vcCheckout.ts): refuses a lab paying by card (409 ALREADY_SUBSCRIBED, expiry ahead or blank),
//      refuses a lab the buyer doesn't own (403 NOT_LAB_OWNER: by default lab, by the lab named in the body, and by the
//      webhook's primary-lab fallback), and allows a comped Unlimited lab, a lapsed card subscription, a canceled one and
//      someone with no lab; the lab it judges is the one the route stamps on metadata.labId
//   2. GET /api/labs/me carries hasCardSubscription (true only with a subscription id and status 'active') and never the id
//   3. POST /api/stripe/checkout answers 409 and 403 for veritacheck_only before it looks for Stripe (Stripe is unset here,
//      so a check placed after the Stripe lookup would answer 503), lets a comped and a lapsed lab through to that 503,
//      leaves every other priceType alone, and writes nothing
//   4. the first year on Unlimited (follow-up, 2026-11-17): a discount code no longer replaces the $200 first-year
//      discount; the buyer gets whichever is cheaper (vcFirstYear), a code that loses isn't counted as used, and Unlimited
//      never gets a trial (vcCheckoutCoupon). The checkout route can't get that far without a Stripe client, so the route
//      is checked by reading its source for the helper call; the helper itself is tested here.
//   5. POST /api/discount/validate adds firstYearCents and appliedAs for Unlimited and keeps its other fields
// Run: npm run test:vc-checkout
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};

async function main() {
  const { stripe } = await import("../../server/stripe");
  if (stripe) {
    console.error("STRIPE_SECRET_KEY is set. This test runs with no Stripe key so nothing can reach Stripe; run it through npm run test:vc-checkout.");
    process.exit(1);
  }
  check("0. Stripe is not configured in this test, so no request can reach Stripe", stripe === null);
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { vcCheckoutRefusal, checkoutMetadataLabId, checkoutTargetLabId, hasActiveCardSubscription, vcFirstYear, vcCheckoutCoupon } = await import("../../server/vcCheckout");
  const sqlite = (db as any).$client;
  sqlite.pragma("foreign_keys = OFF");
  const cols = (t: string) => sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; dflt_value: any }[];
  const insert = (table: string, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = { ...values };
    for (const c of cols(table)) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-01-01T00:00:00Z" : /count|_id$|is_/i.test(c.name) ? 0 : "made-up";
    const keys = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
  };
  const now = new Date().toISOString();
  const days = (n: number) => new Date(Date.now() + n * 86400000).toISOString();

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, path: string, body: unknown, token: string | null) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const stamp = Date.now();
  const register = async (tag: string) => {
    const email = `vcco-${tag.toLowerCase()}-${stamp}@example.test`;
    const reg = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made-up ${tag}`, hipaa_acknowledged: true }, null);
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    return { email, id, token: reg.j.token as string };
  };
  const lab = (ownerId: number, name: string, extra: Record<string, unknown>) =>
    insert("labs", { lab_name: name, owner_user_id: ownerId, created_at: now, updated_at: now, ...extra });
  const member = (labId: number, userId: number, role: string, primary = 1) => insert("lab_members", { lab_id: labId, user_id: userId, role, permissions_json: "{}", status: "active", is_primary_lab: primary, accepted_at: now, created_at: now, updated_at: now });
  const home = (userId: number, labId: number | null) => sqlite.prepare("UPDATE users SET lab_id = ?, default_lab_id = ? WHERE id = ?").run(labId, labId, userId);

  try {
    // Made-up people and labs
    const COMP = await register("CompOwner"), CARD = await register("CardOwner"), LAPSED = await register("LapsedOwner");
    const SEAT = await register("SeatUser"), SEAT2 = await register("SeatPrimaryOnly"), NOLAB = await register("NoLab");
    check("0. six made-up accounts signed up with a session each", [COMP, CARD, LAPSED, SEAT, SEAT2, NOLAB].every((u) => u.id > 0 && !!u.token));
    for (const u of [COMP, CARD, LAPSED, SEAT, SEAT2, NOLAB]) {
      sqlite.prepare("DELETE FROM lab_members WHERE user_id = ?").run(u.id);
      home(u.id, null);
    }
    // The production shape (lab 40): Unlimited set by hand, active, expiring soon, no subscription id; the owner's own plan free.
    const labComp = lab(COMP.id, "Made-up Comped Lab", { plan: "veritacheck_only", subscription_status: "active", subscription_expires_at: days(5) });
    const labCard = lab(CARD.id, "Made-up Card Lab", { plan: "veritacheck_only", subscription_status: "active", subscription_expires_at: days(200), stripe_subscription_id: "sub_madeup_card_live" });
    const labCardOpen = lab(CARD.id, "Made-up Card Lab No Expiry", { plan: "veritacheck_only", subscription_status: "active", subscription_expires_at: null, stripe_subscription_id: "sub_madeup_card_open" });
    const labLapsed = lab(LAPSED.id, "Made-up Lapsed Lab", { plan: "veritacheck_only", subscription_status: "active", subscription_expires_at: days(-10), stripe_subscription_id: "sub_madeup_card_lapsed" });
    const labCanceled = lab(LAPSED.id, "Made-up Canceled Lab", { plan: "veritacheck_only", subscription_status: "canceled", subscription_expires_at: days(100), stripe_subscription_id: "sub_madeup_card_canceled" });
    const labBlankId = lab(LAPSED.id, "Made-up Blank Id Lab", { plan: "veritacheck_only", subscription_status: "active", subscription_expires_at: days(100), stripe_subscription_id: "  " });
    for (const u of [COMP, CARD, LAPSED]) sqlite.prepare("UPDATE users SET plan = 'free' WHERE id = ?").run(u.id);
    member(labComp, COMP.id, "owner"); home(COMP.id, labComp);
    member(labCard, CARD.id, "owner"); member(labCardOpen, CARD.id, "owner", 0); home(CARD.id, labCard);
    member(labLapsed, LAPSED.id, "owner"); member(labCanceled, LAPSED.id, "owner", 0); member(labBlankId, LAPSED.id, "owner", 0); home(LAPSED.id, labLapsed);
    // A seat user working in the comped lab (default lab there) and in the card lab; another with only a primary membership.
    member(labComp, SEAT.id, "staff"); member(labCard, SEAT.id, "staff", 0); home(SEAT.id, labComp);
    member(labComp, SEAT2.id, "staff");
    const labSnapshot = () => JSON.stringify(sqlite.prepare("SELECT id, plan, subscription_status, subscription_expires_at, stripe_subscription_id, owner_user_id FROM labs ORDER BY id").all());
    const before = labSnapshot();

    // 1. The helper
    const r = (userId: number, bodyLabId?: unknown) => vcCheckoutRefusal(sqlite, userId, bodyLabId);
    check("1. a lab paying by card is refused with 409 ALREADY_SUBSCRIBED", r(CARD.id)?.status === 409 && r(CARD.id)?.body.code === "ALREADY_SUBSCRIBED", JSON.stringify(r(CARD.id)));
    check("1. the 409 says so in words, with the registered mark", r(CARD.id)?.body.error === "This lab already has an active VeritaCheck® Unlimited subscription.", r(CARD.id)?.body.error);
    check("1. a card subscription with no expiry on file is refused too (named in the body)", r(CARD.id, labCardOpen)?.status === 409, JSON.stringify(r(CARD.id, labCardOpen)));
    check("1. a comped Unlimited lab (no subscription id) is allowed", r(COMP.id) === null, JSON.stringify(r(COMP.id)));
    check("1. a lapsed card subscription (expiry passed) is allowed", r(LAPSED.id) === null, JSON.stringify(r(LAPSED.id)));
    check("1. a canceled card subscription is allowed", r(LAPSED.id, labCanceled) === null, JSON.stringify(r(LAPSED.id, labCanceled)));
    check("1. a blank subscription id reads as none", r(LAPSED.id, labBlankId) === null && !hasActiveCardSubscription({ stripe_subscription_id: "  ", subscription_status: "active" }));
    check("1. a seat user's default lab is refused with 403 NOT_LAB_OWNER", r(SEAT.id)?.status === 403 && r(SEAT.id)?.body.code === "NOT_LAB_OWNER" && r(SEAT.id)?.body.error === "Only the lab's owner can subscribe this lab.", JSON.stringify(r(SEAT.id)));
    check("1. a seat user naming the employer's lab is refused with 403", r(SEAT.id, labComp)?.status === 403, JSON.stringify(r(SEAT.id, labComp)));
    check("1. a seat user in a lab paying by card gets 403, not 409 (ownership first, nothing about the lab's billing)", r(SEAT.id, labCard)?.status === 403, JSON.stringify(r(SEAT.id, labCard)));
    check("1. with no default lab, the webhook's primary-lab fallback is judged: a seat user there is refused", checkoutTargetLabId(sqlite, SEAT2.id, undefined) === labComp && r(SEAT2.id)?.status === 403, JSON.stringify(r(SEAT2.id)));
    check("1. someone with no lab at all is allowed", r(NOLAB.id) === null && checkoutTargetLabId(sqlite, NOLAB.id, undefined) === null);
    check("1. a lab named in the body that the buyer isn't a member of is ignored, as the route ignores it (default lab judged)", checkoutMetadataLabId(sqlite, COMP.id, labCard) === labComp && r(COMP.id, labCard) === null, String(checkoutMetadataLabId(sqlite, COMP.id, labCard)));
    check("1. the metadata lab follows the route's order: body lab when a member, else the default lab", checkoutMetadataLabId(sqlite, CARD.id, labCardOpen) === labCardOpen && checkoutMetadataLabId(sqlite, CARD.id, undefined) === labCard && checkoutMetadataLabId(sqlite, CARD.id, "0") === labCard && checkoutMetadataLabId(sqlite, NOLAB.id, undefined) === null);

    // 2. GET /api/labs/me
    const meOf = async (u: { token: string }) => (await call("GET", "/api/labs/me", undefined, u.token));
    const cardMe = await meOf(CARD);
    const byLab = (rows: any[], id: number) => (Array.isArray(rows) ? rows.find((m) => m.labId === id) : null) || {};
    check("2. the card lab reads hasCardSubscription true (with and without an expiry)", byLab(cardMe.j, labCard).hasCardSubscription === true && byLab(cardMe.j, labCardOpen).hasCardSubscription === true, cardMe.text.slice(0, 200));
    const compMe = await meOf(COMP);
    check("2. the comped lab reads hasCardSubscription false", byLab(compMe.j, labComp).hasCardSubscription === false, compMe.text.slice(0, 200));
    const lapsedMe = await meOf(LAPSED);
    check("2. a canceled card subscription and a blank id read false", byLab(lapsedMe.j, labCanceled).hasCardSubscription === false && byLab(lapsedMe.j, labBlankId).hasCardSubscription === false);
    check("2. the flag is the id and status only (a lapsed expiry still reads true; checkout itself allows it, section 3)", byLab(lapsedMe.j, labLapsed).hasCardSubscription === true);
    const seatMe = await meOf(SEAT);
    check("2. a seat user's labs carry the flag as a boolean too", byLab(seatMe.j, labComp).hasCardSubscription === false && byLab(seatMe.j, labCard).hasCardSubscription === true);
    const allMe = cardMe.text + compMe.text + lapsedMe.text + seatMe.text;
    check("2. no subscription id and no stripe_subscription_id key in any answer", !/sub_madeup/.test(allMe) && !/stripe_subscription_id|stripeSubscriptionId/.test(allMe));

    // 3. POST /api/stripe/checkout
    const co = (u: { token: string }, body: Record<string, unknown>) => call("POST", "/api/stripe/checkout", body, u.token);
    const cardCo = await co(CARD, { priceType: "veritacheck_only" });
    check("3. the card lab's owner gets 409 ALREADY_SUBSCRIBED (Stripe is unset, so this check runs before the Stripe lookup)", cardCo.s === 409 && cardCo.j.code === "ALREADY_SUBSCRIBED", `${cardCo.s} ${cardCo.text}`);
    const cardOpenCo = await co(CARD, { priceType: "veritacheck_only", labId: labCardOpen });
    check("3. naming the card lab with no expiry gets 409 too", cardOpenCo.s === 409 && cardOpenCo.j.code === "ALREADY_SUBSCRIBED", `${cardOpenCo.s} ${cardOpenCo.text}`);
    const seatCo = await co(SEAT, { priceType: "veritacheck_only", labId: labComp });
    check("3. a seat user naming the employer's lab gets 403 NOT_LAB_OWNER", seatCo.s === 403 && seatCo.j.code === "NOT_LAB_OWNER", `${seatCo.s} ${seatCo.text}`);
    const seatDefaultCo = await co(SEAT, { priceType: "veritacheck_only" });
    check("3. a seat user with no lab named gets 403 for the default lab", seatDefaultCo.s === 403 && seatDefaultCo.j.code === "NOT_LAB_OWNER", `${seatDefaultCo.s} ${seatDefaultCo.text}`);
    const compCo = await co(COMP, { priceType: "veritacheck_only", labId: labComp, discountCode: "MADEUP10" });
    check("3. the comped lab's owner passes the check and reaches the Stripe lookup (503 Payments not configured)", compCo.s === 503 && /Payments not configured/.test(compCo.text), `${compCo.s} ${compCo.text}`);
    const lapsedCo = await co(LAPSED, { priceType: "veritacheck_only" });
    check("3. a lapsed card subscription passes too (503)", lapsedCo.s === 503, `${lapsedCo.s} ${lapsedCo.text}`);
    const noLabCo = await co(NOLAB, { priceType: "veritacheck_only" });
    check("3. someone with no lab passes (503)", noLabCo.s === 503, `${noLabCo.s} ${noLabCo.text}`);
    const otherCard = await co(CARD, { priceType: "community" });
    const otherSeat = await co(SEAT, { priceType: "hospital", labId: labComp });
    check("3. every other priceType is untouched (community for the card owner, hospital for the seat user: 503 as before)", otherCard.s === 503 && otherSeat.s === 503, `${otherCard.s} ${otherSeat.s}`);
    const anon = await call("POST", "/api/stripe/checkout", { priceType: "veritacheck_only" }, null);
    check("3. signed out is still 401", anon.s === 401, String(anon.s));
    check("3. no lab row changed", labSnapshot() === before);

    // 4. The first year on VeritaCheck Unlimited: the code or the $200 first-year discount, whichever is less (no Stripe)
    const fy = (percentOff?: number | null, amountOffCents?: number | null) => vcFirstYear({ percentOff, amountOffCents });
    check("4. 10% off ($449.10) loses to the first-year discount: $299", JSON.stringify(fy(10)) === JSON.stringify({ use: "first_year", firstYearCents: 29900 }), JSON.stringify(fy(10)));
    check("4. 50% off wins: $249.50", JSON.stringify(fy(50)) === JSON.stringify({ use: "code", firstYearCents: 24950 }), JSON.stringify(fy(50)));
    check("4. $250 off wins: $249", JSON.stringify(fy(null, 25000)) === JSON.stringify({ use: "code", firstYearCents: 24900 }), JSON.stringify(fy(null, 25000)));
    check("4. 0% off, or no code, is the first-year discount: $299", fy(0).use === "first_year" && fy(0).firstYearCents === 29900 && fy().use === "first_year");
    check("4. a tie ($200 off) goes to the first-year discount", fy(null, 20000).use === "first_year" && fy(null, 20000).firstYearCents === 29900);
    check("4. never below $0 (100% off, or $600 off)", fy(100).firstYearCents === 0 && fy(100).use === "code" && fy(null, 60000).firstYearCents === 0);
    const FY = "VCFIRSTYEAR";
    const lose = vcCheckoutCoupon({ codeCouponId: "coupon_madeup_10", percentOff: 10, firstYearCouponId: FY });
    check("4. checkout: a code that loses puts VCFIRSTYEAR on the session and isn't counted as used", lose.couponId === FY && lose.codeUsed === false, JSON.stringify(lose));
    const win = vcCheckoutCoupon({ codeCouponId: "coupon_madeup_50", percentOff: 50, firstYearCouponId: FY });
    check("4. checkout: a code that wins puts its own coupon on the session and is counted", win.couponId === "coupon_madeup_50" && win.codeUsed === true && win.firstYearCents === 24950, JSON.stringify(win));
    const none = vcCheckoutCoupon({ codeCouponId: null, percentOff: 0, firstYearCouponId: FY });
    check("4. checkout: no code (or a code with no coupon, such as a trial-only code) gets VCFIRSTYEAR", none.couponId === FY && none.codeUsed === false);
    check("4. checkout: never a trial on VeritaCheck Unlimited, whatever the code", [lose, win, none].every((x) => x.trialDays === null));
    const src = (await import("node:fs")).readFileSync(new URL("../../server/routes.ts", import.meta.url), "utf8");
    const route = src.slice(src.indexOf('app.post("/api/stripe/checkout"'), src.indexOf('app.post("/api/stripe/webhook"'));
    check("4. the checkout route takes the coupon and the trial from vcCheckoutCoupon (read from the route's source: the route needs a Stripe client to get there, and this test runs without one)",
      /vcCheckoutCoupon\(/.test(route) && /trialDays = vc\.trialDays/.test(route) && !/priceType === "veritacheck_only" && !couponId/.test(route));

    // 5. POST /api/discount/validate adds the first year for VeritaCheck Unlimited, and keeps its fields
    const codeRow = (code: string, pct: number, trial: number | null) => insert("discount_codes", { code, partner_name: "Made-up Partner", discount_pct: pct, applies_to: "all", max_uses: null, uses: 0, active: 1, created_at: now, trial_days: trial });
    codeRow(`MADEUP10VC${stamp}`, 10, null); codeRow(`MADEUP50VC${stamp}`, 50, null); codeRow(`MADEUPTRIAL${stamp}`, 0, 60);
    const val = (code: string, priceType: string) => call("POST", "/api/discount/validate", { code, priceType }, null);
    const v10 = await val(`MADEUP10VC${stamp}`, "veritacheck_only");
    check("5. a 10% code on Unlimited: appliedAs first_year, firstYearCents 29900, with valid, discountPct, trialDays, partnerName and message kept",
      v10.j.valid === true && v10.j.appliedAs === "first_year" && v10.j.firstYearCents === 29900 && v10.j.discountPct === 10 && v10.j.trialDays === 0 && v10.j.partnerName === "Made-up Partner" && typeof v10.j.message === "string", v10.text);
    const v50 = await val(`MADEUP50VC${stamp}`, "veritacheck_only");
    check("5. a 50% code on Unlimited: appliedAs code, firstYearCents 24950", v50.j.valid === true && v50.j.appliedAs === "code" && v50.j.firstYearCents === 24950, v50.text);
    const vTrial = await val(`MADEUPTRIAL${stamp}`, "veritacheck_only");
    check("5. a trial-only code on Unlimited: the first year stays $299 (appliedAs first_year); its trialDays field is still reported as before", vTrial.j.valid === true && vTrial.j.appliedAs === "first_year" && vTrial.j.firstYearCents === 29900 && vTrial.j.trialDays === 60, vTrial.text);
    const vComm = await val(`MADEUP10VC${stamp}`, "community");
    check("5. any other priceType gets the answer it always got, with no first-year fields", vComm.j.valid === true && vComm.j.discountPct === 10 && !("appliedAs" in vComm.j) && !("firstYearCents" in vComm.j), vComm.text);
  } finally {
    server.close();
  }
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
