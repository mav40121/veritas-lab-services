// tests/integration/stock-recalls.test.ts
//
// Receipt for the VeritaStock recall tracker (2026-10-08). Boots the real
// routes on a scratch DB and proves:
//   1. intake: a case opened on a Friday is due Monday; lot numbers parsed
//   2. lot match spans the owner's locations (lot rows AND single-lot items),
//      flags vendor mismatches, never shows another owner's stock; another
//      owner's token is refused
//   3. notification list: add, duplicate 409, bad email 400
//   4. intake notice: goes to the list + assigned manager with the notice file
//      attached under the manufacturer-first name; recorded only after sending
//   5. pulling stock removes THAT lot (not oldest-first), clamps to what is on
//      hand, logs a "recalled" write-off; a lot not on the recall is refused
//   6. closeout gating: notice, sign-off and close are refused until the
//      checklist allows them; editing a closeout field clears the sign-off;
//      closed cases are read-only and cannot be deleted
//   7. a mistaken case with no stock pulled can be deleted
//   8. overdue reminders: first day overdue, then every 3 days
//   9. plan gate: a lab without a suite plan is refused
//
// Run (Windows, from bash): DB_PATH=.tmp-recalls.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/stock-recalls.test.ts
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
  const { setRecallMailerForTests, runRecallReminders } = await import("../../server/stockRecalls");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = (method: string, p: string, body?: unknown, token?: string) =>
    fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };
  const stamp = Date.now();
  const mkOwner = async (tag: string) => {
    const email = `rc-${tag}-${stamp}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: `RC ${tag}`, hipaa_acknowledged: true }));
    return { email, token: reg.token as string };
  };
  const mkLab = async (ownerEmail: string, name: string) => {
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: name, plan: "hospital", isWarehouse: true }));
    return prov.labId as number;
  };
  const OA = await mkOwner("A");
  const OB = await mkOwner("B");
  const labA = await mkLab(OA.email, "RC Main");
  const labA2 = await mkLab(OA.email, "RC Annex");
  const labB = await mkLab(OB.email, "RC Other Owner");
  const ownerA = (sqlite.prepare("SELECT owner_user_id o FROM labs WHERE id = ?").get(labA) as any)?.o;
  check("labs provisioned (A main + annex, B)", !!labA && !!labA2 && !!labB && labA !== labA2 && !!ownerA, JSON.stringify({ labA, labA2, labB, ownerA }));
  const R = `/api/labs/${labA}/veritastock/recalls`;

  // Stock. A main: one item with two lots. A annex: single-lot item (no lot rows).
  // B: same lot number under another owner.
  const now = new Date().toISOString();
  const insItem = (labId: number, name: string, vendor: string, lot: string | null, onHand: number) =>
    Number(sqlite.prepare("INSERT INTO inventory_items (account_id, lab_id, item_name, vendor, lot_number, quantity_on_hand, unit, usage_unit, unit_cost, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'kit', 'kit', 10, 'active', ?, ?)")
      .run(ownerA, labId, name, vendor, lot, onHand, now, now).lastInsertRowid);
  const itemA1 = insItem(labA, "hsTnI Reagent", "Beckman Coulter", "AB-1234", 8);
  const lotHit = Number(sqlite.prepare("INSERT INTO inventory_lots (item_id, lab_id, account_id, lot_number, expiration_date, quantity, created_at, updated_at) VALUES (?, ?, ?, 'AB-1234', '2027-06-30', 5, ?, ?)").run(itemA1, labA, ownerA, now, now).lastInsertRowid);
  const lotOld = Number(sqlite.prepare("INSERT INTO inventory_lots (item_id, lab_id, account_id, lot_number, expiration_date, quantity, created_at, updated_at) VALUES (?, ?, ?, 'ZZ999', '2026-12-31', 3, ?, ?)").run(itemA1, labA, ownerA, now, now).lastInsertRowid);
  const itemA2 = insItem(labA2, "Generic Calibrator", "Other Co", "ab 1234", 4);
  const ownerB = (sqlite.prepare("SELECT owner_user_id o FROM labs WHERE id = ?").get(labB) as any)?.o;
  const itemB = Number(sqlite.prepare("INSERT INTO inventory_items (account_id, lab_id, item_name, vendor, lot_number, quantity_on_hand, unit, unit_cost, status, created_at, updated_at) VALUES (?, ?, 'B item', 'Beckman Coulter', 'AB-1234', 7, 'kit', 10, 'active', ?, ?)").run(ownerB, labB, now, now).lastInsertRowid);

  // 1. intake on a Friday
  const created = await call("POST", R, { notice_type: "recall", notice_date: "2026-10-06", vendor: "Beckman Coulter", product: "Access hsTnI Reagent", recall_number: "FA-2026/014", lot_numbers: "AB-1234\nab-1234", details: "Falsely elevated results", assigned_user_id: ownerA, local_date: "2026-10-09" }, OA.token);
  const c1 = await j(created);
  check("case created (200)", created.status === 200 && c1.id > 0, `status=${created.status} ${JSON.stringify(c1).slice(0, 200)}`);
  check("opened Friday 10/09 -> due Monday 10/12", c1.opened_on === "2026-10-09" && c1.due_date === "2026-10-12", `${c1.opened_on} -> ${c1.due_date}`);
  check("duplicate lot numbers collapsed", JSON.stringify(c1.lot_numbers) === JSON.stringify(["AB-1234"]), JSON.stringify(c1.lot_numbers));
  check("assigned manager resolved", !!c1.assigned_name && !!c1.assigned_email, `${c1.assigned_name} <${c1.assigned_email}>`);
  const bad = await call("POST", R, { vendor: "", product: "x" }, OA.token);
  check("vendor required (400)", bad.status === 400);
  const badType = await call("POST", R, { vendor: "v", product: "p", notice_type: "urgent" }, OA.token);
  check("unknown notice type refused (400)", badType.status === 400);

  // 2. lot match
  const g1 = await j(await call("GET", `${R}/${c1.id}`, undefined, OA.token));
  const m = g1.matches || [];
  const mA1 = m.find((x: any) => x.item_id === itemA1);
  const mA2 = m.find((x: any) => x.item_id === itemA2);
  check("match: main location lot row, vendor matches", !!mA1 && mA1.source === "lot" && mA1.lot_id === lotHit && mA1.quantity === 5 && mA1.vendor_matches === true, JSON.stringify(mA1));
  check("match: annex single-lot item (\"ab 1234\"), vendor flagged", !!mA2 && mA2.source === "item" && mA2.quantity === 4 && mA2.vendor_matches === false && mA2.lab_name === "RC Annex", JSON.stringify(mA2));
  check("no match on the other lot (ZZ999) or on another owner's stock", !m.some((x: any) => x.lot_id === lotOld || x.item_id === itemB) && m.length === 2, `matches=${m.length}`);
  const foreign = await call("GET", `${R}/${c1.id}`, undefined, OB.token);
  check("another owner's token is refused (403)", foreign.status === 403, `status=${foreign.status}`);

  // 3. notification list
  const r1 = await call("POST", `${R}/recipients`, { name: "Dr. Example", email: "reviewer@example.com", role: "Reviewer" }, OA.token);
  const dup = await call("POST", `${R}/recipients`, { email: "REVIEWER@example.com" }, OA.token);
  const badEmail = await call("POST", `${R}/recipients`, { email: "not-an-email" }, OA.token);
  check("recipient added / duplicate 409 / bad email 400", r1.status === 200 && dup.status === 409 && badEmail.status === 400, `${r1.status} ${dup.status} ${badEmail.status}`);

  // 4. intake notice
  const sent: any[] = [];
  setRecallMailerForTests(async (msg) => { sent.push(msg); });
  const fd = new FormData();
  fd.append("kind", "notice");
  fd.append("file", new Blob([Buffer.from("%PDF-1.4 fake notice")], { type: "application/pdf" }), "scan0001.PDF");
  const up = await fetch(`${base}${R}/${c1.id}/documents`, { method: "POST", headers: { Authorization: `Bearer ${OA.token}` }, body: fd });
  const upJ = await j(up);
  check("notice uploaded, manufacturer-first download name", up.status === 201 && upJ.download_name === "Beckman-Coulter_Access-hsTnI-Reagent_FA-2026-014_2026-10-06.pdf", `${up.status} ${upJ.download_name}`);
  const dl = await fetch(`${base}${R}/${c1.id}/documents/${upJ.id}`, { headers: { Authorization: `Bearer ${OA.token}` } });
  check("download serves the stored bytes with that name", dl.status === 200 && (dl.headers.get("content-disposition") || "").includes("Beckman-Coulter_Access") && (await dl.text()).startsWith("%PDF"), dl.headers.get("content-disposition") || "");
  const n1 = await call("POST", `${R}/${c1.id}/notify`, { stage: "intake" }, OA.token);
  const n1j = await j(n1);
  const msg = sent[0];
  check("intake notice sent to list + assigned manager", n1.status === 200 && msg && msg.to.includes("reviewer@example.com") && msg.to.includes(String(c1.assigned_email).toLowerCase()), `${n1.status} to=${JSON.stringify(msg?.to)}`);
  check("intake notice attaches the vendor notice", msg?.attachments?.length === 1 && msg.attachments[0].filename.startsWith("Beckman-Coulter_"), JSON.stringify(msg?.attachments?.map((a: any) => a.filename)));
  check("intake notice lists the stock found and flags the vendor mismatch", /hsTnI Reagent, lot AB-1234: 5 kit at RC Main/.test(msg?.text || "") && /Generic Calibrator.*\[check vendor\]/.test(msg?.text || ""), (msg?.text || "").split("\n").filter((l: string) => l.startsWith("- ")).join(" | "));
  check("intake notice carries no lab wording", !/\blab(oratory)?\b/i.test(`${msg?.subject} ${msg?.text}`.replace(/RC Main|RC Annex/g, "")), msg?.subject);
  check("intake_notified_at recorded", !!n1j.case?.intake_notified_at);
  setRecallMailerForTests(async () => { throw new Error("smtp down"); });
  const nFail = await call("POST", `${R}/${c1.id}/notify`, { stage: "intake" }, OA.token);
  check("a failed send returns 502 and records nothing new", nFail.status === 502 && (sqlite.prepare("SELECT COUNT(*) n FROM stock_recall_events WHERE recall_id = ? AND action = 'intake_notice_sent'").get(c1.id) as any).n === 1, `status=${nFail.status}`);
  setRecallMailerForTests(async (m2) => { sent.push(m2); });

  // 5. pull stock by lot
  const rm1 = await j(await call("POST", `${R}/${c1.id}/remove-stock`, { item_id: itemA1, lot_id: lotHit, qty: 2, note: "pulled from shelf" }, OA.token));
  const lotsA1 = sqlite.prepare("SELECT lot_number, quantity FROM inventory_lots WHERE item_id = ? ORDER BY lot_number").all(itemA1) as any[];
  const a1 = sqlite.prepare("SELECT quantity_on_hand q FROM inventory_items WHERE id = ?").get(itemA1) as any;
  check("removed 2 from lot AB-1234 (not the older ZZ999 lot)", rm1.ok && JSON.stringify(lotsA1) === JSON.stringify([{ lot_number: "AB-1234", quantity: 3 }, { lot_number: "ZZ999", quantity: 3 }]) && a1.q === 6, JSON.stringify({ lotsA1, onHand: a1.q }));
  const waste = sqlite.prepare("SELECT reason_code, qty, waste_value, note FROM inventory_waste_events WHERE item_id = ?").get(itemA1) as any;
  check("write-off logged as recalled with the lot and case", waste?.reason_code === "recalled" && waste.qty === 2 && waste.waste_value === 20 && /Lot AB-1234/.test(waste.note), JSON.stringify(waste));
  const rm2 = await j(await call("POST", `${R}/${c1.id}/remove-stock`, { item_id: itemA2, qty: 10 }, OA.token));
  const a2 = sqlite.prepare("SELECT quantity_on_hand q FROM inventory_items WHERE id = ?").get(itemA2) as any;
  check("single-lot item at the annex: clamps to the 4 on hand", rm2.ok && rm2.removed?.qty === 4 && a2.q === 0, JSON.stringify(rm2));
  const wrongLot = await call("POST", `${R}/${c1.id}/remove-stock`, { item_id: itemA1, lot_id: lotOld, qty: 1 }, OA.token);
  check("a lot not on the recall is refused (400)", wrongLot.status === 400, `status=${wrongLot.status}`);
  const foreignItem = await call("POST", `${R}/${c1.id}/remove-stock`, { item_id: itemB, qty: 1 }, OA.token);
  check("another owner's item is refused (403)", foreignItem.status === 403, `status=${foreignItem.status}`);

  // 6. closeout gating
  const early = await Promise.all([
    call("POST", `${R}/${c1.id}/notify`, { stage: "closeout" }, OA.token),
    call("POST", `${R}/${c1.id}/signoff`, {}, OA.token),
    call("POST", `${R}/${c1.id}/close`, {}, OA.token),
  ]);
  check("closeout notice, sign-off and close refused while the checklist is open (400 x3)", early.every((r) => r.status === 400), early.map((r) => r.status).join(","));
  await call("PUT", `${R}/${c1.id}`, { affected_summary: "2 kits main, 4 annex", corrective_action: "Pulled all affected lots; reran 3 samples", vendor_response_sent_on: "2026-10-09" }, OA.token);
  const noPaper = await j(await call("GET", `${R}/${c1.id}`, undefined, OA.token));
  check("vendor paperwork still open until a response file is attached", noPaper.checklist.find((i: any) => i.key === "vendor_paperwork").done === false);
  const fd2 = new FormData();
  fd2.append("kind", "vendor_response");
  fd2.append("file", new Blob([Buffer.from("response form")], { type: "application/pdf" }), "response.pdf");
  await fetch(`${base}${R}/${c1.id}/documents`, { method: "POST", headers: { Authorization: `Bearer ${OA.token}` }, body: fd2 });
  const n2 = await call("POST", `${R}/${c1.id}/notify`, { stage: "closeout" }, OA.token);
  const closeMsg = sent[sent.length - 1];
  check("closeout notice sent with the action and stock removed", n2.status === 200 && /Pulled all affected lots/.test(closeMsg?.text || "") && /Generic Calibrator, lot ab 1234: 4 kit removed at RC Annex/.test(closeMsg?.text || ""), (closeMsg?.text || "").slice(0, 300));
  const s1 = await j(await call("POST", `${R}/${c1.id}/signoff`, {}, OA.token));
  check("assigned manager signs off", !!s1.signoff_at && s1.ready_to_close === true, `${s1.signoff_at}`);
  const ed = await j(await call("PUT", `${R}/${c1.id}`, { corrective_action: "Pulled all affected lots; reran 4 samples" }, OA.token));
  check("editing a closeout field clears the sign-off AND the closeout notice", ed.signoff_at === null && ed.closeout_notified_at === null && ed.ready_to_close === false);
  const reSignEarly = await call("POST", `${R}/${c1.id}/signoff`, {}, OA.token);
  check("sign-off refused until the corrected closeout notice goes out (400)", reSignEarly.status === 400, `status=${reSignEarly.status}`);
  await call("POST", `${R}/${c1.id}/notify`, { stage: "closeout" }, OA.token);
  check("resent closeout notice carries the corrected action", /reran 4 samples/.test(sent[sent.length - 1]?.text || ""));
  await call("POST", `${R}/${c1.id}/signoff`, {}, OA.token);
  const cl = await call("POST", `${R}/${c1.id}/close`, {}, OA.token);
  const clj = await j(cl);
  check("case closes once all six are done", cl.status === 200 && clj.status === "closed" && clj.checklist_done === 6, `${cl.status} ${clj.status}`);
  const afterClose = await Promise.all([
    call("PUT", `${R}/${c1.id}`, { details: "x" }, OA.token),
    call("DELETE", `${R}/${c1.id}`, undefined, OA.token),
  ]);
  check("closed case is read-only and cannot be deleted (409 x2)", afterClose.every((r) => r.status === 409), afterClose.map((r) => r.status).join(","));

  // 7. mistaken case
  const c2 = await j(await call("POST", R, { vendor: "Typo Vendor", product: "Wrong", local_date: "2026-10-08" }, OA.token));
  const del = await call("DELETE", `${R}/${c2.id}`, undefined, OA.token);
  check("a case with no stock pulled can be deleted", del.status === 200 && !sqlite.prepare("SELECT 1 FROM stock_recalls WHERE id = ?").get(c2.id));

  // 8. overdue reminders (UTC run dates passed in)
  const c3 = await j(await call("POST", R, { vendor: "Abbott", product: "Old notice", assigned_user_id: ownerA, due_date: "2026-10-01", local_date: "2026-10-01" }, OA.token));
  const before = sent.length;
  const run = async (d: string) => { await runRecallReminders(d); return sent.filter((x) => x.subject.startsWith("Overdue:") && x.subject.includes("Old notice")).length; };
  const onDue = await run("2026-10-01");
  const d1 = await run("2026-10-02");
  const d2 = await run("2026-10-03");
  const d4 = await run("2026-10-05");
  check("reminders: none on the due date, then day 1, quiet day 2, again day 4", onDue === 0 && d1 === 1 && d2 === 1 && d4 === 2, `${onDue} ${d1} ${d2} ${d4}`);
  check("reminder goes only to the assigned manager", sent.slice(before).every((x) => x.to.length === 1 && x.to[0] === String(c1.assigned_email)), JSON.stringify(sent.slice(before).map((x) => x.to)));
  void c3;

  // 9. plan gate
  sqlite.prepare("UPDATE labs SET plan = 'free' WHERE id = ?").run(labB);
  const gated = await call("GET", `/api/labs/${labB}/veritastock/recalls`, undefined, OB.token);
  check("lab without a suite plan is refused (403)", gated.status === 403, `status=${gated.status}`);

  setRecallMailerForTests(null);
  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
