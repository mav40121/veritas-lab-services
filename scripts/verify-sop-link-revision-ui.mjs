// scripts/verify-sop-link-revision-ui.mjs
// Browser receipt for BUG-165: a VeritaMap test's linked SOP read "Overdue" ("The linked policy is draft, not approved.")
// while the policy's revision was in progress, though its earlier version is still the approved procedure. On a local
// production build with a scratch DB and made-up rows only:
//   R1. a test linked to a policy whose newer revision is a draft (approved version recorded) reads Current, with
//       "Revision in progress" and the shared note as its tooltip;
//   R2. a test linked to a policy in review that was never approved still reads Overdue (unchanged);
//   R3. dark mode; no page errors.
// Run: UI_REPO=<worktree> UI_PORT=<port> UI_SCRIPT=verify-sop-link-revision-ui.mjs UI_OUT=sop_link UI_DB=sop_link.db bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const sql = (q, ...a) => { const d = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? d.prepare(q).get(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
const email = `sop-rev-${Date.now()}@example.test`;
const post = async (p, body, token, labId) => { const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: JSON.stringify(body) }); try { return await r.json(); } catch { return {}; } };
const put = async (p, body, token, labId) => { const r = await fetch(BASE + p, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) }, body: JSON.stringify(body) }); return r.status; };
const reg = await post("/api/auth/register", { email, password: ["Sop", "rev", "165!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await post("/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up SOP Lab", plan: "hospital" })).labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999165' WHERE id = ?", labId);
const userId = sql("SELECT id FROM users WHERE email = ?", email).id;
const map = await post(`/api/labs/${labId}/veritamap/maps`, { name: "Made-up SOP Map" }, reg.token, labId);
const inst = await post(`/api/labs/${labId}/veritamap/maps/${map.id}/instruments`, { instrument_name: "Abbott ARCHITECT c4000", role: "Primary", category: "Chemistry" }, reg.token, labId);
await put(`/api/labs/${labId}/veritamap/maps/${map.id}/instruments/${inst.id}/tests`, { tests: ["Glucose", "Sodium"].map((analyte) => ({ analyte, specialty: "General Chemistry", complexity: "MODERATE", active: 1 })) }, reg.token, labId);
// Made-up policies on the scratch DB: one whose newer revision is a draft over a recorded approved version; one in review never approved.
const now = new Date().toISOString();
const mkDoc = (title, status, next) => Number(sql("INSERT INTO policy_documents (lab_id, title, owner_user_id, status, next_review_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", labId, title, userId, status, next, now, now).lastInsertRowid);
const revised = mkDoc("Made-up Glucose Procedure", "draft", "2028-03-01");
sql("INSERT INTO policy_signoffs (document_id, version_id, user_id, action, typed_signature, signed_document_hash, signed_at) VALUES (?, 0, ?, 'approved', 'Made-Up Signer', 'x', '2026-03-01 09:00:00')", revised, userId);
sql("UPDATE policy_documents SET current_version_id = 902, approved_version_id = 901 WHERE id = ?", revised);
const never = mkDoc("Made-up Sodium Draft Procedure", "in_review", "2028-01-01");
const s1 = await put(`/api/labs/${labId}/veritamap/maps/${map.id}/sop-link`, { analytes: ["Glucose"], documentId: revised }, reg.token, labId);
const s2 = await put(`/api/labs/${labId}/veritamap/maps/${map.id}/sop-link`, { analytes: ["Sodium"], documentId: never }, reg.token, labId);
check("0. setup: a map with two tests, each linked to a made-up policy", s1 === 200 && s2 === 200, `${s1} ${s2}`);

const browser = await chromium.launch();
const errors = [];
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, colorScheme: opts.dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u, l, dark]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem("veritas_active_lab_id", String(l)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); if (dark) localStorage.setItem("theme", "dark"); }, [reg.token, reg.user, labId, !!opts.dark]);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${map.id}`, { waitUntil: "networkidle" });
  await page.getByTestId("sop-cell-Glucose").waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  return { page, ctx };
};
const cell = async (page, analyte) => {
  const el = page.getByTestId(`sop-cell-${analyte}`);
  return { text: (await el.innerText()).replace(/\s+/g, " ").trim(), title: await el.locator("div[title]").first().getAttribute("title").catch(() => null) };
};
{
  const { page, ctx } = await open();
  const g = await cell(page, "Glucose");
  check("R1. the revised policy's test reads Current", /Current/.test(g.text) && !/Overdue/.test(g.text), g.text);
  check("R1. ... says Revision in progress", g.text.includes("Revision in progress"), g.text);
  check("R1. ... its tooltip is the shared note", g.title === "A revision is in progress. This is the approved version.", String(g.title));
  const s = await cell(page, "Sodium");
  check("R2. a policy in review that was never approved still reads Overdue, with no revision note", /Overdue/.test(s.text) && !s.text.includes("Revision in progress") && /in review, not approved/.test(s.title || ""), `${s.text} | ${s.title}`);
  await page.getByTestId("sop-cell-Glucose").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "bug165-1-sop-link-revision.png"), fullPage: false });
  await ctx.close();
}
{
  const { page, ctx } = await open({ dark: true });
  const g = await cell(page, "Glucose");
  check("R3. dark: Current with Revision in progress", /Current/.test(g.text) && g.text.includes("Revision in progress") && await page.evaluate(() => document.documentElement.classList.contains("dark")), g.text);
  await page.getByTestId("sop-cell-Glucose").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "bug165-2-sop-link-revision-dark.png"), fullPage: false });
  await ctx.close();
}
check("R3. no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
