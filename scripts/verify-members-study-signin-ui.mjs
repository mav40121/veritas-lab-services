// scripts/verify-members-study-signin-ui.mjs
// Gate 3 receipt for Michael 2026-11-06, Q192 = 1 and Q193 = 1. The members screen shows a Staff login its own row and says to ask their director or supervisor; an
// editor and the owner see what they always saw. Signed out, no public page saves or lists a study, and a study page asks you to sign in; signed in, a study with no owner
// reads as not found. Run against a LOCAL production build on a scratch database, with made-up people (it registers people and provisions a lab, so it refuses any other
// host). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-members-study-signin-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");

const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required: this check adds made-up seats and studies directly to a scratch database.");
const PW = ["Members", "own", "77!"].join("-");

let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
// Boxes and pages settle a moment after they appear.
const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, `site-membersown-${name}.png`) }); };

// ── Made-up lab and people ───────────────────────────────────────────────────
const stamp = Date.now();
const mail = (tag) => `membersown-${tag}-${stamp}@example.test`;
const reg = (tag, name) => call("POST", "/api/auth/register", { email: mail(tag), password: PW, name, hipaa_acknowledged: true });
const owner = await reg("owner", "Made Up Owner"), ann = await reg("ann", "Ann Self"), ben = await reg("ben", "Ben Quillfeather"), editor = await reg("editor", "Eddie Editor"), nell = await reg("nell", "Nell Unlinked");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: mail("owner"), labName: "Members UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Members UI Lab", cliaNumber: "99D9999995", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, owner.token);
const person = async (last, first) => (await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, owner.token)).id;
const annRow = await person("Self", "Ann"), benRow = await person("Quillfeather", "Ben");
const invited = await call("POST", `${L}/staff-portal-invites`, { email: mail("pending"), firstName: "Pending", lastName: "Quillfeather", deliverEmail: false }, owner.token);

const now = new Date().toISOString();
const sdb = new Database(process.env.SCRATCH_DB);
const userId = (tag) => sdb.prepare("SELECT id FROM users WHERE email = ?").get(mail(tag)).id;
const oid = userId("owner");
const seat = (tag, type, perms, rosterId) => {
  const uid = userId(tag);
  sdb.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`).run(labId, uid, now, now, now);
  sdb.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`)
    .run(oid, mail(tag), uid, now, now, perms, `membersown-${tag}-${stamp}`, labId, type, rosterId);
};
seat("ann", "staff_portal", '{"mode":"view_all"}', annRow);
seat("ben", "staff_portal", '{"mode":"view_all"}', benRow);
seat("nell", "staff_portal", '{"mode":"view_all"}', null);
seat("editor", "active", '{"mode":"edit_all"}', null);
for (const tag of ["owner", "ann", "ben", "nell", "editor"]) sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(userId(tag));
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999995', medical_director_email = ?, medical_director_name = 'Quillfeather Director' WHERE id = ?").run(`director-${stamp}@example.test`, labId);
const studyRow = (uid, lab, name) => Number(sdb.prepare(
  `INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at)
   VALUES (?, ?, ?, 'Made-up Analyzer', 'Made Up Analyst', '2026-10-15', 'precision', 0.1, '[]', '[]', 'completed', ?)`
).run(uid, lab, name, now).lastInsertRowid);
const ownedStudy = studyRow(oid, labId, "Made-up Owned Study");
const orphanStudy = studyRow(null, null, "ORPHAN study with no owner");
sdb.close();
check("made-up lab, a Staff login, an unlinked one, an editor, a coworker, a pending invite and a study with no owner", !!labId && !!annRow && !!invited && !!ownedStudy && !!orphanStudy);

// ── The browser ──────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const errors = [];
const apiErrors = [];
const open = async (session, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) apiErrors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  await page.goto(`${BASE}/`);
  if (session) {
    const me = await call("GET", "/api/auth/me", undefined, session.token);
    await page.evaluate(([tk, u, scheme]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); if (scheme) localStorage.setItem("theme", scheme); }, [session.token, me.user ?? me, opts.colorScheme || null]);
  }
  return page;
};
const main = (page) => page.locator("main").innerText();
const membersPath = `${BASE}/labs/${labId}/members`;
const COWORKER = /Quillfeather|Eddie Editor|Made Up Owner|Pending/;
const ROW = (page) => page.locator("table tbody tr");

