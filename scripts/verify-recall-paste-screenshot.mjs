// scripts/verify-recall-paste-screenshot.mjs
//
// Receipt for REQ-054 (Milford, 2026-10-13: "Brenda would like to be able to paste in a screenshot"): a recall case's
// Files card takes a pasted screenshot. LOCAL server + scratch DB only (the case and the image are local test data).
//   1. the paste box shows on an open case, next to Add file
//   2. pasting a PNG uploads it: the file list gains "Screenshot YYYY-MM-DD HHMM.png" with the kind chosen in the dropdown
//   3. the stored file is the pasted image (same byte count, image/png)
//   4. pasting text (no image) uploads nothing and says how to copy a screenshot
//   5. light, dark and 390px render; no horizontal page scroll
// Run: PW_BASE=http://localhost:5166 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-recall-paste-screenshot.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return await r.json(); } catch { return {}; } };

const email = `recall-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Recall Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Recall Paste Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const base = `/api/labs/${labId}/veritastock/recalls`;
const created = await call("POST", base, { notice_type: "recall", vendor: "Test Vendor", product: "Test Product", notice_date: "2026-10-13" }, owner.token);
const caseId = created.id ?? created.case?.id;
check("0. scratch recall case created", !!caseId, JSON.stringify(created).slice(0, 160));

// A real 2x2 PNG (red), built in the page as the "screenshot".
const browser = await chromium.launch();
let first = true;
for (const [scheme, width] of [["light", 1400], ["dark", 1400], ["light", 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, owner.token]);
  await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [owner.token, me, labId]);
  await page.goto(`${BASE}/labs/${labId}/veritastock/recalls?case=${caseId}`, { waitUntil: "networkidle" }); await page.waitForTimeout(1200);
  const tag = `[${scheme} ${width}px]`;
  const zone = page.getByTestId("recall-paste-zone");
  check(`1. ${tag} paste box shows on the open case`, (await zone.count()) === 1 && (await zone.isVisible()), (await zone.count()) ? await zone.innerText() : "missing");
  check(`5. ${tag} no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  if (first) {
    first = false;
    // Kind dropdown -> Other, as Brenda would for a screenshot.
    await zone.locator("xpath=preceding-sibling::button[1]").click().catch(() => {});
    await page.getByRole("option", { name: "Other" }).click().catch(() => {});
    await zone.click();
    const pngSize = await page.evaluate(async () => {
      const c = document.createElement("canvas"); c.width = 2; c.height = 2;
      const g = c.getContext("2d"); g.fillStyle = "#c00"; g.fillRect(0, 0, 2, 2);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const dt = new DataTransfer(); dt.items.add(new File([blob], "image.png", { type: "image/png" }));
      document.querySelector('[data-testid="recall-paste-zone"]').dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      return blob.size;
    });
    await page.waitForTimeout(2000);
    // Rows of the Files card only (the case History also logs "File added: Screenshot ...").
    const filesCard = page.getByText("Files", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
    const rows = await filesCard.locator("li").filter({ hasText: /Screenshot \d{4}-\d{2}-\d{2} \d{4}\.png/ }).allInnerTexts();
    check(`2. ${tag} pasted image uploads as "Screenshot YYYY-MM-DD HHMM.png" (kind Other)`, rows.length === 1 && /Other/.test(rows[0]), rows.join(" | ").replace(/\s+/g, " "));
    const detail = await call("GET", `${base}/${caseId}`, undefined, owner.token);
    const docs = (detail.documents || detail.case?.documents || []);
    const d = docs.find((x) => /^Screenshot .*\.png$/.test(x.original_filename));
    check(`3. ${tag} stored file is the pasted PNG`, !!d && d.mime_type === "image/png" && d.file_size === pngSize && d.kind === "other", d ? `${d.original_filename} ${d.mime_type} ${d.file_size} bytes (pasted ${pngSize}), kind ${d.kind}` : JSON.stringify(docs).slice(0, 200));
    // Text on the clipboard: nothing uploads, a hint shows.
    const before = docs.length;
    await zone.click();
    await page.evaluate(() => {
      const dt = new DataTransfer(); dt.setData("text/plain", "not an image");
      document.querySelector('[data-testid="recall-paste-zone"]').dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(1000);
    const hint = await page.getByText("No screenshot to paste").count();
    const after = ((await call("GET", `${base}/${caseId}`, undefined, owner.token)).documents || []).length;
    check(`4. ${tag} pasting text uploads nothing and shows how to copy a screenshot`, hint >= 1 && after === before, `hint ${hint}, files ${before} -> ${after}`);
    await page.waitForTimeout(4000); // let the toast clear before the receipt shot
  }
  const card = page.getByText("Files", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${OUT}/recall_paste_${scheme}_${width}.png` });
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
