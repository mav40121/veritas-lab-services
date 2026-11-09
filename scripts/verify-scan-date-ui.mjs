// scripts/verify-scan-date-ui.mjs
// Gate 3 receipt for BUG-142 (2026-11-09): a lab's scan page showed "Invalid Date" under the scan name, because both by-id scan
// reads sent the row as stored (created_at, updated_at) and the page reads createdAt and updatedAt. Run against a LOCAL production
// build on a scratch database, with a made-up lab (it registers a person, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5199 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-scan-date-ui.mjs
// Checks: both by-id routes carry createdAt and updatedAt equal to the stored values; the scan page's sidebar shows the scan's
// last-saved date (light, dark, phone) and never "Invalid Date".
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5199", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, p, body, token, headers = {}) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };

const email = `scandate-${Date.now()}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email, password: ["Scan", "date", "77!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Date Lab", plan: "hospital" })).j.labId;
const lab = { "X-Active-Lab-Id": String(labId) };
const scanId = (await call("POST", `/api/labs/${labId}/veritascan/scans`, { name: "Made-up Date Scan" }, owner.token, lab)).j.id;
const SAVED = "2026-03-14T15:00:00.000Z";
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999996' WHERE id = ?").run(labId);
  d.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(SAVED, scanId);
});

// ── The two routes ────────────────────────────────────────────────────────────
const labRoute = await call("GET", `/api/labs/${labId}/veritascan/scans/${scanId}`, undefined, owner.token, lab);
check("lab route: 200 with updatedAt and createdAt equal to the stored values", labRoute.s === 200 && labRoute.j.updatedAt === SAVED && labRoute.j.updatedAt === labRoute.j.updated_at && !!labRoute.j.createdAt && labRoute.j.createdAt === labRoute.j.created_at, JSON.stringify(labRoute.j).slice(0, 240));
const legacy = await call("GET", `/api/veritascan/scans/${scanId}`, undefined, owner.token, lab);
check("legacy route: 200 with updatedAt and createdAt equal to the stored values", legacy.s === 200 && legacy.j.updatedAt === SAVED && !!legacy.j.createdAt && legacy.j.createdAt === legacy.j.created_at, JSON.stringify(legacy.j).slice(0, 240));
const other = await call("GET", `/api/labs/${labId}/veritascan/scans/999999`, undefined, owner.token, lab);
check("lab route: a scan not in the lab is still 404", other.s === 404);

// ── The page ──────────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const errors = [];
const me = (await call("GET", "/api/auth/me", undefined, owner.token)).j;
const want = new Date(SAVED).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
for (const view of [{ name: "light" }, { name: "dark", colorScheme: "dark" }, { name: "phone", viewport: { width: 390, height: 844 } }]) {
  const ctx = await browser.newContext({ viewport: view.viewport || { width: 1280, height: 900 }, colorScheme: view.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, me]);
  await page.goto(`${BASE}/labs/${labId}/veritascan-app/${scanId}`, { waitUntil: "networkidle" });
  await page.getByText("Made-up Date Scan").first().waitFor({ state: "attached", timeout: 20000 });
  const text = await page.evaluate(() => document.body.innerText);
  check(`${view.name}: no "Invalid Date" on the page`, !/Invalid Date/.test(text));
  if (view.name !== "phone") check(`${view.name}: the sidebar shows the scan's last-saved date (${want})`, text.includes(want), text.slice(0, 200));
  if (view.name === "phone") check("phone: no sideways scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: path.join(OUT, `scan-date-${view.name}.png`), fullPage: false, animations: "disabled" });
  await ctx.close();
}
check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 400));
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
