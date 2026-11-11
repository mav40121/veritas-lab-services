// scripts/verify-stale-reopen-class-ui.mjs
// Browser receipt for the class behind the Sampson report (2026-11-11): queryClient.ts keeps every read fresh forever
// (staleTime Infinity) and holds it 5 minutes after a page closes, so an edit screen that fills itself once from a
// record read by its own key, reopened in the same page session, filled from the copy read before the last save and
// could write that copy back. VeritaCheck has its own receipt (verify-veritacheck-stale-draft-ui.mjs); this one covers
// the other three screens the sweep fixed. Every reopen is in-app (history.pushState, as a link does), never a reload.
// Local production build and scratch DB only (made-up owner, lab and records):
//   UI_REPO=<worktree> UI_PORT=<port> UI_SCRIPT=verify-stale-reopen-class-ui.mjs UI_OUT=<dir> UI_DB=<db> bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
//   M. VeritaMap build: switch one test off (autosave), leave, reopen: the menu shows it off, and no autosave writes
//      the old menu back.
//   I. IQCP builder: edit a risk row and change tab (autosave), Back to list, reopen the plan: the row reads as saved,
//      and Save risk assessment keeps it.
//   S. VeritaScan: mark an item Compliant (autosave), leave, reopen while the items read is slow: nothing can be
//      changed on the old copy, and the next change keeps the Compliant item.
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

const email = `stale-class-${Date.now()}@example.test`;
const reg = (await call("POST", "/api/auth/register", { email, password: ["Stale", "Class", "77!"].join("-"), name: "Made-up Director", hipaa_acknowledged: true })).body;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Class Lab", plan: "hospital" })).body.labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital', lab_id = ? WHERE email = ?").run(labId, email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999937' WHERE id = ?").run(labId);
});
const T = reg.token;

const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
const pageErrors = [];
const open = async (firstUrl) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem("veritas_active_lab_id", String(l)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); localStorage.setItem("theme", "light"); }, [T, reg.user, labId]);
  await page.goto(`${BASE}${firstUrl}`, { waitUntil: "networkidle" });     // the only page load
  return page;
};
const spaGo = (page, url) => page.evaluate((u) => { window.history.pushState({}, "", u); window.dispatchEvent(new PopStateEvent("popstate")); }, url);
const loads = (page) => page.evaluate(() => performance.getEntriesByType("navigation").length);
const section = async (name, fn) => { try { await fn(); } catch (e) { check(`${name}: ran to the end`, false, String(e?.message || e).split("\n")[0]); } };

// ── M. VeritaMap build ──────────────────────────────────────────────────────
await section("M", async () => {
  const mapId = (await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Made-up map" }, T, labId)).body.id;
  const inst = (await call("POST", `/api/labs/${labId}/veritamap/maps/${mapId}/instruments`, { instrument_name: "Made-up Analyzer 9000", role: "Primary", category: "Chemistry" }, T, labId)).body;
  const tests = ["Made-up A", "Made-up B", "Made-up C"].map((analyte) => ({ analyte, specialty: "Routine Chemistry", complexity: "MODERATE", active: true }));
  await call("PUT", `/api/labs/${labId}/veritamap/maps/${mapId}/instruments/${inst.id}/tests`, { tests }, T, labId);
  const serverActive = () => scratch((d) => d.prepare("SELECT COUNT(*) AS n FROM veritamap_instrument_tests WHERE instrument_id = ? AND active = 1").get(inst.id).n);
  const build = `/labs/${labId}/veritamap-app/${mapId}/build`;
  const page = await open(build);
  const activeShown = async () => Number((await page.getByText(/tests active/).first().innerText()).match(/(\d+)\s+tests active/)?.[1]);
  await page.getByRole("button", { name: /Next: Select Tests/ }).click();
  await page.getByText(/tests active/).first().waitFor();
  await page.waitForTimeout(800);
  check("M. the build page opens with 3 tests active", (await activeShown()) === 3, String(await activeShown()));
  await page.getByText("Made-up B", { exact: true }).locator("xpath=preceding-sibling::button[@role='switch']").click();
  await page.getByText("Saved", { exact: true }).waitFor({ timeout: 15000 });
  check("M. switching Made-up B off autosaves 2 active", serverActive() === 2, String(serverActive()));
  // Away to the map list (the map page itself re-reads the same key, so leaving through it hides the bug).
  await spaGo(page, `/labs/${labId}/veritamap-app`);
  await page.waitForTimeout(1500);
  await spaGo(page, build);
  await page.getByRole("button", { name: /Next: Select Tests/ }).click();
  await page.getByText(/tests active/).first().waitFor();
  await page.waitForTimeout(3500);                      // past the read and any 1.5 s autosave it could start
  const shown = await activeShown();
  check("M. reopened in the same session, the menu shows 2 tests active (it showed the 3 read before the autosave)", shown === 2, `shows ${shown}`);
  check("M. and nothing wrote the old menu back: the server still holds 2 active", serverActive() === 2, `server ${serverActive()}`);
  // Leave and reopen again with no change in between: no save marked the cached menu stale, so only the page's
  // own read on open can fill the toggles (without it they stay blank).
  await spaGo(page, `/labs/${labId}/veritamap-app`);
  await page.waitForTimeout(1500);
  await spaGo(page, build);
  await page.getByRole("button", { name: /Next: Select Tests/ }).click();
  await page.getByText(/tests active/).first().waitFor();
  await page.waitForTimeout(3500);
  const shownAgain = await activeShown();
  check("M. reopened again with nothing saved in between, the menu still fills: 2 tests active", shownAgain === 2, `shows ${shownAgain}`);
  check("M. and the server still holds 2 active", serverActive() === 2, `server ${serverActive()}`);
  await page.getByText("Made-up B", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "veritamap-build-reopen-shows-saved-menu.png"), animations: "disabled" });
  check("M. one page load for the whole flow", (await loads(page)) === 1);
  await page.context().close();
});

