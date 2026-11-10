// scripts/verify-veritatrack-not-started-ui.mjs
//
// Browser receipt for BUG-143: VeritaTrack's Today's Worklist counted a task with no sign-off as Overdue while the cards
// below counted it nowhere (the server counted it notStarted, but no card showed that). On a local production build with a
// scratch DB, a made-up owner and lab with two made-up tasks, one never signed off and one last signed off in January 2025:
//   N1. The worklist reads Overdue 1 and Not Started 1; the cards read Overdue 1 and Not Started 1; each task is counted once.
//   N2. A lab whose tasks are all signed off shows no Not Started tile or card (the four-card row as before).
//   N3. Dark mode and phone width (390 px): the tile and card show, no sideways scroll. No page errors.
// Run: UI_REPO=<worktree> UI_PORT=<port> UI_SCRIPT=verify-veritatrack-not-started-ui.mjs UI_OUT=track_not_started UI_DB=track_not_started.db bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token, labId) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Track", "Started", "143!"].join("-");
const lab = async (tag, tasks) => {
  const email = `vtns-${tag}-${Date.now()}@example.com`;
  const token = (await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true })).body.token;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Not Started Test Lab", plan: "hospital" })).body.labId;
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
  sql("UPDATE labs SET has_completed_onboarding = 1, lab_name = 'Not Started Test Lab', clia_number = ? WHERE id = ?", tag === "a" ? "22D7791430" : "22D7791431", labId);
  for (const t of tasks) {
    const made = (await call("POST", `/api/labs/${labId}/veritatrack/tasks`, { name: t.name, category: "QC Review", frequency: "Monthly" }, token, labId)).body;
    if (t.signed) await call("POST", `/api/veritatrack/tasks/${made.id}/signoff`, { completed_date: t.signed, performed_by: "Pat Example", initials: "PE" }, token, labId);
  }
  return { token, labId };
};
const today = new Date().toISOString().slice(0, 10);
const A = await lab("a", [{ name: "Made-up monthly QC review (never signed off)" }, { name: "Made-up maintenance review (overdue)", signed: "2025-01-15" }]);
const B = await lab("b", [{ name: "Made-up monthly QC review (signed today)", signed: today }]);

const browser = await chromium.launch();
const errors = [];
const open = async (L, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.dark ? "dark" : "light", ...((opts.viewport?.width ?? 1300) < 768 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, L.token]);
  await page.evaluate(([t, u, l, dark]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); localStorage.setItem(`onboarding_dismissed_${(u.user || u).id}`, "1"); if (dark) localStorage.setItem("theme", "dark"); }, [L.token, me, L.labId, !!opts.dark]);
  await page.goto(`${BASE}/labs/${L.labId}/veritatrack-app`, { waitUntil: "networkidle" });
  await page.getByTestId("track-card-overdue").waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  return { page, ctx };
};
const read = (page) => page.evaluate(() => {
  const tile = (label) => {
    const box = Array.from(document.querySelectorAll("h3")).find((h) => h.textContent?.trim() === "Today's Worklist")?.closest("div.rounded-xl");
    if (!box) return null;
    const cell = Array.from(box.querySelectorAll("div.rounded-lg")).find((d) => d.querySelector("div")?.textContent?.trim().toLowerCase() === label.toLowerCase());
    return cell ? Number(cell.querySelector("div.text-2xl")?.textContent) : null;
  };
  const card = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); return el ? Number(el.querySelector("div.text-2xl")?.textContent) : null; };
  return {
    tile: { overdue: tile("Overdue"), notStarted: tile("Not Started") },
    card: { overdue: card("track-card-overdue"), month: card("track-card-due-this-month"), soon: card("track-card-due-soon-d-"), current: card("track-card-current"), notStarted: card("track-card-not-started") },
    fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  };
});

{
  const { page, ctx } = await open(A);
  const r = await read(page);
  check("N1. worklist: Overdue 1 (the past-due task) and Not Started 1 (the never-signed task)", r.tile.overdue === 1 && r.tile.notStarted === 1, JSON.stringify(r.tile));
  check("N1. cards: Overdue 1 and Not Started 1", r.card.overdue === 1 && r.card.notStarted === 1, JSON.stringify(r.card));
  const sum = [r.card.overdue, r.card.month, r.card.soon, r.card.current, r.card.notStarted].reduce((a, b) => a + (b ?? 0), 0);
  check("N1. the cards count each of the two tasks once", sum === 2, JSON.stringify(r.card));
  await page.screenshot({ path: path.join(OUT, "bug143-1-worklist-and-cards.png"), fullPage: false });
  await ctx.close();
}
{
  const { page, ctx } = await open(B);
  const r = await read(page);
  const sumB = [r.card.overdue, r.card.month, r.card.soon, r.card.current].reduce((a, b) => a + (b ?? 0), 0);
  check("N2. a lab with every task signed off: no Not Started tile or card, no overdue, the one task counted once", r.card.notStarted === null && r.tile.notStarted === null && r.card.overdue === 0 && sumB === 1, JSON.stringify(r));
  await ctx.close();
}
{
  const { page, ctx } = await open(A, { dark: true });
  const r = await read(page);
  check("N3. dark: the tile and card show Not Started 1", r.tile.notStarted === 1 && r.card.notStarted === 1 && await page.evaluate(() => document.documentElement.classList.contains("dark")), JSON.stringify(r));
  await page.screenshot({ path: path.join(OUT, "bug143-2-dark.png"), fullPage: false });
  await ctx.close();
}
{
  const { page, ctx } = await open(A, { viewport: { width: 390, height: 844 } });
  const r = await read(page);
  check("N3. phone width: the tile and card show, no sideways scroll", r.tile.notStarted === 1 && r.card.notStarted === 1 && r.fits, JSON.stringify(r));
  await page.screenshot({ path: path.join(OUT, "bug143-3-phone.png"), fullPage: true });
  await ctx.close();
}
check("N3. no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
