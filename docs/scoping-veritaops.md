# Scoping: VeritaOps™ — Lab Cost-per-Test Module

**Status.** Pre-build scoping doc. No code on this module ships until the operator approves this scope.
**Source.** Parking-lot item #10, recorded 2026-05-07.
**Author.** Claude Code, 2026-05-10.

This doc is a structured proposal. It is meant to surface the decisions the operator needs to make before any code is written, per CLAUDE.md Section 8 Process Rules ("Large tasks: present a build breakdown first, get approval, THEN build").

---

## 1. Goal in one sentence

Give a clinical lab a defensible per-test cost figure plus a breakdown that holds up in budget conversations with the C-suite, by capturing the cost inputs the lab already manages and the cost inputs they should be managing.

## 2. Why this is a real product

- Most labs cost out tests by shifting a finance-supplied overhead number around in a spreadsheet. The math is opaque and the spreadsheet rots within a quarter.
- The CFO asks "what does it cost us to run a CMP?" and the lab director rebuilds the answer from memory.
- Send-out vs in-house decisions get made on instinct because per-test cost is unknown.
- Reagent contracts get renewed without anyone checking whether the actual cost-per-test trended up.
- This is the same shape of problem VeritaPT solved for proficiency testing: turn an opaque process into a tracked, auditable artifact.

## 3. Cost dimensions to model (v1 candidate set)

| Dimension | What it is | Lab-entered vs derived | v1 priority |
|---|---|---|---|
| Reagent cost | $/test for the reagent kit pulled from the contracted supplier price | Lab-entered, per analyte, per kit | **Must** |
| Calibrator cost | $/test allocated from calibrator kit and calibration frequency | Lab-entered + derived (cost / frequency / tests-between-cal) | **Must** |
| Control (QC) cost | $/test allocated from QC material cost and QC frequency | Lab-entered + derived | **Must** |
| Labor — direct | Tech time per run × per-result, allocated by batch size | Lab-entered (minutes / hourly rate) | **Must** |
| Disposables | Pipette tips, cuvettes, barcode labels — flat $/test | Lab-entered, per analyte | **Should** |
| Instrument depreciation | Capital cost / useful life / annual volume | Lab-entered (purchase date, useful life, annual volume) | **Should** |
| Maintenance contracts | Annual contract / annual volume | Lab-entered (contract $, volume) | **Should** |
| Overhead allocation | Indirect (utilities, space, IT) — typically 10-30% of direct | Lab-entered as a percent or a flat $/test | **Should** |
| Send-out cost | Reference lab list price for the same analyte | Lab-entered, per analyte | **Should** |
| Lost revenue (waste) | Tests rerun, rejected, expired reagent | Derived from VeritaCheck rerun rates and reagent lot expiration data | **Could (v2)** |

`Must` = block ship without it. `Should` = ship if reasonable. `Could` = follow-up.

**Open question for the operator:** which cost dimensions does Michael's intended customer actually track today, and which ones is the product expected to *teach* them to track? The first list keeps adoption low-friction; the second list is where the real value-add lives but raises the activation bar.

## 4. Outputs

### 4.1 Per-test cost card

For one analyte on one instrument:

```
Glucose on Roche Cobas c702 — Cost per reportable result
─────────────────────────────────────────────────────────
Reagent                 $0.45
Calibrator              $0.08
Control (QC)            $0.12
Labor (direct)          $0.30
Disposables             $0.04
Instrument deprec.      $0.07
Maintenance             $0.05
Overhead (15%)          $0.17
─────────────────────────────────────────────────────────
Total per result        $1.28

Annual volume:          720,000 results
Annual cost:            $921,600
Send-out comparator:    $4.20 / result   (Quest list price 2026)
Decision lever:         in-house saves $2.92 / result × 720k = $2.10M / yr
```

### 4.2 Lab-wide cost report (PDF + Excel)

Same card, every analyte on the menu, sorted by total annual cost descending. Paginated with director sign-off block. Same Excel-Standard formatting as VeritaCheck / VeritaScan / VeritaMap (per CLAUDE.md Section 6).

