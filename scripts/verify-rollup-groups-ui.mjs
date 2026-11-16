// scripts/verify-rollup-groups-ui.mjs
//
// Browser receipt for roll-up groups, Phase 1 (Michael 2026-11-16; server/rollupGroups.ts, client/src/components/
// RollupGroupsDialog.tsx, client/src/pages/ReadinessDashboardPage.tsx). On a local production build with a scratch DB: a
// made-up lead who belongs to four made-up labs, and a made-up consultant who belongs to two of them.
//   G1. Inspection Readiness shows the lead's network with a Lab groups bar and "Group labs"
//   G2. the lead makes two consultant groups in the dialog; a lab sits in both
//   G3. the group filter cuts the summary and heatmap to one group, titled "Group readiness: <name>"
//   G4. "By group" breaks the heatmap out: one section per group with subtotals, then "Not in a group"
//   G5. a name that looks like patient information is refused in the dialog
//   G6. editing a group (rename, change labs) shows at once; deleting it removes it and leaves the labs
//   G7. the consultant sees their own two labs, no Lab groups of the lead's, and can group only their own labs
//   G8. dark mode and phone width: readable, no sideways scroll of the page
// Run: PW_BASE=http://localhost:5199 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-rollup-groups-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Group", "Roll", "77!"].join("-");
const stamp = Date.now();

const register = async (tag, name) => {
  const email = `rg-${tag}-${stamp}@example.com`;
  const r = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
  return { email, token: r.body.token, id: sql("SELECT id FROM users WHERE email = ?", email).id };
};
const labFor = async (owner, name, clia) => {
  const id = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: name, plan: "hospital" })).body.labId;
  sql("UPDATE labs SET has_completed_onboarding = 1, lab_name = ?, clia_number = ? WHERE id = ?", name, clia, id);
  return id;
};
const addMember = (labId, userId) => sql("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'admin', '{}', 'active', 0, datetime('now'), datetime('now'), datetime('now'))", labId, userId);

// Made-up people and labs on the scratch DB only
const lead = await register("lead", "Avery Lead");
const consultant = await register("consultant", "Casey Consultant");
const ownerB = await register("ownerb", "Blake Owner"), ownerC = await register("ownerc", "Cory Owner"), ownerD = await register("ownerd", "Drew Owner");
const A = await labFor(lead, "Pine Valley Lab", "22D7701001");
const B = await labFor(ownerB, "Birch Creek Lab", "22D7701002");
const C = await labFor(ownerC, "Cedar Point Lab", "22D7701003");
const D = await labFor(ownerD, "Dune Harbor Lab", "22D7701004");
for (const l of [B, C, D]) addMember(l, lead.id);
addMember(B, consultant.id); addMember(C, consultant.id);

const browser = await chromium.launch();
const openAs = async (who, labId, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, who.token]);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [who.token, me, labId]);
  await page.goto(`${BASE}/labs/${labId}/readiness`, { waitUntil: "networkidle" });
  return page;
};
const tid = (id) => `[data-testid="${id}"]`;
const closeDialog = async () => { const d = page.locator(tid("rollup-group-dialog")); if (await d.count()) { await d.getByRole("button", { name: "Close" }).click(); await d.waitFor({ state: "detached" }); } };

// G1
let page = await openAs(lead, A);
await page.waitForSelector(tid("rollup-group-bar"), { timeout: 20000 });
check("G1. the lead's network shows the Lab groups bar", await page.locator(tid("rollup-group-bar")).isVisible());
check("G1. with no groups yet the button reads Group labs and there's no group filter",
  (await page.locator(tid("rollup-manage-groups")).innerText()).trim() === "Group labs" && (await page.locator(tid("rollup-group-filter")).count()) === 0);
await page.screenshot({ path: `${OUT}/rg-1-network-no-groups.png`, fullPage: true });

