// scripts/verify-system-readiness-ui.mjs
//
// Browser receipt for readiness across a system (B2, 2026-11-24; server/labReadiness.ts,
// server/systemFindings.ts, client/src/pages/ReadinessDashboardPage.tsx, client/src/pages/SystemFindingsPage.tsx). On a local
// production build with a scratch DB: a made-up system of four labs, its admin on a free account with no membership of their
// own, and a made-up member of two of the labs.
//   U1. the admin's roll-up shows all four labs with Findings, Documents and Verification studies columns
//   U2. a lab with nothing entered reads Not set up in every cell and is counted apart, never ready
//   U3. Open findings opens the cross-lab list: every open finding, past due first
//   U4. the lab group and accreditor filters cut the list; a group picked on the roll-up carries over
//   U5. a row opens the finding in its own lab
//   U6. a lab's own page: Not set up banner for the empty lab, the new cards on the busy one
//   U7. a member who isn't the system's owner or admin has no Open findings button, and the address refuses them
//   U8. a free account outside a system still reads the subscription notice
//   U9. dark mode and phone width: readable, no sideways scroll of the page
// Run: PW_BASE=http://localhost:5217 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-system-readiness-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); db.pragma("foreign_keys = OFF"); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const insert = (table, values) => {
  const db = new Database(process.env.SCRATCH_DB); db.pragma("foreign_keys = OFF");
  try {
    const row = { ...values };
    for (const c of db.prepare(`PRAGMA table_info(${table})`).all()) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-10T00:00:00Z" : /count|_id$|is_|mean|sd$|clia_allowable|value/i.test(c.name) ? 0 : "made-up";
    const keys = Object.keys(row);
    return Number(db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
  } finally { db.close(); }
};
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const pw = ["System", "Ready", "77!"].join("-");
const stamp = Date.now();
const register = async (tag, name, plan = "free") => {
  const email = `sysr-${tag}-${stamp}@example.com`;
  const r = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = ? WHERE email = ?", plan, email);
  return { email, token: r.body.token, id: sql("SELECT id FROM users WHERE email = ?", email).id };
};
let seq = 0;
const labFor = async (owner, name) => {
  const clia = `22D${String((stamp + seq++) % 10000000).padStart(7, "0")}`;
  const id = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: name, plan: "hospital" })).body.labId;
  sql("UPDATE labs SET has_completed_onboarding = 1, lab_name = ?, clia_number = ?, accreditation_cap = 1, accreditation_tjc = 1 WHERE id = ?", name, clia, id);
  return id;
};

