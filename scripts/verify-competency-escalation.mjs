// scripts/verify-competency-escalation.mjs
// Receipt (2026-10-08) for competency reminders and escalation (St. Charles
// 10/14: "automatic reminders and escalations"; Michael's design: weekly
// supervisor digest, escalate to the director the day a competency goes
// overdue then weekly, monthly 90/60/30 report). LOCAL server + scratch DB.
//   - planning, recipients and content of all three emails (admin dry run)
//   - weekly cadence, "newly overdue" escalation, monthly once per month
//   - recipient fallbacks (owner; medical director on file)
//   - disabled labs never send; non-testing staff excluded
//   - /competency/owed still classifies the same people the same way
//   - the VeritaComp settings card: enable, recipients, save, reload, preview
// Usage:
//   PW_BASE=http://localhost:5137 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-competency-escalation.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5137", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const stamp = Date.now();
const iso = (d) => d.toISOString().slice(0, 10);
const T = iso(new Date());
const plus = (days, from = T) => iso(new Date(Date.parse(from + "T00:00:00Z") + days * 86400000));

// ── Setup ──
const ownerEmail = `esc-owner-${stamp}@example.com`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: "testpass123", name: "Esc Owner", hipaa_acknowledged: true })).body;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Escalation Lab", plan: "hospital" })).body.labId;
await call("POST", "/api/admin/update-lab", { secret: ADMIN, labId, cliaNumber: `05D${String(stamp).slice(-7)}` }); // CLIA is unique across labs
const sdb = new Database(process.env.SCRATCH_DB);
const ownerId = sdb.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(ownerId);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
await call("GET", `/api/labs/${labId}/staff/lab`, undefined, owner.token); // seeds the VeritaStaff lab record
const people = [
  { key: "A", first: "Ava", last: "Coming", due: plus(10), testing: true },   // coming due in 10
  { key: "B", first: "Ben", last: "Overdue", due: plus(-1), testing: true },  // overdue 1 day
  { key: "C", first: "Cal", last: "Sixty", due: plus(45), testing: true },    // 31-60
  { key: "D", first: "Dee", last: "Ninety", due: plus(75), testing: true },   // 61-90
  { key: "E", first: "Eve", last: "Later", due: plus(120), testing: true },   // beyond 90
  { key: "F", first: "Fay", last: "Nontest", due: plus(-5), testing: false }, // not testing personnel
];
const schedCols = sdb.prepare("PRAGMA table_info(staff_competency_schedules)").all().map((c) => c.name);
for (const p of people) {
  const r = await call("POST", `/api/labs/${labId}/staff/employees`, { firstName: p.first, lastName: p.last, title: "MLS", hireDate: "2020-01-15", highestComplexity: "H", performsTesting: p.testing }, owner.token);
  p.id = r.body.id ?? r.body.employee?.id;
  sdb.prepare("DELETE FROM staff_competency_schedules WHERE employee_id = ?").run(p.id);
  const empLab = sdb.prepare("SELECT lab_id FROM staff_employees WHERE id = ?").get(p.id)?.lab_id;
  const row = { employee_id: p.id, lab_id: empLab, initial_completed_at: "2020-04-01", annual_due_at: p.due };
  const cols = Object.keys(row).filter((c) => schedCols.includes(c));
  sdb.prepare(`INSERT INTO staff_competency_schedules (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
}
check("setup: 6 roster employees with schedules", people.every((p) => p.id), people.map((p) => `${p.key}=${p.id}`).join(" "));

const run = (body) => call("POST", "/api/admin/competency-reminders/run", { secret: ADMIN, labId, ...body });
const plansOf = (r) => Object.fromEntries((r.body.plans?.[0]?.emails || []).map((e) => [e.kind, e]));
const names = (e) => (e.items || []).map((i) => i.name).sort().join(",");

// ── /owed agrees ──
const owed = await call("GET", `/api/labs/${labId}/competency/owed`, undefined, owner.token);
const rows = owed.body.employees || owed.body.rows || owed.body.items || [];
const bucketOf = (p) => (rows.find((r) => r.employeeId === p.id) || {}).status?.bucket;
check("competencies owed still classifies the same way (shared milestone walk)",
  bucketOf(people[0]) === "dueSoon30" && bucketOf(people[1]) === "overdue" && bucketOf(people[2]) === "dueSoon90" && bucketOf(people[3]) === "dueSoon90" && bucketOf(people[4]) === "compliant",
  people.slice(0, 5).map((p) => `${p.key}:${bucketOf(p)}`).join(" "));

// ── Configure (lists set) and plan today ──
await call("PUT", `/api/labs/${labId}/competency/reminder-config`, { enabled: true, lead_days: 30, cadence_days: 7, monthly_report: true, supervisor_recipients: ["sup@example.com"], escalation_recipients: ["dir@example.com"] }, owner.token);
let p = plansOf(await run({ dryRun: true, today: T }));
check("digest: to supervisors, the overdue tester and the one coming due in 30 days", p.digest?.send && p.digest.recipients[0]?.email === "sup@example.com" && names(p.digest) === "Ava Coming,Ben Overdue", `${names(p.digest)} -> ${p.digest?.recipients?.map((r) => r.email)}`);
check("escalation: to the director, the newly overdue tester", p.escalation?.send && p.escalation.recipients[0]?.email === "dir@example.com" && names(p.escalation) === "Ben Overdue" && (p.escalation.newlyOverdueKeys || []).length === 1, `${names(p.escalation)} why=${p.escalation?.why}`);
check("monthly 90/60/30: overdue 1, <=30 1, 31-60 1, 61-90 1; to supervisors and director", p.monthly?.send && names(p.monthly) === "Ava Coming,Ben Overdue,Cal Sixty,Dee Ninety" && /overdue 1, due within 30 days 1, 31 to 60 days 1, 61 to 90 days 1/.test(p.monthly.text) && p.monthly.recipients.length === 2, p.monthly?.subject);
check("non-testing staff and anyone beyond 90 days are left out", ![p.digest, p.escalation, p.monthly].some((e) => /Fay Nontest|Eve Later/.test(e?.text || "")));
check("email text has no em dashes", ![p.digest, p.escalation, p.monthly].some((e) => /—/.test((e?.text || "") + (e?.subject || ""))));

// ── Cadence: simulate today's sends, then look 3 and 7 days on ──
const ins = sdb.prepare("INSERT INTO competency_reminder_log (lab_id, kind, item_key, period_key, sent_on, recipient_emails, item_count, created_at) VALUES (?,?,?,?,?,?,?,?)");
const now = new Date().toISOString();
ins.run(labId, "digest", null, null, T, "sup@example.com", 2, now);
for (const k of p.escalation.newlyOverdueKeys) ins.run(labId, "escalation", k, null, T, "dir@example.com", 1, now);
ins.run(labId, "monthly", null, T.slice(0, 7), T, "sup@example.com,dir@example.com", 4, now);
p = plansOf(await run({ dryRun: true, today: plus(3) }));
check("3 days later: no digest, no repeat escalation, no second monthly", !p.digest.send && !p.escalation.send && !p.monthly.send, `digest=${p.digest.why} | esc=${p.escalation.why} | monthly=${p.monthly.why}`);
const ava = people[0];
sdb.prepare("UPDATE staff_competency_schedules SET annual_due_at = ? WHERE employee_id = ?").run(plus(2), ava.id); // Ava now lapses 2 days on
p = plansOf(await run({ dryRun: true, today: plus(3) }));
check("the day another competency lapses it escalates immediately (newly overdue only)", p.escalation.send && (p.escalation.newlyOverdueKeys || []).length === 1 && /Newly overdue \(1\):\n- Ava Coming/.test(p.escalation.text), p.escalation.why);
sdb.prepare("UPDATE staff_competency_schedules SET annual_due_at = ? WHERE employee_id = ?").run(plus(10), ava.id);
p = plansOf(await run({ dryRun: true, today: plus(7) }));
check("7 days later: weekly digest and weekly repeat escalation for the still-overdue tester", p.digest.send && p.escalation.send && /repeat/.test(p.escalation.why), `digest=${p.digest.why} | esc=${p.escalation.why}`);
const nextMonth = plus(32, T.slice(0, 8) + "01");
p = plansOf(await run({ dryRun: true, today: nextMonth.slice(0, 8) + "01" }));
check("first run of the next month sends the monthly report again", p.monthly.send, p.monthly.why);

// ── Fallbacks and the off switch ──
await call("PUT", `/api/labs/${labId}/competency/reminder-config`, { enabled: true, supervisor_recipients: [], escalation_recipients: [] }, owner.token);
p = plansOf(await run({ dryRun: true, today: plus(14) }));
check("no lists: digest and escalation fall back to the lab owner", p.digest.recipients[0]?.email === ownerEmail && p.escalation.recipients[0]?.email === ownerEmail, `${p.digest.recipientsSource} / ${p.escalation.recipientsSource}`);
sdb.prepare("UPDATE labs SET medical_director_email = 'md@example.com' WHERE id = ?").run(labId);
p = plansOf(await run({ dryRun: true, today: plus(14) }));
check("no escalation list: escalation goes to the medical director on file", p.escalation.recipients[0]?.email === "md@example.com", p.escalation.recipientsSource);
await call("PUT", `/api/labs/${labId}/competency/reminder-config`, { enabled: false }, owner.token);
const off = await run({ dryRun: false, today: plus(14) });
check("a lab with reminders off never sends", off.body.emailsSent === 0 && off.body.skipped >= 1, JSON.stringify({ sent: off.body.emailsSent, skipped: off.body.skipped }));
const badCfg = await call("PUT", `/api/labs/${labId}/competency/reminder-config`, { enabled: true, lead_days: 500, cadence_days: 0, supervisor_recipients: ["not-an-email", "ok@example.com"] }, owner.token);
check("settings are clamped and bad emails dropped", badCfg.body.lead_days === 90 && badCfg.body.cadence_days === 1 && badCfg.body.supervisor_recipients.length === 1, JSON.stringify({ lead: badCfg.body.lead_days, cadence: badCfg.body.cadence_days, sup: badCfg.body.supervisor_recipients }));
await call("PUT", `/api/labs/${labId}/competency/reminder-config`, { enabled: false, lead_days: 30, cadence_days: 7, supervisor_recipients: [], escalation_recipients: [] }, owner.token);

// ── The settings card ── (clear the simulated send log so today's preview is "fresh")
sdb.prepare("DELETE FROM competency_reminder_log WHERE lab_id = ?").run(labId);
const me = (await call("GET", "/api/auth/me", undefined, owner.token)).body;
for (const scheme of ["light", "dark"]) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: scheme });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); }, [owner.token, me.user ?? me]);
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app`, { waitUntil: "networkidle" });
  await page.getByTestId("competency-reminders-card").waitFor({ timeout: 15000 });
  await page.getByTestId("competency-reminders-toggle").click();
  if (scheme === "light") {
    await page.getByTestId("competency-reminders-enabled").click();
    await page.getByTestId("competency-reminders-supervisors").fill("lead.tech@example.com, supervisor@example.com");
    await page.getByTestId("competency-reminders-directors").fill("director@example.com");
    await page.getByTestId("competency-reminders-save").click();
    await page.waitForTimeout(1000);
    const saved = (await call("GET", `/api/labs/${labId}/competency/reminder-config`, undefined, owner.token)).body;
    check("card saves: on, two supervisors, one director", saved.enabled && saved.supervisor_recipients.length === 2 && saved.escalation_recipients[0]?.email === "director@example.com", JSON.stringify({ en: saved.enabled, sup: saved.supervisor_recipients.length, dir: saved.escalation_recipients }));
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("competency-reminders-toggle").click();
    check("settings persist after reload", (await page.getByTestId("competency-reminders-status").innerText()) === "On" && (await page.getByTestId("competency-reminders-supervisors").inputValue()).includes("supervisor@example.com"));
  }
  await page.getByTestId("competency-reminders-preview").click();
  await page.getByTestId("competency-preview-escalation").waitFor({ timeout: 10000 });
  const esc = await page.getByTestId("competency-preview-escalation").innerText();
  check(`preview shows the escalation to the director (${scheme})`, /director@example.com/.test(esc) && /Ben Overdue/.test(esc) && /Sends tonight/.test(esc), "");
  await page.getByTestId("competency-reminders-card").screenshot({ path: `${OUT}/comp_reminders_card_${scheme}.png` });
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
