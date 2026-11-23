// tests/integration/signup-bot-guard.test.ts
//
// Michael 2026-11-23: "I keep getting bogus sign ups". One script made all five from 2026-11-11 on, and it sends its browser
// string inside quote marks (server/signupGuards.ts). This pins:
//   1. a public sign-up with a quoted browser string is answered exactly as a person's is, and makes no account, sends no
//      confirmation email and no New signup alert
//   2. a person's sign-up makes the account, sends the confirmation email and the alert
//   3. the same form rules answer both (a weak password, no acknowledgment, an address already taken)
//   4. an invitation's link works even with a quoted browser string
//   5. the dropped address is still free: the real person can sign up with it afterwards
//   6. isQuotedUserAgent: real browser strings, a blank one and a missing one aren't quoted
// Outgoing mail is captured at the network edge (requests to api.resend.com); nothing is sent.
// Run: npm run test:signup-bot-guard

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
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

const PERSON = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";
const BOT = '"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36"';

async function main() {
  process.env.EMAIL_VERIFICATION = "on";
  const { registerRoutes } = await import("../../server/routes");
  const { db } = await import("../../server/db");
  const { isQuotedUserAgent } = await import("../../server/signupGuards");
  const sqlite = (db as any).$client;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const stamp = Date.now();
  const mail = (t: string) => `bot-guard-${t}-${stamp}@example.com`;
  const PW = ["Zq", "guard", "7x!"].join("-");
  const signUp = async (ua: string, email: string, extra: object = {}) => {
    const r = await realFetch(`${base}/api/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json", "User-Agent": ua },
      body: JSON.stringify({ email, password: PW, name: "Made Up", hipaa_acknowledged: true, plan: "free", ...extra }),
    });
    return { s: r.status, j: (await r.json().catch(() => ({}))) as any };
  };
  const account = (email: string) => sqlite.prepare("SELECT id FROM users WHERE lower(email) = ?").get(email.toLowerCase()) as any;
  const settle = () => new Promise((res) => setTimeout(res, 600));
  const mailTo = (email: string) => sent.filter((m) => ([] as string[]).concat(m.to || []).includes(email));
  const alertsFor = (email: string) => sent.filter((m) => /^\[VeritaAssure\] New signup/.test(m.subject || "") && String(m.html || "").includes(email));
  try {
    // 2 first, so its answer is the one the bot's is compared with.
    const person = await signUp(PERSON, mail("person"));
    await settle();
    check("2. a person's sign-up makes the account, sends the confirmation email and the New signup alert",
      person.s === 200 && person.j.verification_required === true && !!account(mail("person")) && mailTo(mail("person")).length === 1 && alertsFor(mail("person")).length === 1,
      `${person.s} ${JSON.stringify(person.j)} mail ${mailTo(mail("person")).length} alerts ${alertsFor(mail("person")).length}`);

    const usersBefore = Number(sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n), sentBefore = sent.length;
    const bot = await signUp(BOT, mail("stranger"));
    await settle();
    check("1a. a quoted browser string is answered as a person's is: same status, same fields, its own address",
      bot.s === person.s && JSON.stringify(Object.keys(bot.j).sort()) === JSON.stringify(Object.keys(person.j).sort())
        && bot.j.verification_required === true && bot.j.email === mail("stranger") && bot.j.email_sent === person.j.email_sent, `${bot.s} ${JSON.stringify(bot.j)}`);
    check("1b. no account is made", !account(mail("stranger")) && Number(sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n) === usersBefore);
    check("1c. no email goes out: not the confirmation, not the alert", sent.length === sentBefore, sent.slice(sentBefore).map((m) => m.subject).join(" | "));

    // 3. The same rules answer both.
    const weak = [await signUp(PERSON, mail("weak"), { password: "password" }), await signUp(BOT, mail("weak"), { password: "password" })];
    const noAck = [await signUp(PERSON, mail("ack"), { hipaa_acknowledged: false }), await signUp(BOT, mail("ack"), { hipaa_acknowledged: false })];
    check("3. a weak password or no acknowledgment is refused the same way for both",
      weak[0].s === 400 && JSON.stringify(weak[0]) === JSON.stringify(weak[1]) && noAck[0].s === 400 && JSON.stringify(noAck[0]) === JSON.stringify(noAck[1]), JSON.stringify([weak, noAck]).slice(0, 300));

    // 4. An invitation's link.
    process.env.EMAIL_VERIFICATION = "off";
    const ownerReg = await signUp(PERSON, mail("owner"));
    const labId = Number((await (await realFetch(`${base}/api/admin/provision-demo-lab`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: process.env.ADMIN_SECRET, ownerEmail: mail("owner"), labName: "Made-up Guard Lab", plan: "hospital" }) })).json() as any).labId);
    process.env.EMAIL_VERIFICATION = "on";
    const token = `bot-guard-${stamp}`;
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, status, invited_at, invite_token, lab_id, seat_type, permissions) VALUES (?, ?, 'pending', ?, ?, ?, 'active', '{}')")
      .run(ownerReg.j.user?.id, mail("invited"), new Date().toISOString(), token, labId);
    const invited = await signUp(BOT, mail("invited"), { inviteToken: token });
    const seat = sqlite.prepare("SELECT status, seat_user_id FROM user_seats WHERE invite_token = ?").get(token) as any;
    check("4. an invitation's link works even with a quoted browser string: account made, seat active",
      invited.s === 200 && !invited.j.verification_required && !!account(mail("invited")) && seat?.status === "active" && Number(seat?.seat_user_id) === Number(account(mail("invited"))?.id), `${invited.s} ${JSON.stringify(invited.j).slice(0, 160)} ${JSON.stringify(seat)}`);

    // 5.
    const later = await signUp(PERSON, mail("stranger"));
    check("5. the dropped address is still free: the real person signs up with it", later.s === 200 && !!account(mail("stranger")), `${later.s} ${JSON.stringify(later.j)}`);

    // 6.
    check("6. isQuotedUserAgent: quoted strings only", isQuotedUserAgent(BOT) && isQuotedUserAgent("'Mozilla/5.0'") && ![PERSON, "", undefined, null, "curl/8.0", 'Mozilla/5.0 "x"'].some((u) => isQuotedUserAgent(u)));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
