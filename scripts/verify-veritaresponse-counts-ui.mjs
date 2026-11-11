// scripts/verify-veritaresponse-counts-ui.mjs
//
// Browser receipt for PR 2 of the compliance digest (Q281 = 1): VeritaResponseAppPage now reads its "Open + In Progress"
// and "Overdue" tiles through shared/findingCounts.ts (isFindingOpen, isHardDeadline), the rule the digest counts by,
// instead of its own copy. Nothing on screen should move. On a local production build with a scratch DB, a made-up owner
// and lab with five made-up findings, all anchored long ago except one:
//   1. CAP, open             -> open, past its hard deadline (overdue)
//   2. COLA, open            -> open, soft clock (not overdue)
//   3. TJC, closed           -> not open, not overdue
//   4. CMS, accepted         -> not open, not overdue
//   5. CAP, drafting (in progress), anchored today -> open, not yet due
//   R1. Overdue reads 1 and Open + In Progress reads 3; the banner says 1 finding past its deadline.
//   R2. Dark mode shows the same numbers. No page errors.
// Run: UI_REPO=<worktree> UI_PORT=<port> UI_SCRIPT=verify-veritaresponse-counts-ui.mjs UI_OUT=response_counts UI_DB=response_counts.db bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
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

const pw = ["Response", "Counts", "1897!"].join("-");
const email = `vrc-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true })).body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Response Counts Test Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1, lab_name = 'Response Counts Test Lab', clia_number = '22D7791897', accreditation_cap = 1, accreditation_tjc = 1, accreditation_cola = 1 WHERE id = ?", labId);
// Leave out any findings the demo provisioning seeded, so the page shows only the five below.
sql("DELETE FROM findings WHERE lab_id = ?", labId);

const today = new Date().toISOString().slice(0, 10);
const made = [];
for (const f of [
  { accreditor: "CAP", anchor: "2025-01-15", desc: "Made-up CAP finding, open" },
  { accreditor: "COLA", anchor: "2025-01-15", desc: "Made-up COLA finding, open" },
  { accreditor: "TJC", anchor: "2025-01-15", desc: "Made-up TJC finding, closed", status: "closed" },
  { accreditor: "CMS", anchor: "2025-01-15", desc: "Made-up CMS finding, accepted", status: "accepted" },
  { accreditor: "CAP", anchor: today, desc: "Made-up CAP finding, drafting a response", status: "drafting" },
]) {
  const r = await call("POST", `/api/labs/${labId}/findings`, { accreditor: f.accreditor, anchor_date: f.anchor, description: f.desc, status: "open", source_type: "inspection" }, token, labId);
  if (!r.body?.id) throw new Error(`finding create ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  if (f.status) sql("UPDATE findings SET status = ? WHERE id = ?", f.status, r.body.id);
  made.push(r.body.id);
}
check("five made-up findings created", made.length === 5);

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const errors = [];
const open = async (dark) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, token]);
  await page.evaluate(([t, u, l, d]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); localStorage.setItem(`onboarding_dismissed_${(u.user || u).id}`, "1"); if (d) localStorage.setItem("theme", "dark"); }, [token, me, labId, !!dark]);
  await page.goto(`${BASE}/labs/${labId}/veritaresponse`, { waitUntil: "networkidle" });
  await page.getByText("Open + In Progress").waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  return { page, ctx };
};
const read = (page) => page.evaluate(() => {
  const tile = (label) => {
    const lab = Array.from(document.querySelectorAll("div.text-xs")).find((d) => d.textContent?.trim() === label);
    return lab ? Number(lab.parentElement?.querySelector("div.text-3xl")?.textContent?.trim()) : null;
  };
  const banner = Array.from(document.querySelectorAll("span.font-semibold")).map((s) => s.textContent?.trim()).find((t) => /past their deadline/.test(t || "")) || null;
  return { overdue: tile("Overdue"), open: tile("Open + In Progress"), banner };
});

for (const dark of [false, true]) {
  const { page, ctx } = await open(dark);
  const r = await read(page);
  const tag = dark ? "R2 (dark)" : "R1";
  check(`${tag}. Overdue tile reads 1 (only the open CAP finding past its hard deadline)`, r.overdue === 1, JSON.stringify(r));
  check(`${tag}. Open + In Progress tile reads 3 (CAP open, COLA open, CAP drafting; closed and accepted left out)`, r.open === 3, JSON.stringify(r));
  check(`${tag}. banner: 1 finding past its deadline`, r.banner === "1 finding past their deadline.", JSON.stringify(r));
  // The tiles sit below the "How VeritaResponse works" panel; bring them and the banner into view for the picture.
  await page.evaluate(() => { const el = Array.from(document.querySelectorAll("div.text-xs")).find((d) => d.textContent?.trim() === "Overdue"); el?.closest("div.grid")?.scrollIntoView({ block: "start" }); window.scrollBy(0, -120); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `veritaresponse-counts-${dark ? "dark" : "light"}.png`), fullPage: false });
  await ctx.close();
}
check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`${passes} PASS, ${failures} FAIL`);
process.exit(failures ? 1 : 0);
