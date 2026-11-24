// tests/integration/contact-form.test.ts
//
// BUG-185 (2026-11-24): the website's contact form stored each message and told nobody. This pins:
//   1. a message is stored and emailed to info@ (one email, reply-to the sender), and answers success
//   2. the sender's text is escaped in the email, and a name with line breaks can't split the subject
//   3. an address that isn't one is still stored and emailed, with no reply-to (Resend refuses a bad one)
//   4. when the email fails, the message is kept and the answer is still success
//   5. a script's quoted browser string: stored, not emailed
//   6. a missing field is 400 and stores nothing
//   7. GET /api/admin/contact-messages: header secret only (a query secret and none are 403), newest first, the demo form's
//      rows told apart, and ?counts=1 has no names, addresses or text
// Outgoing mail is captured at the network edge (requests to api.resend.com); nothing is sent.
// Run: npm run test:contact-form

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
let failNext = false;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url || String(input);
  if (url.startsWith("https://api.resend.com")) {
    if (failNext) { failNext = false; throw new Error("made-up outage"); }
    sent.push(JSON.parse(String(init?.body || "{}")));
    return new Response(JSON.stringify({ id: `test-${sent.length}` }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return realFetch(input, init);
}) as any;

const PERSON = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";
const BOT = `"${PERSON}"`;

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
  const post = async (path: string, body: object, ua = PERSON) => {
    const r = await realFetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": ua }, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json().catch(() => ({})) as any };
  };
  const stored = () => sqlite.prepare("SELECT COUNT(*) AS n FROM contact_messages").get().n as number;

  let n = stored();
  const a = await post("/api/contact", { name: "Pat Example", email: "Pat@Example.com", message: "Do you do mock inspections?" });
  check("1a. answers success and stores it", a.status === 200 && a.j.success === true && stored() === n + 1, JSON.stringify(a));
  check("1b. one email, to info@ only, reply-to the sender", sent.length === 1 && sent[0].to === "info@veritaslabservices.com" && sent[0].reply_to === "pat@example.com" && sent[0].subject === "Contact form: Pat Example" && sent[0].html.includes("Do you do mock inspections?"), JSON.stringify(sent[0]));

  await post("/api/contact", { name: "Line\r\nBcc: x@example.com", email: "two@example.com", message: "<script>alert(1)</script> & more" });
  check("2. text escaped, subject on one line", sent[1].html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more") && !sent[1].html.includes("<script>") && !/[\r\n]/.test(sent[1].subject), JSON.stringify(sent[1]));

  n = stored();
  await post("/api/contact", { name: "No Address", email: "call me", message: "555 0100" });
  check("3. not an address: stored, emailed, no reply-to", stored() === n + 1 && sent.length === 3 && !("reply_to" in sent[2]) && sent[2].html.includes("call me"));

  n = stored(); failNext = true;
  const d = await post("/api/contact", { name: "Outage", email: "out@example.com", message: "kept" });
  check("4. a failed email still answers success and keeps the message", d.status === 200 && stored() === n + 1 && sent.length === 3);

  n = stored();
  const e = await post("/api/contact", { name: "Script", email: "s@example.com", message: "spam" }, BOT);
  check("5. a quoted browser string: stored, not emailed", e.status === 200 && stored() === n + 1 && sent.length === 3);

  n = stored();
  const f = await post("/api/contact", { name: "No message", email: "n@example.com" });
  check("6. a missing field is 400, nothing stored or emailed", f.status === 400 && stored() === n && sent.length === 3);

  await post("/api/request-demo", { name: "Demo Person", email: "demo@example.com", organization: "Made Up Hospital" });
  const get = async (path: string, headers: Record<string, string> = {}) => { const r = await realFetch(base + path, { headers }); return { status: r.status, text: await r.text() }; };
  const none = await get("/api/admin/contact-messages"), query = await get(`/api/admin/contact-messages?secret=${process.env.ADMIN_SECRET}`);
  check("7a. no secret, or a secret in the address: 403", none.status === 403 && query.status === 403, `${none.status} ${query.status}`);
  const H = { "x-admin-secret": process.env.ADMIN_SECRET! };
  const list = await get("/api/admin/contact-messages", H), j = JSON.parse(list.text);
  check("7b. newest first, the demo form's row told apart", list.status === 200 && j.messages[0].kind === "demo" && j.messages[0].email === "demo@example.com" && j.messages[1].kind === "contact" && j.counts.total === j.messages.length && j.counts.contact === 5 && j.counts.demo === 1, JSON.stringify(j.counts));
  const counts = await get("/api/admin/contact-messages?counts=1", H);
  check("7c. counts only: no name, address or text", counts.status === 200 && !/example\.com|Pat|Made Up|mock/.test(counts.text) && JSON.parse(counts.text).counts.contact === 5, counts.text);

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((err) => { console.error(err); process.exit(1); });
