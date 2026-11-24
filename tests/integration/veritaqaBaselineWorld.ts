// tests/integration/veritaqaBaselineWorld.ts
//
// The made-up accounts and rows behind tests/integration/fixtures/veritaqa-baseline-main.json, and the reads captured from
// them (B15). The fixture holds the answers of the code before VeritaQA rows carried a laboratory (main 23d7b11d, through
// scripts/capture-veritaqa-baseline.ts); veritaqa-by-lab.test.ts seeds the same rows the way that code stored them, lets the
// boot migration assign them, and asks again. Every id and date is fixed, so the answers are the same on any day. Not a test
// by itself.
//
// Accounts:
//   ONE       owns one laboratory (9011): its rows go to that laboratory
//   THREE     owns three (9021, 9022, 9023): nothing is assigned
//   REPO      owns one laboratory (9041) and a repository (9042): assigned to 9041
//   RETIRED   owns one laboratory (9051) and a retired one (9052): assigned to 9051
//   NOLAB     owns none
//   ADMIN     an admin of 9011 with no seat, who entered rows under their own account
// People: a writer seat, a view-only seat, a Staff login and a seat with no lab under ONE; a writer seat in 9022; an older seat
// with no lab and no membership under THREE; an outsider who owns 9031.

export const U = {
  ONE: 9101, THREE: 9102, ONE_SEAT: 9103, ADMIN: 9104, ONE_VIEW: 9105, ONE_STAFF: 9106, THREE_SEAT: 9107, THREE_OLD: 9108,
  OTHER: 9109, ONE_LABLESS: 9110, REPO: 9111, RETIRED: 9112, NOLAB: 9113,
} as const;
export const L = { A: 9011, T1: 9021, T2: 9022, T3: 9023, OTHER: 9031, REPO: 9041, REPO_LIB: 9042, RET: 9051, RET_OLD: 9052 } as const;
const AT = "2026-01-05T12:00:00.000Z";

function seeder(sqlite: any) {
  return (table: string, values: Record<string, any>) => {
    const row: Record<string, any> = { ...values };
    for (const c of sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]) {
      if (c.notnull && c.dflt_value == null && !c.pk && !(c.name in row)) row[c.name] = /_at$/.test(c.name) ? AT : /INT|REAL/.test(String(c.type)) ? 0 : "x";
    }
    const cols = Object.keys(row);
    sqlite.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((k) => row[k]));
  };
}

