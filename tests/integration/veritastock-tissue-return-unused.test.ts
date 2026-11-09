// tests/integration/veritastock-tissue-return-unused.test.ts
//
// Receipt for "Returned unused" on VeritaStock tissue (Michael Veri 2026-11-09: "They also need to be able to return the tissue if
// it is not implanted after issue."). Real routes on a scratch database with made-up data. Proves:
//   1. a return is taken only from issued: 409 from storage, from Materials Management and from any final disposition
//   2. every required field, not in the future, not before the issue, where it goes back, and the PHI refusal on every text field
//   3. a no on either check refuses (400) and leaves the unit issued with nothing written; Other disposition then closes it
//   4. success, in one step: stored, the issue fields off the row, the receipt kept, the storage set, the event holding the old
//      issue and every return field, and an audit row
//   5. issued again through the existing issue route: the second issue writes its own fields, and can't be earlier than the return
//   6. undo after a return restores the issue and the storage it had; the next undo goes on as before (no second restore), through
//      a second issue, a disposition after the return, and two returns
//   7. an expired unit can be returned, and can't be issued again
//   8. the terminal "returned" reads "Returned to supplier"; the stored value is unchanged
//   9. the log workbook and PDF still build and name each return still standing
//  10. lab scope: another owner, a sister lab's path, a Staff seat (records a return, can't undo), veritastock.com
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