// G2
const makeGroup = async (name, labs) => {
  await page.click(tid("rollup-group-new"));
  await page.fill(tid("rollup-group-name"), name);
  await page.selectOption(tid("rollup-group-kind"), "consultant");
  for (const l of labs) await page.check(tid(`rollup-group-lab-${l}`));
  await page.click(tid("rollup-group-save"));
  await page.waitForSelector(tid("rollup-group-new"), { timeout: 10000 });
};
await page.click(tid("rollup-manage-groups"));
await page.waitForSelector(tid("rollup-group-dialog"));
await page.click(tid("rollup-group-new"));
const eligible = await page.locator('[data-testid^="rollup-group-lab-"]').count();
check("G2. the new-group form lists the lead's 4 labs", eligible === 4, String(eligible));
await page.screenshot({ path: `${OUT}/rg-2-new-group-form.png` });
await page.click("text=Cancel");
await makeGroup("Consultant: Casey", [B, C]);
await makeGroup("Consultant: Jordan", [C, D]);
const rows = await page.locator('[data-testid^="rollup-group-row-"]').count();
check("G2. two groups listed in the dialog", rows === 2, String(rows));
await page.screenshot({ path: `${OUT}/rg-3-dialog-two-groups.png` });
await closeDialog();

// G3
await page.waitForSelector(tid("rollup-group-filter"));
const opts = await page.locator(`${tid("rollup-group-filter")} option`).allInnerTexts();
check("G3. the filter offers All labs (4), each group with its count, and Not in a group (1)",
  JSON.stringify(opts) === JSON.stringify(["All labs (4)", "Consultant: Casey (2)", "Consultant: Jordan (2)", "Not in a group (1)"]), JSON.stringify(opts));
const caseyId = await page.evaluate(() => [...document.querySelectorAll('[data-testid="rollup-group-filter"] option')].find((o) => o.textContent.startsWith("Consultant: Casey")).value);
await page.selectOption(tid("rollup-group-filter"), caseyId);
await page.waitForSelector("text=Group readiness: Consultant: Casey");
const heatRows = await page.locator("table tbody tr").count();
const sitesText = await page.locator("text=sites ready").locator("..").innerText();
check("G3. filtered to Consultant: Casey: title, 2 heatmap rows, the summary counts 2 sites", heatRows === 2 && /\/2/.test(sitesText), `${heatRows} rows, ${sitesText.replace(/\s+/g, " ")}`);
const names = await page.locator("table tbody tr td:first-child").allInnerTexts();
check("G3. the rows are Birch Creek and Cedar Point", names.sort().join("|") === "Birch Creek Lab|Cedar Point Lab", names.join("|"));
await page.screenshot({ path: `${OUT}/rg-4-filter-one-group.png`, fullPage: true });

