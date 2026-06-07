#!/usr/bin/env node
// verify-inventory-login.js
//
// Receipt for Wave K2 (2026-06-07). POST /api/inventory-login mints a
// scoped JWT (kind="inventory", labId). 5 failed attempts trip a
// 15-minute lockout per lab; rotating the PIN clears the lockout.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<JWT for owner of LAB_ID> \
//   LAB_ID=2 \
//   CLIA=<lab's CLIA number> \
//   node scripts/verify-inventory-login.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);
const CLIA = process.env.CLIA;

if (!TOKEN) { console.error("ERROR: TOKEN env var required (owner JWT)"); process.exit(2); }
if (!LAB_ID) { console.error("ERROR: LAB_ID env var required"); process.exit(2); }
if (!CLIA)   { console.error("ERROR: CLIA env var required"); process.exit(2); }

async function login(clia, pin) {
  const r = await fetch(`${BASE}/api/inventory-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clia, pin }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function rotate() {
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/inventory-pin/regenerate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: "{}",
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function status() {
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/inventory-pin/status`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  // Branch A: happy path — rotate, login with right PIN, decode token
  const r1 = await rotate();
  check("A. rotate returns 200", r1.status === 200, `status=${r1.status}`);
  const goodPin = r1.body?.pin;
  check("A. rotate returns 6-digit PIN", /^\d{6}$/.test(goodPin || ""), `pin=${goodPin}`);

  const loginOk = await login(CLIA, goodPin);
  check("A. login with good PIN returns 200", loginOk.status === 200, `status=${loginOk.status} body=${JSON.stringify(loginOk.body).slice(0,200)}`);
  check("A. response carries token", typeof loginOk.body?.token === "string" && loginOk.body.token.split(".").length === 3,
    `token=${loginOk.body?.token?.slice(0,30)}...`);
  check("A. response carries lab metadata", loginOk.body?.lab?.id === LAB_ID && loginOk.body?.lab?.clia_number === CLIA,
    `lab=${JSON.stringify(loginOk.body?.lab)}`);
  check("A. response carries expires_in_seconds", loginOk.body?.expires_in_seconds === 8 * 60 * 60,
    `expires_in_seconds=${loginOk.body?.expires_in_seconds}`);

  // Decode the JWT payload (no verify; just check shape).
  try {
    const parts = loginOk.body.token.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
    check("A. token payload kind=inventory", payload.kind === "inventory", `payload=${JSON.stringify(payload)}`);
    check("A. token payload labId matches", payload.labId === LAB_ID, `labId=${payload.labId}`);
    check("A. token payload has no userId leak", !("userId" in payload), `keys=${Object.keys(payload).join(",")}`);
  } catch (e) {
    fail += 3; console.error("FAIL A. token decode failed -- " + e.message);
  }

  // Branch B: status after success — failed_attempts reset to 0
  const sOk = await status();
  check("B. status after success: failed_attempts=0", sOk.body?.failed_attempts === 0,
    `failed_attempts=${sOk.body?.failed_attempts}`);
  check("B. status after success: not locked", sOk.body?.is_locked === false,
    `is_locked=${sOk.body?.is_locked}`);

  // Branch C: bad PIN
  const bad = await login(CLIA, "000000" === goodPin ? "111111" : "000000");
  check("C. login with bad PIN returns 401", bad.status === 401, `status=${bad.status}`);
  const sC = await status();
  check("C. failed_attempts incremented to 1", sC.body?.failed_attempts === 1,
    `failed_attempts=${sC.body?.failed_attempts}`);

  // Branch D: 4 more bad attempts → total 5 → lockout
  for (let i = 0; i < 4; i++) {
    await login(CLIA, "000000" === goodPin ? "111111" : "000000");
  }
  const sLocked = await status();
  check("D. failed_attempts at 5", sLocked.body?.failed_attempts === 5,
    `failed_attempts=${sLocked.body?.failed_attempts}`);
  check("D. is_locked=true", sLocked.body?.is_locked === true, `is_locked=${sLocked.body?.is_locked}`);
  check("D. locked_until in the future", sLocked.body?.locked_until && new Date(sLocked.body.locked_until).getTime() > Date.now(),
    `locked_until=${sLocked.body?.locked_until}`);

  // Branch E: even the right PIN now returns 423 (locked)
  const lockedAttempt = await login(CLIA, goodPin);
  check("E. login with correct PIN during lockout returns 423", lockedAttempt.status === 423,
    `status=${lockedAttempt.status}`);

  // Branch F: rotating the PIN does NOT auto-clear lockout (rotate is
  // an admin action, lockout requires explicit recovery). Verify only
  // that rotation succeeds and check the new PIN works after we
  // explicitly clear by... actually, per K1 design, rotate generates a
  // fresh PIN but does NOT reset failed_attempts/locked_until. We treat
  // that as a deliberate design: the lockout is the safety, the rotate
  // is the recovery action a director takes — but we want the director
  // to actively clear the lockout. We'll check rotate succeeds and the
  // status preserves the lockout state. (If we want rotate to clear
  // lockout, that's a separate K2.1 change.)
  const r2 = await rotate();
  check("F. rotate during lockout returns 200", r2.status === 200, `status=${r2.status}`);
  const sAfterRotate = await status();
  // Verify current behavior: lockout is preserved through rotate, so
  // the director must wait it out OR we'd need a separate clear endpoint.
  // For Wave K2 we want rotate to ALSO clear the lockout (director's
  // intent is clearly "restore access"). Check that behavior.
  check("F. rotate clears lockout (failed_attempts=0)",
    sAfterRotate.body?.failed_attempts === 0,
    `failed_attempts=${sAfterRotate.body?.failed_attempts}`);
  check("F. rotate clears lockout (is_locked=false)",
    sAfterRotate.body?.is_locked === false,
    `is_locked=${sAfterRotate.body?.is_locked}`);

  // Branch G: login with the new PIN works
  const r2pin = r2.body?.pin;
  const loginAfter = await login(CLIA, r2pin);
  check("G. login with new PIN after rotate returns 200", loginAfter.status === 200,
    `status=${loginAfter.status} body=${JSON.stringify(loginAfter.body).slice(0,200)}`);

  // Branch H: unknown CLIA returns 401 (and same error string as wrong PIN to avoid enumeration)
  const badClia = await login("00X9999", "123456");
  check("H. unknown CLIA returns 401", badClia.status === 401,
    `status=${badClia.status}`);
  check("H. unknown CLIA returns same error shape as bad PIN",
    /invalid clia or pin/i.test(badClia.body?.error || ""),
    `error=${badClia.body?.error}`);

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
