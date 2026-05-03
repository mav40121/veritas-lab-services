# expand_michaels_lab.py — Rewrite Spec (v3, 2026-05-03)

## Overview

This is a **full rewrite** of `scripts/expand_michaels_lab.py`. The previous draft targeted an old/wrong fleet (Beckman AU480, Siemens DCA Vantage, Sysmex XN-1000). The locked fleet below replaces it entirely.

**Target user**: Michael Veri, `user_id = 17`, `lab_id = 3`. Demo lab for the COLA conference May 6-8, 2026.

**Current state of Michael's lab** (`/tmp/veritas-prod-postseed.db`, also live on Railway):

| map_id | name | tests |
|---|---|---|
| 40 | Hem | 14 |
| 41 | Beckman AU480 Chemistry | 14 |
| 42 | Siemens DCA Vantage POC | 2 |

5 instruments total: 2× Sysmex XN-1000 (Pri+Backup) on map 40, 2× Beckman AU480 (Pri+Backup) on map 41, 1× Siemens DCA Vantage on map 42. All wrong for the new fleet.

## Goal

Replace Michael's existing 3 maps with **8 new department-scoped maps** matching the locked fleet. Then seed **~72 cross-map correlation pairs** with realistic backfilled history grouped by instrument family. The dashboard widget should show a mix of "Current," "Due soon," and a couple "Overdue" pairs on day 1 for demo realism.

## Approach: idempotent wipe + rebuild

Use a `SEED_TAG_EXPAND_V3 = "[SEED-2026-05-03-EXPAND-V3]"` tag in `veritamap_instruments.notes` and `veritamap_test_correlations.notes` so a `--wipe-expand` flag can cleanly remove only this script's seed data without touching anything else.

**Wipe rules** (run via `--wipe-expand`):
- DELETE all rows from `veritamap_test_correlations` where `notes LIKE '%[SEED-2026-05-03-EXPAND-V3]%'`
- DELETE all rows from `veritamap_instrument_tests` where `instrument_id IN (SELECT id FROM veritamap_instruments WHERE notes LIKE '%[SEED-2026-05-03-EXPAND-V3]%')`
- DELETE all rows from `veritamap_tests` where `map_id IN (SELECT id FROM veritamap_maps WHERE user_id = 17 AND name LIKE '%[SEED-2026-05-03-EXPAND-V3]%' OR id IN (40,41,42))` AND notes LIKE '%[SEED-2026-05-03-EXPAND-V3]%'
- DELETE all rows from `veritamap_instruments` where `notes LIKE '%[SEED-2026-05-03-EXPAND-V3]%'`
- DELETE all rows from `veritamap_maps` where `user_id = 17` AND `notes LIKE '%[SEED-2026-05-03-EXPAND-V3]%'` (only the 5 NEW maps; leave 40/41/42 alone)
- For the 3 existing maps (40, 41, 42): don't delete them, just delete THEIR seed-tagged rows, and rebuild their fleet/tests in the next run.

**Rebuild rules** (run via `--execute`):
- Use the 3 existing map ids (40, 41, 42) for 3 of the 8 new maps (rename them).
- INSERT 5 new map rows.
- INSERT all instruments with `notes = SEED_TAG_EXPAND_V3` so wipe is clean.
- INSERT all tests (the same `rebuildMapTests` mechanism syncs `veritamap_instrument_tests` from instrument-level test menu).
- INSERT all 72 correlation pairs with `notes = SEED_TAG_EXPAND_V3`.

## The 8 Maps

Map ids follow the pattern: existing 40, 41, 42 get repurposed; 5 new map rows get auto-generated ids.

| # | Map name | Reuse map_id? |
|---|---|---|
| 1 | Hematology — Sysmex XN-2000 + Manual Diff | 40 (rename from "Hem") |
| 2 | Chemistry — Siemens Dimension EXL | 41 (rename from "Beckman AU480 Chemistry") |
| 3 | Coagulation — Stago STA Compact Max | 42 (rename from "Siemens DCA Vantage POC") |
| 4 | Urinalysis — CLINITEK Status+ + Manual Micro | NEW |
| 5 | Blood Bank — Tube + Ortho ID-MTS Gel | NEW |
| 6 | Molecular — Cepheid GeneXpert IV | NEW |
| 7 | Point of Care — i-STAT G3+ + Nova StatStrip | NEW |
| 8 | Kit & Manual Tests | NEW |