// Made-up people and labs on the scratch DB only
const owner = await register("owner", "Avery Owner", "hospital"), leader = await register("leader", "Morgan Leader"), tech = await register("tech", "Casey Tech", "hospital"), free = await register("free", "Frankie Free");
const A = await labFor(owner, "Alder Creek Lab"), B = await labFor(owner, "Birch Point Lab"), C = await labFor(owner, "Cedar Hill Lab"), D = await labFor(owner, "Dune Harbor Lab");
const FL = await labFor(free, "Free Standing Lab"); sql("UPDATE labs SET plan = 'free' WHERE id = ?", FL);
const ORG = Number(insert("organizations", { name: "Prairie Regional System", billing_owner_user_id: owner.id, plan: "enterprise" }));
for (const l of [A, B, C, D]) sql("UPDATE labs SET organization_id = ? WHERE id = ?", ORG, l);
sql("UPDATE labs SET plan = NULL WHERE id = ?", D); // covered by the system's plan only
insert("organization_members", { organization_id: ORG, user_id: leader.id, org_role: "org_admin", status: "active" });
for (const l of [A, B]) sql("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 0, datetime('now'), datetime('now'), datetime('now'))", l, tech.id);
const finding = (lab, accreditor, status, due, extra = {}) => insert("findings", { lab_id: lab, user_id: owner.id, accreditor, status, due_date: due, ...extra });
const fCms = finding(A, "CMS", "drafting", day(-5), { finding_number: "D5411", standard_ref: "42 CFR 493.1253" });
finding(A, "CAP", "open", day(12), { finding_number: "7", standard_ref: "CHM.13450" }); finding(A, "COLA", "open", day(-4), { finding_number: "QC 10" });
finding(B, "TJC", "submitted", day(40), { finding_number: "QSA.02.01" }); finding(B, "Other", "open", null, { source_type: "internal_nce" }); finding(B, "CAP", "closed", day(-40)); finding(C, "CAP", "closed", day(-60));
const doc = (lab, status, due) => insert("policy_documents", { lab_id: lab, title: "Made-up procedure", status, owner_user_id: owner.id, next_review_date: due });
for (const n of [-30, -3, 15, 200]) doc(A, "approved", day(n)); doc(A, "in_review", null); doc(B, "approved", day(300)); doc(B, "in_review", null); doc(C, "approved", day(400));
const map = (lab, studies) => {
  const m = insert("veritamap_maps", { user_id: owner.id, lab_id: lab, name: "Main" }), i = insert("veritamap_instruments", { map_id: m, instrument_name: "Alphamatic 500", nickname: "Ann", role: "Primary", category: "Chemistry" });
  for (const [a, n] of studies) {
    insert("veritamap_instrument_tests", { map_id: m, instrument_id: i, analyte: a, specialty: "General Chemistry", complexity: "MODERATE", active: 1 });
    if (n != null) insert("studies", { user_id: owner.id, lab_id: lab, test_name: a, instrument: "Alphamatic 500 Ann", study_type: "cal_ver", status: "pass", lifecycle_state: "finalized", date: day(n), finalized_at: day(n), data_points: "[]", instruments: "[]" });
  }
};
map(A, [["Sodium", -260], ["Potassium", -20], ["Chloride", null]]); map(B, [["Sodium", -20], ["Potassium", null]]); map(C, [["Sodium", -20]]);
insert("lab_certificates", { user_id: owner.id, lab_id: C, cert_type: "clia", cert_name: "CLIA", expiration_date: day(400), is_active: 1 });
const G = Number(insert("rollup_groups", { name: "North region", kind: "region", organization_id: ORG, created_by_user_id: leader.id })); insert("rollup_group_labs", { group_id: G, lab_id: A }); insert("rollup_group_labs", { group_id: G, lab_id: C });

const browser = await chromium.launch();
const openAs = async (who, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1500, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check("no page error", false, String(e)));
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, who.token]);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); if (l) localStorage.setItem("veritas_active_lab_id", String(l)); }, [who.token, me, opts.lab ?? A]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const tid = (id) => `[data-testid="${id}"]`;

