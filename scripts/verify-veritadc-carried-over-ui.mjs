// scripts/verify-veritadc-carried-over-ui.mjs
//
// Browser receipt for documents carried over from a prior system (Step E, server/veritadcBulkLoad.ts). On a local production
// build with the CSP enforced, a scratch DB, a made-up owner and made-up documents loaded through the real admin route:
//   C1. the documents list: approved, the real version, "effective <date> · carried over", the overdue one reads overdue
//   C2. the document view: the notice says carried over with original dates and that they signed in the prior system, not in
//       VeritaAssure; real dates and counts show; no VeritaAssure signature history appears; no em dash
//   C3. Open signature face page shows the page in a sandboxed frame, its image loads under the CSP, and a script in it doesn't run
//   C4. Download original downloads the file under its own name
//   C5. the audit trail says carried over and who ran the load
//   C6. a document with nothing on the face page says None listed; one with no review date says so
//   C7. an ordinary upload shows no carried-over panel or chip
//   C8. the inspector link shows the same history and face page
//   C9. dark mode and phone width: the panel reads and doesn't overflow
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritadc-carried-over-ui.mjs
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
const pw = ["Carried", "Over", "77!"].join("-");
const stamp = Date.now();
const iso = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNk+M+ABzAxjFYAAJ8pAxH0T4cKAAAAAElFTkSuQmCC";
const FACE = (num, title, sigs = true) => `<html><head><title>x</title><style>body{font-family:Arial;color:#111}h1{font-size:18px}td{border:1px solid #999;padding:3px}</style></head>
<body><h1>${num} ${title}</h1><p>Made-up signature face page.</p>
${sigs ? `<table><tr><td>Approval</td><td>Made-Up Director</td><td>01/20/2026</td><td>2.1</td></tr></table><img id="sig" src="data:image/png;base64,${PNG}" alt="signature">` : "<p>No signatures listed.</p>"}
<script>document.title = "SCRIPT RAN"; window.parent.document.title = "SCRIPT RAN";</script></body></html>`;

const email = `carried-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const labName = "Made Up Hospital";
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?", labId);
const ownerId = sql("SELECT owner_user_id AS o FROM labs WHERE id = ?", labId).o;
const text = (s) => Buffer.from(`Made-up procedure text for ${s}.\nThis document is invented for a test.\n`);
const load = async (over, faceSigs = true, original = null) => {
  const meta = {
    labId, expectedLabName: labName, ownerUserId: ownerId, batch: "made-up-ui", loadedBy: "Veritas Lab Services", sourceSystem: "OldSystem",
    sourceStatus: "approved and current", version: "2.1", effectiveDate: "2024-03-15", lastApprovalOrReview: "2026-01-20", nextReviewDue: iso(90),
    reviewIntervalMonths: 12, remindersStartOn: iso(30), author: "Made-Up Author", approvalRows: 2, reviewRows: 1, versionCount: 3,
    manualPath: [labName, "Chemistry", "Analyzer A"], alsoFiledIn: [`${labName} / General`], titleAsExported: `${over.title} (2)`, ...over,
  };
  const fd = new FormData();
  fd.append("meta", JSON.stringify(meta));
  fd.append("document", new Blob([text(over.docNumber)]), "made-up.txt");
  fd.append("face_page", new Blob([FACE(over.docNumber, over.title, faceSigs)]), "face-page.html");
  if (original) fd.append("original", new Blob([original]), meta.originalFilename);
  const r = await fetch(`${BASE}/api/admin/veritadc/bulk-load/document`, { method: "POST", headers: { "x-admin-secret": ADMIN }, body: fd });
  const j = await r.json();
  if (r.status !== 201) throw new Error(`load failed ${r.status} ${JSON.stringify(j)}`);
  return j.documentId;
};
const mainDoc = await load({ docNumber: "MU 101", title: "Made-up Chemistry Procedure", convertedFrom: "doc", originalFilename: "MU 101_Made-up Chemistry Procedure.doc" }, true, Buffer.from("made-up legacy bytes"));
const pastDue = await load({ docNumber: "MU 102", title: "Made-up Transfusion Policy", version: "1.0", lastApprovalOrReview: iso(-547), nextReviewDue: iso(-182), manualPath: [labName, "Blood Bank"], titleAsExported: "Made-up Transfusion Policy" });
const noSigs = await load({ docNumber: "MU 103", title: "Made-up Blank Form", version: "1.0", lastApprovalOrReview: null, nextReviewDue: null, reviewIntervalMonths: 0, approvalRows: 0, reviewRows: 0, manualPath: [labName, "Blood Bank"], alsoFiledIn: [], titleAsExported: "Made-up Blank Form" }, false);
const fd = new FormData();
fd.append("file", new Blob([text("ordinary")]), "ordinary.txt");
fd.append("title", "Made-up Ordinary Upload");
const ordinary = (await (await fetch(`${BASE}/api/labs/${labId}/veritapolicy/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json()).id;

