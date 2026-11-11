// scripts/verify-veritacheck-stale-draft-ui.mjs
// Browser receipt for the Sampson Regional report (2026-11-11): "Danielle is putting in some data for the EP studies in
// VeritaCheck. It is not showing her the saved data, however, I can see it." queryClient.ts keeps every read fresh
// forever (staleTime Infinity) and holds it 5 minutes after a page closes; Save Draft dropped only the study lists, so
// Continue on the draft, in the same page session, filled the form from the copy read before the save, and the next
// save wrote that copy back over the pairs saved since. The existing drafts receipt reopened with a full page load,
// which empties the cache, so it never saw this. Every reopen here goes through the dashboard's Continue link, with no
// reload. Local production build and scratch DB only (it registers made-up users and writes to SCRATCH_DB):
//   UI_REPO=<worktree> UI_PORT=<port> UI_SCRIPT=verify-veritacheck-stale-draft-ui.mjs UI_OUT=<dir> UI_DB=<db> bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
// Checks:
//   S1-S4. A 'staff' member on an active edit_all seat (made by the owner's Members invite and the invite link) saves a
//          Correlation / Method Comparison draft at 5, 10, 15 and 20 pairs; each Continue shows every saved pair.
//   S5.    Typing more after a reopen never erases a saved pair: the stored pairs are exactly the ones typed, in order.
//   S6.    Run Study from the reopened draft opens the results page in the same tab with the saved sample count.
//   O1-O2. The owner's own draft does the same in her own page session.
//   Light-mode screenshots of the reopens go to RECEIPT_DIR (default OUT).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const SHOTS = process.env.RECEIPT_DIR || OUT;
if (!BASE || !["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token, labId) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { status: r.status, body: j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const pw = ["Stale", "Draft", "77!"].join("-");

// ── A made-up owner, clinic lab and staff seat user ──────────────────────────
const tag = Date.now();
const ownerEmail = `stale-owner-${tag}@example.test`, staffEmail = `stale-staff-${tag}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: pw, name: "Made-up Director", hipaa_acknowledged: true })).body;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Made-up Stale Draft Lab", plan: "clinic" })).body.labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'clinic', lab_id = ? WHERE email = ?").run(labId, ownerEmail);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999936' WHERE id = ?").run(labId);
});
const invite = await call("POST", `/api/labs/${labId}/members`, { email: staffEmail, role: "staff", seatType: "active", firstName: "Made-up", lastName: "Tech" }, owner.token, labId);
const staff = (await call("POST", "/api/auth/register", { email: staffEmail, password: pw, name: "Made-up Tech", hipaa_acknowledged: true, inviteToken: invite.body.inviteToken })).body;
scratch((d) => d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(staffEmail));
const seat = scratch((d) => d.prepare("SELECT seat_type, status, lab_id, permissions FROM user_seats WHERE seat_email = ?").get(staffEmail));
const member = scratch((d) => d.prepare("SELECT role FROM lab_members WHERE lab_id = ? AND user_id = ?").get(labId, staff.user?.id));
check("setup: the staff member holds an active edit_all writer seat on the lab, lab role staff (Sampson's shape)",
  seat?.seat_type === "active" && seat?.status === "active" && seat?.lab_id === labId && JSON.parse(seat?.permissions || "{}").mode === "edit_all" && member?.role === "staff",
  JSON.stringify({ seat, member }));

// ── Browser helpers ─────────────────────────────────────────────────────────
const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const pageErrors = [], failedCalls = [];
const open = async (who, token) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${who}: ${e}`));
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) failedCalls.push(`${who} ${r.status()} ${r.request().method()} ${r.url().replace(BASE, "")}`); });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, token]);
  const u = me.user || me;
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem("veritas_active_lab_id", String(l)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", "light"); }, [token, u, labId]);
  await page.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "networkidle" });   // the only page load in a session
  return { page, ctx };
};
const PAIRS = Array.from({ length: 20 }, (_, i) => { const x = +(0.9 + i * 0.14).toFixed(2); return [x.toFixed(2), (x * 1.03 + 0.02).toFixed(2)]; });
const dataTab = async (page) => { await page.getByRole("tab", { name: "Data Entry" }).click(); await page.waitForTimeout(300); };
const fillPairs = async (page, from, to) => {
  for (let i = from; i < to; i++) { await page.getByTestId(`input-dp-value-${i}-0`).fill(PAIRS[i][0]); await page.getByTestId(`input-dp-value-${i}-1`).fill(PAIRS[i][1]); }
  await page.keyboard.press("Tab");
};
// How many pairs the grid shows: rows 1..n hold pairs 1..n as typed and every row after is empty (-1 otherwise).
const shownPairs = async (page) => {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push([await page.getByTestId(`input-dp-value-${i}-0`).inputValue(), await page.getByTestId(`input-dp-value-${i}-1`).inputValue()]);
  let n = 0;
  while (n < 20 && rows[n][0] !== "" && Number(rows[n][0]) === Number(PAIRS[n][0]) && Number(rows[n][1]) === Number(PAIRS[n][1])) n++;
  return rows.slice(n).every(([a, b]) => a === "" && b === "") ? n : -1;
};
const storedPairs = (id) => {
  const row = scratch((d) => d.prepare("SELECT status, data_points FROM studies WHERE id = ?").get(id));
  const dp = JSON.parse(row?.data_points || "[]");
  const pts = Array.isArray(dp) ? dp : dp.points || [];
  const vals = pts.map((p) => Object.values(p.instrumentValues || {}));
  const complete = vals.filter((v) => v.length >= 2 && v.every((x) => x !== null && x !== ""));
  // The first n rows hold exactly pairs 1..n as typed, and nothing after them.
  let n = 0;
  while (n < vals.length && vals[n].length >= 2 && Number(vals[n][0]) === Number(PAIRS[n][0]) && Number(vals[n][1]) === Number(PAIRS[n][1])) n++;
  return { status: row?.status, complete: complete.length, inOrder: n };
};
const saveDraft = async (page) => { await page.getByTestId("button-save-draft").click(); await page.waitForURL(/\/dashboard/, { timeout: 30000 }); await page.waitForTimeout(500); };
const continueDraft = async (page, id) => {
  await page.getByTestId(`button-edit-${id}`).click();                                  // in-app link, no page load
  await page.waitForURL(new RegExp(`/study/${id}/edit`));
  await page.getByTestId("input-test-name").waitFor();
  await page.waitForFunction(() => (document.querySelector('[data-testid="input-test-name"]')?.value || "") !== "", null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  await dataTab(page);
};
const shotGrid = async (page, name) => {
  await page.getByTestId("input-dp-value-0-0").evaluate((e) => e.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -110));
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), animations: "disabled" });
};
const newDraft = async (page, testName) => {
  await page.getByRole("link", { name: "New Study" }).click();
  await page.getByTestId("input-test-name").waitFor();
  await page.getByTestId("input-test-name").fill(testName);
  await page.getByTestId("select-study-type").click();
  await page.getByRole("option", { name: /Method Comparison: Multi-Instrument/ }).click();
  await dataTab(page);
};
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.message || e).split("\n")[0]); } };
const loadsBefore = (page) => page.evaluate(() => performance.getEntriesByType("navigation").length);

