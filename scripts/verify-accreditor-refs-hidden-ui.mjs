// scripts/verify-accreditor-refs-hidden-ui.mjs
//
// Browser receipt (Gate 3 step 8) for BUG-191 (owner pick 2026-11-27, option 1; shared/accreditorRefs.ts): the COLA and
// AABB reference numbers VeritaAssure supplied read "Being verified" on screen until each source is checked. On a local
// production build with a scratch DB and made-up rows written through the app's own routes, never production:
//   R1. VeritaScan, a CAP and AABB lab: an item's citations show CAP's number and "AABB Being verified", never AABB 5.1.1
//   R2. VeritaScan, a COLA lab: "COLA Being verified", never QC 1; the badge's tooltip says why
//   R3. the evidence library's Inspection Proof AABB tab: the citation column reads Being verified, with the note
//   R4. a VeritaResponse finding: the standard the lab typed itself shows as typed
//   R5. phone width (390): no sideways scroll on either screen
//   R6. dark mode: the Being verified badge reads at 4.5:1 or better
// Light and dark screenshots at 1280 and 390 wide go to OUT.
// Run: PW_BASE=http://localhost:5291 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-accreditor-refs-hidden-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
fs.mkdirSync(OUT, { recursive: true });
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Refs", "Hidden", "91!"].join("-");
const stamp = Date.now();

