// scripts/verify-staff-portal-identity.mjs
// Receipt for the 2026-10-08 Staff Portal identity fix (MedStar report: an
// owner opening /staff-access in Brighton saw "Justin Grinnell, Traverse City").
// Root cause: identity fell back to staff_employees.user_id = caller, but that
// column holds the OWNER id on every roster row, so an owner became roster row
// #1; and policy sign / quiz attempt / inventory adjust trusted a client-sent
// employee_id. Runs against a LOCAL server on a scratch DB (never production).
// Usage:
//   PW_BASE=http://localhost:5131 OUT=<dir> node scripts/verify-staff-portal-identity.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE || "http://localhost:5131", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = {}; try { json = await r.json(); } catch {}
  return { status: r.status, ...json };
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const stamp = Date.now();

// Owner with a two-person roster (Justin first, so the old bug binds to him).
const ownerEmail = `spid-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: "testpass123", name: "Mike Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Brighton Test Lab", plan: "hospital" })).labId;
await call("POST", `/api/labs/${labId}/staff/lab`, { labName: "Brighton Test Lab", cliaNumber: "23D0000001" }, owner.token);
const justin = await call("POST", `/api/labs/${labId}/staff/employees`, { firstName: "Justin", lastName: "Grinnell", title: "MA" }, owner.token);
const addison = await call("POST", `/api/labs/${labId}/staff/employees`, { firstName: "Addison", lastName: "Timmins", title: "MA" }, owner.token);
check("setup: two roster rows created", !!justin.id && !!addison.id, `justin=${justin.id} addison=${addison.id}`);

// Addison accepts a real Staff Portal invite (the production path).
const addisonEmail = `spid-addison-${stamp}@example.com`;
const inv = await call("POST", `/api/labs/${labId}/staff-portal-invites`, { staff_employee_id: addison.id, email: addisonEmail, deliverEmail: false }, owner.token);
const staff = await call("POST", "/api/auth/register", { email: addisonEmail, password: "testpass123", name: "Addison Timmins", hipaa_acknowledged: true, inviteToken: inv.inviteToken });
check("setup: Addison registered through the invite", !!staff.token && !!inv.inviteToken, `invite=${inv.status} register=${staff.status}`);

// 1. Owner is NOT bound to a roster row anymore.
const ownerMe = await call("GET", "/api/me/staff-portal-employee", undefined, owner.token);
check("owner /api/me/staff-portal-employee -> 404 (was: roster row 1, Justin)", ownerMe.status === 404, `status=${ownerMe.status} employee=${ownerMe.employee ? ownerMe.employee.first_name : "-"}`);
const ownerSession = await call("GET", `/api/staff-portal-session/policies?employee_id=${justin.id}`, undefined, owner.token);
check("owner cannot use staff-portal-session routes -> 401", ownerSession.status === 401, `status=${ownerSession.status}`);
const ownerBell = await call("GET", `/api/me/pending-staff-portal-items?lab_id=${labId}`, undefined, owner.token);
check("owner bell is empty (was: every roster row's pending items)", ownerBell.status === 200 && (ownerBell.quizzes || []).length === 0 && (ownerBell.policies || []).length === 0 && (ownerBell.competencies || []).length === 0, `status=${ownerBell.status}`);

// 2. A staff login resolves to exactly herself.
const staffMe = await call("GET", "/api/me/staff-portal-employee", undefined, staff.token);
check("staff login resolves to herself", staffMe.status === 200 && staffMe.employee?.id === addison.id && staffMe.lab?.id === labId, `employee=${staffMe.employee?.first_name} ${staffMe.employee?.last_name} lab=${staffMe.lab?.id}`);
const selfRead = await call("GET", `/api/staff-portal-session/policies?employee_id=${addison.id}`, undefined, staff.token);
check("staff reads her own policy list -> 200", selfRead.status === 200, `status=${selfRead.status}`);

// 3. A staff login cannot act as a coworker (was: body/query employee_id trusted).
const asCoworkerRead = await call("GET", `/api/staff-portal-session/policies?employee_id=${justin.id}`, undefined, staff.token);
check("staff reading a coworker's list -> 403", asCoworkerRead.status === 403 && asCoworkerRead.code === "STAFF_PORTAL_NOT_SELF", `status=${asCoworkerRead.status} code=${asCoworkerRead.code}`);
const asCoworkerSign = await call("POST", `/api/staff-portal-session/policies/1/sign`, { employee_id: justin.id, version_id: 1, typed_signature: "Justin Grinnell" }, staff.token);
check("staff signing a policy as a coworker -> 403", asCoworkerSign.status === 403 && asCoworkerSign.code === "STAFF_PORTAL_NOT_SELF", `status=${asCoworkerSign.status}`);
const asCoworkerQuiz = await call("POST", `/api/staff-portal-session/quizzes/1/attempt`, { employee_id: justin.id, answers: [], typed_signature: "Justin Grinnell" }, staff.token);
check("staff taking a quiz as a coworker -> 403", asCoworkerQuiz.status === 403, `status=${asCoworkerQuiz.status}`);
const asCoworkerInv = await call("POST", `/api/staff-portal-session/inventory/items/1/adjust`, { employee_id: justin.id, new_count: 1, reason: "x" }, staff.token);
check("staff adjusting inventory as a coworker -> 403", asCoworkerInv.status === 403, `status=${asCoworkerInv.status}`);
const selfSignMissingDoc = await call("POST", `/api/staff-portal-session/policies/999999/sign`, { employee_id: addison.id, version_id: 1, typed_signature: "Addison Timmins" }, staff.token);
check("staff signing as herself passes the identity check (404 only because the doc does not exist)", selfSignMissingDoc.status === 404, `status=${selfSignMissingDoc.status}`);

// 4. Browser: what each person sees at /staff-access.
async function page(browser, token, user, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: mode });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  // Dismiss the first-run onboarding wizard so the screenshot shows the page itself.
  await p.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [token, user]);
  await p.goto(`${BASE}/staff-access`, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  return p;
}
const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const op = await page(browser, owner.token, owner.user, mode);
  const ownerText = await op.locator("body").innerText();
  check(`owner /staff-access (${mode}): neutral staff-login screen, no roster name`, (await op.getByTestId("staff-portal-not-staff").count()) === 1 && !/Justin|Grinnell|Addison/.test(ownerText), ownerText.slice(0, 120).replace(/\s+/g, " "));
  await op.screenshot({ path: `${OUT}/spid_owner_${mode}.png` });
  const sp = await page(browser, staff.token, staff.user, mode);
  const staffText = await sp.locator("body").innerText();
  check(`staff /staff-access (${mode}): her own tiles, her own name`, /Addison/.test(staffText) && /Timmins/.test(staffText) && !/Justin|Grinnell/.test(staffText), staffText.slice(0, 120).replace(/\s+/g, " "));
  await sp.screenshot({ path: `${OUT}/spid_staff_${mode}.png` });
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