## The Locked Fleet (instruments per map)

### Map 1 — Hematology
| instrument_name | role | category | nickname | notes |
|---|---|---|---|---|
| Sysmex XN-2000 | Primary | Hematology | Fred | Tower A |
| Sysmex XN-2000 | Backup | Hematology | Wilma | Tower B |
| Alcor mini-iSED | Primary | Hematology | (none) | ESR (sed rate) |
| Manual Differential | Primary | Hematology | (none) | Microscope manual diff |

### Map 2 — Chemistry
| instrument_name | role | category | nickname | notes |
|---|---|---|---|---|
| Siemens Dimension EXL | Primary | Chemistry | Bert | drug, endo, HbA1c, microalbumin |
| Siemens Dimension EXL | Backup | Chemistry | Ernie | identical menu to Bert |

### Map 3 — Coagulation
| instrument_name | role | category | nickname |
|---|---|---|---|
| Stago STA Compact Max | Primary | Coagulation | Sherlock |
| Stago STA Compact Max | Satellite | Coagulation | Watson |

### Map 4 — Urinalysis
| instrument_name | role | category | nickname |
|---|---|---|---|
| CLINITEK Status+ | Primary | Urinalysis | Pebbles |
| Manual Microscopy | Primary | Urinalysis | (none) |

### Map 5 — Blood Bank
| instrument_name | role | category | nickname |
|---|---|---|---|
| Tube method | Primary | Blood Bank | (none) |
| Ortho ID-MTS Gel | Primary | Blood Bank | (none) |

### Map 6 — Molecular
| instrument_name | role | category | nickname |
|---|---|---|---|
| Cepheid GeneXpert IV (4-bay) | Primary | Molecular | Einstein |

### Map 7 — Point of Care
| instrument_name | role | category | nickname |
|---|---|---|---|
| Abbott i-STAT Alinity G3+ | POC | POC | Mario |
| Nova StatStrip Glucose | POC | POC | ED |
| Nova StatStrip Glucose | POC | POC | Floor |
| Nova StatStrip Glucose | POC | POC | Clinic |
| Nova StatStrip Glucose | POC | POC | OR |
| Nova StatStrip Glucose | POC | POC | Lab Backup |

### Map 8 — Kit & Manual
| instrument_name | role | category | nickname |
|---|---|---|---|
| HIV Rapid Kit | Primary | Serology | (none) |
| Mononucleosis Kit | Primary | Serology | (none) |
| Acetone Kit | Primary | Chemistry | (none) |
| Gram Stain | Primary | Microbiology | (none) |

## Test menus per instrument

Use the existing `veritamap_instrument_tests` table (one row per instrument-analyte combo). The schema is:
```
veritamap_instrument_tests(id, map_id, instrument_id, analyte, specialty, complexity, active, ...)
```

