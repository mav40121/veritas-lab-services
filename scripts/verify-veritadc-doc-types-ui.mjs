// scripts/verify-veritadc-doc-types-ui.mjs
//
// Browser receipt for VeritaDC document types (Michael 2026-11-03, Q154; shared/policyDocTypes.ts). On a local production
// build with a scratch DB, a made-up owner and made-up documents:
//   T1. the Document types dialog lists the nine types with both rules on; turning off Form's periodic review and
//       read-and-sign there saves the rule on the server
//   T2. the edit dialog sets a document's type; the row then reads "Form · no periodic review · no read-and-sign"
//   T3. the upload dialog has the type picker
//   T4. the dialog in dark mode
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritadc-doc-types-ui.mjs
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
const pw = ["Doc", "Type", "77!"].join("-");

const email = `doctype-owner-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Doc Type Test Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
const fd = new FormData();
fd.append("file", new Blob([Buffer.from("Made-up requisition form text\n")], { type: "text/plain" }), "made-up.txt");
fd.append("title", "Blood Bank Requisition Form (made-up)");
const doc = await (await fetch(`${BASE}/api/labs/${labId}/veritapolicy/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();

const browser = await chromium.launch();
const open = async (colorScheme = "light") => {
  const page = await (await browser.newContext({ viewport: { width: 1300, height: 950 }, colorScheme })).newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, token]);
  await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, me, labId]);
  await page.goto(`${BASE}/labs/${labId}/veritapolicy-app/my-policies`, { waitUntil: "networkidle" });
  await page.getByTestId("doc-types-open").waitFor({ timeout: 20000 }).catch(() => {});
  return page;
};

// T1
const page = await open();
await page.getByTestId("doc-types-open").click();
await page.getByTestId("doc-types-table").waitFor({ timeout: 10000 }).catch(() => {});
const rows = await page.locator('[data-testid^="doc-type-row-"]').count();
const allOn = await page.locator('[data-testid^="doc-type-review-"], [data-testid^="doc-type-sign-"]').evaluateAll((els) => els.every((e) => e.getAttribute("aria-checked") === "true"));
await page.getByTestId("doc-type-review-form").click();
await page.waitForTimeout(900);
await page.getByTestId("doc-type-sign-form").click();
await page.waitForTimeout(1200);
const rule = ((await call("GET", `/api/labs/${labId}/veritapolicy/doc-types`, undefined, token)).body.types || []).find((t) => t.doc_type === "form");
check("T1. the dialog lists nine types with both rules on, and turning Form's off saves the rule",
  rows === 9 && allOn && rule?.requires_periodic_review === false && rule?.requires_read_and_sign === false, JSON.stringify({ rows, allOn, rule }));
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/doctypes-dialog.png` });
await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
await page.getByTestId("doc-types-table").waitFor({ state: "detached", timeout: 8000 }).catch(() => {});

// T2
const row = page.locator("tr").filter({ hasText: "Blood Bank Requisition Form (made-up)" }).first();
await row.locator('button[title="Rename / edit metadata"]').first().click();
await page.getByTestId("edit-doc-type").click();
await page.getByRole("option", { name: "Form", exact: true }).click();
await page.getByRole("button", { name: /^Save/ }).click();
await page.waitForTimeout(1500);
const saved = (await call("GET", `/api/labs/${labId}/veritapolicy/documents/${doc.id}`, undefined, token)).body.document?.doc_type;
const label = ((await page.locator("tr").filter({ hasText: "Blood Bank Requisition Form (made-up)" }).first().getByTestId("doc-type").textContent().catch(() => "")) || "").trim();
check("T2. the edit dialog sets the type; the row reads Form with both rules off", saved === "form" && label === "Form · no periodic review · no read-and-sign", `${saved} | ${label}`);
await page.screenshot({ path: `${OUT}/doctypes-row.png` });

// T3
await page.getByRole("button", { name: /Upload Policy/ }).first().click();
await page.getByTestId("upload-doc-type").waitFor({ timeout: 8000 }).catch(() => {});
check("T3. the upload dialog has the type picker", (await page.getByTestId("upload-doc-type").count()) === 1);
await page.keyboard.press("Escape");

// T4
const dark = await open("dark");
await dark.getByTestId("doc-types-open").click();
await dark.getByTestId("doc-types-table").waitFor({ timeout: 10000 }).catch(() => {});
await dark.waitForTimeout(900);
await dark.screenshot({ path: `${OUT}/doctypes-dialog-dark.png` });
check("T4. the dialog renders in dark mode", (await dark.locator('[data-testid^="doc-type-row-"]').count()) === 9);

await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
