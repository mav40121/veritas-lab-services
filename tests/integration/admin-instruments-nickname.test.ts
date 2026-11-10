// tests/integration/admin-instruments-nickname.test.ts
//
// GET /api/admin/veritamap/instruments-by-name returns each instrument's nickname
// and serial number (2026-11-10). Heywood's chemistry map holds two analyzers both
// named "Roche cobas pro integrated solutions"; the lab named them so R2 can be
// told apart, and the only way to read that without a lab-scoped GET (which writes
// a record_views row on the customer's lab) is this admin route. Boots the REAL
// routes on a scratch DB and proves:
//   1. a nickname and a serial number come back on the row they belong to
//   2. a row with neither returns null for both (not missing, not "")
//   3. the route still refuses a wrong secret and a short search
//
// Run (Windows, from bash): DB_PATH=.tmp-adminnick.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/admin-instruments-nickname.test.ts
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
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const now = new Date().toISOString();
  const mapCols = (sqlite.prepare("PRAGMA table_info(veritamap_maps)").all() as any[]).map((c) => c.name);
  const mapId = Number((mapCols.includes("lab_id")
    ? sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(1, null, "Nick Map", now, now)
    : sqlite.prepare("INSERT INTO veritamap_maps (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(1, "Nick Map", now, now)).lastInsertRowid);
  const name = `Zz Twin Analyzer ${Date.now()}`;
  const ins = sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at, nickname, serial_number) VALUES (?, ?, 'Primary', 'Chemistry', ?, ?, ?)");
  const named = Number(ins.run(mapId, name, now, "R2", "SN-0002").lastInsertRowid);
  const bare = Number(ins.run(mapId, name, now, null, null).lastInsertRowid);

  const get = (q: string, secret?: string) => fetch(`${base}/api/admin/veritamap/instruments-by-name?${q}`, { headers: secret ? { "x-admin-secret": secret } : {} });
  const r = await get(`like=${encodeURIComponent(name)}`, ADMIN);
  const body = (await r.json()) as any;
  const rows = (body.instruments || []) as any[];
  const a = rows.find((x) => x.instrument_id === named);
  const b = rows.find((x) => x.instrument_id === bare);
  check("route answers 200 with both twin rows", r.status === 200 && !!a && !!b, `status=${r.status} rows=${rows.length}`);
  check("named row returns its nickname", a?.nickname === "R2", JSON.stringify(a?.nickname));
  check("named row returns its serial number", a?.serial_number === "SN-0002", JSON.stringify(a?.serial_number));
  check("bare row returns nickname null", b !== undefined && "nickname" in b && b.nickname === null, JSON.stringify(b?.nickname));
  check("bare row returns serial_number null", b !== undefined && "serial_number" in b && b.serial_number === null, JSON.stringify(b?.serial_number));
  check("tests array still returned", Array.isArray(a?.tests), typeof a?.tests);

  check("wrong secret is refused (403)", (await get(`like=${encodeURIComponent(name)}`, "nope")).status === 403);
  check("search shorter than 3 characters is refused (400)", (await get("like=ab", ADMIN)).status === 400);

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
