// Receipt for parking-lot #29 Phase 2 scan endpoint logic.
//
// This verify script does NOT hit the live API. It spins up an
// in-memory better-sqlite3 database with the same inventory_items
// and scan_events shape Phase 0 created, then runs the exact
// SELECT-UPDATE-INSERT logic the scan handler uses against it.
// That gives us a deterministic receipt for the bits that branch:
//
//   1. decrement happy path: qty goes from N to N-1, scan_event row
//      records actualDelta=-1, before=N, after=N-1.
//   2. decrement clamp: qty=1 then qty=0 then qty=0 again. Third
//      scan logs actualDelta=0 because of the Math.max(0, ...) clamp.
//   3. increment: qty goes from N to N+1.
//   4. lookup_only: qty unchanged, scan_event still recorded with
//      action="lookup_only", actualDelta=0.
//   5. correction with signed delta (+5 and -3 cases).
//   6. unknown barcode: no inventory row matched. scan_events row
//      still inserted with action="unknown_barcode" and inventory_item_id
//      = NULL, so attempted-scan history survives.
//   7. account scoping: account A's barcode does NOT resolve when
//      scanned under account B's session. Cross-account hit must be a
//      miss + unknown_barcode log under B's account_id.
//
// Run:
//   node scripts/verify-barcode-scan.js
// Exits non-zero on any failure.

import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.pragma('journal_mode = WAL');

