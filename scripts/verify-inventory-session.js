#!/usr/bin/env node
// verify-inventory-session.js
//
// Receipt for Wave K3 (2026-06-07). Kiosk read + qty-adjust endpoints
// gated by inventoryAuthMiddleware. Every adjustment requires initials
// (2-4 alphanumeric) and writes an audit_log row with before/after qty.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<owner JWT for LAB_ID> \
//   LAB_ID=2 \
//   CLIA=<lab CLIA> \
//   node scripts/verify-inventory-session.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);
const CLIA = process.env.CLIA;

if (!TOKEN || !LAB_ID || !CLIA) {
  console.error("ERROR: TOKEN, LAB_ID, CLIA env vars required"); process.exit(2);
}

async function rotate() {
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/inventory-pin/regenerate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: "{}",
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function login(clia, pin) {
  const r = await fetch(`${BASE}/api/inventory-login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clia, pin }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function get(path, token) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function post(path, token, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  // Establish a kiosk JWT via the K2 login flow.
  const rot = await rotate();
  if (rot.status !== 200 || !rot.body?.pin) {
    console.error("FAIL setup: rotate failed status=" + rot.status); process.exit(1);
  }
  const auth = await login(CLIA, rot.body.pin);
  if (auth.status !== 200 || !auth.body?.token) {
    console.error("FAIL setup: kiosk login failed status=" + auth.status); process.exit(1);
  }
  const kioskJwt = auth.body.token;

  // Branch A: kiosk lists items in its lab
  const list = await get("/api/inventory-session/items", kioskJwt);
  check("A. items list returns 200", list.status === 200, `status=${list.status}`);
  check("A. payload has items array", Array.isArray(list.body?.items),
    `keys=${Object.keys(list.body || {}).join(",")}`);
  check("A. payload reports lab_id", list.body?.lab_id === LAB_ID, `lab_id=${list.body?.lab_id}`);
  check("A. payload reports total matching items.length",
    list.body?.total === list.body?.items?.length);

  if (!list.body?.items?.length) {
    console.log("SKIP B-G. No inventory items in lab " + LAB_ID + " to exercise adjust on.");
    console.log("");
    console.log(`Summary: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }

  // Branch A: item shape — no vendor/burn fields
  const sample = list.body.items[0];
  check("A. item shape: has quantity_on_hand", typeof sample.quantity_on_hand === "number",
    `qoh=${sample.quantity_on_hand}`);
  check("A. item shape: omits vendor", !("vendor" in sample),
    `keys=${Object.keys(sample).join(",")}`);
  check("A. item shape: omits burn_rate", !("burn_rate" in sample));
  check("A. item shape: omits lead_time_days", !("lead_time_days" in sample));

  const targetId = sample.id;
  const originalQty = sample.quantity_on_hand;

  // Branch B: user JWT cannot reach kiosk endpoints
  const userListAttempt = await get("/api/inventory-session/items", TOKEN);
  check("B. user JWT to kiosk items returns 401", userListAttempt.status === 401,
    `status=${userListAttempt.status} body=${JSON.stringify(userListAttempt.body).slice(0,200)}`);

  // Branch C: adjust requires valid initials
  const noInitials = await post(`/api/inventory-session/items/${targetId}/adjust`, kioskJwt, {
    new_quantity: originalQty,
  });
  check("C. adjust without initials returns 400", noInitials.status === 400,
    `status=${noInitials.status}`);
  const longInitials = await post(`/api/inventory-session/items/${targetId}/adjust`, kioskJwt, {
    new_quantity: originalQty, initials: "MICHAEL",
  });
  check("C. adjust with 7-char initials returns 400", longInitials.status === 400);
  const symbolInitials = await post(`/api/inventory-session/items/${targetId}/adjust`, kioskJwt, {
    new_quantity: originalQty, initials: "M!",
  });
  check("C. adjust with symbol-bearing initials returns 400", symbolInitials.status === 400);

  // Branch D: adjust requires valid quantity
  const negQty = await post(`/api/inventory-session/items/${targetId}/adjust`, kioskJwt, {
    new_quantity: -1, initials: "MV",
  });
  check("D. adjust with negative qty returns 400", negQty.status === 400);
  const floatQty = await post(`/api/inventory-session/items/${targetId}/adjust`, kioskJwt, {
    new_quantity: 3.5, initials: "MV",
  });
  check("D. adjust with float qty returns 400", floatQty.status === 400);

  // Branch E: happy path adjust — set to originalQty + 1, then back
  const newQty = (originalQty || 0) + 7;
  const adj = await post(`/api/inventory-session/items/${targetId}/adjust`, kioskJwt, {
    new_quantity: newQty, initials: "mv", reason: "verify script",
  });
  check("E. happy adjust returns 200", adj.status === 200, `status=${adj.status} body=${JSON.stringify(adj.body).slice(0,200)}`);
  check("E. response carries updated item", adj.body?.item?.id === targetId);
  check("E. updated quantity matches request", adj.body?.item?.quantity_on_hand === newQty,
    `qoh=${adj.body?.item?.quantity_on_hand}`);
  check("E. adjustment summary carries before_qty", adj.body?.adjustment?.before_qty === originalQty);
  check("E. adjustment summary carries after_qty", adj.body?.adjustment?.after_qty === newQty);
  check("E. adjustment summary carries delta", adj.body?.adjustment?.delta === newQty - originalQty);
  check("E. initials are normalized to uppercase",
    adj.body?.adjustment?.initials === "MV",
    `initials=${adj.body?.adjustment?.initials}`);

  // Restore so the verify is idempotent across re-runs
  const restore = await post(`/api/inventory-session/items/${targetId}/adjust`, kioskJwt, {
    new_quantity: originalQty, initials: "MV", reason: "verify script restore",
  });
  check("F. restore adjust returns 200", restore.status === 200);

  // Branch G: item from another lab returns 404 (we can't easily prove
  // this without a second lab's item id, so just test a giant id that
  // definitely doesn't belong to this lab)
  const foreign = await post(`/api/inventory-session/items/999999999/adjust`, kioskJwt, {
    new_quantity: 1, initials: "MV",
  });
  check("G. unknown item id returns 404", foreign.status === 404, `status=${foreign.status}`);

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
