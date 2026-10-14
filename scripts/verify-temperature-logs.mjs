// scripts/verify-temperature-logs.mjs
//
// VeritaMaintain temperature logs (St. Charles REQ-068, 2026-10-14). Boots the built server on a COPY of a
// production backup (never written) and checks, on Michaels Lab (lab 3; LAB= to change):
//   1. a storage unit without an acceptable range is refused (400)
//   2. a range whose low limit is not below the high limit is refused (400)
//   3. a refrigerator 2 to 8 C, two readings a day, is added (201)
//   4. an in-range reading is recorded with uppercase initials and in_range 1
//   5. an out-of-range reading without a corrective action is refused (400 CORRECTIVE_ACTION_REQUIRED)
//   6. the same reading with its corrective action is recorded with in_range 0
//   7. a reading dated in the future is refused (400)
//   8. a reading without initials is refused (400)
//   9. the units list shows today's 2 of 2 readings, 1 out of range, and the latest reading
//  10. the month log returns both readings in time order
//  11. another lab's unit is not found through this lab (404)
//  12. a retired unit refuses new readings (400)
//  13. a staff login records a reading (201) but cannot add a storage unit (403)
// Usage: node scripts/verify-temperature-logs.mjs <backup.db>   (after npm run build)
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
const DIST = process.env.DIST || path.join(ROOT, "dist", "index.cjs"), PORT = 5179, SECRET = "templogs-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-temperature-logs.mjs <backup.db> (after npm run build)"); process.exit(2); }

const LAB = Number(process.env.LAB || 3);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "templogs-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);
const ro = new Database(dbPath, { readonly: true });
const owner = ro.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(LAB).owner_user_id;
// A staff login WITHOUT module edit rights (permissions '{}' or empty); a 'staff' member granted edit_all is an editor.
const staff = ro.prepare("SELECT user_id FROM lab_members WHERE lab_id = ? AND role = 'staff' AND status = 'active' AND COALESCE(permissions_json, '{}') NOT LIKE '%edit%' ORDER BY id LIMIT 1").get(LAB);
const otherLab = ro.prepare("SELECT l.id, l.owner_user_id FROM labs l WHERE l.id <> ? AND l.plan IN ('hospital','enterprise','community','lab') ORDER BY l.id LIMIT 1").get(LAB);
ro.close();
const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" }, stdio: "ignore" });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start"); child.kill(); process.exit(2); }
const done = async () => { child.kill(); await new Promise((r) => setTimeout(r, 1000)); fs.rmSync(dir, { recursive: true, force: true }); };

const hdr = (userId, lab) => ({ "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ userId }, SECRET, { expiresIn: "10m" })}`, "X-Active-Lab-Id": String(lab) });
const H = hdr(owner, LAB);
const B = `http://localhost:${PORT}/api/labs/${LAB}/temp-logs`;
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const post = (url, body, h = H, method = "POST") => fetch(url, { method, headers: h, body: JSON.stringify(body) });
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const r1 = await post(`${B}/units`, { name: "QA fridge no range", unit_type: "refrigerator" });
check("1. a unit without an acceptable range is refused", r1.status === 400, String(r1.status));
const r2 = await post(`${B}/units`, { name: "QA fridge bad range", unit_type: "refrigerator", min_value: 8, max_value: 2 });
check("2. a low limit not below the high limit is refused", r2.status === 400, String(r2.status));
const r3 = await post(`${B}/units`, { name: "QA blood bank refrigerator", unit_type: "refrigerator", location: "Blood bank", min_value: 2, max_value: 8, scale: "C", readings_per_day: 2 });
const unit = await j(r3);
check("3. a 2 to 8 C refrigerator with two readings a day is added", r3.status === 201 && unit.min_value === 2 && unit.max_value === 8 && unit.readings_per_day === 2, `${r3.status} ${JSON.stringify(unit)}`);
const R = `${B}/units/${unit.id}/readings`;
const r4 = await post(R, { reading_time: "07:00", value: 4.1, initials: "qa" });
const rd4 = await j(r4);
check("4. an in-range reading is recorded with uppercase initials", r4.status === 201 && rd4.in_range === 1 && rd4.initials === "QA" && rd4.reading_date === today, `${r4.status} ${JSON.stringify(rd4)}`);
const r5 = await post(R, { reading_time: "15:00", value: 9.4, initials: "QA" });
const e5 = await j(r5);
check("5. out of range without a corrective action is refused", r5.status === 400 && e5.code === "CORRECTIVE_ACTION_REQUIRED", `${r5.status} ${JSON.stringify(e5)}`);
const r6 = await post(R, { reading_time: "15:00", value: 9.4, initials: "QA", corrective_action: "Moved units to backup refrigerator; facilities called; re-checked 15:30 at 5.0" });
const rd6 = await j(r6);
check("6. out of range with its corrective action is recorded as out of range", r6.status === 201 && rd6.in_range === 0 && !!rd6.corrective_action, `${r6.status} ${JSON.stringify(rd6)}`);
const r7 = await post(R, { reading_date: "2099-01-01", value: 4, initials: "QA" });
check("7. a reading dated in the future is refused", r7.status === 400, String(r7.status));
const r8 = await post(R, { value: 4 });
check("8. a reading without initials is refused", r8.status === 400, String(r8.status));
const list = await j(await fetch(`${B}/units`, { headers: H }));
const u9 = (list.units || []).find((u) => u.id === unit.id);
check("9. the units list shows 2 of 2 today, 1 out of range, and the latest reading", !!u9 && u9.today_count === 2 && u9.today_out_of_range === 1 && u9.last_reading?.value === 9.4, JSON.stringify(u9 || null));
const log = await j(await fetch(`${R}?month=${today.slice(0, 7)}`, { headers: H }));
const vals = (log.readings || []).map((r) => r.value);
check("10. the month log returns both readings in time order", JSON.stringify(vals) === JSON.stringify([4.1, 9.4]), JSON.stringify(vals));
if (otherLab) {
  const ou = await post(`http://localhost:${PORT}/api/labs/${otherLab.id}/temp-logs/units`, { name: "QA other lab fridge", min_value: 2, max_value: 8 }, hdr(otherLab.owner_user_id, otherLab.id));
  const ouj = await j(ou);
  const r11 = await post(`${B}/units/${ouj.id}/readings`, { value: 4, initials: "QA" });
  check("11. another lab's unit is not found through this lab", ou.status === 201 && r11.status === 404, `${ou.status}/${r11.status}`);
} else console.log("SKIP  11. no second lab on this copy");
const retire = await post(`${B}/units/${unit.id}`, { active: false }, H, "PUT");
const r12 = await post(R, { value: 4, initials: "QA" });
check("12. a retired unit refuses new readings", retire.status === 200 && r12.status === 400, `${retire.status}/${r12.status}`);
if (staff) {
  const HS = hdr(staff.user_id, LAB);
  const su = await post(`${B}/units`, { name: "QA staff unit", min_value: 15, max_value: 30, unit_type: "room" });
  const sunit = await j(su);
  const sr = await post(`${B}/units/${sunit.id}/readings`, { value: 21, initials: "ST" }, HS);
  const sadd = await post(`${B}/units`, { name: "QA staff tries to add", min_value: 15, max_value: 30 }, HS);
  check("13. a staff login records a reading but cannot add a unit", sr.status === 201 && sadd.status === 403, `record ${sr.status}, add ${sadd.status}`);
} else console.log("SKIP  13. no staff member on this lab in the copy");

await done();
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
