// scripts/verify-qc-analyzer-trail.mjs
// Gate 3 step 8 browser receipt (2026-10-08) for the per-analyzer QC trail
// (St. Charles 10/14 scenario: "trace a QC failure, corrective action, and
// resolution for a specific analyzer"). Drives the real pages:
//   1. VeritaQC entry: pick the analyzer from the test menu, record a 1-3s
//      rejection, file the corrective action in the required modal.
//   2. Daily review: close out the corrective action with its resolution.
//   3. Equipment: the record linked to the analyzer shows a "QC trail" link.
//   4. Trail page: the failure, the action, the close-out, the calibration and an
//      older free-text run matched by name, with the right summary counts.
// Plus the server guards: resolve needs notes (400), closes once (409), needs
// VeritaQC edit (403 for a staff login), refused for Veritas support (403).
// LOCAL server + scratch DB only. Usage:
//   PW_BASE=http://localhost:5136 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-qc-analyzer-trail.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5136", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const stamp = Date.now();
const today = new Date().toISOString().slice(0, 10);

// ── Setup: an owner, a lab, one analyzer on the test menu, a lot, an equipment record ──
const ownerEmail = `trail-owner-${stamp}@example.com`, staffEmail = `trail-staff-${stamp}@example.com`, vlsEmail = `trail-vls-${stamp}@example.com`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: "testpass123", name: "Trail Owner", hipaa_acknowledged: true })).body;
const staff = (await call("POST", "/api/auth/register", { email: staffEmail, password: "testpass123", name: "Trail Staff", hipaa_acknowledged: true })).body;
const vls = (await call("POST", "/api/auth/register", { email: vlsEmail, password: "testpass123", name: "Veritas Helper", hipaa_acknowledged: true })).body;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Trail Lab", plan: "hospital" })).body.labId;
const sdb = new Database(process.env.SCRATCH_DB);
const uid = (e) => sdb.prepare("SELECT id FROM users WHERE email = ?").get(e).id;
const ownerId = uid(ownerEmail), staffId = uid(staffEmail), vlsId = uid(vlsEmail);
for (const id of [ownerId, staffId]) sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(id);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
const now = new Date().toISOString();
sdb.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)").run(labId, staffId, now, now, now);
sdb.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{\"mode\":\"view_all\"}', ?, ?, 'staff_portal')").run(ownerId, staffEmail, staffId, now, now, `trail-${stamp}`, labId);
sdb.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(vlsId);

const map = (await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Trail Map" }, owner.token)).body;
const mapId = map.id ?? map.map?.id;
const inst = (await call("POST", `/api/labs/${labId}/veritamap/maps/${mapId}/instruments`, { instrument_name: "Siemens Dimension EXL", role: "Primary", category: "Chemistry", nickname: "EXL 1", serial_number: "SN-QA-1" }, owner.token)).body;
const instId = inst.id;
const lot = (await call("POST", `/api/labs/${labId}/qc/control-lots`, { analyte: "Glucose", level: "mid", lot_number: `GLU-${stamp}`, mfr_mean: 100, mfr_sd: 2, mfr_sd_interval: 2 }, owner.token)).body;
const lotId = lot.id ?? lot.lot?.id;
const eq = (await call("POST", `/api/labs/${labId}/equipment`, { instrument_name: "Siemens Dimension EXL", serial_number: "SN-QA-1", map_instrument_id: instId }, owner.token)).body;
const ev = await call("POST", `/api/labs/${labId}/equipment/${eq.id}/events`, { event_type: "calibration", event_date: today, performed_by: "QA tech", notes: "Calibrated after the QC failure" }, owner.token);
// An older run typed as free text before analyzers were linked: should match by name.
const legacy = (await call("POST", `/api/labs/${labId}/qc/results`, { control_lot_id: lotId, result_value: 93, result_date: today, instrument: "EXL 1" }, owner.token)).body;
check("setup: analyzer, lot, linked equipment, calibration event, legacy run", !!instId && !!lotId && eq.map_instrument_id === instId && ev.status === 200 && !!legacy.result_id,
  `inst=${instId} lot=${lotId} eq=${eq.id} link=${eq.map_instrument_id} legacy=${legacy.result_id}`);
const badLink = await call("POST", `/api/labs/${labId}/qc/results`, { control_lot_id: lotId, result_value: 100, result_date: today, map_instrument_id: 999999 }, owner.token);
check("server refuses an analyzer that is not on this lab's test menu", badLink.status === 400, `HTTP ${badLink.status}`);

const me = (await call("GET", "/api/auth/me", undefined, owner.token)).body;
async function openAs(colorScheme = "light") {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); }, [owner.token, me.user ?? me]);
  return { browser, page };
}

