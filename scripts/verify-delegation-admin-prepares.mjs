// scripts/verify-delegation-admin-prepares.mjs
// Receipt (2026-10-08): Letters of Delegation. Michael: "Let admin create the
// delegations, but have it so only the medical director can sign them. Most
// medical directors do as little as possible. The admin director does
// everything, and usually tells the medical director where to sign."
//   - owner and admin PREPARE (create, edit, discard drafts); staff cannot
//   - only the designated medical director SIGNS and REVOKES
//   - Veritas support is refused (create, edit, discard, sign)
//   - the page: preparer sees "you prepare, the MD signs" + Copy signing link,
//     drafts say "Waiting for the medical director to sign"; the MD sees
//     "Ready for your signature" and the Sign button; ?tab=delegations deep-links
// LOCAL server + scratch DB only. Usage:
//   PW_BASE=http://localhost:5138 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-delegation-admin-prepares.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5138", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const stamp = Date.now();
const reg = async (tag, name) => {
  const email = `del-${tag}-${stamp}@example.com`;
  const r = (await call("POST", "/api/auth/register", { email, password: "testpass123", name, hipaa_acknowledged: true })).body;
  return { email, token: r.token, name };
};
const owner = await reg("owner", "Ada Owner"), admin = await reg("admin", "Abe Admin"), md = await reg("md", "Dr. Mia Director"), staff = await reg("staff", "Sam Staff"), vls = await reg("vls", "Veritas Helper");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "Delegation Lab", plan: "hospital" })).body.labId;
const sdb = new Database(process.env.SCRATCH_DB);
const uid = (e) => sdb.prepare("SELECT id FROM users WHERE email = ?").get(e).id;
const now = new Date().toISOString();
for (const [u, role] of [[admin, "admin"], [md, "staff"], [staff, "staff"]]) {
  sdb.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 1, ?, ?, ?)").run(labId, uid(u.email), role, now, now, now);
}
for (const u of [owner, admin, md, staff]) sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid(u.email));
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, medical_director_email = ? WHERE id = ?").run(md.email, labId);
sdb.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(uid(vls.email));
const base = `/api/labs/${labId}/director-delegations`;
const draft = { delegate_name: "Tina Tech", position: "technical_supervisor", complexity_scope: "high", responsibilities: {} };

// ── Server rules ──
const cat = (await call("GET", `${base}/catalog`, undefined, owner.token)).body;
check("catalog tells the owner they can prepare and who signs", cat.canPrepare === true && cat.isMedicalDirector === false && cat.medicalDirectorEmail === md.email && cat.medicalDirectorIsMember === true, JSON.stringify({ canPrepare: cat.canPrepare, isMd: cat.isMedicalDirector, md: cat.medicalDirectorEmail }));
const byOwner = await call("POST", base, draft, owner.token);
const byAdmin = await call("POST", base, { ...draft, delegate_name: "Ari Admin-made" }, admin.token);
const byStaff = await call("POST", base, draft, staff.token);
const byVls = await call("POST", base, draft, vls.token);
check("owner can create a draft", byOwner.status === 201, `HTTP ${byOwner.status}`);
check("admin can create a draft", byAdmin.status === 201, `HTTP ${byAdmin.status}`);
check("staff cannot create (403)", byStaff.status === 403, `HTTP ${byStaff.status}`);
check("Veritas support cannot create (403)", byVls.status === 403, `HTTP ${byVls.status} ${byVls.body.code || ""}`);
const ownerId = byOwner.body.id, adminId = byAdmin.body.id;
const edit = await call("PUT", `${base}/${ownerId}`, { delegate_name: "Tina Tech, MLS" }, admin.token);
check("admin can edit a draft", edit.status === 200, `HTTP ${edit.status}`);
const signOwner = await call("POST", `${base}/${ownerId}/sign`, { signed_name: "Ada Owner" }, owner.token);
const signAdmin = await call("POST", `${base}/${ownerId}/sign`, { signed_name: "Abe Admin" }, admin.token);
check("owner cannot sign (403)", signOwner.status === 403, `HTTP ${signOwner.status}`);
check("admin cannot sign (403)", signAdmin.status === 403, `HTTP ${signAdmin.status}`);
const discard = await call("DELETE", `${base}/${adminId}`, undefined, owner.token);
check("owner can discard a draft", discard.status === 200, `HTTP ${discard.status}`);