### 4.3 Break-even analysis

For send-out candidates: at what annual volume does in-house become cheaper than send-out, given the cost stack above. Useful when a lab is considering bringing a send-out test in-house (or vice versa).

### 4.4 Trend report

Per analyte, cost-per-test month over month. Shows when reagent contract increases hit, when batch size changes hurt cost, and when volume drops are eroding the per-test economics.

## 5. Integration points

| Module | What we pull from it | Owner |
|---|---|---|
| **VeritaMap** | Test menu by instrument (the analyte list to cost) | VeritaMap is source of truth |
| **VeritaPT** | PT cost as a separate line in the cost stack | New: pt_enrollments_v2 has program cost? not today; would need a `cost_per_year` column |
| **VeritaCheck** | Verification studies frequency (calibration verification cost allocation) | VeritaCheck records when verifications run |
| **VeritaScan** | Annual volume per analyte (if the lab reports it) | VeritaScan does not capture volume today; would need a volume-entry surface |
| **VeritaStock** | Reagent / calibrator / control inventory and consumption rate | VeritaStock has burn rate but not direct cost-per-test |

**Open question:** is annual volume the data point that should live in VeritaOps, or should it move to VeritaMap (one source of truth per analyte)? Recommendation: **VeritaMap.** Volume is an attribute of "this lab runs this test on this instrument," same as reference range and AMR. Adding a `volume_per_year` column to `veritamap_tests` keeps the data model clean.

## 6. Subscription tier question

Three options:
- **A. Roll into existing tiers** at no upcharge. Highest adoption, no new revenue.
- **B. Standalone module** (like VeritaCheck Unlimited) at $X/yr. Real revenue, but harder to sell because cost-per-test is plumbing, not a regulatory must-do.
- **C. Tier upsell** (Hospital and Enterprise only). Mirrors how PI dashboards are gated today. Captures revenue from labs that already pay top tier.

Recommendation: **C.** Cost-per-test discipline is a hospital-and-up sale; the pricing argument and the customer profile both fit. Clinic and Community tier customers can see VeritaOps in the menu but with a "Hospital tier required" lock state. Revisit if customer demand contradicts this.

## 7. Architecture sketch (no code yet)

### 7.1 DB tables

