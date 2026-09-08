// Reset the USON (US Oncology / McKesson) bake-off demo tenant to its baseline.
//
// Purpose: between the four bake-off teams, restore the 4-lab "USON System"
// tenant (owner u69, labs 25-28) to a clean, presentable baseline so each team
// sees the same pristine demo. Idempotent and re-runnable.
//
// What it restores per lab:
//   1. is_demo=1 (the "REPRESENTATIVE SAMPLE DATA" banner + export stamp).
//   2. VeritaCheck coverage studies -> reset + reseed to a passing baseline at a
//      per-lab target. The differentiation is deliberate (spec: "one lab clean and
//      one with visible gaps"): lab 25 is clean, lab 26 is the gap lab, 27/28 are
//      mostly clean. Reset archives any presenter-added studies and reseeds
//      durable, instrument-keyed passing data (see PR #1252).
//   3. Position descriptions (6 CLIA roles) on lab 25 so Compliance reads 100%.
//   4. Clears the owner's onboarding so the login lands on a clean dashboard.
//
// What it does NOT touch (unlikely to be dirtied by a viewer; left as seeded):
//   VeritaScan readiness spread, VeritaMap menus, VeritaPolicy/Comp/Response/
//   Track/QC baselines. If a presenter deeply edits those, reseed them per the
//   USON spec separately.
//
// Requires env: ADMIN_SECRET and JWT_SECRET (both from Railway env). Optional
// BASE (defaults to production www). Never commit the secrets.
//
//   ADMIN_SECRET=... JWT_SECRET=... node scripts/reset-uson-demo.mjs
//
import jwt from "jsonwebtoken";

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const JWT_SECRET = process.env.JWT_SECRET;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
if (!ADMIN_SECRET || !JWT_SECRET) { console.error("Set ADMIN_SECRET and JWT_SECRET env vars."); process.exit(1); }

const OWNER = 69;
// Per-lab cal-ver coverage target. Lower target = more visible gaps.
const LABS = [
  { id: 25, name: "USON Regional Reference (flagship, clean)", calVerTargetPct: 0.97 },
  { id: 26, name: "USON Community Hospital (the gap lab)",     calVerTargetPct: 0.80 },
  { id: 27, name: "USON Physician Office",                     calVerTargetPct: 0.95 },
  { id: 28, name: "USON Cancer Center",                        calVerTargetPct: 0.95 },
];
// Lab 25 flagship carries the full Compliance depth incl. position descriptions.
const PD_LAB = 25;
const PD = [
  ["LD", "Laboratory Director", "Overall responsibility for the operation and administration of the laboratory per 42 CFR 493.1441-1445."],
  ["CC", "Clinical Consultant", "Consultation on test appropriateness and result interpretation per 42 CFR 493.1455-1457."],
  ["TC", "Technical Consultant", "Technical and scientific oversight of moderate-complexity testing per 42 CFR 493.1409-1413."],
  ["TS", "Technical Supervisor", "Technical and scientific oversight of high-complexity testing per 42 CFR 493.1447-1451."],
  ["GS", "General Supervisor", "Day-to-day supervision of high-complexity testing personnel per 42 CFR 493.1461-1463."],
  ["TP", "Testing Personnel", "Performs moderate and high-complexity testing per 42 CFR 493.1423 and 493.1487-1495."],
];

const ownerJwt = jwt.sign({ userId: OWNER, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }, JWT_SECRET, { algorithm: "HS256" });
const post = (path, body, headers = {}) => fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": UA, ...headers }, body: JSON.stringify(body) });
const put = (path, body, headers = {}) => fetch(`${BASE}${path}`, { method: "PUT", headers: { "Content-Type": "application/json", "User-Agent": UA, ...headers }, body: JSON.stringify(body) });
const owner = { Authorization: `Bearer ${ownerJwt}` };

async function main() {
  for (const lab of LABS) {
    await post("/api/admin/update-lab", { secret: ADMIN_SECRET, labId: lab.id, isDemo: true });
    const r = await (await post("/api/admin/veritacheck/seed-coverage-studies", { secret: ADMIN_SECRET, labId: lab.id, reset: true, calVerTargetPct: lab.calVerTargetPct, mcTargetPct: 1.0 })).json();
    console.log(`lab ${lab.id} ${lab.name}: is_demo set; coverage reset -> seeded ${r.calVer?.seeded}, gaps ${r.calVer?.gaps}`);
  }
  // Position descriptions on the flagship (idempotent upsert by role).
  for (const [role, title, description] of PD) {
    const res = await put(`/api/labs/${PD_LAB}/staff/position-descriptions/${role}`, { title, description }, { ...owner, "X-Active-Lab-Id": String(PD_LAB) });
    if (!res.ok) console.error(`  PD ${role} -> HTTP ${res.status}`);
  }
  console.log(`lab ${PD_LAB}: 6 position descriptions ensured`);
  // Clear the owner's onboarding so the login lands clean.
  await post("/api/auth/complete-onboarding", {}, owner);
  await post("/api/onboarding/seen", {}, owner);
  console.log(`owner u${OWNER}: onboarding cleared`);
  console.log("\nUSON demo reset complete. Spot-check /labs/25/dashboard: studies 55 pass / 1 fail, Compliance 100%, lab 26 shows coverage gaps.");
}
main().catch((e) => { console.error(e); process.exit(1); });
