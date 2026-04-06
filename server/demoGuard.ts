/**
 * VeritaAssure Demo Integrity Guard
 * 
 * Runs at every startup. Verifies all expected demo studies exist
 * and re-inserts any that are missing (e.g. accidentally deleted).
 * 
 * This is the last line of defense against accidental demo data loss.
 * It does NOT modify correct data -- only inserts missing records.
 */

import { db } from "./db";

// The canonical list of demo studies that must always exist.
// If any are missing at startup, they are restored automatically.
const REQUIRED_DEMO_STUDIES = [
  {
    test_name: "Sodium",
    study_type: "method_comparison",
    description: "Sodium Correlation / Method Comparison (Ortho VITROS 5600 Primary vs Backup)",
  },
  {
    test_name: "Potassium",
    study_type: "method_comparison",
    description: "Potassium Correlation / Method Comparison (Ortho VITROS 5600 Primary vs Backup)",
  },
  {
    test_name: "Creatinine",
    study_type: "cal_ver",
    description: "Creatinine Calibration Verification / Linearity (Siemens Atellica 2)",
  },
  {
    test_name: "Troponin I",
    study_type: "method_comparison",
    description: "Troponin I Correlation / Method Comparison -- FAILING study for demo",
  },
  {
    test_name: "Sodium",
    study_type: "ref_interval",
    description: "Sodium Reference Interval Verification (Ortho VITROS 5600 Primary) -- DIFFERENT from method comparison",
  },
];

export async function verifyDemoIntegrity() {
  const sqlite = (db as any).$client;

  // Find the demo user
  const demoUser = sqlite.prepare(
    "SELECT id FROM users WHERE email = 'demo@veritaslabservices.com' LIMIT 1"
  ).get();

  if (!demoUser) {
    console.log("[demoGuard] Demo user not found -- skipping integrity check (seedDemo will handle)");
    return;
  }

  const demoUserId = demoUser.id;
  const missing: string[] = [];
  const found: string[] = [];

  for (const study of REQUIRED_DEMO_STUDIES) {
    const exists = sqlite.prepare(
      "SELECT id FROM studies WHERE user_id = ? AND test_name = ? AND study_type = ? LIMIT 1"
    ).get(demoUserId, study.test_name, study.study_type);

    if (exists) {
      found.push(`${study.test_name} (${study.study_type})`);
    } else {
      missing.push(study.description);
      console.warn(`[demoGuard] MISSING demo study: ${study.description}`);
    }
  }

  if (missing.length === 0) {
    console.log(`[demoGuard] All ${REQUIRED_DEMO_STUDIES.length} demo studies present. OK.`);
    return;
  }

  // One or more studies missing -- trigger a full re-seed of demo data.
  // seedDemoData is idempotent: it skips already-existing records.
  console.warn(`[demoGuard] ${missing.length} demo study/studies missing -- triggering re-seed...`);
  missing.forEach(m => console.warn(`[demoGuard]   MISSING: ${m}`));

  try {
    const { seedDemoData } = await import("./seedDemo");
    await seedDemoData();
    console.log("[demoGuard] Re-seed complete.");

    // Verify again after re-seed
    let stillMissing = 0;
    for (const study of REQUIRED_DEMO_STUDIES) {
      const exists = sqlite.prepare(
        "SELECT id FROM studies WHERE user_id = ? AND test_name = ? AND study_type = ? LIMIT 1"
      ).get(demoUserId, study.test_name, study.study_type);
      if (!exists) {
        stillMissing++;
        console.error(`[demoGuard] STILL MISSING after re-seed: ${study.description}`);
      }
    }

    if (stillMissing === 0) {
      console.log("[demoGuard] All demo studies restored successfully.");
    } else {
      console.error(`[demoGuard] ${stillMissing} study/studies could not be restored -- manual intervention needed.`);
    }
  } catch (err: any) {
    console.error("[demoGuard] Re-seed failed:", err.message);
  }
}
