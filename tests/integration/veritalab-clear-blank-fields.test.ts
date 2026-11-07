// tests/integration/veritalab-clear-blank-fields.test.ts
//
// STANDING integration test: emptying a box on a VeritaLab certificate clears it. The screen sends null for an empty
// box, and both edit routes used `sent ?? existing`, so a blank put the old value straight back (found 2026-11-06 when
// a certificate with no expiration needed its date removed). A field the request leaves out still stays as it is, and
// a certificate with no expiration date has no reminders waiting.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritalab-clear-blank-fields

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

const FULL = {
  cert_type: "other",
  cert_name: "IT Certificate",
  cert_number: "IT-100",
  issuing_body: "IT Issuer",
  issued_date: "2026-01-15",
  expiration_date: "2030-06-30",
  lab_director: "IT Director",
  notes: "IT note",
};
const CLEARABLE = ["cert_number", "issuing_body", "issued_date", "expiration_date", "lab_director", "notes"] as const;

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
  const PW = ["Ve", "ri", "7x!"].join("-");
  const email = `it-cert-blank-${Date.now()}@example.com`;

  try {
    const reg = await req("POST", "/api/auth/register", { email, password: PW, name: "IT Owner", hipaa_acknowledged: true });
    const ownerId = Number(reg.body?.user?.id);
    const labId = Number((await req("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "IT Cert Lab", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(ownerId);
    const token = (await req("POST", "/api/auth/login", { email, password: PW })).body?.token as string;
    check("0. an owner, a lab and a sign-in", ownerId > 0 && labId > 0 && !!token);

    const labHeader = { "X-Active-Lab-Id": String(labId) };
    const row = (id: number) => sqlite.prepare("SELECT * FROM lab_certificates WHERE id = ?").get(id) as any;
    const reminders = (id: number) => (sqlite.prepare("SELECT COUNT(*) AS n FROM lab_certificate_reminders WHERE certificate_id = ?").get(id) as any).n as number;
    const blankBody = { cert_type: FULL.cert_type, cert_name: FULL.cert_name, ...Object.fromEntries(CLEARABLE.map((k) => [k, null])) };

    for (const [label, listPath, itemPath] of [
      ["lab-scoped route", `/api/labs/${labId}/veritalab/certificates`, (id: number) => `/api/labs/${labId}/veritalab/certificates/${id}`],
      ["older route", "/api/veritalab/certificates", (id: number) => `/api/veritalab/certificates/${id}`],
    ] as const) {
      const made = await req("POST", listPath, FULL, token, labHeader);
      const id = Number(made.body?.id);
      check(`1. ${label}: a certificate with every field, and reminders waiting`, made.status < 300 && id > 0 && reminders(id) > 0, `status=${made.status} reminders=${id ? reminders(id) : "none"}`);

      const blanked = await req("PUT", itemPath(id), blankBody, token, labHeader);
      const after = row(id);
      const stillSet = CLEARABLE.filter((k) => after?.[k] != null);
      check(`2. ${label}: every emptied box is cleared`, blanked.status === 200 && stillSet.length === 0, `status=${blanked.status} still set: ${stillSet.join(", ")}`);
      check(`3. ${label}: no expiration date, no reminders waiting`, reminders(id) === 0, `reminders=${reminders(id)}`);
      check(`4. ${label}: the name and type stay`, after?.cert_name === FULL.cert_name && after?.cert_type === FULL.cert_type);

      await req("PUT", itemPath(id), FULL, token, labHeader);
      const refilled = row(id);
      check(`5. ${label}: filling the boxes again saves them, and reminders come back`, CLEARABLE.every((k) => refilled?.[k] === FULL[k]) && reminders(id) > 0, JSON.stringify(CLEARABLE.map((k) => refilled?.[k])));

      const partial = await req("PUT", itemPath(id), { notes: "IT new note" }, token, labHeader);
      const kept = row(id);
      check(`6. ${label}: a field left out of the request stays`, partial.status === 200 && kept?.notes === "IT new note" && CLEARABLE.filter((k) => k !== "notes").every((k) => kept?.[k] === FULL[k]) && reminders(id) > 0, JSON.stringify(kept));

      await req("PUT", itemPath(id), { expiration_date: "" }, token, labHeader);
      check(`7. ${label}: an empty string also clears, stored as nothing`, row(id)?.expiration_date === null && reminders(id) === 0, JSON.stringify(row(id)?.expiration_date));
    }
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