/** The people, laboratories and seats. */
export function seedBaselinePeople(sqlite: any) {
  const ins = seeder(sqlite);
  for (const [name, id] of Object.entries(U)) ins("users", { id, email: `${name.toLowerCase()}-qa@example.test`, name: `Made-up ${name}`, plan: "hospital", password_hash: "x", created_at: AT });
  const lab = (id: number, owner: number, name: string, extra: Record<string, any> = {}) => ins("labs", {
    id, lab_name: name, owner_user_id: owner, plan: "hospital", subscription_status: "active", subscription_expires_at: "2099-12-31", clia_number: `22D${id}000`, created_at: AT, updated_at: AT, ...extra,
  });
  lab(L.A, U.ONE, "Made-up Only Lab");
  lab(L.T1, U.THREE, "Made-up Three One"); lab(L.T2, U.THREE, "Made-up Three Two"); lab(L.T3, U.THREE, "Made-up Three Three");
  lab(L.OTHER, U.OTHER, "Made-up Outside Lab");
  lab(L.REPO, U.REPO, "Made-up Repo Owner Lab"); lab(L.REPO_LIB, U.REPO, "Made-up Library", { is_repository: 1 });
  lab(L.RET, U.RETIRED, "Made-up Live Lab"); lab(L.RET_OLD, U.RETIRED, "Made-up Old Lab", { retired_at: AT });
  const member = (labId: number, userId: number, role: string) => ins("lab_members", { lab_id: labId, user_id: userId, role, permissions_json: "{}", status: "active", is_primary_lab: 0, accepted_at: AT, created_at: AT, updated_at: AT });
  member(L.A, U.ONE, "owner");
  for (const t of [L.T1, L.T2, L.T3]) member(t, U.THREE, "owner");
  member(L.OTHER, U.OTHER, "owner");
  member(L.REPO, U.REPO, "owner"); member(L.REPO_LIB, U.REPO, "owner");
  member(L.RET, U.RETIRED, "owner"); member(L.RET_OLD, U.RETIRED, "owner");
  member(L.A, U.ONE_SEAT, "staff"); member(L.A, U.ADMIN, "admin"); member(L.A, U.ONE_VIEW, "staff"); member(L.A, U.ONE_STAFF, "staff");
  member(L.T2, U.THREE_SEAT, "staff");
  const seat = (id: number, owner: number, user: number, labId: number | null, type: string, perms: any, at: string) => ins("user_seats", {
    id, owner_user_id: owner, seat_email: `seat${id}@example.test`, seat_user_id: user, invited_at: at, accepted_at: at, status: "active", permissions: JSON.stringify(perms), invite_token: `qa-baseline-${id}`, lab_id: labId, seat_type: type,
  });
  seat(9301, U.ONE, U.ONE_SEAT, L.A, "active", { mode: "edit_all" }, "2026-11-10T00:00:00Z");
  seat(9302, U.ONE, U.ONE_VIEW, L.A, "view_only", { mode: "view_all" }, "2026-11-10T00:00:00Z");
  seat(9303, U.ONE, U.ONE_STAFF, L.A, "staff_portal", {}, "2026-11-10T00:00:00Z");
  seat(9304, U.ONE, U.ONE_LABLESS, null, "active", { mode: "edit_all" }, "2026-11-10T00:00:00Z");
  seat(9305, U.THREE, U.THREE_SEAT, L.T2, "active", { mode: "edit_all" }, "2026-11-10T00:00:00Z");
  seat(9306, U.THREE, U.THREE_OLD, null, "active", { mode: "edit_all" }, "2026-03-01T00:00:00Z");
}

/** The VeritaQA rows, with no lab column, as the code before B15 stored them. */
export function seedBaselineRows(sqlite: any) {
  const ins = seeder(sqlite);
  const dept = (id: number, account: number, name: string, sort: number) => ins("pi_departments", { id, account_id: account, name, sort_order: sort, active: 1, created_at: AT });
  const metric = (id: number, department: number, account: number, name: string, o: Record<string, any> = {}) => ins("pi_metrics", {
    id, department_id: department, account_id: account, name, unit: "%", direction: "lower_is_better", benchmark_green: 2, benchmark_yellow: 3, benchmark_red: 4, sort_order: 0, active: 1, created_at: AT, ...o,
  });
  let entryId = 9700;
  const entry = (metricId: number, account: number, year: number, month: number, value: number | null, volume: number | null, o: Record<string, any> = {}) => ins("pi_entries", {
    id: ++entryId, metric_id: metricId, account_id: account, year, month, value, volume, notes: null, created_at: AT, updated_at: AT, ...o,
  });
  const plan = (id: number, account: number, title: string, reviewed: string | null) => {
    ins("pi_plan", { id, account_id: account, title, effective_year: 2026, status: "active", program_scope: "Every department", measurement_methods: "Monthly counts", analysis_methods: "Run charts", remediation_methods: "Corrective action", monitor_sustain_methods: "Quarterly check", created_at: AT, updated_at: AT });
    ins("pi_plan_priority", { id: id + 100, plan_id: id, account_id: account, process_name: "Critical calls", stakeholder_requirements: "Nursing", goal: "Within 30 minutes", improvement_activities: "Call log", linked_metric_id: null, linked_department_id: null, sort_order: 0, created_at: AT });
    if (reviewed) ins("pi_plan_review", { id: id + 200, plan_id: id, account_id: account, reviewed_by: "Made-up Director", reviewer_title: "Medical director", review_date: reviewed, changes_summary: "None", next_review_due: "2019-05-01", created_at: AT });
  };
  for (const [i, account] of [U.ONE, U.THREE, U.REPO, U.RETIRED, U.NOLAB, U.ADMIN].entries()) {
    const base = 9500 + i * 10;
    dept(base + 1, account, "Hematology", 1);
    dept(base + 2, account, "Chemistry", 0);
    metric(base + 1, base + 2, account, `Hemolysis rate ${account}`, { sort_order: 1 });
    metric(base + 2, base + 2, account, `Corrected reports ${account}`, { direction: "higher_is_better", benchmark_green: 99, benchmark_yellow: 97, benchmark_red: null });
    metric(base + 3, base + 1, account, `Retired indicator ${account}`, { active: 0 });
    metric(base + 4, base + 1, account, `No target ${account}`, { benchmark_green: null, benchmark_yellow: null, benchmark_red: null, unit: "count" });
    metric(base + 5, base + 1, account, `TAT ${account}`, { unit: "minutes", is_tat: 1, tat_start_event: "receipt", tat_end_event: "result_verified", tat_threshold_minutes: 60, measurement_methodology: "LIS stamps", benchmark_green: 45, benchmark_yellow: 60 });
    entry(base + 1, account, 2026, 1, 1.5, 400); entry(base + 1, account, 2026, 2, 3.5, 380, { notes: "Short staffed", root_cause: "Draw site", corrective_action: "Retraining", rca_reviewed_by: "Made-up Lead", rca_reviewed_at: AT });
    entry(base + 1, account, 2026, 5, 2.5, null); entry(base + 1, account, 2025, 12, 2.1, 350);
    entry(base + 2, account, 2026, 1, 98.2, 900); entry(base + 2, account, 2026, 2, 99.5, 910);
    entry(base + 3, account, 2026, 1, 9.9, 10);
    entry(base + 4, account, 2026, 3, 12, null);
    entry(base + 5, account, 2026, 1, 44, 120); entry(base + 5, account, 2026, 4, 61, 130);
  }
  plan(9801, U.ONE, "Only lab plan", "2018-05-01");
  plan(9802, U.THREE, "Three lab plan", null);
  plan(9803, U.ADMIN, "Own plan of the admin", "2018-05-01");
}

