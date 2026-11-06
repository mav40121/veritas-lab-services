// tests/integration/demo-fixture-rename.test.ts
//
// Michael Q190 = 1 (2026-11-06): the demo lab fixture is Sample Regional Medical Center, because a real hospital has the old name. Boots the REAL routes on a scratch DB with made-up rows.
//   1. Nothing in the repo still uses the old name, outside dated history and the files that have to name it to find it. The sample reports' analysts are made up.
//   2. A fresh seed uses the new name and keeps the fixture CLIA.
//   3. A deploy renames nothing: on rows that still carry the old name, the boot seed changes no name.
//   4. POST /api/admin/demo-fixture/rename: the secret comes from the header only; a dry run is the default, writes nothing and has no names in it; a write needs the confirm words.
//   5. The write moves the fixture and only the fixture, keeps the CLIA, takes the em dash out of the titles, audits each row, and a second run changes nothing.
//   6. The public demo routes read the new name.
// Run: npm run test:demo-fixture-rename
import http from "node:http";
import express from "express";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const OLD = ["River", "side Regional Medical Center"].join("");
const OLD_PREFIX = ["River", "side Regional"].join("");
const NEW = "Sample Regional Medical Center";
const CLIA = "22D0999999";
const SECRET = process.env.ADMIN_SECRET || "test-admin-secret";

