// tests/integration/clia-cert-lab-keyed.test.ts
//
// STANDING integration test for parking lot #92 (2026-10-26): the VeritaLab CLIA certificate is created per LAB,
// numbered from labs.clia_number. A person whose own CLIA number belongs to lab A opens lab B: lab B gets ITS OWN
// number, never A's; a repeat visit adds nothing; a certificate the lab removed is not recreated; POST
// /api/clia/confirm follows the same rule.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:clia-cert-lab-keyed

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const req = async (method: string, p: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };
  const PW = ["Cl", "ia", "7x!"].join("-");
  const register = async (tag: string) => {
    const email = `it-clia-${tag}-${Date.now()}@example.com`;
    const r = await req("POST", "/api/auth/register", { email, password: PW, name: `IT ${tag}`, hipaa_acknowledged: true });
    return { email, id: Number(r.body?.user?.id) };
  };
  const signIn = async (u: { id: number; email: string }) => {
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(u.id);
    return (await req("POST", "/api/auth/login", { email: u.email, password: PW })).body?.token as string;
  };
  const clia = (labId: number) => sqlite.prepare("SELECT id, cert_number, user_id, is_active FROM lab_certificates WHERE lab_id = ? AND cert_type = 'clia' ORDER BY id").all(labId) as any[];

  try {
    const U = await register("person");
    const O = await register("other-owner");
    const labA = Number((await req("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: U.email, labName: "IT Lab A", plan: "hospital" })).body?.labId);
    const labB = Number((await req("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: O.email, labName: "IT Lab B", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE labs SET clia_number = ? WHERE id = ?").run("11D0000001", labA);
    sqlite.prepare("UPDATE labs SET clia_number = ? WHERE id = ?").run("22D0000002", labB);
    sqlite.prepare("UPDATE users SET clia_number = '11D0000001', clia_director = 'Dr. A Director' WHERE id = ?").run(U.id);
    sqlite.prepare("DELETE FROM lab_certificates WHERE lab_id IN (?, ?)").run(labA, labB);
    await req("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId: labB, email: U.email, role: "admin", permissionsMode: "edit_all" });
    const uTok = await signIn(U);
    check("0. two labs, the person owns A and belongs to B", labA > 0 && labB > 0 && !!uTok);

    // 1) The person opens lab B.
    const g1 = await req("GET", "/api/veritalab/certificates", undefined, uTok, { "X-Active-Lab-Id": String(labB) });
    const b1 = clia(labB);
    check("1a. lab B gets one CLIA certificate with B's own number", g1.status === 200 && b1.length === 1 && b1[0].cert_number === "22D0000002", `status=${g1.status} ${JSON.stringify(b1)}`);
    check("1b. it is owned by lab B's owner, and the person's director name is not copied onto B", b1[0]?.user_id === O.id && !sqlite.prepare("SELECT lab_director FROM lab_certificates WHERE id = ?").get(b1[0]?.id)?.lab_director, JSON.stringify(b1[0]));
    check("1c. lab A's number never lands in lab B", !b1.some((c) => c.cert_number === "11D0000001"));
    await req("GET", "/api/veritalab/certificates", undefined, uTok, { "X-Active-Lab-Id": String(labB) });
    check("1d. a repeat visit adds nothing", clia(labB).length === 1);

    // 2) The person opens their own lab A.
    await req("GET", "/api/veritalab/certificates", undefined, uTok, { "X-Active-Lab-Id": String(labA) });
    const a1 = clia(labA);
    check("2. lab A gets its own number, with the person's director name since the CLIA matches", a1.length === 1 && a1[0].cert_number === "11D0000001" && sqlite.prepare("SELECT lab_director FROM lab_certificates WHERE id = ?").get(a1[0].id)?.lab_director === "Dr. A Director", JSON.stringify(a1));

    // 3) A certificate the lab removed is not recreated.
    sqlite.prepare("UPDATE lab_certificates SET is_active = 0 WHERE lab_id = ?").run(labB);
    await req("GET", "/api/veritalab/certificates", undefined, uTok, { "X-Active-Lab-Id": String(labB) });
    check("3. a removed CLIA certificate stays removed", clia(labB).length === 1 && clia(labB)[0].is_active === 0, JSON.stringify(clia(labB)));

    // 4) The CLIA confirm path follows the same rule.
    sqlite.prepare("DELETE FROM lab_certificates WHERE lab_id = ?").run(labB);
    const conf = await req("POST", "/api/clia/confirm", { clia_number: "11D0000001", lab_director: "Dr. A Director" }, uTok, { "X-Active-Lab-Id": String(labB) });
    const b4 = clia(labB);
    check("4. confirming the person's CLIA while in lab B files B's own number, not the confirmed one", conf.status === 200 && b4.length === 1 && b4[0].cert_number === "22D0000002", `status=${conf.status} ${JSON.stringify(b4)}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
