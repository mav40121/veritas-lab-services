// scripts/verify-bug167-168-ui.mjs
//
// Browser receipt (Gate 3 step 8) for two client bugs, on a local production build with a scratch DB and made-up people,
// lab and findings only (written through the app's own routes or the scratch DB):
//   BUG-167 (VeritaResponse): a Closed or Accepted finding whose due date has passed read "605d overdue" in red in the
//   list's Due column. The Due cell now uses the tiles' rule (shared/findingCounts.ts isFindingOpen).
//     R1a-b. the Closed and the Accepted finding, both past due, show their date in muted text, no "overdue"
//     R1c.   the open finding past due beside them still reads "Nd overdue" in red
//     R1d.   the Overdue tile counts the open one only (1), as before
//     R2.    the Closed finding's own page reads "Due <date>" with no "(Nd overdue)" after it
//   BUG-168 (VeritaMap, and the same pattern in VeritaScan): a refused create showed the raw JSON body in the toast. A tab
//   that loaded with edit access, whose seat the owner has since set to view only (the server refuses with 403):
//     M1. VeritaMap Create & Build: the toast reads "You have view-only access to VeritaMap®. Ask the account owner to
//         grant edit access." (the module by its display name, not "veritamap"), with no JSON braces
//     S1. VeritaScan Create Scan: the dialog's error line reads the same sentence for VeritaScan®
// Localhost only. Screenshots (light mode) go to RECEIPT_DIR, or OUT when RECEIPT_DIR is unset. Run (from the repo):
//   PW_BASE=http://localhost:5241 SCRATCH_DB=<scratch db> OUT=<dir> RECEIPT_DIR=<dir> node scripts/verify-bug167-168-ui.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
const SHOTS = process.env.RECEIPT_DIR || process.env.OUT || ".";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE || "")) { console.log(`FAIL  PW_BASE must be a localhost URL (got ${BASE})`); process.exit(1); }
if (!process.env.SCRATCH_DB) { console.log("FAIL  SCRATCH_DB is required"); process.exit(1); }
mkdirSync(SHOTS, { recursive: true });
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Bug", "One", "Six", "Seven", "42!"].join("-");
const stamp = Date.now();

// ── Made-up people, lab and findings on the scratch DB ──────────────────────────────────────────────────────────────
const register = async (tag, name) => {
  const email = `b167-ui-${tag}-${stamp}@example.com`;
  const r = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  return { email, name, token: r.body.token, id: Number(sql("SELECT id FROM users WHERE email = ?", email)?.id) };
};
const OWNER = await register("owner", "Made-up Owner Tamsin");
const WRITER = await register("writer", "Made-up Writer Oakhurst");
const LAB = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: OWNER.email, labName: "Made-up Due Date Lab", plan: "hospital" })).body.labId;
for (const u of [OWNER, WRITER]) sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", u.id);
sql("UPDATE users SET plan = 'hospital', seat_count = 10 WHERE id = ?", OWNER.id);
sql("UPDATE labs SET has_completed_onboarding = 1, clia_number = '22D7790167' WHERE id = ?", LAB);
const now = new Date().toISOString();
sql("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 0, ?, ?, ?)", LAB, WRITER.id, now, now, now);
const WRITER_SEAT = Number(sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'active', ?, ?, ?, ?)", OWNER.id, WRITER.email, WRITER.id, LAB, JSON.stringify({ mode: "edit_all" }), now, now));
const setSeat = (mode) => sql("UPDATE user_seats SET permissions = ? WHERE id = ?", JSON.stringify({ mode }), WRITER_SEAT);

