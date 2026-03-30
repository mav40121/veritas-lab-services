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
    sqlite.prepare("UPDATE users SET plan = 'lab', has_completed_onboarding = 1 WHERE id = ?").run(demoUserId);
  } else {
    const hash = await bcrypt.hash("VeritaDemo2026!", 10);
    const now = new Date().toISOString();
    const result = sqlite.prepare(
      "INSERT INTO users (email, password_hash, name, plan, study_credits, has_completed_onboarding, created_at) VALUES (?, ?, ?, 'lab', 99999, 1, ?)"
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
        { name: "Beckman Coulter AU5800 [Primary]", role: "Primary" },
        { name: "Beckman Coulter AU5800 [Backup]", role: "Backup" },
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
  const existingStudies = sqlite.prepare("SELECT COUNT(*) as cnt FROM studies WHERE user_id = ?").get(demoUserId);
  if (!existingStudies || existingStudies.cnt < 2) {
    // Remove old studies to reseed cleanly
    sqlite.prepare("DELETE FROM studies WHERE user_id = ?").run(demoUserId);
    seedStudies(sqlite, demoUserId, now);
  }

  // ─── 5. VeritaComp -- Competency Assessment ────────────────────────────
  const existingComp = sqlite.prepare(
    "SELECT id FROM competency_programs WHERE user_id = ?"
  ).get(demoUserId);
  if (!existingComp) {
    seedCompetencyData(sqlite, demoUserId, now);
  }

  // ─── 6. CUMSUM Tracker ─────────────────────────────────────────────────
  const existingTracker = sqlite.prepare("SELECT id FROM cumsum_trackers WHERE user_id = ?").get(demoUserId);
  if (!existingTracker) {
    seedCumsumData(sqlite, demoUserId, now);
  }

  console.log(`[seed] Demo data seeded for user=${demoUserId}`);
}

// ─── Map seeding ──────────────────────────────────────────────────────────────
function seedMapData(sqlite: any, mapId: number, now: string) {
  const instruments = [
    { name: "Beckman Coulter AU5800 [Primary]", role: "Primary", category: "Chemistry", tests: [
      { analyte: "Sodium", specialty: "Electrolytes/Routine Chemistry", complexity: "MODERATE" },
      { analyte: "Potassium", specialty: "Electrolytes/Routine Chemistry", complexity: "MODERATE" },
      { analyte: "Troponin", specialty: "Chemistry", complexity: "MODERATE" },
    ]},
    { name: "Beckman Coulter AU5800 [Backup]", role: "Backup", category: "Chemistry", tests: [
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
    { name: "Manual Differential", role: "Reference", category: "Hematology", tests: [
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
    { name: "Tube Method", role: "Reference", category: "Blood Bank", tests: [
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

// ─── Studies seeding (Sodium + Potassium method comparison) ───────────────────
function seedStudies(sqlite: any, demoUserId: number, now: string) {
  // Study 1: Sodium Method Comparison
  const sodiumDataPoints = generateSodiumData();
  sqlite.prepare(`
    INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
  `).run(
    demoUserId,
    "Sodium",
    "Beckman Coulter AU5800 [Primary]",
    "M. Veri, MLS(ASCP)",
    "2026-01-15",
    "method_comparison",
    4.0, // 4 mmol/L absolute TEa for sodium
    JSON.stringify(sodiumDataPoints),
    JSON.stringify(["Beckman Coulter AU5800 [Primary]", "Beckman Coulter AU5800 [Backup]"]),
    now
  );

  // Study 2: Potassium Method Comparison
  const potassiumDataPoints = generatePotassiumData();
  sqlite.prepare(`
    INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
  `).run(
    demoUserId,
    "Potassium",
    "Beckman Coulter AU5800 [Primary]",
    "M. Veri, MLS(ASCP)",
    "2026-01-15",
    "method_comparison",
    0.5, // 0.5 mmol/L absolute TEa for potassium
    JSON.stringify(potassiumDataPoints),
    JSON.stringify(["Beckman Coulter AU5800 [Primary]", "Beckman Coulter AU5800 [Backup]"]),
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
  ).run(programId, "Chemistry Routine - AU5800", JSON.stringify(["Beckman Coulter AU5800 [Primary]", "Beckman Coulter AU5800 [Backup]"]), JSON.stringify(["Sodium", "Potassium", "Troponin"]), null);
  const methodGroupId = Number(mgResult.lastInsertRowid);

  // Create assessment
  const assessResult = sqlite.prepare(`
    INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, evaluator_name, evaluator_title, evaluator_initials, competency_type, status, employee_acknowledged, supervisor_acknowledged, created_at)
    VALUES (?, ?, 'annual', '2026-01-20', 'M. Veri', 'Technical Consultant', 'MV', 'technical', 'pass', 1, 1, ?)
  `).run(programId, employeeId, now);
  const assessmentId = Number(assessResult.lastInsertRowid);

  // Create 6 assessment items (one per element), all passed
  const itemStmt = sqlite.prepare(`
    INSERT INTO competency_assessment_items (assessment_id, method_number, method_group_id, item_label, item_description, evidence, date_met, employee_initials, supervisor_initials, passed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const elements = [
    { num: 1, label: "Direct Observation of Routine Patient Test Performance", evidence: "Observed processing chemistry panel on AU5800", date: "2026-01-15" },
    { num: 2, label: "Monitoring, Recording and Reporting of Test Results", evidence: "Reviewed result reporting including critical values", date: "2026-01-16" },
    { num: 3, label: "QC Performance", evidence: "QC run documented in LIS on date observed", date: "2026-01-17" },
    { num: 4, label: "Direct Observation of Instrument Maintenance", evidence: "Observed daily maintenance on AU5800", date: "2026-01-17" },
    { num: 5, label: "Blind/PT Sample Performance", evidence: "CAP PT survey, all analytes acceptable", date: "2026-01-18" },
    { num: 6, label: "Problem-Solving Assessment (Quiz)", evidence: "Quiz Q-AU5800-001, 2/2 correct, 100%", date: "2026-01-18" },
  ];

  for (const el of elements) {
    itemStmt.run(assessmentId, el.num, methodGroupId, el.label, el.label, el.evidence, el.date, "JM", "MV");
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

// ─── Data generators ──────────────────────────────────────────────────────────

function generateSodiumData() {
  // 20 patient samples, sodium range 135-145 mmol/L
  // Primary vs Backup with <2% variation, slope ~1.001, intercept ~0.3, r2 = 0.998
  const points: any[] = [];
  const baseValues = [
    135.2, 136.8, 137.5, 138.1, 138.9, 139.4, 139.8, 140.2, 140.6, 141.0,
    141.3, 141.7, 142.0, 142.4, 142.8, 143.1, 143.5, 143.9, 144.3, 144.8,
  ];
  for (let i = 0; i < 20; i++) {
    const primary = baseValues[i];
    // Slight variation: slope 1.001, intercept 0.3, small noise
    const noise = (Math.sin(i * 2.71828) * 0.3);
    const backup = Math.round((primary * 1.001 + 0.3 + noise) * 10) / 10;
    points.push({
      level: i + 1,
      expectedValue: null,
      instrumentValues: {
        "Beckman Coulter AU5800 [Primary]": primary,
        "Beckman Coulter AU5800 [Backup]": backup,
      },
    });
  }
  return points;
}

function generatePotassiumData() {
  // 20 patient samples, potassium range 3.5-5.1 mmol/L
  // slope ~0.999, intercept ~0.02, r2 = 0.997
  const points: any[] = [];
  const baseValues = [
    3.5, 3.6, 3.7, 3.8, 3.9, 4.0, 4.1, 4.2, 4.3, 4.4,
    4.5, 4.6, 4.7, 4.8, 4.9, 5.0, 5.1, 4.3, 3.8, 4.6,
  ];
  for (let i = 0; i < 20; i++) {
    const primary = baseValues[i];
    const noise = (Math.sin(i * 1.618) * 0.03);
    const backup = Math.round((primary * 0.999 + 0.02 + noise) * 100) / 100;
    points.push({
      level: i + 1,
      expectedValue: null,
      instrumentValues: {
        "Beckman Coulter AU5800 [Primary]": primary,
        "Beckman Coulter AU5800 [Backup]": backup,
      },
    });
  }
  return points;
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
