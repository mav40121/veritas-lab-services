// scripts/verify-veritamap-attest-one-sided-ui.mjs
//
// Browser receipt for VeritaMap reference range attestation on one-sided ranges and multi-band tests (Heywood,
// 2026-11-21). LOCAL production build + scratch DB only (account, lab, map and ranges are local test data). Drives the
// real map page:
//   1. Cholesterol, one-sided (high 200, no low): the "Attest reference range" link is offered; attest; the badge shows;
//      after going back in it still shows (on main the link never appeared and the route answered 400)
//   2. Creatinine, two bands: the band picker says "attested on 0 of 2 bands"; attest the band picked; going back in it
//      says "1 of 2" and the locked band's chip reads "(locked)"
//   3. Sodium, one All-ages band: unchanged, attests as before; no band line (one band, no picker)
//   5. the sign-off form filled in and then Save values clicked (not Attest and lock): the attestation is recorded,
//      "2 of 2" after going back in (on main, Save values dropped the filled form; Heywood held 0 attestations)
//   4. light, dark and 390px; no horizontal page scroll
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritamap-attest-one-sided-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };

const email = `attest-one-sided-ui-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Zq", "attest", "7x!"].join("-"), name: "Jordan Ellis", hipaa_acknowledged: true });
const token = reg.body?.token, user = reg.body?.user, uid = user?.id;
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Sample Regional Medical Center (QA)", plan: "hospital" })).body?.labId;
scratch((d) => { d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid); d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab); });
const L = `/api/labs/${lab}/veritamap`;
const map = (await call("POST", `${L}/maps`, { name: "QA Chemistry" }, token)).body;
const inst = (await call("POST", `${L}/maps/${map.id}/instruments`, { instrument_name: "Vitros 5600", role: "Primary", category: "Chemistry" }, token)).body;
await call("PUT", `${L}/maps/${map.id}/instruments/${inst.id}/tests`, { tests: ["Sodium", "Creatinine", "Cholesterol"].map((a) => ({ analyte: a, specialty: "Routine Chemistry", complexity: "MODERATE", active: 1 })) }, token);
const put = (a, body) => call("PUT", `${L}/maps/${map.id}/analyte-values/${encodeURIComponent(a)}`, body, token);
const w = [
  await put("Sodium", { ref_range_low: "136", ref_range_high: "145", units: "mmol/L" }),
  await put("Creatinine", { ref_range_low: "0.7", ref_range_high: "1.3", units: "mg/dL", age_min_days: "6570", age_max_days: "999999", sex: "M", specimen_type: "" }),
  await put("Creatinine", { ref_range_low: "0.6", ref_range_high: "1.1", units: "mg/dL", age_min_days: "6570", age_max_days: "999999", sex: "F", specimen_type: "" }),
  await put("Cholesterol", { ref_range_low: "", ref_range_high: "200", units: "mg/dL" }),
];
check("0. QA lab with Sodium (one band), Creatinine (two bands) and Cholesterol (one-sided)", !!lab && !!map?.id && w.every((r) => r.status === 200), w.map((r) => r.status).join("/"));

const browser = await chromium.launch();
const signedIn = async (scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on("dialog", async (d) => { console.log(`DIALOG ${d.message()}`); await d.dismiss(); });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, user, lab]);
  return { ctx, page };
};
const openRow = async (page, analyte) => {
  await page.goto(`${BASE}/labs/${lab}/veritamap-app/${map.id}`, { waitUntil: "networkidle" });
  await page.locator("tbody tr").filter({ hasText: analyte }).first().getByTitle("Enter reference range, critical values, AMR").click();
  await page.getByText(`Lab-Established Values for ${analyte}`).waitFor({ timeout: 15000 });
};
const attestHere = async (page) => {
  const resp = page.waitForResponse((r) => r.url().includes("/attest-ref"));
  await page.getByText("Attest reference range (director or designee)").click();
  await page.getByPlaceholder("e.g. M. Veri").fill("C. Example");
  await page.getByPlaceholder("Medical director or designee").fill("Chemistry Supervisor");
  await page.getByRole("button", { name: "Attest and lock" }).click();
  return (await resp).status();
};
const badge = (page) => page.getByText(/Reference range attested per 42 CFR 493.1253/).count();
const bandLine = (page) => page.getByTestId("band-attest-count").innerText().catch(() => "");
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// Frame the open values panel (the page's own banner fills the first screen).
const shot = async (page, name) => {
  await page.getByText(/Lab-Established Values for/i).first().evaluate((el) => { el.scrollIntoView({ block: "start" }); window.scrollBy(0, -120); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}` });
};

