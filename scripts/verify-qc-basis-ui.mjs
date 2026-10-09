// scripts/verify-qc-basis-ui.mjs
// Gate 3 step 8 browser receipt for the VeritaQC evaluation basis (2026-10-08,
// MedStar), run against a LOCAL server on a scratch database (it registers
// owners, provisions labs and marks onboarding done directly in SCRATCH_DB, so
// never point it at production). Usage:
//   PW_BASE=http://localhost:5131 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-qc-basis-ui.mjs
// Lab A: a lot with 21 runs around 1.08 (insert 1.29 / 0.35) -> the chart must
// say it is drawn on the lab's established numbers and show the manufacturer
// mean line plus the off-chart range labels. Lab B: a lot with 3 runs -> the
// chart must say it is on the manufacturer's values (3 of 20 runs). Light and
// dark screenshots of each.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5131", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function makeLab(tag, nRuns) {
  const email = `vqb-ui-${tag}-${Date.now()}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email, password: "testpass123", name: `QC ${tag}`, hipaa_acknowledged: true });
  const token = reg.token;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `QC Basis ${tag}`, plan: "hospital" })).labId;
  const sdb = new Database(process.env.SCRATCH_DB);
  sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
  sdb.close();
  const lot = await call("POST", `/api/labs/${labId}/qc/control-lots`, {
    analyte: "PSA (FREND B)", level: "Level 1", lot_number: "6361A26001", manufacturer: "NanoEntek",
    mfr_mean: 1.29, mfr_sd: 0.35, mfr_range_low: 0.59, mfr_range_high: 1.99,
  }, token);
  const lotId = lot?.lot?.id ?? lot?.id;
  const offs = [-0.12, 0.05, 0.1, -0.04, 0.0, -0.09, 0.13, 0.02, -0.06, 0.08, -0.11, 0.04, 0.07, -0.03, -0.08, 0.11, 0.01, -0.05, 0.09, -0.1, 0.03];
  for (let i = 0; i < nRuns; i++) {
    await call("POST", `/api/labs/${labId}/qc/results`, { control_lot_id: lotId, result_value: Number((1.08 + offs[i]).toFixed(3)), result_date: `2026-06-${String(i + 1).padStart(2, "0")}` }, token);
  }
  return { token, labId };
}

const labs = { A: await makeLab("A", 21), B: await makeLab("B", 3) };
const browser = await chromium.launch();
for (const [tag, lab] of Object.entries(labs)) {
  for (const mode of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await page.goto(`${BASE}/`);
    const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, lab.token]);
    await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [lab.token, me]);
    await page.goto(`${BASE}/labs/${lab.labId}/veritaqc-app`, { waitUntil: "networkidle" });
    if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
    const chart = page.getByTestId("qc-lj-chart");
    await chart.waitFor({ timeout: 20000 });
    const label = (await page.getByTestId("qc-basis-label").innerText()).trim();
    const lotBasis = (await page.getByTestId("qc-lot-basis").innerText()).trim();
    const refs = await page.getByTestId("qc-mfr-reference").allTextContents();
    const card = chart.locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
    await (await card.count() ? card : chart).screenshot({ path: `${OUT}/qc_basis_${tag}_${mode}.png` });
    if (tag === "A") {
      // 21 runs on the lot: the lab's numbers keep refining past 20 (Michael 2026-10-09), so the
      // chart shows all 21 runs (1.082 / 0.079), not the first 20 (1.081 / 0.080).
      check(`A/${mode}: chart says it is on the lab's own numbers, refined over all 21 runs`, /^Lab established mean 1\.082, SD 0\.079 \(from 21 runs; updates with each accepted run\)/.test(label) && lotBasis.includes("Lab established mean 1.082"), label);
      check(`A/${mode}: manufacturer mean drawn as a line; low/high named off-chart`,
        refs.some((t) => /^Mfr mean 1\.29$/.test(t.trim())) && refs.some((t) => /Mfr low 0\.590 \(below chart/.test(t)) && refs.some((t) => /Mfr high 1\.99 \(above chart/.test(t)), JSON.stringify(refs));
    } else {
      check(`B/${mode}: chart says it is on the manufacturer's values, 3 of 20 runs`, /^Manufacturer mean 1\.290, SD 0\.350 while the lab establishes its own \(3 of 20 runs\)$/.test(label), label);
      check(`B/${mode}: manufacturer mean is the center line, range inside the chart`,
        refs.some((t) => /^Mfr mean 1\.29$/.test(t.trim())) && refs.some((t) => /^Mfr low 0\.590$/.test(t.trim())) && refs.some((t) => /^Mfr high 1\.99$/.test(t.trim())), JSON.stringify(refs));
    }
    await page.close();
  }
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