const browser = await chromium.launch();
const consoleProblems = [];
const openAs = async (path, opts = {}) => {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleProblems.push(m.text()); });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, token]);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, me, labId]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const DOCS = `/labs/${labId}/veritapolicy-app/my-policies`;
const page = await openAs(DOCS);
await page.getByText("MU 101", { exact: false }).first().waitFor({ timeout: 20000 });

// C1 the list
const rowOf = (title) => page.locator("tr", { hasText: title }).first();
const mainRow = await rowOf("Made-up Chemistry Procedure").innerText();
const effective = new Date(2024, 2, 15).toLocaleDateString();
check("C1a. the list row says approved", /approved/i.test(mainRow), mainRow.slice(0, 200));
check("C1b. the list row shows the real version", /v2\.1/i.test(mainRow), mainRow.slice(0, 200));
const today = new Date().toLocaleDateString();
check("C1b2. the Updated column reads the last approval or review, not today", mainRow.includes(new Date(2026, 0, 20).toLocaleDateString()) && !mainRow.includes(today), mainRow.slice(0, 220));
check("C1c. the list row shows the real effective date and carried over", mainRow.includes(`effective ${effective}`) && /carried over/.test(mainRow), mainRow.slice(0, 200));
const pastRow = await rowOf("Made-up Transfusion Policy").innerText();
check("C1d. the past-due document reads overdue with its real date", /\d+d overdue/.test(pastRow), pastRow.slice(0, 220));
check("C1e. the past-due document is still approved, not expired", /approved/i.test(pastRow) && !/expired/i.test(pastRow));
const ordinaryRow = await rowOf("Made-up Ordinary Upload").innerText();
check("C7a. an ordinary upload has no carried-over chip", !/carried over/.test(ordinaryRow), ordinaryRow.slice(0, 200));
await page.screenshot({ path: `${OUT}/veritadc-carried-list.png` });

// C2 the view
const openDoc = async (p, title) => {
  await p.locator("tr", { hasText: title }).first().getByRole("button", { name: /^view$/i }).click();
  await p.getByRole("dialog").first().waitFor({ timeout: 15000 });
};
await openDoc(page, "Made-up Chemistry Procedure");
const panel = page.getByTestId("carried-over-panel");
await panel.waitFor({ timeout: 15000 });
const panelText = await panel.innerText();
const notice = await page.getByTestId("carried-over-notice").innerText();
check("C2a. the record says carried over with original dates", notice.includes("History carried over from the prior system (OldSystem), with its original dates."), notice);
check("C2b. the record says they signed in the prior system, not in VeritaAssure", notice.includes("approved and reviewed this document in OldSystem, not in VeritaAssure®."), notice);
check("C2c. the real dates show", panelText.includes(effective) && panelText.includes(new Date(2026, 0, 20).toLocaleDateString()), panelText.slice(0, 400));
check("C2d. the number, version and signature counts show", panelText.includes("MU 101") && panelText.includes("2.1") && panelText.includes("2 approval, 1 periodic review"));
check("C2e. who loaded it and the owner show", /Loaded into VeritaDC™ on .* by Veritas Lab Services\. Document owner: Riley Owner/.test(panelText), panelText.slice(-260));
check("C2f. the title as it came and the other filing show", panelText.includes("Made-up Chemistry Procedure (2)") && panelText.includes(`${labName} / General`));
check("C2g. it says the file was converted and the original is kept", /was \.doc, so it was converted for VeritaDC™ and the original is kept/.test(panelText));
check("C2h. no VeritaAssure signature history appears", (await page.getByRole("dialog").first().getByText(/^Signature history/).count()) === 0);
check("C2i. no em dash on the panel", !panelText.includes("—"));
await page.screenshot({ path: `${OUT}/veritadc-carried-panel-light.png` });

