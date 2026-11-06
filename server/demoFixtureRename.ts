// server/demoFixtureRename.ts
//
// One-time rename of the demo lab fixture on a database that already holds it (Michael Q190 = 1, 2026-11-06: a real hospital has
// the old name). A fresh database gets the new name from the seed. The boot seed never rewrites an existing row, so a deploy
// changes no data: existing rows move only through POST /api/admin/demo-fixture/rename, which is a dry run unless told otherwise.
//
// Only the fixture moves, found by what it is and not by a name that someone else could share:
//   labs and users: CLIA 22D0999999 with exactly the old name.
//   staff_labs: exactly the old name (or its "Core Laboratory" form) on CLIA 22D0999999 or the older VeritaStaff seed's CLIA.
//   veritamap_maps and veritascan_scans: titled with the old name and owned by the demo user or a fixture lab.
//   studies: the demo user's own, naming a real person as analyst. The boot seed no longer sets the analyst on an existing row either.
// Any other row carrying the old name is left alone and counted, so the owner sees it and decides. The report has counts and ids, no names.

export const DEMO_FIXTURE_NAME = "Sample Regional Medical Center";
export const DEMO_FIXTURE_CLIA = "22D0999999";
const OLD_NAME = "Riverside Regional Medical Center";
const OLD_CORE_NAME = `${OLD_NAME} - Core Laboratory`;
const NEW_CORE_NAME = `${DEMO_FIXTURE_NAME} - Core Laboratory`;
const OLD_PREFIX = "Riverside Regional";
const NEW_PREFIX = "Sample Regional";
const OLDER_STAFF_SEED_CLIA = "05D2187634"; // server/db.ts, the older VeritaStaff demo seed
const OLD_STAFF_ADDRESS = { lab_address_street: "1 Riverside Drive", lab_address_city: "Riverside", lab_address_zip: "92501" };
const NEW_STAFF_ADDRESS = { lab_address_street: "1 Sample Drive", lab_address_city: "Sampletown", lab_address_zip: "00000" };

const OLD_ANALYST = "Michael Veri, MS, MBA, MLS(ASCP), CPHQ";
const NEW_ANALYST = "T. Alvarez, MLS(ASCP)";

const TABLES = ["labs", "users", "staff_labs", "veritamap_maps", "veritascan_scans", "studies"] as const;
type FixtureTable = (typeof TABLES)[number];
// Column -> [value now, value after]. Each update repeats the value now in its WHERE, so a row changed since the plan is left alone.
export type FixtureRow = { table: FixtureTable; id: number; changes: Record<string, [string, string]> };

// The maps and scans on production predate the em dash rule, and these titles show on the public demo.
const renamedTitle = (name: string) => name.replace(OLD_PREFIX, NEW_PREFIX).replace(/\s*—\s*/g, " - ");

export function planDemoFixtureRename(sqlite: any, demoUserEmail: string): { rows: FixtureRow[]; demoUserFound: boolean } {
  const demoUser = sqlite.prepare("SELECT id FROM users WHERE email = ?").get(demoUserEmail) as { id: number } | undefined;
  const rows: FixtureRow[] = [];
  const labs = sqlite.prepare("SELECT id FROM labs WHERE clia_number = ? AND lab_name = ?").all(DEMO_FIXTURE_CLIA, OLD_NAME) as Array<{ id: number }>;
  for (const l of labs) rows.push({ table: "labs", id: l.id, changes: { lab_name: [OLD_NAME, DEMO_FIXTURE_NAME] } });
  for (const u of sqlite.prepare("SELECT id FROM users WHERE clia_number = ? AND clia_lab_name = ?").all(DEMO_FIXTURE_CLIA, OLD_NAME) as Array<{ id: number }>) {
    rows.push({ table: "users", id: u.id, changes: { clia_lab_name: [OLD_NAME, DEMO_FIXTURE_NAME] } });
  }
  const staffLabs = sqlite.prepare(
    `SELECT id, lab_name, lab_address_street, lab_address_city, lab_address_zip FROM staff_labs
      WHERE clia_number IN (?, ?) AND lab_name IN (?, ?)`
  ).all(DEMO_FIXTURE_CLIA, OLDER_STAFF_SEED_CLIA, OLD_NAME, OLD_CORE_NAME) as any[];
  for (const s of staffLabs) {
    const changes: FixtureRow["changes"] = { lab_name: [s.lab_name, s.lab_name === OLD_CORE_NAME ? NEW_CORE_NAME : DEMO_FIXTURE_NAME] };
    // The old address carries the old name too. Any other address on the row is left as it is.
    for (const [col, oldValue] of Object.entries(OLD_STAFF_ADDRESS)) {
      if (s[col] === oldValue) changes[col] = [oldValue, NEW_STAFF_ADDRESS[col as keyof typeof NEW_STAFF_ADDRESS]];
    }
    rows.push({ table: "staff_labs", id: s.id, changes });
  }
  const labIds = new Set(labs.map((l) => l.id));
  for (const table of ["veritamap_maps", "veritascan_scans"] as const) {
    for (const r of sqlite.prepare(`SELECT id, name, user_id, lab_id FROM ${table} WHERE name LIKE ?`).all(`${OLD_PREFIX}%`) as any[]) {
      const inFixture = (demoUser != null && r.user_id === demoUser.id) || (r.lab_id != null && labIds.has(r.lab_id));
      if (inFixture && String(r.name).startsWith(OLD_PREFIX)) rows.push({ table, id: r.id, changes: { name: [r.name, renamedTitle(r.name)] } });
    }
  }
  // The public demo reads the demo user's studies by that user, so only those move. A study in anyone else's account is that person's record.
  if (demoUser) {
    for (const s of sqlite.prepare("SELECT id FROM studies WHERE user_id = ? AND analyst = ?").all(demoUser.id, OLD_ANALYST) as Array<{ id: number }>) {
      rows.push({ table: "studies", id: s.id, changes: { analyst: [OLD_ANALYST, NEW_ANALYST] } });
    }
  }
  return { rows, demoUserFound: !!demoUser };
}

