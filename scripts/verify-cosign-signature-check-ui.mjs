// scripts/verify-cosign-signature-check-ui.mjs
//
// Browser receipt for BUG-205: the monthly VeritaQC co-sign and a finding's sign-off open the VeritaMaintain monthly review's
// signing dialog (typed name and password, or the hospital sign-in) and sign only with the right password. LOCAL server on a
// scratch DB only; made-up labs, people, lots and findings.
//   1. as the medical director on a view-only seat, "Co-sign as Medical Director" opens the dialog: "Type your full name to sign"
//      and "Password", Cancel and the button; light and dark, 1280 and 390 wide, the dialog inside the screen
//   2. light 1280: no password and a wrong password are refused on screen and store nothing; the right one co-signs, the card says
//      so, and the stored review names the typed name, signed with a password
//   3. the same for the finding's "Sign off and close as medical director": the dialog in the four views, then refused, then
//      signed off and closed, signed with a password
//   4. someone whose hospital requires single sign-on sees "Sign with Example Hospital" in place of the password, in both dialogs
// Run: PW_BASE=http://localhost:<port> SCRATCH_DB=<db the server uses> OUT=<dir> node scripts/verify-cosign-signature-check-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; }
};
const db = (readonly = false) => new Database(process.env.SCRATCH_DB, readonly ? { readonly: true } : {});