// U1
let page = await openAs(leader, `/labs/${A}/readiness?org=${ORG}`);
await page.waitForSelector(tid("open-findings-link"), { timeout: 20000 });
const heads = await page.locator("table thead th").allInnerTexts();
check("U1. the heatmap has Findings, Documents and Verification studies columns", ["Findings", "Documents", "Verification studies"].every((h) => heads.some((x) => x.trim() === h)), heads.join("|"));
const wide = await page.locator("table").evaluate((t) => t.parentElement.scrollWidth - t.parentElement.clientWidth);
check("U1. all eight modules show without scrolling the heatmap sideways on a desktop", heads.length === 10 && wide <= 1, `${heads.length} columns, ${wide}px over`);
const rowText = async (name) => (await page.locator("table tbody tr", { hasText: name }).innerText()).replace(/\s+/g, " ");
check("U1. four labs, for an admin with no membership and a free account", (await page.locator("table tbody tr").count()) === 4);
check("U1. the title names the system", await page.getByText("Network readiness: Prairie Regional System").isVisible());
// U2
const dune = await rowText("Dune Harbor Lab");
check("U2. the empty lab reads Not set up in all 8 cells and as its status", (dune.match(/Not set up/g) || []).length === 9, dune);
const tiles = (await page.locator(tid("rollup-not-set-up")).innerText()).replace(/\s+/g, " ");
check("U2. it is counted apart, not ready: 1 not set up", /^1 not set up$/.test(tiles), tiles);
const ready = (await page.locator("text=sites ready").locator("..").innerText()).replace(/\s+/g, " ");
check("U2. sites ready is 1/4 (Cedar Hill)", /^1\/4/.test(ready), ready);
check("U2. Cedar Hill: OK where it is set up, Not set up where it isn't", /On track/.test(await rowText("Cedar Hill Lab")) && /OK/.test(await rowText("Cedar Hill Lab")) && /Not set up/.test(await rowText("Cedar Hill Lab")), await rowText("Cedar Hill Lab"));
await page.screenshot({ path: `${OUT}/sysr-1-rollup-light.png`, fullPage: true });
// U3
const btn = (await page.locator(tid("open-findings-link")).innerText()).trim();
check("U3. the button counts the open findings (5)", btn === "Open findings (5)", btn);
await page.click(tid("open-findings-link"));
await page.waitForSelector(tid("system-findings-rows"));
const rows = async () => (await page.locator(`${tid("system-findings-rows")} tr`).allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
let r = await rows();
check("U3. five open findings, none closed, past due first", r.length === 5 && /^Alder Creek Lab CMS .*past due Drafting$/.test(r[0]) && !r.some((t) => /Closed|Accepted/.test(t)), r.join(" || "));
check("U3. the soft clock reads past target, the internal event has no deadline and no accreditor", r.some((t) => /COLA .*past target/.test(t)) && r.some((t) => /Internal event \(NCE\) .*No deadline/.test(t)), r.join(" || "));
check("U3. the summary line", /5 open in 2 labs, 1 past due/.test(await page.locator(tid("system-findings-summary")).innerText()), await page.locator(tid("system-findings-summary")).innerText());
await page.screenshot({ path: `${OUT}/sysr-2-findings-light.png`, fullPage: true });
// U4
await page.selectOption(tid("system-findings-group"), String(G)); r = await rows();
check("U4. North region: Alder Creek's three only", r.length === 3 && r.every((t) => t.startsWith("Alder Creek Lab")), r.join(" || "));
await page.selectOption(tid("system-findings-accreditor"), "CAP"); r = await rows();
check("U4. and CAP: one", r.length === 1 && /CAP/.test(r[0]), r.join(" || "));
await page.selectOption(tid("system-findings-accreditor"), ""); await page.selectOption(tid("system-findings-group"), "none"); r = await rows();
check("U4. Not in a group: Birch Point's two", r.length === 2 && r.every((t) => t.startsWith("Birch Point Lab")), r.join(" || "));
await page.click(tid("system-findings-back"));
await page.waitForSelector(tid("rollup-group-filter"));
check("U4. back to the same system's roll-up", page.url().endsWith(`/labs/${A}/readiness?org=${ORG}`), page.url());
await page.selectOption(tid("rollup-group-filter"), String(G));
await page.waitForSelector("text=Group readiness: North region");
check("U4. the button follows the group (3)", (await page.locator(tid("open-findings-link")).innerText()).trim() === "Open findings (3)");
await page.click(tid("open-findings-link"));
await page.waitForSelector(tid("system-findings-rows")); r = await rows();
check("U4. a group picked on the roll-up carries over", r.length === 3 && (await page.locator(tid("system-findings-group")).inputValue()) === String(G), r.join(" || "));
// U5
await page.locator(`${tid("system-findings-rows")} tr a`).first().click();
await page.waitForURL(`**/labs/${A}/veritaresponse/${fCms}`);
await page.getByText("D5411").first().waitFor({ timeout: 15000 }).catch(() => {});
const shows = (await page.locator("main, body").first().innerText()).includes("CMS") || (await page.locator("input").evaluateAll((els) => els.some((e) => e.value === "D5411")));
check("U5. a row opens that finding in its own lab", shows && page.url().endsWith(`/labs/${A}/veritaresponse/${fCms}`), page.url());
// U6
await page.goto(`${BASE}/labs/${D}/readiness`, { waitUntil: "networkidle" });
await page.waitForSelector(tid("readiness-banner-counts"));
const dBanner = (await page.locator(tid("readiness-banner-counts")).locator("..").innerText()).replace(/\s+/g, " ");
check("U6. the empty lab's banner reads Not set up, never Inspection-ready", /^Not set up: Dune Harbor Lab/.test(dBanner) && /nothing to call ready/.test(dBanner), dBanner);
await page.goto(`${BASE}/labs/${A}/readiness`, { waitUntil: "networkidle" });
await page.waitForSelector(tid("readiness-module-findings"));
const card = async (k) => (await page.locator(tid(`readiness-module-${k}`)).innerText()).replace(/\s+/g, " ");
check("U6. findings card", /Action needed 3 open: 1 past due, 1 due within 30 days, 1 past target/.test(await card("findings")), await card("findings"));
check("U6. documents card", /Action needed 2 overdue for review, 1 due within 30 days, 1 waiting for approval/.test(await card("documents")), await card("documents"));
check("U6. verification studies card", /Action needed 1 overdue, 1 missing/.test(await card("verification")), await card("verification"));
check("U6. a module with nothing: Not set up", /Not set up No instruments tracked/.test(await card("equipment")), await card("equipment"));
await page.close();
// U7
page = await openAs(tech, `/labs/${A}/readiness`);
await page.waitForSelector("table tbody tr", { timeout: 20000 });
const tNames = (await page.locator("table tbody tr td:first-child").allInnerTexts()).sort().join("|");
check("U7. the member's roll-up is their own two labs", tNames === "Alder Creek Lab|Birch Point Lab", tNames);
check("U7. no Open findings button", (await page.locator(tid("open-findings-link")).count()) === 0);
await page.goto(`${BASE}/labs/${A}/readiness/findings`, { waitUntil: "networkidle" });
await page.waitForSelector(tid("system-findings-refused"));
check("U7. the address refuses them, with no rows", /owner or an admin of a system/.test(await page.locator(tid("system-findings-refused")).innerText()) && (await page.locator(tid("system-findings-rows")).count()) === 0);
await page.close();
// U8
page = await openAs(free, `/labs/${FL}/readiness`, { lab: FL });
check("U8. a free account outside a system reads the subscription notice", await page.getByText("Readiness requires a subscription").isVisible());
await page.close();
// U9
page = await openAs(leader, `/labs/${A}/readiness?org=${ORG}`, { colorScheme: "dark" });
await page.waitForSelector(tid("open-findings-link"));
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
check("U9. dark mode: the page is dark", Number(bg.match(/\d+/)[0]) < 80, bg);
await page.screenshot({ path: `${OUT}/sysr-1-rollup-dark.png`, fullPage: true });
await page.click(tid("open-findings-link")); await page.waitForSelector(tid("system-findings-rows"));
await page.screenshot({ path: `${OUT}/sysr-2-findings-dark.png`, fullPage: true });
await page.close();
for (const [name, path, wait] of [["roll-up", `/labs/${A}/readiness?org=${ORG}`, "open-findings-link"], ["findings list", `/labs/${A}/readiness/findings?org=${ORG}`, "system-findings-rows"]]) {
  page = await openAs(leader, path, { viewport: { width: 390, height: 844 } });
  await page.waitForSelector(tid(wait));
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`U9. phone width: the ${name} doesn't scroll the page sideways`, sideways <= 1, String(sideways));
  await page.screenshot({ path: `${OUT}/sysr-3-phone-${name.replace(/ /g, "-")}.png`, fullPage: false });
  await page.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
