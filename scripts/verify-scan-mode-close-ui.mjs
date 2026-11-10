// scripts/verify-scan-mode-close-ui.mjs
//
// Browser receipt for BUG-166 (Michael 2026-11-10, in a demo): VeritaStock's Scan Mode, closed, showed the "Something
// went wrong" error screen. html5-qrcode's stop() throws (synchronously, a string) when the camera is not running; the
// scanner modal called it bare in its effect cleanup on close, and React sent the throw to the error boundary.
// On a local production build with a scratch DB, a made-up owner and lab, Chromium with a fake camera device:
//   S1. Camera refused (no permission): Scan Mode shows its camera message; the X closes it back to VeritaStock.
//   S2. Camera running (permission granted): the preview starts; Escape closes it back to VeritaStock.
//   S3. Closed while the camera is still starting (Escape right after the click): back to VeritaStock.
//   S4. Reopen after S3 and close again: back to VeritaStock (nothing left holding the camera).
//   Each: no "Something went wrong", the Scan Mode button is there, no page error naming the scanner.
// Run: UI_REPO=<worktree> UI_PORT=<port> UI_SCRIPT=verify-scan-mode-close-ui.mjs UI_OUT=scan_close UI_DB=scan_close.db bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return db.prepare(q).run(...a); } finally { db.close(); } };

const email = `scanclose-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: ["Scan", "Close", "166!"].join("-"), name: "Riley Owner", hipaa_acknowledged: true })).body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Scan Close Test Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1, lab_name = 'Scan Close Test Lab', clia_number = '22D7791466' WHERE id = ?", labId);
check("setup: made-up owner and lab", !!token && !!labId, JSON.stringify({ token: !!token, labId }));

// A full browser in new headless mode: the headless shell has no camera support ("NotSupportedError"), so S2 to S4 could
// never start the camera there. UI_CHANNEL picks it (default "chrome", the installed Google Chrome, on a throwaway
// profile Playwright creates; "chromium" where Playwright's own full build can launch).
const browser = await chromium.launch({ channel: process.env.UI_CHANNEL || "chrome", args: ["--use-fake-device-for-media-stream"] });
const open = async (camera) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  if (camera) await ctx.grantPermissions(["camera"], { origin: BASE });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e?.message || e)));
  // The error boundary catches the throw, so it surfaces as React's console error, not a page error.
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, token]);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); localStorage.setItem(`onboarding_dismissed_${(u.user || u).id}`, "1"); }, [token, me, labId]);
  await page.goto(`${BASE}/labs/${labId}/veritastock`, { waitUntil: "networkidle" });
  await page.getByTestId("open-scanner-button").waitFor({ timeout: 30000 });
  return { ctx, page, errors };
};
const afterClose = async (tag, page, errors) => {
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${tag}_after_close.png`) });
  const crashed = await page.getByText("Something went wrong").count();
  const btn = await page.getByTestId("open-scanner-button").isVisible().catch(() => false);
  const scanErr = errors.filter((m) => /scanner is not running|cannot stop/i.test(m));
  check(`${tag}: no error screen after close`, crashed === 0, `"Something went wrong" shown`);
  check(`${tag}: back on VeritaStock with the Scan Mode button`, btn);
  check(`${tag}: no page error from the scanner`, scanErr.length === 0, scanErr.join(" | "));
};

// S1. Camera refused, closed with the X.
{
  const { ctx, page, errors } = await open(false);
  await page.getByTestId("open-scanner-button").click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 10000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "S1_open_camera_refused.png") });
  const text = (await dialog.innerText()).replace(/\s+/g, " ");
  check("S1: the modal opened with the camera refused", /scan to update inventory/i.test(text), text.slice(0, 200));
  await dialog.getByRole("button", { name: /^close$/i }).last().click();
  await afterClose("S1", page, errors);
  await ctx.close();
}
// S2. Camera running, closed with Escape.
{
  const { ctx, page, errors } = await open(true);
  await page.getByTestId("open-scanner-button").click();
  await page.locator("#vls-barcode-scanner video").waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const playing = await page.locator("#vls-barcode-scanner video").count();
  await page.screenshot({ path: path.join(OUT, "S2_open_camera_running.png") });
  check("S2: the camera preview started", playing > 0);
  await page.keyboard.press("Escape");
  await afterClose("S2", page, errors);
  // S3 + S4 on the same page: close while starting, then reopen and close.
  await page.getByTestId("open-scanner-button").click();
  await page.getByRole("dialog").waitFor({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await afterClose("S3", page, errors);
  await page.getByTestId("open-scanner-button").click();
  await page.locator("#vls-barcode-scanner video").waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  check("S4: the camera preview starts again after S3", (await page.locator("#vls-barcode-scanner video").count()) > 0);
  await page.keyboard.press("Escape");
  await afterClose("S4", page, errors);
  await ctx.close();
}
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