{
  const { ctx, page } = await signedIn("light", 1280);
  // 1. one-sided
  await openRow(page, "Cholesterol");
  check("1a. Cholesterol (high 200, no low): Attest link offered", (await page.getByText("Attest reference range (director or designee)").count()) > 0);
  check("1b. attest answers 200", (await attestHere(page)) === 200);
  await page.waitForTimeout(800);
  check("1c. badge shows right after attesting", (await badge(page)) > 0);
  await shot(page, "1-cholesterol-one-sided-attested-light.png");
  await openRow(page, "Cholesterol");
  check("1d. badge still shows after going back in", (await badge(page)) > 0);

  // 2. two bands
  await openRow(page, "Creatinine");
  check("2a. Creatinine: band line reads 0 of 2", /attested on 0 of 2 bands/.test(await bandLine(page)), await bandLine(page));
  await shot(page, "2a-creatinine-0-of-2-light.png");
  check("2b. attest the band picked: 200", (await attestHere(page)) === 200);
  await page.waitForTimeout(800);
  check("2c. band line reads 1 of 2 right after", /attested on 1 of 2 bands/.test(await bandLine(page)), await bandLine(page));
  await openRow(page, "Creatinine");
  const chips = await page.locator("button").filter({ hasText: /18 y and older/ }).allInnerTexts();
  check("2d. after going back in: 1 of 2, and one chip reads (locked)", /attested on 1 of 2 bands/.test(await bandLine(page)) && chips.filter((c) => c.includes("(locked)")).length === 1, `${await bandLine(page)} | ${JSON.stringify(chips)}`);
  await shot(page, "2d-creatinine-1-of-2-after-reopen-light.png");

  // 3. single band unchanged
  await openRow(page, "Sodium");
  check("3a. Sodium: no band line (one band)", (await page.getByTestId("band-attest-count").count()) === 0);
  check("3b. Sodium attests as before: 200, badge shows", (await attestHere(page)) === 200 && (await page.waitForTimeout(800), await badge(page)) > 0);

  // 5. the sign-off form filled in, then Save values (not Attest and lock): the attestation is recorded
  await openRow(page, "Creatinine");
  await page.locator("button").filter({ hasText: /18 y and older/ }).filter({ hasNotText: "(locked)" }).first().click();
  await page.getByText("Attest reference range (director or designee)").click();
  await page.getByPlaceholder("e.g. M. Veri").fill("C. Example");
  await page.getByPlaceholder("Medical director or designee").fill("Chemistry Supervisor");
  const viaSave = page.waitForResponse((r) => r.url().includes("/attest-ref"), { timeout: 8000 }).then((r) => r.status()).catch(() => 0);
  await page.getByRole("button", { name: "Save values" }).click();
  check("5a. Save values with the sign-off form filled sends the attestation: 200", (await viaSave) === 200);
  await openRow(page, "Creatinine");
  check("5b. after going back in: attested on 2 of 2 bands", /attested on 2 of 2 bands/.test(await bandLine(page)), await bandLine(page));
  await shot(page, "5-creatinine-2-of-2-via-save-values-light.png");
  await ctx.close();
}
{
  const { ctx, page } = await signedIn("dark", 1280);
  await openRow(page, "Creatinine");
  check("4a. dark: band line shows", /attested on 2 of 2 bands/.test(await bandLine(page)));
  await shot(page, "4a-creatinine-dark.png");
  await ctx.close();
}
{
  const { ctx, page } = await signedIn("light", 390);
  await openRow(page, "Creatinine");
  check("4b. 390px: band line shows, no horizontal page scroll", /attested on 2 of 2 bands/.test(await bandLine(page)) && (await noScroll(page)));
  await shot(page, "4b-creatinine-390.png");
  await ctx.close();
}
await browser.close();
console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAIL`}`);
process.exit(failures === 0 ? 0 : 1);