/** Every VeritaQA read there was, by each person, with no lab named and with each laboratory named. */
export function baselineReads() {
  const people: [keyof typeof U, (number | null)[], number][] = [
    ["ONE", [null, L.A], 9500], ["ONE_SEAT", [null, L.A], 9500], ["ADMIN", [null, L.A], 9550], ["ONE_VIEW", [null, L.A], 9500], ["ONE_STAFF", [null, L.A], 9500], ["ONE_LABLESS", [null], 9500],
    ["THREE", [null, L.T1, L.T2, L.T3], 9510], ["THREE_SEAT", [null, L.T2], 9510], ["THREE_OLD", [null], 9510],
    ["OTHER", [null, L.OTHER], 9500], ["REPO", [null, L.REPO, L.REPO_LIB], 9520], ["RETIRED", [null, L.RET, L.RET_OLD], 9530], ["NOLAB", [null], 9540],
  ];
  const out: { key: string; user: keyof typeof U; lab: number | null; method: string; path: string }[] = [];
  for (const [user, labs, base] of people) for (const lab of labs) {
    const add = (method: string, path: string) => out.push({ key: `${user} @${lab ?? "none"} ${method} ${path}`, user, lab, method, path });
    add("GET", "/api/pi/departments");
    for (const d of ["all", String(base + 1), String(base + 2)]) {
      add("GET", `/api/pi/metrics?department_id=${d}`);
      add("GET", `/api/pi/entries?year=2026&department_id=${d}`);
      add("GET", `/api/pi/dashboard?year=2026&department_id=${d}`);
    }
    add("GET", "/api/pi/metrics");
    add("GET", "/api/pi/entries?year=2025&department_id=all");
    add("GET", "/api/pi/dashboard?year=2025&department_id=all");
    add("GET", "/api/pi/plan");
    add("POST", `/api/pi/metrics/${base + 1}/report?year=2026`);
  }
  return out;
}

export async function capture(ask: (user: number, lab: number | null, method: string, path: string) => Promise<{ status: number; body: any }>) {
  const answers: Record<string, { status: number; body: any }> = {};
  for (const r of baselineReads()) answers[r.key] = await ask(U[r.user], r.lab, r.method, r.path);
  return answers;
}
