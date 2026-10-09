// scripts/verify-member-edit-name.mjs
// Receipt for "Edit name" on Lab Members (2026-10-08): a staff member typed her
// own last name wrong at signup ("Timmind" for "Timmins") and nobody could fix
// it. Runs against a LOCAL server on a scratch DB (never production). Usage:
//   PW_BASE=http://localhost:5131 OUT=<dir> node scripts/verify-member-edit-name.mjs
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

const ownerEmail = `en-owner-${stamp}@example.com`, staffEmail = `en-staff-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: "testpass123", name: "Mike Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Brighton Test Lab", plan: "hospital" })).labId;
await call("POST", `/api/labs/${labId}/staff/lab`, { labName: "Brighton Test Lab", cliaNumber: "23D0000001" }, owner.token);
const emp = await call("POST", `/api/labs/${labId}/staff/employees`, { firstName: "Addison", lastName: "Timmins", title: "MA" }, owner.token);
const inv = await call("POST", `/api/labs/${labId}/staff-portal-invites`, { staff_employee_id: emp.id, email: staffEmail, deliverEmail: false }, owner.token);
// She mistypes her own last name at signup, exactly as in the report.
const staff = await call("POST", "/api/auth/register", { email: staffEmail, password: "testpass123", name: "Addison Timmind", hipaa_acknowledged: true, inviteToken: inv.inviteToken });
check("setup: staff joined with the typo", !!staff.token, `register=${staff.status}`);

const list = await call("GET", `/api/labs/${labId}/members`, undefined, owner.token);
const rows = list.members || list;
const staffRow = (Array.isArray(rows) ? rows : []).find((m) => m.email === staffEmail);
const ownerRow = (Array.isArray(rows) ? rows : []).find((m) => m.email === ownerEmail);
check("setup: member row shows the typo", staffRow?.name === "Addison Timmind", `name=${staffRow?.name}`);

// API branches
const blank = await call("PATCH", `/api/labs/${labId}/members/${staffRow.membership_id}/name`, { name: "   " }, owner.token);
check("blank name -> 400", blank.status === 400, `status=${blank.status}`);
const bySelfStaff = await call("PATCH", `/api/labs/${labId}/members/${staffRow.membership_id}/name`, { name: "Hacker" }, staff.token);
check("staff login cannot rename -> 403", bySelfStaff.status === 403, `status=${bySelfStaff.status}`);
if (ownerRow) {
  const ownerRename = await call("PATCH", `/api/labs/${labId}/members/${ownerRow.membership_id}/name`, { name: "X" }, owner.token);
  check("owner row is not renamed here -> 409", ownerRename.status === 409, `status=${ownerRename.status}`);
}

// Browser: owner fixes it on Lab Members, light + dark.
const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: mode });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await p.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
  await p.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
  const target = mode === "light" ? "Addison Timmins" : "Addison Timmins";
  if (mode === "dark") {
    // second pass: put the typo back through the API so the dark run exercises the same fix
    await call("PATCH", `/api/labs/${labId}/members/${staffRow.membership_id}/name`, { name: "Addison Timmind" }, owner.token);
    await p.reload({ waitUntil: "networkidle" });
  }
  const ownerHasButton = ownerRow ? await p.getByTestId(`edit-name-${ownerRow.membership_id}`).count() : 0;
  check(`owner row has no Edit name button (${mode})`, ownerHasButton === 0);
  await p.getByTestId(`edit-name-${staffRow.membership_id}`).click();
  await p.getByTestId(`edit-name-input-${staffRow.membership_id}`).fill(target);
  await p.screenshot({ path: `${OUT}/edit_name_editing_${mode}.png` });
  await p.getByTestId(`edit-name-save-${staffRow.membership_id}`).click();
  await p.waitForTimeout(1200);
  const text = await p.locator("table").innerText();
  check(`Edit name saves and the row shows "${target}" (${mode})`, text.includes(target) && !text.includes("Timmind"), text.split("\n").find((l) => /Addison/.test(l)) || "");
  await p.screenshot({ path: `${OUT}/edit_name_saved_${mode}.png` });
  await ctx.close();
}
await browser.close();
const after = await call("GET", "/api/auth/me", undefined, staff.token);
check("the staff member's own account now reads Timmins", (after.user?.name || after.name) === "Addison Timmins", `name=${after.user?.name || after.name}`);
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
