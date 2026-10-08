// scripts/verify-staff-my-signoffs.mjs
// Receipt for #84 "My sign-offs" (2026-10-08): the old /staff-access screen is
// now "My sign-offs" inside the lab. A real Staff login (accepted invite) goes
// My work -> My sign-offs; sign-off tiles open here; Record QC and Count
// Inventory open the main VeritaQC and VeritaStock screens; old /staff-access
// links still land on the same page; an owner gets the neutral note.
// LOCAL server + scratch DB only. Usage:
//   PW_BASE=http://localhost:5131 OUT=<dir> node scripts/verify-staff-my-signoffs.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE || "http://localhost:5131", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, ...j };
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const stamp = Date.now();

const ownerEmail = `ms-owner-${stamp}@example.com`, staffEmail = `ms-staff-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: "testpass123", name: "Mike Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Brighton Test Lab", plan: "hospital" })).labId;
await call("POST", `/api/labs/${labId}/staff/lab`, { labName: "Brighton Test Lab", cliaNumber: "23D0000001" }, owner.token);
const emp = await call("POST", `/api/labs/${labId}/staff/employees`, { firstName: "Addison", lastName: "Timmins", title: "MA" }, owner.token);
const inv = await call("POST", `/api/labs/${labId}/staff-portal-invites`, { staff_employee_id: emp.id, email: staffEmail, deliverEmail: false }, owner.token);
const staff = await call("POST", "/api/auth/register", { email: staffEmail, password: "testpass123", name: "Addison Timmins", hipaa_acknowledged: true, inviteToken: inv.inviteToken });
check("setup: Addison joined through a real Staff invite", !!staff.token && !!labId, `lab=${labId}`);

async function open(token, user, path, mode) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, colorScheme: mode });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/`);
  await p.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [token, user]);
  await p.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await p.waitForTimeout(700);
  return p;
}
const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  // My work -> My sign-offs
  const p = await open(staff.token, staff.user, `/labs/${labId}/dashboard`, mode);
  const link = p.getByTestId("staff-my-work-my-sign-offs");
  check(`(${mode}) My work links to My sign-offs inside the lab`, (await link.getAttribute("href")) === `/labs/${labId}/my-signoffs`, await link.getAttribute("href"));
  await link.click();
  await p.waitForURL(new RegExp(`/labs/${labId}/my-signoffs`));
  await p.waitForTimeout(800);
  const heading = await p.getByTestId("sp-heading").innerText().catch(() => "");
  const body = await p.locator("body").innerText();
  check(`(${mode}) page reads "My sign-offs" with her own name`, /my sign-offs/i.test(heading) && /Addison/.test(body) && /Timmins/.test(body), heading);
  check(`(${mode}) sign-off tiles present; "Not me / switch" gone`, (await p.getByTestId("sp-tile-policies").count()) === 1 && (await p.getByTestId("sp-tile-competency").count()) === 1 && (await p.getByTestId("sp-tile-quizzes").count()) === 1 && (await p.getByTestId("sp-switch-employee").count()) === 0);
  await p.screenshot({ path: `${OUT}/mysignoffs_staff_${mode}.png` });
  // Record QC opens the main VeritaQC
  await p.getByTestId("sp-tile-qc").click();
  await p.waitForTimeout(700);
  check(`(${mode}) Record QC opens the main VeritaQC screen`, new RegExp(`/labs/${labId}/veritaqc-app`).test(p.url()), p.url());
  // Count Inventory opens the main VeritaStock
  await p.goto(`${BASE}/labs/${labId}/my-signoffs`, { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  await p.getByTestId("sp-tile-inventory").click();
  await p.waitForTimeout(700);
  check(`(${mode}) Count Inventory opens the main VeritaStock screen`, new RegExp(`/labs/${labId}/veritastock`).test(p.url()), p.url());
  // Policies tile still opens the sign screen in place
  await p.goto(`${BASE}/labs/${labId}/my-signoffs`, { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  await p.getByTestId("sp-tile-policies").click();
  await p.waitForTimeout(700);
  check(`(${mode}) Sign Policies opens the policy list in place`, (await p.getByTestId("sp-tiles").count()) === 0 && new RegExp(`/labs/${labId}/my-signoffs`).test(p.url()));
  await p.context().close();
}
// Old links keep working; owner gets the neutral note.
const old = await open(staff.token, staff.user, "/staff-access", "light");
check("old /staff-access link lands on the same My sign-offs page", /my sign-offs/i.test(await old.getByTestId("sp-heading").innerText().catch(() => "")));
await old.context().close();
const op = await open(owner.token, owner.user, `/labs/${labId}/my-signoffs`, "light");
check("owner on My sign-offs gets the neutral staff-login note", (await op.getByTestId("staff-portal-not-staff").count()) === 1);
await op.context().close();
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
