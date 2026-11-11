// scripts/verify-staff-seat-no-edit-ui.mjs
//
// Browser receipt (Gate 3 step 8) for "Staff seats never edit" (Michael 2026-11-11: "That should require an admin seat ... If
// she is in a staff seat, she should not be able to do that."; shared/seatEditRule.ts). On a local production build with a
// scratch DB, a made-up owner, lab, writer seat and Staff seat, written through the app's own routes or the scratch DB only:
//   A1. Account Settings > Team Members: the Staff seat (stored {mode:"edit_all"}, the configuration the fix closes) shows
//       "Staff login, read and sign" and no Edit Permissions; the writer seat beside it still has Edit Permissions, and its
//       Edit all / View all / Custom controls open
//   A2. a Save from a tab that still offered edit is refused by the server (400 STAFF_SEAT_READ_ONLY) and nothing is stored
//   M1. the lab's Members page shows the Staff login's seat chip as "Staff login, read and sign", the writer's as Active
//   V1. the Staff login's VeritaMap page has New Map disabled, and the create route refuses it (403); the writer's is enabled
//   D1. the same in dark mode (prefers-color-scheme dark)
//   L1. a seat with no lab (Q287 = 1, 2026-11-11; server/seatContext.ts editSeatInLab): a writer seat stored edit_all with
//       lab_id NULL, held by a member of the owner's lab, sees VeritaMap's New Map enabled and creates a map there (light only)
// Localhost only. Screenshots go to OUT. Run (from the repo):
//   PW_BASE=http://localhost:5215 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-staff-seat-no-edit-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE || "")) { console.log(`FAIL  PW_BASE must be a localhost URL (got ${BASE})`); process.exit(1); }
if (!process.env.SCRATCH_DB) { console.log("FAIL  SCRATCH_DB is required"); process.exit(1); }
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Staff", "Seat", "Ui", "42!"].join("-");
const stamp = Date.now();

// ── Made-up people on the scratch DB ─────────────────────────────────────────────────────────────────────────────
const register = async (tag, name) => {
  const email = `ssne-ui-${tag}-${stamp}@example.com`;
  const r = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  return { email, name, token: r.body.token, id: Number(sql("SELECT id FROM users WHERE email = ?", email)?.id) };
};
const OWNER = await register("owner", "Made-up Owner Larkspur");
const WRITER = await register("writer", "Made-up Writer Penrose");
const STAFF = await register("staff", "Made-up Staff Ashdown");
const LAB = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: OWNER.email, labName: "Made-up Staff Seat Lab", plan: "hospital" })).body.labId;
for (const u of [OWNER, WRITER, STAFF]) sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", u.id);
sql("UPDATE users SET plan = 'hospital', seat_count = 10 WHERE id = ?", OWNER.id);
sql("UPDATE labs SET has_completed_onboarding = 1, clia_number = '22D7790042' WHERE id = ?", LAB);
const now = new Date().toISOString();
const member = (userId) => sql("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 0, ?, ?, ?)", LAB, userId, now, now, now);
const seat = (u, type, perms) => Number(sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)", OWNER.id, u.email, u.id, type, LAB, JSON.stringify(perms), now, now));
member(WRITER.id); const WRITER_SEAT = seat(WRITER, "active", { mode: "edit_all" });
// The Staff seat is stored with edit_all on purpose: the owner had been able to set that, and it must read as read and sign.
member(STAFF.id); const STAFF_SEAT = seat(STAFF, "staff_portal", { mode: "edit_all" });
// Brittany's shape (Q287 = 1): a writer seat stored edit_all with no lab, under the owner, and a staff membership in the lab.
const LABLESS = await register("labless", "Made-up Writer Quenby");
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", LABLESS.id);
member(LABLESS.id);
const LABLESS_SEAT = Number(sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'active', NULL, ?, ?, ?)", OWNER.id, LABLESS.email, LABLESS.id, JSON.stringify({ mode: "edit_all" }), now, now));
check("setup: a made-up lab, a writer seat and a Staff seat stored edit_all", LAB > 0 && WRITER_SEAT > 0 && STAFF_SEAT > 0 && !!STAFF.token, JSON.stringify({ LAB, WRITER_SEAT, STAFF_SEAT }));

