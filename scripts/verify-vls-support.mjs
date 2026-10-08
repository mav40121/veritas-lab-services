// scripts/verify-vls-support.mjs
// Receipt for Veritas support access (docs/design/VLS_Support_Access_Design.docx).
// Runs against a LOCAL server on a scratch DB (never production): a Veritas
// user reaches a client lab with no membership and no seat, can do setup, is
// refused on every signature / approval / ownership route, every change lands
// in the owner's activity list, and the owner's switch cuts access off.
// Usage:
//   PW_BASE=http://localhost:5131 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-vls-support.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5131", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const html = (r.headers.get("content-type") || "").includes("text/html");
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, body: j, html };
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const stamp = Date.now();

const ownerEmail = `vls-owner-${stamp}@example.com`, vlsEmail = `vls-staff-${stamp}@example.com`, otherEmail = `vls-other-${stamp}@example.com`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: "testpass123", name: "Lindsay Owner", hipaa_acknowledged: true })).body;
const vls = (await call("POST", "/api/auth/register", { email: vlsEmail, password: "testpass123", name: "Michael Veritas", hipaa_acknowledged: true })).body;
const other = (await call("POST", "/api/auth/register", { email: otherEmail, password: "testpass123", name: "Not Veritas", hipaa_acknowledged: true })).body;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Client Test Lab", plan: "hospital" })).body.labId;
check("setup: owner, Veritas person, outsider and a client lab", !!owner.token && !!vls.token && !!other.token && !!labId, `lab=${labId}`);

// 1. Before the flag: a Veritas person is an outsider like anyone else.
check("before the flag: no access to the client lab", (await call("GET", `/api/labs/${labId}/qc/lots`, undefined, vls.token)).status === 403);

// 2. Admin flag: dry run shows the change, apply sets it.
const dry = await call("POST", "/api/admin/vls-support/user", { secret: ADMIN, email: vlsEmail, enabled: true, dryRun: true });
check("admin flag dry run: before off, after on, nothing written", dry.status === 200 && dry.body.before?.vlsSupport === false && dry.body.after?.vlsSupport === true && (await call("GET", `/api/labs/${labId}/qc/lots`, undefined, vls.token)).status === 403);
const set = await call("POST", "/api/admin/vls-support/user", { secret: ADMIN, email: vlsEmail, enabled: true });
check("admin flag applied", set.status === 200 && set.body.after?.vlsSupport === true);
check("admin flag refuses a wrong secret", (await call("POST", "/api/admin/vls-support/user", { secret: "nope", email: vlsEmail, enabled: true })).status === 403);
check("admin flag never creates an account (unknown email -> 404)", (await call("POST", "/api/admin/vls-support/user", { secret: ADMIN, email: `nobody-${stamp}@example.com`, enabled: true })).status === 404);

// 3. Access: listed as a client lab, setup allowed.
const me = await call("GET", "/api/labs/me", undefined, vls.token);
const row = (me.body || []).find((m) => m.labId === labId);
check("lab list shows the client lab as Veritas support (admin role, no membership)", !!row && row.viaVlsSupport === true && row.role === "admin" && row.membershipId == null, JSON.stringify(row && { role: row.role, via: row.viaVlsSupport }));
const lot = await call("POST", `/api/labs/${labId}/qc/control-lots`, { analyte: "PSA (FREND B)", level: "Level 1", lot_number: `VLS-${stamp}`, mfr_mean: 1.29, mfr_sd: 0.35 }, vls.token);
check("setup allowed: Veritas support adds a QC control lot", lot.status === 200 || lot.status === 201, `status=${lot.status}`);
check("outsider still refused on the same lab", (await call("GET", `/api/labs/${labId}/qc/lots`, undefined, other.token)).status === 403);

