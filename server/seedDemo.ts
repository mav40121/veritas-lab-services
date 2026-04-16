/**
 * Seed demo account data for Riverside Regional Medical Center.
 * Runs on startup -- safe to re-run (uses INSERT OR IGNORE / upsert logic).
 */
import { db } from "./db";
import bcrypt from "bcryptjs";

export async function seedDemoData() {
  const sqlite = (db as any).$client;

  // ─── 1. Demo User ──────────────────────────────────────────────────────
  const existing = sqlite.prepare("SELECT id FROM users WHERE email = 'demo@veritaslabservices.com'").get();
  let demoUserId: number;

  if (existing) {
    demoUserId = existing.id;
    sqlite.prepare("UPDATE users SET plan = 'lab', has_completed_onboarding = 1, clia_number = '22D0999999', clia_lab_name = 'Riverside Regional Medical Center' WHERE id = ?").run(demoUserId);
  } else {
    const hash = await bcrypt.hash("VeritaDemo2026!", 10);
    const now = new Date().toISOString();
    const result = sqlite.prepare(
      "INSERT INTO users (email, password_hash, name, plan, study_credits, has_completed_onboarding, clia_number, clia_lab_name, created_at) VALUES (?, ?, ?, 'lab', 99999, 1, '22D0999999', 'Riverside Regional Medical Center', ?)"
    ).run("demo@veritaslabservices.com", hash, "Demo User", now);
    demoUserId = Number(result.lastInsertRowid);
  }

  console.log(`[seed] Demo user id=${demoUserId}`);

  // ─── 2. VeritaMap -- Riverside Regional Map ──────────────────────────────
  const existingMap = sqlite.prepare("SELECT id FROM veritamap_maps WHERE user_id = ?").get(demoUserId);
  let mapId: number;
  const now = new Date().toISOString();

  if (existingMap) {
    mapId = existingMap.id;
    // Verify we have at least 3 chemistry instruments
    const chemCount = sqlite.prepare(
      "SELECT COUNT(*) as cnt FROM veritamap_instruments WHERE map_id = ? AND category = 'Chemistry'"
    ).get(mapId)?.cnt || 0;
    if (chemCount < 3) {
      // Add missing instruments
      const existingInsts = sqlite.prepare("SELECT instrument_name FROM veritamap_instruments WHERE map_id = ?").all(mapId).map((r: any) => r.instrument_name);
      const requiredChem = [
        { name: "Ortho VITROS 5600 [Primary]", role: "Primary" },
        { name: "Ortho VITROS 5600 [Backup]", role: "Backup" },
        { name: "Siemens ADVIA 1800", role: "Satellite" },
      ];
      for (const inst of requiredChem) {
        if (!existingInsts.includes(inst.name)) {
          sqlite.prepare(
            "INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?, ?, ?, 'Chemistry', ?)"
          ).run(mapId, inst.name, inst.role, now);
        }
      }
    }
    console.log("[seed] Demo map already exists, checking remaining data.");
  } else {
    const mapResult = sqlite.prepare(
      "INSERT INTO veritamap_maps (user_id, name, instruments, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)"
    ).run(demoUserId, "Riverside Regional - 2026 Compliance Map", now, now);
    mapId = Number(mapResult.lastInsertRowid);
    seedMapData(sqlite, mapId, now);
  }

  // ─── 3. VeritaScan ──────────────────────────────────────────────────────
  const existingScan = sqlite.prepare("SELECT id FROM veritascan_scans WHERE user_id = ?").get(demoUserId);
  if (!existingScan) {
    seedScanData(sqlite, demoUserId, now);
  }

  // ─── 4. VeritaCheck Studies (Sodium + Potassium method comparisons) ─────
  const existingStudies = sqlite.prepare("SELECT id FROM studies WHERE user_id = ?").get(demoUserId);
  if (!existingStudies) {
    seedStudies(sqlite, demoUserId, now);
  }

  // ─── 4.5. Troponin I failing method comparison study ──────────────
  const troponinStudy = sqlite.prepare(
    "SELECT id FROM studies WHERE user_id = ? AND test_name = 'Troponin I' AND study_type = 'method_comparison' LIMIT 1"
  ).get(demoUserId);
  if (!troponinStudy) {
    seedTroponinStudy(sqlite, demoUserId, now);
  } else {
    // Backfill UPDATE in case study exists with wrong data
    const troponinDataPoints = generateTroponinData();
    sqlite.prepare(
      "UPDATE studies SET instrument = ?, analyst = ?, date = ?, clia_allowable_error = ?, tea_is_percentage = ?, tea_unit = ?, data_points = ?, instruments = ?, status = ? WHERE id = ?"
    ).run(
      'Abbott ARCHITECT i2000SR [Primary]',
      'Michael Veri, MS, MBA, MLS(ASCP), CPHQ',
      '2026-02-14',
      0.30, // 30% TEa stored as decimal fraction
      1, // percentage
      '%',
      JSON.stringify(troponinDataPoints),
      JSON.stringify(['Abbott ARCHITECT i2000SR [Primary]', 'Abbott ARCHITECT i2000SR [Backup]']),
      'completed',
      troponinStudy.id
    );
    console.log(`[seed] Backfilled Troponin I study id=${troponinStudy.id}`);
  }

  // ─── 4a. Patch demo instruments - remove Reference role
  (db as any).$client.prepare(
    "UPDATE veritamap_instruments SET role = 'Primary' WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = ?) AND role = 'Reference'"
  ).run(demoUserId);

  // ─── 4b. Patch creatinine cal ver with real Atellica 2 data ──────────────
  // Update any existing creatinine cal_ver study for demo user to use real values
  const creatStudy = sqlite.prepare(
    "SELECT id FROM studies WHERE user_id = ? AND test_name = 'Creatinine' AND study_type = 'cal_ver' LIMIT 1"
  ).get(demoUserId);
  if (creatStudy) {
    const realData = generateCreatinineCalVerData();
    sqlite.prepare(
      "UPDATE studies SET instrument = ?, analyst = ?, date = ?, clia_allowable_error = ?, tea_is_percentage = ?, tea_unit = ?, data_points = ?, instruments = ? WHERE id = ?"
    ).run(
      "Siemens Atellica 2",
      "SED",
      "2025-02-06",
      0.075, // 7.5% TEa stored as decimal fraction
      1, // percentage
      "%",
      JSON.stringify(realData),
      JSON.stringify(["Siemens Atellica 2"]),
      creatStudy.id
    );
    console.log(`[seed] Patched creatinine cal ver study id=${creatStudy.id} with real Atellica 2 data`);
  }

  // ─── 4c. Backfill result field + correct TEa decimal fractions + tea_is_percentage on all demo studies
  sqlite.prepare("UPDATE studies SET result = 'pass', clia_allowable_error = 0.075, tea_is_percentage = 1, tea_unit = '%' WHERE user_id = ? AND test_name = 'Creatinine'").run(demoUserId);
  sqlite.prepare("UPDATE studies SET result = 'pass', clia_allowable_error = 4, tea_is_percentage = 0, tea_unit = 'mmol/L', data_points = ? WHERE user_id = ? AND test_name = 'Sodium' AND study_type = 'method_comparison'").run(JSON.stringify(generateSodiumData()), demoUserId);
  sqlite.prepare("UPDATE studies SET result = 'pass', clia_allowable_error = 0.3, tea_is_percentage = 0, tea_unit = 'mmol/L', data_points = ? WHERE user_id = ? AND test_name = 'Potassium'").run(JSON.stringify(generatePotassiumData()), demoUserId);
  // Troponin I: backfill verified data points + result for existing deployments
  sqlite.prepare("UPDATE studies SET result = 'fail', clia_allowable_error = 0.30, tea_is_percentage = 1, tea_unit = '%', data_points = ? WHERE user_id = ? AND test_name = 'Troponin I'").run(JSON.stringify(generateTroponinData()), demoUserId);
  // Sodium Reference Range Verification - restore if deleted, backfill if exists
  const existingSodiumRefInterval = sqlite.prepare(
    "SELECT id FROM studies WHERE user_id = ? AND test_name = 'Sodium' AND study_type = 'ref_interval' LIMIT 1"
  ).get(demoUserId);
  if (!existingSodiumRefInterval) {
    const sodiumRefSpecimens = [
      { specimenId: "S001", value: 137 }, { specimenId: "S002", value: 140 },
      { specimenId: "S003", value: 138 }, { specimenId: "S004", value: 142 },
      { specimenId: "S005", value: 136 }, { specimenId: "S006", value: 141 },
      { specimenId: "S007", value: 139 }, { specimenId: "S008", value: 143 },
      { specimenId: "S009", value: 137 }, { specimenId: "S010", value: 140 },
      { specimenId: "S011", value: 138 }, { specimenId: "S012", value: 144 },
      { specimenId: "S013", value: 136 }, { specimenId: "S014", value: 141 },
      { specimenId: "S015", value: 139 }, { specimenId: "S016", value: 142 },
      { specimenId: "S017", value: 137 }, { specimenId: "S018", value: 140 },
      { specimenId: "S019", value: 138 }, { specimenId: "S020", value: 143 },
    ];
    sqlite.prepare(`
      INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, result, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pass', 'completed', ?)
    `).run(
      demoUserId,
      "Sodium",
      "Ortho VITROS 5600 [Primary]",
      "Michael Veri, MS, MBA, MLS(ASCP), CPHQ",
      "2026-01-29",
      "ref_interval",
      4, // 4 mmol/L absolute TEa (same as Sodium method comparison)
      0, // not percentage
      "mmol/L",
      JSON.stringify({ specimens: sodiumRefSpecimens, refLow: 136, refHigh: 145, analyte: "Sodium", units: "mmol/L" }),
      JSON.stringify(["Ortho VITROS 5600 [Primary]"]),
      now
    );
    console.log("[seed] Restored Sodium Reference Range Verification study");
  } else {
    sqlite.prepare("UPDATE studies SET result = 'pass', clia_allowable_error = 4, tea_is_percentage = 0, tea_unit = 'mmol/L' WHERE user_id = ? AND test_name = 'Sodium' AND study_type = 'ref_interval'").run(demoUserId);
  }

  // ─── 5. VeritaComp -- Competency Assessment ────────────────────────────
  const existingComp = sqlite.prepare(
    "SELECT id FROM competency_programs WHERE user_id = ?"
  ).get(demoUserId);
  if (!existingComp) {
    seedCompetencyData(sqlite, demoUserId, now);
  } else {
    // Backfill element-specific fields on existing assessment items
    backfillCompetencyElements(sqlite, existingComp.id);
  }

  // ─── 6. CUMSUM Tracker ─────────────────────────────────────────────────
  const existingTracker = sqlite.prepare("SELECT id FROM cumsum_trackers WHERE user_id = ?").get(demoUserId);
  if (!existingTracker) {
    seedCumsumData(sqlite, demoUserId, now);
  }

  // ─── VeritaPT demo data ────────────────────────────────────────────────────
  const existingPT = sqlite.prepare("SELECT id FROM pt_enrollments WHERE user_id = ?").get(demoUserId);
  if (!existingPT) {
    seedPTData(sqlite, demoUserId, now);
  }

  // VeritaPolicy: seed settings + sample policies + requirement statuses
  const existingPolicy = sqlite.prepare("SELECT id FROM veritapolicy_settings WHERE user_id = ?").get(demoUserId);
  if (!existingPolicy) {
    seedPolicyData(sqlite, demoUserId, now);
  }

  // ─── VeritaBench: Productivity Months ────────────────────────────────────────
  const existingProd = sqlite.prepare("SELECT id FROM productivity_months WHERE account_id = ?").get(demoUserId);
  if (!existingProd) {
    seedProductivityData(sqlite, demoUserId, now);
  }

  // ─── VeritaBench: Staffing Study ─────────────────────────────────────────────
  const existingStaffStudy = sqlite.prepare("SELECT id FROM staffing_studies WHERE account_id = ?").get(demoUserId);
  if (!existingStaffStudy) {
    seedStaffingData(sqlite, demoUserId, now);
  }

  // ─── VeritaBench: Inventory Items (always re-seed to pick up schema changes) ──
  sqlite.prepare("DELETE FROM inventory_items WHERE account_id = ?").run(demoUserId);
  seedInventoryData(sqlite, demoUserId, now);

  console.log(`[seed] Demo data seeded for user=${demoUserId}`);
}