const ISSUE_FIELDS = ["issued_date", "issued_time", "requesting_physician", "issued_to", "issued_by_tech", "delivered_to", "readback_id_ok", "readback_expiration_ok", "readback_integrity_ok"];
const RECEIPT_FIELDS = ["received_mm_date", "received_mm_time", "received_mm_by", "received_bb_date", "received_bb_time", "received_bb_by", "transport_temp_ok", "transport_action", "package_ok"];
const pick = (u: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, u?.[k] ?? null]));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
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
    const email = `tissue-ret-${tag}-${stamp}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true }));
    return { email, token: reg.token as string, id: Number(reg.user?.id) };
  };
  const mkLab = async (ownerEmail: string, name: string, plan = "hospital") =>
    (await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: name, plan }))).labId as number;
  const OA = await mkOwner("A");
  const OB = await mkOwner("B");
  const labA = await mkLab(OA.email, "Return Main");
  const labA2 = await mkLab(OA.email, "Return Annex");
  const labB = await mkLab(OB.email, "Return Other Owner");
  check("labs provisioned", !!labA && !!labA2 && !!labB);
  const T = `/api/labs/${labA}/veritastock/tissue`;
  const today = labLocalDate(new Date().toISOString(), false, labTimeZoneById(sqlite, labA));
  const shift = (d: number) => { const x = new Date(today + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  const FUTURE = shift(400);
  const post = (p: string, body: unknown, token = OA.token) => call("POST", `${T}${p}`, body, token);
  const get = async (id: number, token = OA.token) => j(await call("GET", `${T}/units/${id}`, undefined, token));
  const rowOf = (id: number) => sqlite.prepare("SELECT * FROM tissue_units WHERE id = ?").get(id) as any;
  const eventsOf = (id: number, type?: string) => (sqlite.prepare("SELECT * FROM tissue_unit_events WHERE unit_id = ? ORDER BY id").all(id) as any[]).filter((e) => !type || e.event_type === type);

  const cat = await j(await call("POST", `${T}/catalog`, { tissue_type: "Made-up Bone Putty", supplier_name: "Made-up Supplier One" }, OA.token));
  const tuA = Number(sqlite.prepare("INSERT INTO temp_log_units (lab_id, name, unit_type, min_value, max_value, scale) VALUES (?, 'Made-up Freezer A', 'freezer', -30, -18, 'C')").run(labA).lastInsertRowid);
  const tuA2 = Number(sqlite.prepare("INSERT INTO temp_log_units (lab_id, name, unit_type, min_value, max_value, scale) VALUES (?, 'Made-up Freezer B', 'freezer', -30, -18, 'C')").run(labA).lastInsertRowid);
  const tuB = Number(sqlite.prepare("INSERT INTO temp_log_units (lab_id, name, unit_type, min_value, max_value, scale) VALUES (?, 'Other Lab Freezer', 'freezer', -30, -18, 'C')").run(labB).lastInsertRowid);
  let n = 0;
  const receive = async (over: Record<string, unknown> = {}, bbOver: Record<string, unknown> = {}) => {
    n++;
    const r = await post("/units", {
      catalog_id: cat.id, source_id: `RET-${n}`, quantity_or_size: "5 cc", expiration_date: FUTURE,
      received_mm_date: shift(-5), received_mm_time: "09:00", received_mm_by: "M. Handler",
      receive_bb: { received_bb_date: shift(-5), received_bb_time: "10:00", received_bb_by: "B. Tech", transport_temp_ok: "yes", package_ok: "yes", storage_unit_id: tuA, storage_location: "Freezer A shelf 2", ...bbOver },
      ...over,
    });
    return j(r);
  };
  const issueBody = (over: Record<string, unknown> = {}) => ({
    issued_date: shift(-2), issued_time: "08:00", requesting_physician: "Dr. Made Up", issued_to: "C. Courier", issued_by_tech: "B. Tech", delivered_to: "OR 4",
    readback_id: "yes", readback_expiration: "yes", readback_integrity: "yes", ...over,
  });
  const retBody = (over: Record<string, unknown> = {}) => ({
    returned_date: shift(-2), returned_time: "12:00", returned_by: "C. Courier", received_back_by: "R. Tech", storage_ok: "yes", package_ok_on_return: "yes",
    storage_unit_id: tuA2, storage_location: "Freezer B shelf 1", note: "Case cancelled, graft unopened", ...over,
  });
  const issue = (id: number, over: Record<string, unknown> = {}, token = OA.token) => post(`/units/${id}/issue`, issueBody(over), token);
  const ret = (id: number, over: Record<string, unknown> = {}, token = OA.token) => post(`/units/${id}/return-unused`, retBody(over), token);
  const undo = (id: number, reason: string | undefined, token = OA.token) => post(`/units/${id}/undo`, reason === undefined ? {} : { reason }, token);
  const dispose = (id: number, kind: string, over: Record<string, unknown> = {}) =>
    post(`/units/${id}/dispose`, { kind, disposition_date: today, disposition_time: "13:00", disposition_description: "Made-up description", disposition_by: "B. Tech", ...over });

  // 1. Only from issued.
  const stored = await receive();
  check("setup: a unit in storage", stored.state === "stored" && stored.storage_unit_id === tuA);
  const fromStored = await ret(stored.id);
  check("a unit in storage can't be returned (409)", fromStored.status === 409 && (await j(fromStored)).code === "NOT_ISSUED");
  const mmOnly = await j(await post("/units", { catalog_id: cat.id, source_id: "RET-MM", expiration_date: FUTURE, received_mm_date: shift(-5), received_mm_time: "09:00", received_mm_by: "M. Handler" }));
  check("a unit only in Materials Management can't be returned (409)", (await ret(mmOnly.id)).status === 409);
  const impl = await receive();
  await issue(impl.id);
  await post(`/units/${impl.id}/implant`, { implanted_date: shift(-2), implanted_time: "11:00", implanted_by: "Dr. Surgeon" });
  const fromImplanted = await ret(impl.id, { returned_time: "13:00" });
  check("an implanted unit can't be returned (409, final)", fromImplanted.status === 409 && (await j(fromImplanted)).code === "UNIT_FINAL");
  const toSupplier = await receive();
  await dispose(toSupplier.id, "returned");
  check("a unit returned to the supplier can't be returned to storage (409, final)", (await ret(toSupplier.id)).status === 409);
  check("a unit not on the log is 404", (await ret(99999999)).status === 404);

  // 2. Required fields, order, storage, PHI. On an issued unit.
  const U = await receive();
  const issued1 = await j(await issue(U.id));
  check("setup: issued", issued1.state === "issued" && issued1.delivered_to === "OR 4");
  const beforeAll = JSON.stringify(rowOf(U.id));
  const required: [string, Record<string, unknown>][] = [
    ["the date", { returned_date: "" }], ["the time", { returned_time: "" }], ["a real date", { returned_date: "11/09/2026" }], ["a real time", { returned_time: "25:00" }],
    ["who brought it back", { returned_by: " " }], ["who received it back", { received_back_by: "" }],
    ["the storage check answered", { storage_ok: "" }], ["the package check answered", { package_ok_on_return: "maybe" }],
    ["where it goes back", { storage_unit_id: "", storage_location: "" }],
  ];
  for (const [what, over] of required) {
    const r = await ret(U.id, over);
    check(`a return needs ${what} (400)`, r.status === 400, `${r.status} ${JSON.stringify(await j(r)).slice(0, 160)}`);
  }
  check("a return dated tomorrow is refused (400)", (await ret(U.id, { returned_date: shift(1) })).status === 400);
  const early = await ret(U.id, { returned_time: "07:59" });
  check("a return earlier than the issue is refused (400)", early.status === 400 && /earlier than the issue/.test((await j(early)).error));
  check("a return on a day before the issue is refused (400)", (await ret(U.id, { returned_date: shift(-3) })).status === 400);
  check("another lab's storage unit is refused (400)", (await ret(U.id, { storage_unit_id: tuB })).status === 400);
  const phi: [string, Record<string, unknown>][] = [
    ["returned by", { returned_by: "MRN: 1234567" }], ["received back by", { received_back_by: "patient: Pat Example" }],
    ["note", { note: "DOB 01/02/1950" }], ["location", { storage_location: "pt name: Pat Example" }],
  ];
  for (const [what, over] of phi) {
    const r = await ret(U.id, over);
    const d = await j(r);
    check(`PHI refused with the reason: ${what}`, r.status === 400 && d.code === "PHI_REFUSED" && /patient information/.test(d.error), `${r.status} ${JSON.stringify(d).slice(0, 160)}`);
  }
  check("after every refusal the row is exactly as it was, and no return was written", JSON.stringify(rowOf(U.id)) === beforeAll && eventsOf(U.id, "returned_unused").length === 0);

  // 3. A no on either check.
  for (const [what, over] of [["storage conditions", { storage_ok: "no" }], ["package integrity", { package_ok_on_return: "no" }], ["both", { storage_ok: "no", package_ok_on_return: "no" }]] as const) {
    const r = await ret(U.id, over);
    const d = await j(r);
    check(`a no on ${what} refuses it, pointing to Other disposition (400)`, r.status === 400 && d.code === "RETURN_NOT_ACCEPTABLE" && /Other disposition/.test(d.error) && /can't go back into storage/.test(d.error), JSON.stringify(d));
  }
  check("a no leaves the unit issued, its issue on the row, and writes nothing", JSON.stringify(rowOf(U.id)) === beforeAll && rowOf(U.id).state === "issued" && eventsOf(U.id, "returned_unused").length === 0);
  const noUnit = await receive();
  await issue(noUnit.id);
  await ret(noUnit.id, { package_ok_on_return: "no" });
  const wastedNo = await j(await dispose(noUnit.id, "wasted", { disposition_description: "Package opened in the OR, discarded" }));
  check("the unit that couldn't go back closes through Other disposition", wastedNo.state === "wasted");

  // 4. Success.
  const receiptBefore = pick(rowOf(U.id), RECEIPT_FIELDS);
  const issueBefore = pick(rowOf(U.id), ISSUE_FIELDS);
  const auditBefore = Number((sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'tissue_unit' AND entity_id = ?").get(String(U.id)) as any).n);
  const okRes = await ret(U.id);
  const ok = await j(okRes);
  check("returned unused: 200, back in blood bank storage", okRes.status === 200 && ok.state === "stored" && ok.state_label === "In blood bank storage", JSON.stringify(ok).slice(0, 200));
  check("the issue fields are off the row", ISSUE_FIELDS.every((f) => ok[f] === null), JSON.stringify(pick(ok, ISSUE_FIELDS)));
  check("the receipt fields are untouched", same(pick(rowOf(U.id), RECEIPT_FIELDS), receiptBefore));
  check("the storage is where it went back", ok.storage_unit_id === tuA2 && ok.storage_location === "Freezer B shelf 1");
  check("it shows as open, not past expiration", ok.flags?.open === true && ok.flags?.expired_on_shelf === false);
  const evs = eventsOf(U.id, "returned_unused");
  const ev = evs[0];
  const det = JSON.parse(ev?.detail_json || "{}");
  check("one returned_unused event, with its date, time, who and checks", evs.length === 1 && ev.event_date === shift(-2) && ev.event_time === "12:00" && ev.performed_by === "R. Tech" && same(JSON.parse(ev.checks_json), { storage_ok: 1, package_ok_on_return: 1 }));
  check("the event holds the issue it came back from, every field", same(det.cleared_issue, issueBefore) && det.cleared_issue.requesting_physician === "Dr. Made Up" && det.cleared_issue.readback_integrity_ok === 1, JSON.stringify(det.cleared_issue));
  check("the event holds every return field", det.returned_date === shift(-2) && det.returned_time === "12:00" && det.returned_by === "C. Courier" && det.received_back_by === "R. Tech" && det.storage_ok === 1 && det.package_ok_on_return === 1 && det.storage_unit_id === tuA2 && det.storage_location === "Freezer B shelf 1" && det.note === "Case cancelled, graft unopened", JSON.stringify(det));
  check("the event holds the storage it had before", same(det.storage_before, { storage_unit_id: tuA, storage_location: "Freezer A shelf 2" }));
  check("an audit row is written", Number((sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'tissue_unit' AND entity_id = ?").get(String(U.id)) as any).n) === auditBefore + 1 && !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'tissue_unit' AND entity_id = ? AND entity_label LIKE 'Tissue returned unused to blood bank%'").get(String(U.id)));
  check("the record's history carries it", (await get(U.id)).events.some((e: any) => e.event_type === "returned_unused"));
  check("a correction can no longer reach the issue fields", !(await get(U.id)).correctable_fields.includes("issued_date"));
  check("it can't be returned twice (409)", (await ret(U.id, { returned_time: "12:30" })).status === 409);
  const lateBb = await post(`/units/${U.id}/correct`, { reason: "x", changes: { received_bb_date: shift(-2), received_bb_time: "13:00" } });
  check("a correction can't put the blood bank receipt after the return (400)", lateBb.status === 400 && /before the one it follows/.test((await j(lateBb)).error));

  // 5. Issued again.
  const tooEarly = await issue(U.id, { issued_date: shift(-2), issued_time: "11:59" });
  check("a second issue earlier than the return is refused (400)", tooEarly.status === 400 && /return to blood bank/.test((await j(tooEarly)).error));
  const second = { issued_date: shift(-1), issued_time: "09:00", requesting_physician: "Dr. Second", issued_to: "D. Courier", issued_by_tech: "S. Tech", delivered_to: "OR 7" };
  const again = await issue(U.id, second);
  const dAgain = await j(again);
  check("issued again through the issue route", again.status === 200 && dAgain.state === "issued", JSON.stringify(dAgain).slice(0, 200));
  check("the second issue writes its own fields", same(pick(dAgain, ISSUE_FIELDS), { ...second, readback_id_ok: 1, readback_expiration_ok: 1, readback_integrity_ok: 1 }));
  check("the receipt is still untouched", same(pick(rowOf(U.id), RECEIPT_FIELDS), receiptBefore));
  check("two issue events in the history", eventsOf(U.id, "issued").length === 2);

  // 6. Undo. (A Staff seat's undo is checked in section 10.)
  check("undo needs a reason", (await undo(U.id, undefined)).status === 400);
  const u1 = await j(await undo(U.id, "Second issue entered by mistake"));
  check("undo 1, the second issue: back in storage where the return put it", u1.state === "stored" && u1.issued_date === null && u1.storage_unit_id === tuA2 && u1.storage_location === "Freezer B shelf 1");
  const u2 = await j(await undo(U.id, "The return was recorded on the wrong unit"));
  check("undo 2, the return: issued again, with the first issue's fields", u2.state === "issued" && same(pick(u2, ISSUE_FIELDS), issueBefore), JSON.stringify(pick(u2, ISSUE_FIELDS)));
  check("undo 2 puts the storage back where it was before the return", u2.storage_unit_id === tuA && u2.storage_location === "Freezer A shelf 2");
  check("undo 2 keeps the blood bank receipt (no receipt cleared)", same(pick(rowOf(U.id), RECEIPT_FIELDS), receiptBefore) && rowOf(U.id).received_bb_date === shift(-5));
  const undoEv = eventsOf(U.id, "undone").at(-1);
  const undoDet = JSON.parse(undoEv?.detail_json || "{}");
  check("the undo names the return it took back and what it restored", undoDet.undid === "returned_unused" && undoDet.undid_event_id === ev.id && undoDet.from_state === "stored" && undoDet.to_state === "issued" && undoDet.restored?.requesting_physician === "Dr. Made Up" && undoDet.reason === "The return was recorded on the wrong unit");
  const u3 = await j(await undo(U.id, "The first issue was a mistake too"));
  check("undo 3 is the issue as before: back in storage, issue cleared, no second restore", u3.state === "stored" && ISSUE_FIELDS.every((f) => u3[f] === null) && u3.received_bb_date === shift(-5));
  check("undo 3 cleared the first issue into its own event", JSON.parse(eventsOf(U.id, "undone").at(-1).detail_json).cleared?.requesting_physician === "Dr. Made Up" && JSON.parse(eventsOf(U.id, "undone").at(-1).detail_json).undid === undefined);
  const u4 = await j(await undo(U.id, "Blood bank receipt on the wrong unit"));
  check("undo 4 is the blood bank receipt as before: back to Materials Management", u4.state === "received_mm" && u4.received_bb_date === null && u4.storage_unit_id === null);
  check("undo 5: nothing left to undo (409)", (await j(await undo(U.id, "x"))).code === "NOTHING_TO_UNDO");
  check("the history kept every step", eventsOf(U.id, "returned_unused").length === 1 && eventsOf(U.id, "issued").length === 2 && eventsOf(U.id, "undone").length === 4);

  // Through a disposition after the return.
  const W = await receive();
  await issue(W.id);
  await ret(W.id);
  const wEarly = await dispose(W.id, "wasted", { disposition_date: shift(-2), disposition_time: "11:00" });
  check("a disposition earlier than the return is refused (400)", wEarly.status === 400);
  const wWaste = await j(await dispose(W.id, "wasted"));
  check("a returned unit can still be wasted from storage", wWaste.state === "wasted");
  const wU1 = await j(await undo(W.id, "Not wasted"));
  check("undo the disposition: back in storage", wU1.state === "stored" && wU1.disposition_date === null);
  const wU2 = await j(await undo(W.id, "Not returned"));
  check("then undo the return: issued again with its issue", wU2.state === "issued" && wU2.requesting_physician === "Dr. Made Up" && wU2.delivered_to === "OR 4");

  // Two returns.
  const M = await receive();
  await issue(M.id);
  await ret(M.id);
  await issue(M.id, second);
  const m2 = await j(await ret(M.id, { returned_date: shift(-1), returned_time: "12:00", storage_location: "Freezer B shelf 3" }));
  check("a unit can be returned a second time", m2.state === "stored" && eventsOf(M.id, "returned_unused").length === 2 && m2.storage_location === "Freezer B shelf 3");
  const mU1 = await j(await undo(M.id, "x"));
  check("undo the second return: the second issue comes back", mU1.state === "issued" && mU1.requesting_physician === "Dr. Second" && mU1.storage_location === "Freezer B shelf 1");
  const mU2 = await j(await undo(M.id, "x"));
  check("undo the second issue: in storage from the first return", mU2.state === "stored" && mU2.issued_date === null);
  const mU3 = await j(await undo(M.id, "x"));
  check("undo the first return: the first issue comes back", mU3.state === "issued" && mU3.requesting_physician === "Dr. Made Up" && mU3.storage_location === "Freezer A shelf 2");

  // 7. Expired.
  const E = await receive({ expiration_date: shift(-1) });
  const eIssue = await j(await issue(E.id, { issued_date: shift(-2) }));
  check("setup: issued before it expired (a paper record entered later)", eIssue.state === "issued");
  const eRet = await ret(E.id, { returned_date: today, returned_time: "00:05" });
  const dERet = await j(eRet);
  check("an expired unit can be returned: it's a fact", eRet.status === 200 && dERet.state === "stored" && dERet.flags.expired_on_shelf === true, JSON.stringify(dERet).slice(0, 200));
  const eAgain = await issue(E.id, { issued_date: today, issued_time: "00:10" });
  const dEAgain = await j(eAgain);
  check("and it can't be issued again, with the reason", eAgain.status === 409 && dEAgain.code === "ISSUE_REFUSED" && /expired on/.test(dEAgain.error), JSON.stringify(dEAgain));
  check("it closes as expired", (await j(await dispose(E.id, "expired"))).state === "expired");

  // 8. Returned to supplier.
  const supplier = await get(toSupplier.id);
  check("the terminal returned reads Returned to supplier, stored as returned", supplier.state === "returned" && supplier.state_label === "Returned to supplier");
  const listed = (await j(await call("GET", `${T}/units?filter=all`, undefined, OA.token))).rows.find((u: any) => u.id === toSupplier.id);
  check("the log reads Returned to supplier too", listed?.state_label === "Returned to supplier");
  const badKind = await j(await dispose(stored.id, "returned_unused"));
  check("a disposition kind is still wasted, returned or expired, and says so", /wasted, returned to supplier or expired/.test(badKind.error || ""), JSON.stringify(badKind));

  // 9. The log still builds, and names a return still standing.
  const X = await receive();
  await issue(X.id);
  await ret(X.id);
  const Y = await receive();
  await issue(Y.id);
  await ret(Y.id);
  await issue(Y.id, second);
  await ret(Y.id, { returned_date: shift(-1), returned_time: "12:00" });
  const xl = await j(await post("/log/xlsx", { filter: "all" }));
  const pdf = await j(await post("/log/pdf", { filter: "all" }));
  check("workbook and PDF build", !!xl.token && !!pdf.token && xl.unit_count === pdf.unit_count && xl.unit_count > 0, JSON.stringify({ xl, pdf }));
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await (await fetch(`${base}/api/pdf/${xl.token}`)).arrayBuffer()) as any);
  const sheet = wb.getWorksheet("Perpetual Log")!;
  const heads = ((sheet.getRow(1).values as any[]) || []).filter(Boolean).map(String);
  const col = (h: string) => heads.indexOf(h) + 1;
  const rowFor = (sourceId: string) => { for (let r = 2; r <= sheet.rowCount; r++) if (String(sheet.getRow(r).getCell(1).value) === sourceId) return sheet.getRow(r); return null; };
  check("workbook: a Returned unused to blood bank column", col("Returned unused to blood bank") > 0, heads.join("|"));
  const xText = String(rowFor(X.source_id)?.getCell(col("Returned unused to blood bank")).value ?? "");
  check("workbook: the returned unit names its return, the issue it came back from and both checks", xText.includes(`${shift(-2)} 12:00`) && /issued .* 08:00 to OR 4/.test(xText) && /brought back by C\. Courier, received by R\. Tech/.test(xText) && /Storage conditions maintained: Yes\. Package integrity acceptable: Yes\./.test(xText), xText);
  check("workbook: a return that was undone isn't named", !String(rowFor(W.source_id)?.getCell(col("Returned unused to blood bank")).value ?? ""));
  const yLines = String(rowFor(Y.source_id)?.getCell(col("Returned unused to blood bank")).value ?? "").split("\n");
  check("workbook: two returns standing are both named, oldest first", yLines.length === 2 && /to OR 4/.test(yLines[0]) && /to OR 7/.test(yLines[1]), yLines.join(" || "));
  check("workbook: a unit whose returns were all undone names none", !String(rowFor(M.source_id)?.getCell(col("Returned unused to blood bank")).value ?? ""));
  check("workbook: the returned unit's Issued columns are empty", !rowFor(X.source_id)?.getCell(col("Issued: date")).value && String(rowFor(X.source_id)?.getCell(col("Status")).value) === "In blood bank storage");
  check("workbook: Returned to supplier in Status and Other disposition", String(rowFor(toSupplier.source_id)?.getCell(col("Status")).value) === "Returned to supplier" && String(rowFor(toSupplier.source_id)?.getCell(col("Other disposition")).value) === "Returned to supplier");
  check("workbook: the About sheet names Returned to supplier and the new column", /Returned to supplier/.test(JSON.stringify(wb.getWorksheet("About")!.getSheetValues())) && /Returned unused to blood bank column/.test(JSON.stringify(wb.getWorksheet("About")!.getSheetValues())));
  const EM_DASH = String.fromCharCode(0x2014);
  const flat = wb.worksheets.flatMap((ws) => { const out: string[] = []; ws.eachRow((r) => r.eachCell((c) => out.push(String(c.value ?? "")))); return out; }).join(" ");
  check("workbook: no em dash, no literal null or undefined", !flat.includes(EM_DASH) && !/\bnull\b|\bundefined\b/.test(flat));
  const pdfBytes = Buffer.from(await (await fetch(`${base}/api/pdf/${pdf.token}`)).arrayBuffer());
  check("PDF: a real PDF", pdfBytes.slice(0, 5).toString() === "%PDF-" && pdfBytes.length > 2000);
  const { buildTissueLogHTML } = await import("../../server/tissueLogExport");
  const { returnsUnusedByUnit } = await import("../../server/tissue");
  const returns = returnsUnusedByUnit(sqlite, labA);
  check("returnsUnusedByUnit: one for X, two for Y, none where every return was undone (U, W, M)", returns.get(X.id)?.length === 1 && returns.get(Y.id)?.length === 2 && !returns.has(W.id) && !returns.has(U.id) && !returns.has(M.id));
  const all = (await j(await call("GET", `${T}/units?filter=all`, undefined, OA.token))).rows.map((u: any) => (returns.has(u.id) ? { ...u, returns_unused: returns.get(u.id) } : u));
  const html = buildTissueLogHTML(all, { labName: "Return Main", cliaNumber: null, today, filter: "all" });
  check("PDF: the returned unit's Issue cell names the return", /Returned unused<\/span> [^<]*brought back by C\. Courier/.test(html) && !html.includes(EM_DASH));

  // 10. Lab scope.
  const S = await receive();
  await issue(S.id);
  const bOwner = await call("POST", `${T}/units/${S.id}/return-unused`, retBody(), OB.token);
  check("another owner can't return this lab's unit (403)", bOwner.status === 403);
  check("through their own lab's path it isn't there (404)", (await call("POST", `/api/labs/${labB}/veritastock/tissue/units/${S.id}/return-unused`, retBody(), OB.token)).status === 404);
  check("through a sister lab's path it isn't there (404)", (await call("POST", `/api/labs/${labA2}/veritastock/tissue/units/${S.id}/return-unused`, retBody(), OA.token)).status === 404);
  check("still issued after all three", rowOf(S.id).state === "issued");
  const seatEmail = `tissue-ret-seat-${stamp}@example.com`;
  const seat = await j(await call("POST", "/api/auth/register", { email: seatEmail, password: "Testpass123", name: "Made Up Staff", hipaa_acknowledged: true }));
  sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status) VALUES (?, ?, 'staff', 'active')").run(labA, seat.user.id);
  sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_user_id, seat_email, lab_id, seat_type, status, permissions, invite_token) VALUES (?, ?, ?, ?, 'staff_portal', 'active', '{}', ?)")
    .run(OA.id, seat.user.id, seatEmail, labA, `tok-ret-${stamp}`);
  const bySeat = await ret(S.id, {}, seat.token);
  check("a Staff seat in the lab records a return (record work)", bySeat.status === 200 && (await j(bySeat)).state === "stored");
  check("a Staff seat can't undo it (403)", (await undo(S.id, "x", seat.token)).status === 403 && rowOf(S.id).state === "stored");
  check("a Staff seat can't return through the sister lab (403)", (await call("POST", `/api/labs/${labA2}/veritastock/tissue/units/${S.id}/return-unused`, retBody(), seat.token)).status === 403);
  process.env.VITE_STOCK_DEPLOYMENT = "true";
  check("veritastock.com: the route answers 404", (await ret(S.id)).status === 404);
  delete process.env.VITE_STOCK_DEPLOYMENT;

  server.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