// A Staff login.
const staff = await open(ann);
apiErrors.length = 0;
await staff.goto(membersPath, { waitUntil: "networkidle" });
await staff.getByTestId("members-own-only").waitFor({ timeout: 20000 });
const staffText = await main(staff);
check("Staff login: says to ask their director or supervisor", /ask your lab director or supervisor/.test(await staff.getByTestId("members-own-only").innerText()), staffText.slice(0, 200));
check("Staff login: only their own row", (await ROW(staff).count()) === 1 && /Ann Self/.test(staffText), `${await ROW(staff).count()} ${staffText.slice(0, 200)}`);
check("Staff login: no coworker, owner, director or invitee on the screen", !COWORKER.test(staffText), staffText.match(/.{0,40}(Quillfeather|Eddie Editor|Made Up Owner|Pending).{0,40}/)?.[0] || "");
check("Staff login: no seat counts", !/read-and-sign staff|active seats?/i.test(staffText), staffText.slice(0, 240));
check("Staff login: the heading says it's their entry", /Your entry/.test(staffText) && !/Members \(/.test(staffText), staffText.slice(0, 200));
check("Staff login: no invite form or manage buttons", !/Invite a new member|Send invite|Transfer ownership/.test(staffText));
check("Staff login: no em dash, and no \"Staff Portal\" wording", !staffText.includes("—") && !/Staff Portal/.test(staffText), staffText.slice(0, 240));
check("Staff login: no error on the screen", !/Could not load|Failed to|Unauthorized|Forbidden/i.test(staffText), staffText.slice(0, 200));
check("Staff login: no refused call behind it", apiErrors.length === 0, apiErrors.join(" | "));
await shot(staff, "staff");

// The other screens that read this list, as a Staff login.
for (const [name, url] of [["My Policies", `/labs/${labId}/veritapolicy-app/my-policies`], ["the document library", `/labs/${labId}/veritascan/documents`]]) {
  await staff.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  const text = await main(staff);
  check(`Staff login, ${name}: opens with no error and no coworker's name`, !/Could not load|Failed to|Something went wrong/i.test(text) && !COWORKER.test(text), text.slice(0, 200));
}

// Unlinked.
const unlinked = await open(nell);
await unlinked.goto(membersPath, { waitUntil: "networkidle" });
await unlinked.getByTestId("members-own-only").waitFor({ timeout: 20000 });
const unlinkedText = await main(unlinked);
check("unlinked Staff login: its own row, the same words, nobody else", (await ROW(unlinked).count()) === 1 && /Nell Unlinked/.test(unlinkedText) && !COWORKER.test(unlinkedText), unlinkedText.slice(0, 200));

// An editor and the owner: what they always saw.
const edPage = await open(editor);
await edPage.goto(membersPath, { waitUntil: "networkidle" });
await edPage.locator("table tbody tr").first().waitFor({ timeout: 20000 });
const editorText = await main(edPage);
check("editor: the whole list, with no own-entry note", (await edPage.getByTestId("members-own-only").count()) === 0 && /Ann Self/.test(editorText) && /Ben Quillfeather/.test(editorText) && /Members \(/.test(editorText), editorText.slice(0, 240));
await shot(edPage, "editor");
const ownerPage = await open(owner);
await ownerPage.goto(membersPath, { waitUntil: "networkidle" });
await ownerPage.locator("table tbody tr").first().waitFor({ timeout: 20000 });
const ownerText = await main(ownerPage);
check("owner: the whole list, the pending invitation and the seat counts", (await ownerPage.getByTestId("members-own-only").count()) === 0 && /Ben Quillfeather/.test(ownerText) && (/pending/i.test(ownerText)) && /read-and-sign staff/i.test(ownerText) && /Invite a new member/.test(ownerText), ownerText.slice(0, 300));
await shot(ownerPage, "owner");

// Dark and phone.
const dark = await open(ann, { colorScheme: "dark" });
await dark.goto(membersPath, { waitUntil: "networkidle" });
await dark.getByTestId("members-own-only").waitFor({ timeout: 20000 });
check("dark: the page is in dark mode", await dark.evaluate(() => document.documentElement.classList.contains("dark")));
await shot(dark, "staff-dark");
const phone = await open(ann, { viewport: { width: 375, height: 812 } });
await phone.goto(membersPath, { waitUntil: "networkidle" });
await phone.getByTestId("members-own-only").waitFor({ timeout: 20000 });
check("phone: no sideways scroll", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await shot(phone, "staff-phone");

// ── Signed out: no public page saves or lists a study ─────────────────────────
const guest = await open(null);
const studyCalls = [];
guest.on("request", (r) => { const u = new URL(r.url()); if (u.pathname === "/api/studies" || u.pathname.startsWith("/api/studies/")) studyCalls.push(`${r.method()} ${u.pathname}`); });
const PUBLIC_PAGES = ["/", "/veritacheck", "/study/new", "/study-guide", "/demo", "/demo/compliance", "/demo/operations", "/demo/qc", "/pricing", "/register", "/login", "/resources/clia-tea-what-lab-directors-dont-know"];
const brokenPublic = [];
for (const url of PUBLIC_PAGES) {
  const r = await guest.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  const text = await guest.locator("body").innerText();
  if (!r || r.status() >= 400 || /Sign in required|Could not load|Something went wrong/i.test(text)) brokenPublic.push(`${url} ${r?.status()}`);
}
check(`signed out: ${PUBLIC_PAGES.length} public pages open with no error`, brokenPublic.length === 0, brokenPublic.join(" | "));
check("signed out: none of them calls the study routes at all", studyCalls.length === 0, studyCalls.join(" | "));
await guest.goto(`${BASE}/login`, { waitUntil: "networkidle" });
check("signed out: the sign-in page no longer offers a study as a guest", !/as a guest|without an account/i.test(await guest.locator("body").innerText()));
await guest.goto(`${BASE}/veritacheck`, { waitUntil: "networkidle" });
const launch = guest.getByRole("link", { name: /Launch VeritaCheck/ });
check("signed out: VeritaCheck sends you to sign up", (await launch.count()) > 0 && (await launch.first().getAttribute("href")) === "/register");
await shot(guest, "signed-out-veritacheck");

// A study page, signed out: owned or not, it asks you to sign in.
for (const [label, id] of [["a study with an owner", ownedStudy], ["a study with no owner", orphanStudy]]) {
  await guest.goto(`${BASE}/study/${id}/results`, { waitUntil: "networkidle" });
  await guest.getByText("Sign in required").waitFor({ timeout: 20000 });
  const text = await guest.locator("main").innerText();
  check(`signed out, ${label}: asks you to sign in, with nothing from the study`, !/ORPHAN|Made-up Owned Study/.test(text) && (await guest.getByRole("button", { name: "Sign In" }).count()) === 1, text.slice(0, 200));
}
await shot(guest, "signed-out-study");
await guest.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
const guestDash = await guest.locator("main").innerText();
check("signed out, the dashboard: no study with no owner listed, and it asks you to sign in", !/ORPHAN/.test(guestDash) && /sign in/i.test(guestDash), guestDash.slice(0, 200));
await shot(guest, "signed-out-dashboard");

// Signed in: a study with no owner reads as not found; their own opens.
await ownerPage.goto(`${BASE}/labs/${labId}/study/${ownedStudy}/results`, { waitUntil: "networkidle" });
check("owner: their own study opens", /Made-up Owned Study/.test(await ownerPage.locator("main").innerText()));
const signedIn = await open(nell);
await signedIn.goto(`${BASE}/study/${orphanStudy}/results`, { waitUntil: "networkidle" });
const orphanText = await signedIn.locator("main").innerText();
check("signed in, a study with no owner: not shown", !/ORPHAN/.test(orphanText), orphanText.slice(0, 200));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
