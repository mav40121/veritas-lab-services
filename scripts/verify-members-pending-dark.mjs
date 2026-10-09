// scripts/verify-members-pending-dark.mjs
// Gate 3 browser receipt for BUG-010 (2026-10-09): the Lab Members pending-invitation
// row was a pale gray band in dark mode (bg-amber-50/30 with no dark color), so the
// email and Dismiss link were hard to read. Run against a LOCAL server on a scratch
// database (it registers an owner, provisions a lab and creates one pending invite,
// so never point it at production). Usage:
//   PW_BASE=http://localhost:5151 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-members-pending-dark.mjs
// Measures the WCAG contrast ratio of the invitee email text against the row's
// effective background (row tint composited over the card) in light and dark mode;
// passes at 4.5:1 or better. Light + dark shots of the members table.
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

const email = `dark-row-${Date.now()}@example.com`;
const token = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Dark Row", hipaa_acknowledged: true })).token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Dark Row Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
const inv = await fetch(`${BASE}/api/labs/${labId}/members`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) }, body: JSON.stringify({ email: "pending.person@example.com", role: "staff", firstName: "Pending", lastName: "Person" }) });
check("a pending invite exists", inv.status < 300, `HTTP ${inv.status}`);

const browser = await chromium.launch();
for (const mode of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } }); return r.ok ? r.json() : null; }, [BASE, token]);
  await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("theme", "light"); const id = (u && (u.user || u).id); if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [token, me]);
  await page.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
  if (mode === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  const row = page.getByTestId("pending-invite-row").first();
  await row.waitFor({ timeout: 20000 });
  await page.waitForTimeout(300);
  const ratio = await row.evaluate((tr) => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    // Effective background: walk up composing translucent layers over the first opaque one.
    const layers = []; let el = tr;
    while (el) { const c = parse(getComputedStyle(el).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } el = el.parentElement; }
    let bg = [255, 255, 255];
    for (let i = layers.length - 1; i >= 0; i--) { const [r, g, b, a] = layers[i]; bg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)]; }
    const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const out = {};
    for (const id of ["pending-invite-email", "pending-invite-date", "pending-invite-dismiss"]) {
      const el = tr.querySelector(`[data-testid="${id}"]`);
      if (!el) { out[id] = null; continue; }
      const fg = parse(getComputedStyle(el).color);
      const L1 = lum(fg.slice(0, 3)), L2 = lum(bg);
      out[id] = { ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05), fg: fg.slice(0, 3) };
    }
    return { bg: bg.map(Math.round), out };
  });
  for (const [id, r] of Object.entries(ratio.out)) {
    check(`${mode}: ${id.replace("pending-invite-", "")} contrast >= 4.5:1`, !!r && r.ratio >= 4.5, r ? `ratio ${r.ratio.toFixed(2)} text rgb(${r.fg}) on rgb(${ratio.bg})` : "element missing");
  }
  await row.scrollIntoViewIfNeeded();
  const card = row.locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await (await card.count() ? card : page).screenshot({ path: `${OUT}/members_pending_${mode}.png` });
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