async function main() {
  // 1. The repo
  const KEEP = new Set(["PARKING_LOT.md", "docs/shape-a-class-audit-2026-06-09.md", "server/demoFixtureRename.ts", "tests/integration/demo-fixture-rename.test.ts", "scripts/verify-demo-fixture-rename-ui.mjs"]);
  const hits = execFileSync("git", ["grep", "-l", "-I", "-e", ["River", "side"].join(""), "--", ".", ":!docs/receipts"], { encoding: "utf8" }).split("\n").filter(Boolean).filter((f) => !KEEP.has(f));
  check("1. nothing in the repo uses the old name outside dated history", hits.length === 0, hits.slice(0, 8).join(", "));
  const reports = readFileSync("client/src/lib/demoSampleReports.ts", "utf8");
  check("1. the sample reports name no real analyst", !/M\. Veri|J\. Hall|D\. McCormick/.test(reports));
  check("1. they use the three made-up names", ["T. Alvarez, MLS(ASCP)", "R. Okafor, MLS(ASCP)", "L. Brooks, MLS(ASCP)"].every((n) => reports.includes(n)));
  check("1. the quiz placeholder names nobody real", !readFileSync("client/src/pages/VeritaCompAppPage.tsx", "utf8").includes(["John", "Hall"].join(" ")));
  const banner = readFileSync("client/src/pages/DemoLabPage.tsx", "utf8");
  check("1. the demo banner says fictional", banner.includes(`Live Demo - ${NEW} (fictional)`));

  const { db } = await import("../../server/db");
  const { seedDemoData } = await import("../../server/seedDemo");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const now = new Date().toISOString();
  const post = async (body: unknown, headers: Record<string, string> = { "x-admin-secret": SECRET }, query = "") => {
    const r = await fetch(`${base}/api/admin/demo-fixture/rename${query}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };

  try {
    // 2. A fresh seed
    await seedDemoData();
    const demo = sqlite.prepare("SELECT id, clia_number, clia_lab_name FROM users WHERE email = 'demo@veritaslabservices.com'").get() as any;
    check("2. a fresh seed names the demo user's lab with the new name", demo?.clia_lab_name === NEW, demo?.clia_lab_name);
    check("2. it keeps the fixture CLIA", demo?.clia_number === CLIA, demo?.clia_number);
    const mapName = () => (sqlite.prepare("SELECT name FROM veritamap_maps WHERE user_id = ?").get(demo.id) as any)?.name;
    const scanName = () => (sqlite.prepare("SELECT name FROM veritascan_scans WHERE user_id = ?").get(demo.id) as any)?.name;
    check("2. the map and the scan use it too", /^Sample Regional - /.test(mapName()) && /^Sample Regional - /.test(scanName()), `${mapName()} | ${scanName()}`);
    const staffNames = sqlite.prepare("SELECT lab_name FROM staff_labs WHERE clia_number IN (?, '05D2187634')").all(CLIA) as any[];
    check("2. so do the staff labs", staffNames.length > 0 && staffNames.every((s) => s.lab_name.startsWith("Sample Regional")), JSON.stringify(staffNames));

    // Production's shape: the fixture carrying the old name, the titles with their em dash, a second staff lab on the older seed's CLIA.
    const emDash = "—";
    const oldMap = `${OLD_PREFIX} ${emDash} 2026 Compliance Map`, oldScan = `${OLD_PREFIX} ${emDash} 2026 Annual Inspection Readiness`;
    const madeUpUser = (email: string, clia: string | null, labName: string | null) => Number(sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, clia_number, clia_lab_name, created_at) VALUES (?, 'x', 'Made Up Person', 'hospital', ?, ?, ?)").run(email, clia, labName, now).lastInsertRowid);
    const otherOwner = madeUpUser("other-owner-qfr@example.test", null, null);
    const customerUser = madeUpUser("customer-qfr@example.test", "49D0000001", OLD);
    const labId = Number(sqlite.prepare("INSERT INTO labs (lab_name, clia_number, owner_user_id) VALUES (?, ?, ?)").run(OLD, CLIA, demo.id).lastInsertRowid);
    sqlite.prepare("UPDATE users SET clia_lab_name = ? WHERE id = ?").run(OLD, demo.id);
    sqlite.prepare("UPDATE veritamap_maps SET name = ? WHERE user_id = ?").run(oldMap, demo.id);
    sqlite.prepare("UPDATE veritascan_scans SET name = ? WHERE user_id = ?").run(oldScan, demo.id);
    // A fresh database seeds only the older staff lab, because the demo user is user 1 there. The Core Laboratory record is what seedVeritaStaffData writes for a later demo user.
    sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, lab_address_street, created_at, updated_at) VALUES (?, ?, ?, '1200 Medical Center Drive', ?, ?)").run(demo.id, `${OLD} - Core Laboratory`, CLIA, now, now);
    sqlite.prepare("UPDATE staff_labs SET lab_name = ?, lab_address_street = '1 River' || 'side Drive', lab_address_city = 'River' || 'side', lab_address_zip = '92501' WHERE clia_number = '05D2187634'").run(OLD);
    const fixtureMapInLab = Number(sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, instruments, created_at, updated_at) VALUES (?, ?, ?, '[]', ?, ?)").run(otherOwner, labId, `${OLD_PREFIX} ${emDash} second map`, now, now).lastInsertRowid);

    // Rows that look like the fixture and aren't. None of these may ever move.
    const customerLab = Number(sqlite.prepare("INSERT INTO labs (lab_name, clia_number, owner_user_id) VALUES (?, '49D0000001', ?)").run(OLD, customerUser).lastInsertRowid);
    const otherLab = Number(sqlite.prepare("INSERT INTO labs (lab_name, clia_number, owner_user_id) VALUES ('Some Other Lab', '49D0000009', ?)").run(customerUser).lastInsertRowid);
    const customerStaff = Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, created_at, updated_at) VALUES (?, ?, '49D0000001', ?, ?)").run(customerUser, OLD, now, now).lastInsertRowid);
    const customerMap = Number(sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, instruments, created_at, updated_at) VALUES (?, ?, ?, '[]', ?, ?)").run(customerUser, customerLab, `${OLD_PREFIX} ${emDash} their map`, now, now).lastInsertRowid);
    const customerScan = Number(sqlite.prepare("INSERT INTO veritascan_scans (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(customerUser, customerLab, `${OLD_PREFIX} ${emDash} their scan`, now, now).lastInsertRowid);

    const snapshot = () => JSON.stringify({
      labs: sqlite.prepare("SELECT id, lab_name, clia_number FROM labs ORDER BY id").all(),
      users: sqlite.prepare("SELECT id, clia_lab_name, clia_number FROM users ORDER BY id").all(),
      staff: sqlite.prepare("SELECT id, lab_name, clia_number, lab_address_street, lab_address_city, lab_address_zip FROM staff_labs ORDER BY id").all(),
      maps: sqlite.prepare("SELECT id, name FROM veritamap_maps ORDER BY id").all(),
      scans: sqlite.prepare("SELECT id, name FROM veritascan_scans ORDER BY id").all(),
    });
    const auditRows = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_label LIKE 'Demo lab fixture renamed%'").get() as any).n);
    const start = snapshot();

    // 3. A deploy
    await seedDemoData();
    await seedDemoData();
    check("3. the boot seed renames nothing on existing rows, so a deploy changes no names", snapshot() === start);
    check("3. the demo user still reads the old name until the write", (sqlite.prepare("SELECT clia_lab_name AS n FROM users WHERE id = ?").get(demo.id) as any).n === OLD);

    // 4. The guards
    check("4. no secret is refused", (await post({ dryRun: true }, {})).s === 403);
    check("4. a wrong secret is refused", (await post({ dryRun: true }, { "x-admin-secret": "wrong" })).s === 403);
    check("4. a secret in the body is refused", (await post({ dryRun: false, confirm: NEW, secret: SECRET }, {})).s === 403);
    check("4. a secret in the URL is refused", (await post({ dryRun: false, confirm: NEW }, {}, `?secret=${SECRET}`)).s === 403);
    const dry = await post({ dryRun: true });
    check("4. a dry run answers", dry.s === 200 && dry.j.dryRun === true, dry.text.slice(0, 200));
    const empty = await post({});
    check("4. no options means a dry run", empty.s === 200 && empty.j.dryRun === true);
    check("4. a dry run writes nothing", snapshot() === start && auditRows() === 0);
    check("4. it counts the fixture by table", dry.j.toChange?.labs?.count === 1 && dry.j.toChange?.users?.count === 1 && dry.j.toChange?.staff_labs?.count === 2 && dry.j.toChange?.veritamap_maps?.count === 2 && dry.j.toChange?.veritascan_scans?.count === 1 && dry.j.total === 7, JSON.stringify(dry.j.toChange));
    check("4. it gives the fixture's ids", dry.j.toChange?.labs?.ids?.[0] === labId && dry.j.toChange?.users?.ids?.[0] === demo.id && dry.j.toChange?.veritamap_maps?.ids?.includes(fixtureMapInLab));
    check("4. it counts what it would leave alone", dry.j.leftAlone?.labs === 1 && dry.j.leftAlone?.users === 1 && dry.j.leftAlone?.staff_labs === 1 && dry.j.leftAlone?.veritamap_maps === 1 && dry.j.leftAlone?.veritascan_scans === 1, JSON.stringify(dry.j.leftAlone));
    check("4. there are no names in the answer", !/River|Sample Regional|Made Up|example\.test/.test(dry.text), dry.text.slice(0, 200));
    check("4. a write with no confirm words is refused", (await post({ dryRun: false })).s === 400);
    const wrong = await post({ dryRun: false, confirm: "yes" });
    check("4. a write with the wrong words is refused", wrong.s === 400 && wrong.j.code === "CONFIRM_REQUIRED", wrong.text.slice(0, 120));
    check("4. a refused write changes nothing", snapshot() === start && auditRows() === 0);

    // 5. The write
    const wrote = await post({ dryRun: false, confirm: NEW });
    check("5. the write answers", wrote.s === 200 && wrote.j.dryRun === false && wrote.j.changed === 7 && wrote.j.remaining === 0, wrote.text.slice(0, 200));
    const get = (sql: string, ...a: unknown[]) => sqlite.prepare(sql).get(...a) as any;
    check("5. the fixture lab has the new name and the same CLIA", get("SELECT lab_name AS n FROM labs WHERE id = ?", labId).n === NEW && get("SELECT clia_number AS n FROM labs WHERE id = ?", labId).n === CLIA);
    check("5. so does the demo user", get("SELECT clia_lab_name AS n FROM users WHERE id = ?", demo.id).n === NEW && get("SELECT clia_number AS n FROM users WHERE id = ?", demo.id).n === CLIA);
    check("5. the map's title moved and lost its em dash", mapName() === "Sample Regional - 2026 Compliance Map", mapName());
    check("5. so did the scan's", scanName() === "Sample Regional - 2026 Annual Inspection Readiness", scanName());
    check("5. a map in the fixture lab under another owner moved too", get("SELECT name AS n FROM veritamap_maps WHERE id = ?", fixtureMapInLab).n === "Sample Regional - second map");
    const core = get("SELECT lab_name, clia_number FROM staff_labs WHERE clia_number = ?", CLIA);
    check("5. the core lab's staff record keeps its suffix", core.lab_name === `${NEW} - Core Laboratory` && core.clia_number === CLIA, core.lab_name);
    const older = get("SELECT lab_name, clia_number, lab_address_street, lab_address_city, lab_address_zip FROM staff_labs WHERE clia_number = '05D2187634'");
    check("5. the older staff lab moved, address too", older.lab_name === NEW && older.lab_address_street === "1 Sample Drive" && older.lab_address_city === "Sampletown" && older.lab_address_zip === "00000", JSON.stringify(older));
    check("5. an address with no old name in it stayed as it was", /Medical Center Drive/.test(get("SELECT lab_address_street AS n FROM staff_labs WHERE clia_number = ?", CLIA).n || ""));
    check("5. the customer's lab with the same name did not move", get("SELECT lab_name AS n FROM labs WHERE id = ?", customerLab).n === OLD);
    check("5. nor the customer's user row", get("SELECT clia_lab_name AS n FROM users WHERE id = ?", customerUser).n === OLD);
    check("5. nor their staff lab", get("SELECT lab_name AS n FROM staff_labs WHERE id = ?", customerStaff).n === OLD);
    check("5. nor their map", get("SELECT name AS n FROM veritamap_maps WHERE id = ?", customerMap).n === `${OLD_PREFIX} ${emDash} their map`);
    check("5. nor their scan", get("SELECT name AS n FROM veritascan_scans WHERE id = ?", customerScan).n === `${OLD_PREFIX} ${emDash} their scan`);
    check("5. nor a lab with another name", get("SELECT lab_name AS n FROM labs WHERE id = ?", otherLab).n === "Some Other Lab");
    check("5. each changed row has an audit row", auditRows() === 7, String(auditRows()));
    const afterWrite = snapshot();
    const again = await post({ dryRun: false, confirm: NEW });
    check("5. a second run changes nothing", again.s === 200 && again.j.changed === 0 && snapshot() === afterWrite && auditRows() === 7, again.text.slice(0, 160));
    await seedDemoData();
    check("5. nor does the next boot put the old name back", snapshot() === afterWrite);
    const { applyDemoFixtureRename } = await import("../../server/demoFixtureRename");
    const stale = applyDemoFixtureRename(sqlite, [{ table: "labs", id: otherLab, changes: { lab_name: ["Not what it says now", "Moved"] } }]);
    check("5. a row changed since the plan is left alone", stale.length === 0 && get("SELECT lab_name AS n FROM labs WHERE id = ?", otherLab).n === "Some Other Lab");
    let threw = false;
    try {
      applyDemoFixtureRename(sqlite, [
        { table: "labs", id: otherLab, changes: { lab_name: ["Some Other Lab", "Moved"] } },
        { table: "labs", id: otherLab, changes: { no_such_column: ["a", "b"] } },
      ]);
    } catch { threw = true; }
    check("5. a failure part way changes nothing: all of it or none of it", threw && get("SELECT lab_name AS n FROM labs WHERE id = ?", otherLab).n === "Some Other Lab");

    // 6. The public routes
    const overview = await (await fetch(`${base}/api/demo/overview`)).json() as any;
    check("6. the public overview reads the new name", overview.labName === NEW && overview.cliaNumber === CLIA, overview.labName);
    check("6. and a fictional address", overview.address === "100 Medical Center Drive, Sampletown, CA 00000", overview.address);
    const scan = await (await fetch(`${base}/api/demo/data`)).text();
    check("6. the public demo data has no old name once the write has run", !scan.includes(OLD_PREFIX));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
