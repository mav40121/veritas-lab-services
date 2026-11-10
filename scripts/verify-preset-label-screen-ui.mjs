// scripts/verify-preset-label-screen-ui.mjs
// Browser receipt for Q275 = 1 and BUG-159 on the results screen: the User Specifications card prints the preset name
// beside the criterion only when that preset is the stored criterion (shared/studyCriterion.ts printedPresetLabel, the PDF's
// rule). On a local production build with a scratch DB and made-up studies:
//   S1. a method comparison "T3 Uptake" labeled ALT/SGPT with a stored ±15% and no floor: the card reads ±15% with no ALT/SGPT;
//   S2. a Glucose method comparison with its own preset: the card still names Glucose (±8% or ±6 mg/dL);
//   S3. a linearity HbA1c stored ±8% labeled ALT/SGPT: neither the card nor the linearity summary names ALT/SGPT;
//   S4. a PT/INR study saved with the picker's ALT/SGPT label: no ALT/SGPT on its results page (BUG-159);
//   S5. dark mode and phone width; no page errors.
// Run: UI_REPO=<worktree> UI_PORT=<port> UI_SCRIPT=verify-preset-label-screen-ui.mjs UI_OUT=preset_label UI_DB=preset_label.db bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token, labId) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return j;
};
const sql = (q, ...a) => { const d = new Database(process.env.SCRATCH_DB); try { return d.prepare(q).run(...a); } finally { d.close(); } };
const ALT = "ALT/SGPT (±15% or ±6 U/L)", GLUCOSE = "Glucose (±8% or ±6 mg/dL)";
const email = `preset-label-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Preset", "label", "275!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Label Lab", plan: "hospital" })).labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999275' WHERE id = ?", labId);
const save = async (o) => (await call("POST", `/api/labs/${labId}/studies`, { instrument: "Analyzer A", analyst: "Made Up", date: "2026-11-10", status: "pass", createdAt: new Date().toISOString(), teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, ...o }, reg.token, labId)).id;
const mcPts = JSON.stringify([5, 20, 45, 80, 120].map((v, i) => ({ level: i + 1, expectedValue: v, instrumentValues: { "Analyzer B": +(v * 1.03).toFixed(2) } })));
const t3 = await save({ testName: "Made-up T3 Uptake", studyType: "method_comparison", cliaAllowableError: 0.15, cliaPresetLabel: ALT, instruments: JSON.stringify(["Analyzer A", "Analyzer B"]), dataPoints: mcPts });
const glu = await save({ testName: "Made-up Glucose", studyType: "method_comparison", cliaAllowableError: 0.08, cliaAbsoluteFloor: 6, cliaAbsoluteUnit: "mg/dL", cliaPresetLabel: GLUCOSE, instruments: JSON.stringify(["Analyzer A", "Analyzer B"]), dataPoints: mcPts });
const linData = JSON.stringify({ analyte: "HbA1c", units: "%", levels: [5, 7, 9, 11].map((a, i) => ({ name: `L${i + 1}`, assigned_value: a, replicates: [a * 1.01, a, a * 0.99] })) });
const a1c = await save({ testName: "Made-up HbA1c", studyType: "linearity", cliaAllowableError: 0.08, cliaPresetLabel: ALT, instruments: JSON.stringify(["Analyzer A"]), dataPoints: linData });
check("0. setup: three made-up studies saved", [t3, glu, a1c].every((x) => Number.isInteger(x)), JSON.stringify([t3, glu, a1c]));
// A PT/INR study saved as its form saves it, with the picker's ALT/SGPT label.
// The shape client/src/lib/ptCoagPayload.ts buildPtCoagPayload saves for a Module 1 only study.
const NORMALS = [11.4, 11.8, 12.1, 11.9, 12.3, 11.6, 12.0, 11.7, 12.2, 11.5, 12.4, 11.8, 12.0, 11.9, 12.1, 11.7, 12.2, 11.6, 12.3, 11.8];
const m1 = { ptValues: NORMALS, isi: 0.97, ptRI: { low: 10, high: 14 }, inrRI: { low: 0.9, high: 1.2 } };
const ptPoints = JSON.stringify({ module1Instruments: [{ name: "Analyzer A", ...m1, reagentLot: "LOT-NEW", reagentExp: "2027-06-30" }], module1: m1, module2: null, module3: null, instrument: "Analyzer A", reagentLot: "LOT-NEW", reagentExp: "2027-06-30" });
const pt = await save({ testName: "Made-up PT", studyType: "pt_coag", cliaAllowableError: 0.2, cliaPresetLabel: ALT, instruments: JSON.stringify(["Analyzer A"]), dataPoints: ptPoints });

const browser = await chromium.launch();
const errors = [];
const open = async (id, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.dark ? "dark" : "light", ...((opts.viewport?.width ?? 1280) < 768 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u, dark]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); if (dark) localStorage.setItem("theme", "dark"); }, [reg.token, reg.user, !!opts.dark]);
  await page.goto(`${BASE}/labs/${labId}/study/${id}/results`, { waitUntil: "networkidle" });
  await page.getByText("User Specifications").first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  return { page, ctx };
};
const criterionRow = (page) => page.evaluate(() => {
  const label = Array.from(document.querySelectorAll("span")).find((s) => /^Adopted (Precision )?Acceptance Criterion/.test(s.textContent?.trim() || ""));
  return label?.nextElementSibling?.textContent?.trim() ?? null;
});
const body = (page) => page.locator("body").innerText();

{
  const { page, ctx } = await open(t3);
  const row = await criterionRow(page);
  check("S1. T3 Uptake labeled ALT/SGPT at ±15%: the card reads ±15% with no ALT/SGPT", !!row && /±15(\.0)?%/.test(row) && !row.includes("ALT"), String(row));
  check("S1. ... and no ALT/SGPT anywhere on the page", !(await body(page)).includes("ALT/SGPT"));
  await page.getByText("User Specifications").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "q275-1-mismatch-no-alt.png"), fullPage: false });
  await ctx.close();
}
{
  const { page, ctx } = await open(glu);
  const row = await criterionRow(page);
  check("S2. Glucose with its own preset: the card still names it", !!row && row.includes(`(${GLUCOSE})`), String(row));
  await page.getByText("User Specifications").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "q275-2-matching-glucose.png"), fullPage: false });
  await ctx.close();
}
{
  const { page, ctx } = await open(a1c);
  const text = await body(page);
  check("S3. linearity HbA1c stored ±8% labeled ALT/SGPT: no ALT/SGPT on the page, ±8 shown", !text.includes("ALT/SGPT") && /±8(\.0)?%/.test(text), text.slice(0, 300));
  await ctx.close();
}
{
  const { page, ctx } = await open(pt);
  const text = await body(page);
  const row = await criterionRow(page);
  check("S4. PT/INR saved with the picker's ALT/SGPT label: the page shows its results and User Specifications", text.includes("Geometric Mean") && row !== null, `${String(row)} | ${text.slice(0, 200)}`);
  check("S4. ... with no ALT/SGPT on its results page (BUG-159)", !text.includes("ALT/SGPT"), String(row));
  await ctx.close();
}
{
  const { page, ctx } = await open(t3, { dark: true });
  const row = await criterionRow(page);
  check("S5. dark: the card reads ±15% with no ALT/SGPT", !!row && !row.includes("ALT") && await page.evaluate(() => document.documentElement.classList.contains("dark")), String(row));
  await ctx.close();
}
{
  const { page, ctx } = await open(t3, { viewport: { width: 390, height: 844 } });
  const row = await criterionRow(page);
  check("S5. phone width: the card reads ±15% with no ALT/SGPT", !!row && !row.includes("ALT"), String(row));
  await ctx.close();
}
check("S5. no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