// ── Browser ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const openAs = async (u, path, colorScheme = "light", viewport = { width: 1200, height: 950 }) => {
  const ctx = await browser.newContext({ viewport, colorScheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, u.token]);
  await page.evaluate(([t, usr, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(usr.user || usr)); localStorage.setItem("veritas_active_lab_id", String(l)); if (usr?.id) localStorage.setItem(`onboarding_dismissed_${usr.id}`, "1"); }, [u.token, me, LAB]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const teamCard = (page) => page.getByText("Team Members", { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]");

for (const mode of ["light", "dark"]) {
  const tag = mode === "dark" ? "D1. dark: " : "";
  // A1. Account Settings, as the owner
  const acct = await openAs(OWNER, `/labs/${LAB}/account/settings`, mode);
  await acct.getByTestId(`account-seat-${STAFF_SEAT}`).waitFor({ timeout: 25000 }).catch(() => {});
  if (mode === "dark") check(`${tag}the page follows the system setting`, await acct.evaluate(() => document.documentElement.classList.contains("dark")));
  const staffRow = acct.getByTestId(`account-seat-${STAFF_SEAT}`), writerRow = acct.getByTestId(`account-seat-${WRITER_SEAT}`);
  check(`${tag}A1a. Team Members lists both seats`, await staffRow.isVisible().catch(() => false) && await writerRow.isVisible().catch(() => false));
  const staffText = ((await staffRow.innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  check(`${tag}A1b. the Staff seat shows its type, "Staff login, read and sign", and how to let the person edit`,
    staffText.includes("Staff login, read and sign") && staffText.includes("To let this person edit, give them an admin seat."), staffText);
  check(`${tag}A1c. the Staff seat has no Edit Permissions control and no edit summary, though it is stored edit_all`,
    (await acct.getByTestId(`account-seat-edit-${STAFF_SEAT}`).count()) === 0 && !/Edit Permissions|Edit access to all modules/.test(staffText), staffText);
  check(`${tag}A1d. the writer seat beside it still has Edit Permissions and its edit summary`,
    await acct.getByTestId(`account-seat-edit-${WRITER_SEAT}`).isVisible().catch(() => false) && /Edit access to all modules/.test(await writerRow.innerText()));
  await teamCard(acct).screenshot({ path: `${OUT}/account-team-members-${mode}.png` });
  await acct.getByTestId(`account-seat-edit-${WRITER_SEAT}`).click();
  const writerOpen = (await writerRow.innerText()).replace(/\s+/g, " ");
  check(`${tag}A1e. the writer's Edit Permissions opens Edit all, View all and Custom`, /Edit all/.test(writerOpen) && /View all/.test(writerOpen) && /Custom/.test(writerOpen) && /Save Permissions/.test(writerOpen), writerOpen.slice(0, 200));
  await teamCard(acct).screenshot({ path: `${OUT}/account-team-members-writer-open-${mode}.png` });

  if (mode === "light") {
    // A2. A tab that still offered edit: the server refuses the save and nothing is stored.
    const before = sql("SELECT permissions FROM user_seats WHERE id = ?", STAFF_SEAT)?.permissions;
    const stale = await acct.evaluate(async ([b, t, id]) => { const r = await fetch(`${b}/api/account/seats/${id}/permissions`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ permissions: { mode: "custom", overrides: { veritamap: "edit" } } }) }); return { s: r.status, j: await r.json() }; }, [BASE, OWNER.token, STAFF_SEAT]);
    check("A2. a Save from a stale tab: 400 STAFF_SEAT_READ_ONLY with the plain message, nothing stored",
      stale.s === 400 && stale.j.code === "STAFF_SEAT_READ_ONLY" && stale.j.error === "A staff login is for reading and signing. To let this person edit, give them an admin seat." && sql("SELECT permissions FROM user_seats WHERE id = ?", STAFF_SEAT)?.permissions === before, JSON.stringify(stale));
  }
  await acct.context().close();

  // M1. The lab's Members page
  const mem = await openAs(OWNER, `/labs/${LAB}/members`, mode);
  const staffMemberRow = mem.locator("tr", { hasText: STAFF.email }).first();
  await staffMemberRow.waitFor({ timeout: 25000 }).catch(() => {});
  const staffChip = ((await staffMemberRow.getByTestId("seat-type-staff").innerText().catch(() => "")) || "").trim();
  const writerMemberRow = mem.locator("tr", { hasText: WRITER.email }).first();
  check(`${tag}M1. Members: the Staff login's seat reads "Staff login, read and sign"; the writer's reads Active`,
    staffChip === "Staff login, read and sign" && /Active/.test(await writerMemberRow.innerText().catch(() => "")) && (await writerMemberRow.getByTestId("seat-type-staff").count()) === 0, staffChip);
  await staffMemberRow.locator("xpath=ancestor::table[1]").screenshot({ path: `${OUT}/members-seat-chips-${mode}.png` });
  await mem.context().close();

  // V1. VeritaMap: the Staff login can't start a map; the writer can
  const vm = await openAs(STAFF, `/labs/${LAB}/veritamap-app`, mode);
  const newMap = vm.getByRole("button", { name: /New Map/ }).first();
  await newMap.waitFor({ timeout: 25000 }).catch(() => {});
  check(`${tag}V1a. the Staff login's VeritaMap page shows New Map disabled`, await newMap.isVisible().catch(() => false) && await newMap.isDisabled().catch(() => false), vm.url());
  if (mode === "light") {
    const post = await vm.evaluate(async ([b, t, l]) => { const r = await fetch(`${b}/api/labs/${l}/veritamap/maps`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ name: "Made-up map the Staff login tries" }) }); return { s: r.status, j: await r.json() }; }, [BASE, STAFF.token, LAB]);
    check("V1b. ... and the create route refuses it (403 view-only), so no map is made", post.s === 403 && /view-only access to VeritaMap®\./.test(post.j.error || "") && !sql("SELECT id FROM veritamap_maps WHERE name = 'Made-up map the Staff login tries'"), JSON.stringify(post));
  }
  await vm.screenshot({ path: `${OUT}/veritamap-staff-${mode}.png` });
  await vm.context().close();
  const vw = await openAs(WRITER, `/labs/${LAB}/veritamap-app`, mode);
  const newMapW = vw.getByRole("button", { name: /New Map/ }).first();
  await newMapW.waitFor({ timeout: 25000 }).catch(() => {});
  check(`${tag}V1c. the writer's VeritaMap page shows New Map enabled`, await newMapW.isVisible().catch(() => false) && await newMapW.isEnabled().catch(() => false));
  await vw.screenshot({ path: `${OUT}/veritamap-writer-${mode}.png` });
  await vw.context().close();
}