/**
 * The CLIA on a public sample report (client/src/lib/demoSampleReports.ts). With no signed-in lab, POST /api/generate-pdf has no CLIA to print, so these read "Not on file" under a lab the page says
 * is CLIA 22D0999999. Only the fixture's exact name and number together are honored, so nobody can stamp another lab's CLIA on a report with no sign-in.
 */
export function fixtureCliaForSampleReport(study: any): string | undefined {
  return study?._labName === DEMO_FIXTURE_NAME && study?._cliaNumber === DEMO_FIXTURE_CLIA ? DEMO_FIXTURE_CLIA : undefined;
}

/** Rows that carry the old name and aren't the fixture. Counts only: nothing here is ever changed by this code. */
function leftAloneCounts(sqlite: any, rows: FixtureRow[]) {
  const planned = (table: FixtureTable) => rows.filter((r) => r.table === table).length;
  const like = `${OLD_PREFIX}%`;
  const count = (sql: string) => Number((sqlite.prepare(sql).get(like) as { n: number }).n);
  return {
    labs: count("SELECT COUNT(*) AS n FROM labs WHERE lab_name LIKE ?") - planned("labs"),
    users: count("SELECT COUNT(*) AS n FROM users WHERE clia_lab_name LIKE ?") - planned("users"),
    staff_labs: count("SELECT COUNT(*) AS n FROM staff_labs WHERE lab_name LIKE ?") - planned("staff_labs"),
    veritamap_maps: count("SELECT COUNT(*) AS n FROM veritamap_maps WHERE name LIKE ?") - planned("veritamap_maps"),
    veritascan_scans: count("SELECT COUNT(*) AS n FROM veritascan_scans WHERE name LIKE ?") - planned("veritascan_scans"),
    invoice_requests: count("SELECT COUNT(*) AS n FROM invoice_requests WHERE lab_name LIKE ?"),
    founding_lab_applications: count("SELECT COUNT(*) AS n FROM founding_lab_applications WHERE lab_name LIKE ?"),
    schedule_bookings: count("SELECT COUNT(*) AS n FROM schedule_bookings WHERE lab_name LIKE ?"),
  };
}

/** Counts and ids for the dry run. Reads only. */
export function demoFixtureRenameReport(sqlite: any, plan: { rows: FixtureRow[]; demoUserFound: boolean }) {
  const toChange = Object.fromEntries(TABLES.map((t) => {
    const ids = plan.rows.filter((r) => r.table === t).map((r) => r.id);
    return [t, { count: ids.length, ids }];
  }));
  return { demoUserFound: plan.demoUserFound, total: plan.rows.length, toChange, leftAlone: leftAloneCounts(sqlite, plan.rows) };
}

/** All of it or none of it. Returns the rows actually changed. */
export function applyDemoFixtureRename(sqlite: any, rows: FixtureRow[]): FixtureRow[] {
  return sqlite.transaction(() => rows.filter((r) => {
    const cols = Object.keys(r.changes);
    const sets = cols.map((c) => `${c} = ?`).join(", ");
    const wheres = cols.map((c) => `${c} = ?`).join(" AND ");
    const args = [...cols.map((c) => r.changes[c][1]), r.id, ...cols.map((c) => r.changes[c][0])];
    return sqlite.prepare(`UPDATE ${r.table} SET ${sets} WHERE id = ? AND ${wheres}`).run(...args).changes === 1;
  }))();
}
