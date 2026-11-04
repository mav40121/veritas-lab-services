// tests/integration/histology-maintain-entries.test.ts
//
// STANDING integration test for two VeritaMaintain records a histology lab needs (Michael 2026-11-04, Q161 = 1):
//   1. A solution change on a stainer (CAP ANP.21360): it needs who did it and which solutions, it reads back on the history, and
//      it never moves the PM next-due date, even if a date is sent. A PM entry still does.
//   2. A humidity unit (CAP COM.30580): it reads in percent relative humidity, only a humidity unit can use that scale, the limits
//      stay between 0 and 100, and a change can't leave a type and scale that don't match. Readings work the same way as temperature.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:histology-maintain-entries

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";

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
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Histo", "chk", "77!"].join("-");
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  try {
    const email = `histo-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Histo Owner", hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Histo Lab", plan: "hospital", isWarehouse: true });
    const token = reg.body.token as string;
    const L = `/api/labs/${prov.body.labId}`;

    // 1. Solution change
    const made = await call("POST", `${L}/equipment`, { instrument_name: "Made-up autostainer", pm_interval_days: 180, next_due_date: "2027-01-01" }, token);
    const id = made.body.id;
    check("1. the stainer saves with a PM date", [200, 201].includes(made.status) && !!id, `HTTP ${made.status}`);
    const E = `${L}/equipment/${id}/events`;
    const noWho = await call("POST", E, { event_type: "solution_change", event_date: "2026-11-02", notes: "Changed: Hematoxylin" }, token);
    check("1. a solution change without who did it is refused", noWho.status === 400, `HTTP ${noWho.status}`);
    const noWhat = await call("POST", E, { event_type: "solution_change", event_date: "2026-11-02", performed_by: "MU" }, token);
    check("1. a solution change without which solutions is refused", noWhat.status === 400, `HTTP ${noWhat.status}`);
    const saved = await call("POST", E, { event_type: "solution_change", event_date: "2026-11-02", performed_by: "MU", notes: "Changed: Hematoxylin, eosin", next_due_date: "2030-01-01" }, token);
    check("1. a solution change saves", saved.status === 200, `HTTP ${saved.status}`);
    check("1. it does not move the PM date, even when a date is sent", saved.body.next_due_date === "2027-01-01", saved.body.next_due_date);
    const hist = await call("GET", E, undefined, token);
    const rows: any[] = Array.isArray(hist.body) ? hist.body : hist.body.events || [];
    const row = rows.find((r) => r.event_type === "solution_change");
    check("1. it reads back on the history", row?.performed_by === "MU" && row?.notes === "Changed: Hematoxylin, eosin" && !row?.next_due_date, JSON.stringify(row));
    const pm = await call("POST", E, { event_type: "preventive_maintenance", event_date: "2026-11-02" }, token);
    check("1. a PM entry still moves the date by the interval", pm.status === 200 && pm.body.next_due_date === "2027-05-01", pm.body.next_due_date);
    const madeUpType = await call("POST", E, { event_type: "stain_party", event_date: "2026-11-02" }, token);
    check("1. a made-up entry type is refused", madeUpType.status === 400, `HTTP ${madeUpType.status}`);

    // 2. Humidity
    const U = `${L}/temp-logs/units`;
    const hum = await call("POST", U, { name: "Made-up histology room", unit_type: "humidity", scale: "RH", min_value: 30, max_value: 60 }, token);
    check("2. a humidity unit saves in percent relative humidity", hum.status === 201 && hum.body.scale === "RH" && hum.body.unit_type === "humidity", `HTTP ${hum.status}`);
    const humC = await call("POST", U, { name: "Bad", unit_type: "humidity", scale: "C", min_value: 30, max_value: 60 }, token);
    check("2. a humidity unit in degrees is refused", humC.status === 400, `HTTP ${humC.status}`);
    const humNone = await call("POST", U, { name: "Bad", unit_type: "humidity", min_value: 30, max_value: 60 }, token);
    check("2. a humidity unit with no scale is refused", humNone.status === 400, `HTTP ${humNone.status}`);
    const fridgeRh = await call("POST", U, { name: "Bad", unit_type: "refrigerator", scale: "RH", min_value: 2, max_value: 8 }, token);
    check("2. a refrigerator in percent is refused", fridgeRh.status === 400, `HTTP ${fridgeRh.status}`);
    const plain = await call("POST", U, { name: "Made-up refrigerator", min_value: 2, max_value: 8 }, token);
    check("2. a unit with no type or scale is still a Celsius refrigerator", plain.status === 201 && plain.body.scale === "C" && plain.body.unit_type === "refrigerator", JSON.stringify({ s: plain.body.scale, t: plain.body.unit_type }));
    const over = await call("POST", U, { name: "Bad", unit_type: "humidity", scale: "RH", min_value: 20, max_value: 120 }, token);
    const under = await call("POST", U, { name: "Bad", unit_type: "humidity", scale: "RH", min_value: -5, max_value: 60 }, token);
    check("2. humidity limits outside 0 to 100 are refused", over.status === 400 && under.status === 400, `${over.status}/${under.status}`);
    const fridge = `${U}/${plain.body.id}`;
    const typeOnly = await call("PUT", fridge, { unit_type: "humidity" }, token);
    check("2. changing only the type can't leave degrees on a humidity unit", typeOnly.status === 400, `HTTP ${typeOnly.status}`);
    const scaleOnly = await call("PUT", fridge, { scale: "RH" }, token);
    check("2. changing only the scale can't leave percent on a refrigerator", scaleOnly.status === 400, `HTTP ${scaleOnly.status}`);
    const both = await call("PUT", fridge, { unit_type: "humidity", scale: "RH", min_value: 30, max_value: 60 }, token);
    check("2. changing both together works", both.status === 200 && both.body.scale === "RH", `HTTP ${both.status}`);
    const retired = await call("PUT", fridge, { active: false }, token);
    check("2. retiring a humidity unit still works", retired.status === 200 && retired.body.active === 0, `HTTP ${retired.status}`);

    const R = `${U}/${hum.body.id}/readings`;
    const good = await call("POST", R, { value: 45, initials: "mu" }, token);
    check("2. an in-range reading records with initials", good.status === 201 && good.body.in_range === 1 && good.body.initials === "MU", `HTTP ${good.status}`);
    const high = await call("POST", R, { value: 75, initials: "mu" }, token);
    check("2. out of range needs the corrective action", high.status === 400 && high.body.code === "CORRECTIVE_ACTION_REQUIRED", `HTTP ${high.status}`);
    const fixed = await call("POST", R, { value: 75, initials: "mu", corrective_action: "Called facilities" }, token);
    check("2. with the corrective action it records as out of range", fixed.status === 201 && fixed.body.in_range === 0, `HTTP ${fixed.status}`);
    const log = await call("GET", R, undefined, token);
    check("2. the month log shows both readings and the unit's scale", log.body.readings?.length === 2 && log.body.unit?.scale === "RH", `${log.body.readings?.length}`);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
