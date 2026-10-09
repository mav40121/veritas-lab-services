// scripts/verify-roster-prompt.mjs
// Receipt (2026-10-08): VeritaStaff roster prompt. Michael, Q2 option 1:
// "VeritaStaff lists lab members who aren't on the roster yet, with 'Add to
// roster' pre-filled from their name and email. The director confirms title and
// whether they test, and the entry is linked to their login. You and Veritas
// Support are left off."
//   - lists active members with no roster entry; leaves off Veritas support
//     users, non-members, and Staff logins already tied to a roster row by seat
//   - suggests "Link to <name>" when an unlinked roster row has the same name
//   - Add to roster (create with loginUserId) links the login; duplicates 409
//   - "Not lab personnel" hides a member; "List again" restores
//   - editors only (a seatless staff member gets 403 and no card)
//   - the page: card, pre-filled dialog, link button, hide, dark mode
// LOCAL server + scratch DB only. Usage:
//   PW_BASE=http://localhost:5139 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-roster-prompt.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5139", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const stamp = Date.now();
const reg = async (tag, name) => {
  const email = `roster-${tag}-${stamp}@example.com`;
  const r = (await call("POST", "/api/auth/register", { email, password: "testpass123", name, hipaa_acknowledged: true })).body;
  return { email, token: r.token, name };
};
const owner = await reg("owner", "Ada Owner"), admin = await reg("admin", "Abe Admin"), editor = await reg("editor", "Ed Editor");
const tina = await reg("tina", "Tina Tech"), hal = await reg("hal", "Hal Hospital"), pat = await reg("pat", "Pat Portal");
const vls = await reg("vls", "Veritas Helper"), outsider = await reg("out", "Olga Outsider");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "Roster Lab", plan: "hospital" })).body.labId;
const sdb = new Database(process.env.SCRATCH_DB);
const uid = (u) => sdb.prepare("SELECT id FROM users WHERE email = ?").get(u.email).id;
const now = new Date().toISOString();
for (const [u, role] of [[admin, "admin"], [editor, "staff"], [tina, "staff"], [hal, "staff"], [pat, "staff"], [vls, "admin"]]) {
  sdb.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 1, ?, ?, ?)").run(labId, uid(u), role, now, now, now);
}
for (const u of [owner, admin, editor, tina, hal, pat, vls]) sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid(u));
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(uid(vls));
const base = `/api/labs/${labId}/staff`;
await call("POST", `${base}/lab`, { labName: "Roster Lab", cliaNumber: `22D${String(stamp).slice(-7)}` }, owner.token);
const mkEmp = async (first, last) => (await call("POST", `${base}/employees`, { firstName: first, lastName: last, highestComplexity: "H", performsTesting: true, roles: [] }, owner.token)).body;
const tinaRow = await mkEmp("Tina", "Tech");
const patRow = await mkEmp("Pat", "Portal");
// Pat is a Staff (read-and-sign) login already tied to his roster row by his seat.
sdb.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', '{\"mode\":\"view_all\"}', ?, 'staff_portal', ?)")
  .run(uid(owner), pat.email, uid(pat), now, now, labId, patRow.id);

// ── Server rules ──
const list = async (u = owner) => (await call("GET", `${base}/members-not-on-roster`, undefined, u.token));
let r = (await list()).body;
const ids = (arr) => (arr || []).map((m) => m.userId);
check("lists members who are not on the roster (owner, admin, editor, Tina, Hal)",
  [owner, admin, editor, tina, hal].every((u) => ids(r.members).includes(uid(u))), JSON.stringify(r.members?.map((m) => m.name)));
check("leaves off the Veritas support user", !ids(r.members).includes(uid(vls)) && !ids(r.hidden).includes(uid(vls)));
check("leaves off a Staff login already tied to a roster row by its seat", !ids(r.members).includes(uid(pat)));
check("leaves off someone who is not a member of this lab", !ids(r.members).includes(uid(outsider)));
const tinaM = r.members.find((m) => m.userId === uid(tina));
check("suggests linking Tina to the existing 'Tech, Tina' roster row", tinaM?.match?.employeeId === tinaRow.id, JSON.stringify(tinaM?.match));
const adminM = r.members.find((m) => m.userId === uid(admin));
check("pre-fills first and last name from the login name", adminM?.firstName === "Abe" && adminM?.lastName === "Admin" && adminM?.match === null);
const staffGet = await list(hal);
check("a seatless staff member cannot see the prompt (403)", staffGet.status === 403, `HTTP ${staffGet.status}`);

