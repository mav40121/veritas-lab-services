// scripts/verify-equipment-record-ui.mjs
//
// Browser receipt for the VeritaMaintain equipment record (B9, 2026-11-24). On a local production build with a scratch DB, made-up people and made-up instruments:
//   R1. add an instrument with the new fields, link a VeritaDC document, and open it from the record at its approved version
//   R2. log a repair: the due date stays; log a PM backdated: the dialog says it stays, and moves it back only when ticked
//   R3. the lab requires a vendor report: a vendor PM with none waits (dialog, list, history), and attaching it completes it and moves the date
//   R4. correct an entry: the original shows under it; void one: it stays, marked
//   R5. out of service: start, the list shows it, stop, the time is worked out
//   R6. files on the record: attach, download, remove with a reason
//   R7. retire asks for a reason; the Retired list shows it and restores it
//   R8. move to another lab of the organization; the history there reads read-only
//   R9. a Staff login logs maintenance and gets no setup buttons; phone width doesn't overflow
//   R10. VeritaMap: an editor sets an analyzer test's IFU link, a Staff login gets no button
// Screenshots b910_record_*.png, light and dark. Run: PW_BASE=http://localhost:5199 SCRATCH_DB=<db> OUT=<dir> POLICY_STORAGE_ROOT=<dir> node scripts/verify-equipment-record-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Record", "Ui", "77!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const mkLab = async (tag, name) => {
  const email = `recui-${tag}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email, password: pw, name: `Riley ${tag}`, hipaa_acknowledged: true });
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: name, plan: "hospital", isWarehouse: true })).body.labId;
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
  return { email, token: reg.body.token, labId, userId: sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o };
};
const A = await mkLab("owner", "Record Test Lab");
const B = await mkLab("second", "Second Campus Lab");
const org = Number(sql("INSERT INTO organizations (name, billing_owner_user_id) VALUES ('Made-up System', ?)", A.userId).lastInsertRowid);
sql("UPDATE labs SET organization_id = ? WHERE id IN (?, ?)", org, A.labId, B.labId);
sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'admin', 'active', 0, ?, ?, ?)", B.labId, A.userId, now, now, now);
const labId = A.labId, token = A.token, L = `/api/labs/${labId}`;
// A Staff login
const staffEmail = `recui-staff-${stamp}@example.com`;
const staffReg = await call("POST", "/api/auth/register", { email: staffEmail, password: pw, name: "Sam Stafford", hipaa_acknowledged: true });
const staffId = Number(staffReg.body.user?.id);
sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, staffId, now, now, now);
sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, staffId);
const staffLab = Number(sql("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Record Test Lab', '99D0000124', ?, ?, ?)", A.userId, labId, now, now).lastInsertRowid);
const emp = Number(sql("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, 'Stafford', 'Sam', 'active', ?, ?)", staffLab, labId, A.userId, now, now).lastInsertRowid);
sql(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{"mode":"view_all"}', ?, ?)`, A.userId, staffEmail, staffId, labId, emp, now, now);
sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", staffId);
const staffToken = (await call("POST", "/api/auth/login", { email: staffEmail, password: pw })).body.token;
// A VeritaDC document with an approved version
const rel = `${labId}/ui-ifu/v1/document.txt`;
const abs = path.join(process.env.POLICY_STORAGE_ROOT, rel);
fs.mkdirSync(path.dirname(abs), { recursive: true });
fs.writeFileSync(abs, "Made-up instructions for use, approved version.");
const manual = Number(sql("INSERT INTO policy_manuals (lab_id, name) VALUES (?, 'Chemistry')", labId).lastInsertRowid);
const doc = Number(sql("INSERT INTO policy_documents (lab_id, manual_id, title, owner_user_id, status, doc_number) VALUES (?, ?, 'Analyzer IFU', ?, 'approved', 'CH 12')", labId, manual, A.userId).lastInsertRowid);
const ver = Number(sql("INSERT INTO policy_versions (document_id, version_number, file_path, file_format, file_size_bytes, file_hash_sha256, uploaded_by) VALUES (?, 1, ?, 'txt', 40, ?, ?)", doc, rel, crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"), A.userId).lastInsertRowid);
sql("UPDATE policy_documents SET current_version_id = ?, approved_version_id = ? WHERE id = ?", ver, ver, doc);
// VeritaMap with one analyzer and one test
const mapId = Number(sql("INSERT INTO veritamap_maps (user_id, lab_id, name, instruments, created_at, updated_at) VALUES (?, ?, 'Core lab', '[]', ?, ?)", A.userId, labId, now, now).lastInsertRowid);
const menuId = Number(sql("INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?, 'Made-up 500', 'Primary', 'Chemistry', ?)", mapId, now).lastInsertRowid);
const itId = Number(sql("INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?, ?, 'Sodium', 'Routine Chemistry', 'MODERATE', 1)", menuId, mapId).lastInsertRowid);
sql("INSERT INTO veritamap_tests (map_id, analyte, specialty, complexity, active, updated_at) VALUES (?, 'Sodium', 'Routine Chemistry', 'MODERATE', 1, ?)", mapId, now);

const pdfPath = path.join(OUT, "made-up-vendor-report.pdf");
fs.writeFileSync(pdfPath, "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
const browser = await chromium.launch();
const openAs = async (tk, p, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 1000 }, colorScheme: opts.dark ? "dark" : "light", acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, tk]);
  await page.evaluate(([t, u, l, dark]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify(u.user || u));
    localStorage.setItem("veritas_active_lab_id", String(l));
    if (dark) localStorage.setItem("theme", "dark");
  }, [tk, me, opts.lab || labId, !!opts.dark]);
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  return page;
};
const said = async (page, text) => page.getByText(text, { exact: false }).first().waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
// A toast on screen takes the first Escape, so close by the dialog's own button.
const closeTop = async (p) => { await p.getByRole("dialog").last().getByRole("button", { name: "Close", exact: true }).click(); await p.waitForTimeout(350); };
const PAGE = `/labs/${labId}/equipment-app`;
const due = (id) => sql("SELECT next_due_date AS d FROM lab_equipment WHERE id = ?", id).d;