const call = async (method, p, body, token, lab) => {
  const r = await fetch(BASE + p, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(lab ? { "X-Active-Lab-Id": String(lab) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const register = async (tag, name) => {
  const email = `accrefs-ui-${tag}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  const id = Number(sql("SELECT id FROM users WHERE email = ?", email)?.id);
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", id);
  return { email, token: reg.body.token, id };
};
let cliaNo = 0;
const lab = async (owner, name, flags) => {
  const id = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: name, plan: "hospital" })).body.labId;
  sql(`UPDATE labs SET has_completed_onboarding = 1, clia_number = '00D${String((stamp + ++cliaNo) % 1e7).padStart(7, "0")}', accreditation_tjc = ?, accreditation_cap = ?, accreditation_cola = ?, accreditation_aabb = ? WHERE id = ?`, flags.tjc ? 1 : 0, flags.cap ? 1 : 0, flags.cola ? 1 : 0, flags.aabb ? 1 : 0, id);
  return id;
};

// ── Fixture: two made-up labs (CAP + AABB, and COLA), a scan in each, a finding the lab typed ──
const OWNER = await register("owner", "Made-up Owner Reyes");
const BB = await lab(OWNER, "Made-up Transfusion Lab", { cap: true, aabb: true });
const CO = await register("cola", "Made-up Owner Lind");
const CL = await lab(CO, "Made-up Office Lab", { cola: true });
const scanBB = (await call("POST", `/api/labs/${BB}/veritascan/scans`, { name: "Made-up Readiness 2026" }, OWNER.token, BB)).body.id;
const scanCL = (await call("POST", `/api/labs/${CL}/veritascan/scans`, { name: "Made-up Readiness 2026" }, CO.token, CL)).body.id;
const TYPED = "Made-up std 5.1.1 as cited by the assessor";
const finding = await call("POST", `/api/labs/${BB}/findings`, { accreditor: "AABB", standard_ref: TYPED, finding_number: "MU-1", description: "Made-up finding: consent form missing on one transfusion record.", anchor_date: "2026-11-20", status: "open" }, OWNER.token, BB);
check("setup: two made-up labs, a scan in each, a finding with a standard the lab typed", BB > 0 && CL > 0 && scanBB > 0 && scanCL > 0 && finding.status < 300, JSON.stringify({ scanBB, scanCL, f: finding.status, e: finding.body?.error }));
const FID = finding.body?.id;

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const openAs = async (who, labId, p, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, who.token]);
  await page.evaluate(([tk, usr, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(usr.user || usr)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [who.token, me, labId]);
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  return page;
};
const contrast = async (locator) => locator.evaluate((el) => {
  const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 4).map(Number);
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fg = rgb(getComputedStyle(el).color);
  let n = el, bg = null;
  while (n) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) { bg = c; break; } n = n.parentElement; }
  bg = bg || [255, 255, 255];
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
});
const showCitations = async (page, n = 3) => {
  const buttons = page.locator('button[title="Show citations"]');
  await buttons.first().waitFor({ timeout: 20000 });
  for (let i = 0; i < n; i++) await buttons.first().click(); // each click turns the button into "Hide citations"
};
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const scheme of ["light", "dark"]) {
  for (const width of [1280, 390]) {
    const viewport = { width, height: width === 390 ? 844 : 900 };
    const tag = `${scheme}-${width}`;
    // R1 (and R5, R6) VeritaScan, CAP + AABB lab
    const p = await openAs(OWNER, BB, `/labs/${BB}/veritascan-app/${scanBB}`, { viewport, colorScheme: scheme });
    await showCitations(p);
    const aabb1 = p.getByTestId("ref-aabb-1");
    const text1 = (await aabb1.innerText()).trim();
    const body = await p.locator("body").innerText();
    check(`R1 ${tag}. item 1 shows "AABB Being verified" beside its CAP number, and no AABB 5.x number on the page`, text1 === "AABB Being verified" && body.includes("CAP GEN.30000") && !/AABB 5\.\d/.test(body), `${text1}`);
    if (width === 390) check(`R5 ${tag}. VeritaScan: no sideways scroll`, await noSideScroll(p));
    if (scheme === "dark") check(`R6 ${tag}. the Being verified badge reads at 4.5:1 or better`, (await contrast(aabb1)) >= 4.5, String(await contrast(aabb1)));
    await aabb1.scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(OUT, `veritascan-aabb-${tag}.png`), fullPage: false });
    await p.context().close();

    // R4 (and R5) the VeritaResponse finding
    const f = await openAs(OWNER, BB, `/labs/${BB}/veritaresponse/${FID}`, { viewport, colorScheme: scheme });
    await f.getByText("MU-1").first().waitFor({ timeout: 20000 }).catch(() => {});
    const fbody = await f.locator("body").innerText();
    const typedShown = fbody.includes(TYPED) || (await f.locator(`input[value="${TYPED}"]`).count()) > 0;
    check(`R4 ${tag}. the finding shows the standard the lab typed, as typed`, typedShown && !fbody.includes("Being verified"));
    if (width === 390) check(`R5 ${tag}. the finding: no sideways scroll`, await noSideScroll(f));
    await f.screenshot({ path: path.join(OUT, `veritaresponse-finding-${tag}.png`), fullPage: false });
    await f.context().close();
  }
}

// R2 VeritaScan, COLA lab
const c = await openAs(CO, CL, `/labs/${CL}/veritascan-app/${scanCL}`);
await showCitations(c);
const cola1 = c.getByTestId("ref-cola-1");
check("R2. item 1 shows \"COLA Being verified\", never QC 1, and its tooltip says why", (await cola1.innerText()).trim() === "COLA Being verified" && /being verified|until they are checked/i.test((await cola1.getAttribute("title")) || "") && !(await c.locator("body").innerText()).includes("QC 1 "), await cola1.innerText());
await cola1.scrollIntoViewIfNeeded();
await c.screenshot({ path: path.join(OUT, "veritascan-cola-light-1280.png") });
await c.context().close();

// R3 Inspection Proof, AABB tab
const ip = await openAs(OWNER, BB, `/labs/${BB}/veritascan/inspection-proof`);
await ip.getByTestId("tab-aabb").click();
await ip.getByTestId("row-item-1").waitFor({ timeout: 20000 });
const row1 = await ip.getByTestId("row-item-1").innerText();
const note = await ip.getByTestId("note-unverified-aabb").innerText().catch(() => "");
check("R3. the AABB tab's citation column reads Being verified, with the note, and lists every item", /Being verified/.test(row1) && !/AABB 5\./.test(row1) && /Being verified/.test(note) && (await ip.locator('[data-testid^="row-item-"]').count()) > 0, `${row1.slice(0, 120)} | ${note}`);
await ip.screenshot({ path: path.join(OUT, "inspection-proof-aabb-light-1280.png") });
await ip.context().close();

await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
