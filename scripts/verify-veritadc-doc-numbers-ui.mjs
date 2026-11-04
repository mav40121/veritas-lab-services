// scripts/verify-veritadc-doc-numbers-ui.mjs
//
// Browser receipt for VeritaDC document numbers and major.minor versions (Michael 2026-11-03, Q154; shared/policyVersion.ts).
// On a local production build with a scratch DB, a made-up owner and made-up documents:
//   N1. the documents page shows the lab's number before the title and the version as major.minor (v2.1)
//   N2. searching by the number finds the document
//   N3. the edit dialog shows the number; changing it in the dialog saves it on the server
//   N4. the upload dialog has the number field
//   N5. the document view's version history reads 2.1, 2.0, 1.1, 1.0
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritadc-doc-numbers-ui.mjs
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
const pw = ["Doc", "Number", "77!"].join("-");

const email = `docnum-owner-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Doc Number Test Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
const upload = async (fields, p = `/api/labs/${labId}/veritapolicy/documents`) => {
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(`Made-up procedure text ${Math.random()}\n`)], { type: "text/plain" }), "made-up.txt");
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await fetch(BASE + p, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
  return r.json();
};
const crit = await upload({ title: "Laboratory Critical Results Policy (made-up)", doc_number: "HH122" });
const V = `/api/labs/${labId}/veritapolicy/documents/${crit.id}/versions`;
await upload({}, V); // 1.1
await upload({ is_major_revision: "true" }, V); // 2.0
await upload({}, V); // 2.1
await upload({ title: "Corrected Report Policy (made-up)", doc_number: "AH 125" });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
await page.goto(`${BASE}/`);
const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, token]);
await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, me, labId]);
await page.goto(`${BASE}/labs/${labId}/veritapolicy-app/my-policies`, { waitUntil: "networkidle" });
await page.getByTestId("doc-number").first().waitFor({ timeout: 20000 }).catch(() => {});

// N1
const row = page.locator("tr").filter({ hasText: "Laboratory Critical Results Policy (made-up)" }).first();
const rowText = (await row.textContent().catch(() => "")) || "";
check("N1. the row shows the number before the title and the version as v2.1", /HH122\s*Laboratory Critical Results Policy/.test(rowText) && rowText.includes("v2.1"), rowText.replace(/\s+/g, " ").slice(0, 160));
await page.screenshot({ path: `${OUT}/docnum-page.png` });

// N2
await page.getByPlaceholder(/Search policies by title, number/).fill("AH 125");
await page.waitForTimeout(600);
const visible = await page.locator("tr").filter({ hasText: "(made-up)" }).allTextContents();
check("N2. searching by number shows that document only", visible.length === 1 && visible[0].includes("Corrected Report Policy"), JSON.stringify(visible.map((t) => t.slice(0, 50))));
await page.getByPlaceholder(/Search policies by title, number/).fill("");
await page.waitForTimeout(400);

// N3
await row.locator('button[title="Rename / edit metadata"]').first().click();
await page.getByTestId("edit-doc-number").waitFor({ timeout: 8000 }).catch(() => {});
const shown = await page.getByTestId("edit-doc-number").inputValue().catch(() => "");
await page.getByTestId("edit-doc-number").fill("HH122-A");
await page.getByRole("button", { name: /^Save/ }).click();
await page.waitForTimeout(1500);
const saved = (await call("GET", `/api/labs/${labId}/veritapolicy/documents/${crit.id}`, undefined, token)).body.document?.doc_number;
check("N3. the edit dialog shows the number and saving a new one updates the server", shown === "HH122" && saved === "HH122-A", `${shown} -> ${saved}`);

// N4
await page.getByRole("button", { name: /Upload Policy/ }).first().click();
await page.getByTestId("upload-doc-number").waitFor({ timeout: 8000 }).catch(() => {});
check("N4. the upload dialog has the document number field", (await page.getByTestId("upload-doc-number").count()) === 1);
await page.screenshot({ path: `${OUT}/docnum-upload.png` });
await page.keyboard.press("Escape");

// N5
const det = (await call("GET", `/api/labs/${labId}/veritapolicy/documents/${crit.id}`, undefined, token)).body;
await page.locator("tr").filter({ hasText: "Laboratory Critical Results Policy (made-up)" }).first().getByRole("button", { name: /View/ }).first().click();
await page.getByText(/Version history/).waitFor({ timeout: 10000 }).catch(() => {});
const hist = (await page.getByText(/Version history/).locator("xpath=..").locator("..").textContent().catch(() => "")) || "";
check("N5. the version history reads 2.1, 2.0, 1.1, 1.0", ["v2.1", "v2.0", "v1.1", "v1.0"].every((v) => hist.includes(v)) && det.versions.map((v) => v.version_label).join(" ") === "2.1 2.0 1.1 1.0",
  hist.replace(/\s+/g, " ").slice(0, 160));
await page.screenshot({ path: `${OUT}/docnum-history.png` });

await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