// ── Staff seat user, one page session ───────────────────────────────────────
await section("staff", async () => {
  const { page } = await open("staff", staff.token);
  await newDraft(page, "PT-INR");
  await fillPairs(page, 0, 5);
  await saveDraft(page);
  const id = scratch((d) => d.prepare("SELECT id FROM studies WHERE lab_id = ? AND test_name = 'PT-INR' ORDER BY id DESC LIMIT 1").get(labId))?.id;
  let s = storedPairs(id);
  check("S1. Save Draft stores pairs 1-5", s.status === "draft" && s.complete === 5 && s.inOrder === 5, JSON.stringify(s));
  const steps = [[5, 10], [10, 15], [15, 20]];
  for (const [have, upto] of steps) {
    await continueDraft(page, id);
    const shown = await shownPairs(page);
    check(`S${have / 5 + 1}. Continue from the dashboard (no reload) shows the ${have} saved pairs`, shown === have, `shows ${shown}`);
    if (have >= 10) await shotGrid(page, `staff-reopen-shows-${have}-pairs`);
    await fillPairs(page, have, upto);
    await saveDraft(page);
    s = storedPairs(id);
    check(`S5. after typing pairs ${have + 1}-${upto} on the reopened draft, the study holds pairs 1-${upto} in order, none erased`, s.complete === upto && s.inOrder === upto, JSON.stringify(s));
  }
  await continueDraft(page, id);
  const shown20 = await shownPairs(page);
  check("S4. Continue shows all 20 saved pairs", shown20 === 20, `shows ${shown20}`);
  await shotGrid(page, "staff-reopen-shows-20-pairs");
  await page.getByTestId("button-submit-study").click();
  await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
  await page.getByText("Patient Samples", { exact: true }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const samples = await page.getByText("Patient Samples", { exact: true }).evaluate((el) => el.previousElementSibling?.textContent?.trim());
  s = storedPairs(id);
  check("S6. Run Study: the results page in the same tab counts the 20 saved samples, and the study is no longer a draft",
    samples === "20" && (s.status === "pass" || s.status === "fail") && s.complete === 20, `results page reads ${samples}; stored ${JSON.stringify(s)}`);
  await page.screenshot({ path: path.join(SHOTS, "staff-results-after-run-study-20.png"), animations: "disabled" });
  check("staff: the whole flow ran in one page load (every reopen was in-app)", (await loadsBefore(page)) === 1);
});

// ── The owner's own draft, in her own page session ──────────────────────────
await section("owner", async () => {
  const { page } = await open("owner", owner.token);
  await newDraft(page, "Made-up owner draft");
  await fillPairs(page, 0, 5);
  await saveDraft(page);
  const id = scratch((d) => d.prepare("SELECT id FROM studies WHERE lab_id = ? AND test_name = 'Made-up owner draft' ORDER BY id DESC LIMIT 1").get(labId))?.id;
  await continueDraft(page, id);
  check("O1. the owner's Continue shows her 5 saved pairs", (await shownPairs(page)) === 5);
  await fillPairs(page, 5, 10);
  await saveDraft(page);
  await continueDraft(page, id);
  const shown = await shownPairs(page);
  check("O2. after her second Save Draft, Continue shows all 10 saved pairs", shown === 10, `shows ${shown}`);
  await shotGrid(page, "owner-reopen-shows-10-pairs");
  const s = storedPairs(id);
  check("O2. her draft holds pairs 1-10 in order", s.complete === 10 && s.inOrder === 10, JSON.stringify(s));
});

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
check("no failed API calls", failedCalls.length === 0, failedCalls.slice(0, 4).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