// C3 the face page
await page.getByTestId("carried-face-page-button").click();
const frame = page.getByTestId("carried-face-page-frame");
await frame.waitFor({ timeout: 15000 });
check("C3a. the face page opens in a fully sandboxed frame", (await frame.getAttribute("sandbox")) === "");
const srcdoc = await frame.getAttribute("srcdoc");
check("C3b. the frame holds the face page", (srcdoc || "").includes("MU 101 Made-up Chemistry Procedure") && (srcdoc || "").includes("Made-Up Director"));
await page.waitForTimeout(600);
check("C3c. a script in the face page does not run", (await page.title()) !== "SCRIPT RAN", await page.title());
await frame.scrollIntoViewIfNeeded();
const frameShot = await frame.screenshot({ path: `${OUT}/veritadc-carried-face-page.png` });
const sigLoaded = await (async () => { try { return await page.frameLocator('[data-testid="carried-face-page-frame"]').locator("#sig").evaluate((i) => i.naturalWidth > 0, null, { timeout: 4000 }); } catch { return null; } })();
const refused = consoleProblems.filter((t) => /Content Security Policy|Refused/i.test(t));
check("C3d. the CSP blocks nothing in the face page, so its signature image shows", refused.length === 0 && sigLoaded !== false, `${refused.join(" | ").slice(0, 300)} loaded=${sigLoaded} shot=${frameShot.length}`);
await page.getByTestId("carried-face-page-button").click();
check("C3e. the face page closes again", (await frame.count()) === 0);

// C4 the original
const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("carried-original-button").click()]);
check("C4. Download original saves the file under its own name", download.suggestedFilename() === "MU 101_Made-up Chemistry Procedure.doc", download.suggestedFilename());

// C5 the audit trail
await page.getByTestId("audit-trail-button").click();
await page.getByTestId("audit-trail-list").waitFor({ timeout: 15000 });
const trail = await page.getByTestId("audit-trail-list").innerText();
check("C5. the audit trail says carried over and who ran the load", /carried_over/i.test(trail) && trail.includes("loaded_by: Veritas Lab Services") && !/signed ·/i.test(trail), trail.slice(0, 300));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// C6 the thin record
const page2 = await openAs(DOCS);
await page2.getByText("MU 103", { exact: false }).first().waitFor({ timeout: 20000 });
await openDoc(page2, "Made-up Blank Form");
await page2.getByTestId("carried-over-panel").waitFor({ timeout: 15000 });
const thin = await page2.getByTestId("carried-over-panel").innerText();
check("C6a. nothing on the face page says None listed", /Signatures on the face page\s*None listed/.test(thin), thin.slice(0, 500));
check("C6b. no last review or next review says so plainly", thin.includes("None stated in OldSystem") && thin.includes("None set in OldSystem"));
check("C6c. no kept original, no download button", (await page2.getByTestId("carried-original-button").count()) === 0);
await page2.keyboard.press("Escape");
await page2.waitForTimeout(200);

// C7 an ordinary document
await openDoc(page2, "Made-up Ordinary Upload");
await page2.waitForTimeout(800);
check("C7b. an ordinary upload shows no carried-over panel", (await page2.getByTestId("carried-over-panel").count()) === 0);

