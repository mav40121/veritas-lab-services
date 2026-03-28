/**
 * Seed demo account data for Riverside Regional Medical Center.
 * Runs on startup — safe to re-run (uses INSERT OR IGNORE / checks).
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
    // Ensure plan is lab and onboarding complete
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

  // ─── 2. VeritaMap — Riverside Regional Map ──────────────────────────────
  const existingMap = sqlite.prepare("SELECT id FROM veritamap_maps WHERE user_id = ? AND name = ?").get(demoUserId, "Riverside Regional \u2014 2026 Compliance Map");
  if (existingMap) {
    console.log("[seed] Demo map already exists, skipping seed.");
    return; // Already seeded
  }

  const now = new Date().toISOString();

  const mapResult = sqlite.prepare(
    "INSERT INTO veritamap_maps (user_id, name, instruments, created_at, updated_at) VALUES (?, ?, '[]', ?, ?)"
  ).run(demoUserId, "Riverside Regional \u2014 2026 Compliance Map", now, now);
  const mapId = Number(mapResult.lastInsertRowid);

  // Instruments
  const instruments = [
    { name: "Ortho 5600 Primary", role: "Primary", category: "Chemistry", tests: [
      { analyte: "Potassium", specialty: "Chemistry", complexity: "MODERATE" },
      { analyte: "Troponin", specialty: "Chemistry", complexity: "MODERATE" },
      { analyte: "Sodium", specialty: "Chemistry", complexity: "MODERATE" },
    ]},
    { name: "Ortho 5600 Backup", role: "Backup", category: "Chemistry", tests: [
      { analyte: "Potassium", specialty: "Chemistry", complexity: "MODERATE" },
      { analyte: "Troponin", specialty: "Chemistry", complexity: "MODERATE" },
      { analyte: "Sodium", specialty: "Chemistry", complexity: "MODERATE" },
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

    // Build merged map tests with realistic dates
    const analyteMap: Record<string, { specialty: string; complexity: string; instruments: string[] }> = {};
    for (const inst of instruments) {
      for (const t of inst.tests) {
        if (!analyteMap[t.analyte]) analyteMap[t.analyte] = { specialty: t.specialty, complexity: t.complexity, instruments: [] };
        analyteMap[t.analyte].instruments.push(inst.name);
      }
    }

    for (const [analyte, info] of Object.entries(analyteMap)) {
      const isWaived = info.complexity === "WAIVED";
      // Give realistic dates — most have recent cal ver and method comp
      let calVer: string | null = isWaived ? null : "2026-01-15";
      let methodComp: string | null = info.instruments.length >= 2 ? "2025-11-20" : null;
      let precision: string | null = isWaived ? null : "2025-10-05";

      // Deliberately leave some incomplete for demo story
      if (analyte === "PT") { methodComp = null; } // PT correlation pending
      if (analyte === "Potassium") { calVer = null; } // Potassium cal ver pending
      if (analyte === "Hemoglobin") { precision = null; } // Hemoglobin accuracy pending

      // Sodium method comparison — done (will show as auto-completed by VeritaCheck)
      if (analyte === "Sodium") { methodComp = "2026-03-15"; }
      // HbA1c accuracy — done
      if (analyte === "Hemoglobin A1c") { precision = "2026-03-10"; }

      mapTestStmt.run(mapId, analyte, info.specialty, info.complexity, info.instruments.join(", "), calVer, methodComp, precision, now);
    }
  });
  seedInstruments();

  // ─── 3. VeritaScan — Riverside Regional Scan ────────────────────────────
  const scanResult = sqlite.prepare(
    "INSERT INTO veritascan_scans (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(demoUserId, "Riverside Regional \u2014 2026 Annual Inspection Readiness", now, now);
  const scanId = Number(scanResult.lastInsertRowid);

  // Items to leave INCOMPLETE (for demo story)
  const incompleteKeywords = [
    // PT correlation/method comparison items
    "correlation", "method comparison",
    // Potassium calibration verification
    "calibration verification",
    // Hemoglobin accuracy
    "accuracy",
  ];

  // Items to mark as auto-completed by VeritaCheck
  const autoCompletedItems = new Map<number, { studyName: string; link: string }>();
  // We'll set these after creating the studies

  // Mark ~60% of 168 items as Compliant
  const scanItemStmt = sqlite.prepare(`
    INSERT INTO veritascan_items (scan_id, item_id, status, notes, owner, completion_source, completion_link, completion_note, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Deterministic "random" - use item_id to decide status
  // Items 1-168, mark about 60% as Compliant
  const seedScanItems = sqlite.transaction(() => {
    for (let itemId = 1; itemId <= 168; itemId++) {
      // Default: mark as Compliant if hash is favorable (~60%)
      const hash = (itemId * 7 + 13) % 10; // 0-9
      const isCompliant = hash < 6; // 60% chance

      let status = isCompliant ? "Compliant" : "Not Assessed";
      let notes: string | null = null;
      let owner: string | null = isCompliant ? "Lab Staff" : null;
      let completionSource = "manual";
      let completionLink: string | null = null;
      let completionNote: string | null = null;

      // Specific overrides: Blood Bank items (122-141) — some compliant, some N/A for smaller items
      if (itemId >= 122 && itemId <= 141) {
        status = hash < 7 ? "Compliant" : "Not Assessed";
        owner = status === "Compliant" ? "Blood Bank Lead" : null;
      }

      // Leave PT-related items incomplete (items about correlation: 26, 27, 28, 29)
      if ([26, 27, 28, 29].includes(itemId)) {
        status = "Not Assessed";
        notes = "Pending \u2014 PT correlation study not yet completed";
        owner = null;
      }

      // Leave calibration verification items that match potassium incomplete (21, 22, 23, 24)
      if ([21, 22, 23, 24].includes(itemId)) {
        status = "Not Assessed";
        notes = "Pending \u2014 Potassium cal ver not yet completed";
        owner = null;
      }

      // Leave accuracy/precision items incomplete for Hemoglobin (30, 32)
      if ([30, 32].includes(itemId)) {
        status = "Not Assessed";
        notes = "Pending \u2014 Hemoglobin accuracy study not yet completed";
        owner = null;
      }

      scanItemStmt.run(scanId, itemId, status, notes, owner, completionSource, completionLink, completionNote, now);
    }
  });
  seedScanItems();

  // ─── 4. VeritaCheck Studies ─────────────────────────────────────────────

  // Study 1: Sodium Method Comparison
  const sodiumDataPoints = generateMethodComparisonData(20, 140, 145, 0.998, 1.002);
  const study1Result = sqlite.prepare(`
    INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
  `).run(
    demoUserId,
    "Sodium",
    "Ortho 5600 Primary",
    "Demo Analyst",
    "2026-03-15",
    "method_comparison",
    0.04, // 4 mmol/L or ~3%
    JSON.stringify(sodiumDataPoints),
    JSON.stringify(["Ortho 5600 Primary", "Ortho 5600 Backup"]),
    now
  );
  const study1Id = Number(study1Result.lastInsertRowid);

  // Study 2: HbA1c Accuracy & Precision
  const hba1cDataPoints = generateAccuracyData(3, [4.5, 7.0, 10.5], 0.06);
  const study2Result = sqlite.prepare(`
    INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)
  `).run(
    demoUserId,
    "Hemoglobin A1c",
    "Tosoh",
    "Demo Analyst",
    "2026-03-10",
    "precision",
    0.06, // 6% TEa
    JSON.stringify(hba1cDataPoints),
    JSON.stringify(["Tosoh"]),
    now
  );
  const study2Id = Number(study2Result.lastInsertRowid);

  // Now mark the corresponding VeritaScan items as auto-completed by VeritaCheck
  // Sodium method comparison → items 26,27,28,29 (method comparison items) — but only for Sodium
  // Since these are general items, we auto-complete them to show the bridge
  const autoCompleteStmt = sqlite.prepare(`
    UPDATE veritascan_items SET
      status = 'Compliant',
      completion_source = 'veritacheck_auto',
      completion_link = ?,
      completion_note = ?,
      notes = ?,
      owner = 'VeritaCheck\u2122',
      updated_at = ?
    WHERE scan_id = ? AND item_id = ?
  `);

  // Auto-complete: pick two specific items to show as VC-auto-completed
  // Item 29: "Correlation studies performed when multiple instruments perform the same test" — for Sodium
  autoCompleteStmt.run(
    `/study/${study1Id}/results`,
    `Auto-completed by VeritaCheck: Sodium Method Comparison on 2026-03-15`,
    `Auto-completed by VeritaCheck: Sodium Method Comparison \u2014 Ortho 5600 Primary vs Backup`,
    now, scanId, 29
  );

  // Item 32: "Accuracy verification (bias study) performed" — for HbA1c
  autoCompleteStmt.run(
    `/study/${study2Id}/results`,
    `Auto-completed by VeritaCheck: HbA1c Accuracy & Precision on 2026-03-10`,
    `Auto-completed by VeritaCheck: HbA1c Accuracy & Precision \u2014 Tosoh`,
    now, scanId, 32
  );

  // ─── 5. CUMSUM Tracker — CA-660 Primary ─────────────────────────────────
  const trackerResult = sqlite.prepare(
    "INSERT INTO cumsum_trackers (user_id, instrument_name, analyte, created_at) VALUES (?, ?, ?, ?)"
  ).run(demoUserId, "CA-660 Primary", "PTT", now);
  const trackerId = Number(trackerResult.lastInsertRowid);

  const entryStmt = sqlite.prepare(`
    INSERT INTO cumsum_entries (tracker_id, year, lot_label, old_lot_number, new_lot_number,
      old_lot_geomean, new_lot_geomean, difference, cumsum, verdict, specimen_data, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // 3 historical entries, all ACCEPT, final CumSum = -2.5
  entryStmt.run(trackerId, 2025, "Lot Change #1", "LOT-2024-A", "LOT-2025-A", 28.5, 29.1, 0.6, 0.6, "ACCEPT",
    JSON.stringify(generateSpecimenData(20, 28.5, 29.1)), "Routine lot change", now);
  entryStmt.run(trackerId, 2025, "Lot Change #2", "LOT-2025-A", "LOT-2025-B", 29.1, 27.5, -1.6, -1.0, "ACCEPT",
    JSON.stringify(generateSpecimenData(20, 29.1, 27.5)), "Mid-year lot change", now);
  entryStmt.run(trackerId, 2026, "Lot Change #3", "LOT-2025-B", "LOT-2026-A", 27.5, 26.0, -1.5, -2.5, "ACCEPT",
    JSON.stringify(generateSpecimenData(20, 27.5, 26.0)), "Annual lot change", now);

  console.log(`[seed] Demo data seeded: map=${mapId}, scan=${scanId}, studies=${study1Id},${study2Id}, tracker=${trackerId}`);
}

// ─── Helper: Generate method comparison data ──────────────────────────────
function generateMethodComparisonData(n: number, baseLow: number, baseHigh: number, targetR: number, targetSlope: number) {
  const points: any[] = [];
  for (let i = 0; i < n; i++) {
    const refValue = baseLow + (baseHigh - baseLow) * (i / (n - 1));
    const noise = (Math.sin(i * 3.14159) * 0.5 + (i % 3) * 0.1) * 0.3;
    const testValue = refValue * targetSlope + noise;
    points.push({
      level: i + 1,
      expectedValue: Math.round(refValue * 10) / 10,
      instrumentValues: {
        "Ortho 5600 Primary": Math.round(refValue * 10) / 10,
        "Ortho 5600 Backup": Math.round(testValue * 10) / 10,
      },
    });
  }
  return points;
}

// ─── Helper: Generate accuracy/precision data ─────────────────────────────
function generateAccuracyData(nLevels: number, targetValues: number[], tea: number) {
  const points: any[] = [];
  for (let i = 0; i < nLevels; i++) {
    const target = targetValues[i];
    // Generate 20 replicate measurements close to target
    const values: number[] = [];
    for (let j = 0; j < 20; j++) {
      const noise = (Math.sin(j * 2.718 + i) * 0.3) * target * tea * 0.3;
      values.push(Math.round((target + noise) * 100) / 100);
    }
    points.push({
      level: i + 1,
      expectedValue: target,
      instrumentValues: { "Tosoh": values[0] },
      replicates: values,
    });
  }
  return points;
}

// ─── Helper: Generate CUMSUM specimen data ────────────────────────────────
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