// G4
await page.selectOption(tid("rollup-group-filter"), "all");
await page.click(tid("rollup-view-groups"));
await page.waitForSelector('[data-testid^="rollup-group-section-"]');
const sections = await page.locator('[data-testid^="rollup-group-section-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
check("G4. By group: three sections (two groups, then Not in a group)", sections.length === 3 && sections[2] === "rollup-group-section-none", JSON.stringify(sections));
const subtotals = await page.locator(tid("rollup-group-subtotal")).allInnerTexts();
check("G4. each section has a subtotal line (ready, action needed, overdue items, readiness)", subtotals.length === 3 && subtotals.every((t) => /\/\d+ ready .* action needed .* overdue .* readiness/.test(t)), JSON.stringify(subtotals));
const cedarCount = await page.locator("table tbody tr td:first-child", { hasText: "Cedar Point Lab" }).count();
check("G4. Cedar Point, in both groups, shows in both sections", cedarCount === 2, String(cedarCount));
check("G4. the note says a lab in two groups shows in both", await page.locator("text=A lab in two groups shows in both.").isVisible());
await page.screenshot({ path: `${OUT}/rg-5-by-group.png`, fullPage: true });

// G5
await page.click(tid("rollup-manage-groups"));
await page.waitForSelector(tid("rollup-group-dialog"));
await page.click(tid("rollup-group-new"));
await page.fill(tid("rollup-group-name"), "MRN 00123456");
await page.check(tid(`rollup-group-lab-${A}`));
await page.click(tid("rollup-group-save"));
await page.waitForSelector(tid("rollup-group-error"));
const err = await page.locator(tid("rollup-group-error")).innerText();
check("G5. a patient-looking name is refused with the server's words", /patient information/i.test(err), err);
await page.screenshot({ path: `${OUT}/rg-6-phi-refused.png` });
await page.click("text=Cancel");

// G6
const jordanId = sql("SELECT id FROM rollup_groups WHERE name = 'Consultant: Jordan'").id;
await page.click(tid(`rollup-group-edit-${jordanId}`));
await page.fill(tid("rollup-group-name"), "Consultant: Jordan R.");
await page.uncheck(tid(`rollup-group-lab-${C}`));
await page.check(tid(`rollup-group-lab-${A}`));
await page.click(tid("rollup-group-save"));
await page.waitForSelector(tid("rollup-group-new"));
await closeDialog();
await page.locator(tid(`rollup-group-section-${jordanId}`), { hasText: "Consultant: Jordan R." }).waitFor();
const jordanSection = await page.locator(tid(`rollup-group-section-${jordanId}`)).innerText();
check("G6. the edit shows at once: renamed, holds Pine Valley and Dune Harbor, not Cedar Point",
  /Consultant: Jordan R\./.test(jordanSection) && /Pine Valley Lab/.test(jordanSection) && /Dune Harbor Lab/.test(jordanSection) && !/Cedar Point Lab/.test(jordanSection), jordanSection.replace(/\s+/g, " ").slice(0, 200));
await page.click(tid("rollup-manage-groups"));
await page.click(tid(`rollup-group-delete-${jordanId}`));
await page.screenshot({ path: `${OUT}/rg-7-delete-confirm.png` });
await page.click(tid(`rollup-group-delete-confirm-${jordanId}`));
await page.locator(tid(`rollup-group-row-${jordanId}`)).waitFor({ state: "detached" });
await closeDialog();
const labsLeft = sql("SELECT COUNT(*) AS n FROM labs WHERE id IN (?, ?, ?, ?)", A, B, C, D).n;
check("G6. deleting a group removes it and leaves its labs", !sql("SELECT id FROM rollup_groups WHERE id = ?", jordanId) && labsLeft === 4, String(labsLeft));
await page.close();

// G7
page = await openAs(consultant, B);
await page.waitForSelector(tid("rollup-group-bar"), { timeout: 20000 });
const cRows = await page.locator("table tbody tr td:first-child").allInnerTexts();
check("G7. the consultant's network is their own two labs", cRows.sort().join("|") === "Birch Creek Lab|Cedar Point Lab", cRows.join("|"));
check("G7. no group of the lead's shows (no filter), and the button reads Group labs",
  (await page.locator(tid("rollup-group-filter")).count()) === 0 && (await page.locator(tid("rollup-manage-groups")).innerText()).trim() === "Group labs");
await page.click(tid("rollup-manage-groups"));
await page.click(tid("rollup-group-new"));
const cEligible = await page.locator('[data-testid^="rollup-group-lab-"]').count();
check("G7. the consultant can group only their own two labs", cEligible === 2, String(cEligible));
await page.close();

// G8
page = await openAs(lead, A, { colorScheme: "dark" });
await page.waitForSelector(tid("rollup-group-filter"));
await page.click(tid("rollup-view-groups"));
await page.waitForSelector('[data-testid^="rollup-group-section-"]');
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check("G8. dark mode: the page is dark", /rgb\((\d+), (\d+), (\d+)\)/.test(bg) && Number(bg.match(/\d+/)[0]) < 80, bg);
await page.screenshot({ path: `${OUT}/rg-8-by-group-dark.png`, fullPage: true });
await page.close();
page = await openAs(lead, A, { viewport: { width: 390, height: 844 } });
await page.waitForSelector(tid("rollup-group-filter"));
const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check("G8. phone width: the page doesn't scroll sideways (the heatmap scrolls inside its card)", sideways <= 1, String(sideways));
await page.screenshot({ path: `${OUT}/rg-9-phone.png`, fullPage: true });

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