// C8 the inspector link
const link = await call("POST", `/api/labs/${labId}/veritapolicy/surveyor-links`, { label: "Made-up visit", expiresInDays: 7 }, token);
const sv = await (await browser.newContext({ viewport: { width: 1300, height: 950 } })).newPage();
await sv.goto(`${BASE}/surveyor/${link.body.token}`, { waitUntil: "networkidle" });
await sv.getByText("Made-up Chemistry Procedure").first().waitFor({ timeout: 20000 });
await sv.locator("li", { hasText: "Made-up Chemistry Procedure" }).first().getByRole("button", { name: /view/i }).click();
await sv.getByTestId("carried-over-panel").waitFor({ timeout: 15000 });
const svText = await sv.getByTestId("carried-over-panel").innerText();
check("C8a. the inspector sees the carried-over history", svText.includes("not in VeritaAssure®") && svText.includes("MU 101"), svText.slice(0, 200));
check("C8b. the inspector isn't offered the original", (await sv.getByTestId("carried-original-button").count()) === 0);
await sv.getByTestId("carried-face-page-button").click();
await sv.getByTestId("carried-face-page-frame").waitFor({ timeout: 15000 });
check("C8c. the inspector can open the face page", ((await sv.getByTestId("carried-face-page-frame").getAttribute("srcdoc")) || "").includes("Made-Up Director"));
await sv.screenshot({ path: `${OUT}/veritadc-carried-inspector.png` });

// C9 dark and phone
const dark = await openAs(DOCS, { colorScheme: "dark" });
await dark.evaluate(() => document.documentElement.classList.add("dark"));
await dark.getByText("MU 101", { exact: false }).first().waitFor({ timeout: 20000 });
await dark.screenshot({ path: `${OUT}/veritadc-carried-list-dark.png` });
await openDoc(dark, "Made-up Chemistry Procedure");
await dark.getByTestId("carried-over-panel").waitFor({ timeout: 15000 });
const color = await dark.getByTestId("carried-over-notice").evaluate((el) => getComputedStyle(el).color);
const rgb = (color.match(/[\d.]+/g) || []).map(Number);
check("C9a. dark mode: the notice is light text", rgb.length >= 3 && rgb[0] > 150, color);
await dark.screenshot({ path: `${OUT}/veritadc-carried-panel-dark.png` });
const phone = await openAs(DOCS, { viewport: { width: 390, height: 800 } });
await phone.getByText("MU 101", { exact: false }).first().waitFor({ timeout: 20000 });
await openDoc(phone, "Made-up Chemistry Procedure");
await phone.getByTestId("carried-over-panel").waitFor({ timeout: 15000 });
const fit = await phone.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  const p = document.querySelector('[data-testid="carried-over-panel"]');
  const box = p?.getBoundingClientRect();
  return { dialog: d ? d.scrollWidth - d.clientWidth : -1, panel: p ? p.scrollWidth - p.clientWidth : -1, panelRight: box ? box.right : -1, width: window.innerWidth };
});
check("C9b. on a phone the panel fits, with nothing cut off sideways", fit.panel <= 0 && fit.panelRight <= fit.width, JSON.stringify(fit));
await phone.getByTestId("carried-over-panel").scrollIntoViewIfNeeded();
await phone.screenshot({ path: `${OUT}/veritadc-carried-panel-phone.png` });
await phone.keyboard.press("Escape");
await phone.waitForTimeout(300);
await openDoc(phone, "Made-up Ordinary Upload");
await phone.waitForTimeout(800);
const plainFit = await phone.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return d ? d.scrollWidth - d.clientWidth : -1; });
check("C9c. the panel adds no sideways scroll the dialog doesn't already have", fit.dialog <= plainFit, `with panel ${fit.dialog}, ordinary upload ${plainFit}`);

await browser.close();
void pastDue; void noSigs; void mainDoc; void ordinary;
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