// 4. Signatures, approvals, ownership: refused before any handler runs.
const refusals = [
  ["QC monthly attestation", "POST", `/api/labs/${labId}/qc/period-reviews`, { period: "2026-09", lot_ids: [] }],
  ["QC medical director co-sign", "POST", `/api/labs/${labId}/qc/period-reviews/md-cosign`, { review_id: 1 }],
  ["medical director designation", "PUT", `/api/labs/${labId}/medical-director`, { email: vlsEmail, name: "Michael Veritas" }],
  ["ownership transfer", "POST", `/api/labs/${labId}/transfer-ownership`, { newOwnerUserId: 1 }],
  ["turning its own access switch", "PATCH", `/api/labs/${labId}/vls-support`, { enabled: true }],
];
refusals.push(
  ["creating a study (the lab's own record)", "POST", `/api/labs/${labId}/studies`, { testName: "x", studyType: "precision" }],
  ["creating a verification package", "POST", `/api/labs/${labId}/veritacheck/verifications`, { name: "x" }],
  ["creating a competency assessment", "POST", `/api/labs/${labId}/competency/assessments`, { program_id: 1 }],
  ["inviting a medical director (body role)", "POST", `/api/labs/${labId}/members`, { email: `md-${stamp}@example.com`, role: "medical_director" }],
  ["taking a staff invite link instead of emailing it", "POST", `/api/labs/${labId}/staff-portal-invites`, { firstName: "A", lastName: "B", email: `sp-${stamp}@example.com`, deliverEmail: false }],
  ["approving a policy", "POST", `/api/labs/${labId}/veritapolicy/documents/1/approve`, { typed_name: "x" }],
  ["signing a study", "POST", `/api/labs/${labId}/studies/1/finalize`, {}],
);
for (const [what, m, path, body] of refusals) {
  const r = await call(m, path, body, vls.token);
  check(`refused: ${what}`, r.status === 403 && r.body.code === "VLS_SUPPORT_CANNOT_SIGN", `status=${r.status} code=${r.body.code}`);
}
// Bypass attempts: the refusal is on the route definition, not the URL text.
for (const [what, path] of [
  ["capitalized path", `/api/labs/${labId}/QC/PERIOD-REVIEWS`],
  ["leading-zero lab id", `/api/labs/0${labId}/qc/period-reviews`],
  ["percent-encoded character", `/api/labs/${labId}/qc/period%2Dreviews`],
]) {
  const r = await call("POST", path, { period: "2026-09", lot_ids: [] }, vls.token);
  // Either refused, or no API route matched at all (404, or the website's HTML
  // page from the catch-all); never a QC handler.
  check(`bypass blocked: ${what}`, (r.status === 403 && r.body.code === "VLS_SUPPORT_CANNOT_SIGN") || r.status === 404 || r.html, `status=${r.status} code=${r.body.code || "-"}${r.html ? " (website page, no API route)" : ""}`);
}
{
  const sdbB = new Database(process.env.SCRATCH_DB, { readonly: true });
  const n = sdbB.prepare("SELECT COUNT(*) AS n FROM qc_period_reviews").get().n;
  sdbB.close();
  check("no monthly QC review was ever written by Veritas support", n === 0, `qc_period_reviews=${n}`);
}
// An ordinary invite (setup the lab asked for) still goes through the refusal check.
const plainInvite = await call("POST", `/api/labs/${labId}/members`, { email: `tech-${stamp}@example.com`, role: "staff" }, vls.token);
check("allowed: ordinary member invite is not refused as a signature", plainInvite.body.code !== "VLS_SUPPORT_CANNOT_SIGN", `status=${plainInvite.status}`);
{
  const sdb0 = new Database(process.env.SCRATCH_DB, { readonly: true });
  const dl = sdb0.prepare("SELECT default_lab_id FROM users WHERE email = ?").get(vlsEmail);
  sdb0.close();
  check("a client-lab visit never becomes the Veritas user's default lab", dl.default_lab_id == null || Number(dl.default_lab_id) !== Number(labId), `default_lab_id=${dl.default_lab_id}`);
}