// ── The page, as the owner (preparer) ──
const me = async (u) => (await call("GET", "/api/auth/me", undefined, u.token)).body;
async function open(u, scheme = "light") {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: scheme });
  await page.goto(`${BASE}/`);
  const m = await me(u);
  await page.evaluate(([t, x]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(x)); }, [u.token, m.user ?? m]);
  await page.goto(`${BASE}/labs/${labId}/veritastaff-app?tab=delegations`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  return { browser, page };
}
let { browser, page } = await open(owner);
check("?tab=delegations opens the Delegations tab", await page.getByText("Letters of Delegation").first().isVisible());
const note = await page.getByTestId("delegation-prepare-note").innerText();
check("owner sees: you prepare, the medical director signs, with a Copy signing link", note.includes(md.email) && (await page.getByTestId("copy-sign-link").count()) === 1, note.slice(0, 120));
await page.getByTestId("new-delegation-btn").click();
await page.locator("input").filter({ hasText: "" }).first().waitFor();
const nameInput = page.getByRole("dialog").locator("input").first();
await nameInput.fill("Gus General");
await page.getByTestId("save-delegation").click();
await page.waitForTimeout(1200);
const list = (await call("GET", base, undefined, owner.token)).body;
const gus = list.find((l) => l.delegate_name === "Gus General");
check("owner created a draft from the page", !!gus && gus.status === "draft", gus ? `#${gus.id}` : "not created");
check("owner's list shows 'Waiting for the medical director to sign' and no Sign button",
  (await page.getByTestId(`delegation-awaiting-${gus.id}`).innerText()).includes("Waiting for the medical director") && (await page.getByTestId(`sign-delegation-${gus.id}`).count()) === 0);
await page.screenshot({ path: `${OUT}/deleg_owner.png`, fullPage: false });
await browser.close();

// ── As the medical director ──
({ browser, page } = await open(md));
check("medical director sees 'Ready for your signature'", (await page.getByTestId(`delegation-awaiting-${gus.id}`).innerText()).includes("Ready for your signature"));
await page.getByTestId(`sign-delegation-${gus.id}`).click();
await page.getByRole("dialog").locator("input").first().fill("Mia Director, MD");
await page.getByTestId("confirm-sign").click();
await page.waitForTimeout(1200);
const signed = (await call("GET", base, undefined, owner.token)).body.find((l) => l.id === gus.id);
check("medical director signed it from the page; letter is active", signed?.status === "active" && signed?.signed_name === "Mia Director, MD", `${signed?.status} by ${signed?.signed_name}`);
await page.screenshot({ path: `${OUT}/deleg_md.png`, fullPage: false });
await browser.close();

// ── After signing ──
const editSigned = await call("PUT", `${base}/${gus.id}`, { delegate_name: "changed" }, owner.token);
const discardSigned = await call("DELETE", `${base}/${gus.id}`, undefined, owner.token);
const revokeOwner = await call("POST", `${base}/${gus.id}/revoke`, {}, owner.token);
check("a signed letter cannot be edited (409) or discarded (409)", editSigned.status === 409 && discardSigned.status === 409, `${editSigned.status}/${discardSigned.status}`);
check("owner cannot revoke (403); revoking stays with the medical director", revokeOwner.status === 403, `HTTP ${revokeOwner.status}`);

// ── Staff view and dark mode ──
({ browser, page } = await open(staff, "dark"));
check("staff see the read-only explanation and no New letter button", (await page.getByText("prepared by the lab's owner or an admin").count()) === 1 && (await page.getByTestId("new-delegation-btn").count()) === 0);
await page.screenshot({ path: `${OUT}/deleg_staff_dark.png`, fullPage: false });
await browser.close();

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
