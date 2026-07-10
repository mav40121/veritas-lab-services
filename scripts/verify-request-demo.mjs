// scripts/verify-request-demo.mjs
//
// Receipt for the "Request a live demo" form on /demo (2026-07-10). A centered
// hero button opens a modal (name, work email, organization, phone, message) that
// POSTs to /api/request-demo, which emails info@veritaslabservices.com (fixed
// recipient) and stores the lead in contact_messages.
//
//   node scripts/verify-request-demo.mjs             source assertions
//   BASE=https://www.veritaslabservices.com node ... + live endpoint checks
//        (the valid-submit case sends ONE real email to info@; negative cases do not)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// --- server: endpoint exists + fixed recipient + Resend + durable store ---
const routes = read("server/routes.ts");
ok("routes.ts: POST /api/request-demo defined", /app\.post\("\/api\/request-demo"/.test(routes));
const ep = routes.slice(routes.indexOf('/api/request-demo'), routes.indexOf('/api/request-demo') + 3000);
ok("endpoint: fixed recipient info@veritaslabservices.com", /to:\s*"info@veritaslabservices\.com"/.test(ep));
ok("endpoint: reply_to is the prospect email", /reply_to:\s*cleanEmail/.test(ep));
ok("endpoint: durable store via createContactMessage", /createContactMessage/.test(ep));
ok("endpoint: validates name + email", /Name is required/.test(ep) && /valid email is required/.test(ep));

// --- client: button + modal + fetch wiring ---
const page = read("client/src/pages/DemoSelectorPage.tsx");
ok("DemoSelectorPage: 'Request a live demo' hero button", /Request a live demo/.test(page));
ok("DemoSelectorPage: POSTs to /api/request-demo", /fetch\("\/api\/request-demo"/.test(page));
for (const f of ["Name", "Work email", "Lab or organization", "Phone"]) {
  ok(`DemoSelectorPage: form has "${f}" field`, page.includes(f));
}
ok("DemoSelectorPage: success + error states handled", /Thanks, we will be in touch/.test(page) && /setStatus\("error"\)/.test(page));

// --- optional live endpoint checks ---
const BASE = process.env.BASE || "";
if (!BASE) {
  console.log("\n(skip live: set BASE to exercise the endpoint)");
  console.log(fails === 0 ? "\n=== REQUEST DEMO (source): PASS ===" : `\n=== ${fails} FAIL ===`);
  process.exit(fails === 0 ? 0 : 1);
}
const post = (body) => fetch(`${BASE}/api/request-demo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
ok("live: missing name -> 400", (await post({ email: "x@y.com" })).status === 400);
ok("live: bad email -> 400", (await post({ name: "Test", email: "nope" })).status === 400);
const good = await post({ name: "Gate 3 automated check", email: "gate3-test@veritaslabservices.com", organization: "Automated test (please ignore)", message: "Automated Gate 3 verification submission." });
const gj = await good.json().catch(() => ({}));
ok("live: valid submit -> 200 {ok:true} (sends one test email to info@)", good.status === 200 && gj.ok === true);

console.log(fails === 0 ? "\n=== REQUEST DEMO (source + live): PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