// 5. The owner sees who and what.
const vs = await call("GET", `/api/labs/${labId}/vls-support`, undefined, owner.token);
check("owner sees access on, the Veritas person by name, and the toggle", vs.status === 200 && vs.body.enabled === true && vs.body.canToggle === true && (vs.body.people || []).some((p) => p.name === "Michael Veritas"));
check("activity list has the lot change and the refused attempts", (vs.body.activity || []).some((a) => a.method === "POST" && /qc\/control-lots/.test(a.path) && a.status < 400) && (vs.body.activity || []).filter((a) => a.status === 403).length >= refusals.length, `rows=${(vs.body.activity || []).length}`);
check("owner can see the activity, the Veritas user cannot change the switch", vs.body.viewerIsVlsSupport === false);
const sdb = new Database(process.env.SCRATCH_DB, { readonly: true });
const stamped = sdb.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE acting_as = 'vls_support'").get().n;
const activityRows = sdb.prepare("SELECT COUNT(*) AS n FROM vls_support_activity WHERE lab_id = ?").get(labId).n;
sdb.close();
check("activity rows recorded in the database", activityRows >= refusals.length + 1, `rows=${activityRows} audit acting_as rows=${stamped}`);

// 6. Browser: owner card with switch; Veritas view with its note and the Client labs group.
const browser = await chromium.launch();
async function page(token, user, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: mode });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await p.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [token, user]);
  await p.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  return p;
}
for (const mode of ["light", "dark"]) {
  const op = await page(owner.token, owner.user, mode);
  const card = op.getByTestId("vls-support-card");
  await card.scrollIntoViewIfNeeded().catch(() => {});
  check(`owner members page (${mode}): card shows On (Michael Veritas) with the switch`, (await card.count()) === 1 && /On \(.*Michael Veritas/.test(await op.getByTestId("vls-support-status").innerText()) && (await op.getByTestId("vls-support-toggle").count()) === 1);
  await op.getByTestId("vls-support-activity-btn").click();
  await op.waitForTimeout(300);
  check(`owner members page (${mode}): activity list renders`, (await op.getByTestId("vls-support-activity").count()) === 1);
  await card.screenshot({ path: `${OUT}/vls_owner_card_${mode}.png` });
  await op.context().close();
  const vp = await page(vls.token, vls.user, mode);
  check(`Veritas view (${mode}): note shown, no switch`, (await vp.getByTestId("vls-support-viewer-note").count()) === 1 && (await vp.getByTestId("vls-support-toggle").count()) === 0);
  if (mode === "light") {
    await vp.getByTestId("vls-support-card").screenshot({ path: `${OUT}/vls_staff_card_${mode}.png` });
  }
  await vp.context().close();
}
await browser.close();

// 7. The owner turns it off: access ends at once; back on restores it.
check("owner turns access off", (await call("PATCH", `/api/labs/${labId}/vls-support`, { enabled: false }, owner.token)).status === 200);
check("off: Veritas person refused on the lab", (await call("GET", `/api/labs/${labId}/qc/lots`, undefined, vls.token)).status === 403);
check("off: lab gone from the Veritas lab list", !((await call("GET", "/api/labs/me", undefined, vls.token)).body || []).some((m) => m.labId === labId));
check("owner turns access back on", (await call("PATCH", `/api/labs/${labId}/vls-support`, { enabled: true }, owner.token)).status === 200);
check("on: access restored", (await call("GET", `/api/labs/${labId}/qc/lots`, undefined, vls.token)).status === 200);

// 8. Unflagging removes access everywhere.
await call("POST", "/api/admin/vls-support/user", { secret: ADMIN, email: vlsEmail, enabled: false });
check("unflagged: no access", (await call("GET", `/api/labs/${labId}/qc/lots`, undefined, vls.token)).status === 403);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