// L1. A seat with no lab: the holder, a member of the owner's lab, creates a VeritaMap map through the page
{
  const lv = await openAs(LABLESS, `/labs/${LAB}/veritamap-app`, "light");
  const btn = lv.getByRole("button", { name: /New Map/ }).first();
  await btn.waitFor({ timeout: 25000 }).catch(() => {});
  check("L1a. a lab-less writer seat (lab_id NULL, edit_all) held by a member sees New Map enabled", await btn.isVisible().catch(() => false) && await btn.isEnabled().catch(() => false), `seat ${LABLESS_SEAT}`);
  await btn.click().catch(() => {});
  const NAME = `Made-up map from a lab-less seat ${stamp}`;
  await lv.getByPlaceholder(/Map name/).fill(NAME).catch(() => {});
  await lv.screenshot({ path: `${OUT}/veritamap-labless-new-map-light.png` });
  const resp = lv.waitForResponse((r) => r.url().endsWith(`/api/labs/${LAB}/veritamap/maps`) && r.request().method() === "POST", { timeout: 15000 }).catch(() => null);
  await lv.getByRole("button", { name: /^Create & Build/ }).click().catch(() => {});
  const r = await resp;
  await lv.waitForURL(/\/veritamap-app\/\d+\/build/, { timeout: 15000 }).catch(() => {});
  const row = sql("SELECT id, lab_id FROM veritamap_maps WHERE name = ?", NAME);
  check("L1b. ... and creates the map: the create route answers 200, the page opens its build view, the map sits in the lab",
    r?.status() === 200 && /\/veritamap-app\/\d+\/build/.test(lv.url()) && row?.lab_id === LAB, JSON.stringify({ status: r?.status(), url: lv.url(), row }));
  await lv.screenshot({ path: `${OUT}/veritamap-labless-created-light.png` });
  await lv.context().close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED (${passes} passed)` : `\nALL PASS (${passes})`);
process.exit(failures ? 1 : 0);