// ─── Map seeding ──────────────────────────────────────────────────────────────
function seedMapData(sqlite: any, mapId: number, now: string) {
  const instruments = [
    { name: "Ortho VITROS 5600 [Primary]", role: "Primary", category: "Chemistry", tests: [
      { analyte: "Sodium", specialty: "Electrolytes/Routine Chemistry", complexity: "MODERATE" },
      { analyte: "Potassium", specialty: "Electrolytes/Routine Chemistry", complexity: "MODERATE" },
      { analyte: "Troponin", specialty: "Chemistry", complexity: "MODERATE" },
    ]},
    { name: "Ortho VITROS 5600 [Backup]", role: "Backup", category: "Chemistry", tests: [
      { analyte: "Sodium", specialty: "Electrolytes/Routine Chemistry", complexity: "MODERATE" },
      { analyte: "Potassium", specialty: "Electrolytes/Routine Chemistry", complexity: "MODERATE" },
      { analyte: "Troponin", specialty: "Chemistry", complexity: "MODERATE" },
    ]},
    { name: "Siemens ADVIA 1800", role: "Satellite", category: "Chemistry", tests: [
      { analyte: "Sodium", specialty: "Electrolytes/Routine Chemistry", complexity: "MODERATE" },
      { analyte: "Potassium", specialty: "Electrolytes/Routine Chemistry", complexity: "MODERATE" },
    ]},
    { name: "Tosoh", role: "Satellite", category: "Chemistry", tests: [
      { analyte: "Hemoglobin A1c", specialty: "Chemistry", complexity: "MODERATE" },
    ]},
    { name: "XN-1000", role: "Primary", category: "Hematology", tests: [
      { analyte: "Hemoglobin", specialty: "Hematology", complexity: "MODERATE" },
      { analyte: "Platelet Count", specialty: "Hematology", complexity: "MODERATE" },
      { analyte: "Differential", specialty: "Hematology", complexity: "HIGH" },
    ]},
    { name: "XN-450", role: "Backup", category: "Hematology", tests: [
      { analyte: "Hemoglobin", specialty: "Hematology", complexity: "MODERATE" },
      { analyte: "Platelet Count", specialty: "Hematology", complexity: "MODERATE" },
      { analyte: "Differential", specialty: "Hematology", complexity: "HIGH" },
    ]},
    { name: "Manual Differential", role: "Primary", category: "Hematology", tests: [
      { analyte: "Differential", specialty: "Hematology", complexity: "HIGH" },
    ]},
    { name: "CA-660 Primary", role: "Primary", category: "Coagulation", tests: [
      { analyte: "PT", specialty: "Coagulation", complexity: "MODERATE" },
      { analyte: "PTT", specialty: "Coagulation", complexity: "MODERATE" },
    ]},
    { name: "CA-660 Backup", role: "Backup", category: "Coagulation", tests: [
      { analyte: "PT", specialty: "Coagulation", complexity: "MODERATE" },
      { analyte: "PTT", specialty: "Coagulation", complexity: "MODERATE" },
    ]},
    { name: "Clinitek Novus", role: "Primary", category: "Urinalysis", tests: [
      { analyte: "Color", specialty: "Urinalysis", complexity: "WAIVED" },
      { analyte: "Clarity", specialty: "Urinalysis", complexity: "WAIVED" },
      { analyte: "pH", specialty: "Urinalysis", complexity: "WAIVED" },
      { analyte: "Specific Gravity", specialty: "Urinalysis", complexity: "WAIVED" },
    ]},
    { name: "Clinitek Status", role: "Backup", category: "Urinalysis", tests: [
      { analyte: "Color", specialty: "Urinalysis", complexity: "WAIVED" },
      { analyte: "Clarity", specialty: "Urinalysis", complexity: "WAIVED" },
      { analyte: "pH", specialty: "Urinalysis", complexity: "WAIVED" },
      { analyte: "Specific Gravity", specialty: "Urinalysis", complexity: "WAIVED" },
    ]},
    { name: "Mini i-Sed", role: "Satellite", category: "Urinalysis", tests: [
      { analyte: "ESR", specialty: "Urinalysis", complexity: "MODERATE" },
    ]},
    { name: "Echo", role: "Primary", category: "Blood Bank", tests: [
      { analyte: "ABO", specialty: "Blood Bank", complexity: "HIGH" },
      { analyte: "Rh", specialty: "Blood Bank", complexity: "HIGH" },
      { analyte: "Antibody Screen", specialty: "Blood Bank", complexity: "HIGH" },
      { analyte: "Antibody Identification", specialty: "Blood Bank", complexity: "HIGH" },
      { analyte: "Crossmatch IS", specialty: "Blood Bank", complexity: "HIGH" },
      { analyte: "Crossmatch AHG", specialty: "Blood Bank", complexity: "HIGH" },
    ]},
    { name: "Tube Method", role: "Primary", category: "Blood Bank", tests: [
      { analyte: "ABO", specialty: "Blood Bank", complexity: "HIGH" },
      { analyte: "Rh", specialty: "Blood Bank", complexity: "HIGH" },
      { analyte: "Antibody Screen", specialty: "Blood Bank", complexity: "HIGH" },
      { analyte: "Antibody Identification", specialty: "Blood Bank", complexity: "HIGH" },
      { analyte: "Crossmatch IS", specialty: "Blood Bank", complexity: "HIGH" },
      { analyte: "Crossmatch AHG", specialty: "Blood Bank", complexity: "HIGH" },
    ]},
  ];

  const instStmt = sqlite.prepare(
    "INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const testStmt = sqlite.prepare(
    "INSERT OR IGNORE INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?, ?, ?, ?, ?, 1)"
  );
  const mapTestStmt = sqlite.prepare(
    "INSERT OR IGNORE INTO veritamap_tests (map_id, analyte, specialty, complexity, active, instrument_source, last_cal_ver, last_method_comp, last_precision, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)"
  );

  const seedInstruments = sqlite.transaction(() => {
    for (const inst of instruments) {
      const res = instStmt.run(mapId, inst.name, inst.role, inst.category, now);
      const instId = Number(res.lastInsertRowid);
      for (const t of inst.tests) {
        testStmt.run(instId, mapId, t.analyte, t.specialty, t.complexity);
      }
    }

    const analyteMap: Record<string, { specialty: string; complexity: string; instruments: string[] }> = {};
    for (const inst of instruments) {
      for (const t of inst.tests) {
        if (!analyteMap[t.analyte]) analyteMap[t.analyte] = { specialty: t.specialty, complexity: t.complexity, instruments: [] };
        analyteMap[t.analyte].instruments.push(inst.name);
      }
    }

    for (const [analyte, info] of Object.entries(analyteMap)) {
      const isWaived = info.complexity === "WAIVED";
      let calVer: string | null = isWaived ? null : "2026-01-15";
      let methodComp: string | null = info.instruments.length >= 2 ? "2025-11-20" : null;
      let precision: string | null = isWaived ? null : "2025-10-05";

      if (analyte === "PT") { methodComp = null; }
      if (analyte === "Potassium") { calVer = null; }
      if (analyte === "Hemoglobin") { precision = null; }
      if (analyte === "Sodium") { methodComp = "2026-01-15"; }
      if (analyte === "Hemoglobin A1c") { precision = "2026-03-10"; }

      mapTestStmt.run(mapId, analyte, info.specialty, info.complexity, info.instruments.join(", "), calVer, methodComp, precision, now);
    }
  });
  seedInstruments();
}

