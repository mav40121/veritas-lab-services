// tests/integration/manual-method-groups.test.ts
//
// STANDING integration test for grouping manual tests (Michael 2026-11-04, Q166 = 1, from a Redington request about Mono and AmniSure).
//   1. Two manual tests of one complexity can be grouped.
//   2. A manual test can never be grouped with an analyzer, in either order. This keeps the BUG-043 protection.
//   3. Different complexity is refused, for manual tests too. Waived stays separate.
//   4. Manual tests are never suggested. Analyzers still are.
//   5. One competency covers the group: a person on both tests has one method, and one on a test plus an analyzer has two.
//   6. Splitting the group puts both tests back on their own.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:manual-method-groups

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
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Manual", "chk", "77!"].join("-");
  const now = new Date().toISOString();
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  try {
    const email = `manual-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Owner Madeup", hipaa_acknowledged: true });
    const T = reg.body.token as string;
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Manual Lab", plan: "hospital", isWarehouse: true })).body.labId as number;
    const L = `/api/labs/${labId}`;
    const row = sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(labId) as any;
    const staffLab = row?.id ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Manual Lab', '22D0000777', ?, ?, ?)").run(userId, labId, now, now).lastInsertRowid);
    const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, T)).body.id as number;
    const addInstrument = (name: string, category: string, complexity: string, analyte: string) => {
      const id = Number(sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?, ?, 'Primary', ?, ?)").run(mapId, name, category, now).lastInsertRowid);
      sqlite.prepare("INSERT INTO veritamap_instrument_tests (map_id, instrument_id, analyte, specialty, complexity, active) VALUES (?, ?, ?, 'General', ?, 1)").run(mapId, id, analyte, complexity);
      return id;
    };
    const mono = addInstrument("Made-up Mono Kit", "Manual Procedures", "MODERATE", "Heterophile");
    const amni = addInstrument("Made-up ROM Kit", "Manual Procedures", "MODERATE", "ROM");
    const quik = addInstrument("Made-up Giardia Kit", "Manual Procedures", "MODERATE", "Giardia");
    const occult = addInstrument("Made-up Occult Blood (Manual)", "Manual Procedures", "WAIVED", "Occult Blood");
    const tube = addInstrument("Made-up Tube Method", "Blood Bank", "HIGH", "ABO");
    const twinA = addInstrument("Made-up Twin Kit Primary", "Manual Procedures", "MODERATE", "Twin A");
    const twinB = addInstrument("Made-up Twin Kit Backup", "Manual Procedures", "MODERATE", "Twin B");
    const xnA = addInstrument("XN-1000", "Hematology", "MODERATE", "WBC");
    const xnB = addInstrument("XN-450", "Hematology", "MODERATE", "RBC");
    const G = `${L}/competency/method-groups`;
    const group = (name: string, instrumentIds: number[]) => call("POST", G, { name, instrumentIds }, T);

    const before = (await call("GET", G, undefined, T)).body;
    check("setup: the kits read as manual and the analyzers don't", before.instruments?.find((i: any) => i.id === mono)?.manual === true && before.instruments?.find((i: any) => i.id === xnA)?.manual === false, JSON.stringify(before.error ?? ""));

    // 4. Suggestions
    const suggested = (before.suggestions || []).flatMap((s: any) => s.members.map((m: any) => m.id));
    check("4. Analyzers are still suggested", suggested.includes(xnA) && suggested.includes(xnB), JSON.stringify(suggested));
    check("4. Manual tests are never suggested", ![mono, amni, quik, occult, tube, twinA, twinB].some((id) => suggested.includes(id)));

    // 2. Manual with an analyzer
    for (const ids of [[mono, xnA], [xnA, mono]]) {
      const r = await group("Mixed", ids);
      check(`2. A manual test and an analyzer are refused (${ids[0] === mono ? "manual first" : "analyzer first"})`, r.status === 400 && /manual method/.test(r.body.error || ""), `HTTP ${r.status} ${r.body.error ?? ""}`);
    }
    const three = await group("Mixed three", [mono, amni, xnA]);
    check("2. Two manual tests and an analyzer are refused", three.status === 400, `HTTP ${three.status}`);

    // 3. Complexity
    const waived = await group("Waived mix", [mono, occult]);
    check("3. A waived manual test stays separate", waived.status === 400 && /waived/.test(waived.body.error || ""), `HTTP ${waived.status} ${waived.body.error ?? ""}`);
    const high = await group("High mix", [mono, tube]);
    check("3. Moderate and high manual tests are refused", high.status === 400 && /complexity/.test(high.body.error || ""), `HTTP ${high.status} ${high.body.error ?? ""}`);
    const one = await group("One", [mono]);
    check("3. One test alone is refused", one.status === 400 && /at least two/.test(one.body.error || ""), `HTTP ${one.status}`);
    check("2. Nothing refused was saved", (sqlite.prepare("SELECT COUNT(*) AS n FROM competency_instrument_groups WHERE lab_id = ?").get(labId) as any).n === 0);

    // 1. Manual with manual
    const made = await group("Rapid kits", [mono, amni]);
    check("1. Two moderate manual tests can be grouped", made.status === 200 && !!made.body.groupId, `HTTP ${made.status} ${made.body.error ?? ""}`);
    const after = (await call("GET", G, undefined, T)).body;
    const g = after.groups?.find((x: any) => x.id === made.body.groupId);
    check("1. The group lists both, marked manual", g?.members?.length === 2 && g.members.every((m: any) => m.manual === true), JSON.stringify(g?.members?.map((m: any) => m.name)));
    const taken = await group("Again", [mono, quik]);
    check("1. A test already in a group can't join another", taken.status === 409, `HTTP ${taken.status}`);

    // 5. One competency
    const person = (first: string, instruments: number[]) => {
      const id = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, hire_date, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, 'Madeup', ?, '2020-01-05', 1, 'active', ?, ?)").run(staffLab, labId, userId, first, now, now).lastInsertRowid);
      for (const i of instruments) sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at, created_by_user_id) VALUES (?, ?, ?, ?)").run(id, i, now, userId);
      return id;
    };
    const methods = async (id: number) => (await call("GET", `${L}/competency/employee/${id}`, undefined, T)).body.testSystems || [];
    const both = await methods(person("Both", [mono, amni]));
    check("5. Someone on both tests has one method", both.length === 1, `${both.length} methods`);
    const mixed = await methods(person("Mixed", [mono, xnA]));
    check("5. Someone on a test and an analyzer has two, so the analyzer doesn't cover the test", mixed.length === 2, `${mixed.length} methods`);
    const single = await methods(person("Single", [amni]));
    check("5. Someone on one test of the group still sees it as the group", single.length === 1, `${single.length} methods`);

    // 6. Split
    const split = await call("DELETE", `${G}/${made.body.groupId}`, undefined, T);
    check("6. The group can be split", split.status === 200, `HTTP ${split.status}`);
    check("6. Both tests are their own methods again", (await methods(person("Again", [mono, amni]))).length === 2);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
