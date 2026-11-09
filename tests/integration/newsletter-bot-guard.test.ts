// tests/integration/newsletter-bot-guard.test.ts
//
// 2026-11-09 (Michael, Q247 = 1): the live list held 118 bot signups from the homepage form, Gmail addresses with three
// or more dots in the local part; Gmail ignores dots, so each sent our welcome email to a real stranger's inbox.
// POST /api/newsletter/subscribe now has three guards (server/newsletterGuards.ts). This pins:
//   1. honeypot: a filled "website" field answers the same JSON as a real signup, adds no row, sends nothing, and
//      isn't counted by the rate limit
//   2. rate limit: the 6th attempt from one IP in an hour is 429 with no row and no email; the first X-Forwarded-For
//      entry is the IP; the window frees after an hour; reserved test addresses aren't counted
//   3. a different IP is unaffected
//   4. Gmail: j.o.h.n+x@gmail.com after john@gmail.com is already_subscribed with no second row or email;
//      googlemail.com counts as gmail.com both ways; a dotted row already on file isn't rewritten
//   5. a non-Gmail address with dots or a "+" is its own address
//   6. a normal signup stores its row (as typed, lowercased) and sends one welcome email; an unsubscribed address
//      can still subscribe again
//   7. a new spelling of a Gmail mailbox that has only unsubscribed rows stores and sends nothing; the exact address
//      still subscribes again
// Outgoing mail is captured at the network edge (requests to api.resend.com); nothing is sent.
// Run: npm run test:newsletter-bot-guard

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

