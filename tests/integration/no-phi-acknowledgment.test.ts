// tests/integration/no-phi-acknowledgment.test.ts
//
// BUG-083 (Michael Q66 = 1, 2026-10-28): owner accounts Veritas set up (provision-owner-lab, the invoice-request form)
// had the no-PHI acknowledgment recorded on the owner's behalf. Those paths no longer record it; anyone whose
// acknowledgment is not their own click is asked once at sign-in, and the record holds that click's time. This pins:
//   1. self sign-up is the person's own click (source 'signup'); never asked again
//   2. provision-owner-lab and the invoice request leave it unrecorded, so the owner is asked
//   3. the sign-in acknowledgment needs the box checked, records ack + time + source 'self', and a second click keeps
//      the first time; Getting Started and the admin report count only the person's own click
//   4. existing rows are classified once: provision-owner-lab's stamp (equal to the lab's created_at) and the invoice
//      request's stamp (within a minute of its request) are 'on_behalf' and asked; every other acknowledgment is 'signup'
//   5. the shared demo account is never asked; signed-out calls are refused
// Run: npm run test:no-phi-acknowledgment

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { classifyExistingNoPhiAcknowledgments } from "../../server/noPhiAcknowledgment";
import { DEMO_USER_EMAIL } from "../../server/constants";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const call = async (method: string, p: string, body?: any, token?: string, extra: Record<string, string> = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const svc = (uid: number) => jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const row = (id: number) => sqlite.prepare("SELECT hipaa_acknowledged AS ack, hipaa_acknowledged_at AS at, hipaa_ack_source AS src FROM users WHERE id = ?").get(id) as any;
  const idOf = (email: string) => Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
  const pw = ["Zq", "nophi", "7x!"].join("-");
  const stamp = Date.now();

  try {
    const cols = (sqlite.prepare("PRAGMA table_info(users)").all() as any[]).map((c) => c.name);
    check("boot migration added users.hipaa_ack_source", cols.includes("hipaa_ack_source"));

    // 1. Self sign-up
    const selfEmail = `it-nophi-self-${stamp}@example.com`;
    await call("POST", "/api/auth/register", { email: selfEmail, password: pw, name: "IT Self", hipaa_acknowledged: true });
    const selfId = idOf(selfEmail);
    const selfRow = row(selfId);
    check("1. self sign-up records the person's own click (ack 1, source signup)", selfRow?.ack === 1 && selfRow?.src === "signup" && !!selfRow?.at, JSON.stringify(selfRow));
    const selfStatus = await call("GET", "/api/auth/no-phi-acknowledgment", undefined, svc(selfId));
    check("1. a self sign-up is not asked at sign-in", selfStatus.status === 200 && selfStatus.body.needed === false && selfStatus.body.source === "signup", JSON.stringify(selfStatus.body));
    const selfAgain = await call("POST", "/api/auth/no-phi-acknowledgment", { acknowledged: true }, svc(selfId));
    check("1. clicking again changes nothing for a self sign-up", selfAgain.body.recorded === false && row(selfId).at === selfRow.at && row(selfId).src === "signup");

    // 2. provision-owner-lab
    const provEmail = `it-nophi-prov-${stamp}@example.com`;
    const prov = await call("POST", "/api/admin/provision-owner-lab", { secret: ADMIN, ownerEmail: provEmail, ownerName: "IT Provisioned", labName: "IT NoPhi Lab", plan: "hospital" });
    const provId = Number(prov.body.owner_user_id);
    const provLab = Number(prov.body.lab_id);
    check("2. provision-owner-lab still creates the owner and lab", prov.status === 200 && provId > 0 && provLab > 0, JSON.stringify(prov.body).slice(0, 200));
    const provRow = row(provId);
    check("2. provision-owner-lab no longer records the acknowledgment for the owner", Number(provRow?.ack) === 0 && !provRow?.at && provRow?.src == null, JSON.stringify(provRow));
    const provStatus = await call("GET", "/api/auth/no-phi-acknowledgment", undefined, svc(provId));
    check("2. the provisioned owner is asked at sign-in", provStatus.status === 200 && provStatus.body.needed === true && provStatus.body.acknowledgedAt === null, JSON.stringify(provStatus.body));

    // 3. Getting Started and the admin report before the click
    const gs = async () => {
      const r = await call("GET", `/api/labs/${provLab}/getting-started`, undefined, svc(provId), { "X-Active-Lab-Id": String(provLab) });
      return r.body?.phases?.flatMap((x: any) => x.steps).find((s: any) => s.key === "p1.hipaa");
    };
    const gsBefore = await gs();
    check("3. Getting Started shows the acknowledgment as still to do before the click", gsBefore?.status === "todo", JSON.stringify(gsBefore));

    const refused = await call("POST", "/api/auth/no-phi-acknowledgment", {}, svc(provId));
    check("3. the acknowledgment needs the box checked (400, nothing recorded)", refused.status === 400 && Number(row(provId).ack) === 0);
    const before = Date.now();
    const agreed = await call("POST", "/api/auth/no-phi-acknowledgment", { acknowledged: true }, svc(provId));
    const after = Date.now();
    const agreedRow = row(provId);
    const t = Date.parse(agreed.body.acknowledgedAt);
    check("3. the click records ack 1, the click's time and source self", agreed.status === 200 && agreed.body.recorded === true && agreedRow.ack === 1 && agreedRow.src === "self" && agreedRow.at === agreed.body.acknowledgedAt && t >= before - 1000 && t <= after + 1000, JSON.stringify({ body: agreed.body, agreedRow }));
    const second = await call("POST", "/api/auth/no-phi-acknowledgment", { acknowledged: true }, svc(provId));
    check("3. a second click keeps the first click's time", second.body.recorded === false && row(provId).at === agreedRow.at);
    const provAfter = await call("GET", "/api/auth/no-phi-acknowledgment", undefined, svc(provId));
    check("3. after the click the owner is not asked again", provAfter.body.needed === false && provAfter.body.source === "self" && provAfter.body.acknowledgedAt === agreedRow.at, JSON.stringify(provAfter.body));
    const gsAfter = await gs();
    check("3. Getting Started shows it done after the click", gsAfter?.status === "done", JSON.stringify(gsAfter));

    // 2b. The invoice-request form (billing contact; no acknowledgment on the form)
    const invEmail = `it-nophi-inv-${stamp}@example.com`;
    const inv = await call("POST", "/api/invoice/request", {
      lab_name: "IT Invoice Lab", billing_contact_name: "IT Billing", billing_contact_email: invEmail, billing_address: "1 Test St, Upton, MA",
      tier: "clinic", seats: 2, authorization: true,
    });
    const invId = idOf(invEmail);
    const invRow = invId ? row(invId) : null;
    check("2. the invoice request creates the account without recording the acknowledgment", inv.status >= 200 && inv.status < 300 && invId > 0 && Number(invRow?.ack) === 0 && !invRow?.at, JSON.stringify({ status: inv.status, invRow, err: inv.body?.error }));
    const invStatus = invId ? await call("GET", "/api/auth/no-phi-acknowledgment", undefined, svc(invId)) : { body: {} as any };
    check("2. the invoice-request account holder is asked at sign-in", invStatus.body.needed === true, JSON.stringify(invStatus.body));

    // 4. Existing rows, classified once (the boot migration's function, run on made-up legacy rows)
    const mkLegacy = (tag: string, ack: number, at: string | null) => {
      const email = `it-nophi-legacy-${tag}-${stamp}@example.com`;
      sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, created_at, hipaa_acknowledged, hipaa_acknowledged_at, hipaa_ack_source) VALUES (?, 'x', ?, 'free', ?, ?, ?, NULL)")
        .run(email, `Legacy ${tag}`, at || new Date().toISOString(), ack, at);
      return idOf(email);
    };
    const T0 = "2026-10-01T15:00:00.000Z";
    const provLegacy = mkLegacy("prov", 1, T0);
    sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, created_at, updated_at) VALUES ('Legacy Prov Lab', ?, 'hospital', ?, ?)").run(provLegacy, T0, T0);
    const T1 = "2026-06-01T12:00:00.000Z";
    const invLegacy = mkLegacy("inv", 1, T1);
    const invReq = (uid: number, created: string) => sqlite.prepare(`INSERT INTO invoice_requests (user_id, lab_name, billing_contact_name, billing_contact_email, billing_address, tier, seats, discount_pct, trial_days, status, created_at)
      VALUES (?, 'Legacy Inv Lab', 'B', 'b@example.com', 'addr', 'clinic', 1, 0, 0, 'pending', ?)`).run(uid, created);
    invReq(invLegacy, "2026-06-01T12:00:00.420Z");
    const T2 = "2026-05-01T09:00:00.000Z";
    const selfThenInvoice = mkLegacy("self-inv", 1, T2);
    invReq(selfThenInvoice, "2026-05-04T09:00:00.000Z");
    const T3 = "2026-04-01T09:00:00.000Z";
    const selfThenLab = mkLegacy("self-lab", 1, T3);
    sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, created_at, updated_at) VALUES ('Legacy Self Lab', ?, 'clinic', ?, ?)").run(selfThenLab, "2026-04-01T09:04:12.000Z", "2026-04-01T09:04:12.000Z");
    const never = mkLegacy("never", 0, null);
    const counts = classifyExistingNoPhiAcknowledgments(sqlite);
    check("4. provision-owner-lab's stamp (equal to the lab's created_at) is set up by Veritas", row(provLegacy).src === "on_behalf", JSON.stringify(row(provLegacy)));
    check("4. the invoice request's stamp (within a minute of the request) is set up by Veritas", row(invLegacy).src === "on_behalf", JSON.stringify(row(invLegacy)));
    check("4. a sign-up who later requested an invoice keeps their own click", row(selfThenInvoice).src === "signup");
    check("4. a sign-up who created their lab minutes later keeps their own click", row(selfThenLab).src === "signup");
    check("4. a never-acknowledged account stays unrecorded", row(never).src == null && Number(row(never).ack) === 0);
    check("4. classify counts the two set-up rows and the two sign-ups", counts.onBehalf === 2 && counts.signup === 2, JSON.stringify(counts));
    const again = classifyExistingNoPhiAcknowledgments(sqlite);
    check("4. classifying again changes nothing", again.onBehalf === 0 && again.signup === 0, JSON.stringify(again));
    for (const [label, id] of [["set up by Veritas (provision)", provLegacy], ["set up by Veritas (invoice)", invLegacy], ["never acknowledged", never]] as const) {
      const s = await call("GET", "/api/auth/no-phi-acknowledgment", undefined, svc(id));
      check(`4. ${label}: asked at sign-in`, s.body.needed === true, JSON.stringify(s.body));
    }
    const s2 = await call("GET", "/api/auth/no-phi-acknowledgment", undefined, svc(selfThenInvoice));
    check("4. an existing sign-up: not asked", s2.body.needed === false);

    const report = await call("GET", "/api/admin/report", undefined, undefined, { "x-admin-secret": ADMIN });
    const users = (report.body.users || report.body.rows || (Array.isArray(report.body) ? report.body : [])) as any[];
    const ackOf = (id: number) => users.find((u) => Number(u.id) === id)?.hipaa_acknowledged;
    check("3. admin report: HIPAA Ack is No for an acknowledgment Veritas recorded", report.status === 200 && Number(ackOf(provLegacy)) === 0, JSON.stringify({ status: report.status, v: ackOf(provLegacy), keys: Object.keys(report.body || {}).slice(0, 6) }));
    check("3. admin report: HIPAA Ack is Yes for the person's own click", Number(ackOf(provId)) === 1 && Number(ackOf(selfThenInvoice)) === 1);

    // 5. Demo account, signed out
    // The demo seed does not run in tests; the shared demo account is written the way seedDemo.ts writes it (no acknowledgment).
    if (!idOf(DEMO_USER_EMAIL)) sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, created_at) VALUES (?, 'x', 'Demo User', 'lab', ?)").run(DEMO_USER_EMAIL, new Date().toISOString());
    const demoId = idOf(DEMO_USER_EMAIL);
    const d = await call("GET", "/api/auth/no-phi-acknowledgment", undefined, svc(demoId));
    const dp = await call("POST", "/api/auth/no-phi-acknowledgment", { acknowledged: true }, svc(demoId));
    check("5. the shared demo account is never asked and nothing is recorded on it", d.body.needed === false && dp.body.recorded === false && Number(row(demoId).ack) !== 1, JSON.stringify({ d: d.body, dp: dp.body }));
    const anon = await call("GET", "/api/auth/no-phi-acknowledgment");
    const anonPost = await call("POST", "/api/auth/no-phi-acknowledgment", { acknowledged: true });
    check("5. signed out: both calls refused (401)", anon.status === 401 && anonPost.status === 401, `${anon.status} ${anonPost.status}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