// ── I. IQCP builder ─────────────────────────────────────────────────────────
await section("I", async () => {
  const bank = (await call("GET", "/api/iqcp/question-bank", undefined, T, labId)).body;
  const component = bank.components[0].label;
  const plan = (await call("POST", `/api/labs/${labId}/iqcp/plans`, { instrumentName: "Made-up Analyzer 9000", title: "Made-up IQCP plan", screen: { nonwaived: "yes", reduce_intent: "yes", mfr_less_strict: "yes" } }, T, labId)).body;
  await call("PUT", `/api/labs/${labId}/iqcp/plans/${plan.id}/risk-items`, { items: [{ component, phase: "", source_of_error: "Made-up source A", reducible: "", mitigation: "" }] }, T, labId);
  const serverSource = async () => (await call("GET", `/api/labs/${labId}/iqcp/plans/${plan.id}`, undefined, T, labId)).body.riskItems?.[0]?.source_of_error;
  const page = await open(`/labs/${labId}/veritapolicy-app/iqcp`);
  const openPlan = async () => {
    await page.getByText("Made-up IQCP plan", { exact: true }).first().click();
    await page.getByText("Back to list").waitFor();
    await page.locator("summary", { hasText: component }).first().click();
    await page.getByPlaceholder("Source of error").first().waitFor();
  };
  await openPlan();
  check("I. the plan opens with its saved risk row", (await page.getByPlaceholder("Source of error").first().inputValue()) === "Made-up source A");
  await page.getByPlaceholder("Source of error").first().fill("Made-up source B");
  const put = page.waitForResponse((r) => r.url().includes(`/iqcp/plans/${plan.id}/risk-items`) && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Quality Control Plan" }).click();
  await put;
  check("I. changing tab autosaves the edited row", (await serverSource()) === "Made-up source B", String(await serverSource()));
  await page.getByText("Back to list").click();
  await page.getByText("Your IQCPs").waitFor();
  await openPlan();
  await page.waitForTimeout(500);
  const shown = await page.getByPlaceholder("Source of error").first().inputValue();
  check("I. reopened in the same session, the risk row reads as saved (it read the row from before the autosave)", shown === "Made-up source B", `shows "${shown}"`);
  await page.screenshot({ path: path.join(SHOTS, "iqcp-reopen-shows-saved-row.png"), animations: "disabled" });
  const put2 = page.waitForResponse((r) => r.url().includes(`/iqcp/plans/${plan.id}/risk-items`) && r.request().method() === "PUT");
  await page.getByRole("button", { name: "Save risk assessment" }).click();
  await put2;
  check("I. Save risk assessment after the reopen keeps the saved row", (await serverSource()) === "Made-up source B", String(await serverSource()));
  check("I. one page load for the whole flow", (await loads(page)) === 1);
  await page.context().close();
});

// ── S. VeritaScan ───────────────────────────────────────────────────────────
await section("S", async () => {
  const scanId = (await call("POST", `/api/labs/${labId}/veritascan/scans`, { name: "Made-up scan" }, T, labId)).body.id;
  const scanUrl = `/labs/${labId}/veritascan-app/${scanId}`;
  const page = await open(scanUrl);
  const statusBoxes = () => page.locator('button[role="combobox"]').filter({ hasText: /^(Not Assessed|Compliant|Needs Attention|Immediate Action)$/ });
  await statusBoxes().first().waitFor({ timeout: 20000 });
  const pick = async (nth, status) => {
    const put = page.waitForResponse((r) => r.url().includes(`/veritascan/scans/${scanId}/items`) && r.request().method() === "PUT", { timeout: 20000 });
    await statusBoxes().nth(nth).click();
    await page.getByRole("option", { name: status, exact: true }).click();
    await put;
  };
  await pick(0, "Compliant");
  const compliantIds = () => scratch((d) => d.prepare("SELECT item_id FROM veritascan_items WHERE scan_id = ? AND status = 'Compliant'").all(scanId).map((r) => r.item_id));
  const firstItem = compliantIds()[0];
  check("S. marking the first item Compliant autosaves it", compliantIds().length === 1, JSON.stringify(compliantIds()));
  await spaGo(page, `/labs/${labId}/veritascan-app`);
  await page.waitForTimeout(1500);
  // The reopen's own read of the items is slow (3 s), as on a busy connection.
  await page.route(`**/veritascan/scans/${scanId}/items`, async (route) => { if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 3000)); await route.continue(); });
  await spaGo(page, scanUrl);
  await page.waitForTimeout(700);
  const duringRead = await statusBoxes().count();
  check("S. while the reopen's read is on its way, no item status can be changed (the old copy isn't shown)", duringRead === 0, `${duringRead} status boxes shown`);
  await pick(1, "Needs Attention");                    // the user's next change, as soon as the page lets them
  const after = scratch((d) => d.prepare("SELECT item_id, status FROM veritascan_items WHERE scan_id = ? AND status != 'Not Assessed'").all(scanId));
  check("S. the next change keeps the Compliant item and adds the new one (it wrote the old copy back over the Compliant item)",
    after.some((r) => r.item_id === firstItem && r.status === "Compliant") && after.some((r) => r.status === "Needs Attention"), JSON.stringify(after));
  await statusBoxes().first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "veritascan-reopen-keeps-saved-status.png"), animations: "disabled" });
  check("S. one page load for the whole flow", (await loads(page)) === 1);
  await page.context().close();
});

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