const stamp = Date.now();
const PW = ["Zq", "cosign", "7x!"].join("-");
const WRONG = ["Not", "it", "4x!"].join("-");
const ownerEmail = `csc-owner-${stamp}@example.com`, mdEmail = `csc-director-${stamp}@example.com`, hospEmail = `csc-hosp-${stamp}@csc-hospital.test`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: PW, name: "Avery Owner", hipaa_acknowledged: true })).body;
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Sample Regional Medical Center (sign QA)", plan: "hospital" })).body?.labId;
const mdReg = (await call("POST", "/api/auth/register", { email: mdEmail, password: PW, name: "Jordan Ellis, MD", hipaa_acknowledged: true })).body;
// A second made-up lab whose owner signs in through a hospital that requires single sign-on (they sign as the owner override).
const hospReg = (await call("POST", "/api/auth/register", { email: hospEmail, password: PW, name: "Harper Hospital", hipaa_acknowledged: true })).body;
const lab2 = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: hospEmail, labName: "Sample Community Lab (sign QA)", plan: "hospital" })).body?.labId;
{
  const now = new Date().toISOString();
  const d = db();
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id IN (?, ?, ?)").run(owner.user.id, mdReg.user.id, hospReg.user.id);
  d.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(lab, mdReg.user.id);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, medical_director_email = ?, qc_md_cosign_required = 1, clia_number = ? WHERE id = ?").run(mdEmail, `99D${String(stamp).slice(-7)}`, lab);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, qc_md_cosign_required = 1, clia_number = ? WHERE id = ?").run(`98D${String(stamp).slice(-7)}`, lab2);
  d.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'staff','active',1,?,?,?)").run(lab, mdReg.user.id, now, now, now);
  // The director's seat is VIEW-ONLY: they review and sign, they don't enter data (PR 1996 lets the signature through).
  d.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type)
    VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'view_only')`).run(owner.user.id, mdEmail, mdReg.user.id, now, now, `csc-md-${stamp}`, lab);
  d.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(mdReg.user.id);
  // The hospital's sign-in for csc-hospital.test, required. Nothing here talks to a provider: the dialog only reads that it exists.
  d.prepare("INSERT INTO sso_configs (name, issuer, client_id, email_domains, required, enabled, created_at, updated_at) VALUES ('Example Hospital', 'https://login.example.test/tenant/v2.0', 'made-up-client', ?, 1, 1, ?, ?)")
    .run(JSON.stringify(["csc-hospital.test"]), now, now);
  d.close();
}
const md = (await call("POST", "/api/auth/login", { email: mdEmail, password: PW })).body;
const T = owner.token, L = `/api/labs/${lab}`;
const now = new Date();
const year = now.getFullYear(), month = now.getMonth() + 1;
const monthName = now.toLocaleString("en-US", { month: "long" });
// The owner (a writer) adds a lot and files this month's review, as the reviewer would; the same in the hospital owner's lab.
const lotId = (await call("POST", `${L}/qc/control-lots`, { analyte: "Glucose", level: "Level 1", lot_number: "GL-1-4471", mfr_mean: 100, mfr_sd: 2, manufacturer: "Made-up Controls" }, T)).body?.lot?.id;
const filed = await call("POST", `${L}/qc/period-reviews`, { control_lot_id: lotId, period_year: year, period_month: month, attestation_acknowledged: true, review_notes: "Made-up month, no rejections" }, T);
const lot2Id = (await call("POST", `/api/labs/${lab2}/qc/control-lots`, { analyte: "Glucose", level: "Level 1", lot_number: "GL-2-1180", mfr_mean: 100, mfr_sd: 2, manufacturer: "Made-up Controls" }, hospReg.token)).body?.lot?.id;
const filed2 = await call("POST", `/api/labs/${lab2}/qc/period-reviews`, { control_lot_id: lot2Id, period_year: year, period_month: month, attestation_acknowledged: true }, hospReg.token);
let findingId, finding2Id;
{
  const n = new Date().toISOString();
  const d = db();
  findingId = Number(d.prepare("INSERT INTO findings (user_id, lab_id, accreditor, status, description, created_at, updated_at) VALUES (?, ?, 'CAP', 'open', 'Made-up finding for the sign-off dialog', ?, ?)").run(owner.user.id, lab, n, n).lastInsertRowid);
  finding2Id = Number(d.prepare("INSERT INTO findings (user_id, lab_id, accreditor, status, description, created_at, updated_at) VALUES (?, ?, 'CAP', 'open', 'Made-up finding, hospital sign-in', ?, ?)").run(hospReg.user.id, lab2, n, n).lastInsertRowid);
  d.close();
}
check("0. two labs, a filed review in each, a finding in each, the director on a view-only seat, a hospital owner",
  !!lab && !!lab2 && !!lotId && !!lot2Id && filed.status === 200 && filed2.status === 200 && !!md?.token && findingId > 0 && finding2Id > 0, `${lab} ${lab2} ${lotId} ${lot2Id} ${filed.status} ${filed2.status}`);

const readReview = (labId, lot) => { const d = db(true); const r = d.prepare("SELECT md_signed_at, md_signed_by_user_id, md_signed_name, md_signed_with FROM qc_period_reviews WHERE lab_id = ? AND control_lot_id = ? AND period_year = ? AND period_month = ?").get(labId, lot, year, month); d.close(); return r; };
const readFinding = (id) => { const d = db(true); const r = d.prepare("SELECT status, signed_by, signoff_role, signed_with FROM findings WHERE id = ?").get(id); d.close(); return r; };
const resetReview = () => { const d = db(); d.prepare("UPDATE qc_period_reviews SET md_signed_at = NULL, md_signed_by_user_id = NULL, md_signed_name = NULL, md_signed_with = NULL, md_signed_with_provider = NULL WHERE lab_id = ? AND control_lot_id = ?").run(lab, lotId); d.close(); };
const resetFinding = () => { const d = db(); d.prepare("UPDATE findings SET status = 'open', signed_by = NULL, signed_at = NULL, signoff_role = NULL, signed_with = NULL, signed_with_provider = NULL WHERE id = ?").run(findingId); d.close(); };

const browser = await chromium.launch();
const open = async (who, labId, path, scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true }));
    localStorage.setItem("veritas_active_lab_id", String(l));
  }, [who.token, who.user, labId]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return { ctx, page };
};
const dialogFacts = async (page, nameId, pwId, hospitalId) => {
  const dlg = page.getByRole("dialog");
  await dlg.waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const box = (await dlg.count()) ? await dlg.boundingBox() : null;
  const text = (await dlg.count()) ? (await dlg.innerText()) : "";
  return {
    dlg, text, box,
    name: await page.getByTestId(nameId).count(),
    password: await page.getByTestId(pwId).count(),
    hospital: await page.getByTestId(hospitalId).count(),
    scrollW: await page.evaluate(() => document.documentElement.scrollWidth),
    dark: await page.evaluate(() => document.documentElement.classList.contains("dark")),
  };
};
const fits = (f, width) => !!f.box && f.box.x >= 0 && f.box.x + f.box.width <= width + 1 && f.scrollW <= width + 1;
const toast = async (page, text) => { const t = page.getByText(text, { exact: false }); await t.first().waitFor({ timeout: 10000 }).catch(() => {}); return (await t.count()) > 0; };

const views = [["light", 1280], ["dark", 1280], ["light", 390], ["dark", 390]];

// ── 1 and 2. The QC co-sign ───────────────────────────────────────────────
for (const [scheme, width] of views) {
  const { ctx, page } = await open(md, lab, `/labs/${lab}/veritaqc-app/review`, scheme, width);
  const button = page.getByTestId("qc-cosign-button");
  await button.waitFor({ timeout: 30000 }).catch(() => {});
  const label = (await button.count()) ? (await button.innerText()).trim() : "";
  if (await button.count()) { await button.scrollIntoViewIfNeeded(); await button.click(); }
  const f = await dialogFacts(page, "qc-cosign-name", "qc-cosign-password", "qc-cosign-sign-with-hospital");
  check(`1. ${scheme} ${width}: "Co-sign as Medical Director" opens the signing dialog (typed name, password, Cancel), inside the screen`,
    label === "Co-sign as Medical Director" && f.name === 1 && f.password === 1 && f.hospital === 0 && f.text.includes(`Co-sign the ${monthName} ${year} review`)
      && f.text.includes("You are signing as the medical director") && f.text.includes("Type your full name to sign") && f.text.includes("Password") && f.text.includes("Cancel")
      && fits(f, width) && f.dark === (scheme === "dark"),
    `${label} | ${JSON.stringify({ ...f, dlg: undefined, text: f.text.slice(0, 160) })}`);
  await f.dlg.screenshot({ path: `${OUT}/qc-cosign-dialog-${scheme}-${width}.png` }).catch(() => {});
  if (scheme === "light" && width === 1280) {
    await page.getByTestId("qc-cosign-name").fill("Jordan Ellis, MD");
    await page.getByTestId("qc-cosign-sign").click();
    const saidPw = await toast(page, "Enter your password to sign");
    check("2a. no password: the dialog says to enter it, and nothing is stored", saidPw && !readReview(lab, lotId)?.md_signed_at, JSON.stringify(readReview(lab, lotId)));
    await page.getByTestId("qc-cosign-password").fill(WRONG);
    await page.getByTestId("qc-cosign-sign").click();
    const saidWrong = await toast(page, "Password incorrect; the review was not co-signed");
    check("2b. a wrong password: refused on screen, the dialog stays open, nothing is stored", saidWrong && (await page.getByRole("dialog").count()) === 1 && !readReview(lab, lotId)?.md_signed_at, JSON.stringify(readReview(lab, lotId)));
    await page.screenshot({ path: `${OUT}/qc-cosign-wrong-password-light-1280.png` });
    await page.getByTestId("qc-cosign-password").fill(PW);
    await page.getByTestId("qc-cosign-sign").click();
    const line = page.getByText("Medical Director co-signed by", { exact: false });
    await line.waitFor({ timeout: 20000 }).catch(() => {});
    const lineText = (await line.count()) ? (await line.innerText()).trim() : "";
    await page.getByRole("dialog").waitFor({ state: "detached", timeout: 5000 }).catch(() => {}); // its closing animation
    const r = readReview(lab, lotId);
    check("2c. the right password co-signs: the dialog closes, the card says so, and the stored review names the typed name, signed with a password",
      /co-signed by Jordan Ellis, MD/.test(lineText) && (await page.getByRole("dialog").count()) === 0 && r?.md_signed_by_user_id === mdReg.user.id && r?.md_signed_name === "Jordan Ellis, MD" && r?.md_signed_with === "password",
      `${lineText} | ${JSON.stringify(r)}`);
    const card = page.getByText("Monthly Review & Attestation", { exact: true }).locator("xpath=ancestor::div[contains(@class,'border')][1]");
    await card.screenshot({ path: `${OUT}/qc-cosign-after-light-1280.png` }).catch(() => {});
    resetReview();
  }
  await ctx.close();
}

// ── 3. The finding's sign-off ─────────────────────────────────────────────
for (const [scheme, width] of views) {
  const { ctx, page } = await open(md, lab, `/labs/${lab}/veritaresponse/${findingId}`, scheme, width);
  const button = page.getByTestId("finding-signoff-btn");
  await button.waitFor({ timeout: 30000 }).catch(() => {});
  const label = (await button.count()) ? (await button.innerText()).trim() : "";
  if (await button.count()) { await button.scrollIntoViewIfNeeded(); await button.click(); }
  const f = await dialogFacts(page, "finding-signoff-name", "finding-signoff-password", "finding-signoff-sign-with-hospital");
  check(`3. ${scheme} ${width}: "Sign off and close as medical director" opens the same signing dialog, inside the screen`,
    label === "Sign off and close as medical director" && f.name === 1 && f.password === 1 && f.hospital === 0 && f.text.includes("Sign off and close this finding")
      && f.text.includes("You are signing as the medical director. Signing closes the finding.") && f.text.includes("Type your full name to sign") && f.text.includes("Password")
      && fits(f, width) && f.dark === (scheme === "dark"),
    `${label} | ${JSON.stringify({ ...f, dlg: undefined, text: f.text.slice(0, 160) })}`);
  await f.dlg.screenshot({ path: `${OUT}/finding-signoff-dialog-${scheme}-${width}.png` }).catch(() => {});
  if (scheme === "light" && width === 1280) {
    await page.getByTestId("finding-signoff-name").fill("Jordan Ellis, MD");
    await page.getByTestId("finding-signoff-password").fill(WRONG);
    await page.getByTestId("finding-signoff-sign").click();
    const saidWrong = await toast(page, "Password incorrect; the finding was not signed off");
    check("3a. a wrong password: refused on screen, the finding stays open", saidWrong && readFinding(findingId)?.status === "open" && !readFinding(findingId)?.signed_by, JSON.stringify(readFinding(findingId)));
    await page.getByTestId("finding-signoff-password").fill(PW);
    await page.getByTestId("finding-signoff-sign").click();
    const done = page.getByText("Signed off by the medical director", { exact: false });
    await done.waitFor({ timeout: 20000 }).catch(() => {});
    const fr = readFinding(findingId);
    check("3b. the right password signs off: closed, the typed name stored, signed with a password", (await done.count()) > 0 && fr?.status === "closed" && fr?.signed_by === "Jordan Ellis, MD" && fr?.signoff_role === "medical_director" && fr?.signed_with === "password", JSON.stringify(fr));
    await done.first().scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: `${OUT}/finding-signoff-after-light-1280.png` });
    resetFinding();
  }
  await ctx.close();
}

// ── 4. A hospital that requires single sign-on ───────────────────────────
for (const [path, btn, ids, shot] of [
  [`/labs/${lab2}/veritaqc-app/review`, "qc-cosign-button", ["qc-cosign-name", "qc-cosign-password", "qc-cosign-sign-with-hospital"], "qc-cosign-dialog-hospital-light-1280"],
  [`/labs/${lab2}/veritaresponse/${finding2Id}`, "finding-signoff-btn", ["finding-signoff-name", "finding-signoff-password", "finding-signoff-sign-with-hospital"], "finding-signoff-dialog-hospital-light-1280"],
]) {
  const { ctx, page } = await open(hospReg, lab2, path, "light", 1280);
  const b = page.getByTestId(btn);
  await b.waitFor({ timeout: 30000 }).catch(() => {});
  const label = (await b.count()) ? (await b.innerText()).trim() : "";
  if (await b.count()) { await b.scrollIntoViewIfNeeded(); await b.click(); }
  await page.getByTestId(ids[2]).waitFor({ timeout: 15000 }).catch(() => {});
  const f = await dialogFacts(page, ...ids);
  check(`4. ${btn}: a hospital that requires single sign-on shows "Sign with Example Hospital" in place of the password (owner override)`,
    /owner override/.test(label) && f.name === 1 && f.password === 0 && f.hospital === 1 && f.text.includes("Sign with Example Hospital") && f.text.includes("Your Example Hospital sign-in"),
    `${label} | ${JSON.stringify({ ...f, dlg: undefined, text: f.text.slice(0, 200) })}`);
  await f.dlg.screenshot({ path: `${OUT}/${shot}.png` }).catch(() => {});
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
