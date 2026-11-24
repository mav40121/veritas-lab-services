// scripts/verify-attest-button-reason-ui.mjs
//
// Browser receipt for the reason beside VeritaMap's two grey sign-off buttons (Heywood 2026-11-23: "Attest and Lock is
// greyed out"; the name and title boxes were empty and nothing said so). LOCAL production build + scratch DB only
// (account, lab, map and values are local test data). Drives the real map page:
//   1. Attest form just opened: button off, reason shown, tied to the button (aria-describedby)
//   2. name only: still off, reason still shown; name and title: on, reason gone
//   3. blanks only in both boxes: off, reason shown (the button trims)
//   4. Attest and lock records it (200) and the badge shows
//   5. MEC review form: the same three states, then Record review records it (200)
//   6. (the AMR sign-off is this same form, so it has the same reason)
//   7. dark and 390px: no horizontal page scroll
// Run: PW_BASE=http://localhost:5323 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-attest-button-reason-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };

const email = `attest-reason-ui-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Zq", "attest", "7x!"].join("-"), name: "Jordan Ellis", hipaa_acknowledged: true });
const token = reg.body?.token, user = reg.body?.user, uid = user?.id;
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Sample Regional Medical Center (QA)", plan: "hospital" })).body?.labId;
scratch((d) => { d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid); d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab); });
const L = `/api/labs/${lab}/veritamap`;
const map = (await call("POST", `${L}/maps`, { name: "QA Chemistry" }, token)).body;
const inst = (await call("POST", `${L}/maps/${map.id}/instruments`, { instrument_name: "Vitros 5600", role: "Primary", category: "Chemistry" }, token)).body;
await call("PUT", `${L}/maps/${map.id}/instruments/${inst.id}/tests`, { tests: ["Sodium"].map((a) => ({ analyte: a, specialty: "Routine Chemistry", complexity: "MODERATE", active: 1 })) }, token);
const put = await call("PUT", `${L}/maps/${map.id}/analyte-values/Sodium`, { ref_range_low: "136", ref_range_high: "145", critical_low: "120", critical_high: "160", units: "mmol/L" }, token);
check("0. QA lab with Sodium, a reference range and critical values", !!lab && !!map?.id && put.status === 200, String(put.status));

const browser = await chromium.launch();
const signedIn = async (scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on("dialog", async (d) => { console.log(`DIALOG ${d.message()}`); await d.dismiss(); });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l, s]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); if (s === "dark") localStorage.setItem("theme", "dark"); }, [token, user, lab, scheme]);
  return { ctx, page };
};
const openRow = async (page) => {
  await page.goto(`${BASE}/labs/${lab}/veritamap-app/${map.id}`, { waitUntil: "networkidle" });
  await page.locator("tbody tr").filter({ hasText: "Sodium" }).first().getByTitle("Enter reference range, critical values, AMR").click();
  await page.getByText("Lab-Established Values for Sodium").waitFor({ timeout: 15000 });
};
const shot = async (page, name) => { await page.locator("#attest-hint, #mec-review-hint").first().evaluate((el) => el.scrollIntoView({ block: "center" })); await page.screenshot({ path: `${OUT}/${name}.png` }); };
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const ATTEST = "Fill in the name and title to turn on Attest and lock.", MEC = "Fill in the date and Recorded by to turn on Record review.";

const { ctx, page } = await signedIn("light", 1280);
await openRow(page);
await page.getByText("Attest reference range (director or designee)").click();
const btn = page.getByRole("button", { name: "Attest and lock" });
const name = page.getByPlaceholder("e.g. M. Veri"), title = page.getByPlaceholder("Medical director or designee");
check("1a. just opened: Attest and lock is off and the reason shows", (await btn.isDisabled()) && (await page.getByText(ATTEST).isVisible()));
check("1b. the reason is tied to the button for a screen reader", (await btn.getAttribute("aria-describedby")) === "attest-hint" && (await page.locator("#attest-hint").innerText()).includes(ATTEST));
await shot(page, "01-attest-open");
await name.fill("C. Example");
check("2a. name only: still off, reason still shows", (await btn.isDisabled()) && (await page.getByText(ATTEST).isVisible()));
await title.fill("Chemistry Supervisor");
check("2b. name and title: on, reason gone, the CFR line stays", (await btn.isEnabled()) && (await page.getByText(ATTEST).count()) === 0 && (await page.getByText("Verified per 42 CFR 493.1253. Locks the value; owner or admin can unlock.").isVisible()));
await shot(page, "02-attest-filled");
await name.fill("   "); await title.fill("   ");
check("3. blanks only: off, reason shows", (await btn.isDisabled()) && (await page.getByText(ATTEST).isVisible()));
await name.fill("C. Example"); await title.fill("Chemistry Supervisor");
const resp = page.waitForResponse((r) => r.url().includes("/attest-ref"));
await btn.click();
check("4. Attest and lock records it and the badge shows", (await resp).status() === 200 && (await page.getByText(/Reference range attested per 42 CFR 493.1253/).first().waitFor({ timeout: 10000 }).then(() => true, () => false)));

await page.getByText("Record MEC review of critical values").click();
const rec = page.getByRole("button", { name: "Record review" });
check("5a. MEC form just opened: Record review is off, the reason shows and is tied to it", (await rec.isDisabled()) && (await page.getByText(MEC).isVisible()) && (await rec.getAttribute("aria-describedby")) === "mec-review-hint");
await shot(page, "03-mec-open");
const mecBox = page.locator("div", { has: page.locator("#mec-review-hint") }).last();
await mecBox.locator("input[type=date]").fill("2026-11-20");
check("5b. date only: still off, reason still shows", (await rec.isDisabled()) && (await page.getByText(MEC).isVisible()));
await mecBox.getByPlaceholder("Name or initials").fill("CE");
check("5c. date and Recorded by: on, reason gone", (await rec.isEnabled()) && (await page.getByText(MEC).count()) === 0);
const mecResp = page.waitForResponse((r) => r.url().includes("/mec-review"));
await rec.click();
check("5d. Record review records it", (await mecResp).status() === 200);

await ctx.close();

for (const [scheme, width] of [["dark", 1280], ["light", 390]]) {
  const s = await signedIn(scheme, width);
  scratch((d) => d.prepare("UPDATE veritamap_analyte_values SET ref_locked = 0, ref_attested_by = NULL, ref_attested_title = NULL, ref_attested_at = NULL WHERE map_id = ?").run(map.id));
  await openRow(s.page);
  await s.page.getByText("Attest reference range (director or designee)").click();
  check(`7. ${scheme} ${width}px: reason shows, no horizontal page scroll`, (await s.page.getByText(ATTEST).isVisible()) && (await noScroll(s.page)));
  await shot(s.page, `04-${scheme}-${width}`);
  await s.ctx.close();
}
await browser.close();
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
