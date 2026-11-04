// scripts/verify-veritadc-submanuals-ui.mjs
//
// Browser receipt for VeritaDC sub-manuals (Michael 2026-11-03, Q151 = 1; shared/manualTree.ts). On a local production
// build with a scratch DB, a made-up owner and made-up documents:
//   U1. the documents page groups documents by manual in tree order; a sub-manual's card names its parents first
//       ("Heywood Hospital › Heywood Microbiology › HH Abbott ID NOW") and is indented by its depth
//   U2. the Manuals dialog shows the whole tree, indented, including manuals with no documents
//   U3. moving a manual from the dialog works (the server records the new parent) and a manual's own sub-manuals are
//       not offered as places to move it
//   U4. "Sub-manual" on a row opens New manual with that manual already chosen as the parent; creating it nests it
//   U5. the dialog in dark mode
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritadc-submanuals-ui.mjs
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
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };
const pw = ["Sub", "Manual", "77!"].join("-");

const email = `submanual-owner-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const userId = Number(owner.body.user?.id ?? owner.body.id);
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Sub-manual Test Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
const M = `/api/labs/${labId}/veritapolicy/manuals`;
await call("GET", M, undefined, token); // seeds the default manuals
const mk = async (name, parentId) => (await call("POST", M, { name, ...(parentId ? { parentId } : {}) }, token)).body.id;
const hh = await mk("Heywood Hospital");
const micro = await mk("Heywood Microbiology", hh);
const idnow = await mk("HH Abbott ID NOW", micro);
const athol = await mk("Athol Hospital");
const equip = await mk("Equipment", athol);
const doc = (manualId, title) => sql(
  "INSERT INTO policy_documents (lab_id, manual_id, title, status, owner_user_id, review_interval_months, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, 24, datetime('now'), datetime('now'))",
  labId, manualId, title, userId);
doc(idnow, "ID NOW COVID-19 Testing (made-up)");
doc(micro, "Gram Stain Procedure (made-up)");
doc(hh, "Laboratory Critical Results Policy (made-up)");
doc(equip, "Centrifuge Maintenance (made-up)");

const browser = await chromium.launch();
const open = async (colorScheme = "light") => {
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 950 }, colorScheme })).newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, token]);
  await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, me, labId]);
  await page.goto(`${BASE}/labs/${labId}/veritapolicy-app/my-policies`, { waitUntil: "networkidle" });
  await page.getByTestId("manual-group").first().waitFor({ timeout: 20000 }).catch(() => {});
  return page;
};

// U1
const page = await open();
const groups = await page.getByTestId("manual-group").evaluateAll((els) => els.map((e) => ({
  title: (e.querySelector("h3,[class*='CardTitle'],div")?.textContent || e.textContent || "").trim().slice(0, 120),
  indent: getComputedStyle(e).marginLeft,
})));
const g = (needle) => groups.find((x) => x.title.includes(needle));
check("U1. the ID NOW card names its parents first and is indented two levels",
  !!g("Heywood Hospital › Heywood Microbiology › HH Abbott ID NOW") && g("HH Abbott ID NOW").indent === "32px", JSON.stringify(g("HH Abbott ID NOW")));
const order = groups.map((x) => x.title);
const at = (path) => order.findIndex((t) => t.startsWith(`${path}(`)); // the title is the path, then "(N policies)"
const [i0, i1, i2] = ["Heywood Hospital", "Heywood Hospital › Heywood Microbiology", "Heywood Hospital › Heywood Microbiology › HH Abbott ID NOW"].map(at);
check("U1. cards come in tree order (parent, then its sub-manuals)", i0 >= 0 && i0 < i1 && i1 < i2, `${i0} ${i1} ${i2} :: ${order.map((t) => t.slice(0, 50)).join(" | ")}`);
check("U1. a sub-manual of another department is told apart by its path", !!g("Athol Hospital › Equipment") && g("Athol Hospital › Equipment").indent === "16px", JSON.stringify(g("Athol Hospital › Equipment")));
const up = await page.getByRole("button", { name: /^Upload/ }).first().boundingBox();
check("U1. the header's buttons fit on the page (Upload is not cut off)", !!up && up.x + up.width <= 1300, JSON.stringify(up));
await page.screenshot({ path: `${OUT}/submanuals-page.png`, fullPage: false });

// U2
await page.getByTestId("manuals-open").click();
const rows = page.getByTestId("manuals-row");
await rows.first().waitFor({ timeout: 10000 }).catch(() => {});
const rowInfo = await rows.evaluateAll((els) => els.map((e) => ({ name: e.querySelector("span")?.textContent?.trim(), pad: e.style.paddingLeft })));
const r = (n) => rowInfo.find((x) => x.name === n);
check("U2. the Manuals dialog shows the whole tree, indented (empty manuals included)",
  rowInfo.length >= 15 && r("HH Abbott ID NOW")?.pad === "44px" && r("Heywood Microbiology")?.pad === "26px" && r("Chemistry")?.pad === "8px",
  JSON.stringify({ n: rowInfo.length, idnow: r("HH Abbott ID NOW"), micro: r("Heywood Microbiology") }));
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/submanuals-dialog.png` });