```sql
CREATE TABLE veritaops_cost_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  analyte TEXT NOT NULL,                    -- canonical name, FK to veritamap_tests
  instrument_id INTEGER,                    -- nullable; some inputs are lab-wide
  reagent_cost_per_test REAL,
  calibrator_cost_per_test REAL,
  qc_cost_per_test REAL,
  labor_minutes_per_test REAL,
  labor_hourly_rate REAL,
  disposables_cost_per_test REAL,
  instrument_depreciation_per_test REAL,
  maintenance_per_test REAL,
  overhead_pct REAL,
  send_out_cost_per_test REAL,
  effective_date TEXT NOT NULL,             -- when these inputs took effect
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE veritaops_volume (
  -- if we decide volume lives in VeritaMap this table goes away
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  analyte TEXT NOT NULL,
  instrument_id INTEGER,
  annual_volume INTEGER NOT NULL,
  effective_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

Both ship with PRAGMA migration blocks per New DB Table Rule (CLAUDE.md Section 8).

### 7.2 Endpoints

- `GET /api/veritaops/cost-stack` — per-analyte computed cost stack across the lab's menu
- `POST /api/veritaops/cost-inputs` — write/update inputs for one analyte
- `GET /api/veritaops/cost-inputs/:analyte` — read inputs for one analyte (form prefill)
- `GET /api/veritaops/cost-report.xlsx` — Excel export of the lab-wide cost report
- `GET /api/veritaops/cost-report.pdf` — PDF export with director sign-off block
- `GET /api/veritaops/break-even/:analyte` — break-even analysis for one analyte vs send-out

All write endpoints carry `requireWriteAccess` and `requireModuleEdit('veritaops')`.

### 7.3 UI pages

- `/veritaops` — dashboard tile + menu coverage of cost inputs (which analytes have complete data, which don't)
- `/veritaops/inputs/:analyte` — per-analyte input form
- `/veritaops/report` — interactive lab-wide cost report with sort, filter, drill-into-analyte
- `/veritaops/break-even` — interactive break-even analyzer

## 8. Scope tiers

- **Tier 1 (v1, ~3-4 weeks):** veritaops_cost_inputs + per-analyte input form + per-test cost card + lab-wide Excel export. NO PDF, NO break-even, NO trend report. Volume entered per analyte directly in VeritaOps for v1; defer the VeritaMap volume integration to v2.
- **Tier 2 (v1.1, ~1-2 weeks):** PDF report with director sign-off. Break-even analyzer.
- **Tier 3 (v2, ~2-3 weeks):** VeritaMap volume integration (move volume to veritamap_tests). Trend report.
- **Tier 4 (deferred):** rerun-rate / waste data feed from VeritaCheck. Reagent expiration cost feed from VeritaStock.

## 9. Risks and open questions for the operator

1. **Customer profile.** Who is the buyer? CFO finance team? Lab director? Operations manager? The form factor of the input UI changes by buyer. **Recommendation:** lab director, because they own the data and the C-suite conversation.
2. **Data activation.** Cost-per-test only matters if the lab actually fills in the inputs. What is the activation strategy? **Recommendation:** start by asking for reagent + calibrator + QC + labor only. The other dimensions are advanced; the v1 form should make them optional.
3. **Overhead allocation methodology.** Some labs allocate overhead per test, others per result, others per FTE. v1 supports a flat percent only; v2 can offer alternatives.
4. **Send-out comparator data.** Is the operator supplying a reference price list (Quest, Labcorp, ARUP) or does the lab enter their own send-out contract prices? **Recommendation:** lab enters their own. We do not maintain a send-out price database.
5. **Subscription tier.** Roll into existing, standalone, or tier upsell? **Recommendation:** tier upsell (Hospital and Enterprise) per Section 6 above.
6. **Volume source.** VeritaOps owns it (simple, ships sooner) or VeritaMap owns it (clean data model, longer build). **Recommendation:** VeritaOps in v1, migrate to VeritaMap in v2 once the form is settled.

## 10. What the operator needs to decide before code starts

The minimum set of decisions to unblock a v1 build:

1. **Approve the must-have cost dimensions** (Section 3, "Must" rows). Add or remove any.
2. **Approve the v1 output set** — per-test cost card + lab-wide Excel — and confirm PDF and break-even are v1.1.
3. **Approve the subscription tier** — recommendation is Hospital and Enterprise tier upsell.
4. **Approve volume placement** — recommendation is VeritaOps owns volume in v1, migrate to VeritaMap in v2.
5. **Naming.** "VeritaOps" is the working name from the parking lot. Confirm or change.

## 11. Effort estimate

Tier 1 (v1): **3-4 weeks** of focused implementation, assuming the operator approves the recommendations above. Splits roughly:

- 3-4 days: schema, endpoints, validation
- 5-7 days: input form UX and per-analyte cost card
- 3-4 days: lab-wide Excel report
- 2-3 days: cost computation tests + edge case audit (e.g., zero-division, missing inputs)
- 2-3 days: dashboard tile + menu coverage view
- 2-3 days: regression testing, bug fixes, documentation

Tier 2 (v1.1): **1-2 weeks** for PDF + break-even.
Tier 3 (v2): **2-3 weeks** for VeritaMap volume integration + trend report.

## 12. Cross-references

- **Multi-lab Tier 2 (#11/#12):** veritaops_cost_inputs.user_id should reference lab_members lab scope when that ships. Defensive: isolate the scope query in one helper now so the swap is one line later.
- **VeritaResponse (#17):** if VeritaResponse adds a "process improvement" path post-deficiency, the cost-stack data could feed corrective-action ROI calculations. Out of scope for v1.
- **VeritaPT (#15 + #18 Phase 2):** PT cost as a line in the cost stack ties to vendor program cost; would need a cost field on pt_enrollments_v2.
