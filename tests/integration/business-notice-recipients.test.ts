// tests/integration/business-notice-recipients.test.ts
//
// Michael 2026-10-20, Q20 = 1: the internal "New invoice request" and "New VeritaMap instrument request" notices
// went to info@ AND the personal Gmail. They now go to info@veritaslabservices.com only. This pins:
//   1. an invoice request sends its internal notice to info@ only (the requester still gets their own email)
//   2. an instrument request sends its notice to info@ only
//   3. neither notice reaches the personal Gmail in to, cc or bcc
// Outgoing mail is captured at the network edge (requests to api.resend.com); nothing is sent.
// Run: npm run test:business-notice-recipients

import http from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
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

const recipients = (m: any) => ([] as string[]).concat(m.to || [], m.cc || [], m.bcc || []);
const waitFor = async (re: RegExp) => {
  for (let i = 0; i < 30 && !sent.some((m) => re.test(m.subject || "")); i++) await new Promise((res) => setTimeout(res, 100));
  return sent.filter((m) => re.test(m.subject || ""));
};

async function main() {
  const { registerRoutes } = await import("../../server/routes");
  const { db } = await import("../../server/db");
  const sqlite = (db as any).$client;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (p: string, body: any, token?: string) => {
    const r = await realFetch(base + p, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  try {
    // 1. invoice request
    const billing = `it-invoice-notice-${Date.now()}@example.com`;
    const inv = await call("/api/invoice/request", {
      lab_name: "IT Notice Lab", billing_contact_name: "Jordan Ellis", billing_contact_email: billing,
      billing_address: "1 Test Way, Boston, MA 02101", tier: "clinic", seats: 2, authorization: true,
    });
    check("0a. invoice request accepted", inv.status === 201 && inv.body.success === true, `${inv.status} ${JSON.stringify(inv.body).slice(0, 200)}`);
    const invNotices = await waitFor(/^New invoice request:/);
    const invTo = invNotices.flatMap(recipients);
    check("1a. the New invoice request notice goes to info@veritaslabservices.com only",
      invNotices.length === 1 && invTo.length === 1 && invTo[0] === "info@veritaslabservices.com", JSON.stringify(invTo));
    const requesterMail = sent.filter((m) => /invoice request - next steps/.test(m.subject || ""));
    check("1b. the requester still gets their own next-steps email", requesterMail.length === 1 && recipients(requesterMail[0]).includes(billing),
      JSON.stringify(requesterMail.map(recipients)));

    // 2. instrument request (signed in)
    const email = `it-instrument-notice-${Date.now()}@example.com`;
    const reg = await call("/api/auth/register", { email, password: ["Zq", "notice", "7x!"].join("-"), name: "Sam Rivera", hipaa_acknowledged: true });
    const uid = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    check("0b. requester account registered", reg.status === 200 && uid > 0, String(reg.status));
    const token = jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });
    const ins = await call("/api/veritamap/instrument-requests", { instrument_name: "IT Analyzer 9000", vendor: "IT Vendor" }, token);
    check("0c. instrument request saved", ins.status === 200 && Number(ins.body.id) > 0, `${ins.status} ${JSON.stringify(ins.body).slice(0, 200)}`);
    const insNotices = await waitFor(/^New VeritaMap instrument request:/);
    const insTo = insNotices.flatMap(recipients);
    check("2. the New VeritaMap instrument request notice goes to info@veritaslabservices.com only",
      insNotices.length === 1 && insTo.length === 1 && insTo[0] === "info@veritaslabservices.com", JSON.stringify(insTo));

    // 3. no Gmail copy on either notice
    check("3. neither notice reaches the personal Gmail (to, cc or bcc)",
      ![...invNotices, ...insNotices].some((m) => recipients(m).some((a) => /verilabguy@gmail\.com/i.test(a))));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