// U3: options for Heywood Microbiology exclude its own sub-manual; then move Equipment under Heywood Microbiology
await page.getByTestId(`manual-parent-${micro}`).click();
const microOptions = await page.getByRole("option").allTextContents();
check("U3. a manual's own sub-manuals are not offered as places to move it",
  !microOptions.some((t) => t.includes("HH Abbott ID NOW")) && microOptions.some((t) => t === "Inside Athol Hospital"), JSON.stringify(microOptions.slice(0, 6)));
await page.keyboard.press("Escape");
await page.getByTestId(`manual-parent-${equip}`).click();
await page.getByRole("option", { name: "Inside Heywood Hospital › Heywood Microbiology", exact: true }).click();
await page.waitForTimeout(1500);
const after = (await call("GET", M, undefined, token)).body.manuals;
const eq = after.find((m) => m.id === equip);
check("U3. moving Equipment in the dialog changes its parent on the server", eq?.parent_id === micro && eq?.path === "Heywood Hospital › Heywood Microbiology › Equipment", eq?.path);
await page.screenshot({ path: `${OUT}/submanuals-moved.png` });

// U4
const hhRow = page.getByTestId("manuals-row").filter({ hasText: /^Heywood Hospital/ }).first();
await hhRow.getByRole("button", { name: /Sub-manual/ }).click();
await page.getByTestId("new-manual-parent").waitFor({ timeout: 5000 });
const preset = (await page.getByTestId("new-manual-parent").textContent())?.trim();
check("U4. Sub-manual opens New manual with that manual already chosen", preset === "Heywood Hospital", preset);
await page.getByPlaceholder("e.g., Molecular").fill("Heywood Chemistry");
await page.getByRole("button", { name: "Create", exact: true }).click();
await page.waitForTimeout(1500);
const chem = (await call("GET", M, undefined, token)).body.manuals.find((m) => m.name === "Heywood Chemistry");
check("U4. the new manual is created inside Heywood Hospital", chem?.parent_id === hh && chem?.path === "Heywood Hospital › Heywood Chemistry", chem?.path);
await page.screenshot({ path: `${OUT}/submanuals-created.png` });

// U5
const dark = await open("dark");
await dark.getByTestId("manuals-open").click();
await dark.getByTestId("manuals-row").first().waitFor({ timeout: 10000 }).catch(() => {});
await dark.waitForTimeout(800); // let the dialog finish fading in
await dark.screenshot({ path: `${OUT}/submanuals-dialog-dark.png` });
check("U5. the dialog renders in dark mode", (await dark.getByTestId("manuals-row").count()) >= 15);

// U6: the compliance dashboard's per-manual table follows the tree, indented, sub-manuals named by their own name
const comp = await open();
await comp.goto(`${BASE}/labs/${labId}/veritapolicy-app/compliance`, { waitUntil: "networkidle" });
await comp.getByTestId("compliance-manual-cell").first().waitFor({ timeout: 20000 }).catch(() => {});
const cells = await comp.getByTestId("compliance-manual-cell").evaluateAll((els) => els.map((e) => ({ text: e.textContent.trim(), pad: e.style.paddingLeft, title: e.title })));
const cell = (t) => cells.findIndex((c) => c.text === t);
check("U6. the compliance table lists manuals in tree order, sub-manuals indented with the full path on hover",
  cell("Heywood Hospital") >= 0 && cell("Heywood Hospital") < cell("Heywood Microbiology") && cell("Heywood Microbiology") < cell("HH Abbott ID NOW") &&
    cells[cell("HH Abbott ID NOW")]?.pad === "32px" && cells[cell("HH Abbott ID NOW")]?.title === "Heywood Hospital › Heywood Microbiology › HH Abbott ID NOW",
  JSON.stringify(cells.slice(0, 6)));
await comp.screenshot({ path: `${OUT}/submanuals-compliance.png`, fullPage: true });

// U7: the inspector's read-only view groups approved documents by full path, in tree order
sql("UPDATE policy_documents SET status = 'approved' WHERE lab_id = ?", labId);
const link = await call("POST", `/api/labs/${labId}/veritapolicy/surveyor-links`, { label: "Made-up inspection", expiresInDays: 1 }, token);
const insp = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
await insp.goto(`${BASE}/surveyor/${link.body.token}`, { waitUntil: "networkidle" });
await insp.getByText("HH Abbott ID NOW").first().waitFor({ timeout: 20000 }).catch(() => {});
const inspText = await insp.evaluate(() => document.body.innerText);
const ia = (t) => inspText.indexOf(t);
check("U7. the inspector view groups documents under full paths in tree order",
  link.status === 201 && ia("Heywood Hospital › Heywood Microbiology › HH Abbott ID NOW") > ia("Heywood Hospital › Heywood Microbiology") && ia("Heywood Hospital › Heywood Microbiology") > 0,
  `${link.status} ${ia("Heywood Hospital › Heywood Microbiology")} ${ia("Heywood Hospital › Heywood Microbiology › HH Abbott ID NOW")}`);
await insp.screenshot({ path: `${OUT}/submanuals-inspector.png`, fullPage: true });

await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
