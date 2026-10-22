// scripts/verify-veritamap-raleigh-library-ui.mjs
// Gate 3 browser receipt for Angela Cedeno's VeritaMap asks (Raleigh General, 2026-10-22). LOCAL server + scratch DB
// only (it registers an owner, provisions a lab and creates a map). On the VeritaMap build page:
//   1. searching "Xpress" offers Cepheid GeneXpert Xpress with 9 tests; added, its tests show as WAIVED (FDA CW records)
//   2. searching "ROM Plus" offers Clinical Innovations ROM Plus (2 tests); "miniiSED" offers Alcor Scientific miniiSED
//   3. searching "hCG" offers the Beta-hCG Card with 2 tests (serum + urine)
//   4. the Add Custom Test dialog offers Virology and Parasitology (and the other microbiology subspecialties)
// Usage: PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-veritamap-raleigh-library-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const flat = (s) => (s || "").replace(/\s+/g, " ").trim();

const email = `raleigh-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Library Owner", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Raleigh Library Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Chemistry" }, token);
check("scratch map created", !!map.id, JSON.stringify(map).slice(0, 120));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
await page.goto(`${BASE}/`);
const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
await page.evaluate(([t, u, lab]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(lab)); localStorage.setItem("theme", "light"); }, [token, me, labId]);
await page.goto(`${BASE}/labs/${labId}/veritamap-app/${map.id}/build`, { waitUntil: "networkidle" });
const search = page.locator("input[placeholder^='Type an instrument']").first();
await search.waitFor({ timeout: 20000 });
const offer = async (q, name) => {
  await search.fill(q); await page.waitForTimeout(600);
  const b = page.locator("button", { hasText: name }).first();
  return (await b.isVisible().catch(() => false)) ? { b, text: flat(await b.innerText()) } : { b, text: "(no result)" };
};
const xp = await offer("Xpress", "Cepheid GeneXpert Xpress");
check('searching "Xpress" offers Cepheid GeneXpert Xpress with 9 tests', /9 tests/.test(xp.text), xp.text);
const rom = await offer("ROM Plus", "Clinical Innovations ROM Plus");
check('searching "ROM Plus" offers Clinical Innovations ROM Plus with 2 tests', /2 tests/.test(rom.text), rom.text);
const mini = await offer("miniiSED", "Alcor Scientific miniiSED");
check('searching "miniiSED" offers Alcor Scientific miniiSED with 1 test', /1 test/.test(mini.text), mini.text);
const hcg = await offer("hCG", "Beta-hCG Card");
check('searching "hCG" offers the Beta-hCG Card with 2 tests (serum + urine)', /2 tests/.test(hcg.text), hcg.text);

// Add the Xpress and read its tests on the select-tests step.
const xp2 = await offer("Xpress", "Cepheid GeneXpert Xpress");
await xp2.b.click();
await page.getByRole("button", { name: /^Add Instrument$/ }).click();
await page.waitForTimeout(2000);
await page.getByRole("button", { name: /Next: Select Tests/ }).click();
await page.waitForTimeout(2500);
const body = flat(await page.locator("body").innerText());
const want = ["Xpress Strep A", "Xpress Flu/RSV", "Xpress SARS-CoV-2 plus", "Xpress MVP: Trichomonas vaginalis", "Xpert HCV (HCV RNA, fingerstick)"];
check("Xpress tests listed after adding", want.every((t) => body.includes(t)), want.filter((t) => !body.includes(t)).join(", "));
check("no MTB / HIV / GBS rows on the Xpress", !/MTB\/RIF|HIV-1 Viral Load|Strep B \(GBS\)/.test(body));
check("the Xpress tests show WAIVED, none MODERATE for this instrument", /WAIVED/.test(body) && !/\bMODERATE\b/.test(body), (body.match(/WAIVED|MODERATE|HIGH/g) || []).join(" ").slice(0, 120));
// Scroll so the whole Xpress test list (all 9 rows and their specialty headings) is in the viewport for the receipt.
const showTests = async () => {
  await page.evaluate(() => { const s = document.querySelector("button[role='switch']"); if (s) { s.scrollIntoView({ block: "start" }); window.scrollBy(0, -260); } });
  await page.waitForTimeout(400);
};
await page.waitForTimeout(3500);  // let the "Instrument added" toast clear
await showTests();
await page.screenshot({ path: `${OUT}/raleigh_xpress_waived_light.png` });

// Custom test dialog: the specialty list.
await page.getByRole("button", { name: /Add Custom Test/ }).first().click();
const dlg = page.getByRole("dialog");
await dlg.waitFor();
await dlg.locator("button[role='combobox']").first().click().catch(() => {});
let opts = flat((await page.getByRole("option").allInnerTexts()).join(" | "));
if (!/Virology/.test(opts)) {  // the first combobox may be another field: open the one under the Specialty label
  await page.keyboard.press("Escape");
  await dlg.locator("label", { hasText: "Specialty" }).locator("xpath=following::button[1]").click();
  opts = flat((await page.getByRole("option").allInnerTexts()).join(" | "));
}
check("Add Custom Test offers Virology and Parasitology", /Virology/.test(opts) && /Parasitology/.test(opts), opts.slice(0, 200));
check("...and Bacteriology, Mycobacteriology, Mycology", /Bacteriology/.test(opts) && /Mycobacteriology/.test(opts) && /Mycology/.test(opts));
// Let the open animation finish, then scroll the list so Parasitology and Virology are on screen.
await page.waitForTimeout(600);
// Radix Select owns its scroll position; arrow down to Virology the way a user would, which highlights and reveals it.
const names = (await page.getByRole("option").allInnerTexts()).map((t) => t.trim());
for (let i = 0; i < names.indexOf("Virology"); i++) await page.keyboard.press("ArrowDown");
await page.waitForTimeout(400);
check("arrowing down highlights Virology", flat(await page.locator("[role='option'][data-highlighted]").innerText().catch(() => "")) === "Virology");
await page.screenshot({ path: `${OUT}/raleigh_custom_specialties_light.png` });
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await dlg.waitFor({ state: "hidden" }).catch(() => {});

// Dark mode look at the Xpress tests.
await page.evaluate(() => document.documentElement.classList.add("dark"));
await showTests();
await page.screenshot({ path: `${OUT}/raleigh_xpress_waived_dark.png` });
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