// Three findings past due on hard-deadline clocks: one Closed, one Accepted, one still open.
const finding = (accreditor, number, due, status) => Number(sql(
  "INSERT INTO findings (user_id, lab_id, accreditor, finding_number, standard_ref, description, anchor_date, due_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  OWNER.id, LAB, accreditor, number, "Made-up standard", "Made-up finding for the receipt", due, due, status));
const CLOSED_DUE = "2025-03-15", ACCEPTED_DUE = "2025-04-01", OPEN_DUE = "2025-05-01";
const F_CLOSED = finding("CMS", "MU-CLOSED-1", CLOSED_DUE, "closed");
const F_ACCEPTED = finding("CAP", "MU-ACCEPTED-1", ACCEPTED_DUE, "accepted");
const F_OPEN = finding("TJC", "MU-OPEN-1", OPEN_DUE, "open");
check("setup: a made-up lab, a writer seat stored edit_all, and Closed, Accepted and open findings past due",
  LAB > 0 && WRITER_SEAT > 0 && !!OWNER.token && !!WRITER.token && F_CLOSED > 0 && F_ACCEPTED > 0 && F_OPEN > 0, JSON.stringify({ LAB, WRITER_SEAT, F_CLOSED, F_ACCEPTED, F_OPEN }));

// ── Browser ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const openAs = async (u, path, viewport = { width: 1200, height: 950 }) => {
  const ctx = await browser.newContext({ viewport, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, u.token]);
  await page.evaluate(([t, usr, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(usr.user || usr)); localStorage.setItem("veritas_active_lab_id", String(l)); if (usr?.id) localStorage.setItem(`onboarding_dismissed_${usr.id}`, "1"); }, [u.token, me, LAB]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const VIEW_ONLY = (label) => `You have view-only access to ${label}. Ask the account owner to grant edit access.`;

// R1. The VeritaResponse list, as the owner
{
  const page = await openAs(OWNER, `/labs/${LAB}/veritaresponse`);
  const row = (number) => page.locator("tr", { hasText: number }).first();
  await row("MU-OPEN-1").waitFor({ timeout: 25000 }).catch(() => {});
  // The Due column is the fourth cell (Accreditor, Finding #, Standard, Due, Status).
  const due = async (number) => {
    const cell = row(number).locator("td").nth(3);
    return { text: ((await cell.innerText().catch(() => "")) || "").trim(), cls: (await cell.getAttribute("class").catch(() => "")) || "" };
  };
  const closed = await due("MU-CLOSED-1"), accepted = await due("MU-ACCEPTED-1"), open = await due("MU-OPEN-1");
  const quiet = (d, date) => d.text === date && /text-muted-foreground/.test(d.cls) && !/text-red|text-amber/.test(d.cls);
  check(`R1a. the Closed finding past due shows its date only, in muted text ("${CLOSED_DUE}"), no overdue`, quiet(closed, CLOSED_DUE), JSON.stringify(closed));
  check(`R1b. the Accepted finding past due shows its date only, in muted text ("${ACCEPTED_DUE}"), no overdue`, quiet(accepted, ACCEPTED_DUE), JSON.stringify(accepted));
  check(`R1c. the open finding past due beside them still reads "Nd overdue (${OPEN_DUE})" in red`,
    new RegExp(`^\\d+d overdue \\(${OPEN_DUE}\\)$`).test(open.text) && /text-red-700/.test(open.cls), JSON.stringify(open));
  const tile = ((await page.getByText("Overdue", { exact: true }).first().locator("xpath=preceding-sibling::div[1]").innerText().catch(() => "")) || "").trim();
  check("R1d. the Overdue tile counts the open finding only (1)", tile === "1", tile);
  await page.locator("table").first().screenshot({ path: `${SHOTS}/veritaresponse-list-due-light.png` });
  await page.screenshot({ path: `${SHOTS}/veritaresponse-list-page-light.png`, fullPage: true });
  await page.context().close();
}

// R2. The Closed finding's own page
{
  const page = await openAs(OWNER, `/labs/${LAB}/veritaresponse/${F_CLOSED}`);
  const line = page.locator("span.font-semibold", { hasText: `Due ${CLOSED_DUE}` }).first();
  await line.waitFor({ timeout: 25000 }).catch(() => {});
  const text = ((await line.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  check(`R2. the Closed finding's page reads "Due ${CLOSED_DUE}" with no "(Nd overdue)"`, text === `Due ${CLOSED_DUE}`, text);
  await line.locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]").screenshot({ path: `${SHOTS}/veritaresponse-closed-detail-due-light.png` }).catch(() => {});
  await page.context().close();
}

// M1. VeritaMap: a tab that loaded with edit; the seat is then set to view only; Create & Build is refused (403)
{
  setSeat("edit_all");
  const page = await openAs(WRITER, `/labs/${LAB}/veritamap-app`);
  const btn = page.getByRole("button", { name: /New Map/ }).first();
  await btn.waitFor({ timeout: 25000 }).catch(() => {});
  await btn.click().catch(() => {});
  await page.getByPlaceholder(/Map name/).fill(`Made-up map ${stamp}`).catch(() => {});
  setSeat("view_all");
  const resp = page.waitForResponse((r) => r.url().endsWith(`/api/labs/${LAB}/veritamap/maps`) && r.request().method() === "POST", { timeout: 15000 }).catch(() => null);
  await page.getByRole("button", { name: /^Create & Build/ }).click().catch(() => {});
  const r = await resp;
  // The toast (a Radix toast root, li[data-state=open]): title "Error", then the description.
  const toast = page.locator("li[data-state=open]").first();
  await toast.waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700); // let it finish sliding in before the screenshots
  const toastText = ((await toast.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  check("M1. VeritaMap Create & Build refused (403): the toast reads the plain sentence naming VeritaMap®, no JSON",
    r?.status() === 403 && toastText === `Error ${VIEW_ONLY("VeritaMap®")}`, JSON.stringify({ status: r?.status(), toastText }));
  await page.screenshot({ path: `${SHOTS}/veritamap-view-only-create-toast-light.png` });
  await toast.screenshot({ path: `${SHOTS}/veritamap-view-only-toast-closeup-light.png` }).catch(() => {});
  await page.context().close();
}

// S1. VeritaScan: the same stale tab on Create Scan, whose error shows under the dialog's buttons
{
  setSeat("edit_all");
  const page = await openAs(WRITER, `/labs/${LAB}/veritascan-app`);
  const btn = page.getByRole("button", { name: /New Scan/ }).first();
  await btn.waitFor({ timeout: 25000 }).catch(() => {});
  await btn.click().catch(() => {});
  await page.getByPlaceholder(/Scan name/).fill(`Made-up scan ${stamp}`).catch(() => {});
  setSeat("view_all");
  const resp = page.waitForResponse((r) => r.url().includes(`/veritascan/scans`) && r.request().method() === "POST", { timeout: 15000 }).catch(() => null);
  await page.getByRole("button", { name: /^Create Scan/ }).click().catch(() => {});
  const r = await resp;
  const err = page.locator("p.text-destructive").first();
  await err.waitFor({ timeout: 8000 }).catch(() => {});
  const text = ((await err.innerText().catch(() => "")) || "").trim();
  check("S1. VeritaScan Create Scan refused (403): the dialog reads the plain sentence naming VeritaScan®, no JSON",
    r?.status() === 403 && text === VIEW_ONLY("VeritaScan®"), JSON.stringify({ status: r?.status(), text }));
  await page.locator("[role=dialog]").first().screenshot({ path: `${SHOTS}/veritascan-view-only-create-error-light.png` }).catch(() => {});
  await page.context().close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED (${passes} passed)` : `\nALL PASS (${passes})`);
process.exit(failures ? 1 : 0);
