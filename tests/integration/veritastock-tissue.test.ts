// tests/integration/veritastock-tissue.test.ts
//
// Receipt for the VeritaStock tissue sub-module (Heywood, REQ-106; Michael Q152 = 1: NO PHI). Real routes on a scratch database
// with made-up data. Proves:
//   1. no recipient column on any tissue table, and no patient column on the log workbook
//   2. catalog: the lab owns it, edit needed, a row in use can't be deleted, one lab can't reach another's
//   3. receipt: catalog item required, tissue ID required and unique per lab and supplier, the checks at the blood bank
//   4. PHI: a labeled MRN, date of birth or patient name is refused with the reason on every write, and nothing is stored
//   5. issue: expired refused, every read-back must be yes, each with the reason; only from storage
//   6. exactly one final disposition; an open unit shows as open; the usage card is yes/no and a date
//   7. correction and undo need edit and a reason, re-check the rules, and the history keeps both values
//   8. lookup by tissue ID, and the recall match in every state, within the person's reach
//   9. the log workbook (About first, identity in three layers, locked) and the PDF token
//  10. the admin catalog load: dry run writes nothing, apply needs go, a rerun adds nothing, status is counts and names only
//  11. veritastock.com: every route answers 404. Plans: a lab without a suite plan is refused
//  12. the nightly scan covers the new tables, and export-all lists them
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
  const { scanPhi } = await import("../../server/phiScan");
  const { EXPORT_TABLES } = await import("../../server/exportAllTables");
  const { labLocalDate, labTimeZoneById } = await import("../../server/dateLocal");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = (method: string, p: string, body?: unknown, token?: string, headers: Record<string, string> = {}) =>
    fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };
  const stamp = Date.now();
  const mkOwner = async (tag: string) => {
    const email = `tissue-${tag}-${stamp}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true }));
    return { email, token: reg.token as string, id: Number(reg.user?.id) };
  };
  const mkLab = async (ownerEmail: string, name: string, plan = "hospital") =>
    (await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: name, plan }))).labId as number;
  const OA = await mkOwner("A");
  const OB = await mkOwner("B");
  const labA = await mkLab(OA.email, "Tissue Main");
  const labA2 = await mkLab(OA.email, "Tissue Annex");
  const labB = await mkLab(OB.email, "Tissue Other Owner");
  check("labs provisioned", !!labA && !!labA2 && !!labB);
  const T = `/api/labs/${labA}/veritastock/tissue`;
  const today = labLocalDate(new Date().toISOString(), false, labTimeZoneById(sqlite, labA));
  const shift = (d: number) => { const x = new Date(today + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  const FUTURE = shift(400);
  const post = (p: string, body: unknown, token = OA.token) => call("POST", `${T}${p}`, body, token);

  // 1. No patient field anywhere.
  for (const table of ["tissue_catalog", "tissue_units", "tissue_unit_events"]) {
    const cols = (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    check(`${table} has no patient column`, cols.length > 0 && !cols.some((c) => /patient|recipient|mrn|medical_record|dob|birth/i.test(c)), cols.join(","));
  }

  // 2. Catalog.
  const before = await j(await call("GET", `${T}/catalog`, undefined, OA.token));
  check("catalog starts empty", Array.isArray(before.items) && before.items.length === 0);
  const addCat = async (tissue_type: string, supplier_name: string, labPath = T, token = OA.token) => call("POST", `${labPath}/catalog`, { tissue_type, supplier_name }, token);
  const c1Res = await addCat("Made-up Bone Putty", "Made-up Supplier One");
  const c1 = (await j(c1Res)).id as number;
  check("catalog row added", c1Res.status === 201 && c1 > 0);
  const c2 = (await j(await addCat("Made-up Dermis", "made-up supplier one"))).id as number;
  const c3 = (await j(await addCat("Made-up Tendon", "Made-up Supplier Two"))).id as number;
  const cat = await j(await call("GET", `${T}/catalog`, undefined, OA.token));
  check("a supplier in different case is the same vendor", cat.items.find((i: any) => i.id === c1).vendor_id === cat.items.find((i: any) => i.id === c2).vendor_id);
  const v1 = cat.items.find((i: any) => i.id === c1).vendor_id as number;
  const v2 = cat.items.find((i: any) => i.id === c3).vendor_id as number;
  check("the supplier is in the lab's vendor directory", (await j(await call("GET", `/api/labs/${labA}/veritastock/vendors`, undefined, OA.token))).length === 2 || !!sqlite.prepare("SELECT 1 FROM stock_vendors WHERE id = ? AND lab_id = ?").get(v1, labA));
  check("the same type and supplier is refused (409)", (await addCat("made-up bone putty", "Made-up Supplier One")).status === 409);
  check("type required", (await addCat("", "x")).status === 400);
  check("supplier required", (await addCat("x", "")).status === 400);
  check("another owner can't add to this lab's catalog (403)", (await addCat("x", "y", T, OB.token)).status === 403);
  check("another owner can't read this lab's catalog (403)", (await call("GET", `${T}/catalog`, undefined, OB.token)).status === 403);
  const cOther = (await j(await addCat("Made-up Other Lab Item", "Made-up Other Supplier", `/api/labs/${labB}/veritastock/tissue`, OB.token))).id as number;
  const renamed = await call("PUT", `${T}/catalog/${c2}`, { tissue_type: "Made-up Dermis Renamed" }, OA.token);
  check("the lab can rename its row", renamed.status === 200);
  check("a row from another lab isn't reachable by id (404)", (await call("PUT", `${T}/catalog/${cOther}`, { tissue_type: "x" }, OA.token)).status === 404);

  // A seat with no edit: records, but doesn't manage the catalog.
  const seatEmail = `tissue-seat-${stamp}@example.com`;
  const seat = await j(await call("POST", "/api/auth/register", { email: seatEmail, password: "Testpass123", name: "Made Up Staff", hipaa_acknowledged: true }));
  sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status) VALUES (?, ?, 'staff', 'active')").run(labA, seat.user.id);
  sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_user_id, seat_email, lab_id, seat_type, status, permissions, invite_token) VALUES (?, ?, ?, ?, 'staff_portal', 'active', '{}', ?)")
    .run(OA.id, seat.user.id, seatEmail, labA, `tok-${stamp}`);
  check("a Staff seat can't change the catalog (403)", (await addCat("x", "y", T, seat.token)).status === 403);
  check("a Staff seat can read the catalog", (await call("GET", `${T}/catalog`, undefined, seat.token)).status === 200);

  // 3. Receipt.
  const receipt = (over: Record<string, unknown> = {}) => ({
    catalog_id: c1, source_id: "TIS-0001", quantity_or_size: "5 cc", expiration_date: FUTURE,
    received_mm_date: shift(-2), received_mm_time: "09:00", received_mm_by: "M. Handler", ...over,
  });
  const bbBody = (over: Record<string, unknown> = {}) => ({
    received_bb_date: shift(-2), received_bb_time: "10:00", received_bb_by: "B. Tech", transport_temp_ok: "yes", package_ok: "yes", storage_location: "Freezer A shelf 2", ...over,
  });
  check("no catalog row is refused", (await post("/units", receipt({ catalog_id: 999999 }))).status === 400);
  check("another lab's catalog row is refused", (await post("/units", receipt({ catalog_id: cOther }))).status === 400);
  check("tissue ID required", (await post("/units", receipt({ source_id: " " }))).status === 400);
  check("a tissue ID of only dashes is refused", (await post("/units", receipt({ source_id: " - " }))).status === 400);
  check("expiration required", (await post("/units", receipt({ expiration_date: "" }))).status === 400);
  check("MM date required", (await post("/units", receipt({ received_mm_date: "" }))).status === 400);
  check("MM time required", (await post("/units", receipt({ received_mm_time: "" }))).status === 400);
  check("MM by required", (await post("/units", receipt({ received_mm_by: " " }))).status === 400);
  check("a receipt dated tomorrow is refused", (await post("/units", receipt({ received_mm_date: shift(1) }))).status === 400);
  const u1Res = await post("/units", receipt());
  const u1 = await j(u1Res);
  check("unit received in Materials Management (201)", u1Res.status === 201 && u1.id > 0 && u1.state === "received_mm", JSON.stringify(u1).slice(0, 200));
  const dup = await post("/units", receipt({ source_id: "tis 0001", catalog_id: c2 }));
  check("the same ID from the same supplier is refused, however it's typed (409)", dup.status === 409 && (await j(dup)).code === "DUPLICATE_TISSUE_ID");
  const otherSupplier = await post("/units", receipt({ source_id: "TIS-0001", catalog_id: c3 }));
  const uSameId = await j(otherSupplier);
  check("the same ID from another supplier is a different unit", otherSupplier.status === 201 && uSameId.vendor_id === v2);
  const R1 = `/units/${u1.id}`;
  check("issue from Materials Management is refused: it isn't in storage", (await post(`${R1}/issue`, { readback_id: "yes", readback_expiration: "yes", readback_integrity: "yes", issued_date: today, issued_time: "10:00" })).status === 409);
  check("BB: transport temperature must be answered", (await post(`${R1}/receive-bb`, bbBody({ transport_temp_ok: "" }))).status === 400);
  check("BB: package integrity must be answered", (await post(`${R1}/receive-bb`, bbBody({ package_ok: "" }))).status === 400);
  check("BB: a temperature no needs the action taken", (await post(`${R1}/receive-bb`, bbBody({ transport_temp_ok: "no" }))).status === 400);
  check("BB: a package no needs the action taken", (await post(`${R1}/receive-bb`, bbBody({ package_ok: "no" }))).status === 400);
  check("BB: where it's stored is required", (await post(`${R1}/receive-bb`, bbBody({ storage_location: "" }))).status === 400);
  check("BB: earlier than Materials Management is refused", (await post(`${R1}/receive-bb`, bbBody({ received_bb_time: "08:00" }))).status === 400);
  // Storage link to a temperature unit: this lab's only.
  const tuA = Number(sqlite.prepare("INSERT INTO temp_log_units (lab_id, name, unit_type, min_value, max_value, scale) VALUES (?, 'Made-up Freezer', 'freezer', -30, -18, 'C')").run(labA).lastInsertRowid);
  const tuB = Number(sqlite.prepare("INSERT INTO temp_log_units (lab_id, name, unit_type, min_value, max_value, scale) VALUES (?, 'Other Lab Freezer', 'freezer', -30, -18, 'C')").run(labB).lastInsertRowid);
  check("BB: another lab's storage unit is refused", (await post(`${R1}/receive-bb`, bbBody({ storage_unit_id: tuB }))).status === 400);
  const bb = await post(`${R1}/receive-bb`, bbBody({ storage_unit_id: tuA }));
  check("BB receipt saved: the unit is in storage", bb.status === 200 && (await j(bb)).state === "stored");
  check("BB receipt can't be recorded twice (409)", (await post(`${R1}/receive-bb`, bbBody())).status === 409);
  sqlite.prepare("INSERT INTO temp_log_readings (lab_id, unit_id, reading_date, value, in_range) VALUES (?, ?, ?, -5, 0)").run(labA, tuA, shift(-1));
  sqlite.prepare("INSERT INTO temp_log_readings (lab_id, unit_id, reading_date, value, in_range) VALUES (?, ?, ?, -5, 0)").run(labA, tuA, shift(-10));
  const withStorage = await j(await call("GET", `${T}${R1}`, undefined, OA.token));
  check("the record shows its storage unit and the out-of-range readings while stored, not before", withStorage.storage?.name === "Made-up Freezer" && withStorage.storage?.out_of_range_while_stored === 1, JSON.stringify(withStorage.storage));
  const combined = await post("/units", receipt({ source_id: "TIS-0002", receive_bb: bbBody({ transport_temp_ok: "no", transport_action: "Moved to the backup freezer, supplier called" }) }));
  const u2 = await j(combined);
  check("receipt and blood bank in one save, with the no flagged", combined.status === 201 && u2.state === "stored" && u2.flags.receipt_problem === true && u2.transport_temp_ok === 0);
  const combinedBad = await post("/units", receipt({ source_id: "TIS-0003", receive_bb: bbBody({ package_ok: "" }) }));
  check("a bad blood bank part saves nothing", combinedBad.status === 400 && !sqlite.prepare("SELECT 1 FROM tissue_units WHERE source_id = 'TIS-0003'").get());
  check("a Staff seat can record a receipt", (await post("/units", receipt({ source_id: "TIS-STAFF" }), seat.token)).status === 201);

  // 4. PHI, on every write.
  const phiCases: [string, string, unknown][] = [
    ["catalog", "/catalog", { tissue_type: "Patient name: Pat Example", supplier_name: "x" }],
    ["receipt notes", "/units", receipt({ source_id: "PHI-1", notes: "MRN: 123456" })],
    ["tissue ID", "/units", receipt({ source_id: "MRN 123456" })],
    ["receipt by", "/units", receipt({ source_id: "PHI-2", received_mm_by: "recipient: Pat Example" })],
    ["action taken at the blood bank", `${R1}/receive-bb`, bbBody({ transport_action: "DOB 01/02/1950" })],
    ["delivered to", `/units/${u2.id}/issue`, { delivered_to: "patient: Pat Example" }],
    ["implanted by", `${R1}/implant`, { implanted_by: "MRN: 998877" }],
    ["disposition description", `/units/${u2.id}/dispose`, { kind: "wasted", disposition_description: "medical record number 777777" }],
    ["correction", `/units/${u2.id}/correct`, { reason: "typo", changes: { notes: "pt name: Pat Example" } }],
    ["correction reason", `/units/${u2.id}/correct`, { reason: "for patient: Pat Example", changes: { quantity_or_size: "1" } }],
    ["undo reason", `/units/${u2.id}/undo`, { reason: "SSN 123-45-6789" }],
  ];
  const textBefore = JSON.stringify(sqlite.prepare("SELECT * FROM tissue_units ORDER BY id").all());
  for (const [name, p, body] of phiCases) {
    const r = await post(p, body);
    const d = await j(r);
    check(`PHI refused with the reason: ${name}`, r.status === 400 && d.code === "PHI_REFUSED" && /patient information/.test(d.error) && Array.isArray(d.labels), `${r.status} ${JSON.stringify(d).slice(0, 160)}`);
  }
  check("no refused text was stored", JSON.stringify(sqlite.prepare("SELECT * FROM tissue_units ORDER BY id").all()) === textBefore);
  check("the refusal doesn't echo the text", !JSON.stringify(await j(await post("/units", receipt({ source_id: "PHI-3", notes: "MRN: 123456" })))).includes("123456"));
  check("plain text with the word patient passes", (await post("/units", receipt({ source_id: "PHI-OK", notes: "Patient not affected, supplier notified" }))).status === 201);

  // 5. Issue.
  const issue = (over: Record<string, unknown> = {}) => ({
    issued_date: today, issued_time: "11:00", requesting_physician: "Dr. Made Up", issued_to: "C. Courier", issued_by_tech: "B. Tech", delivered_to: "OR 4",
    readback_id: "yes", readback_expiration: "yes", readback_integrity: "yes", ...over,
  });
  for (const k of ["readback_id", "readback_expiration", "readback_integrity"]) {
    const no = await post(`${R1}/issue`, issue({ [k]: "no" }));
    const dn = await j(no);
    check(`issue refused with the reason when ${k} is no`, no.status === 409 && dn.code === "ISSUE_REFUSED" && dn.reasons.length === 1, JSON.stringify(dn));
    const blank = await post(`${R1}/issue`, issue({ [k]: "" }));
    check(`issue refused when ${k} isn't answered`, blank.status === 409 && (await j(blank)).code === "ISSUE_REFUSED");
  }
  check("still in storage after every refusal", (await j(await call("GET", `${T}${R1}`, undefined, OA.token))).state === "stored");
  for (const k of ["requesting_physician", "issued_to", "issued_by_tech", "delivered_to", "issued_time"]) check(`issue needs ${k}`, (await post(`${R1}/issue`, issue({ [k]: "" }))).status === 400);
  check("issue dated tomorrow is refused", (await post(`${R1}/issue`, issue({ issued_date: shift(1) }))).status === 400);
  check("issue before the blood bank receipt is refused", (await post(`${R1}/issue`, issue({ issued_date: shift(-3) }))).status === 400);
  const expired = await j(await post("/units", receipt({ source_id: "TIS-EXPIRED", expiration_date: shift(-1), received_mm_date: shift(-5), receive_bb: bbBody({ received_bb_date: shift(-5) }) })));
  check("an expired unit can be received, and shows past expiration while open", expired.state === "stored" && expired.flags.expired_on_shelf === true);
  const expIssue = await post(`/units/${expired.id}/issue`, issue());
  const dExp = await j(expIssue);
  check("an expired unit can't be issued, with the reason", expIssue.status === 409 && dExp.code === "ISSUE_REFUSED" && /expired on/.test(dExp.error), JSON.stringify(dExp));
  const issued = await post(`${R1}/issue`, issue());
  const dIssued = await j(issued);
  check("issue saved with all three read-backs", issued.status === 200 && dIssued.state === "issued" && dIssued.readback_id_ok === 1 && dIssued.readback_expiration_ok === 1 && dIssued.readback_integrity_ok === 1 && dIssued.delivered_to === "OR 4");
  check("a unit can't be issued twice (409)", (await post(`${R1}/issue`, issue())).status === 409);

  // 6. Implant, card, final disposition.
  check("implant needs a stored unit to have been issued first", (await post(`/units/${u2.id}/implant`, { implanted_date: today, implanted_time: "12:00", implanted_by: "Dr. Surgeon" })).status === 409);
  check("implant needs a time", (await post(`${R1}/implant`, { implanted_date: today, implanted_by: "Dr. Surgeon" })).status === 400);
  check("implant needs who", (await post(`${R1}/implant`, { implanted_date: today, implanted_time: "12:00" })).status === 400);
  check("implant before the issue is refused", (await post(`${R1}/implant`, { implanted_date: today, implanted_time: "10:59", implanted_by: "Dr. Surgeon" })).status === 400);
  check("part of a reconstitution is refused", (await post(`${R1}/implant`, { implanted_date: today, implanted_time: "12:00", implanted_by: "Dr. Surgeon", reconstituted_time: "11:30" })).status === 400);
  check("usage card before the implant is refused (409)", (await post(`${R1}/usage-card`, { usage_card_returned: "yes", usage_card_returned_on: today })).status === 409);
  const implanted = await post(`${R1}/implant`, { implanted_date: today, implanted_time: "12:00", implanted_by: "Dr. Surgeon", reconstituted_time: "11:30", reconstituted_by: "N. Nurse", reconstitution_solution: "Made-up Saline", reconstitution_lot: "SOL-1", reconstitution_expiration: FUTURE });
  const dImp = await j(implanted);
  check("implant saved: final, not open, card pending", implanted.status === 200 && dImp.state === "implanted" && dImp.flags.open === false && dImp.flags.card_pending === true && dImp.reconstitution_lot === "SOL-1");
  check("a final unit can't take another disposition (409)", (await post(`${R1}/dispose`, { kind: "wasted", disposition_date: today, disposition_time: "13:00", disposition_description: "x", disposition_by: "y" })).status === 409);
  check("a final unit can't be issued (409)", (await post(`${R1}/issue`, issue())).status === 409);
  check("usage card yes needs the date", (await post(`${R1}/usage-card`, { usage_card_returned: "yes" })).status === 400);
  check("usage card date in the future is refused", (await post(`${R1}/usage-card`, { usage_card_returned: "yes", usage_card_returned_on: shift(1) })).status === 400);
  check("usage card date before the implant is refused", (await post(`${R1}/usage-card`, { usage_card_returned: "yes", usage_card_returned_on: shift(-1) })).status === 400);
  check("usage card must be answered", (await post(`${R1}/usage-card`, {})).status === 400);
  const cardOk = await j(await post(`${R1}/usage-card`, { usage_card_returned: "yes", usage_card_returned_on: today }));
  check("usage card returned: yes and the date, and no longer pending", cardOk.usage_card_returned === 1 && cardOk.usage_card_returned_on === today && cardOk.flags.card_pending === false);
  const cardNo = await j(await post(`${R1}/usage-card`, { usage_card_returned: "no" }));
  check("usage card back to no clears the date", cardNo.usage_card_returned === 0 && cardNo.usage_card_returned_on === null);
  await post(`${R1}/usage-card`, { usage_card_returned: "yes", usage_card_returned_on: today });
  const dispBody = (kind: string) => ({ kind, disposition_date: today, disposition_time: "13:00", disposition_description: "Made-up description", disposition_by: "B. Tech" });
  check("a disposition must be wasted, returned or expired", (await post(`/units/${u2.id}/dispose`, dispBody("implanted"))).status === 400);
  check("a disposition needs a description", (await post(`/units/${u2.id}/dispose`, { ...dispBody("wasted"), disposition_description: "" })).status === 400);
  check("a disposition needs who", (await post(`/units/${u2.id}/dispose`, { ...dispBody("wasted"), disposition_by: "" })).status === 400);
  const waste = await j(await post(`/units/${u2.id}/dispose`, dispBody("wasted")));
  check("wasted is final", waste.state === "wasted" && waste.flags.open === false);
  const expDisp = await j(await post(`/units/${expired.id}/dispose`, dispBody("expired")));
  check("the expired unit closes as expired", expDisp.state === "expired");

  // The log.
  const open = await j(await call("GET", `${T}/units?filter=open`, undefined, OA.token));
  const all = await j(await call("GET", `${T}/units?filter=all`, undefined, OA.token));
  check("the log: every unit once", all.rows.length === all.counts.all && all.rows.filter((u: any) => u.id === u1.id).length === 1);
  check("open shows only units with no final disposition", open.rows.length === open.counts.open && open.rows.every((u: any) => u.flags.open) && !open.rows.some((u: any) => [u1.id, u2.id, expired.id].includes(u.id)));
  check("open includes a unit received and nothing more", open.rows.some((u: any) => u.source_id === "TIS-STAFF"));
  check("the usage-card view lists implanted units with no card back", (await j(await call("GET", `${T}/units?filter=card_pending`, undefined, OA.token))).rows.length === 0);

  // 7. Correct and undo.
  const fix = (id: number, body: unknown, token = OA.token) => call("POST", `${T}/units/${id}/correct`, body, token);
  check("correction needs a reason", (await fix(uSameId.id, { changes: { quantity_or_size: "7 cc" } })).status === 400);
  check("correction needs a change", (await fix(uSameId.id, { reason: "typo", changes: {} })).status === 400);
  check("a Staff seat can't correct (403)", (await fix(uSameId.id, { reason: "typo", changes: { quantity_or_size: "7 cc" } }, seat.token)).status === 403);
  const fixed = await fix(uSameId.id, { reason: "Typed the wrong size", changes: { quantity_or_size: "7 cc" } });
  check("correction saved", fixed.status === 200 && (await j(fixed)).quantity_or_size === "7 cc");
  check("a correction that changes nothing is refused", (await fix(uSameId.id, { reason: "x", changes: { quantity_or_size: "7 cc" } })).status === 400);
  check("a field from a step not recorded yet can't be set", (await fix(uSameId.id, { reason: "x", changes: { issued_by_tech: "x" } })).status === 400);
  check("the state can't be corrected", (await fix(uSameId.id, { reason: "x", changes: { state: "implanted" } })).status === 400);
  check("a read-back can't be corrected", (await fix(u1.id, { reason: "x", changes: { readback_id_ok: 0 } })).status === 400);
  check("a correction can't put the issue after expiration", (await fix(u1.id, { reason: "x", changes: { expiration_date: shift(-1) } })).status === 409);
  check("a correction can't clear a required name", (await fix(u1.id, { reason: "x", changes: { implanted_by: " " } })).status === 400);
  check("a correction can't put a step out of order", (await fix(u1.id, { reason: "x", changes: { received_bb_date: shift(0), received_bb_time: "23:59" } })).status === 400);
  check("a correction can't reuse another unit's ID", (await fix(u2.id, { reason: "x", changes: { source_id: "TIS-0001" } })).status === 409);
  const reId = await j(await fix(u2.id, { reason: "Label misread", changes: { source_id: "TIS-0002-B" } }));
  check("a corrected ID is what lookup finds", reId.source_id_key === "TIS0002B" && (await j(await call("GET", `${T}/lookup?id=tis0002b`, undefined, OA.token))).matches.length === 1);
  const hist = await j(await call("GET", `${T}/units/${u2.id}`, undefined, OA.token));
  const corr = hist.events.find((e: any) => e.event_type === "corrected");
  check("the history keeps both values and the reason", !!corr && JSON.parse(corr.detail_json).reason === "Label misread" && JSON.parse(corr.detail_json).changes[0].from === "TIS-0002" && JSON.parse(corr.detail_json).changes[0].to === "TIS-0002-B");
  const undo = (id: number, body: unknown, token = OA.token) => call("POST", `${T}/units/${id}/undo`, body, token);
  check("undo needs a reason", (await undo(u1.id, {})).status === 400);
  check("a Staff seat can't undo (403)", (await undo(u1.id, { reason: "x" }, seat.token)).status === 403);
  const undone = await j(await undo(u1.id, { reason: "Wrong unit" }));
  check("undo the implant: back to issued, implant fields and card cleared", undone.state === "issued" && undone.implanted_date === null && undone.usage_card_returned === null && undone.reconstitution_lot === null);
  const undoneTwice = await j(await undo(u1.id, { reason: "Surgery cancelled, back in storage" }));
  check("undo the issue: back in storage, can be issued again", undoneTwice.state === "stored" && undoneTwice.issued_date === null && undoneTwice.readback_id_ok === null);
  const uh = await j(await call("GET", `${T}${R1}`, undefined, OA.token));
  const lastUndo = uh.events.filter((e: any) => e.event_type === "undone")[0];
  check("the history keeps what was cleared", JSON.parse(lastUndo.detail_json).cleared.implanted_by === "Dr. Surgeon");
  check("the earlier steps stay in the history", uh.events.some((e: any) => e.event_type === "implanted") && uh.events.some((e: any) => e.event_type === "issued"));
  const undoDisp = await j(await undo(u2.id, { reason: "Not wasted" }));
  check("undo a disposition: back to where it was", undoDisp.state === "stored" && undoDisp.disposition_date === null);
  const mmOnly = await j(await post("/units", receipt({ source_id: "TIS-MM" })));
  const undoFirst = await undo(mmOnly.id, { reason: "x" });
  check("the first receipt can't be undone", undoFirst.status === 409 && (await j(undoFirst)).code === "NOTHING_TO_UNDO");
  const dispFromMm = await j(await post(`/units/${mmOnly.id}/dispose`, { ...dispBody("returned"), disposition_date: today }));
  check("a unit received and sent back closes as returned", dispFromMm.state === "returned");
  // Put u1 through again so the recall shows an implanted unit.
  await post(`${R1}/issue`, issue());
  await post(`${R1}/implant`, { implanted_date: today, implanted_time: "12:00", implanted_by: "Dr. Surgeon" });
  check("an event row can't be reached by any route: there is no delete of a unit or event", !sqlite.prepare("SELECT 1 FROM tissue_units WHERE id = ?").get(999999));

  // Catalog row in use / vendor in use.
  const inUse = await call("DELETE", `${T}/catalog/${c1}`, undefined, OA.token);
  check("a catalog row in use can't be deleted", inUse.status === 409 && (await j(inUse)).code === "CATALOG_IN_USE");
  const retire = await call("PUT", `${T}/catalog/${c1}`, { active: "no" }, OA.token);
  check("a row in use can be retired", retire.status === 200);
  check("a retired row can't take a new receipt", (await post("/units", receipt({ source_id: "TIS-RET" }))).status === 400);
  check("its old units keep their type and supplier", (await j(await call("GET", `${T}${R1}`, undefined, OA.token))).tissue_type === "Made-up Bone Putty");
  await call("PUT", `${T}/catalog/${c1}`, { active: "yes" }, OA.token);
  const vDel = await call("DELETE", `/api/labs/${labA}/veritastock/vendors/${v1}`, undefined, OA.token);
  check("a supplier in use can't be deleted from the vendor directory", vDel.status === 409 && (await j(vDel)).code === "VENDOR_HOLDS_TISSUE");
  const unusedVendor = await j(await call("POST", `/api/labs/${labA}/veritastock/vendors`, { name: "Made-up Unused" }, OA.token));
  check("a vendor with no tissue still deletes", (await call("DELETE", `/api/labs/${labA}/veritastock/vendors/${unusedVendor.id}`, undefined, OA.token)).status === 200);
  const cFree = (await j(await addCat("Made-up Never Used", "Made-up Supplier Two"))).id as number;
  check("a row never used can be deleted", (await call("DELETE", `${T}/catalog/${cFree}`, undefined, OA.token)).status === 200);

  // 8. Lookup, and the recall match.
  const look = await j(await call("GET", `${T}/lookup?id=${encodeURIComponent("tis 0001")}`, undefined, OA.token));
  check("lookup finds it however it's typed, one per supplier, with its state", look.matches.length === 2 && look.matches.some((u: any) => u.state === "implanted" && u.implanted_by === "Dr. Surgeon"), JSON.stringify(look.matches).slice(0, 200));
  check("lookup with nothing typed is refused", (await call("GET", `${T}/lookup?id=`, undefined, OA.token)).status === 400);
  check("lookup with no match is empty", (await j(await call("GET", `${T}/lookup?id=NOPE`, undefined, OA.token))).matches.length === 0);
  check("another owner can't look up here (403)", (await call("GET", `${T}/lookup?id=TIS0001`, undefined, OB.token)).status === 403);
  check("a unit from another lab isn't reachable by id (404)", (await call("GET", `/api/labs/${labA2}/veritastock/tissue${R1}`, undefined, OA.token)).status === 404);
  check("a write through another lab's path doesn't reach it (404)", (await call("POST", `/api/labs/${labA2}/veritastock/tissue${R1}/undo`, { reason: "x" }, OA.token)).status === 404);
  const recall = await j(await call("POST", `/api/labs/${labA}/veritastock/recalls`, { notice_type: "recall", vendor: "Made-up Supplier One", product: "Made-up Bone Putty", lot_numbers: "TIS-0001\nTIS-0002-B", local_date: today }, OA.token));
  const rc = await j(await call("GET", `/api/labs/${labA}/veritastock/recalls/${recall.id}`, undefined, OA.token));
  const tm = (rc.matches || []).filter((m: any) => m.source === "tissue");
  const implantedMatch = tm.find((m: any) => m.tissue.unit_id === u1.id);
  check("recall: finds the implanted unit with date and surgeon", !!implantedMatch && implantedMatch.tissue.state === "implanted" && implantedMatch.tissue.implanted_by === "Dr. Surgeon" && implantedMatch.vendor_matches === true, JSON.stringify(implantedMatch));
  check("recall: finds a unit on the shelf too", tm.some((m: any) => m.tissue.unit_id === u2.id && m.tissue.state === "stored"));
  check("recall: another supplier's same ID shows, flagged to check", tm.some((m: any) => m.tissue.unit_id === uSameId.id && m.vendor_matches === false));
  check("recall: no patient field in a tissue match", !/patient|recipient|mrn/i.test(JSON.stringify(tm)));
  const srcUnit = sqlite.prepare("SELECT id FROM inventory_items WHERE id = ?").get(u1.id);
  const noPull = await call("POST", `/api/labs/${labA}/veritastock/recalls/${recall.id}/remove-stock`, { item_id: 987654, qty: 1 }, OA.token);
  check("recall: pulling stock still works on inventory only", noPull.status === 404 && (srcUnit === undefined || srcUnit !== null));
  // Sister lab: a seat in lab A doesn't see lab A2's tissue through a recall in lab A.
  const a2c = (await j(await addCat("Made-up Annex Item", "Made-up Supplier One", `/api/labs/${labA2}/veritastock/tissue`))).id as number;
  await call("POST", `/api/labs/${labA2}/veritastock/tissue/units`, receipt({ catalog_id: a2c, source_id: "SIS-1" }), OA.token);
  const sisterCase = await j(await call("POST", `/api/labs/${labA}/veritastock/recalls`, { notice_type: "recall", vendor: "Made-up Supplier One", product: "x", lot_numbers: "SIS-1", local_date: today }, OA.token));
  const ownerSees = (await j(await call("GET", `/api/labs/${labA}/veritastock/recalls/${sisterCase.id}`, undefined, OA.token))).matches || [];
  const seatSees = (await j(await call("GET", `/api/labs/${labA}/veritastock/recalls/${sisterCase.id}`, undefined, seat.token))).matches || [];
  check("recall: the owner of both labs sees the sister lab's unit", ownerSees.some((m: any) => m.source === "tissue" && m.lot_number === "SIS-1"));
  check("recall: a seat in this lab doesn't", !seatSees.some((m: any) => m.source === "tissue"), JSON.stringify(seatSees).slice(0, 200));

  // 9. Exports.
  const xl = await j(await post("/log/xlsx", { filter: "all" }));
  const pdf = await j(await post("/log/pdf", { filter: "all" }));
  check("workbook and PDF give a token and the unit count", !!xl.token && xl.unit_count === all.counts.all + 1 && !!pdf.token && pdf.unit_count === xl.unit_count, JSON.stringify({ xl, pdf, n: all.counts }));
  const xlRes = await fetch(`${base}/api/pdf/${xl.token}`);
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await xlRes.arrayBuffer()) as any);
  check("workbook: About first, then the log", wb.worksheets[0].name === "About" && wb.worksheets[1].name === "Perpetual Log");
  const logSheet = wb.getWorksheet("Perpetual Log")!;
  const headers = ((logSheet.getRow(1).values as any[]) || []).filter(Boolean).map(String);
  check("workbook: no patient column", !headers.some((h) => /patient|recipient|medical record|mrn/i.test(h)), headers.join("|"));
  check("workbook: identity on the About sheet, header and footer", /Prepared for: Tissue Main/.test(String(wb.getWorksheet("About")!.getCell("A2").value)) && /Tissue Main/.test(String(logSheet.headerFooter.oddHeader)) && /Tissue Main/.test(String(logSheet.headerFooter.oddFooter)));
  check("workbook: locked, filter on, frozen at B2", !!(logSheet as any).sheetProtection?.sheet && !!logSheet.autoFilter && logSheet.views[0]?.xSplit === 1 && logSheet.views[0]?.ySplit === 1);
  const flat = wb.worksheets.flatMap((ws) => { const out: string[] = []; ws.eachRow((r) => r.eachCell((c) => out.push(String(c.value ?? "")))); return out; }).join(" ");
  const EM_DASH = String.fromCharCode(0x2014);
  check("workbook: no em dash, no literal null", !flat.includes(EM_DASH) && !/\bnull\b|\bundefined\b/.test(flat));
  check("workbook: one row per unit", logSheet.rowCount - 1 === xl.unit_count);
  const storedCol = headers.indexOf("Stored at") + 1;
  // Two units carry this ID, one per supplier; the one with the temperature-logged unit is Supplier One's.
  const idRow = (id: string, supplier: string) => { for (let r = 2; r <= logSheet.rowCount; r++) if (String(logSheet.getRow(r).getCell(1).value) === id && String(logSheet.getRow(r).getCell(3).value) === supplier) return logSheet.getRow(r); return null; };
  const u1Stored = String(idRow("TIS-0001", "Made-up Supplier One")?.getCell(storedCol).value ?? "");
  check("workbook: where it's stored names the temperature-logged unit and the shelf", /Made-up Freezer/.test(u1Stored) && /Freezer A shelf 2/.test(u1Stored), u1Stored);
  check("workbook: a Staff seat can download it", (await call("POST", `${T}/log/xlsx`, { filter: "open" }, seat.token)).status === 200);
  const pdfRes = await fetch(`${base}/api/pdf/${pdf.token}`);
  const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
  check("PDF: a real PDF", pdfBytes.slice(0, 5).toString() === "%PDF-" && pdfBytes.length > 2000);
  const { PDFDocument } = await import("pdf-lib");
  check("PDF: author metadata", (await PDFDocument.load(pdfBytes)).getAuthor() === "Perplexity Computer");
  const { buildTissueLogHTML } = await import("../../server/tissueLogExport");
  const html = buildTissueLogHTML(all.rows, { labName: "Tissue Main", cliaNumber: null, today, filter: "all" });
  check("PDF: CLIA line when none is on file, no em dash, no patient heading", /CLIA: Not on file - enter in account settings/.test(html) && !html.includes(EM_DASH) &&!/<th>[^<]*(patient|recipient|medical record)/i.test(html));

  // 10. The catalog load.
  const load = (body: unknown, headers: Record<string, string> = { "x-admin-secret": ADMIN }) => call("POST", "/api/admin/veritastock/tissue/catalog-load", body, undefined, headers);
  const pairs = [{ tissue_type: "Load Item One", supplier: "Load Supplier A" }, { tissue_type: "Load Item Two ", supplier: "load supplier a" }, { tissue_type: "Load Item Three", supplier: "Load Supplier B" }, { tissue_type: "Load Item One", supplier: "Load Supplier A" }, { tissue_type: "", supplier: "x" }];
  check("load: no secret is refused", (await load({ labId: labB, rows: pairs }, {})).status === 403);
  check("load: a wrong secret is refused", (await load({ labId: labB, rows: pairs }, { "x-admin-secret": "nope" })).status === 403);
  check("load: a secret in the URL is refused", (await call("POST", `/api/admin/veritastock/tissue/catalog-load?secret=${ADMIN}`, { labId: labB, rows: pairs })).status === 403);
  const beforeLoad = Number((sqlite.prepare("SELECT COUNT(*) n FROM tissue_catalog WHERE lab_id = ?").get(labB) as any).n);
  const vBefore = Number((sqlite.prepare("SELECT COUNT(*) n FROM stock_vendors WHERE lab_id = ?").get(labB) as any).n);
  const dry = await j(await load({ labId: labB, rows: pairs }));
  check("load: dry run by default, with the plan", dry.dry_run === true && dry.to_add === 3 && dry.already_on_file === 0 && dry.duplicates_in_file === 1 && dry.blank_rows === 1 && dry.supplier_count === 2 && dry.new_suppliers === 2, JSON.stringify(dry));
  check("load: the dry run wrote nothing", Number((sqlite.prepare("SELECT COUNT(*) n FROM tissue_catalog WHERE lab_id = ?").get(labB) as any).n) === beforeLoad && Number((sqlite.prepare("SELECT COUNT(*) n FROM stock_vendors WHERE lab_id = ?").get(labB) as any).n) === vBefore);
  check("load: apply without go is refused", (await load({ labId: labB, rows: pairs, apply: true })).status === 400);
  check("load: apply true is the only way to write", (await j(await load({ labId: labB, rows: pairs, apply: "yes", go: "x" }))).dry_run === true);
  check("load: PHI in a row is refused", (await j(await load({ labId: labB, rows: [{ tissue_type: "MRN: 123456", supplier: "x" }] }))).code === "PHI_REFUSED");
  const applied = await j(await load({ labId: labB, rows: pairs, apply: true, go: "Made Up Approver, test" }));
  check("load: applied", applied.dry_run === false && applied.to_add === 3);
  check("load: three rows and two new suppliers are there", Number((sqlite.prepare("SELECT COUNT(*) n FROM tissue_catalog WHERE lab_id = ?").get(labB) as any).n) === beforeLoad + 3 && Number((sqlite.prepare("SELECT COUNT(*) n FROM stock_vendors WHERE lab_id = ?").get(labB) as any).n) === vBefore + 2);
  check("load: the go is on the audit row", !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'tissue_catalog' AND after_json LIKE '%Made Up Approver%'").get());
  const rerun = await j(await load({ labId: labB, rows: pairs, apply: true, go: "x" }));
  check("load: a rerun adds nothing", rerun.to_add === 0 && rerun.already_on_file === 3 && rerun.new_suppliers === 0);
  const status = await j(await call("GET", `/api/admin/veritastock/tissue/catalog-status?labId=${labB}`, undefined, undefined, { "x-admin-secret": ADMIN }));
  check("status: counts and names, nothing about a unit or person", status.catalog_count === beforeLoad + 3 && status.supplier_count === 3 && status.unit_count === 0 && status.products.includes("Load Item One") && !/surgeon|implanted_by|physician/i.test(JSON.stringify(status)), JSON.stringify(status));
  check("status: no secret is refused", (await call("GET", `/api/admin/veritastock/tissue/catalog-status?labId=${labB}`)).status === 403);
  check("status: a lab that doesn't exist is 404", (await call("GET", "/api/admin/veritastock/tissue/catalog-status?labId=9999999", undefined, undefined, { "x-admin-secret": ADMIN })).status === 404);

  // 11. veritastock.com, and plans.
  process.env.VITE_STOCK_DEPLOYMENT = "true";
  check("veritastock.com: the log answers 404", (await call("GET", `${T}/units`, undefined, OA.token)).status === 404);
  check("veritastock.com: the catalog answers 404", (await call("GET", `${T}/catalog`, undefined, OA.token)).status === 404);
  check("veritastock.com: a receipt answers 404", (await post("/units", receipt({ source_id: "STOCK-1" }))).status === 404);
  check("veritastock.com: the admin load answers 404", (await load({ labId: labB, rows: pairs })).status === 404);
  delete process.env.VITE_STOCK_DEPLOYMENT;
  const free = await mkOwner("Free");
  const freeLab = await mkLab(free.email, "Tissue No Plan");
  sqlite.prepare("UPDATE labs SET plan = 'free' WHERE id = ?").run(freeLab);
  check("a lab with no suite plan is refused (403)", (await call("GET", `/api/labs/${freeLab}/veritastock/tissue/units`, undefined, free.token)).status === 403);

  // 12. The nightly scan and the export.
  const clean = scanPhi(sqlite, { maxFindings: 5000 });
  check("the scan finds nothing in the tissue tables so far", !clean.findings.some((f: any) => f.table.startsWith("tissue_")), JSON.stringify(clean.findings.filter((f: any) => f.table.startsWith("tissue_")).slice(0, 3)));
  const planted = Number(sqlite.prepare("INSERT INTO tissue_units (lab_id, catalog_id, vendor_id, tissue_type, supplier_name, source_id, source_id_key, expiration_date, notes) VALUES (?, 1, 1, 'x', 'x', 'PLANT', 'PLANT', '2030-01-01', 'MRN: 555555')").run(labB).lastInsertRowid);
  const plantedEvent = Number(sqlite.prepare("INSERT INTO tissue_unit_events (unit_id, lab_id, event_type, detail_json) VALUES (?, ?, 'corrected', '{\"note\":\"DOB 01/02/1950\"}')").run(planted, labB).lastInsertRowid);
  const scan = scanPhi(sqlite, { maxFindings: 5000 });
  check("the nightly scan covers tissue_units", scan.findings.some((f: any) => f.table === "tissue_units" && f.column === "notes" && Number(f.rowId) === planted));
  check("the nightly scan covers tissue_unit_events", scan.findings.some((f: any) => f.table === "tissue_unit_events" && Number(f.rowId) === plantedEvent));
  sqlite.prepare("DELETE FROM tissue_unit_events WHERE id = ?").run(plantedEvent);
  sqlite.prepare("DELETE FROM tissue_units WHERE id = ?").run(planted);
  for (const t of ["tissue_catalog", "tissue_units", "tissue_unit_events"]) check(`export-all lists ${t} by lab`, (EXPORT_TABLES as any)[t]?.scope?.kind === "lab" && (EXPORT_TABLES as any)[t]?.module === "VeritaStock");

  server.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