const addEd = await call("POST", `${base}/employees`, { firstName: "Ed", lastName: "Editor", highestComplexity: "H", performsTesting: true, roles: [], loginUserId: uid(editor) }, owner.token);
check("Add to roster links the new entry to the login", addEd.status === 200 && addEd.body.login_user_id === uid(editor), `HTTP ${addEd.status} login_user_id=${addEd.body.login_user_id}`);
check("the added member drops off the prompt", !ids((await list()).body.members).includes(uid(editor)));
const dup = await call("POST", `${base}/employees`, { firstName: "Ed", lastName: "Again", roles: [], loginUserId: uid(editor) }, owner.token);
check("adding the same login twice is refused (409)", dup.status === 409 && dup.body.code === "ALREADY_ON_ROSTER", `HTTP ${dup.status} ${dup.body.code}`);
const addVls = await call("POST", `${base}/employees`, { firstName: "V", lastName: "Helper", roles: [], loginUserId: uid(vls) }, owner.token);
check("a Veritas support login cannot be put on the roster (400)", addVls.status === 400 && addVls.body.code === "VLS_SUPPORT_NOT_ROSTER", `HTTP ${addVls.status} ${addVls.body.code}`);
const addOut = await call("POST", `${base}/employees`, { firstName: "Olga", lastName: "Outsider", roles: [], loginUserId: uid(outsider) }, owner.token);
check("a non-member login cannot be linked (400)", addOut.status === 400 && addOut.body.code === "NOT_A_MEMBER", `HTTP ${addOut.status} ${addOut.body.code}`);
const plain = await call("POST", `${base}/employees`, { firstName: "No", lastName: "Login", highestComplexity: "H", performsTesting: false, roles: [] }, owner.token);
check("a plain Add Employee still works with no login link", plain.status === 200 && plain.body.login_user_id == null, `HTTP ${plain.status}`);
const linkTaken = await call("POST", `${base}/employees/${patRow.id}/link-login`, { userId: uid(hal) }, owner.token);
check("a roster row already tied to a Staff login cannot be re-linked (409)", linkTaken.status === 409 && linkTaken.body.code === "ALREADY_LINKED", `HTTP ${linkTaken.status}`);

// ── The page, as the owner ──
const me = async (u) => (await call("GET", "/api/auth/me", undefined, u.token)).body;
async function open(u, scheme = "light") {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: scheme });
  await page.goto(`${BASE}/`);
  const m = await me(u);
  await page.evaluate(([t, x]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(x)); }, [u.token, m.user ?? m]);
  await page.goto(`${BASE}/labs/${labId}/veritastaff-app`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  return { browser, page };
}
let { browser, page } = await open(owner);
check("the prompt card shows on VeritaStaff", await page.getByTestId("roster-prompt").isVisible());
await page.screenshot({ path: `${OUT}/roster_prompt.png`, fullPage: false });
// Add Abe from the card: the dialog opens pre-filled and says it links the login.
await page.getByTestId(`roster-add-${uid(admin)}`).click();
await page.getByTestId("employee-from-member").waitFor();
const dlg = page.getByRole("dialog");
const lastVal = await dlg.locator("input").nth(0).inputValue(), firstVal = await dlg.locator("input").nth(1).inputValue();
check("Add to roster opens the form pre-filled (Admin, Abe) with the login note", lastVal === "Admin" && firstVal === "Abe" && (await page.getByTestId("employee-from-member").innerText()).includes(admin.email), `${lastVal}, ${firstVal}`);
await page.screenshot({ path: `${OUT}/roster_add_dialog.png`, fullPage: false });
await dlg.getByRole("button", { name: "Add Employee" }).click();
await page.waitForTimeout(1500);
const abeRow = (await call("GET", `${base}/employees`, undefined, owner.token)).body.find((e) => e.first_name === "Abe");
check("saving from the page creates Abe's entry linked to his login", abeRow?.login_user_id === uid(admin), JSON.stringify({ id: abeRow?.id, login: abeRow?.login_user_id }));
check("Abe drops off the card", (await page.getByTestId(`roster-prompt-row-${uid(admin)}`).count()) === 0);
// Link Tina to her existing row.
await page.getByTestId(`roster-link-${uid(tina)}`).click();
await page.waitForTimeout(1200);
const tinaAfter = (await call("GET", `${base}/employees/${tinaRow.id}`, undefined, owner.token)).body;
check("Link to 'Tech, Tina' ties the existing row; no duplicate", tinaAfter.login_user_id === uid(tina) && (await call("GET", `${base}/employees`, undefined, owner.token)).body.filter((e) => e.last_name === "Tech").length === 1);
// Hal is a hospital person, not lab staff.
await page.getByTestId(`roster-hide-${uid(hal)}`).click();
await page.waitForTimeout(1200);
r = (await list()).body;
check("Not lab personnel moves Hal to the hidden list", !ids(r.members).includes(uid(hal)) && ids(r.hidden).includes(uid(hal)));
await page.getByTestId("roster-prompt-show-hidden").click();
await page.getByTestId(`roster-unhide-${uid(hal)}`).click();
await page.waitForTimeout(1200);
r = (await list()).body;
check("List again restores Hal", ids(r.members).includes(uid(hal)) && !ids(r.hidden).includes(uid(hal)));
await browser.close();

// ── Dark mode, and the staff view ──
({ browser, page } = await open(owner, "dark"));
await page.screenshot({ path: `${OUT}/roster_prompt_dark.png`, fullPage: false });
await browser.close();
({ browser, page } = await open(hal));
check("a staff member sees no prompt card", (await page.getByTestId("roster-prompt").count()) === 0);
await browser.close();

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