const sent: any[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url || String(input);
  if (url.startsWith("https://api.resend.com")) {
    try { sent.push(JSON.parse(String(init?.body || "{}"))); } catch { sent.push({ raw: init?.body }); }
    return new Response(JSON.stringify({ id: `test-${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(input, init);
}) as any;

async function main() {
  const guards = await import("../../server/newsletterGuards");
  const { newsletterDedupeKey, isHoneypotFilled, newsletterRateLimitOk, NEWSLETTER_SIGNUPS_PER_IP_PER_HOUR } = guards;
  const { registerRoutes } = await import("../../server/routes");
  const { db } = await import("../../server/db");
  const sqlite = (db as any).$client;
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  // Each case gets its own documentation-range IP (RFC 5737) so one case's attempts don't count against another's.
  let ipN = 0;
  const nextIp = () => `198.51.100.${++ipN}`;
  const subscribe = async (body: Record<string, unknown>, ip: string) => {
    const r = await realFetch(base + "/api/newsletter/subscribe", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": ip }, body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const rowsFor = (email: string) => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE email = ?").get(email) as any).n);
  const rowsForKey = (email: string) => {
    const key = newsletterDedupeKey(email);
    return (sqlite.prepare("SELECT email FROM newsletter_subscribers").all() as any[]).filter((r) => newsletterDedupeKey(r.email) === key).length;
  };
  const allRows = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM newsletter_subscribers").get() as any).n);
  const mailTo = (...emails: string[]) => sent.filter((m) => emails.includes(m.to)).length;
  const settle = () => new Promise((res) => setTimeout(res, 150));
  const stamp = Date.now();
  const SUBSCRIBED = JSON.stringify({ success: true, message: "subscribed" });

  try {
    // 6 first, so the honeypot can be compared with a real signup's answer.
    // 6. a normal signup stores its row and sends one welcome email
    const normal = `it-bot-guard-${stamp}@veritas-it-mail.com`;
    const n = await subscribe({ email: `  IT-Bot-Guard-${stamp}@Veritas-IT-Mail.com `, source: "homepage", website: "" }, nextIp());
    await settle();
    check("6. a normal signup answers 200 subscribed", n.status === 200 && JSON.stringify(n.body) === SUBSCRIBED, `${n.status} ${JSON.stringify(n.body)}`);
    const nRow = sqlite.prepare("SELECT email, source, active FROM newsletter_subscribers WHERE email = ?").get(normal) as any;
    check("6. it is stored as typed (lowercased, trimmed) with its source, active", !!nRow && nRow.source === "homepage" && nRow.active === 1, JSON.stringify(nRow));
    check("6. it gets exactly one welcome email", mailTo(normal) === 1, `${mailTo(normal)} emails`);
    const noField = `it-no-field-${stamp}@veritas-it-mail.com`;
    const nf = await subscribe({ email: noField, source: "book" }, nextIp());
    await settle();
    check("6. a post with no website field at all (an older page) still subscribes", nf.status === 200 && rowsFor(noField) === 1 && mailTo(noField) === 1, `${nf.status}`);

    // 1. honeypot
    const hpIp = nextIp();
    const before1 = allRows();
    const sent1 = sent.length;
    const hpCases: Array<[string, unknown]> = [["a URL", "http://spam.example"], ["a word", "x"], ["a number", 7], ["true", true]];
    for (const [label, value] of hpCases) {
      const r = await subscribe({ email: `hp-${label.replace(/\W/g, "")}-${stamp}@veritas-it-mail.com`, source: "homepage", website: value }, hpIp);
      check(`1. website = ${label}: 200 with the same JSON as a real signup`, r.status === 200 && JSON.stringify(r.body) === SUBSCRIBED, `${r.status} ${JSON.stringify(r.body)}`);
    }
    const hpGarbage = await subscribe({ email: "not-an-address", website: "x" }, hpIp);
    check("1. honeypot filled with a bad address: still the success JSON (no 400 for the bot to learn from)", hpGarbage.status === 200 && JSON.stringify(hpGarbage.body) === SUBSCRIBED, `${hpGarbage.status}`);
    for (let i = 0; i < 6; i++) await subscribe({ email: `hp-more-${i}-${stamp}@gmail.com`, website: "x" }, hpIp);
    await settle();
    check("1. no honeypot post added a row", allRows() === before1, `${before1} -> ${allRows()}`);
    check("1. no honeypot post made a Resend call", sent.length === sent1, `${sent.length - sent1} calls`);
    const afterHp = `hp-then-real-${stamp}@veritas-it-mail.com`;
    const ahp = await subscribe({ email: afterHp, website: "" }, hpIp);
    check("1. 11 honeypot posts from one IP don't count toward its limit: a real signup from it still subscribes", ahp.status === 200 && ahp.body.message === "subscribed" && rowsFor(afterHp) === 1, `${ahp.status}`);
    check("1. a blank or whitespace website is a person", !isHoneypotFilled({ website: "" }) && !isHoneypotFilled({ website: "   " }) && !isHoneypotFilled({}) && !isHoneypotFilled(undefined) && !isHoneypotFilled({ website: null }));

    // 2. rate limit
    const rlIp = nextIp();
    const rlEmails = Array.from({ length: NEWSLETTER_SIGNUPS_PER_IP_PER_HOUR + 1 }, (_, i) => `rl-${i}-${stamp}@veritas-it-mail.com`);
    check("2. the limit is 5 an hour", NEWSLETTER_SIGNUPS_PER_IP_PER_HOUR === 5);
    for (let i = 0; i < NEWSLETTER_SIGNUPS_PER_IP_PER_HOUR; i++) {
      const r = await subscribe({ email: rlEmails[i], website: "" }, rlIp);
      check(`2. attempt ${i + 1} from one IP: 200 subscribed`, r.status === 200 && r.body.message === "subscribed", `${r.status} ${JSON.stringify(r.body)}`);
    }
    const sent2 = sent.length;
    const sixth = await subscribe({ email: rlEmails[5], website: "" }, rlIp);
    await settle();
    check("2. attempt 6 from the same IP in the hour: 429", sixth.status === 429, `${sixth.status} ${JSON.stringify(sixth.body)}`);
    check("2. the 429 says so plainly", typeof sixth.body.error === "string" && /try again in an hour/i.test(sixth.body.error) && !sixth.body.error.includes(String.fromCharCode(0x2014)), sixth.body.error);
    check("2. attempt 6 stored nothing and sent nothing", rowsFor(rlEmails[5]) === 0 && sent.length === sent2, `rows ${rowsFor(rlEmails[5])}, calls ${sent.length - sent2}`);
    const chained = await subscribe({ email: rlEmails[5], website: "" }, `${rlIp}, 10.0.0.1`);
    check("2. the IP is the first X-Forwarded-For entry: the same client behind another proxy hop is still 429", chained.status === 429, `${chained.status}`);
    const t0 = 1_000_000_000_000;
    const unitIp = `unit-${stamp}`;
    const firstFive = Array.from({ length: 5 }, (_, i) => newsletterRateLimitOk(unitIp, t0 + i));
    check("2. limiter: 5 allowed, the 6th refused", firstFive.every(Boolean) && newsletterRateLimitOk(unitIp, t0 + 10) === false);
    check("2. limiter: a refused attempt isn't counted, and an hour after the first the window frees one", newsletterRateLimitOk(unitIp, t0 + 60 * 60 * 1000) === true && newsletterRateLimitOk(unitIp, t0 + 60 * 60 * 1000) === false);
    const resIp = nextIp();
    for (let i = 0; i < 9; i++) await subscribe({ email: `pw-${i}-${stamp}@example.com`, website: "" }, resIp);
    const afterRes = `after-reserved-${stamp}@veritas-it-mail.com`;
    const ar = await subscribe({ email: afterRes, website: "" }, resIp);
    check("2. reserved test addresses aren't counted: after 9 from one IP a real signup still subscribes", ar.status === 200 && ar.body.message === "subscribed" && rowsFor(afterRes) === 1, `${ar.status}`);

    // 3. a different IP is unaffected
    const other = `other-ip-${stamp}@veritas-it-mail.com`;
    const o = await subscribe({ email: other, website: "" }, nextIp());
    await settle();
    check("3. a different IP while the first is limited: 200 subscribed, stored, one email", o.status === 200 && o.body.message === "subscribed" && rowsFor(other) === 1 && mailTo(other) === 1, `${o.status}`);

    // 4. Gmail
    const gIp = nextIp();
    const john = `john${stamp}@gmail.com`;
    const johnDots = `j.o.h.n${stamp}+x@gmail.com`;
    const g1 = await subscribe({ email: john, website: "" }, gIp);
    await settle();
    check("4. john@gmail.com subscribes", g1.status === 200 && g1.body.message === "subscribed" && rowsFor(john) === 1 && mailTo(john) === 1, `${g1.status}`);
    const sent4 = sent.length;
    const g2 = await subscribe({ email: johnDots, website: "" }, gIp);
    await settle();
    check("4. j.o.h.n+x@gmail.com after it: already_subscribed", g2.status === 200 && g2.body.message === "already_subscribed", `${g2.status} ${JSON.stringify(g2.body)}`);
    check("4. no second row (by address or by key)", rowsFor(johnDots) === 0 && rowsForKey(john) === 1, `typed ${rowsFor(johnDots)}, key ${rowsForKey(john)}`);
    check("4. no second welcome email", sent.length === sent4 && mailTo(john, johnDots) === 1, `${sent.length - sent4} calls`);
    const g3 = await subscribe({ email: `J.O.H.N${stamp}@GoogleMail.com`, website: "" }, gIp);
    await settle();
    check("4. J.O.H.N@GoogleMail.com: already_subscribed, no row, no email (googlemail.com counts as gmail.com)", g3.status === 200 && g3.body.message === "already_subscribed" && rowsForKey(john) === 1 && sent.length === sent4, `${g3.status} ${JSON.stringify(g3.body)}`);
    const g2Ip = nextIp();
    const mary = `mary${stamp}@googlemail.com`;
    await subscribe({ email: mary, website: "" }, g2Ip);
    const sent4b = sent.length;
    const g4 = await subscribe({ email: `m.a.r.y${stamp}@gmail.com`, website: "" }, g2Ip);
    await settle();
    check("4. the other way: m.a.r.y@gmail.com after mary@googlemail.com is already_subscribed with no row or email", g4.status === 200 && g4.body.message === "already_subscribed" && rowsForKey(mary) === 1 && sent.length === sent4b, `${g4.status}`);
    check("4. mary is stored as typed, on googlemail.com", rowsFor(mary) === 1);
    const legacy = `p.a.t.${stamp}@gmail.com`;
    sqlite.prepare("INSERT INTO newsletter_subscribers (email, source, subscribed_at) VALUES (?, 'homepage', ?)").run(legacy, new Date().toISOString());
    const sent4c = sent.length;
    const g5 = await subscribe({ email: `pat${stamp}@gmail.com`, website: "" }, g2Ip);
    await settle();
    check("4. a dotted row already on file blocks pat@gmail.com: already_subscribed, no row, no email", g5.status === 200 && g5.body.message === "already_subscribed" && rowsForKey(legacy) === 1 && sent.length === sent4c, `${g5.status}`);
    check("4. the row on file isn't rewritten", rowsFor(legacy) === 1 && rowsFor(`pat${stamp}@gmail.com`) === 0);
    check("4. key: dots and +tag dropped, googlemail.com read as gmail.com, case and spaces ignored",
      newsletterDedupeKey("j.o.h.n+x@gmail.com") === "john@gmail.com" && newsletterDedupeKey(" J.Doe+News@GoogleMail.com ") === "jdoe@gmail.com" && newsletterDedupeKey("a.b@gmail.com.") === "ab@gmail.com");

    // 5. non-Gmail addresses are not collapsed
    const nIp = nextIp();
    const jane = `jane${stamp}@veritas-it-mail.com`;
    const janeDots = `j.a.n.e${stamp}@veritas-it-mail.com`;
    await subscribe({ email: jane, website: "" }, nIp);
    const j2 = await subscribe({ email: janeDots, website: "" }, nIp);
    await settle();
    check("5. j.a.n.e@ another domain after jane@ it: subscribed as its own row with its own email", j2.status === 200 && j2.body.message === "subscribed" && rowsFor(jane) === 1 && rowsFor(janeDots) === 1 && mailTo(janeDots) === 1, `${j2.status} ${JSON.stringify(j2.body)}`);
    check("5. key: another domain keeps its dots and +tag", newsletterDedupeKey("J.Doe+tag@Example-Lab.org") === "j.doe+tag@example-lab.org" && newsletterDedupeKey("j.doe@outlook.com") === "j.doe@outlook.com" && newsletterDedupeKey("x@gmail.co") === "x@gmail.co" && newsletterDedupeKey("x@notgmail.com") === "x@notgmail.com");

    // 6 (cont.). an unsubscribed address can subscribe again, once
    const back = `back-${stamp}@veritas-it-mail.com`;
    sqlite.prepare("INSERT INTO newsletter_subscribers (email, source, subscribed_at, unsubscribed_at, active) VALUES (?, 'homepage', ?, ?, 0)").run(back, new Date().toISOString(), new Date().toISOString());
    const b = await subscribe({ email: back, website: "" }, nextIp());
    await settle();
    const bRow = sqlite.prepare("SELECT active FROM newsletter_subscribers WHERE email = ?").get(back) as any;
    check("6. an unsubscribed address subscribes again: same row, active, one welcome email", b.status === 200 && b.body.message === "subscribed" && rowsFor(back) === 1 && bRow?.active === 1 && mailTo(back) === 1, `${b.status} ${JSON.stringify(bRow)}`);
    // 7. a new spelling of a Gmail mailbox that has only unsubscribed rows: no row, no email; the exact address still comes back
    const gone = `g.o.n.e.${stamp}@gmail.com`;
    sqlite.prepare("INSERT INTO newsletter_subscribers (email, source, subscribed_at, unsubscribed_at, active) VALUES (?, 'homepage', ?, ?, 0)").run(gone, new Date().toISOString(), new Date().toISOString());
    const sent7 = sent.length;
    const v = await subscribe({ email: `go.ne${stamp}@gmail.com`, website: "" }, nextIp());
    await settle();
    check("7. a new spelling of an unsubscribed Gmail mailbox: subscribed reply, no row, no email", v.status === 200 && v.body.message === "subscribed" && rowsForKey(gone) === 1 && sent.length === sent7, `${v.status} ${JSON.stringify(v.body)} rows ${rowsForKey(gone)} mail ${sent.length - sent7}`);
    const g7 = await subscribe({ email: gone, website: "" }, nextIp());
    await settle();
    const g7Row = sqlite.prepare("SELECT active FROM newsletter_subscribers WHERE email = ?").get(gone) as any;
    check("7. the exact unsubscribed Gmail address subscribes again: same row, active, one email", g7.status === 200 && g7.body.message === "subscribed" && rowsForKey(gone) === 1 && g7Row?.active === 1 && mailTo(gone) === 1, `${g7.status} ${JSON.stringify(g7Row)}`);
    const bad = await subscribe({ email: 42, website: "" }, nextIp());
    check("6. a non-string email is a 400, not a crash", bad.status === 400, `${bad.status}`);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
