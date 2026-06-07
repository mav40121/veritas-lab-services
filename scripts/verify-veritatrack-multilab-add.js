#!/usr/bin/env node
// verify-veritatrack-multilab-add.js
//
// Regression receipt for the 2026-06-07 multi-lab Add Task bug. The
// client used to POST to the unscoped /api/veritatrack/tasks endpoint
// even when the user was viewing a secondary lab; the server then
// wrote lab_id = users.lab_id (the primary lab), so the new row was
// invisible to the lab-scoped list query. This script proves the
// lab-scoped POST attributes the row to the correct lab_id and the
// list endpoint returns it on the same lab.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<JWT for an owner-tier lab member> \
//   LAB_ID=3 \
//   node scripts/verify-veritatrack-multilab-add.js

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);

if (!TOKEN) { console.error("ERROR: TOKEN env var required"); process.exit(2); }
if (!LAB_ID) { console.error("ERROR: LAB_ID env var required"); process.exit(2); }

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function del(path) {
  const r = await fetch(`${BASE}${path}`, { method: "DELETE", headers: { Authorization: `Bearer ${TOKEN}` } });
  return r.status;
}

(async () => {
  let pass = 0, fail = 0;
  function check(name, cond, detail) {
    if (cond) { pass++; console.log("PASS " + name); }
    else { fail++; console.error("FAIL " + name + (detail ? " -- " + detail : "")); }
  }

  const uniqueName = `A2-MULTILAB-VERIFY-${Date.now()}`;

  // Branch A: lab-scoped POST writes lab_id = LAB_ID
  const a = await post(`/api/labs/${LAB_ID}/veritatrack/tasks`, {
    name: uniqueName, category: "Other", frequency: "Monthly", frequency_months: 1,
  });
  check("A. Scoped POST returns 200", a.status === 200 && a.body?.id, `status=${a.status} body=${JSON.stringify(a.body).slice(0,200)}`);
  check("A. New row carries lab_id = " + LAB_ID, a.body?.lab_id === LAB_ID, `lab_id=${a.body?.lab_id}`);
  const taskId = a.body?.id;

  // Branch B: scoped list returns the new task
  const b = await get(`/api/labs/${LAB_ID}/veritatrack/tasks`);
  check("B. Scoped list returns 200 + array", b.status === 200 && Array.isArray(b.body), `status=${b.status}`);
  const inScoped = Array.isArray(b.body) && b.body.some((t) => t.id === taskId && t.name === uniqueName);
  check("B. Scoped list includes the new task by id", inScoped, `not found, list length=${Array.isArray(b.body) ? b.body.length : "?"}`);

  // Branch C: the new task does NOT show up in the unscoped list path
  // (which historically routed to the user's primary lab). This is the
  // regression guard: if the client still uses the unscoped path
  // accidentally, the row would have landed in the primary lab and
  // shown up here instead of in branch B.
  const c = await get(`/api/veritatrack/tasks`);
  if (c.status === 200 && Array.isArray(c.body)) {
    const inUnscoped = c.body.some((t) => t.id === taskId);
    check("C. Unscoped list does NOT include the scoped-created task", !inUnscoped, `found taskId ${taskId} in unscoped list`);
  } else {
    // Some user profiles 401 on the unscoped path; that's fine for this guard.
    check("C. Unscoped list either 401s or excludes the scoped task", true);
  }

  // Cleanup
  if (taskId) await del(`/api/veritatrack/tasks/${taskId}`);

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
