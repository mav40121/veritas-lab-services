// scripts/verify-lot-use-and-troubleshooting.mjs
//
// St. Charles demo asks (2026-10-14, REQ-067 and REQ-070): lot in-use / out-of-use dates and a
// troubleshooting maintenance entry. Boots the built server on a COPY of a production backup (the
// backup itself is never written) and checks, on Michaels Lab (lab 3; LAB= to change):
//   Troubleshooting (VeritaMaintain)
//    1. an unknown event type is refused (400)
//    2. a troubleshooting entry is accepted (200) and keeps its problem/action/outcome notes
//    3. ...and leaves the PM next-due date unchanged (a calibration entry still advances it)
//   Lot use (VeritaStock)
//    4. putting a lot in use records today's lab date and the person
//    5. putting the same lot in use again is refused (409)
//    6. an in-use date in the future is refused (400)
//    7. an out-of-use date before the in-use date is refused (400)
//    8. taking it out of use records the date, the person and the reason; the history shows both dates
//    9. taking it out of use twice is refused (409)
//   10. an item from another lab is refused (403)
//   Control lots (VeritaQC)
//   11. retiring a lot with an out-of-use date stores it; the lots list returns it
//   12. an out-of-use date before the lot was opened is refused (400)
//   13. re-activating the lot clears the out-of-use date
//   14. a changeover that retires the prior lot stamps its out-of-use date with the new lot's opened date
// Usage: node scripts/verify-lot-use-and-troubleshooting.mjs <backup.db>   (after npm run build)
//   DIST=<other dist/index.cjs> runs the same checks against another build (harness-bites run).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIST = process.env.DIST || path.join(ROOT, "dist", "index.cjs"), PORT = 5177, SECRET = "lotuse-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-lot-use-and-troubleshooting.mjs <backup.db> (after npm run build)"); process.exit(2); }

const LAB = Number(process.env.LAB || 3);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lotuse-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);
// Test fixtures on the COPY only: give one instrument a PM interval and a known next-due date.
const prep = new Database(dbPath);
const equip = prep.prepare("SELECT id FROM lab_equipment WHERE lab_id = ? ORDER BY id LIMIT 1").get(LAB);
if (!equip) { console.error(`no equipment on lab ${LAB}`); process.exit(2); }
prep.prepare("UPDATE lab_equipment SET pm_interval_days = 30, next_due_date = '2026-12-01' WHERE id = ?").run(equip.id);
const owner = prep.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(LAB).owner_user_id;
const lotRow = prep.prepare("SELECT l.item_id, l.lot_number, l.expiration_date FROM inventory_lots l JOIN inventory_items i ON i.id = l.item_id WHERE i.lab_id = ? AND l.quantity > 0 ORDER BY l.id LIMIT 1").get(LAB);
const otherItem = prep.prepare("SELECT id FROM inventory_items WHERE lab_id IS NOT NULL AND lab_id <> ? ORDER BY id LIMIT 1").get(LAB);
const qcLot = prep.prepare("SELECT id, opened_date FROM qc_control_lots WHERE lab_id = ? AND status = 'active' ORDER BY id LIMIT 1").get(LAB);
prep.prepare("UPDATE qc_control_lots SET opened_date = '2026-09-01' WHERE id = ?").run(qcLot.id);
prep.close();

const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" }, stdio: "ignore" });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start"); child.kill(); process.exit(2); }
const done = async () => { child.kill(); await new Promise((r) => setTimeout(r, 1000)); fs.rmSync(dir, { recursive: true, force: true }); };

