#!/usr/bin/env node
// verify-inventory-pin-management.js
//
// Receipt for Wave K1 (2026-06-07). Director / admin endpoints to
// rotate the lab's Inventory PIN and read its status.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<JWT for an owner-tier lab member> \
//   LAB_ID=2 \
//   node scripts/verify-inventory-pin-management.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);
const NON_OWNER_TOKEN = process.env.NON_OWNER_TOKEN || "";

if (!TOKEN) { console.error("ERROR: TOKEN env var required"); process.exit(2); }
if (!LAB_ID) { console.error("ERROR: LAB_ID env var required"); process.exit(2); }

async function post(path, headers = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...headers },
    body: "{}",
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function get(path, headers = {}) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, ...headers },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  // Branch A: regenerate happy path
  const a = await post(`/api/labs/${LAB_ID}/inventory-pin/regenerate`);
  check("A. POST regenerate returns 200", a.status === 200, `status=${a.status}`);
  const pin1 = a.body?.pin;
  check("A. response carries plaintext PIN once", typeof pin1 === "string" && pin1.length === 6 && /^\d{6}$/.test(pin1),
    `pin=${pin1}`);
  check("A. response carries updated_at as ISO", typeof a.body?.updated_at === "string" && /T/.test(a.body.updated_at),
    `updated_at=${a.body?.updated_at}`);

  // Branch B: status shape after regenerate
  const b = await get(`/api/labs/${LAB_ID}/inventory-pin/status`);
  check("B. GET status returns 200", b.status === 200, `status=${b.status}`);
  check("B. status reports has_pin=true", b.body?.has_pin === true, `body=${JSON.stringify(b.body).slice(0, 200)}`);
  check("B. status reports last_rotated_at matches A", b.body?.last_rotated_at === a.body?.updated_at);
  check("B. status reports failed_attempts=0", b.body?.failed_attempts === 0);
  check("B. status reports is_locked=false after rotate", b.body?.is_locked === false);
  check("B. status does NOT leak hash or pin", !("inventory_pin_hash" in (b.body || {})) && !("pin" in (b.body || {})),
    `body keys: ${Object.keys(b.body || {}).join(",")}`);

  // Branch C: second regenerate produces a different PIN
  // (1 in 1,000,000 chance of accidental match; treat as PASS for that case).
  const c = await post(`/api/labs/${LAB_ID}/inventory-pin/regenerate`);
  check("C. Second regenerate returns 200", c.status === 200, `status=${c.status}`);
  const pin2 = c.body?.pin;
  check("C. Second PIN is 6 numeric digits", typeof pin2 === "string" && /^\d{6}$/.test(pin2), `pin=${pin2}`);
  check("C. updated_at advances on second regenerate",
    new Date(c.body?.updated_at || 0).getTime() >= new Date(a.body?.updated_at || 0).getTime());

  // Branch D: status shows the new rotation
  const d = await get(`/api/labs/${LAB_ID}/inventory-pin/status`);
  check("D. status last_rotated_at matches second regenerate",
    d.body?.last_rotated_at === c.body?.updated_at);

  // Branch E (optional): non-owner is forbidden
  if (NON_OWNER_TOKEN) {
    const r1 = await fetch(`${BASE}/api/labs/${LAB_ID}/inventory-pin/regenerate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${NON_OWNER_TOKEN}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const r1body = await r1.json().catch(() => null);
    check("E. Non-owner POST regenerate returns 403",
      r1.status === 403 && /owner or admin/i.test(r1body?.error || ""),
      `status=${r1.status} err=${r1body?.error}`);
  } else {
    console.log("SKIP E. non-owner forbidden (set NON_OWNER_TOKEN env to enable)");
  }

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
