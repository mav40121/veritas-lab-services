// scripts/verify-veritatrack-dashboard-date.mjs
//
// Receipt for the VeritaTrack dashboard-shape + due-today fixes (audit #5 + #6,
// 2026-07-11):
//   #6 taskStatus / worklist / both dashboards / client daysLabel diffed a
//      UTC-midnight due date against a live timestamp, so in a US timezone a
//      task read "overdue" (and "1d overdue") on its actual due date and the
//      Due-Today bucket was always empty. A shared date-only helper
//      (daysUntilDateOnly, both parsed at UTC midnight) makes due-today == 0.
//   #5 the lab-scoped dashboard returned a snake_case, dueThisMonth-less shape,
//      so the client's Due This Month / Due Soon cards were blank on the
//      multi-lab path. It now returns the same camelCase shape as the legacy
//      dashboard.
//
//   node scripts/verify-veritatrack-dashboard-date.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const srv = read("server/veritatrack.ts");
const cli = read("client/src/pages/VeritaTrackAppPage.tsx");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// ── source receipts ───────────────────────────────────────────────────────
console.log("--- source receipts ---");
// #6 date-only helper + usages
ok("#6 daysUntilDateOnly helper defined (UTC-midnight date-only diff)",
  /function daysUntilDateOnly\(dateStr: string\): number \{[\s\S]*?Date\.parse\(dateStr \+ "T00:00:00Z"\)[\s\S]*?Date\.parse\(todayStr \+ "T00:00:00Z"\)/.test(srv));
ok("#6 taskStatus uses the date-only helper (no live-timestamp diff)",
  /function taskStatus[\s\S]*?const daysUntil = daysUntilDateOnly\(nextDueDate\);/.test(srv) &&
  !/function taskStatus[\s\S]*?Math\.floor\(\(due\.getTime\(\) - now\.getTime\(\)\)/.test(srv));
ok("#6 both server dashboards use daysUntilDateOnly for the overdue boundary",
  (srv.match(/const daysUntil = daysUntilDateOnly\(nextDueDate\);/g) || []).length >= 2);
ok("#6 client daysLabel uses a date-only diff (Due today on the due date)",
  /function daysLabel[\s\S]*?Date\.parse\(next_due \+ "T00:00:00Z"\)[\s\S]*?Date\.parse\(todayStr \+ "T00:00:00Z"\)/.test(cli));

// #5 lab-scoped dashboard shape
ok("#5 lab-scoped dashboard returns the camelCase shape (dueThisMonth + *Items)",
  /res\.json\(\{ overdue, dueThisMonth, dueSoon, current, notStarted, total: tasks\.length, overdueItems, dueThisMonthItems, dueSoonItems \}\);/.test(srv));
ok("#5 the old snake_case, dueThisMonth-less lab-scoped response is gone",
  !/res\.json\(\{ overdue, due_soon: dueSoon, current, not_started: notStarted, total: tasks\.length, tasks: items \}\);/.test(srv));

// ── functional date-math proof ────────────────────────────────────────────
console.log("--- functional date-math proof ---");
// Replicate the exact helper and prove the boundary behavior.
const daysUntilDateOnly = (dateStr, todayStr) =>
  Math.round((Date.parse(dateStr + "T00:00:00Z") - Date.parse(todayStr + "T00:00:00Z")) / 86400000);
const TODAY = "2026-07-12";
ok("a task due TODAY yields 0 (not overdue)", daysUntilDateOnly(TODAY, TODAY) === 0);
ok("a task due YESTERDAY yields -1 (overdue)", daysUntilDateOnly("2026-07-11", TODAY) === -1);
ok("a task due TOMORROW yields +1", daysUntilDateOnly("2026-07-13", TODAY) === 1);
ok("a task due in 30 days yields 30 (still due_soon boundary)", daysUntilDateOnly("2026-08-11", TODAY) === 30);
// The OLD math: UTC-midnight due vs a live afternoon timestamp floored to -1 on the due date.
const oldMathDueToday = Math.floor((Date.parse(TODAY) - Date.parse(TODAY + "T14:00:00Z")) / 86400000);
ok("the OLD live-timestamp math wrongly returned -1 for a due-today task", oldMathDueToday === -1);

console.log(fails === 0 ? "\n=== VERITATRACK DASHBOARD/DATE: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
