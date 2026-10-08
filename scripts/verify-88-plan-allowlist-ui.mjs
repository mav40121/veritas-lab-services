// scripts/verify-88-plan-allowlist-ui.mjs
// Gate 3 step 8 browser receipt for parking lot #88 (2026-10-08): seven module
// pages gated with plan !== "free" && plan !== "per_study" (a blocklist) now use
// the explicit allowlist. Run against a LOCAL server on a scratch database (it
// provisions labs and sets plans directly in SCRATCH_DB; never point it at
// production). Usage:
//   PW_BASE=http://localhost:5131 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-88-plan-allowlist-ui.mjs
// For each live plan value (clinic, community, hospital, enterprise, lab) the
// module pages open with no plan wall; for free, the plan wall shows; for an
// unknown plan string (the case a blocklist let through) the wall shows too.
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

// Plan wall marker per page (what a non-entitled user sees).
const PAGES = [
  ["VeritaPT", "veritapt/app", "PT coverage analysis is available on all paid plans"],
  ["VeritaScan", "veritascan-app", "VeritaScan™ Access Required"],
  ["VeritaResponse", "veritaresponse", "Upgrade Plan"],
  ["VeritaComp", "veritacomp-app", "VeritaComp™ Access Required"],
  ["VeritaMap", "veritamap-app", "Free plan:"],
];
const PLANS = [["clinic", false], ["community", false], ["hospital", false], ["enterprise", false], ["lab", false], ["free", true], ["mystery_plan", true]];

const browser = await chromium.launch();
for (const [plan, expectWall] of PLANS) {
  const email = `v88-${plan}-${Date.now()}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email, password: "testpass123", name: `V88 ${plan}`, hipaa_acknowledged: true });
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `V88 ${plan}`, plan: "hospital" })).labId;
  const sdb = new Database(process.env.SCRATCH_DB);
  sdb.prepare("UPDATE users SET plan = ?, has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(plan, email);
  sdb.prepare("UPDATE labs SET plan = ?, has_completed_onboarding = 1 WHERE id = ?").run(plan, labId);
  sdb.close();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? r.json() : null; }, [BASE, reg.token]);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) { localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); const id = (u.user || u).id; if (id) localStorage.setItem(`onboarding_dismissed_${id}`, "1"); } }, [reg.token, me]);
  const seen = {};
  for (const [name, path, wall] of PAGES) {
    await page.goto(`${BASE}/labs/${labId}/${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    seen[name] = (await page.getByText(wall, { exact: false }).count()) > 0;
    if (plan === "clinic" || plan === "free") await page.screenshot({ path: `${OUT}/88_${plan}_${name}.png` });
  }
  const ok = Object.values(seen).every((v) => v === expectWall);
  check(`plan ${plan}: plan wall ${expectWall ? "shown" : "absent"} on all five pages`, ok, JSON.stringify(seen));
  await page.close();
}
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
