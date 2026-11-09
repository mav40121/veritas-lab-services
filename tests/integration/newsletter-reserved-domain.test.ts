// tests/integration/newsletter-reserved-domain.test.ts
//
// 2026-11-09: tests/playwright/module-gate-and-book-waitlist.spec.ts posted pw-book-<timestamp>@example.com to the
// LIVE /api/newsletter/subscribe on every smoke run (914 rows since 10/2, each with a welcome email). A reserved test
// address now answers success and writes nothing and sends nothing. This pins:
//   1. reserved addresses (example.com/.net/.org and their subdomains, .test, .invalid, .example, .localhost) answer
//      200 success, add no row and make no Resend call, whatever the case or a trailing dot
//   2. a real-looking address still subscribes: one row with its source, one welcome email
//   3. look-alikes are not caught (example.com.au, notexample.com, example.co)
// Outgoing mail is captured at the network edge (requests to api.resend.com); nothing is sent.
// Run: npm run test:newsletter-reserved-domain

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
  const { isReservedTestAddress } = await import("../../server/newsletterGuards");
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
  const subscribe = async (email: string, source = "book") => {
    const r = await realFetch(base + "/api/newsletter/subscribe", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, source }),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const rows = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM newsletter_subscribers").get() as any).n);
  const stamp = Date.now();
  try {
    // 1. reserved addresses: success, no row, no email
    const reserved = [
      `pw-book-${stamp}@example.com`, `a-${stamp}@EXAMPLE.ORG`, `b-${stamp}@mail.example.net`, `c-${stamp}@example.com.`,
      `d-${stamp}@lab.test`, `e-${stamp}@x.invalid`, `f-${stamp}@site.example`, `g-${stamp}@box.localhost`,
    ];
    const before = rows();
    const sentBefore = sent.length;
    for (const email of reserved) {
      const r = await subscribe(email);
      check(`1. ${email.replace(String(stamp), "<stamp>")} answers 200 success`, r.status === 200 && r.body.success === true, `${r.status} ${JSON.stringify(r.body)}`);
    }
    await new Promise((res) => setTimeout(res, 200));
    check("1. no reserved address added a row", rows() === before, `${before} -> ${rows()}`);
    check("1. no reserved address made a Resend call", sent.length === sentBefore, `${sent.length - sentBefore} calls`);

    // 2. a real-looking address still subscribes and gets one welcome email
    const real = `it-newsletter-${stamp}@veritas-it-mail.com`;
    const r = await subscribe(real, "upgrade-tea-table");
    check("2. a real address answers 200 subscribed", r.status === 200 && r.body.message === "subscribed", `${r.status} ${JSON.stringify(r.body)}`);
    const row = sqlite.prepare("SELECT source, active FROM newsletter_subscribers WHERE email = ?").get(real) as any;
    check("2. it is stored with its source and active", !!row && row.source === "upgrade-tea-table" && row.active === 1, JSON.stringify(row));
    for (let i = 0; i < 30 && !sent.some((m) => m.to === real); i++) await new Promise((res) => setTimeout(res, 100));
    check("2. it gets exactly one welcome email", sent.filter((m) => m.to === real).length === 1);

    // 3. look-alikes are real domains and are not caught
    for (const email of ["x@example.com.au", "x@notexample.com", "x@example.co", "x@test.com", "x@invalid.org"]) {
      check(`3. ${email} is not treated as reserved`, isReservedTestAddress(email) === false);
    }
    check("3. a value with no @ or not a string is not treated as reserved",
      isReservedTestAddress("example.com") === false && isReservedTestAddress(undefined) === false && isReservedTestAddress(42) === false);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