// ── 1. Record the failing run on the picked analyzer ──
let { browser, page } = await openAs();
await page.goto(`${BASE}/labs/${labId}/veritaqc-app`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByTestId("qc-analyzer-select").click();
await page.getByRole("option", { name: /EXL 1 \(Siemens Dimension EXL\)/ }).click();
await page.locator("#qc-value").fill("108");
await page.screenshot({ path: `${OUT}/trail_entry_picker.png` });
await page.getByRole("button", { name: "Submit result" }).click();
await page.locator("#ca-action").waitFor({ timeout: 10000 });
await page.locator("#ca-action").fill("Repeated control: 108 again. Recalibrated glucose and reran: 101.");
await page.getByRole("button", { name: "File corrective action" }).click();
await page.waitForTimeout(1500);
const recent = (await call("GET", `/api/labs/${labId}/qc/recent?since=${today}`, undefined, owner.token)).body.results || [];
const run = recent.find((r) => r.result_value === 108);
const ca = run?.corrective_actions?.[0];
check("run saved on the picked analyzer, with a 1-3s rejection and its corrective action",
  !!run && run.map_instrument_id === instId && run.instrument === "EXL 1" && (run.violations || []).some((v) => v.severity === "rejection") && !!ca,
  run ? `map_instrument_id=${run.map_instrument_id} instrument=${run.instrument} rules=${(run.violations || []).map((v) => v.rule_code).join(",")} ca=${ca?.id}` : "no run");
await page.screenshot({ path: `${OUT}/trail_entry_saved.png` });

// ── server guards on close-out ──
const noNotes = await call("POST", `/api/labs/${labId}/qc/corrective-actions/${ca.id}/resolve`, { resolution_notes: "  " }, owner.token);
const asStaff = await call("POST", `/api/labs/${labId}/qc/corrective-actions/${ca.id}/resolve`, { resolution_notes: "staff tries" }, staff.token);
const asVls = await call("POST", `/api/labs/${labId}/qc/corrective-actions/${ca.id}/resolve`, { resolution_notes: "support tries" }, vls.token);
check("close-out needs resolution notes (400)", noNotes.status === 400, `HTTP ${noNotes.status}`);
check("close-out needs VeritaQC edit: a staff login is refused (403)", asStaff.status === 403, `HTTP ${asStaff.status}`);
check("close-out is refused for Veritas support (403)", asVls.status === 403, `HTTP ${asVls.status} ${asVls.body.code || ""}`);

// ── 2. Close it out from the daily review ──
await page.goto(`${BASE}/labs/${labId}/veritaqc-app/review`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByTestId(`ca-close-${ca.id}`).click();
await page.getByTestId("ca-close-text").fill("Recalibration fixed it: repeat QC 101, in range. No patient results affected.");
await page.getByTestId("ca-close-submit").click();
await page.getByTestId(`ca-closed-${ca.id}`).waitFor({ timeout: 10000 });
check("daily review shows the action as closed out by the owner", (await page.getByTestId(`ca-closed-${ca.id}`).innerText()).includes("Trail Owner"));
await page.screenshot({ path: `${OUT}/trail_review_closed.png` });
const again = await call("POST", `/api/labs/${labId}/qc/corrective-actions/${ca.id}/resolve`, { resolution_notes: "twice" }, owner.token);
check("a close-out is recorded once (409 on a second try)", again.status === 409, `HTTP ${again.status}`);

// ── 3. Equipment links to the trail ──
await page.goto(`${BASE}/labs/${labId}/equipment-app`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.getByTestId(`equip-trail-${eq.id}`).click();
await page.getByTestId("trail-title").waitFor({ timeout: 10000 });
check("equipment row's QC trail link opens the analyzer's trail", page.url().includes(`/instruments/${instId}/trail`), page.url());

// ── 4. The trail ──
await page.waitForTimeout(1200);
const title = await page.getByTestId("trail-title").innerText();
const tl = await page.getByTestId("trail-timeline").innerText();
check("trail title names the analyzer", /EXL 1/.test(title) && /Siemens Dimension EXL/.test(title), title);
check("trail shows the failure, the action and the close-out with its resolution",
  tl.includes("value 108") && tl.includes("Recalibrated glucose") && /Closed out .* by Trail Owner/.test(tl) && tl.includes("Recalibration fixed it"), "");
check("trail shows the calibration logged on the linked equipment", tl.includes("Calibration") && tl.includes("Calibrated after the QC failure"));
check("trail includes the older free-text run, labeled matched by name", tl.includes("value 93") && tl.includes("matched by name"));
const t = (await call("GET", `/api/labs/${labId}/instruments/${instId}/trail`, undefined, owner.token)).body;
check("summary: 2 rejections, 1 without action, 1 action closed, 0 open, 1 maintenance event",
  t.summary?.rejections === 2 && t.summary?.rejections_without_action === 1 && t.summary?.corrective_actions_closed === 1 && t.summary?.corrective_actions_open === 0 && t.summary?.maintenance_events === 1,
  JSON.stringify(t.summary));
await page.screenshot({ path: `${OUT}/trail_page_light.png`, fullPage: true });
await browser.close();

({ browser, page } = await openAs("dark"));
await page.goto(`${BASE}/labs/${labId}/instruments/${instId}/trail`, { waitUntil: "networkidle" });
await page.getByTestId("trail-timeline").waitFor({ timeout: 10000 });
check("trail renders in dark mode", (await page.evaluate(() => document.documentElement.classList.contains("dark"))) && (await page.getByTestId("trail-timeline").isVisible()));
await page.screenshot({ path: `${OUT}/trail_page_dark.png`, fullPage: true });
const other = await call("GET", `/api/labs/${labId}/instruments/999999/trail`, undefined, owner.token);
check("trail for an analyzer not on this lab's menu is 404", other.status === 404, `HTTP ${other.status}`);
await browser.close();

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
