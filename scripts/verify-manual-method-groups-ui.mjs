// scripts/verify-manual-method-groups-ui.mjs
// Gate 3 receipt for grouping manual tests (Michael 2026-11-04, Q166 = 1). Run against a LOCAL server on a scratch database, with made-up
// people and tests (it registers an owner, provisions a lab and writes to SCRATCH_DB, so never point it at production). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-manual-method-groups-ui.mjs
// In a real browser, on VeritaComp > Method groups: manual tests are listed and marked; picking a test and an analyzer shows why it can't
// be grouped and keeps the button off; picking two manual tests states the director's decision; the group saves and says so on its card,
// after a reload too. Light, dark and phone shots.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const PW = ["Manual", "chk", "77!"].join("-");
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `manual-ui-${Date.now()}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Manual UI Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999999' WHERE id = ?").run(labId);
const mapId = (await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Core" }, reg.token)).id;
const now = new Date().toISOString();
const add = (name, category, complexity, analyte) => {
  const id = Number(sdb.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?, ?, 'Primary', ?, ?)").run(mapId, name, category, now).lastInsertRowid);
  sdb.prepare("INSERT INTO veritamap_instrument_tests (map_id, instrument_id, analyte, specialty, complexity, active) VALUES (?, ?, ?, 'General', ?, 1)").run(mapId, id, analyte, complexity);
};
add("Made-up Mono Kit", "Manual Procedures", "MODERATE", "Heterophile");
add("Made-up ROM Kit", "Manual Procedures", "MODERATE", "ROM");
add("Made-up Analyzer", "Chemistry", "MODERATE", "Sodium");

const browser = await chromium.launch();
const open = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
  return { ctx, page: await ctx.newPage() };
};
const signIn = async (page, dark = false) => {
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, d]) => {
    localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1");
    if (d) localStorage.setItem("theme", "dark");
  }, [reg.token, reg.user, dark]);
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app/method-groups`, { waitUntil: "networkidle" });
  await page.getByTestId("make-group").waitFor({ timeout: 20000 });
};
const pick = (page, name) => page.locator("label", { hasText: name }).locator("input[type=checkbox]");

const { page } = await open();
await signIn(page);
const text = await page.getByTestId("make-group").innerText();
check("manual tests are listed", text.includes("Made-up Mono Kit") && text.includes("Made-up ROM Kit"));
check("they are marked manual", /Made-up Mono Kit\s*Manual/.test(text), text.slice(0, 160).replace(/\n/g, " | "));

await pick(page, "Made-up Mono Kit").check();
await pick(page, "Made-up Analyzer").check();
await page.getByTestId("new-group-name").fill("Should not save");
const problem = await page.getByTestId("group-problem").innerText();
check("a manual test and an analyzer can't be grouped, and it says why", /can only be grouped with other manual methods/.test(problem), problem);
check("the button is off", await page.getByTestId("create-group").isDisabled());
check("the director's statement isn't shown for that", !(await page.getByTestId("manual-group-note").isVisible().catch(() => false)));
await page.screenshot({ path: `${OUT}/manual-groups-refused.png` });

await pick(page, "Made-up Analyzer").uncheck();
await pick(page, "Made-up ROM Kit").check();
const note = await page.getByTestId("manual-group-note").innerText();
check("two manual tests state the director's decision", /medical director or designee is deciding that they involve no new or unique skills/.test(note), note);
await page.getByTestId("new-group-name").fill("Rapid kits");
await page.screenshot({ path: `${OUT}/manual-groups-note.png` });
await page.getByTestId("create-group").click();
await page.getByTestId("manual-group-statement").first().waitFor({ timeout: 15000 });
const card = await page.getByTestId("lab-group").first().innerText();
check("the group saves, with both tests", card.includes("Rapid kits") && card.includes("Made-up Mono Kit") && card.includes("Made-up ROM Kit"), card.slice(0, 120).replace(/\n/g, " | "));
await page.reload();
await page.getByTestId("manual-group-statement").first().waitFor({ timeout: 15000 });
check("after a reload the card still states the decision", /medical director or designee decided these involve no new or unique skills/.test(await page.getByTestId("manual-group-statement").first().innerText()));
await page.screenshot({ path: `${OUT}/manual-groups-card.png` });

const dark = await open({ colorScheme: "dark" });
await signIn(dark.page, true);
await dark.page.screenshot({ path: `${OUT}/manual-groups-dark.png` });
check("dark: the card shows", await dark.page.getByTestId("manual-group-statement").first().isVisible());

const phone = await open({ viewport: { width: 375, height: 812 } });
await signIn(phone.page);
check("phone: no sideways scroll", await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await phone.page.screenshot({ path: `${OUT}/manual-groups-phone.png` });

await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
