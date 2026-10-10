// scripts/verify-method-comp-na-ui.mjs
// Gate 3 browser receipt for BUG-015 (Michael, Q65 = 1, 2026-10-10): on the VeritaMap map page a lab marks one test's
// correlation / method comparison "not applicable" with a reason (tests that share only a generic CMS analyte name,
// e.g. ANTIMICROBIAL across MicroScan panels for different organism groups), the row shows the reason, the score card
// stops counting it, the choice survives a reload, and "Correlation required again" undoes it. Run against a LOCAL
// server on a scratch database (it registers an owner, provisions a lab and seeds a map; never point it at
// production). Usage:
//   PW_BASE=http://localhost:5151 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-method-comp-na-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5151", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const REASON = "Panels cover different organism groups";

const email = `mcna-ui-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "MC NA", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "MC NA Lab", plan: "hospital" })).labId;
const micro = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Microbiology" }, token);
const t = (analyte) => ({ analyte, specialty: "Microbiology", complexity: "HIGH", active: 1 });
const seeded = await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId: micro.id, defaultActive: 1, instruments: [
  { name: "MicroScan Dried Gram-Negative MIC/Combo", tests: [t("ANTIMICROBIAL"), t("Organism ID")] },
  { name: "MicroScan Dried Gram-Positive MIC/Combo", tests: [t("ANTIMICROBIAL"), t("Organism ID")] },
] });
check("map seeded: two panels, two tests each", seeded?.totals?.inserted === 4, JSON.stringify(seeded?.totals));
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.prepare("UPDATE veritamap_tests SET last_cal_ver = date('now') WHERE map_id = ?").run(micro.id);
sdb.close();

const browser = await chromium.launch();
const open = async (path, dark = false) => {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([tk, u, lab]) => { localStorage.setItem("veritas_token", tk); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(lab)); localStorage.setItem("theme", "light"); }, [token, me, labId]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  if (dark) await page.evaluate(() => document.documentElement.classList.add("dark"));
  return page;
};
const mapPath = `/labs/${labId}/veritamap-app/${micro.id}`;
const amrRow = (page) => page.locator("tr", { hasText: "ANTIMICROBIAL" }).first();
const shotAround = async (page, loc, file, below = 330) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); await page.screenshot({ path: `${OUT}/${file}`, clip: { x: 0, y: Math.max(0, (b?.y ?? 0) - 120), width: 1500, height: below + 120 } }); };
const scoreCard = async (page) => (await page.locator("text=COMPLIANCE SCORE").first().locator("xpath=ancestor::div[2]").innerText().catch(() => "")).replace(/\s+/g, " ");

let page = await open(mapPath);
await amrRow(page).waitFor({ timeout: 20000 });
let rowText = (await amrRow(page).innerText()).replace(/\s+/g, " ");
check("before: ANTIMICROBIAL row says Required and offers N/A", /Required/.test(rowText) && (await amrRow(page).getByTestId("method-comp-na-open").count()) === 1, rowText.slice(0, 160));
check("before: score card counts 2 method comps missing", /\b2 method comp missing\b/.test(await scoreCard(page)), await scoreCard(page));

await amrRow(page).getByTestId("method-comp-na-open").click();
const pop = page.getByTestId("method-comp-na-popover");
await pop.waitFor({ timeout: 10000 });
check("popover lists the reasons and requires one", (await pop.innerText()).includes(REASON) && (await pop.innerText()).includes("Other"));
await page.getByTestId("method-comp-na-reason-1").check();
await shotAround(page, amrRow(page), "mcna_popover_light.png", 300);
await page.getByTestId("method-comp-na-save").click();
// Regression: the cal ver N/A control (#77 part B) now shares the popover component; it still opens with its own
// heading, reasons and test ids, and Cancel saves nothing.
const orgRow = page.locator("tr", { hasText: "Organism ID" }).first();
await orgRow.getByTestId("cal-ver-na-open").click();
const cvPop = page.getByTestId("cal-ver-na-popover");
await cvPop.waitFor({ timeout: 10000 });
const cvText = (await cvPop.innerText()).replace(/\s+/g, " ");
check("regression: cal ver N/A popover still opens with its heading and 4 reasons", cvText.includes("Calibration verification not applicable") && (await page.locator('[data-testid^="cal-ver-na-reason-"]').count()) === 4, cvText.slice(0, 160));
await cvPop.getByRole("button", { name: "Cancel" }).click();
await amrRow(page).getByTestId("method-comp-na").waitFor({ timeout: 10000 });
rowText = (await amrRow(page).innerText()).replace(/\s+/g, " ");
check("after: the row shows 'N/A: <reason>', no Required badge, no Run Correlation", rowText.includes(`N/A: ${REASON}`) && !/\bRequired\b(?! again)/.test(rowText.replace("Correlation required again", "")) && !/Run Correlation/.test(rowText), rowText.slice(0, 200));
await page.waitForTimeout(800);
check("after: score card counts 1 method comp missing (Organism ID only)", /\b1 method comp missing\b/.test(await scoreCard(page)), await scoreCard(page));
await shotAround(page, amrRow(page), "mcna_row_light.png", 160);
await page.close();

page = await open(mapPath, true);
await amrRow(page).getByTestId("method-comp-na").waitFor({ timeout: 20000 });
rowText = (await amrRow(page).innerText()).replace(/\s+/g, " ");
check("reload: the N/A and its reason are still there (saved on the server)", rowText.includes(`N/A: ${REASON}`), rowText.slice(0, 160));
await shotAround(page, amrRow(page), "mcna_row_dark.png", 160);
await page.close();

page = await open(`/labs/${labId}/veritamap-app/labwide`);
await page.getByText("ANTIMICROBIAL").first().waitFor({ timeout: 20000 }).catch(() => {});
const lwBody = (await page.locator("body").innerText()).replace(/\s+/g, " ");
check("labwide page shows the N/A reason in the method comparison column", lwBody.includes(`N/A: ${REASON}`), (lwBody.match(/ANTIMICROBIAL.{0,200}/) || [""])[0]);
await page.close();

page = await open(mapPath);
await amrRow(page).getByTestId("method-comp-na-undo").click();
await amrRow(page).getByTestId("method-comp-na-open").waitFor({ timeout: 10000 });
await page.waitForTimeout(1200);
await page.reload({ waitUntil: "networkidle" });
await amrRow(page).waitFor({ timeout: 20000 });
rowText = (await amrRow(page).innerText()).replace(/\s+/g, " ");
check("undo: 'Correlation required again' restores Required, and it holds after a reload", /Required/.test(rowText) && !rowText.includes("N/A:") && /\b2 method comp missing\b/.test(await scoreCard(page)), rowText.slice(0, 160));
await page.close();
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
