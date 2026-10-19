// scripts/verify-veritamap-specimen-ui.mjs
//
// Browser receipt for VeritaMap specimen-type bands and the reportable range (2026-10-19, Lindsay Webber,
// Redington-Fairview, REQ-079 / REQ-080). LOCAL production build + scratch DB only (account, lab, map and values are
// local test data). Drives the real map page:
//   1. Calcium: "+ Add band (age, sex or specimen)" with specimen Urine and no age limit -> a urine band beside All ages
//   2. on the urine band: reference range, AMR, reportable range and maximum dilution typed in and autosaved to the
//      urine rows only; the AMR panel says it is for Urine only
//   3. switching back to All ages shows the all-specimen AMR and reportable range, not the urine ones
//   4. the Excel export carries the urine row with its values
//   5. light, dark and 390px; no horizontal page scroll; no CSP violations
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritamap-specimen-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, r, body: await r.clone().json().catch(() => ({})) }; };
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const email = `specimen-ui-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Zq", "spec", "7x!"].join("-"), name: "Jordan Ellis", hipaa_acknowledged: true });
const token = reg.body?.token, user = reg.body?.user, uid = user?.id;
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center (QA)", plan: "hospital" })).body?.labId;
scratch((d) => { d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid); d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab); });
const L = `/api/labs/${lab}/veritamap`;
const map = (await call("POST", `${L}/maps`, { name: "QA Chemistry" }, token)).body;
const inst = (await call("POST", `${L}/maps/${map.id}/instruments`, { instrument_name: "Vitros 5600", role: "Primary", category: "Chemistry" }, token)).body;
await call("PUT", `${L}/maps/${map.id}/instruments/${inst.id}/tests`, { tests: [{ analyte: "Calcium", specialty: "Routine Chemistry", complexity: "MODERATE", active: 1 }] }, token);
await call("PUT", `${L}/maps/${map.id}/analyte-values/Calcium`, { ref_range_low: "8.6", ref_range_high: "10.3", units: "mg/dL" }, token);
await call("PUT", `${L}/maps/${map.id}/amr-values/${inst.id}/Calcium`, { amr_low: "1.0", amr_high: "14.0", reportable_low: "1.0", reportable_high: "28.0", max_dilution: "1:2" }, token);
check("0. QA lab with a Calcium test, its all-specimen values and AMR", !!lab && !!map?.id && !!inst?.id);

const browser = await chromium.launch();
const csp = [];
const signedIn = async (scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [token, user, lab]);
  return { ctx, page };
};
const openCalcium = async (page) => {
  await page.goto(`${BASE}/labs/${lab}/veritamap-app/${map.id}`, { waitUntil: "networkidle" });
  await page.locator("tbody tr").filter({ hasText: "Calcium" }).first().getByTitle("Enter reference range, critical values, AMR").click();
  await page.getByText("Lab-Established Values for Calcium").waitFor({ timeout: 15000 });
};
const noScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

{
  const { ctx, page } = await signedIn("light", 1280);
  await openCalcium(page);
  await page.getByText("+ Add band (age, sex or specimen)").click();
  await page.getByPlaceholder("blank = no limit").fill(""); // to-age blank = no upper limit
  await page.getByTestId("new-band-specimen").fill("Urine");
  await page.getByRole("button", { name: "Add band", exact: true }).click();
  const chip = page.getByRole("button", { name: /All ages · Urine/ });
  await chip.waitFor({ timeout: 15000 });
  check("1. a urine band appears beside All ages", (await page.getByRole("button", { name: /^All ages$/ }).count()) === 1 && (await chip.count()) === 1);
  const hint = await page.getByTestId("amr-specimen-hint").innerText().catch(() => "");
  check("2a. the AMR panel says it is for Urine only", /For Urine only/.test(hint), hint);
  await page.getByPlaceholder("e.g. 136").first().fill("100");
  await page.getByPlaceholder("e.g. 145").first().fill("300");
  await page.getByTestId(`amr-low-${inst.id}`).fill("0.5");
  await page.getByTestId(`amr-high-${inst.id}`).fill("20");
  await page.getByTestId(`reportable-low-${inst.id}`).fill("0.5");
  await page.getByTestId(`reportable-high-${inst.id}`).fill("200");
  await page.getByTestId(`max-dilution-${inst.id}`).fill("1:10");
  await sleep(4000); // autosave debounce is 1.5 s
  const rows = scratch((d) => ({
    av: d.prepare("SELECT specimen_type, ref_range_low, ref_range_high FROM veritamap_analyte_values WHERE map_id = ? AND analyte = 'Calcium' ORDER BY specimen_type").all(map.id),
    amr: d.prepare("SELECT specimen_type, amr_low, amr_high, reportable_low, reportable_high, max_dilution FROM veritamap_amr_values WHERE map_id = ? AND analyte = 'Calcium' ORDER BY specimen_type").all(map.id),
  }));
  const avU = rows.av.find((r) => r.specimen_type === "Urine"), avA = rows.av.find((r) => r.specimen_type === "");
  const amrU = rows.amr.find((r) => r.specimen_type === "Urine"), amrA = rows.amr.find((r) => r.specimen_type === "");
  check("2b. the urine reference range autosaved to the urine band only", avU?.ref_range_low === "100" && avU?.ref_range_high === "300" && avA?.ref_range_low === "8.6", JSON.stringify(rows.av));
  check("2c. the urine AMR, reportable range and maximum dilution autosaved to the urine row only",
    amrU?.amr_low === "0.5" && amrU?.reportable_high === "200" && amrU?.max_dilution === "1:10" && amrA?.amr_low === "1.0" && amrA?.reportable_high === "28.0", JSON.stringify(rows.amr));
  await page.screenshot({ path: `${OUT}/specimen-urine-band-light.png` });
  await page.getByRole("button", { name: /^All ages$/ }).click();
  await sleep(500);
  const shown = [await page.getByTestId(`amr-low-${inst.id}`).inputValue(), await page.getByTestId(`reportable-high-${inst.id}`).inputValue(), await page.getByTestId(`max-dilution-${inst.id}`).inputValue()];
  check("3. switching to All ages shows the all-specimen AMR and reportable range", shown.join("|") === "1.0|28.0|1:2", shown.join("|"));
  await ctx.close();
}

{
  const xl = await call("POST", `${L}/maps/${map.id}/excel`, {}, token);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await xl.r.arrayBuffer()));
  let head = [];
  const out = [];
  for (const ws of wb.worksheets) {
    ws.eachRow((row) => {
      const v = Array.from(row.values, (x) => (x && typeof x === "object" && "richText" in x ? x.richText.map((y) => y.text).join("") : String(x ?? "")));
      if (!head.length) { if (v.includes("Specimen Type")) head = v; return; }
      out.push(Object.fromEntries(head.map((h, i) => [h, v[i]])));
    });
    if (head.length) break;
  }
  const u = out.find((r) => r.Analyte === "Calcium" && r["Specimen Type"] === "Urine");
  check("4. the export carries the urine row with its values", u?.["Reference Range Low"] === "100" && u?.["AMR High (per instrument)"] === "20" && u?.["Reportable Range High (per instrument)"] === "200" && u?.["Maximum Dilution (per instrument)"] === "1:10", JSON.stringify(u ?? {}).slice(0, 200));
}

for (const [scheme, width] of [["dark", 1280], ["light", 390], ["dark", 390]]) {
  const { ctx, page } = await signedIn(scheme, width);
  await openCalcium(page);
  await page.getByRole("button", { name: /All ages · Urine/ }).click();
  await sleep(400);
  check(`5. [${scheme} ${width}px] the values panel with the urine band has no horizontal page scroll`, await noScroll(page));
  await page.getByTestId(`amr-card-${inst.id}`).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/specimen-urine-band-${scheme}-${width}.png` });
  await ctx.close();
}

check("6. no Content-Security-Policy violations", csp.length === 0, csp.slice(0, 1).join(""));
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
