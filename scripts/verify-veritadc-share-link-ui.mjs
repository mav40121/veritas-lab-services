// scripts/verify-veritadc-share-link-ui.mjs
//
// Browser receipt for the VeritaDC document share link (Michael 2026-11-09; server/policyShareLinks.ts). On a local production
// build with a scratch DB and made-up data only:
//   E1. A VeritaDC editor opens an approved document, creates a share link with a label, and copies it.
//   E2. A view-only seat opening the same document sees no Share link section.
//   P1. The link, opened in a fresh browser with no login, shows the lab, CLIA, number, title, version, the note, the file and
//       Download, without the site's navigation, and is noindex.
//   P2. After a revision is approved, the SAME link shows the new version and its file. The editor's list counts the views.
//   P3. The editor revokes it on screen; the link then reads "This link is not active. Contact the laboratory."
//   P4. A document stored as HTML shows inline in a sandboxed frame, and a script in it never runs on the page. (Headless
//       Chromium has no PDF viewer, so the PDF frame screenshots blank; P1/P2 check its bytes and blob source instead.)
//   D1. Light, dark and phone width for the public page, the not-active page and the editor section; no overflow, no page errors.
// Run: UI_REPO=<worktree> UI_PORT=<free port> UI_SCRIPT=verify-veritadc-share-link-ui.mjs UI_OUT=share_link UI_DB=share_link.db bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
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

