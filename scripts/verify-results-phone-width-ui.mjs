// scripts/verify-results-phone-width-ui.mjs
// Browser receipt for BUG-148: on a phone (390 px), a VeritaCheck results page was 417 px wide, so Download PDF ran past
// the screen edge on every study type (the shared header's verdict, Export CSV and Download PDF row didn't wrap). Run
// against a LOCAL production build on a scratch database with made-up values (it registers an owner and provisions a lab,
// so it refuses any other host):
//   UI_REPO=<worktree> UI_PORT=<port> UI_SCRIPT=verify-results-phone-width-ui.mjs UI_OUT=results_phone UI_DB=results_phone.db bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
// For a PASS and a FAIL calibration verification and a method comparison, at 390 and 360 px, light and dark:
//   the page has no sideways scroll, Download PDF and Export CSV sit inside the screen, and Download PDF still downloads
//   a PDF; at desktop width the row stays on one line. No page errors.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5207", ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token, labId) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return j;
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };

const email = `results-phone-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Phone", "width", "148!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Phone Width Lab", plan: "hospital" })).labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999148' WHERE id = ?").run(labId);
});
const names = ["Made-up Analyzer A", "Made-up Analyzer B"];
const study = async (testName, studyType, grid, status) => (await call("POST", `/api/labs/${labId}/studies`, {
  testName, instrument: names[0], analyst: "Made Up", date: "2026-11-10", studyType, cliaAllowableError: 0.08, teaIsPercentage: 1, teaUnit: "%",
  cliaAbsoluteFloor: 6, cliaAbsoluteUnit: "mg/dL", cliaPresetLabel: "Glucose (±8% or ±6 mg/dL)", dataPoints: JSON.stringify(grid),
  instruments: JSON.stringify(studyType === "method_comparison" ? names : [names[0]]), status, createdAt: new Date().toISOString(),
}, reg.token, labId)).id;
const levels = (f) => [50, 100, 150, 200, 250].map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: { [names[0]]: +(v * f(i)).toFixed(1) } }));
const pass = await study("Made-up Glucose", "cal_ver", levels(() => 1.01), "pass");
const fail = await study("Made-up Glucose failing", "cal_ver", levels((i) => (i === 4 ? 1.2 : 1.01)), "fail");
const mc = await study("Made-up Glucose comparison", "method_comparison", [50, 100, 150, 200, 250].map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: { [names[1]]: +(v * 1.02).toFixed(1) } })), "pass");
check("0. setup: three made-up studies saved", [pass, fail, mc].every((x) => Number.isInteger(x)), JSON.stringify([pass, fail, mc]));

const browser = await chromium.launch();
const errors = [];
const open = async (id, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, colorScheme: opts.dark ? "dark" : "light", acceptDownloads: true, ...(opts.mobile !== false && (opts.viewport?.width ?? 390) < 768 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u, dark]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); if (dark) localStorage.setItem("theme", "dark"); }, [reg.token, reg.user, !!opts.dark]);
  await page.goto(`${BASE}/labs/${labId}/study/${id}/results`, { waitUntil: "networkidle" });
  await page.getByTestId("button-download-pdf").waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  return { page, ctx };
};
const measure = (page) => page.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const box = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top) }; };
  // The innermost element reaching furthest past the screen's right edge, when anything does (so a FAIL names it).
  // An element counts only when no ancestor clips it (a sideways-scroll box holds a wide table on purpose); the first such
  // element, in page order, whose parent is still inside the screen is the one that widens the page.
  const clipped = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) { const o = getComputedStyle(a).overflowX; if (o !== "visible") return true; } return false; };
  let widest = null;
  for (const el of Array.from(document.body.querySelectorAll("*"))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= vw + 1 || clipped(el)) continue;
    const pr = el.parentElement ? el.parentElement.getBoundingClientRect() : null;
    if (pr && pr.right <= vw + 1) { widest = { el, right: Math.round(r.right), width: Math.round(r.width), parentWidth: Math.round(pr.width) }; break; }
  }
  const describe = (w) => w && { right: w.right, width: w.width, parentWidth: w.parentWidth, tag: w.el.tagName.toLowerCase(), testid: w.el.getAttribute("data-testid"), cls: String(w.el.getAttribute("class") || "").slice(0, 120), text: (w.el.textContent || "").trim().slice(0, 60) };
  return { vw, scrollWidth: document.documentElement.scrollWidth, pdf: box("button-download-pdf"), csv: box("button-export-csv"), widest: describe(widest) };
});

for (const [label, id] of [["PASS calibration verification", pass], ["FAIL calibration verification", fail], ["method comparison", mc]]) {
  for (const width of [390, 360]) {
    const { page, ctx } = await open(id, { viewport: { width, height: 844 } });
    const m = await measure(page);
    check(`1. ${label} at ${width} px: no sideways scroll`, m.scrollWidth <= m.vw + 1, JSON.stringify(m));
    check(`1. ${label} at ${width} px: Download PDF and Export CSV sit inside the screen`, !!m.pdf && !!m.csv && m.pdf.right <= m.vw && m.csv.right <= m.vw && m.pdf.left >= 0, JSON.stringify(m));
    if (width === 390) await page.screenshot({ path: path.join(OUT, `bug148-${id === pass ? "1-pass" : id === fail ? "2-fail" : "3-mc"}-390.png`), fullPage: false });
    await ctx.close();
  }
}
{
  const { page, ctx } = await open(pass, { viewport: { width: 390, height: 844 }, dark: true });
  const m = await measure(page);
  check("2. dark mode at 390 px: no sideways scroll, Download PDF inside the screen", m.scrollWidth <= m.vw + 1 && !!m.pdf && m.pdf.right <= m.vw, JSON.stringify(m));
  check("2. dark mode is on", await page.evaluate(() => document.documentElement.classList.contains("dark")));
  await page.screenshot({ path: path.join(OUT, "bug148-4-pass-390-dark.png"), fullPage: false });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }).catch(() => null), page.getByTestId("button-download-pdf").click()]);
  const file = dl ? await dl.path() : null;
  const head = file ? require("node:fs").readFileSync(file).subarray(0, 5).toString() : "";
  check("3. on the phone, Download PDF still downloads a PDF", head === "%PDF-", `${dl ? dl.suggestedFilename() : "no download"} ${head}`);
  await ctx.close();
}
{
  const { page, ctx } = await open(pass, { viewport: { width: 1280, height: 900 }, mobile: false });
  const m = await measure(page);
  check("4. desktop: the verdict, Export CSV and Download PDF stay on one line", !!m.pdf && !!m.csv && Math.abs(m.pdf.top - m.csv.top) <= 2 && m.scrollWidth <= m.vw + 1, JSON.stringify(m));
  await ctx.close();
}
check("5. no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
