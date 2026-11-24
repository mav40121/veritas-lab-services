// scripts/capture-veritaqa-baseline.ts
//
// Writes the answers behind tests/integration/fixtures/veritaqa-baseline-main.json: every VeritaQA read, by the made-up people
// of tests/integration/veritaqaBaselineWorld.ts, from the code in the folder it runs in. It was run on a copy of main 23d7b11d
// (before B15) with a scratch database:
//   DB_PATH=<scratch>.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy \
//   STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/capture-veritaqa-baseline.ts <out.json>
import fs from "node:fs";
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

async function main() {
  const { db } = await import("../server/db");
  const { registerRoutes } = await import("../server/routes");
  const world = await import("../tests/integration/veritaqaBaselineWorld");
  const sqlite = (db as any).$client;
  sqlite.pragma("foreign_keys = OFF");
  world.seedBaselinePeople(sqlite);
  world.seedBaselineRows(sqlite);
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const jwt = (await import("jsonwebtoken")).default;
  const answers = await world.capture(async (user, lab, method, path) => {
    const token = jwt.sign({ svc: true, userId: user }, process.env.JWT_SECRET!, { expiresIn: "10m" });
    const r = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(lab ? { "X-Active-Lab-Id": String(lab) } : {}) },
      body: method === "GET" ? undefined : "{}",
    });
    let body: any = null;
    try { body = await r.json(); } catch { /* not JSON */ }
    if (body?.token) body.token = "(a token)";
    return { status: r.status, body };
  });
  // Many answers are the same one; each distinct body is kept once.
  const bodies: string[] = [];
  const index: Record<string, [number, number]> = {};
  for (const [key, a] of Object.entries(answers)) {
    const s = JSON.stringify(a.body);
    let i = bodies.indexOf(s);
    if (i < 0) i = bodies.push(s) - 1;
    index[key] = [a.status, i];
  }
  fs.writeFileSync(process.argv[2], `{"answers":${JSON.stringify(index)},\n"bodies":[\n${bodies.join(",\n")}\n]}\n`);
  const tally: Record<string, number> = {};
  for (const a of Object.values(answers)) tally[a.status] = (tally[a.status] || 0) + 1;
  console.log("captured", Object.keys(answers).length, JSON.stringify(tally));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