// A small made-up PDF, one line of text per entry.
function madeUpPdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = `BT /F1 18 Tf 72 720 Td 26 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const pw = ["Share", "Ui", "77!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();
const email = `shareui-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: pw, name: "Riley Owner", hipaa_acknowledged: true });
const token = owner.body.token;
const ownerId = Number(owner.body.user?.id);
const labName = "Share Link Test Lab";
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital", isWarehouse: true })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?", email);
sql("UPDATE labs SET clia_number = '22D0000321' WHERE id = ?", labId);
const addSeat = async (tag, seatType, permissions, name) => {
  const e = `shareui-${tag}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email: e, password: pw, name, hipaa_acknowledged: true });
  const id = Number(reg.body.user?.id);
  sql("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)", labId, id, now, now, now);
  sql("UPDATE users SET lab_id = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", labId, id);
  sql("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, seat_type, lab_id, permissions) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)", ownerId, e, id, now, now, seatType, labId, permissions);
  sql("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?", id);
  return { email: e, id, token: (await call("POST", "/api/auth/login", { email: e, password: pw })).body.token, name };
};
const signer = await addSeat("signer", "active", '{"mode":"edit_all"}', "Made Up Signer");
const viewer = await addSeat("viewer", "view_only", '{"mode":"view_all"}', "View Only Person");
const P = `/api/labs/${labId}/veritapolicy`;
const wf = await call("POST", `${P}/workflows`, { name: "Made-up approval route" }, token);
await call("POST", `${P}/workflows/${wf.body.id}/steps`, { stepName: "Made-up approval", requiredRole: "specific_user", specificUserId: signer.id }, token);
const approve = async (docId) => {
  await call("POST", `${P}/documents/${docId}/submit`, { workflowId: wf.body.id }, token);
  return (await call("POST", `${P}/documents/${docId}/approve`, { typedSignature: "Made Up Signer", password: pw }, signer.token)).body.status;
};
const post = async (path, fields, pdf, name) => {
  const fd = new FormData();
  fd.append("file", new Blob([pdf], { type: "application/pdf" }), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return (await fetch(BASE + path, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
};
const TITLE = "Made-up Specimen Collection Manual";
const V1 = madeUpPdf([TITLE, "Version 1.0 (made-up)", "MADEUPMARKERONE", "Label every tube at the bedside."]);
const V2 = madeUpPdf([TITLE, "Version 1.1 (made-up)", "MADEUPMARKERTWO", "Label every tube at the bedside, two identifiers."]);
const doc = await post(`${P}/documents`, { title: TITLE, doc_number: "SC 100" }, V1, "made-up-specimen-collection.pdf");
check("S0. the made-up document is approved through the app's own routes", (await approve(doc.id)) === "approved");

const browser = await chromium.launch();
const errors = [];
const open = async (tk, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1300, height: 950 }, colorScheme: opts.dark ? "dark" : "light" });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  // The file the page fetched for its viewer (the page holds it as a blob: URL, which CSP keeps fetch away from).
  page.fileBodies = [];
  page.on("response", async (r) => {
    if (/\/api\/public\/policy-share\/[^/]+\/file$/.test(new URL(r.url()).pathname) && !new URL(r.url()).search) {
      try { page.fileBodies.push((await r.body()).toString("latin1")); } catch {}
    }
  });
  if (tk) {
    await page.goto(`${BASE}/`);
    const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, tk]);
    await page.evaluate(([t, u, l]) => {
      localStorage.setItem("veritas_token", t);
      localStorage.setItem("veritas_user", JSON.stringify(u.user || u));
      localStorage.setItem("veritas_active_lab_id", String(l));
    }, [tk, me, labId]);
  }
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return { page, ctx };
};
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const shot = (page, name, full = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
const POLICIES = `/labs/${labId}/veritapolicy-app/my-policies`;
const openDoc = async (page) => {
  await page.locator("tr").filter({ hasText: TITLE }).getByRole("button", { name: /View/ }).first().click();
  await page.getByRole("dialog").waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
};

// ── E1. The editor creates and copies a link ──
let linkUrl = "";
{
  const { page, ctx } = await open(token, POLICIES);
  await openDoc(page);
  const section = page.getByTestId("share-links");
  await section.waitFor({ timeout: 15000 });
  check("E1. the editor sees the Share link section with its copy", (await section.innerText()).includes("Anyone with this link can read the current approved version of this document, without signing in."));
  await page.getByTestId("share-link-label").fill("Nursing intranet");
  await page.getByTestId("share-link-create").click();
  await page.getByTestId("share-link-row").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  linkUrl = await page.evaluate(() => navigator.clipboard.readText());
  const row = await page.getByTestId("share-link-row").first().innerText();
  const dbRow = sql("SELECT token, label FROM policy_share_links WHERE document_id = ?", doc.id);
  check("E1. creating copies the link: this site's /policy/<token>", linkUrl === `${BASE}/policy/${dbRow?.token}`, linkUrl);
  check("E1. the row shows the label, Active, created date and 0 views", /Nursing intranet/.test(row) && /Active/i.test(row) && /Created/.test(row) && /0 views/.test(row), row.replace(/\n/g, " | "));
  await section.scrollIntoViewIfNeeded();
  await shot(page, "E1_editor_share_section_light", false);
  await page.getByTestId("share-link-copy").first().click();
  await page.waitForTimeout(300);
  check("E1. Copy link copies the same address", (await page.evaluate(() => navigator.clipboard.readText())) === linkUrl);
  await ctx.close();
}
{
  const { page, ctx } = await open(token, POLICIES, { dark: true });
  await openDoc(page);
  await page.getByTestId("share-links").scrollIntoViewIfNeeded();
  await shot(page, "E1_editor_share_section_dark", false);
  await ctx.close();
}
// ── E2. A view-only seat sees no section ──
{
  const { page, ctx } = await open(viewer.token, POLICIES);
  await openDoc(page);
  await page.waitForTimeout(800);
  check("E2. a view-only seat sees no Share link section", (await page.getByTestId("share-links").count()) === 0);
  await shot(page, "E2_viewonly_no_share_section", false);
  await ctx.close();
}

const linkPath = new URL(linkUrl).pathname;
const tokenOnly = linkPath.split("/").pop();
// ── P1. The link with no login ──
const readPublic = async (opts = {}) => {
  const { page, ctx } = await open(null, linkPath, opts);
  await page.getByTestId("share-title").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  return { page, ctx };
};
// What the viewer shows: the PDF frame is on the page with a blob: source, and the file the page fetched for it.
const iframeText = async (page) => {
  const src = await page.getByTestId("share-viewer-pdf").getAttribute("src").catch(() => null);
  return src && src.startsWith("blob:") ? page.fileBodies.join("\n") : "";
};
{
  const { page, ctx } = await readPublic();
  const text = await page.locator("body").innerText();
  check("P1. no login: lab name and CLIA", (await page.getByTestId("share-lab").innerText()).trim() === `${labName} · CLIA 22D0000321`, await page.getByTestId("share-lab").innerText());
  check("P1. title, number and version 1.0", (await page.getByTestId("share-title").innerText()) === TITLE && (await page.getByTestId("share-doc-number").innerText()) === "SC 100" && (await page.getByTestId("share-version").innerText()) === "1.0");
  check("P1. effective and approved dates", /Effective/.test(text) && /Approved/.test(text) && !/Not stated/.test(text), (await page.getByTestId("share-facts").innerText()).replace(/\n/g, " | "));
  check("P1. the note line, word for word", (await page.getByTestId("share-note").innerText()).trim() === "This link always shows the laboratory's current approved version. Printed copies are uncontrolled.");
  check("P1. the file shows inline and is version 1.0's", (await page.getByTestId("share-viewer-pdf").count()) === 1 && (await iframeText(page)).includes("MADEUPMARKERONE"));
  const href = await page.getByTestId("share-download").getAttribute("href");
  const dl = await page.evaluate(async (h) => { const r = await fetch(h); return { cd: r.headers.get("content-disposition"), ct: r.headers.get("content-type") }; }, href);
  check("P1. Download sends the PDF as an attachment", /^attachment; filename="SC 100 Made-up Specimen Collection Manual v1\.0\.pdf"$/.test(dl.cd || "") && dl.ct === "application/pdf", JSON.stringify(dl));
  check("P1. no site navigation, sign-in or pricing on the page", !/Sign in|Log in|Pricing|Book a demo/i.test(text));
  check("P1. the page is noindex", (await page.evaluate(() => document.querySelector("meta[name=robots]")?.getAttribute("content"))) === "noindex, nofollow");
  const shell = await fetch(`${BASE}${linkPath}`);
  const html = await shell.text();
  check("P1. the server's HTML shell says noindex too, in a header and the meta tag", shell.headers.get("x-robots-tag") === "noindex, nofollow" && /<meta name="robots" content="noindex, nofollow"/.test(html) && !/content="index, follow"/.test(html));
  check("P1. marks: VeritaAssure® and VeritaDC™; no em dash", /VeritaAssure®/.test(text) && /VeritaDC™/.test(text) && !text.includes("—"));
  check("P1. nothing about signatures, sign-offs or staff on the page", !/Made Up Signer|signature|Riley Owner|sign-off/i.test(text));
  check("P1. no horizontal overflow at desktop width", await fits(page));
  await shot(page, "P1_public_v1_light");
  await ctx.close();
}
{
  const { page, ctx } = await readPublic({ dark: true });
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector("main").parentElement).backgroundColor);
  check("D1. dark mode: the page background is dark", /rgb\((\d+), (\d+), (\d+)\)/.test(bg) && Number(bg.match(/\d+/)[0]) < 60, bg);
  await shot(page, "P1_public_v1_dark");
  await ctx.close();
}
{
  const { page, ctx } = await readPublic({ viewport: { width: 390, height: 844 } });
  check("D1. phone width: no horizontal overflow", await fits(page));
  const dlBox = await page.getByTestId("share-download").boundingBox();
  check("D1. phone width: Download is on screen", !!dlBox && dlBox.x >= 0 && dlBox.x + dlBox.width <= 390, JSON.stringify(dlBox));
  await shot(page, "P1_public_v1_phone");
  await ctx.close();
}

// ── P4. A document stored as HTML shows inline in a sandboxed frame; nothing in it runs on the page ──
// (Headless Chromium has no PDF viewer, so the PDF frame above screenshots blank; this one shows the inline view.)
{
  const html = `<html><body><h2>Made-up Phlebotomy Order of Draw</h2><ol><li>Blood culture bottles</li><li>Light blue top (citrate)</li><li>Red or gold top (serum)</li><li>Green top (heparin)</li><li>Lavender top (EDTA)</li><li>Gray top (fluoride)</li></ol><p>Made-up guidance for the receipt only. <a href="https://example.com/made-up">A made-up reference</a></p><script>window.top.__shareXss = 1</script><img src="x" onerror="window.top.__shareXss = 2"></body></html>`;
  const fd = new FormData();
  fd.append("file", new Blob([Buffer.from(html)], { type: "text/html" }), "made-up-order-of-draw.html");
  fd.append("title", "Made-up Phlebotomy Order of Draw");
  fd.append("doc_number", "SC 101");
  const d2 = await (await fetch(`${BASE}${P}/documents`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
  check("S2. the made-up HTML document is approved", (await approve(d2.id)) === "approved");
  const t2 = (await call("POST", `${P}/documents/${d2.id}/share-links`, { label: "Made-up nursing unit" }, token)).body.token;
  for (const [name, opts] of [["P4_public_html_light", {}], ["P4_public_html_dark", { dark: true }], ["P4_public_html_phone", { viewport: { width: 390, height: 844 } }]]) {
    const { page, ctx } = await open(null, `/policy/${t2}`, opts);
    await page.getByTestId("share-viewer-html").waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    if (name === "P4_public_html_light") {
      const sandbox = await page.getByTestId("share-viewer-html").getAttribute("sandbox");
      const inner = await page.frameLocator("[data-testid=share-viewer-html]").locator("body").innerText();
      check("P4. the document shows inline", /Made-up Phlebotomy Order of Draw/.test(inner) && /Lavender top \(EDTA\)/.test(inner), inner.slice(0, 80));
      check("P4. in a frame sandboxed without scripts", sandbox !== null && !/allow-scripts|allow-same-origin/.test(sandbox), String(sandbox));
      check("P4. the document's script and onerror never ran on the page", (await page.evaluate(() => window.__shareXss)) === undefined);
    } else {
      check(`D1. ${name}: no horizontal overflow`, await fits(page));
    }
    await shot(page, name);
    await ctx.close();
  }
}

// ── P2. A revision is approved: the same link shows it ──
{
  const fd = new FormData();
  fd.append("file", new Blob([V2], { type: "application/pdf" }), "made-up-specimen-collection-v2.pdf");
  fd.append("is_major_revision", "0");
  fd.append("change_summary", "Made-up revision: two identifiers");
  await (await fetch(`${BASE}${P}/documents/${doc.id}/versions`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd })).json();
  check("S1. the made-up revision is approved", (await approve(doc.id)) === "approved");
  const { page, ctx } = await readPublic();
  check("P2. the same link now shows version 1.1", (await page.getByTestId("share-version").innerText()) === "1.1" && page.url() === linkUrl);
  check("P2. and the revision's file", (await iframeText(page)).includes("MADEUPMARKERTWO") && !(await iframeText(page)).includes("MADEUPMARKERONE"));
  await shot(page, "P2_public_v2_light");
  await ctx.close();
}
{
  const { page, ctx } = await open(token, POLICIES);
  await openDoc(page);
  await page.getByTestId("share-link-row").first().waitFor({ timeout: 15000 });
  const views = await page.getByTestId("share-link-views").first().innerText();
  const counted = sql("SELECT view_count FROM policy_share_links WHERE token = ?", tokenOnly).view_count;
  check("P2. the editor's list counts the views", counted >= 4 && views.startsWith(`${counted} views`), `${views} / db ${counted}`);
  // ── P3. Revoke on screen ──
  await page.getByTestId("share-link-revoke").first().click();
  await page.getByTestId("share-link-revoke-confirm").click();
  await page.waitForTimeout(1200);
  const status = await page.getByTestId("share-link-status").first().innerText();
  check("P3. the row reads Revoked, with no Copy or Revoke left", /Revoked/i.test(status) && (await page.getByTestId("share-link-copy").count()) === 0, status);
  await page.getByTestId("share-links").scrollIntoViewIfNeeded();
  await shot(page, "P3_editor_revoked_light", false);
  await ctx.close();
}
const deadCheck = async (opts, name) => {
  const { page, ctx } = await open(null, linkPath, opts);
  await page.getByTestId("share-not-active").waitFor({ timeout: 15000 });
  const t = (await page.getByTestId("share-not-active").innerText()).trim();
  const fitsNow = await fits(page);
  const leftover = (await page.locator("body").innerText()).includes(TITLE) || (await page.getByTestId("share-viewer-pdf").count()) > 0;
  await shot(page, name);
  await ctx.close();
  return { t, fitsNow, leftover };
};
const dead = await deadCheck({}, "P3_public_revoked_light");
check("P3. the revoked link reads the not-active message", dead.t === "This link is not active. Contact the laboratory.", dead.t);
check("P3. no document title or file is left on it", !dead.leftover);
const deadDark = await deadCheck({ dark: true }, "P3_public_revoked_dark");
const deadPhone = await deadCheck({ viewport: { width: 390, height: 844 } }, "P3_public_revoked_phone");
check("D1. the not-active page reads the same in dark and at phone width, with no overflow", deadDark.t === dead.t && deadPhone.t === dead.t && deadPhone.fitsNow);
{
  const { page, ctx } = await open(null, `/policy/00000000-0000-4000-8000-000000000000`);
  await page.getByTestId("share-not-active").waitFor({ timeout: 15000 });
  check("P3. an unknown link reads exactly the same", (await page.getByTestId("share-not-active").innerText()).trim() === dead.t && !(await page.locator("body").innerText()).includes(TITLE));
  await ctx.close();
}
check("D1. no page errors in any browser context", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