try {
  const page = await openAs(token, PAGE);
  // ── R1 ──
  await page.getByRole("button", { name: "Add your first instrument" }).click();
  await page.locator("#eq-name").fill("Made-up 500 analyzer");
  await page.locator("#eq-serial").fill("MU-5001");
  await page.locator("#eq-int").fill("90");
  await page.locator("#eq-due").fill("2026-12-15");
  await page.locator("#eq-placed").fill("2021-03-01");
  await page.locator("#eq-vendor").fill("Made-up Service Co");
  await page.locator("#eq-contract").fill("Contract 8841, parts and labor, ends 2027-06-30");
  await page.locator("#eq-ifu").fill("https://example.com/ifu");
  await page.getByTestId("eq-ifu-doc-open").click();
  await page.getByTestId(`eq-ifu-doc-doc-${doc}`).click();
  await page.screenshot({ path: `${OUT}/b910_record_edit_light.png` });
  await page.getByRole("dialog").getByRole("button", { name: "Add instrument" }).click();
  await page.getByText("Made-up 500 analyzer").first().waitFor({ timeout: 10000 });
  const id = sql("SELECT id FROM lab_equipment WHERE lab_id = ? AND instrument_name = 'Made-up 500 analyzer'", labId).id;
  const row = sql("SELECT * FROM lab_equipment WHERE id = ?", id);
  check("R1. the new fields are saved", row.placed_in_service_date === "2021-03-01" && row.vendor_name === "Made-up Service Co" && /8841/.test(row.service_contract) && row.ifu_url === "https://example.com/ifu" && row.ifu_document_id === doc, JSON.stringify(row));
  await page.getByTestId(`equip-record-${id}`).click();
  await page.getByTestId("record-facts").waitFor({ timeout: 8000 });
  await page.getByTestId("record-ifu-document").click();
  const frame = page.frameLocator('[data-testid="approved-document-frame"]');
  check("R1. the linked document opens at its approved version", await frame.getByText("Made-up instructions for use, approved version.").waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  await closeTop(page);
  await page.waitForTimeout(300);

  // ── R5. out of service, in the record ──
  await page.getByTestId("downtime-from").fill("2026-11-10T08:00");
  await page.getByTestId("downtime-reason").fill("Probe fault");
  await page.getByTestId("downtime-start").click();
  await page.getByTestId("downtime-until").waitFor({ timeout: 8000 });
  await page.getByTestId("downtime-until").fill("2026-11-12T10:30");
  await page.getByTestId("downtime-note").fill("Probe replaced, QC acceptable");
  await page.getByTestId("downtime-end").click();
  const dt = sql("SELECT * FROM equipment_downtime WHERE equipment_id = ?", id);
  await page.waitForTimeout(600);
  check("R5. it comes back and the time is worked out", (await page.getByTestId(`downtime-length-${dt.id}`).innerText()) === "2 d 2 h", await page.getByTestId(`downtime-length-${dt.id}`).innerText());
  await page.getByTestId("downtime-from").fill("2026-11-20T08:00");
  await page.getByTestId("downtime-reason").fill("Waiting for a lamp");
  await page.getByTestId("downtime-start").click();
  await page.getByTestId("record-out").waitFor({ timeout: 8000 });

  // ── R6. files ──
  await page.getByTestId("record-attach-kind").selectOption("calibration_certificate");
  await page.getByTestId("record-attach-input").setInputFiles(pdfPath);
  await page.getByTestId("record-attach-send").click();
  await page.waitForTimeout(800);
  const f = sql("SELECT id FROM equipment_files WHERE equipment_id = ?", id);
  check("R6. a file is attached to the record", !!f);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`equip-file-download-${f.id}`).click()]);
  check("R6. it downloads", fs.readFileSync(await dl.path()).equals(fs.readFileSync(pdfPath)));
  await page.screenshot({ path: `${OUT}/b910_record_light.png` });
  await closeTop(page);
  await page.waitForTimeout(300);
  check("R5. the list says it is out of service", /Out of service since 2026-11-20 08:00/.test(await page.getByTestId(`equip-out-${id}`).innerText()));

  // ── R2. the due date ──
  const pickType = async (name) => { await page.locator("#ev-type").click(); await page.getByRole("option", { name, exact: true }).click(); };
  const logBtn = () => page.getByRole("dialog").getByRole("button", { name: "Log maintenance" }).click();
  await page.getByTestId(`equip-log-${id}`).click();
  await pickType("Repair");
  await page.locator("#ev-cost").fill("1250.50");
  await page.locator("#ev-notes").fill("Replaced the probe");
  check("R2. a repair doesn't complete PM unless ticked, and asks for no due date", !(await page.getByTestId("ev-completes-pm").isChecked()) && (await page.locator("#ev-next").count()) === 0);
  await logBtn();
  await page.waitForTimeout(900);
  check("R2. logging a repair leaves the due date", due(id) === "2026-12-15", due(id));
  await page.getByTestId(`equip-log-${id}`).click();
  await pickType("Preventive maintenance");
  await page.locator("#ev-date").fill("2026-06-01");
  check("R2. a backdated PM says the date stays", /earlier than the due date on file, so 2026-12-15 stays/.test(await page.getByTestId("ev-due-held").innerText()));
  await page.screenshot({ path: `${OUT}/b910_log_light.png` });
  await logBtn();
  await page.waitForTimeout(900);
  check("R2. ... and it does", due(id) === "2026-12-15", due(id));
  await page.getByTestId(`equip-log-${id}`).click();
  await pickType("Preventive maintenance");
  await page.locator("#ev-date").fill("2026-06-01");
  await page.getByTestId("ev-allow-earlier").check();
  await logBtn();
  await page.waitForTimeout(900);
  check("R2. ticked, it moves back", due(id) === "2026-08-30", due(id));

  // ── R3. the vendor report ──
  await page.getByTestId("require-vendor-report").click();
  await page.waitForTimeout(700);
  await page.getByTestId(`equip-log-${id}`).click();
  await pickType("Preventive maintenance");
  await page.locator("#ev-date").fill("2026-11-18");
  await page.getByTestId("ev-vendor").check();
  await page.locator("#ev-company").fill("Made-up Service Co");
  await page.locator("#ev-tech").fill("Jordan Fields");
  check("R3. the dialog says the PM waits for the report", await page.getByTestId("ev-waits").isVisible());
  await logBtn();
  await page.waitForTimeout(900);
  check("R3. it is logged and the due date stays", due(id) === "2026-08-30" && await page.getByTestId(`equip-waiting-${id}`).isVisible(), due(id));
  const pm = sql("SELECT id FROM equipment_maintenance_events WHERE equipment_id = ? ORDER BY id DESC LIMIT 1", id).id;
  await page.getByTestId(`equip-history-${id}`).click();
  check("R3. the history says it is waiting", await page.getByTestId(`history-waiting-${pm}`).waitFor({ timeout: 8000 }).then(() => true).catch(() => false));
  await page.getByTestId(`history-attach-${pm}`).click();
  check("R3. attach offers Vendor report first", (await page.getByTestId(`attach-${pm}-kind`).inputValue()) === "vendor_report");
  await page.getByTestId(`attach-${pm}-input`).setInputFiles(pdfPath);
  await page.getByTestId(`attach-${pm}-send`).click();
  await page.getByTestId(`history-report-${pm}`).waitFor({ timeout: 8000 });
  check("R3. attaching it completes the PM and moves the date", due(id) === "2027-02-16", due(id));

  // ── R4. correct and void ──
  const repair = sql("SELECT id FROM equipment_maintenance_events WHERE equipment_id = ? AND event_type = 'repair'", id).id;
  await page.getByTestId(`history-correct-${repair}`).click();
  await page.getByTestId("correct-cost").fill("1300");
  await page.getByTestId("correct-save").click();
  await page.waitForTimeout(300);
  check("R4. a correction with no reason is refused", await page.getByTestId("correct-dialog").isVisible());
  await page.getByTestId("correct-reason").fill("Invoice total");
  await page.getByTestId("correct-save").click();
  await page.waitForTimeout(900);
  const fixed = sql("SELECT id FROM equipment_maintenance_events WHERE corrects_event_id = ?", repair).id;
  await page.getByTestId(`history-earlier-${fixed}`).click();
  const versions = await page.getByTestId(`history-versions-${fixed}`).innerText();
  check("R4. the corrected entry shows the original under it", /Original/.test(versions) && /\$1,250\.50/.test(versions) && /Invoice total/.test(await page.getByTestId(`history-corrected-${fixed}`).innerText()), versions);
  const oldPm = sql("SELECT id FROM equipment_maintenance_events WHERE equipment_id = ? AND event_date = '2026-06-01' ORDER BY id LIMIT 1", id).id;
  await page.getByTestId(`history-void-${oldPm}`).click();
  await page.getByTestId("void-dialog-reason").fill("Entered twice");
  await page.getByTestId("void-dialog-confirm").click();
  await page.waitForTimeout(900);
  check("R4. a voided entry stays, marked", /Voided/.test(await page.getByTestId(`history-event-${oldPm}`).innerText()) && /Entered twice/.test(await page.getByTestId(`history-event-${oldPm}`).innerText()));
  await page.getByTestId("history-dialog").screenshot({ path: `${OUT}/b910_history_light.png` });
  await closeTop(page);

  // ── R7. retire and restore ──
  await call("POST", `${L}/equipment`, { instrument_name: "Made-up old centrifuge", serial_number: "MU-77" }, token);
  await page.reload({ waitUntil: "networkidle" });
  const old = sql("SELECT id FROM lab_equipment WHERE lab_id = ? AND instrument_name = 'Made-up old centrifuge'", labId).id;
  await page.getByTestId(`equip-retire-${old}`).click();
  await page.getByTestId("retire-dialog-confirm").click();
  await page.waitForTimeout(300);
  check("R7. retiring with no reason is refused", await page.getByTestId("retire-dialog").isVisible() && sql("SELECT status FROM lab_equipment WHERE id = ?", old).status === "active");
  await page.getByTestId("retire-dialog-reason").fill("Replaced by a new one");
  await page.getByTestId("retire-dialog").screenshot({ path: `${OUT}/b910_retire_light.png` });
  await page.getByTestId("retire-dialog-confirm").click();
  await page.waitForTimeout(900);
  await page.getByTestId("toggle-retired").click();
  check("R7. the Retired list shows it and why", /Replaced by a new one/.test(await page.getByTestId(`retired-row-${old}`).innerText()));
  await page.getByTestId(`restore-${old}`).click();
  await page.waitForTimeout(900);
  check("R7. Restore brings it back", sql("SELECT status FROM lab_equipment WHERE id = ?", old).status === "active" && await page.getByTestId(`equip-log-${old}`).isVisible());
  await page.screenshot({ path: `${OUT}/b910_list_light.png` });

  // ── R10. VeritaMap ──
  const mp = await openAs(token, `/labs/${labId}/veritamap-app/${mapId}`);
  const btn = mp.getByTestId(`ifu-set-${itId}`);
  const hasBtn = await btn.first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check("R10. an editor gets Set link in the analyzer's row", hasBtn, mp.url());
  if (hasBtn) {
    await btn.first().click();
    await mp.getByTestId("ifu-link-url").fill("not a link");
    check("R10. something that isn't a web address can't be saved", await mp.getByTestId("ifu-link-save").isDisabled());
    await mp.getByTestId("ifu-link-url").fill("https://example.com/na-ifu.pdf");
    await mp.getByTestId("ifu-link-dialog").screenshot({ path: `${OUT}/b910_map_ifu_light.png` });
    await mp.getByTestId("ifu-link-save").click();
    await mp.waitForTimeout(1200);
    check("R10. it is saved, and the row's IFU link opens it", sql("SELECT ifu_url FROM veritamap_instrument_tests WHERE id = ?", itId).ifu_url === "https://example.com/na-ifu.pdf" && (await mp.locator('a[title="Open the stored IFU (package insert)"]').first().getAttribute("href")) === "https://example.com/na-ifu.pdf");
  }
  const md = await openAs(token, `/labs/${labId}/veritamap-app/${mapId}`, { dark: true });
  await md.getByTestId(`ifu-set-${itId}`).first().click();
  await md.getByTestId("ifu-link-dialog").waitFor({ timeout: 8000 });
  await md.waitForTimeout(400);
  await md.getByTestId("ifu-link-dialog").screenshot({ path: `${OUT}/b910_map_ifu_dark.png` });
  const sm = await openAs(staffToken, `/labs/${labId}/veritamap-app/${mapId}`);
  await sm.getByText("Sodium").first().waitFor({ timeout: 15000 }).catch(() => {});
  check("R10. a Staff login gets no button", (await sm.getByTestId(`ifu-set-${itId}`).count()) === 0);

  // ── R9. Staff login, dark and phone ──
  const sp = await openAs(staffToken, PAGE);
  await sp.getByTestId(`equip-log-${id}`).waitFor({ timeout: 10000 });
  check("R9. a Staff login gets Log maintenance and no setup", await sp.getByTestId(`equip-log-${id}`).isEnabled() && await sp.getByTestId(`equip-edit-${id}`).isDisabled() && await sp.getByTestId(`equip-retire-${id}`).isDisabled() && await sp.getByTestId("require-vendor-report").isDisabled());
  await sp.getByTestId(`equip-record-${id}`).click();
  await sp.getByTestId("record-facts").waitFor({ timeout: 8000 });
  check("R9. ... and reads the record with no setup in it", (await sp.getByTestId("record-attach").count()) === 0 && (await sp.getByTestId("downtime-end").count()) === 0 && (await sp.getByTestId("record-move").count()) === 0);
  await closeTop(sp);
  await sp.getByTestId(`equip-log-${id}`).click();
  await sp.getByRole("dialog").getByRole("button", { name: "Log maintenance" }).click();
  await sp.waitForTimeout(900);
  const last = sql("SELECT logged_by_name FROM equipment_maintenance_events WHERE equipment_id = ? ORDER BY id DESC LIMIT 1", id);
  check("R9. their entry names who was signed in", last.logged_by_name === "Sam Stafford", JSON.stringify(last));

  const dark = await openAs(token, PAGE, { dark: true });
  await dark.getByTestId(`equip-record-${id}`).waitFor({ timeout: 10000 });
  await dark.screenshot({ path: `${OUT}/b910_list_dark.png` });
  await dark.getByTestId(`equip-record-${id}`).click();
  await dark.getByTestId("record-facts").waitFor({ timeout: 8000 });
  await dark.waitForTimeout(400);
  await dark.screenshot({ path: `${OUT}/b910_record_dark.png` });
  await closeTop(dark);
  await dark.getByTestId(`equip-history-${id}`).click();
  await dark.getByTestId(`history-event-${pm}`).waitFor({ timeout: 8000 });
  await dark.getByTestId("history-dialog").screenshot({ path: `${OUT}/b910_history_dark.png` });
  await closeTop(dark);
  await dark.getByTestId(`equip-log-${id}`).click();
  await dark.getByTestId("log-maintenance-dialog").waitFor({ timeout: 8000 });
  await dark.waitForTimeout(400);
  await dark.screenshot({ path: `${OUT}/b910_log_dark.png` });

  const phone = await openAs(token, PAGE, { viewport: { width: 390, height: 844 } });
  await phone.getByTestId(`equip-record-${id}`).waitFor({ timeout: 10000 });
  const overflow = async () => phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const o1 = await overflow();
  await phone.getByTestId(`equip-record-${id}`).click();
  await phone.getByTestId("record-facts").waitFor({ timeout: 8000 });
  await phone.waitForTimeout(400);
  const dlgOver = await phone.getByTestId("record-dialog").evaluate((el) => el.scrollWidth - el.clientWidth);
  await phone.screenshot({ path: `${OUT}/b910_record_phone.png` });
  await closeTop(phone);
  await phone.getByTestId(`equip-log-${id}`).click();
  const logOver = await phone.getByTestId("log-maintenance-dialog").evaluate((el) => el.scrollWidth - el.clientWidth);
  check("R9. phone width: the page and the dialogs don't overflow", o1 <= 0 && dlgOver <= 0 && logOver <= 0, `${o1} ${dlgOver} ${logOver}`);

  // ── R8. move ──
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId(`equip-record-${id}`).click();
  await page.getByTestId("move-lab").waitFor({ timeout: 8000 });
  await page.getByTestId("move-lab").selectOption(String(B.labId));
  await page.getByTestId("move-open").click();
  await page.getByTestId("move-dialog-reason").fill("Consolidating the core lab");
  await page.getByTestId("move-dialog").screenshot({ path: `${OUT}/b910_move_light.png` });
  await page.getByTestId("move-dialog-confirm").click();
  check("R8. it moves and says what was dropped", await said(page, "Moved to Second Campus Lab"));
  const there = sql("SELECT id, move_note FROM lab_equipment WHERE lab_id = ?", B.labId);
  const bp = await openAs(token, `/labs/${B.labId}/equipment-app`, { lab: B.labId });
  await bp.getByTestId(`equip-history-${there.id}`).click();
  await bp.getByText("Recorded at Record Test Lab, read-only").first().waitFor({ timeout: 8000 });
  check("R8. the history there is read-only", (await bp.locator('[data-testid^="history-correct-"]').count()) === 0 && (await bp.locator('[data-testid^="history-void-"]').count()) === 0 && (await bp.locator('[data-testid^="equip-file-remove-"]').count()) === 0);
  await closeTop(bp);
  await bp.getByTestId(`equip-record-${there.id}`).click();
  check("R8. the record there keeps the note", /Moved from Record Test Lab/.test(await bp.getByTestId("record-move-note").innerText()));
} catch (e) {
  check("the run finished", false, String(e?.stack || e).slice(0, 600));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAIL` : "\nALL PASS");
process.exit(failures ? 1 : 0);
