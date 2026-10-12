// tests/integration/demo-seed-staff-guard.test.ts
//
// Receipt for BUG-039 (2026-10-12). The boot-time demo seeder (server/seedDemo.ts) seeded Riverside's VeritaStaff lab
// and six people only when no staff_labs row belonged to the demo USER. The BUG-032 owner repair (10/11) moved
// Riverside's staff rows to the lab owner, so the next boot re-seeded six duplicate people into Riverside (production
// staff_employees 242-247, created at the 3c999bdd boot). The guard now also looks at the demo user's lab.
//   1. a fresh seed creates the demo staff (fixture; the count depends on the boot seed in db.ts)
//   2. after the staff rows move to another owner (what the repair did), a second seed adds no people and no staff lab
//   3. a third seed is still a no-op
// Run (from bash): DB_PATH=.tmp-dssg.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/demo-seed-staff-guard.test.ts
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { seedDemoData } = await import("../../server/seedDemo");
  const sqlite = (db as any).$client;
  await seedDemoData();
  const demo = sqlite.prepare("SELECT id, lab_id FROM users WHERE email = 'demo@veritaslabservices.com'").get() as any;
  let labId = demo?.lab_id;
  if (labId == null) {
    labId = Number(sqlite.prepare("INSERT INTO labs (lab_name, clia_number, owner_user_id) VALUES ('Riverside Regional Medical Center', '22D0999999', ?)").run(demo.id).lastInsertRowid);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(labId, demo.id);
  }
  // Tie the seeded staff to the demo lab, as production's tier2 backfill did.
  sqlite.prepare("UPDATE staff_labs SET tier2_lab_id = ? WHERE user_id = ?").run(labId, demo.id);
  sqlite.prepare("UPDATE staff_employees SET tier2_lab_id = ? WHERE user_id = ?").run(labId, demo.id);
  const count = () => ({
    people: (sqlite.prepare("SELECT COUNT(*) AS n FROM staff_employees WHERE tier2_lab_id = ? OR user_id = ?").get(labId, demo.id) as any).n,
    labs: (sqlite.prepare("SELECT COUNT(*) AS n FROM staff_labs WHERE tier2_lab_id = ? OR user_id = ?").get(labId, demo.id) as any).n,
  });
  const c0 = count();
  check("1. fresh seed creates the demo staff lab and its people", c0.people >= 1 && c0.labs >= 1, JSON.stringify(c0));

  // What the BUG-032 owner repair did on production: the rows now belong to the lab owner, not the demo user.
  const OTHER = 990001;
  sqlite.prepare("UPDATE staff_labs SET user_id = ? WHERE user_id = ?").run(OTHER, demo.id);
  sqlite.prepare("UPDATE staff_employees SET user_id = ? WHERE user_id = ?").run(OTHER, demo.id);
  await seedDemoData();
  const c1 = count();
  check("2. after the rows move to another owner, a boot seed adds no people and no staff lab", c1.people === c0.people && c1.labs === c0.labs, `${JSON.stringify(c0)} -> ${JSON.stringify(c1)}`);
  await seedDemoData();
  const c2 = count();
  check("3. another boot seed is still a no-op", c2.people === c0.people && c2.labs === c0.labs, `${JSON.stringify(c0)} -> ${JSON.stringify(c2)}`);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
