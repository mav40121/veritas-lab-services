// scripts/verify-chart-dark-ground.mjs
// Gate 3 step 8 receipt (2026-11-08): the linearity, reportable range and heparin range charts on the VeritaCheck results
// screen draw their own white ground, so their dark axis labels stay readable when the app is in dark mode (they sat on
// the dark card before), and the linearity and reportable range legends sit bottom-right, clear of the highest level's
// point (screen and PDF). Run against a LOCAL server on a scratch database with made-up studies (it registers an owner,
// provisions a lab and writes to SCRATCH_DB, so never point it at production):
//   PW_BASE=http://localhost:5199 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-chart-dark-ground.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5199", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const PW = ["Chart", "dark", "77!"].join("-");

const call = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `chart-dark-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Chart Dark UI Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999999' WHERE id = ?").run(labId);
const insert = sdb.prepare(`INSERT INTO studies (user_id, created_by_user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, tea_is_percentage, tea_unit)
  VALUES (@user, @user, @lab, @name, 'Made-up Analyzer A', 'Made-up Analyst', '2026-11-08', @type, @tea, @points, '["Made-up Analyzer A"]', 'pass', '2026-11-08T00:00:00Z', @isPct, @unit)`);
const add = (c) => Number(insert.run({ user: reg.user.id, lab: labId, name: c.test, type: c.type, tea: c.tea, points: JSON.stringify(c.points), isPct: c.pct ? 1 : 0, unit: c.unit }).lastInsertRowid);

const levels = (pairs) => pairs.map(([a, m], i) => ({ name: `L${i + 1}`, assigned_value: a, replicates: [m - 0.3, m, m + 0.3] }));
// 24 made-up heparin samples on a straight aPTT = 40 + 100 x anti-Xa line, patient codes P01 to P24.
const heparinSamples = Array.from({ length: 24 }, (_, i) => {
  const xa = +(0.1 + i * 0.03).toFixed(2);
  return { id: `s${i + 1}`, patientCode: `P${String(i + 1).padStart(2, "0")}`, antiXa: xa, aptt: +(40 + 100 * xa + (i % 3 - 1) * 1.5).toFixed(1), inr: 1.1, plasma: "fresh", exclude: false, excludeReason: "" };
});
const CASES = [
  { file: "linearity", type: "linearity", test: "Sodium", tea: 4, pct: false, unit: "mmol/L", selector: "Regression Plot",
    points: { analyte: "Sodium", units: "mmol/L", levels: levels([[110, 111], [130, 131], [150, 150.5], [170, 171]]) } },
  { file: "reportable-range", type: "reportable_range", test: "Sodium", tea: 4, pct: false, unit: "mmol/L", selector: "svg",
    points: { analyte: "Sodium", units: "mmol/L", claimed_range_low: 100, claimed_range_high: 180, levels: levels([[100, 101], [140, 140.5], [180, 179]]) } },
  { file: "heparin-range", type: "heparin_range", test: "aPTT", tea: 0, pct: true, unit: "%", selector: "hr-result-chart",
    points: { reagentLot: "MADE-UP-1", antiXaMethod: "Made-up anti-Xa", targetLow: 0.3, targetHigh: 0.7, samples: heparinSamples } },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark", acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(`${BASE}/`);
await page.evaluate(([t, u]) => {
  localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1");
}, [reg.token, reg.user]);

for (const c of CASES) {
  const id = add(c);
  await page.goto(`${BASE}/labs/${labId}/study/${id}/results`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.waitForTimeout(300);
  const chart = c.file === "heparin-range" ? page.getByTestId(c.selector).locator("svg").first()
    : c.file === "linearity" ? page.getByText(c.selector, { exact: true }).first().locator("xpath=ancestor::div[contains(@class,'rounded')][1]").locator("svg").first()
    : page.locator("svg[viewBox]").filter({ hasText: "Assigned" }).first();
  await chart.waitFor({ timeout: 20000 });
  const ground = await chart.evaluate((svg) => {
    const r = svg.querySelector("rect");
    const vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
    const w = vb.length === 4 ? vb[2] : Number(svg.getAttribute("width"));
    const h = vb.length === 4 ? vb[3] : Number(svg.getAttribute("height"));
    const card = svg.closest("div[class*='rounded']");
    return { fill: (r?.getAttribute("fill") || "").toLowerCase(), x: r?.getAttribute("x"), y: r?.getAttribute("y"), w: Number(r?.getAttribute("width")), h: Number(r?.getAttribute("height")), vw: w, vh: h,
      dark: document.documentElement.classList.contains("dark"), cardBg: card ? getComputedStyle(card).backgroundColor : "" };
  });
  check(`${c.file}: page is in dark mode (card ${ground.cardBg})`, ground.dark);
  check(`${c.file}: the chart's first shape is a white ground covering the whole chart`,
    ["#ffffff", "#fff", "white"].includes(ground.fill) && ground.x === "0" && ground.y === "0" && ground.w === ground.vw && ground.h === ground.vh, JSON.stringify(ground));
  if (c.file !== "heparin-range") {
    // The legend sat over the top-right corner, where a rising line's highest level lands; it now sits bottom-right.
    const covered = await chart.evaluate((svg) => {
      const box = svg.querySelector("g[transform] > rect")?.getBoundingClientRect();
      if (!box) return -1;
      return Array.from(svg.querySelectorAll("circle")).filter((c) => {
        const r = c.getBoundingClientRect();
        return r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top;
      }).length;
    });
    check(`${c.file}: no data point sits under the legend`, covered === 0, String(covered));
  }
  await chart.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await page.screenshot({ path: `${OUT}/chart-dark-${c.file}.png` });
  if (c.file === "linearity") {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), page.getByTestId("button-download-pdf").first().click()]);
    await dl.saveAs(`${OUT}/chart-linearity.pdf`);
    check("linearity: Download PDF delivered a PDF", (await import("node:fs")).readFileSync(`${OUT}/chart-linearity.pdf`).subarray(0, 4).toString() === "%PDF");
  }
}

check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
await browser.close();
sdb.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