// Minimal schema mirror — only the columns the scan handler touches.
db.exec(`
  CREATE TABLE inventory_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    quantity_on_hand INTEGER DEFAULT 0,
    barcode_value TEXT,
    updated_at TEXT
  );
  CREATE TABLE scan_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    inventory_item_id INTEGER,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    quantity_delta INTEGER,
    quantity_before INTEGER,
    quantity_after INTEGER,
    barcode_value TEXT,
    notes TEXT,
    ip_address TEXT,
    user_agent TEXT,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed two accounts so we can prove account scoping. Same physical
// barcode value bound under both accounts to different items.
db.prepare("INSERT INTO inventory_items (account_id, item_name, quantity_on_hand, barcode_value) VALUES (?, ?, ?, ?)").run(1, 'A-Reagent', 10, 'BC-SHARED-001');
db.prepare("INSERT INTO inventory_items (account_id, item_name, quantity_on_hand, barcode_value) VALUES (?, ?, ?, ?)").run(2, 'B-Reagent', 99, 'BC-SHARED-001');
db.prepare("INSERT INTO inventory_items (account_id, item_name, quantity_on_hand, barcode_value) VALUES (?, ?, ?, ?)").run(1, 'A-Clamp',   1,  'BC-CLAMP');

// Direct port of the transaction body from server/veritabench.ts
// POST /api/inventory/scan handler. Keep this in sync if the handler
// ever changes shape.
function scan(accountId, userId, barcode, action, correctionDelta) {
  const txn = db.transaction(() => {
    const row = db.prepare(
      "SELECT * FROM inventory_items WHERE account_id = ? AND barcode_value IS NOT NULL AND barcode_value = ?"
    ).get(accountId, barcode);
    if (!row) {
      const ins = db.prepare(`
        INSERT INTO scan_events (account_id, inventory_item_id, user_id, action, quantity_delta, quantity_before, quantity_after, barcode_value, notes, ip_address, user_agent)
        VALUES (?, NULL, ?, 'unknown_barcode', NULL, NULL, NULL, ?, NULL, NULL, NULL)
      `).run(accountId, userId, barcode);
      return { hit: false, scanEventId: Number(ins.lastInsertRowid) };
    }
    const qtyBefore = Number(row.quantity_on_hand ?? 0);
    let delta = 0;
    if (action === 'decrement') delta = -1;
    else if (action === 'increment') delta = 1;
    else if (action === 'lookup_only') delta = 0;
    else if (action === 'correction') delta = Math.trunc(correctionDelta);
    const qtyAfter = Math.max(0, qtyBefore + delta);
    const actualDelta = qtyAfter - qtyBefore;
    if (action !== 'lookup_only' && actualDelta !== 0) {
      db.prepare(
        "UPDATE inventory_items SET quantity_on_hand = ?, updated_at = datetime('now') WHERE id = ? AND account_id = ?"
      ).run(qtyAfter, row.id, accountId);
    }
    const ins = db.prepare(`
      INSERT INTO scan_events (account_id, inventory_item_id, user_id, action, quantity_delta, quantity_before, quantity_after, barcode_value, notes, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
    `).run(accountId, row.id, userId, action, actualDelta, qtyBefore, qtyAfter, barcode);
    return { hit: true, scanEventId: Number(ins.lastInsertRowid), itemId: row.id, qtyBefore, qtyAfter, actualDelta };
  });
  return txn();
}

const cases = [];
function assert(name, ok, detail) {
  cases.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

// 1. Decrement happy path — A1, qty 10 -> 9
{
  const r = scan(1, 101, 'BC-SHARED-001', 'decrement', null);
  assert('decrement happy path returns hit', r.hit, `hit=${r.hit}`);
  assert('decrement qty before=10, after=9', r.qtyBefore === 10 && r.qtyAfter === 9, `before=${r.qtyBefore} after=${r.qtyAfter}`);
  assert('decrement actualDelta=-1', r.actualDelta === -1, `actualDelta=${r.actualDelta}`);
  const ev = db.prepare("SELECT * FROM scan_events WHERE id = ?").get(r.scanEventId);
  assert('scan_event row recorded', !!ev, '');
  assert('scan_event action=decrement', ev.action === 'decrement', `action=${ev.action}`);
  assert('scan_event delta=-1, before=10, after=9', ev.quantity_delta === -1 && ev.quantity_before === 10 && ev.quantity_after === 9, `${ev.quantity_delta}/${ev.quantity_before}/${ev.quantity_after}`);
}

// 2. Decrement clamp — A-Clamp qty=1 -> 0 -> 0 (third decrement no-ops)
{
  const r1 = scan(1, 101, 'BC-CLAMP', 'decrement', null);
  assert('clamp: first decrement 1->0', r1.qtyBefore === 1 && r1.qtyAfter === 0 && r1.actualDelta === -1, `${r1.qtyBefore}->${r1.qtyAfter}, delta=${r1.actualDelta}`);
  const r2 = scan(1, 101, 'BC-CLAMP', 'decrement', null);
  assert('clamp: second decrement 0->0', r2.qtyBefore === 0 && r2.qtyAfter === 0 && r2.actualDelta === 0, `${r2.qtyBefore}->${r2.qtyAfter}, delta=${r2.actualDelta}`);
  const ev2 = db.prepare("SELECT * FROM scan_events WHERE id = ?").get(r2.scanEventId);
  assert('clamp: stored actualDelta=0 on clamped scan', ev2.quantity_delta === 0, `stored=${ev2.quantity_delta}`);
}

// 3. Increment — A1 (was 9 after step 1), now 9 -> 10
{
  const r = scan(1, 101, 'BC-SHARED-001', 'increment', null);
  assert('increment 9->10', r.qtyBefore === 9 && r.qtyAfter === 10 && r.actualDelta === 1, `${r.qtyBefore}->${r.qtyAfter}, delta=${r.actualDelta}`);
}

// 4. lookup_only — A1 qty unchanged, scan_event still inserted
{
  const before = db.prepare("SELECT quantity_on_hand FROM inventory_items WHERE id = 1").get().quantity_on_hand;
  const r = scan(1, 101, 'BC-SHARED-001', 'lookup_only', null);
  const after = db.prepare("SELECT quantity_on_hand FROM inventory_items WHERE id = 1").get().quantity_on_hand;
  assert('lookup_only does not change qty', before === after, `${before}==${after}`);
  const ev = db.prepare("SELECT * FROM scan_events WHERE id = ?").get(r.scanEventId);
  assert('lookup_only scan_event recorded with action=lookup_only', ev && ev.action === 'lookup_only', `action=${ev?.action}`);
  assert('lookup_only actualDelta=0', ev && ev.quantity_delta === 0, `delta=${ev?.quantity_delta}`);
}

// 5. Correction +5 and -3
{
  const r1 = scan(1, 101, 'BC-SHARED-001', 'correction', 5);
  assert('correction +5: qty 10->15', r1.qtyBefore === 10 && r1.qtyAfter === 15 && r1.actualDelta === 5, `${r1.qtyBefore}->${r1.qtyAfter}, delta=${r1.actualDelta}`);
  const r2 = scan(1, 101, 'BC-SHARED-001', 'correction', -3);
  assert('correction -3: qty 15->12', r2.qtyBefore === 15 && r2.qtyAfter === 12 && r2.actualDelta === -3, `${r2.qtyBefore}->${r2.qtyAfter}, delta=${r2.actualDelta}`);
}

// 6. Unknown barcode — no row matched, but scan_events row inserted
{
  const r = scan(1, 101, 'BC-DOES-NOT-EXIST', 'decrement', null);
  assert('unknown barcode reports hit=false', r.hit === false, `hit=${r.hit}`);
  const ev = db.prepare("SELECT * FROM scan_events WHERE id = ?").get(r.scanEventId);
  assert('unknown barcode scan_event recorded', !!ev, '');
  assert('unknown barcode action=unknown_barcode', ev && ev.action === 'unknown_barcode', `action=${ev?.action}`);
  assert('unknown barcode inventory_item_id IS NULL', ev && ev.inventory_item_id === null, `item_id=${ev?.inventory_item_id}`);
  assert('unknown barcode value preserved on row', ev && ev.barcode_value === 'BC-DOES-NOT-EXIST', `bc=${ev?.barcode_value}`);
}

// 7. Account scoping — same barcode "BC-SHARED-001" exists in BOTH
//    accounts. Scanning under account 2 must hit account 2's item
//    (qty 99 -> 98), NOT account 1's item.
{
  const r = scan(2, 202, 'BC-SHARED-001', 'decrement', null);
  assert('account 2 scan hits account 2 item (qty 99)', r.qtyBefore === 99 && r.qtyAfter === 98, `before=${r.qtyBefore} after=${r.qtyAfter}`);
  const a1qty = db.prepare("SELECT quantity_on_hand FROM inventory_items WHERE account_id = 1 AND barcode_value = 'BC-SHARED-001'").get().quantity_on_hand;
  assert('account 1 item NOT affected by account 2 scan', a1qty === 12, `a1qty=${a1qty}`);
}

// 8. Cross-account miss — fabricated barcode that does NOT exist
//    in account 3 (no rows seeded). Must miss and log under account 3.
{
  const r = scan(3, 303, 'BC-SHARED-001', 'decrement', null);
  assert('account 3 with someone else\'s barcode reports miss', r.hit === false, `hit=${r.hit}`);
  const ev = db.prepare("SELECT * FROM scan_events WHERE id = ?").get(r.scanEventId);
  assert('account 3 miss logs under account 3', ev && ev.account_id === 3, `logged_account=${ev?.account_id}`);
}

const failed = cases.filter(c => !c.ok).length;
console.log(`\n${cases.length - failed}/${cases.length} cases PASS`);
if (failed > 0) {
  console.error(`${failed} case(s) FAILED`);
  process.exit(1);
}
process.exit(0);