Specialty values must come from existing taxonomy (use what's already in the DB; common values: Hematology, Chemistry, Coagulation, Urinalysis, Blood Bank, Molecular, POC, Serology, Microbiology). Complexity is MODERATE | HIGH | WAIVED.

### Map 1 — Hematology test menu

**Sysmex XN-2000 Tower A "Fred" (Primary)** and **Tower B "Wilma" (Backup)** run the IDENTICAL menu, MODERATE:
- WBC, RBC, Hgb, Hct, MCV, MCH, MCHC, RDW, Plt, MPV, IPF, Retic, IRF, NRBC, IG, TNC
- 5-part diff: Neutrophil%, Lymph%, Mono%, Eos%, Baso% (XN auto-diff is MODERATE)

**Alcor mini-iSED**: ESR (MODERATE)

**Manual Differential** (microscope): Manual Diff (HIGH — manual microscopy)

### Map 2 — Chemistry test menu

**Siemens Dimension EXL "Bert" (Primary)** and **Backup "Ernie"** run IDENTICAL menus, MODERATE:
- BMP: Sodium, Potassium, Chloride, CO2, BUN, Creatinine, Glucose, Calcium
- LFT: AST, ALT, ALP, Total Bilirubin, Direct Bilirubin, Total Protein, Albumin
- Lipid: Total Cholesterol, HDL, LDL (calc), Triglycerides
- Cardiac: CK, CK-MB, Troponin I, BNP
- Endocrine: TSH, Free T4, Free T3, Cortisol
- Diabetes: HbA1c, Microalbumin (urine)
- Drug: Phenytoin, Valproic Acid, Lithium, Vancomycin, Digoxin
- Other: Magnesium, Phosphorus, Uric Acid, Lactate, Iron, TIBC, Ferritin, Amylase, Lipase, GGT, LDH

That's ~50 chem analytes. The exact list can be tightened, but the pair count for correlations comes from this menu.

### Map 3 — Coagulation test menu

**Stago STA Compact Max "Sherlock" (Primary)** and **"Watson" (Satellite)** run IDENTICAL menus, MODERATE:
- PT, INR, APTT, Fibrinogen, D-dimer

### Map 4 — Urinalysis

**CLINITEK Status+ "Pebbles"**: UA dipstick (Glucose-U, Bilirubin-U, Ketones, SG, Blood-U, pH, Protein-U, Urobilinogen, Nitrite, Leukocytes), MODERATE
**Manual Microscopy**: Urine Sediment (RBC, WBC, Casts, Crystals), HIGH (manual)

### Map 5 — Blood Bank

**Tube method**: ABO/Rh, Crossmatch IS — HIGH
**Ortho ID-MTS Gel**: Antibody Screen, Crossmatch AHG — HIGH

### Map 6 — Molecular

**Cepheid GeneXpert IV "Einstein"**: GeneXpert Flu A/B+RSV, GeneXpert MRSA, GeneXpert C. diff, GeneXpert SARS-CoV-2, GeneXpert GBS, GeneXpert HIV viral load — MODERATE (most Xpert assays)

### Map 7 — Point of Care

**Abbott i-STAT Alinity G3+ "Mario"**: i-STAT Glucose-POC, i-STAT iCa, i-STAT Lactate-POC, i-STAT Creatinine-POC, i-STAT BUN-POC, i-STAT Sodium-POC, i-STAT Potassium-POC, i-STAT Chloride-POC, i-STAT pH-POC, i-STAT pCO2, i-STAT pO2, i-STAT HCO3, i-STAT Hgb-POC, i-STAT Hct-POC, i-STAT Troponin I-POC — HIGH (per CMS FAQ Dec 2022)

**Nova StatStrip Glucose** (×5 units, ED/Floor/Clinic/OR/Lab Backup): Glucose-POC — WAIVED

### Map 8 — Kit & Manual

- HIV Rapid Kit: HIV — WAIVED
- Mononucleosis Kit: Monospot — WAIVED
- Acetone Kit: Acetone — WAIVED
- Gram Stain: Gram Stain — HIGH

## The ~72 correlation pairs

Per 42 CFR §493.1281, correlations are required when 2+ instruments run the same analyte under non-waived complexity. Group sign-offs are allowed within the 6-month window.

### Group 1: XN-2000 Tower A ↔ Tower B (Hematology)
All identical-analyte pairs between Sysmex XN-2000 Pri "Fred" and Backup "Wilma":
WBC, RBC, Hgb, Hct, MCV, MCH, MCHC, RDW, Plt, MPV, IPF, Retic, IRF, NRBC, IG, TNC, Neutrophil%, Lymph%, Mono%, Eos%, Baso%
**= 21 pairs** (close to the ~16 estimated; was a back-of-envelope; actual count is 21 once we include the auto-diff)

correlation_method = "XN-Check daily QC + monthly split-sample (n=20)"
acceptable_criteria = "Bias <= 10% or within manufacturer SD"
group_id = 1
signoff_date = 60 days ago (so next_due = ~120 days from now -> "Current")
work_performed_date = 75 days ago

### Group 2: Dimension EXL Primary "Bert" ↔ Backup "Ernie" (Chemistry)
All identical-analyte pairs across the ~50 chem menu = **~50 pairs**.

correlation_method = "Daily QC convergence + biannual split-sample (n=20)"
acceptable_criteria = "Bias <= TEa per CLIA"
group_id = 2
signoff_date = 165 days ago (next_due = ~15 days from now -> "Due soon")
work_performed_date = 175 days ago

### Group 3: Stago Sherlock ↔ Watson (Coagulation)
PT, INR, APTT, Fibrinogen, D-dimer = **5 pairs**

correlation_method = "Daily QC + quarterly split-sample (n=20)"
acceptable_criteria = "Bias <= 10%"
group_id = 3
signoff_date = 200 days ago (next_due = -20 days from now -> "Overdue")  ← this is the demo realism: one group is overdue
work_performed_date = 210 days ago

### Ungrouped: Manual diff (Hematology)
Manual Differential ↔ XN-2000 Tower A "Fred" auto-diff: this is an EQA-style correlation since manual diff is HIGH and the analyzer is MODERATE. One pair, ungrouped.

correlation_method = "Manual 100-cell diff vs analyzer auto-diff, monthly"
acceptable_criteria = "Within 1 SD per analyte"
group_id = NULL
signoff_date = 30 days ago (next_due = ~150 days from now -> "Current")

### Total
21 + 50 + 5 + 1 = **77 pairs** (close to the ~72 estimate)

## Test data placeholders

Set `last_cal_ver`, `last_method_comp`, `last_precision`, `last_sop_review` on the new tests using a 70/20/10 distribution:
- 70% Compliant: all 4 dates filled, staggered between 30-150 days ago
- 20% Warning: 1 of 4 dates NULL or stale (>180 days for cv/method-comp/precision; >365 for sop)
- 10% Action: 2 of 4 dates NULL/stale

Distribution is deterministic by hash of analyte name so re-runs produce the same gaps.

## CLI

```bash
python3 expand_michaels_lab.py --db /tmp/veritas-prod-postseed.db --dry-run
python3 expand_michaels_lab.py --db /tmp/veritas-prod-postseed.db --execute
python3 expand_michaels_lab.py --db /tmp/veritas-prod-postseed.db --wipe-expand
```

Dry-run prints SQL and counts but commits nothing.
Execute commits in a single transaction.
Wipe-expand removes all SEED_TAG_EXPAND_V3 rows in correct FK order.

Always print a final summary:
```
INSERTED maps: 5 new (+ 3 renamed)
INSERTED instruments: 21
INSERTED tests: ~150
INSERTED correlations: 77 (3 groups + 1 ungrouped)
```

## Companion: generate_expand_sql.py

After dry-run validates, also generate `scripts/seed/michaels_lab_expand_v3_2026_05_03.sql` containing the same INSERTs as raw SQL for the admin endpoint to apply. Keep the two paths consistent (Python script for dev/test, SQL artifact for the prod admin endpoint).

## Validation expectations (post --execute)

```sql
-- Maps
SELECT COUNT(*) FROM veritamap_maps WHERE user_id = 17;  -- 8

-- Instruments
SELECT COUNT(*) FROM veritamap_instruments
  WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = 17);  -- 21

-- Tests
SELECT COUNT(*) FROM veritamap_tests
  WHERE map_id IN (SELECT id FROM veritamap_maps WHERE user_id = 17) AND active = 1;  -- ~150

-- Correlations grouped
SELECT correlation_group_id, COUNT(*) FROM veritamap_test_correlations
  WHERE notes LIKE '%[SEED-2026-05-03-EXPAND-V3]%' GROUP BY correlation_group_id;
-- expected:
-- NULL: 1
-- 1: 21
-- 2: 50
-- 3: 5

-- Dashboard widget query (next 60 days, lab_id=3):
SELECT COUNT(*) FROM veritamap_test_correlations c
  JOIN veritamap_tests ta ON ta.id = c.test_a_id
  JOIN veritamap_maps ma ON ma.id = ta.map_id
  JOIN users ua ON ua.id = ma.user_id
  WHERE ua.lab_id = 3 AND (c.next_due IS NULL OR c.next_due <= date('now', '+60 days'));
-- expected: ~55-60 (group 2 at +15d due-soon + group 3 at -20d overdue + manual diff at +150d, plus group 1 if next_due falls in window)
```