// ─── Scan seeding ─────────────────────────────────────────────────────────────
function seedScanData(sqlite: any, demoUserId: number, now: string) {
  const scanResult = sqlite.prepare(
    "INSERT INTO veritascan_scans (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(demoUserId, "Riverside Regional - 2026 Annual Inspection Readiness", now, now);
  const scanId = Number(scanResult.lastInsertRowid);

  const scanItemStmt = sqlite.prepare(`
    INSERT INTO veritascan_items (scan_id, item_id, status, notes, owner, completion_source, completion_link, completion_note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedScanItems = sqlite.transaction(() => {
    for (let itemId = 1; itemId <= 168; itemId++) {
      const hash = (itemId * 7 + 13) % 10;
      let status = hash < 6 ? "Compliant" : "Not Assessed";
      let notes: string | null = null;
      let owner: string | null = status === "Compliant" ? "Lab Staff" : null;
      let completionSource = "manual";
      let completionLink: string | null = null;
      let completionNote: string | null = null;

      // Some items get "Needs Attention"
      if ([15, 45, 67, 89, 112, 145].includes(itemId)) {
        status = "Needs Attention";
        notes = "Requires documentation update";
        owner = "Lab Staff";
      }

      // Some N/A
      if ([50, 100, 150].includes(itemId)) {
        status = "N/A";
        notes = "Not applicable to this facility";
        owner = null;
      }

      if (itemId >= 122 && itemId <= 141) {
        status = hash < 7 ? "Compliant" : "Not Assessed";
        owner = status === "Compliant" ? "Blood Bank Lead" : null;
      }

      if ([26, 27, 28, 29].includes(itemId)) {
        status = "Not Assessed";
        notes = "Pending - PT correlation study not yet completed";
        owner = null;
      }

      if ([21, 22, 23, 24].includes(itemId)) {
        status = "Not Assessed";
        notes = "Pending - Potassium cal ver not yet completed";
        owner = null;
      }

      if ([30, 32].includes(itemId)) {
        status = "Not Assessed";
        notes = "Pending - Hemoglobin accuracy study not yet completed";
        owner = null;
      }

      scanItemStmt.run(scanId, itemId, status, notes, owner, completionSource, completionLink, completionNote, now);
    }
  });
  seedScanItems();
}

// ─── Studies seeding: Sodium MC, Potassium MC, Creatinine Cal Ver, Sodium Ref Range ────
function seedStudies(sqlite: any, demoUserId: number, now: string) {
  // Study 1: Sodium Method Comparison (absolute TEa: 4 mmol/L)
  const sodiumDataPoints = generateSodiumData();
  sqlite.prepare(`
    INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
  `).run(
    demoUserId,
    "Sodium",
    "Ortho VITROS 5600 [Primary]",
    "Michael Veri, MS, MBA, MLS(ASCP), CPHQ",
    "2026-01-15",
    "method_comparison",
    4, // 4 mmol/L absolute TEa
    0, // not percentage
    "mmol/L",
    JSON.stringify(sodiumDataPoints),
    JSON.stringify(["Ortho VITROS 5600 [Primary]", "Ortho VITROS 5600 [Backup]"]),
    now
  );

  // Study 2: Potassium Method Comparison (absolute TEa: 0.3 mmol/L)
  const potassiumDataPoints = generatePotassiumData();
  sqlite.prepare(`
    INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
  `).run(
    demoUserId,
    "Potassium",
    "Ortho VITROS 5600 [Primary]",
    "Michael Veri, MS, MBA, MLS(ASCP), CPHQ",
    "2026-01-15",
    "method_comparison",
    0.3, // 0.3 mmol/L absolute TEa
    0, // not percentage
    "mmol/L",
    JSON.stringify(potassiumDataPoints),
    JSON.stringify(["Ortho VITROS 5600 [Primary]", "Ortho VITROS 5600 [Backup]"]),
    now
  );

  // Study 3: Creatinine Calibration Verification / Linearity
  // Real data from Milford Regional Medical Center, 06 Feb 2025, Atellica 2
  const creatinineDataPoints = generateCreatinineCalVerData();
  sqlite.prepare(`
    INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
  `).run(
    demoUserId,
    "Creatinine",
    "Siemens Atellica 2",
    "SED",
    "2025-02-06",
    "cal_ver",
    0.075, // 7.5% TEa per CLIA (stored as decimal fraction)
    1, // percentage
    "%",
    JSON.stringify(creatinineDataPoints),
    JSON.stringify(["Siemens Atellica 2"]),
    now
  );


  // Study 4: Sodium Reference Range Verification
  const sodiumRefSpecimens = [
    { specimenId: "S001", value: 137 }, { specimenId: "S002", value: 140 },
    { specimenId: "S003", value: 138 }, { specimenId: "S004", value: 142 },
    { specimenId: "S005", value: 136 }, { specimenId: "S006", value: 141 },
    { specimenId: "S007", value: 139 }, { specimenId: "S008", value: 143 },
    { specimenId: "S009", value: 137 }, { specimenId: "S010", value: 140 },
    { specimenId: "S011", value: 138 }, { specimenId: "S012", value: 144 },
    { specimenId: "S013", value: 136 }, { specimenId: "S014", value: 141 },
    { specimenId: "S015", value: 139 }, { specimenId: "S016", value: 142 },
    { specimenId: "S017", value: 137 }, { specimenId: "S018", value: 140 },
    { specimenId: "S019", value: 138 }, { specimenId: "S020", value: 143 },
  ];
  sqlite.prepare(`
    INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, result, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pass', 'completed', ?)
  `).run(
    demoUserId,
    "Sodium",
    "Ortho VITROS 5600 [Primary]",
    "Michael Veri, MS, MBA, MLS(ASCP), CPHQ",
    "2026-01-29",
    "ref_interval",
    4, // 4 mmol/L absolute TEa (same as Sodium method comparison)
    0, // not percentage
    "mmol/L",
    JSON.stringify({ specimens: sodiumRefSpecimens, refLow: 136, refHigh: 145, analyte: "Sodium", units: "mmol/L" }),
    JSON.stringify(["Ortho VITROS 5600 [Primary]"]),
    now
  );

}

// ─── Competency data seeding ──────────────────────────────────────────────────
function seedCompetencyData(sqlite: any, demoUserId: number, now: string) {
  // Create employee: Jennifer Martinez
  const empResult = sqlite.prepare(
    "INSERT INTO competency_employees (user_id, name, title, hire_date, lis_initials, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)"
  ).run(demoUserId, "Jennifer Martinez", "MLS(ASCP)", "2020-03-15", "JM", now);
  const employeeId = Number(empResult.lastInsertRowid);

  // Create additional demo employees for VeritaStaff tab
  sqlite.prepare(
    "INSERT INTO competency_employees (user_id, name, title, hire_date, lis_initials, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)"
  ).run(demoUserId, "Robert Chen", "MT(ASCP)", "2018-06-01", "RC", now);
  sqlite.prepare(
    "INSERT INTO competency_employees (user_id, name, title, hire_date, lis_initials, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)"
  ).run(demoUserId, "Sarah Williams", "MLT(ASCP)", "2022-01-10", "SW", now);
  sqlite.prepare(
    "INSERT INTO competency_employees (user_id, name, title, hire_date, lis_initials, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)"
  ).run(demoUserId, "David Nguyen", "MLS(ASCP)", "2019-09-20", "DN", now);

  // Create program
  const progResult = sqlite.prepare(
    "INSERT INTO competency_programs (user_id, name, department, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(demoUserId, "2026 Annual Competency - Chemistry", "Chemistry", "technical", now, now);
  const programId = Number(progResult.lastInsertRowid);

  // Create method group
  const mgResult = sqlite.prepare(
    "INSERT INTO competency_method_groups (program_id, name, instruments, analytes, notes) VALUES (?, ?, ?, ?, ?)"
  ).run(programId, "Chemistry Routine - VITROS 5600", JSON.stringify(["Ortho VITROS 5600 [Primary]", "Ortho VITROS 5600 [Backup]"]), JSON.stringify(["Sodium", "Potassium", "Troponin"]), null);
  const methodGroupId = Number(mgResult.lastInsertRowid);

  // Create assessment
  const assessResult = sqlite.prepare(`
    INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, evaluator_title, evaluator_initials, competency_type, status, employee_acknowledged, supervisor_acknowledged, created_at)
    VALUES (?, ?, 'annual', '2026-01-20', 'Michael Veri, MS, MBA, MLS(ASCP), CPHQ', 'Technical Consultant', 'MV', 'technical', 'pass', 1, 1, ?)
  `).run(programId, employeeId, now);
  const assessmentId = Number(assessResult.lastInsertRowid);

  // Create 6 assessment items (one per element), all passed
  const itemStmt = sqlite.prepare(`
    INSERT INTO competency_assessment_items (assessment_id, method_number, element_number, method_group_id, item_label, item_description, evidence, date_met, employee_initials, supervisor_initials, passed,
      el1_specimen_id, el2_evidence, el2_date, el3_qc_date, el4_date_observed, el5_sample_id, el5_sample_type, el5_acceptable, el6_quiz_id, el6_score, el6_date_taken)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const elements = [
    { num: 1, label: "Direct Observation of Routine Patient Test Performance", evidence: "Observed processing chemistry panel on VITROS 5600", date: "2026-01-15",
      el1_specimen_id: "0326:C147", el2_evidence: null, el2_date: null, el3_qc_date: null, el4_date_observed: null, el5_sample_id: null, el5_sample_type: null, el5_acceptable: null, el6_quiz_id: null, el6_score: null, el6_date_taken: null },
    { num: 2, label: "Monitoring, Recording and Reporting of Test Results", evidence: "0326:C147 - Sodium 141 mmol/L reported correctly, critical value callback documented", date: "2026-01-16",
      el1_specimen_id: null, el2_evidence: "0326:C147 - Sodium 141 mmol/L reported correctly, critical value callback documented", el2_date: "2026-01-16", el3_qc_date: null, el4_date_observed: null, el5_sample_id: null, el5_sample_type: null, el5_acceptable: null, el6_quiz_id: null, el6_score: null, el6_date_taken: null },
    { num: 3, label: "QC Performance", evidence: "QC run documented in LIS on date observed", date: "2026-01-17",
      el1_specimen_id: null, el2_evidence: null, el2_date: null, el3_qc_date: "2026-01-10", el4_date_observed: null, el5_sample_id: null, el5_sample_type: null, el5_acceptable: null, el6_quiz_id: null, el6_score: null, el6_date_taken: null },
    { num: 4, label: "Direct Observation of Instrument Maintenance", evidence: "Observed daily maintenance on VITROS 5600", date: "2026-01-17",
      el1_specimen_id: null, el2_evidence: null, el2_date: null, el3_qc_date: null, el4_date_observed: "2026-01-15", el5_sample_id: null, el5_sample_type: null, el5_acceptable: null, el6_quiz_id: null, el6_score: null, el6_date_taken: null },
    { num: 5, label: "Blind/PT Sample Performance", evidence: "CAP PT survey, all analytes acceptable", date: "2026-01-18",
      el1_specimen_id: null, el2_evidence: null, el2_date: null, el3_qc_date: null, el4_date_observed: null, el5_sample_id: "CAP-2026-C-01", el5_sample_type: "CAP PT Survey", el5_acceptable: 1, el6_quiz_id: null, el6_score: null, el6_date_taken: null },
    { num: 6, label: "Problem-Solving Assessment (Quiz)", evidence: "Quiz Q-AU5800-001, 2/2 correct, 100%", date: "2026-01-18",
      el1_specimen_id: null, el2_evidence: null, el2_date: null, el3_qc_date: null, el4_date_observed: null, el5_sample_id: null, el5_sample_type: null, el5_acceptable: null, el6_quiz_id: "Q-AU5800-001", el6_score: 100, el6_date_taken: "2026-01-18" },
  ];

  for (const el of elements) {
    itemStmt.run(assessmentId, el.num, el.num, methodGroupId, el.label, el.label, el.evidence, el.date, "JM", "MV",
      el.el1_specimen_id, el.el2_evidence, el.el2_date, el.el3_qc_date, el.el4_date_observed, el.el5_sample_id, el.el5_sample_type, el.el5_acceptable, el.el6_quiz_id, el.el6_score, el.el6_date_taken);
  }

  // Create checklist items for the program
  const checkStmt = sqlite.prepare(
    "INSERT INTO competency_checklist_items (program_id, label, description, sort_order) VALUES (?, ?, ?, ?)"
  );
  checkStmt.run(programId, "Annual competency assessment completed", "All 6 elements documented", 1);
  checkStmt.run(programId, "Employee acknowledged results", "Signed competency record", 2);
}

// ─── CUMSUM data seeding ──────────────────────────────────────────────────────
function seedCumsumData(sqlite: any, demoUserId: number, now: string) {
  const trackerResult = sqlite.prepare(
    "INSERT INTO cumsum_trackers (user_id, instrument_name, analyte, created_at) VALUES (?, ?, ?, ?)"
  ).run(demoUserId, "CA-660 Primary", "PTT", now);
  const trackerId = Number(trackerResult.lastInsertRowid);

  const entryStmt = sqlite.prepare(`
    INSERT INTO cumsum_entries (tracker_id, year, lot_label, old_lot_number, new_lot_number,
      old_lot_geomean, new_lot_geomean, difference, cumsum, verdict, specimen_data, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  entryStmt.run(trackerId, 2025, "Lot Change #1", "LOT-2024-A", "LOT-2025-A", 28.5, 29.1, 0.6, 0.6, "ACCEPT",
    JSON.stringify(generateSpecimenData(20, 28.5, 29.1)), "Routine lot change", now);
  entryStmt.run(trackerId, 2025, "Lot Change #2", "LOT-2025-A", "LOT-2025-B", 29.1, 27.5, -1.6, -1.0, "ACCEPT",
    JSON.stringify(generateSpecimenData(20, 29.1, 27.5)), "Mid-year lot change", now);
  entryStmt.run(trackerId, 2026, "Lot Change #3", "LOT-2025-B", "LOT-2026-A", 27.5, 26.0, -1.5, -2.5, "ACCEPT",
    JSON.stringify(generateSpecimenData(20, 27.5, 26.0)), "Annual lot change", now);
}

// ─── Competency backfill (existing DBs) ──────────────────────────────────────
function backfillCompetencyElements(sqlite: any, programId: number) {
  const assessment = sqlite.prepare(
    "SELECT id FROM competency_assessments WHERE program_id = ?"
  ).get(programId);
  if (!assessment) return;

  const aid = assessment.id;

  // Backfill element_number from method_number for all rows that lack it
  sqlite.prepare(
    "UPDATE competency_assessment_items SET element_number = method_number WHERE assessment_id = ? AND (element_number IS NULL OR element_number = 0)"
  ).run(aid);

  // Element 1: specimen ID
  sqlite.prepare(
    "UPDATE competency_assessment_items SET el1_specimen_id = ? WHERE assessment_id = ? AND method_number = 1 AND (el1_specimen_id IS NULL OR el1_specimen_id = '')"
  ).run("0326:C147", aid);

  // Element 2: evidence with specimen ID and date
  sqlite.prepare(
    `UPDATE competency_assessment_items SET el2_evidence = ?, el2_date = ?, evidence = ? WHERE assessment_id = ? AND method_number = 2 AND (el2_evidence IS NULL OR el2_evidence = '')`
  ).run("0326:C147 - Sodium 141 mmol/L reported correctly, critical value callback documented", "2026-01-16", "0326:C147 - Sodium 141 mmol/L reported correctly, critical value callback documented", aid);

  // Element 3: QC date
  sqlite.prepare(
    "UPDATE competency_assessment_items SET el3_qc_date = ? WHERE assessment_id = ? AND method_number = 3 AND (el3_qc_date IS NULL OR el3_qc_date = '')"
  ).run("2026-01-10", aid);

  // Element 4: date observed
  sqlite.prepare(
    "UPDATE competency_assessment_items SET el4_date_observed = ? WHERE assessment_id = ? AND method_number = 4 AND (el4_date_observed IS NULL OR el4_date_observed = '')"
  ).run("2026-01-15", aid);

  // Element 5: sample ID, type, acceptable
  sqlite.prepare(
    "UPDATE competency_assessment_items SET el5_sample_type = ?, el5_sample_id = ?, el5_acceptable = 1 WHERE assessment_id = ? AND method_number = 5 AND (el5_sample_id IS NULL OR el5_sample_id = '')"
  ).run("CAP PT Survey", "CAP-2026-C-01", aid);

  // Element 6: quiz ID, score, date
  sqlite.prepare(
    "UPDATE competency_assessment_items SET el6_quiz_id = ?, el6_score = ?, el6_date_taken = ?, evidence = ? WHERE assessment_id = ? AND method_number = 6 AND (el6_quiz_id IS NULL OR el6_quiz_id = '')"
  ).run("Q-AU5800-001", 100, "2026-01-18", "Quiz Q-AU5800-001, 2/2 correct, 100%", aid);

  console.log("[seed] Backfilled competency element fields for existing assessment");
}

// ─── Data generators ──────────────────────────────────────────────────────────

function generateSodiumData() {
  // 20 patient samples, sodium range 131-147 mmol/L
  // Verified realistic pairs with natural variation (not algorithmically generated)
  // Stats: slope 1.0243, intercept -2.3947, R=0.9983, R²=0.9967, SD=0.2685
  // Mean bias +1.005 mmol/L, 95% LoA [0.479, 1.531] - all within 4 mmol/L TEa
  const pairs: [number, number][] = [
    [131, 131.9], [133, 133.9], [135, 136.0], [136, 137.3], [137, 137.9],
    [138, 138.4], [139, 140.1], [140, 140.9], [141, 141.9], [142, 143.0],
    [143, 144.1], [144, 145.5], [145, 146.3], [136, 137.0], [138, 138.7],
    [140, 140.6], [141, 142.1], [143, 144.5], [145, 146.0], [147, 148.0],
  ];
  return pairs.map(([primary, backup], i) => ({
    level: i + 1,
    expectedValue: null,
    instrumentValues: {
      "Ortho VITROS 5600 [Primary]": primary,
      "Ortho VITROS 5600 [Backup]": backup,
    },
  }));
}

function generatePotassiumData() {
  // 20 patient samples, potassium range 3.2-5.8 mmol/L
  // Verified values - realistic variation between Primary and Backup
  // Mean bias: 0.0925 mmol/L, R=0.9969, R^2=0.9938, SD of Diff: 0.0527
  // 95% LoA: [-0.011, 0.196] mmol/L - well within 0.3 mmol/L TEa
  // Two samples show slight negative bias (S11: -0.010, S17: -0.010)
  const pairs: [number, number][] = [
    [3.2, 3.29], [3.4, 3.44], [3.5, 3.58], [3.6, 3.76], [3.7, 3.82],
    [3.8, 3.91], [3.9, 3.92], [4.0, 4.06], [4.1, 4.22], [4.2, 4.33],
    [4.3, 4.29], [4.4, 4.48], [4.5, 4.69], [4.6, 4.70], [4.7, 4.82],
    [4.8, 4.95], [4.9, 4.89], [5.0, 5.08], [5.1, 5.20], [5.8, 5.92],
  ];
  return pairs.map(([primary, backup], i) => ({
    level: i + 1,
    expectedValue: null,
    instrumentValues: {
      "Ortho VITROS 5600 [Primary]": primary,
      "Ortho VITROS 5600 [Backup]": backup,
    },
  }));
}

function generateCreatinineCalVerData() {
  // Real data: Milford Regional Medical Center, Siemens Atellica 2, 06 Feb 2025
  // Controls: VALIDATE 10691662 exp 12 Feb 2026
  // TEa: 0.1 mg/dL or 7.5% | Reportable range: 0.15 to 30 mg/dL
  // All 5 levels PASS. Max % recovery 105.3% (L2). Slope 0.996, intercept 0.263.
  const levels = [
    { level: 1, assignedValue: 0.30,  run1: 0.31, run2: 0.29 },
    { level: 2, assignedValue: 7.00,  run1: 7.37, run2: 7.37 },
    { level: 3, assignedValue: 13.80, run1: 14.25, run2: 14.21 },
    { level: 4, assignedValue: 20.50, run1: 20.88, run2: 20.91 },
    { level: 5, assignedValue: 27.30, run1: 27.22, run2: 27.11 },
  ];
  return levels.map(l => ({
    level: l.level,
    assignedValue: l.assignedValue,
    expectedValue: l.assignedValue,
    instrumentValues: {
      "Siemens Atellica 2": (l.run1 + l.run2) / 2, // mean of two replicates
    },
  }));
}

function seedTroponinStudy(sqlite: any, demoUserId: number, now: string) {
  const troponinDataPoints = generateTroponinData();
  sqlite.prepare(`
    INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
  `).run(
    demoUserId,
    'Troponin I',
    'Abbott ARCHITECT i2000SR [Primary]',
    'Michael Veri, MS, MBA, MLS(ASCP), CPHQ',
    '2026-02-14',
    'method_comparison',
    0.30, // 30% CLIA TEa (stored as decimal fraction)
    1, // percentage
    '%',
    JSON.stringify(troponinDataPoints),
    JSON.stringify(['Abbott ARCHITECT i2000SR [Primary]', 'Abbott ARCHITECT i2000SR [Backup]']),
    now
  );
  console.log('[seed] Troponin I failing method comparison study seeded');
}

function generateTroponinData() {
  // 20 patient samples - mathematically verified, no floating point boundary issues
  // S1-S9: 20.0%-29.5% bias = PASS at 30% TEa; S10-S20: 31.0%-38.0% bias = FAIL
  // Pass count: 9/20, overall FAIL, mean bias 30.69%
  // Deming slope: 1.3742, intercept: -0.1976, R2: 0.9999
  const pairs: [number, number][] = [
    [0.02, 0.024], [0.05, 0.062], [0.12, 0.149], [0.25, 0.314], [0.48, 0.605],
    [0.89, 1.135], [1.45, 1.856], [2.10, 2.709], [3.20, 4.144], [4.85, 6.353],
    [6.50, 8.547], [8.20, 10.824], [10.50, 14.018], [12.80, 17.152], [15.20, 20.520],
    [18.50, 25.067], [22.30, 30.328], [26.80, 36.582], [31.50, 43.155], [38.20, 52.716],
  ];
  return pairs.map(([primary, comparison], i) => ({
    level: i + 1,
    expectedValue: null,
    instrumentValues: {
      'Abbott ARCHITECT i2000SR [Primary]': primary,
      'Abbott ARCHITECT i2000SR [Backup]': comparison,
    },
  }));
}

function generateSpecimenData(n: number, oldMean: number, newMean: number) {
  const specimens: any[] = [];
  for (let i = 1; i <= n; i++) {
    const oldNoise = (Math.sin(i * 1.414) * 0.8);
    const newNoise = (Math.sin(i * 2.236) * 0.8);
    specimens.push({
      specimenId: `SP-${String(i).padStart(3, "0")}`,
      oldLot: Math.round((oldMean + oldNoise) * 10) / 10,
      newLot: Math.round((newMean + newNoise) * 10) / 10,
    });
  }
  return specimens;
}

// ─── PT seed data ─────────────────────────────────────────────────────────────
function seedPTData(sqlite: any, demoUserId: number, now: string) {
  // Enrollment 1: Glucose
  const e1 = sqlite.prepare(
    "INSERT INTO pt_enrollments (user_id, analyte, specialty, pt_provider, program_code, enrollment_year, enrollment_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(demoUserId, "Glucose", "Chemistry", "CAP", "C-CHM-PT", 2026, "2026-01-01", "active", now, now);
  const enrollId1 = Number(e1.lastInsertRowid);

  const ev1 = sqlite.prepare(
    "INSERT INTO pt_events (enrollment_id, user_id, event_id, event_name, event_date, analyte, your_result, your_method, peer_mean, peer_sd, peer_n, acceptable_low, acceptable_high, sdi, pass_fail, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(enrollId1, demoUserId, "2026-A", "Survey Event A", "2026-01-15", "Glucose", 98, "Enzymatic", 95, 3, 120, 85, 105, 1.00, "pass", null, now, now);

  const ev2 = sqlite.prepare(
    "INSERT INTO pt_events (enrollment_id, user_id, event_id, event_name, event_date, analyte, your_result, your_method, peer_mean, peer_sd, peer_n, acceptable_low, acceptable_high, sdi, pass_fail, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(enrollId1, demoUserId, "2026-B", "Survey Event B", "2026-03-15", "Glucose", 110, "Enzymatic", 96, 3, 118, 86, 106, 4.67, "fail", null, now, now);
  const ev2Id = Number(ev2.lastInsertRowid);

  sqlite.prepare(
    "INSERT INTO pt_corrective_actions (event_id, user_id, root_cause, corrective_action, preventive_action, responsible_person, date_initiated, date_completed, status, verified_by, verified_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(ev2Id, demoUserId, "Calibration drift identified after reagent lot change", "Recalibrated instrument and repeated QC across 3 runs to confirm stability", "Implemented reagent lot acceptance criteria to require calibration verification before placing new lot in service", "Lab Supervisor", "2026-03-16", "2026-03-18", "completed", "M. Veri, MLS(ASCP)", "2026-03-19", now, now);

  // Enrollment 2: Hemoglobin A1c
  const e2 = sqlite.prepare(
    "INSERT INTO pt_enrollments (user_id, analyte, specialty, pt_provider, program_code, enrollment_year, enrollment_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(demoUserId, "Hemoglobin A1c", "Chemistry", "CAP", "C-HBA1C", 2026, "2026-01-01", "active", now, now);
  const enrollId2 = Number(e2.lastInsertRowid);

  sqlite.prepare(
    "INSERT INTO pt_events (enrollment_id, user_id, event_id, event_name, event_date, analyte, your_result, your_method, peer_mean, peer_sd, peer_n, acceptable_low, acceptable_high, sdi, pass_fail, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(enrollId2, demoUserId, "2026-A", "Survey Event A", "2026-01-15", "Hemoglobin A1c", 6.8, "HPLC", 6.7, 0.2, 95, 6.1, 7.3, 0.50, "pass", null, now, now);

  // Enrollment 3: PT/INR
  const e3 = sqlite.prepare(
    "INSERT INTO pt_enrollments (user_id, analyte, specialty, pt_provider, program_code, enrollment_year, enrollment_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(demoUserId, "PT/INR", "Coagulation", "CAP", "C-COAG-PT", 2026, "2026-01-01", "active", now, now);
  const enrollId3 = Number(e3.lastInsertRowid);

  sqlite.prepare(
    "INSERT INTO pt_events (enrollment_id, user_id, event_id, event_name, event_date, analyte, your_result, your_method, peer_mean, peer_sd, peer_n, acceptable_low, acceptable_high, sdi, pass_fail, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(enrollId3, demoUserId, "2026-A", "Survey Event A", "2026-01-15", "PT/INR", 1.02, "Clot-based", 1.00, 0.05, 88, 0.90, 1.10, 0.40, "pass", null, now, now);

  console.log("[seed] VeritaPT demo data seeded");
}

// ─── VeritaPolicy seeding ──────────────────────────────────────────────────────
function seedPolicyData(sqlite: any, demoUserId: number, now: string) {
  // Service line settings -- hospital lab with blood bank and microbiology
  sqlite.prepare(`
    INSERT INTO veritapolicy_settings
      (user_id, has_blood_bank, has_transplant, has_microbiology, has_maternal_serum, is_independent, waived_only, setup_complete, accreditation_body)
    VALUES (?, 1, 0, 1, 0, 0, 0, 1, 'tjc')
  `).run(demoUserId);

  // Sample lab policies
  const policies = [
    { num: "POL-001", name: "Specimen Collection Procedures", owner: "Michael Veri, MLS(ASCP)", status: "complete", last: "2026-01-15", next: "2027-01-15" },
    { num: "POL-002", name: "Critical Value Reporting Policy", owner: "Michael Veri, MLS(ASCP)", status: "complete", last: "2026-01-15", next: "2027-01-15" },
    { num: "POL-003", name: "Quality Control Plan (IQCP)", owner: "Michael Veri, MLS(ASCP)", status: "complete", last: "2026-02-01", next: "2027-02-01" },
    { num: "POL-004", name: "Staff Competency Assessment Policy", owner: "Michael Veri, MLS(ASCP)", status: "complete", last: "2026-01-20", next: "2027-01-20" },
    { num: "POL-005", name: "Method Validation Policy", owner: "Michael Veri, MLS(ASCP)", status: "complete", last: "2026-01-20", next: "2027-01-20" },
    { num: "POL-006", name: "Record Retention Policy", owner: "Michael Veri, MLS(ASCP)", status: "in_progress", last: null, next: null },
    { num: "POL-007", name: "Infection Prevention and Control Program", owner: "Infection Control Officer", status: "complete", last: "2026-01-10", next: "2027-01-10" },
    { num: "POL-008", name: "Health Information Privacy Policy", owner: "Compliance Officer", status: "in_progress", last: null, next: null },
  ];

  const policyIds: Record<string, number> = {};
  for (const p of policies) {
    const result = sqlite.prepare(`
      INSERT INTO veritapolicy_lab_policies (user_id, policy_number, policy_name, owner, status, last_reviewed, next_review, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(demoUserId, p.num, p.name, p.owner, p.status, p.last, p.next, now, now) as any;
    policyIds[p.num] = result.lastInsertRowid;
  }

  // Map requirements to policies and set statuses
  // id, status, is_na, lab_policy_id
  const reqStatuses = [
    // APR chapter
    { id: 1, status: "in_progress", policyId: null },
    { id: 2, status: "complete", policyId: null },
    { id: 3, status: "complete", policyId: null },
    { id: 4, status: "complete", policyId: null },
    // DC chapter -- specimen collection covers multiple
    { id: 5, status: "complete", policyId: policyIds["POL-001"] },
    { id: 6, status: "in_progress", policyId: null },
    { id: 8, status: "in_progress", policyId: null },
    { id: 9, status: "complete", policyId: policyIds["POL-005"] },
    { id: 11, status: "complete", policyId: policyIds["POL-002"] },
    { id: 12, status: "in_progress", policyId: policyIds["POL-006"] },
    // HR chapter
    { id: 17, status: "complete", policyId: null },
    { id: 18, status: "complete", policyId: null },
    { id: 19, status: "complete", policyId: null },
    { id: 20, status: "complete", policyId: policyIds["POL-004"] },
    { id: 21, status: "in_progress", policyId: null },
    // IC chapter
    { id: 22, status: "complete", policyId: policyIds["POL-007"] },
    { id: 23, status: "complete", policyId: policyIds["POL-007"] },
    // IM chapter
    { id: 25, status: "in_progress", policyId: policyIds["POL-008"] },
    { id: 26, status: "in_progress", policyId: policyIds["POL-008"] },
    // QSA chapter
    { id: 35, status: "complete", policyId: policyIds["POL-003"] },
    { id: 36, status: "complete", policyId: policyIds["POL-005"] },
    { id: 37, status: "complete", policyId: null },
    { id: 38, status: "in_progress", policyId: null },
    // Blood bank -- has_blood_bank=true so these apply
    { id: 41, status: "in_progress", policyId: null },
    { id: 42, status: "not_started", policyId: null },
    { id: 43, status: "complete", policyId: null },
  ];

  for (const rs of reqStatuses) {
    sqlite.prepare(`
      INSERT OR IGNORE INTO veritapolicy_requirement_status
        (user_id, requirement_id, status, is_na, lab_policy_id, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
    `).run(demoUserId, rs.id, rs.status, rs.policyId || null, now);
  }

  console.log("[seed] VeritaPolicy demo data seeded");
}

// ─── VeritaBench Productivity seeding ──────────────────────────────────────────
function seedProductivityData(sqlite: any, demoUserId: number, now: string) {
  const stmt = sqlite.prepare(`
    INSERT OR IGNORE INTO productivity_months
      (account_id, year, month, billable_tests, productive_hours, non_productive_hours, overtime_hours, total_ftes, facility_type, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 2025 data (prior year): higher ratio ~0.185-0.195, higher OT
  const data2025 = [
    { m: 1,  tests: 35200, prodH: 6850, nonProd: 1150, ot: 580, ftes: 15.2, notes: "Q1 2025: 2 vacant positions filled" },
    { m: 2,  tests: 34800, prodH: 6720, nonProd: 1100, ot: 560, ftes: 15.0, notes: null },
    { m: 3,  tests: 36100, prodH: 6900, nonProd: 1200, ot: 620, ftes: 15.3, notes: "Spring census increase" },
    { m: 4,  tests: 35600, prodH: 6780, nonProd: 1180, ot: 590, ftes: 15.1, notes: null },
    { m: 5,  tests: 36400, prodH: 6950, nonProd: 1220, ot: 610, ftes: 15.4, notes: null },
    { m: 6,  tests: 35900, prodH: 6820, nonProd: 1160, ot: 570, ftes: 15.2, notes: "Q2 close" },
    { m: 7,  tests: 34500, prodH: 6680, nonProd: 1140, ot: 540, ftes: 14.9, notes: "Summer vacation coverage" },
    { m: 8,  tests: 35100, prodH: 6750, nonProd: 1160, ot: 600, ftes: 15.0, notes: null },
    { m: 9,  tests: 36800, prodH: 7020, nonProd: 1240, ot: 650, ftes: 15.5, notes: "Back-to-school surge" },
    { m: 10, tests: 36200, prodH: 6880, nonProd: 1200, ot: 630, ftes: 15.3, notes: "Oct 2025: staff loaned to partner facility" },
    { m: 11, tests: 35500, prodH: 6760, nonProd: 1180, ot: 590, ftes: 15.1, notes: null },
    { m: 12, tests: 34200, prodH: 6600, nonProd: 1120, ot: 520, ftes: 14.8, notes: "Holiday staffing adjustments" },
  ];

  // 2026 data (current year, Jan-Mar): improving to ~0.140-0.150, lower OT, fewer FTEs
  const data2026 = [
    { m: 1, tests: 36500, prodH: 5280, nonProd: 820, ot: 320, ftes: 13.2, notes: "VeritaBench workflow optimization began" },
    { m: 2, tests: 35800, prodH: 5150, nonProd: 790, ot: 290, ftes: 13.0, notes: "Continued efficiency gains" },
    { m: 3, tests: 37200, prodH: 5380, nonProd: 840, ot: 310, ftes: 13.4, notes: "Q1 close, 25% hour reduction vs prior year" },
  ];

  const seedBatch = sqlite.transaction(() => {
    for (const d of data2025) {
      stmt.run(demoUserId, 2025, d.m, d.tests, d.prodH, d.nonProd, d.ot, d.ftes, "community", d.notes, now, now);
    }
    for (const d of data2026) {
      stmt.run(demoUserId, 2026, d.m, d.tests, d.prodH, d.nonProd, d.ot, d.ftes, "community", d.notes, now, now);
    }
  });
  seedBatch();
  console.log("[seed] VeritaBench productivity data seeded (24 months)");
}

// ─── VeritaBench Staffing Study seeding ────────────────────────────────────────
function seedStaffingData(sqlite: any, demoUserId: number, now: string) {
  const studyResult = sqlite.prepare(
    "INSERT INTO staffing_studies (account_id, name, department, start_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(demoUserId, "Core Lab Q1 Analysis", "Core Lab", "2026-01-06", "complete", now, now);
  const studyId = Number(studyResult.lastInsertRowid);

  const insertData = sqlite.prepare(`
    INSERT OR IGNORE INTO staffing_hourly_data (study_id, week_number, day_of_week, hour_slot, metric_type, value, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Realistic hourly data: weekday pattern with peak 8AM-2PM
  // Based on typical clinical lab volume patterns
  const weekdayReceived = [
    3, 2, 2, 2, 3, 8, 22, 45, 62, 58, 52, 48, 44, 42, 38, 32, 28, 22, 15, 10, 8, 6, 4, 3
  ];
  const weekdayVerified = [
    4, 3, 2, 2, 3, 6, 18, 40, 58, 56, 50, 46, 42, 40, 36, 30, 26, 20, 14, 9, 7, 5, 4, 3
  ];
  const weekendMultiplier = 0.6;

  // Staffing pattern (staff on duty per hour)
  const weekdayStaff = [
    2, 2, 2, 2, 2, 3, 5, 7, 8, 8, 7, 7, 6, 6, 5, 5, 4, 3, 3, 2, 2, 2, 2, 2
  ];
  const weekendStaff = [
    2, 2, 2, 2, 2, 2, 3, 4, 5, 5, 4, 4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2
  ];

  const seedBatch = sqlite.transaction(() => {
    for (let week = 1; week <= 6; week++) {
      for (let day = 0; day < 7; day++) {
        const isWeekend = day >= 5;
        const mult = isWeekend ? weekendMultiplier : 1.0;
        // Add small random variation per week (+/- 15%)
        const weekVariation = 0.85 + (((week * 7 + day * 3 + 13) % 30) / 100);

        for (let hour = 0; hour < 24; hour++) {
          const recBase = Math.round(weekdayReceived[hour] * mult * weekVariation);
          const verBase = Math.round(weekdayVerified[hour] * mult * weekVariation);
          // Small per-cell variation
          const cellVar = ((hour * 3 + day * 5 + week * 7) % 7) - 3;
          const received = Math.max(0, recBase + cellVar);
          const verified = Math.max(0, verBase + cellVar);

          insertData.run(studyId, week, day, hour, "received", received, now);
          insertData.run(studyId, week, day, hour, "verified", verified, now);
        }
      }
    }

    // Staffing data (week_number = 0 for baseline staffing)
    for (let day = 0; day < 7; day++) {
      const isWeekend = day >= 5;
      const staffPattern = isWeekend ? weekendStaff : weekdayStaff;
      for (let hour = 0; hour < 24; hour++) {
        insertData.run(studyId, 0, day, hour, "staffing", staffPattern[hour], now);
      }
    }
  });

  seedBatch();
  console.log("[seed] VeritaBench staffing study seeded (Core Lab Q1 Analysis)");
}

// ─── VeritaBench Inventory seeding (full burn-rate model) ─────────────────────
function seedInventoryData(sqlite: any, demoUserId: number, now: string) {
  const stmt = sqlite.prepare(`
    INSERT INTO inventory_items
      (account_id, item_name, catalog_number, lot_number, department, category,
       quantity_on_hand, unit, expiration_date, vendor, storage_location, notes, status,
       burn_rate, order_unit, usage_unit, units_per_order_unit,
       lead_time_days, safety_stock_days, desired_days_of_stock,
       standing_order, standing_order_review_date, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?)
  `);

  // Realistic items for Riverside Regional Medical Center (community hospital, 200K-500K tests/yr)
  // Reorder point = burn_rate * (lead_time + safety_stock)
  // Some items intentionally below reorder point for demo alerts
  const items = [
    // ── High-volume reagents ──
    { name: "Troponin I Reagent Kit", catalog: "06P1925", lot: "LOT-2026-0412", dept: "Core Lab", cat: "Reagent", qty: 280, orderUnit: "kit", usageUnit: "test", unitsPerOrder: 500, burnRate: 15, leadTime: 5, safetyDays: 5, desiredDays: 30, exp: "2027-01-15", vendor: "Abbott", loc: "Reagent Fridge A", notes: null, standing: 0, reviewDate: null },
    { name: "BMP Reagent Pack", catalog: "DF40", lot: "LOT-2026-0398", dept: "Chemistry", cat: "Reagent", qty: 1200, orderUnit: "pack", usageUnit: "test", unitsPerOrder: 200, burnRate: 50, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-11-30", vendor: "Siemens Healthineers", loc: "Reagent Fridge A", notes: null, standing: 0, reviewDate: null },
    { name: "CMP Reagent Pack", catalog: "DF41", lot: "LOT-2026-0399", dept: "Chemistry", cat: "Reagent", qty: 900, orderUnit: "pack", usageUnit: "test", unitsPerOrder: 200, burnRate: 45, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-12-20", vendor: "Siemens Healthineers", loc: "Reagent Fridge A", notes: null, standing: 0, reviewDate: null },
    { name: "CBC Reagent", catalog: "XN-L-CBC", lot: "LOT-2026-0501", dept: "Hematology", cat: "Reagent", qty: 2400, orderUnit: "case", usageUnit: "test", unitsPerOrder: 1000, burnRate: 90, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2027-06-15", vendor: "Sysmex", loc: "Heme Supply Room", notes: null, standing: 1, reviewDate: "2026-07-01" },
    { name: "PT/INR Reagent", catalog: "0020003800", lot: "LOT-2026-0988", dept: "Core Lab", cat: "Reagent", qty: 120, orderUnit: "kit", usageUnit: "test", unitsPerOrder: 200, burnRate: 25, leadTime: 5, safetyDays: 5, desiredDays: 30, exp: "2026-04-25", vendor: "Stago", loc: "Coag Fridge", notes: "Expiring soon - replacement lot ordered", standing: 0, reviewDate: null },
    { name: "TSH Reagent", catalog: "07K7525", lot: "LOT-2026-1187", dept: "Chemistry", cat: "Reagent", qty: 600, orderUnit: "kit", usageUnit: "test", unitsPerOrder: 300, burnRate: 18, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-09-20", vendor: "Abbott", loc: "Reagent Fridge A", notes: null, standing: 0, reviewDate: null },
    { name: "HbA1c Reagent Kit", catalog: "ST-AIA", lot: "LOT-2026-0221", dept: "Chemistry", cat: "Reagent", qty: 250, orderUnit: "kit", usageUnit: "test", unitsPerOrder: 200, burnRate: 12, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-12-15", vendor: "Roche Diagnostics", loc: "Reagent Fridge B", notes: null, standing: 0, reviewDate: null },
    { name: "Urinalysis Dipstick Strips", catalog: "UA-100", lot: "LOT-2026-0610", dept: "Urinalysis", cat: "Reagent", qty: 450, orderUnit: "bottle", usageUnit: "strip", unitsPerOrder: 100, burnRate: 30, leadTime: 3, safetyDays: 3, desiredDays: 30, exp: "2027-03-15", vendor: "Siemens Healthineers", loc: "UA Bench", notes: null, standing: 0, reviewDate: null },
    { name: "CRP Latex Reagent", catalog: "OSR6199", lot: "B26-0398A", dept: "Chemistry", cat: "Reagent", qty: 40, orderUnit: "kit", usageUnit: "test", unitsPerOrder: 100, burnRate: 8, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-05-10", vendor: "Beckman Coulter", loc: "Reagent Fridge B", notes: null, standing: 0, reviewDate: null },
    { name: "D-Dimer Reagent", catalog: "00676", lot: "LOT-2026-0299", dept: "Core Lab", cat: "Reagent", qty: 350, orderUnit: "kit", usageUnit: "test", unitsPerOrder: 200, burnRate: 10, leadTime: 5, safetyDays: 5, desiredDays: 30, exp: "2026-08-22", vendor: "Stago", loc: "Coag Fridge", notes: null, standing: 0, reviewDate: null },
    { name: "PTT Reagent (STA-PTT Automate)", catalog: "0020006500", lot: "LOT-2026-0123", dept: "Core Lab", cat: "Reagent", qty: 500, orderUnit: "kit", usageUnit: "test", unitsPerOrder: 200, burnRate: 20, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-10-31", vendor: "Stago", loc: "Coag Fridge", notes: null, standing: 0, reviewDate: null },
    { name: "Lipid Panel Reagent", catalog: "DF69", lot: "LOT-2026-0355", dept: "Chemistry", cat: "Reagent", qty: 800, orderUnit: "pack", usageUnit: "test", unitsPerOrder: 200, burnRate: 20, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2027-03-28", vendor: "Siemens Healthineers", loc: "Reagent Fridge A", notes: null, standing: 0, reviewDate: null },
    // ── Below reorder point items (needs_reorder = true) ──
    { name: "Blood Culture Bottles (Aerobic)", catalog: "442192", lot: "LOT-2026-0201", dept: "Microbiology", cat: "Supply", qty: 30, orderUnit: "case", usageUnit: "bottle", unitsPerOrder: 50, burnRate: 8, leadTime: 5, safetyDays: 5, desiredDays: 30, exp: "2027-04-10", vendor: "BD", loc: "Micro Supply Room", notes: "Below reorder point", standing: 0, reviewDate: null },
    { name: "Blood Culture Bottles (Anaerobic)", catalog: "442193", lot: "LOT-2026-0202", dept: "Microbiology", cat: "Supply", qty: 20, orderUnit: "case", usageUnit: "bottle", unitsPerOrder: 50, burnRate: 5, leadTime: 5, safetyDays: 5, desiredDays: 30, exp: "2027-04-10", vendor: "BD", loc: "Micro Supply Room", notes: "Below reorder point", standing: 0, reviewDate: null },
    { name: "Reticulocyte Stain Reagent", catalog: "RET-SYS", lot: "LOT-2026-0188", dept: "Hematology", cat: "Reagent", qty: 15, orderUnit: "pack", usageUnit: "test", unitsPerOrder: 100, burnRate: 3, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-04-20", vendor: "Sysmex", loc: "Heme Supply Room", notes: "Expiring soon and below reorder", standing: 0, reviewDate: null },
    // ── Controls ──
    { name: "Chemistry Normal Control (Level 1)", catalog: "694", lot: "LOT-2026-0445", dept: "Chemistry", cat: "Control", qty: 24, orderUnit: "box", usageUnit: "vial", unitsPerOrder: 12, burnRate: 2, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-07-31", vendor: "Bio-Rad", loc: "Control Fridge", notes: null, standing: 0, reviewDate: null },
    { name: "Chemistry Abnormal Control (Level 2)", catalog: "695", lot: "LOT-2026-0446", dept: "Chemistry", cat: "Control", qty: 20, orderUnit: "box", usageUnit: "vial", unitsPerOrder: 12, burnRate: 2, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-07-31", vendor: "Bio-Rad", loc: "Control Fridge", notes: null, standing: 0, reviewDate: null },
    { name: "Hematology Tri-Level Control", catalog: "XN-CHECK", lot: "B26-0277C", dept: "Hematology", cat: "Control", qty: 18, orderUnit: "box", usageUnit: "vial", unitsPerOrder: 9, burnRate: 3, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-06-15", vendor: "Sysmex", loc: "Heme Supply Room", notes: null, standing: 0, reviewDate: null },
    { name: "Coagulation Control (Normal)", catalog: "CRY-N", lot: "LOT-2025-0912", dept: "Core Lab", cat: "Control", qty: 6, orderUnit: "box", usageUnit: "vial", unitsPerOrder: 10, burnRate: 2, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-03-31", vendor: "Stago", loc: "Coag Fridge", notes: "EXPIRED - new lot on order", standing: 0, reviewDate: null },
    { name: "Coagulation Control (Abnormal)", catalog: "CRY-A", lot: "LOT-2026-0156", dept: "Core Lab", cat: "Control", qty: 14, orderUnit: "box", usageUnit: "vial", unitsPerOrder: 10, burnRate: 2, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-09-30", vendor: "Stago", loc: "Coag Fridge", notes: null, standing: 0, reviewDate: null },
    { name: "Blood Bank ABO/Rh Control Cells", catalog: "CTRL-BB1", lot: "LOT-2026-0334", dept: "Blood Bank", cat: "Control", qty: 8, orderUnit: "box", usageUnit: "set", unitsPerOrder: 4, burnRate: 1, leadTime: 5, safetyDays: 3, desiredDays: 30, exp: "2026-05-25", vendor: "Bio-Rad", loc: "Blood Bank Fridge", notes: null, standing: 0, reviewDate: null },
    // ── Consumables and supplies ──
    { name: "Pipette Tips 200uL", catalog: "PT-200", lot: "LOT-2026-0401", dept: "Core Lab", cat: "Consumable", qty: 4500, orderUnit: "bag", usageUnit: "tip", unitsPerOrder: 1000, burnRate: 150, leadTime: 3, safetyDays: 3, desiredDays: 30, exp: null, vendor: "Fisher Scientific", loc: "Supply Room A", notes: null, standing: 1, reviewDate: "2026-07-01" },
    { name: "Nitrile Gloves Medium", catalog: "NG-M-1000", lot: "LOT-2026-0520", dept: "Core Lab", cat: "Supply", qty: 5000, orderUnit: "case", usageUnit: "glove", unitsPerOrder: 1000, burnRate: 200, leadTime: 3, safetyDays: 3, desiredDays: 30, exp: null, vendor: "Fisher Scientific", loc: "Supply Room B", notes: null, standing: 1, reviewDate: "2026-03-15" },
    { name: "Vacutainer Lavender Top (EDTA)", catalog: "367861", lot: "LOT-2026-0533", dept: "Core Lab", cat: "Supply", qty: 2500, orderUnit: "case", usageUnit: "tube", unitsPerOrder: 100, burnRate: 80, leadTime: 3, safetyDays: 3, desiredDays: 30, exp: "2027-09-30", vendor: "BD", loc: "Phlebotomy Supply", notes: null, standing: 1, reviewDate: "2026-07-01" },
    { name: "Vacutainer Gold Top (SST)", catalog: "367986", lot: "LOT-2026-0534", dept: "Core Lab", cat: "Supply", qty: 2200, orderUnit: "case", usageUnit: "tube", unitsPerOrder: 100, burnRate: 70, leadTime: 3, safetyDays: 3, desiredDays: 30, exp: "2027-08-15", vendor: "BD", loc: "Phlebotomy Supply", notes: null, standing: 1, reviewDate: "2026-07-01" },
    { name: "Vacutainer Light Blue Top (Citrate)", catalog: "369714", lot: "LOT-2026-0535", dept: "Core Lab", cat: "Supply", qty: 100, orderUnit: "case", usageUnit: "tube", unitsPerOrder: 100, burnRate: 25, leadTime: 3, safetyDays: 3, desiredDays: 30, exp: "2027-07-20", vendor: "BD", loc: "Phlebotomy Supply", notes: "LOW STOCK - urgent reorder needed", standing: 0, reviewDate: null },
    { name: "Thermal Printer Paper", catalog: "TPP-10", lot: "LOT-2026-0320", dept: "Core Lab", cat: "Consumable", qty: 20, orderUnit: "pack", usageUnit: "roll", unitsPerOrder: 10, burnRate: 0, leadTime: 3, safetyDays: 3, desiredDays: 30, exp: null, vendor: "Fisher Scientific", loc: "Supply Room B", notes: null, standing: 0, reviewDate: null },
    { name: "Glucose Meter Test Strips", catalog: "GM-TS50", lot: "LOT-2025-0844", dept: "Point of Care", cat: "Supply", qty: 800, orderUnit: "box", usageUnit: "strip", unitsPerOrder: 50, burnRate: 15, leadTime: 3, safetyDays: 3, desiredDays: 30, exp: "2026-02-28", vendor: "Abbott", loc: "POC Storage", notes: "EXPIRED - do not use", standing: 0, reviewDate: null },
  ];

  const seedBatch = sqlite.transaction(() => {
    for (const item of items) {
      stmt.run(
        demoUserId, item.name, item.catalog, item.lot, item.dept, item.cat,
        item.qty, item.orderUnit, item.exp, item.vendor, item.loc,
        item.notes, "active",
        item.burnRate, item.orderUnit, item.usageUnit, item.unitsPerOrder,
        item.leadTime, item.safetyDays, item.desiredDays,
        item.standing, item.reviewDate, now, now
      );
    }
  });
  seedBatch();
  console.log(`[seed] VeritaBench inventory data seeded (${items.length} items with burn-rate model)`);
}
