// scripts/verify-library-vitros-xt3400-ui.mjs
// Gate 3 browser receipt for BUG-005 part 1 (2026-10-09). Run against a LOCAL
// server on a scratch database (it registers an owner, provisions a lab and
// creates a map, so never point it at production). Usage:
//   PW_BASE=http://localhost:5147 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-library-vitros-xt3400-ui.mjs
// On the VeritaMap build page, searching "XT 3400" offers "Ortho VITROS XT 3400"
// (QuidelOrtho, 47 tests, from the FDA CLIA records). Light + dark shots.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5147", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `library-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Library Owner", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Library Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const map = await call("POST", `/api/labs/${labId}/veritamap/maps`, { name: "Chemistry" }, token);
check("scratch map created", !!map.id, JSON.stringify(map).slice(0, 120));

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [token, me]);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${map.id}/build`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  const search = page.locator("input[placeholder^='Type an instrument']").first();
  await search.waitFor({ timeout: 20000 });
  await search.fill("XT 3400");
  await page.waitForTimeout(500);
  const result = page.locator("button", { hasText: "Ortho VITROS XT 3400" }).first();
  const visible = await result.isVisible().catch(() => false);
  const text = visible ? (await result.innerText()).replace(/\s+/g, " ") : "(no result)";
  check(`${mode}: searching "XT 3400" offers Ortho VITROS XT 3400 with 47 tests`, visible && /47 tests/.test(text) && /QuidelOrtho/.test(text), text);
  const box = search.locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await (await box.count() ? box : page).screenshot({ path: `${OUT}/library_xt3400_${mode}.png` });
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
