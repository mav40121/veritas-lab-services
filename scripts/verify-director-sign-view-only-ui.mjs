// scripts/verify-director-sign-view-only-ui.mjs
//
// Browser receipt for BUG-204 (server/qualifiedSigning.ts): the medical director on a view-only seat co-signs the monthly QC review
// from the VeritaQC Review & Sign-off screen. LOCAL server on a scratch DB only; made-up lab, people and lots.
//   1. as the view-only director, the Monthly Review card shows "Co-sign as Medical Director" on a filed review, while File
//      attestation stays disabled and the co-sign setting isn't offered (their seat edits nothing)
//   2. the click opens the signing dialog and the director's name and password co-sign (BUG-205): the card reads "Medical
//      Director co-signed by ...", and the stored review names the director
//   Screenshots of the card, light and dark, at 1280 and at phone width (390).
//   3. the same director sees a finding's sign-off button (and it closes the finding) and the monthly record review's Sign review
// Run: PW_BASE=http://localhost:<port> SCRATCH_DB=<db the server uses> OUT=<dir> node scripts/verify-director-sign-view-only-ui.mjs
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

const stamp = Date.now();
const PW = ["Zq", "cosign", "7x!"].join("-");
const ownerEmail = `dsvo-owner-${stamp}@example.com`, mdEmail = `dsvo-director-${stamp}@example.com`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: PW, name: "Avery Owner", hipaa_acknowledged: true })).body;
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Sample Regional Medical Center (co-sign QA)", plan: "hospital" })).body?.labId;
const mdReg = (await call("POST", "/api/auth/register", { email: mdEmail, password: PW, name: "Jordan Ellis, MD", hipaa_acknowledged: true })).body;
{
  const now = new Date().toISOString();
  const d = new Database(process.env.SCRATCH_DB);
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id IN (?, ?)").run(owner.user.id, mdReg.user.id);
  d.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(lab, mdReg.user.id);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, medical_director_email = ?, qc_md_cosign_required = 1, clia_number = ? WHERE id = ?").run(mdEmail, `99D${String(stamp).slice(-7)}`, lab);
  d.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'staff','active',1,?,?,?)").run(lab, mdReg.user.id, now, now, now);
  // The director's seat is VIEW-ONLY: they review and sign, they don't enter data.
  d.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type)
    VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'view_only')`).run(owner.user.id, mdEmail, mdReg.user.id, now, now, `dsvo-md-${stamp}`, lab);
  d.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(mdReg.user.id);
  d.close();
}
const md = (await call("POST", "/api/auth/login", { email: mdEmail, password: PW })).body;
const T = owner.token, L = `/api/labs/${lab}`;
// The owner (a writer) adds a lot and files this month's review, as the reviewer would.
const lotRes = await call("POST", `${L}/qc/control-lots`, { analyte: "Glucose", level: "Level 1", lot_number: "GL-1-4471", mfr_mean: 100, mfr_sd: 2, manufacturer: "Made-up Controls" }, T);
const lotId = lotRes.body?.lot?.id;
const now = new Date();
const year = now.getFullYear(), month = now.getMonth() + 1;
const filed = await call("POST", `${L}/qc/period-reviews`, { control_lot_id: lotId, period_year: year, period_month: month, attestation_acknowledged: true, review_notes: "Made-up month, no rejections" }, T);
const seatType = md?.user?.seatType ?? null;
check("0. a lab, a filed review for this month, and a director signed in on a view-only seat", !!lab && !!lotId && filed.status === 200 && !!md?.token, `${lab} ${lotId} ${filed.status} ${seatType}`);

const browser = await chromium.launch();
const open = async (scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true }));
    localStorage.setItem("veritas_active_lab_id", String(l));
  }, [md.token, md.user, lab]);
  await page.goto(`${BASE}/labs/${lab}/veritaqc-app/review`, { waitUntil: "networkidle" });
  return { ctx, page };
};
// BUG-205: the button opens the signing dialog; the director types their name and password and signs there.
const signInDialog = async (page, prefix, name) => {
  await page.getByTestId(`${prefix}-name`).waitFor({ timeout: 15000 }).catch(() => {});
  await page.getByTestId(`${prefix}-name`).fill(name);
  await page.getByTestId(`${prefix}-password`).fill(PW);
  await page.getByTestId(`${prefix}-sign`).click();
};
// The Monthly Review card itself (the site header is sticky, so a full-page capture would paint it over the middle).
const card = (page) => page.getByText("Monthly Review & Attestation", { exact: true }).locator("xpath=ancestor::div[contains(@class,'border')][1]");
const shot = async (page, name) => {
  const c = card(page);
  await c.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await c.screenshot({ path: `${OUT}/${name}.png` });
};

const views = [["light", 1280], ["dark", 1280], ["light", 390], ["dark", 390]];
for (const [scheme, width] of views) {
  const { ctx, page } = await open(scheme, width);
  const button = page.getByTestId("qc-cosign-button");
  await button.waitFor({ timeout: 30000 }).catch(() => {});
  const label = (await button.count()) ? (await button.innerText()).trim() : "";
  const fileBtn = page.getByRole("button", { name: "File attestation" });
  const fileDisabled = (await fileBtn.count()) ? await fileBtn.isDisabled() : false;
  const settingShown = await page.getByText("Require a Medical Director co-signature after the reviewer files", { exact: false }).count();
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  check(`1. ${scheme} ${width}: "Co-sign as Medical Director" shows; File attestation disabled; the setting not offered`, label === "Co-sign as Medical Director" && fileDisabled && settingShown === 0 && dark === (scheme === "dark"), `${label} | ${fileDisabled} | ${settingShown} | dark=${dark}`);
  await shot(page, `qc-cosign-view-only-${scheme}-${width}`);
  if (scheme === "light" && width === 1280) {
    await button.click();
    await signInDialog(page, "qc-cosign", "Jordan Ellis, MD");
    const signedLine = page.getByText("Medical Director co-signed by", { exact: false });
    await signedLine.waitFor({ timeout: 20000 }).catch(() => {});
    const text = (await signedLine.count()) ? (await signedLine.innerText()).trim() : "";
    const d = new Database(process.env.SCRATCH_DB, { readonly: true });
    const row = d.prepare("SELECT md_signed_by_user_id, md_signed_name, md_signed_at FROM qc_period_reviews WHERE lab_id = ? AND control_lot_id = ? AND period_year = ? AND period_month = ?").get(lab, lotId, year, month);
    d.close();
    check("2. the click co-signs: the card says so and the stored review names the view-only director", /co-signed by Jordan Ellis, MD/.test(text) && row?.md_signed_by_user_id === mdReg.user.id && !!row?.md_signed_at, `${text} | ${JSON.stringify(row)}`);
    await shot(page, "qc-cosign-view-only-after-light-1280");
    // Reset the co-signature so the other views show the button again.
    const w = new Database(process.env.SCRATCH_DB);
    w.prepare("UPDATE qc_period_reviews SET md_signed_at = NULL, md_signed_by_user_id = NULL, md_signed_name = NULL WHERE lab_id = ? AND control_lot_id = ?").run(lab, lotId);
    w.close();
  }
  await ctx.close();
}
{
  // The signed state in dark at phone width, after co-signing again.
  const { ctx, page } = await open("dark", 390);
  await page.getByTestId("qc-cosign-button").click();
  await signInDialog(page, "qc-cosign", "Jordan Ellis, MD");
  await page.getByText("Medical Director co-signed by", { exact: false }).waitFor({ timeout: 20000 }).catch(() => {});
  check("2. dark 390: the co-signed line shows after the click", (await page.getByText("Medical Director co-signed by", { exact: false }).count()) === 1);
  await shot(page, "qc-cosign-view-only-after-dark-390");
  await ctx.close();
}

// 3. The other signatures on the list show their buttons to the same view-only director: a finding's sign-off, and the
// VeritaMaintain monthly review (light 1280). Their records are made-up rows on the scratch DB.
let findingId, equipmentId;
{
  const now = new Date().toISOString();
  const d = new Database(process.env.SCRATCH_DB);
  findingId = Number(d.prepare("INSERT INTO findings (user_id, lab_id, accreditor, status, created_at, updated_at) VALUES (?, ?, 'CAP', 'open', ?, ?)").run(owner.user.id, lab, now, now).lastInsertRowid);
  equipmentId = Number(d.prepare("INSERT INTO lab_equipment (lab_id, instrument_name, status, created_at, updated_at) VALUES (?, 'Made-up Centrifuge', 'active', '2025-01-01T00:00:00.000Z', ?)").run(lab, now).lastInsertRowid);
  d.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => {
    localStorage.setItem("veritas_token", t);
    localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true }));
    localStorage.setItem("veritas_active_lab_id", String(l));
  }, [md.token, md.user, lab]);
  await page.goto(`${BASE}/labs/${lab}/veritaresponse/${findingId}`, { waitUntil: "networkidle" });
  const fBtn = page.getByTestId("finding-signoff-btn");
  await fBtn.waitFor({ timeout: 30000 }).catch(() => {});
  const fLabel = (await fBtn.count()) ? (await fBtn.innerText()).trim() : "";
  await fBtn.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${OUT}/finding-signoff-view-only-light-1280.png` });
  if (await fBtn.count()) { await fBtn.click(); await signInDialog(page, "finding-signoff", "Jordan Ellis, MD"); }
  await page.getByText("Signed off by the medical director", { exact: false }).waitFor({ timeout: 20000 }).catch(() => {});
  const d = new Database(process.env.SCRATCH_DB, { readonly: true });
  const f = d.prepare("SELECT status, signoff_role, signed_by FROM findings WHERE id = ?").get(findingId);
  d.close();
  check("3a. the finding's sign-off button shows to the view-only director and closes the finding", fLabel === "Sign off and close as medical director" && f?.status === "closed" && f?.signoff_role === "medical_director", `${fLabel} | ${JSON.stringify(f)}`);
  await page.screenshot({ path: `${OUT}/finding-signoff-view-only-after-light-1280.png` });

  await page.goto(`${BASE}/labs/${lab}/equipment-app`, { waitUntil: "networkidle" });
  const mBtn = page.getByTestId("review-open-sign");
  await mBtn.waitFor({ timeout: 30000 }).catch(() => {});
  const mLabel = (await mBtn.count()) ? (await mBtn.innerText()).trim() : "";
  await mBtn.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${OUT}/maintain-review-view-only-light-1280.png` });
  check("3b. the monthly record review's Sign review button shows to the view-only director", /^Sign review \(\d+\)$/.test(mLabel), mLabel);
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
