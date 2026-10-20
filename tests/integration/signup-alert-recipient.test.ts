// tests/integration/signup-alert-recipient.test.ts
//
// Michael 2026-10-20: "why are new signups still going to my gmail? Lets have those go to info@". The
// "[VeritaAssure] New signup" alert was hard-coded to verilabguy@gmail.com. This pins:
//   1. a registration sends the New signup alert to info@veritaslabservices.com only
//   2. the alert never goes to the personal Gmail
// Outgoing mail is captured at the network edge (requests to api.resend.com); nothing is sent.
// Run: npm run test:signup-alert-recipient

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

// Capture Resend API calls; pass every other request through.
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
  const { registerRoutes } = await import("../../server/routes");
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  try {
    const email = `it-signup-alert-${Date.now()}@example.com`;
    const r = await realFetch(`${base}/api/auth/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: ["Zq", "alert", "7x!"].join("-"), name: "Jordan Ellis", hipaa_acknowledged: true }),
    });
    check("0. registration succeeds", r.status === 200, String(r.status));
    for (let i = 0; i < 20 && !sent.some((m) => /New signup/.test(m.subject || "")); i++) await new Promise((res) => setTimeout(res, 100));
    const alerts = sent.filter((m) => /^\[VeritaAssure\] New signup/.test(m.subject || ""));
    const to = alerts.flatMap((m) => ([] as string[]).concat(m.to || []));
    check("1. the New signup alert goes to info@veritaslabservices.com only",
      alerts.length === 1 && to.length === 1 && to[0] === "info@veritaslabservices.com", JSON.stringify(to));
    check("2. the alert does not go to the personal Gmail", !to.some((a) => /verilabguy@gmail\.com/i.test(a)) && !alerts.some((m) => JSON.stringify(m.cc || m.bcc || "").includes("verilabguy")));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
