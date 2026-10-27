// tests/integration/study-draft-save.test.ts
//
// Receipt for BUG-092 (2026-10-27): a VeritaCheck Save Draft that omits the data arrays returned HTTP 500 ("Too few
// parameter values were provided"): the draft branch defaulted dataPoints and instruments to JavaScript arrays and bound
// them into TEXT columns. The page always sends JSON text, so only API callers hit it.
//   1. a draft with only testName and studyType saves (200) with "[]" stored for both
//   2. a draft that sends the arrays as arrays saves them as JSON text
//   3. a draft that sends JSON text (what the page does) is stored as sent
//   4. the saved draft opens (GET 200) with its data readable
//
// Boots the REAL routes on a scratch DB (made-up rows only). Run: npm run test:study-draft-save
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };
  const email = `draft-${Date.now()}@example.com`;
  const reg = await j(await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "Testpass123", name: "Draft Owner", hipaa_acknowledged: true }) }));
  const labId = Number((await j(await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "Draft Lab", plan: "hospital" }) }))).labId);
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${reg.token}`, "X-Active-Lab-Id": String(labId) };
  const post = async (body: any) => { const r = await fetch(`${base}/api/labs/${labId}/studies`, { method: "POST", headers: H, body: JSON.stringify(body) }); return { status: r.status, body: await j(r) }; };
  const stored = (id: number) => sqlite.prepare("SELECT data_points, instruments, status FROM studies WHERE id = ?").get(id) as any;

  const r1 = await post({ status: "draft", testName: "Made-Up Sodium", studyType: "cal_ver" });
  const s1 = r1.body?.id ? stored(r1.body.id) : null;
  check("1. a bare draft saves with empty JSON arrays", r1.status === 200 && s1?.data_points === "[]" && s1?.instruments === "[]" && s1?.status === "draft", `status=${r1.status} ${JSON.stringify(s1 ?? r1.body).slice(0, 160)}`);

  const r2 = await post({ status: "draft", testName: "Made-Up Potassium", studyType: "cal_ver", dataPoints: [{ level: 1, expectedValue: 4, instrumentValues: { A: 4.1 } }], instruments: ["A"] });
  const s2 = r2.body?.id ? stored(r2.body.id) : null;
  check("2. arrays are stored as JSON text", r2.status === 200 && JSON.parse(s2?.data_points || "null")?.[0]?.level === 1 && s2?.instruments === '["A"]', `status=${r2.status} ${s2?.data_points}`);

  const r3 = await post({ status: "draft", testName: "Made-Up Chloride", studyType: "cal_ver", dataPoints: JSON.stringify([{ level: 2 }]), instruments: JSON.stringify(["B"]) });
  const s3 = r3.body?.id ? stored(r3.body.id) : null;
  check("3. JSON text (what the page sends) is stored as sent", r3.status === 200 && s3?.data_points === '[{"level":2}]' && s3?.instruments === '["B"]', `status=${r3.status}`);

  const g = await fetch(`${base}/api/labs/${labId}/studies/${r1.body?.id}`, { headers: H });
  check("4. the bare draft opens", g.status === 200, `status=${g.status}`);

  server.close();
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
