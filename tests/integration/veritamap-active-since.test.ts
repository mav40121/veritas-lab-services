// tests/integration/veritamap-active-since.test.ts
//
// 2026-11-11 (Michael, Q281 = 1; the compliance digest's "New tests added"): veritamap_instrument_tests.active_since
// records when a test became active on an instrument. Made-up user, lab and map on a fresh database. It checks:
//   1. the column exists
//   2. the build page's replace-all save (PUT .../instruments/:instId/tests): a new active test gets now, an inactive
//      one NULL; saving again keeps the dates (the save deletes and re-inserts every row)
//   3. a row from before the column (NULL while active) stays NULL across a save, so an existing menu never reads new
//   4. switching a test off clears its date; switching it back on gives a new date; a row already active keeps its date
//   5. copy-from another instrument: a copied active test gets now; an existing inactive row switched on gets now; an
//      existing active row keeps its date
//   6. admin add-analyte and admin seed-instrument-menu: active rows get now, inactive rows NULL
// Run: rm -f .tmp-activesince.db && DB_PATH=.tmp-activesince.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritamap-active-since.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = (method: string, path: string, body?: unknown, token?: string) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };
  const row = (instId: number, analyte: string) =>
    sqlite.prepare("SELECT active, active_since FROM veritamap_instrument_tests WHERE instrument_id = ? AND lower(analyte) = lower(?)").get(instId, analyte) as { active: number; active_since: string | null } | undefined;
  const isRecent = (s: string | null | undefined) => !!s && Math.abs(Date.now() - Date.parse(s)) < 5 * 60 * 1000;
  const OLD = "2026-01-15T12:00:00.000Z";
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  try {
    // 1.
    const cols = (sqlite.prepare("PRAGMA table_info(veritamap_instrument_tests)").all() as { name: string }[]).map((c) => c.name);
    check("1. veritamap_instrument_tests has active_since", cols.includes("active_since"));

    const email = `activesince-${Date.now()}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Made-up Owner", hipaa_acknowledged: true }));
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Active Since Lab", plan: "hospital" }));
    const T = reg.token as string, L = prov.labId as number;
    const map = await j(await call("POST", `/api/labs/${L}/veritamap/maps`, { name: "Made-up Chemistry" }, T));
    const i1 = await j(await call("POST", `/api/labs/${L}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Made-up Analyzer A", role: "Primary", category: "Chemistry" }, T));
    const i2 = await j(await call("POST", `/api/labs/${L}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Made-up Analyzer B", role: "Backup", category: "Chemistry" }, T));
    check("setup: lab, map and two instruments", !!T && !!L && !!map.id && !!i1.id && !!i2.id, JSON.stringify({ L, map: map.id, i1: i1.id, i2: i2.id }));
    const put = (instId: number, tests: any[]) => call("PUT", `/api/labs/${L}/veritamap/maps/${map.id}/instruments/${instId}/tests`, { tests }, T);
    const t = (analyte: string, active: number) => ({ analyte, specialty: "General Chemistry", complexity: "MODERATE", active });

    // 2.
    const r1 = await put(i1.id, [t("Sodium", 1), t("Potassium", 1), t("Lithium", 0)]);
    const na1 = row(i1.id, "Sodium"), li1 = row(i1.id, "Lithium");
    check("2. first save: a new active test gets now; an inactive one NULL", r1.status === 200 && isRecent(na1?.active_since) && li1?.active === 0 && li1?.active_since === null, JSON.stringify({ s: r1.status, na1, li1 }));
    await wait(1100);
    await put(i1.id, [t("Sodium", 1), t("Potassium", 1), t("Lithium", 0)]);
    const na2 = row(i1.id, "Sodium");
    check("2. saving again keeps each active test's date (the save re-inserts every row)", na2?.active_since === na1?.active_since, JSON.stringify({ before: na1?.active_since, after: na2?.active_since }));

    // 3. Simulate rows from before the column: active with NULL, and active with an old date.
    sqlite.prepare("UPDATE veritamap_instrument_tests SET active_since = NULL WHERE instrument_id = ? AND lower(analyte) = 'potassium'").run(i1.id);
    sqlite.prepare("UPDATE veritamap_instrument_tests SET active_since = ? WHERE instrument_id = ? AND lower(analyte) = 'sodium'").run(OLD, i1.id);
    await put(i1.id, [t("Sodium", 1), t("Potassium", 1), t("Lithium", 0), t("Chloride", 1)]);
    check("3. a row from before the column stays NULL across a save", row(i1.id, "Potassium")?.active_since === null, JSON.stringify(row(i1.id, "Potassium")));
    check("3. an already-active row keeps its old date; a test added in this save gets now",
      row(i1.id, "Sodium")?.active_since === OLD && isRecent(row(i1.id, "Chloride")?.active_since), JSON.stringify([row(i1.id, "Sodium"), row(i1.id, "Chloride")]));

    // 4.
    await put(i1.id, [t("Sodium", 0), t("Potassium", 1), t("Lithium", 1), t("Chloride", 1)]);
    check("4. switched off: the date is cleared; switched on (Lithium): it gets now",
      row(i1.id, "Sodium")?.active === 0 && row(i1.id, "Sodium")?.active_since === null && isRecent(row(i1.id, "Lithium")?.active_since), JSON.stringify([row(i1.id, "Sodium"), row(i1.id, "Lithium")]));
    await put(i1.id, [t("Sodium", 1), t("Potassium", 1), t("Lithium", 1), t("Chloride", 1)]);
    check("4. switched back on: Sodium gets a new date, not its old one", isRecent(row(i1.id, "Sodium")?.active_since) && row(i1.id, "Sodium")?.active_since !== OLD, JSON.stringify(row(i1.id, "Sodium")));

    // 5. Instrument B already holds Sodium (inactive) and Potassium (active, old date); copy A onto B.
    await put(i2.id, [t("Sodium", 0), t("Potassium", 1)]);
    sqlite.prepare("UPDATE veritamap_instrument_tests SET active_since = ? WHERE instrument_id = ? AND lower(analyte) = 'potassium'").run(OLD, i2.id);
    const cp = await call("POST", `/api/labs/${L}/veritamap/maps/${map.id}/instruments/${i2.id}/copy-from/${i1.id}`, {}, T);
    check("5. copy-from: a copied active test (Chloride) gets now", cp.status === 200 && isRecent(row(i2.id, "Chloride")?.active_since), JSON.stringify({ s: cp.status, c: row(i2.id, "Chloride") }));
    check("5. copy-from: an existing inactive row switched on (Sodium) gets now; an existing active row (Potassium) keeps its date",
      row(i2.id, "Sodium")?.active === 1 && isRecent(row(i2.id, "Sodium")?.active_since) && row(i2.id, "Potassium")?.active_since === OLD, JSON.stringify([row(i2.id, "Sodium"), row(i2.id, "Potassium")]));

    // 6.
    const add = await call("POST", "/api/admin/veritamap/add-analyte", { secret: ADMIN, labId: L, mapId: map.id, instrumentNameLike: "Made-up Analyzer A", analyte: "Magnesium", specialty: "General Chemistry", complexity: "MODERATE", dryRun: false });
    check("6. admin add-analyte: the added test gets now", add.status === 200 && isRecent(row(i1.id, "Magnesium")?.active_since), JSON.stringify({ s: add.status, b: await j(add), m: row(i1.id, "Magnesium") }));
    const i3 = await j(await call("POST", `/api/labs/${L}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Made-up Analyzer C", role: "Primary", category: "Chemistry" }, T));
    const seed = await fetch(`${base}/api/admin/seed-instrument-menu`, { method: "POST", headers: { "Content-Type": "application/json", "x-admin-secret": ADMIN }, body: JSON.stringify({ mapId: map.id, instrumentId: i3.id, tests: [t("Glucose", 1), t("Ammonia", 0)] }) });
    const sb = await j(seed);
    check("6. admin seed-instrument-menu: an active row gets now, an inactive row NULL",
      seed.status === 200 && isRecent(row(i3.id, "Glucose")?.active_since) && row(i3.id, "Ammonia")?.active_since === null, JSON.stringify({ s: seed.status, sb, g: row(i3.id, "Glucose"), a: row(i3.id, "Ammonia") }));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
