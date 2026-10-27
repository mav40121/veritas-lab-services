// tests/integration/inventory-adjust-switch.test.ts
//
// BUG-078 (Michael Q46 = 1, 2026-10-27): the VeritaStaff "Can adjust inventory" switch now does what it says for
// Staff Portal (read-and-sign) logins. Scratch DB, made-up people. This pins:
//   1. a Staff login linked to a roster row with the switch OFF is refused (403 INVENTORY_NOT_ALLOWED) on adjust,
//      receive, write-off, barcode scan (both routes) and lot use, and nothing changes; a barcode lookup still works
//   2. with the switch ON the same login can adjust
//   3. writers (editors/admins) and the owner are not affected
//   4. a Staff seat with no roster link (nothing to read) keeps today's behavior
// Run: npm run test:inventory-adjust-switch
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
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const stamp = Date.now();
  const now = new Date().toISOString();
  const call = async (method: string, path: string, body: unknown, token: string, labHeader?: number) => {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(labHeader ? { "X-Active-Lab-Id": String(labHeader) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };
  const register = async (tag: string) => {
    const email = `ias-${tag.toLowerCase()}-${stamp}@example.com`;
    const reg = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `IAS ${tag}`, hipaa_acknowledged: true }) })).json();
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    return { email, id, token: reg.token as string };
  };

  try {
    const OWNER = await register("Owner"), WRITER = await register("Writer"), STAFF = await register("Staff"), LOOSE = await register("Loose");
    const labId = Number((await (await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: OWNER.email, labName: "IAS Lab", plan: "hospital" }) })).json()).labId);
    const member = (userId: number) => sqlite.prepare(
      `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at)
       SELECT ?, ?, 'staff', '{}', 'active', 0, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ?)`
    ).run(labId, userId, now, now, now, labId, userId);
    const seat = (u: { id: number; email: string }, type: string, perms: string, staffEmployeeId: number | null) => sqlite.prepare(
      `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    ).run(OWNER.id, u.email, u.id, now, now, perms, `ias-${u.id}-${stamp}`, labId, type, staffEmployeeId);
    // The Staff login's roster row (switch defaults to off).
    await call("POST", `/api/labs/${labId}/staff/lab`, { labName: "IAS Lab", cliaNumber: "11D7654377", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token, labId);
    const created = await call("POST", `/api/labs/${labId}/staff/employees`, { lastName: "Counter", firstName: "Casey", highestComplexity: "M", performsTesting: true }, OWNER.token, labId);
    const rosterId = Number(created.j.id);
    if (!(rosterId > 0)) { console.log("FAIL  setup: roster row not created ::", created.s, JSON.stringify(created.j).slice(0, 300)); process.exit(1); }
    member(WRITER.id); seat(WRITER, "active", '{"mode":"edit_all"}', null);
    member(STAFF.id); seat(STAFF, "staff_portal", '{"mode":"view_all"}', rosterId);
    member(LOOSE.id); seat(LOOSE, "staff_portal", '{"mode":"view_all"}', null);
    const flag = () => Number((sqlite.prepare("SELECT can_adjust_inventory AS f FROM staff_employees WHERE id = ?").get(rosterId) as any).f);
    const item = Number(sqlite.prepare(
      `INSERT INTO inventory_items (account_id, lab_id, item_name, vendor, lot_number, quantity_on_hand, unit, usage_unit, unit_cost, status, barcode_value, created_at, updated_at)
       VALUES (?, ?, 'Made-up reagent kit', 'Made-up vendor', 'LOT-1', 10, 'kit', 'kit', 1, 'active', ?, ?, ?)`
    ).run(OWNER.id, labId, `IAS-${stamp}`, now, now).lastInsertRowid);
    const qty = () => Number((sqlite.prepare("SELECT quantity_on_hand AS q FROM inventory_items WHERE id = ?").get(item) as any).q);
    check("0. setup: lab, roster row with the switch off, Staff login linked to it, one item at 10",
      labId > 0 && rosterId > 0 && flag() === 0 && qty() === 10, JSON.stringify({ labId, rosterId, flag: flag(), qty: qty() }));

    // 1. switch off: every change refused, nothing changes; lookup still works
    const refused = (r: { s: number; j: any }) => r.s === 403 && r.j.code === "INVENTORY_NOT_ALLOWED";
    const adj = await call("POST", `/api/inventory/${item}/adjust`, { new_quantity: 7, reason: "count" }, STAFF.token, labId);
    const rec = await call("POST", `/api/inventory/${item}/receive`, { quantity: 2 }, STAFF.token, labId);
    const wo = await call("POST", `/api/inventory/${item}/write-off`, { quantity: 1, reason: "expired" }, STAFF.token, labId);
    const scanLab = await call("POST", `/api/labs/${labId}/inventory/scan`, { barcode_value: `IAS-${stamp}`, action: "decrement" }, STAFF.token, labId);
    const scanAny = await call("POST", `/api/inventory/scan`, { barcode_value: `IAS-${stamp}`, action: "decrement" }, STAFF.token, labId);
    const lotUse = await call("POST", `/api/labs/${labId}/veritastock/items/${item}/lot-use`, {}, STAFF.token, labId);
    check("1a. switch off: adjust, receive, write-off, both scans and lot use are refused with INVENTORY_NOT_ALLOWED",
      [adj, rec, wo, scanLab, scanAny, lotUse].every(refused),
      [adj, rec, wo, scanLab, scanAny, lotUse].map((r) => `${r.s}/${r.j.code || r.j.error || ""}`).join(" "));
    check("1b. the refusal tells the person what to ask for", /Can adjust inventory/.test(adj.j.error || ""), adj.j.error);
    check("1c. nothing changed (still 10)", qty() === 10, String(qty()));
    const look = await call("POST", `/api/labs/${labId}/inventory/scan`, { barcode_value: `IAS-${stamp}`, action: "lookup_only" }, STAFF.token, labId);
    check("1d. a barcode lookup still works", look.s === 200, `${look.s} ${look.j.error || ""}`);

    // 2. switch on: the same login can adjust
    sqlite.prepare("UPDATE staff_employees SET can_adjust_inventory = 1 WHERE id = ?").run(rosterId);
    const adj2 = await call("POST", `/api/inventory/${item}/adjust`, { new_quantity: 7, reason: "count" }, STAFF.token, labId);
    check("2. switch on: the Staff login adjusts (10 -> 7)", adj2.s === 200 && qty() === 7, `${adj2.s} ${adj2.j.error || ""} qty=${qty()}`);
    sqlite.prepare("UPDATE staff_employees SET can_adjust_inventory = 0 WHERE id = ?").run(rosterId);

    // 3. writer and owner unaffected
    const adjW = await call("POST", `/api/inventory/${item}/adjust`, { new_quantity: 6, reason: "count" }, WRITER.token, labId);
    const adjO = await call("POST", `/api/inventory/${item}/adjust`, { new_quantity: 5, reason: "count" }, OWNER.token, labId);
    check("3. writer and owner adjust regardless of any Staff switch", adjW.s === 200 && adjO.s === 200 && qty() === 5,
      `${adjW.s}/${adjO.s} qty=${qty()}`);

    // 4. unlinked Staff seat keeps today's behavior
    const adjL = await call("POST", `/api/inventory/${item}/adjust`, { new_quantity: 4, reason: "count" }, LOOSE.token, labId);
    check("4. a Staff seat with no roster link is not refused (no switch to read)", adjL.s !== 403, `${adjL.s} ${adjL.j.error || ""}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