const H = { "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ userId: owner }, SECRET, { expiresIn: "10m" })}`, "X-Active-Lab-Id": String(LAB) };
const B = `http://localhost:${PORT}/api/labs/${LAB}`;
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const post = (url, body, method = "POST") => fetch(url, { method, headers: H, body: JSON.stringify(body) });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// --- Troubleshooting ---
const nextDue = async () => ((await j(await fetch(`${B}/equipment`, { headers: H }))).equipment || []).find?.((e) => e.id === equip.id)?.next_due_date
  ?? (await j(await fetch(`${B}/equipment`, { headers: H }))).find?.((e) => e.id === equip.id)?.next_due_date;
const r1 = await post(`${B}/equipment/${equip.id}/events`, { event_type: "guesswork", event_date: today });
check("1. an unknown event type is refused", r1.status === 400, String(r1.status));
const tsNotes = "Problem: QC shift on Na\nAction taken: replaced electrode\nOutcome: resolved, returned to service";
const r2 = await post(`${B}/equipment/${equip.id}/events`, { event_type: "troubleshooting", event_date: today, performed_by: "QA", notes: tsNotes });
const ev = await j(await fetch(`${B}/equipment/${equip.id}/events`, { headers: H }));
const evList = Array.isArray(ev) ? ev : (ev.events || []);
const tsEv = evList.find((e) => e.event_type === "troubleshooting");
check("2. a troubleshooting entry is accepted and keeps problem/action/outcome", r2.status === 200 && !!tsEv && tsEv.notes === tsNotes, `${r2.status} ${JSON.stringify(tsEv || null)}`);
const due1 = await nextDue();
check("3a. troubleshooting leaves the PM next-due date unchanged", due1 === "2026-12-01", String(due1));
await post(`${B}/equipment/${equip.id}/events`, { event_type: "calibration", event_date: "2026-10-01" });
const due2 = await nextDue();
check("3b. a calibration entry still advances it (event + 30 days)", due2 === "2026-10-31", String(due2));

// --- Lot use ---
const LU = `${B}/veritastock/items/${lotRow.item_id}/lot-use`;
const r4 = await post(LU, { lot_number: lotRow.lot_number, expiration_date: lotRow.expiration_date });
const rec = (await j(r4)).record;
check("4. putting a lot in use records today's lab date and the person", r4.status === 200 && rec?.in_use_date === today && !!rec?.in_use_by_name, `${r4.status} ${JSON.stringify(rec || null)}`);
const r5 = await post(LU, { lot_number: lotRow.lot_number });
check("5. the same lot cannot be put in use twice", r5.status === 409, String(r5.status));
const r6 = await post(LU, { lot_number: `${lotRow.lot_number || ""}-X`, in_use_date: "2099-01-01" });
check("6. an in-use date in the future is refused", r6.status === 400, String(r6.status));
const r7 = await post(`${B}/veritastock/lot-use/${rec?.id}`, { out_of_use_date: "2000-01-01" }, "PATCH");
check("7. an out-of-use date before the in-use date is refused", r7.status === 400, String(r7.status));
const r8 = await post(`${B}/veritastock/lot-use/${rec?.id}`, { out_of_use_date: today, out_of_use_reason: "qc_failure" }, "PATCH");
const hist = (await j(await fetch(LU, { headers: H }))).records || [];
const h = hist.find((x) => x.id === rec?.id);
check("8. out of use records date, person and reason; history shows both dates", r8.status === 200 && h?.in_use_date === today && h?.out_of_use_date === today && h?.out_of_use_reason === "qc_failure" && !!h?.out_of_use_by_name, `${r8.status} ${JSON.stringify(h || null)}`);
const r9 = await post(`${B}/veritastock/lot-use/${rec?.id}`, { out_of_use_date: today }, "PATCH");
check("9. taking it out of use twice is refused", r9.status === 409, String(r9.status));
const r10 = await post(`${B}/veritastock/items/${otherItem.id}/lot-use`, { lot_number: "X" });
check("10. an item from another lab is refused", r10.status === 403, String(r10.status));

// --- Control lots ---
const lots = async () => (await j(await fetch(`${B}/qc/lots`, { headers: H }))).lots || [];
const r11 = await post(`${B}/qc/control-lots/${qcLot.id}`, { status: "retired", out_of_use_date: "2026-10-10" }, "PATCH");
const l11 = (await lots()).find((l) => l.id === qcLot.id);
check("11. retiring with an out-of-use date stores it and the list returns it", r11.status === 200 && l11?.out_of_use_date === "2026-10-10", `${r11.status} ${JSON.stringify(l11 || null)}`);
await post(`${B}/qc/control-lots/${qcLot.id}`, { status: "active" }, "PATCH");
const r12 = await post(`${B}/qc/control-lots/${qcLot.id}`, { status: "retired", out_of_use_date: "2026-08-01" }, "PATCH");
check("12. an out-of-use date before the lot was opened is refused", r12.status === 400, String(r12.status));
const l13 = (await lots()).find((l) => l.id === qcLot.id);
check("13. re-activating the lot clears the out-of-use date", l13?.status === "active" && (l13?.out_of_use_date ?? null) === null, JSON.stringify(l13 || null));
const r14 = await post(`${B}/qc/control-lots/${qcLot.id}/changeover`, { lot_number: `QA-CO-${Date.now()}`, mfr_mean: 100, mfr_sd: 2, opened_date: "2026-10-12" });
const l14 = (await lots()).find((l) => l.id === qcLot.id);
check("14. a changeover stamps the prior lot out of use on the new lot's opened date", r14.status === 200 && l14?.status === "retired" && l14?.out_of_use_date === "2026-10-12", `${r14.status} ${JSON.stringify(l14 || null)}`);

await done();
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
