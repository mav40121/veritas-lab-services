// tests/integration/correlation-run-details.test.ts
//
// STANDING integration test for correlation run details (2026-10-26): a Correlation / Method Comparison study saves
// run_details (specimen type; reagent lot, calibrator lot, date run per analyzer), units and comment; the lab-scoped
// GET returns them; an edit replaces them and null clears them; an amendment of a signed study carries them over;
// a signed study refuses an edit (409) like every other field.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:correlation-run-details

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
  const PW = ["Cr", "rd", "7x!"].join("-");
  const email = `it-runs-${Date.now()}@example.com`;
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };

  try {
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "IT Runs", hipaa_acknowledged: true });
    const userId = Number(reg.body?.user?.id);
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT Runs Lab", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const token = (await call("POST", "/api/auth/login", { email, password: PW })).body?.token as string;
    check("0. lab made", labId > 0 && !!token);

    const names = ["Analyzer A", "Analyzer B"];
    const dp = [[120, 122], [130, 128], [140, 143], [150, 151], [160, 158]].map((r, i) => ({ level: i + 1, expectedValue: r[0], instrumentValues: { "Analyzer B": r[1] } }));
    const run1 = JSON.stringify({ specimenType: "Serum", instruments: { "Analyzer A": { reagentLot: "RA-1", calibratorLot: "CA-1", dateRun: "2026-10-20" }, "Analyzer B": { reagentLot: "RB-1", dateRun: "2026-10-21" } } });
    const base1 = {
      testName: "IT Sodium", instrument: names.join(", "), analyst: "IT", date: "2026-10-21", studyType: "method_comparison",
      cliaAllowableError: 4, teaIsPercentage: 0, teaUnit: "mmol/L", dataPoints: JSON.stringify(dp), instruments: JSON.stringify(names),
      status: "completed", createdAt: new Date().toISOString(),
    };
    const created = await call("POST", `/api/labs/${labId}/studies`, { ...base1, runDetails: run1, resultUnits: "mmol/L", comment: "Split samples" }, token, labId);
    const id = Number(created.body?.id);
    check("1. a correlation study saves with run details", (created.status === 200 || created.status === 201) && id > 0, `status=${created.status} ${JSON.stringify(created.body).slice(0, 200)}`);
    const got = (await call("GET", `/api/labs/${labId}/studies/${id}`, undefined, token, labId)).body;
    check("2. GET returns run details, units and comment", got.runDetails === run1 && got.resultUnits === "mmol/L" && got.comment === "Split samples", JSON.stringify({ r: got.runDetails, u: got.resultUnits, c: got.comment }));

    const run2 = JSON.stringify({ specimenType: "Plasma", instruments: { "Analyzer A": { reagentLot: "RA-2" } } });
    const put = await call("PUT", `/api/labs/${labId}/studies/${id}`, { ...base1, runDetails: run2, resultUnits: "mEq/L", comment: "Rerun" }, token, labId);
    const after = sqlite.prepare("SELECT run_details, result_units, comment FROM studies WHERE id = ?").get(id) as any;
    check("3. an edit replaces them", put.status === 200 && after.run_details === run2 && after.result_units === "mEq/L" && after.comment === "Rerun", `status=${put.status} ${JSON.stringify(after)}`);
    await call("PUT", `/api/labs/${labId}/studies/${id}`, { ...base1, runDetails: null, resultUnits: null, comment: null }, token, labId);
    const cleared = sqlite.prepare("SELECT run_details, result_units, comment FROM studies WHERE id = ?").get(id) as any;
    check("4. null clears them", cleared.run_details === null && cleared.result_units === null && cleared.comment === null, JSON.stringify(cleared));
    const keep = await call("PUT", `/api/labs/${labId}/studies/${id}`, { ...base1, runDetails: run2 }, token, labId);
    await call("PUT", `/api/labs/${labId}/studies/${id}`, { ...base1 }, token, labId);
    check("5. an edit that does not send them leaves them alone", keep.status === 200 && (sqlite.prepare("SELECT run_details FROM studies WHERE id = ?").get(id) as any).run_details === run2);

    const junk = await call("PUT", `/api/labs/${labId}/studies/${id}`, { ...base1, runDetails: '{"specimenType":"  ","instruments":{"Analyzer A":{"reagentLot":"","dateRun":"not a date"}},"extra":"<script>"}' }, token, labId);
    check("5b. the server stores only the normalized shape (blanks, bad dates and unknown keys dropped)", junk.status === 200 && (sqlite.prepare("SELECT run_details FROM studies WHERE id = ?").get(id) as any).run_details === null);
    await call("PUT", `/api/labs/${labId}/studies/${id}`, { ...base1, runDetails: run2 }, token, labId);
    sqlite.prepare("UPDATE studies SET lifecycle_state = 'finalized' WHERE id = ?").run(id);
    const locked = await call("PUT", `/api/labs/${labId}/studies/${id}`, { ...base1, runDetails: run1 }, token, labId);
    check("6. a signed study refuses the edit", locked.status === 409 && (sqlite.prepare("SELECT run_details FROM studies WHERE id = ?").get(id) as any).run_details === run2, `status=${locked.status}`);
    const amend = await call("POST", `/api/labs/${labId}/studies/${id}/amend`, {}, token, labId);
    const amendId = Number(amend.body?.id);
    const amended = amendId ? sqlite.prepare("SELECT run_details, amends_study_id FROM studies WHERE id = ?").get(amendId) as any : null;
    check("7. an amendment carries the run details over", amend.status === 200 && amended?.run_details === run2 && amended?.amends_study_id === id, `status=${amend.status} ${JSON.stringify(amended)}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
