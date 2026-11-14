// scripts/verify-lab-day-of-ui.mjs
// Browser receipt for BUG-171 (client/src/lib/labDate.ts labDayOf): a stored moment shows as the active lab's day, not
// its UTC day. On VeritaMaintain's monthly record review (one of the screens named in the bug), a review signed at
// 7:30 PM Eastern on 11/1 read "Reviewed 2026-11-02". Run against a LOCAL production build on a scratch database with
// made-up values (it writes to SCRATCH_DB, so it refuses any other host):
//   PW_BASE=http://localhost:5206 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-lab-day-of-ui.mjs
//   1. Eastern lab: the review signed 2026-11-02T00:30Z reads "Reviewed 2026-11-01" (it read 2026-11-02);
//   2. the day follows the lab's zone: a review signed 1:30 AM Eastern on 11/2 reads 2026-11-02 in an Eastern lab and
//      2026-11-01 in a Pacific one (10:30 PM there);
//   3. a review stored as a picked date at UTC midnight keeps its date in the Eastern lab;
//   4. dark mode, no page errors.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required.");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return j;
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a); } finally { db.close(); } };

const email = `labday-ui-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Lab", "day", "171!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Lab Day Lab", plan: "hospital" })).labId;
const ownerId = sql("SELECT id FROM users WHERE email = ?", email).id;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?", email);
sql("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999171', time_zone = 'America/New_York' WHERE id = ?", labId);
const eqA = Number(sql("INSERT INTO lab_equipment (lab_id, instrument_name, status, created_at, updated_at) VALUES (?, 'Made-up Analyzer Evening', 'active', '2026-09-01 12:00:00', '2026-09-01 12:00:00')", labId).lastInsertRowid);
const eqB = Number(sql("INSERT INTO lab_equipment (lab_id, instrument_name, status, created_at, updated_at) VALUES (?, 'Made-up Analyzer Picked', 'active', '2026-09-01 12:00:00', '2026-09-01 12:00:00')", labId).lastInsertRowid);
const review = (eq, name, at) => sql(`INSERT INTO maintain_record_reviews (lab_id, period, item_type, item_id, item_name, reviewed_by_user_id, typed_signature, capacity, capacity_label, signed_at)
  VALUES (?, '2026-10', 'equipment', ?, ?, ?, 'Made Up Director', 'director', 'Laboratory Director', ?)`, labId, eq, name, ownerId, at);
review(eqA, "Made-up Analyzer Evening", "2026-11-02T00:30:00.000Z"); // 7:30 PM EST on 11/1
review(eqB, "Made-up Analyzer Picked", "2026-11-03T00:00:00.000Z");  // a picked date saved as UTC midnight
const eqC = Number(sql("INSERT INTO lab_equipment (lab_id, instrument_name, status, created_at, updated_at) VALUES (?, 'Made-up Analyzer Late Night', 'active', '2026-09-01 12:00:00', '2026-09-01 12:00:00')", labId).lastInsertRowid);
review(eqC, "Made-up Analyzer Late Night", "2026-11-02T06:30:00.000Z"); // 1:30 AM EST on 11/2, 10:30 PM PST on 11/1

const browser = await chromium.launch();
const errors = [];
const open = async (dark = false) => {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 }, colorScheme: dark ? "dark" : "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u, d]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); if (d) localStorage.setItem("theme", "dark"); }, [reg.token, reg.user, dark]);
  await page.goto(`${BASE}/labs/${labId}/equipment-app`, { waitUntil: "networkidle" });
  return { page, ctx };
};
const rowText = async (page, name) => {
  const row = page.getByTestId("review-table").locator("tr").filter({ hasText: name }).first();
  await row.waitFor({ timeout: 20000 });
  return (await row.innerText()).replace(/\s+/g, " ");
};

try {
  const { page, ctx } = await open();
  await page.getByTestId("review-table").getByText("Made-up Analyzer Evening").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const a = await rowText(page, "Made-up Analyzer Evening");
  check("1. Eastern lab: a review signed 7:30 PM on 11/1 reads Reviewed 2026-11-01 (it read 2026-11-02)", a.includes("Reviewed 2026-11-01") && !a.includes("Reviewed 2026-11-02"), a);
  const b = await rowText(page, "Made-up Analyzer Picked");
  check("3. a picked date stored as UTC midnight keeps its date (2026-11-03, never 11-02)", b.includes("Reviewed 2026-11-03"), b);
  const c = await rowText(page, "Made-up Analyzer Late Night");
  check("2. Eastern lab: 1:30 AM on 11/2 reads 2026-11-02", c.includes("Reviewed 2026-11-02"), c);
  await page.getByTestId("monthly-review-panel").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -200));
  await page.screenshot({ path: path.join(OUT, "bug171-review-eastern.png"), animations: "disabled" });
  await ctx.close();
} catch (e) { check("Eastern section ran to the end", false, String(e?.message || e).split("\n")[0]); }

try {
  sql("UPDATE labs SET time_zone = 'America/Los_Angeles' WHERE id = ?", labId);
  const { page, ctx } = await open();
  await page.getByTestId("review-table").getByText("Made-up Analyzer Evening").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const c = await rowText(page, "Made-up Analyzer Late Night");
  check("2. the same review in a Pacific lab reads 2026-11-01, that lab's day (10:30 PM there)", c.includes("Reviewed 2026-11-01"), c);
  await ctx.close();
  sql("UPDATE labs SET time_zone = 'America/New_York' WHERE id = ?", labId);
} catch (e) { check("Pacific section ran to the end", false, String(e?.message || e).split("\n")[0]); }

try {
  const { page, ctx } = await open(true);
  await page.getByTestId("review-table").getByText("Made-up Analyzer Evening").first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  const a = await rowText(page, "Made-up Analyzer Evening");
  check("4. dark mode: Reviewed 2026-11-01", a.includes("Reviewed 2026-11-01"), a);
  await page.getByTestId("monthly-review-panel").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -200));
  await page.screenshot({ path: path.join(OUT, "bug171-review-eastern-dark.png"), animations: "disabled" });
  await ctx.close();
} catch (e) { check("dark section ran to the end", false, String(e?.message || e).split("\n")[0]); }

check("4. no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
