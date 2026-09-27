// scripts/verify-competency-import-grace.mts
//
// Receipt for the onboarding competency-import fix. Initial-competency due date
// is the LATER of hire+90 and added(created_at)+90. This keeps a promptly-entered
// new hire on the normal hire+90 clock, but gives a tenured employee IMPORTED
// long after hire a full 90-day window from when they were entered, so loading
// an existing roster does not flag every tech competency-overdue on day one.
// It must NOT mask a genuinely overdue new hire (added promptly, hired >90d ago).
//
// Mirrors initialCompetencyDueDate() from server/routes.ts exactly.
//
// Run: npx tsx scripts/verify-competency-import-grace.mts   (exits non-zero on fail)

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`); }
  else { fail++; console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`); }
}

const D = 90 * 24 * 60 * 60 * 1000;
function initialCompetencyDueDate(hireDate: string | null | undefined, createdAt: string | null | undefined): Date | null {
  const cands: number[] = [];
  const h = hireDate ? Date.parse(hireDate) : NaN;
  const c = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isFinite(h)) cands.push(h + D);
  if (Number.isFinite(c)) cands.push(c + D);
  return cands.length ? new Date(Math.max(...cands)) : null;
}

const today = new Date(); today.setHours(0, 0, 0, 0);
const iso = (offsetDays: number) => new Date(today.getTime() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
// "overdue" = due strictly before today (matches computeLabReadiness d < 0).
const isOverdue = (due: Date | null) => (due ? due.getTime() < today.getTime() : true);

// 1) Brand-new hire, entered promptly (hire today, created today) -> due today+90, NOT overdue.
{
  const due = initialCompetencyDueDate(iso(0), iso(0))!;
  check("new hire entered today: not overdue", !isOverdue(due), due.toISOString().slice(0, 10));
  check("new hire due is hire+90", due.toISOString().slice(0, 10) === iso(90));
}

// 2) New hire hired 100 days ago, entered promptly 100 days ago -> STILL overdue
//    (initial was genuinely due at hire+90 = 10 days ago). Fix must not mask this.
{
  const due = initialCompetencyDueDate(iso(-100), iso(-100))!;
  check("genuinely-late new hire still overdue", isOverdue(due), due.toISOString().slice(0, 10));
}

// 3) THE FIX: tenured employee (hired 3 years ago) IMPORTED today -> grace from entry,
//    due = created+90 (future), NOT overdue.
{
  const due = initialCompetencyDueDate(iso(-1095), iso(0))!;
  check("imported tenured employee: not overdue (grace from entry)", !isOverdue(due), due.toISOString().slice(0, 10));
  check("imported grace due = added+90", due.toISOString().slice(0, 10) === iso(90));
}

// 4) Imported tenured employee entered 100 days ago, still no competency -> overdue
//    (grace window expired; the lab has had 100 days to record it).
{
  const due = initialCompetencyDueDate(iso(-1095), iso(-100))!;
  check("imported tenured, grace expired: overdue", isOverdue(due), due.toISOString().slice(0, 10));
}

// 5) Boundary: imported today, exactly at day 90 from entry -> due == today+90, not overdue.
{
  const due = initialCompetencyDueDate(iso(-500), iso(0))!;
  check("boundary at +90 not overdue", !isOverdue(due) && due.toISOString().slice(0, 10) === iso(90));
}

// 6) No hire date but created recently -> falls back to created+90 (was 'today'/overdue before).
{
  const due = initialCompetencyDueDate(null, iso(-10))!;
  check("no hire date, recent entry: uses created+90", due.toISOString().slice(0, 10) === iso(80));
}

// 7) No dates at all -> null (caller falls back to today).
{
  const due = initialCompetencyDueDate(null, null);
  check("no dates -> null", due === null);
}

// 8) Late-entered new hire (hired 20d ago, entered today) -> max(hire+90, created+90)=created+90,
//    never SHORTER than the standard 90-day window.
{
  const due = initialCompetencyDueDate(iso(-20), iso(0))!;
  check("late-entered new hire keeps full 90-day window", due.toISOString().slice(0, 10) === iso(90));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
