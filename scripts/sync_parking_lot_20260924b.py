# Parking-lot sync (2026-09-24, second pass): log the coverage-recurrence +
# VeritaComp coverage-map + VeritaStaff dual-view work shipped this session, and
# add two low-priority follow-ups surfaced during the build.
import re, pathlib
MD = pathlib.Path(__file__).resolve().parent.parent / "PARKING_LOT.md"
text = MD.read_text(encoding="utf-8")

closed_entries = """### C43. VeritaStaff instrument-centric (dual) assignment view

**Closure evidence:** PR #1320. GET/PUT /staff/instruments/:id/employees (transpose of the per-employee endpoints); an "Assign by Instrument" dialog lets a director pick a test system or manual test and check off who runs it. Same staff_employee_instruments join, with the 42 CFR 493.1235(a) duty-change event emitted on newly-added pairs so both orientations trigger the same reassessment. GET verified live on SCAHC lab 2. Closed 2026-09-24.

**Source:** 2026-09-24 session, Michael ("in staff we should also give the dual view when assigning coverage to test systems or manual tests").

---

### C42. VeritaComp coverage map (required-vs-assessed matrix, dual view)

**Closure evidence:** PR #1319 (+ status layer PR #1316). /competency/owed returns per-item assessed (locked passing assessment this cycle on a covering method group) + per-employee CLIA status; CompetencyCoverageMap renders a By-employee / By-instrument matrix (Assessed / Owed / Overdue / Gap). Verified live on SCAHC lab 2 (owed 116, assessed 2, gaps 0). Completes #48 as the VeritaCheck-parity coverage map. Closed 2026-09-24.

**Source:** 2026-09-24 session, Michael ("are we building the competencies to have a coverage map, same as veritacheck?" then "build it").

---

### C41. VeritaCheck coverage recurrence (method comparison + cal-ver/linearity + reports)

**Closure evidence:** PRs #1317 (method comparison), #1318 (cal-ver/linearity), #1321 (report Next-due columns). Periodic verification (correlation/method comparison 42 CFR 493.1281; cal-ver/linearity 42 CFR 493.1255; both 6-month) now recurs: a signed study banks the cycle and rolls to next-due = signed + 6 months instead of reading "done" forever. Status Missing/Failed/Completed-unsigned + a "Next due on" column on-screen and in both coverage exports; also credits the previously-ignored "correlation" study type. Root cause: computeCoverageFrom marked requirements done on mere existence, no date logic. Verified live on SCAHC lab 2 (101 correlations + 11 cal-ver rows now carry a next-due). Engine-level, all facilities. Closed 2026-09-24.

**Source:** 2026-09-24 session, Michael ("Look at San Carlos... they finished their last set of correlations (all 103) but their menu never reset").

---

"""

open_entries = """### 49. Unify the coverage/competency recurrence into one shared helper (tech debt)

**Effort:** S (a few hours) - extract "latest study/assessment -> status / nextDueOn / overdue" into one helper used by method comparison, cal-ver/linearity, and the competency owed derivation.
**Importance:** Low - the three paths duplicate the +6-month / signed-resets-to-missing logic. They agree today (verified), but a shared helper prevents future drift and settles the dateless-signed edge in one place. No user-facing impact; studies.date is NOT NULL so the one known divergence is unreachable in practice.

**Source:** 2026-09-24 session, surfaced during the coverage-recurrence build. No live defect; hygiene.

---

### 50. Competency "assessed this cycle" uses a flat 365-day window

**Effort:** S-M - anchor the coverage-map "assessed this cycle" to the person's actual CLIA cadence (semiannual in year 1 per 42 CFR 493.1451(b)(8), annual thereafter) from staff_competency_schedules, instead of the v1 flat 365-day lookback.
**Importance:** Medium - in an employee's first year the semiannual windows differ from a flat annual window, so a first-year assessment could read as current slightly longer or shorter than the true cadence. Fine for the common annual case; refine for year-1 accuracy.

**Source:** 2026-09-24 session, VeritaComp coverage map (#48 Phase 3) v1 simplification, noted in PR #1319.

---

"""

marker = "## CLOSED (audit trail)\n\n"
idx = text.find(marker)
if idx < 0:
    raise SystemExit("CLOSED header not found")
# Insert OPEN entries right before the CLOSED header (end of OPEN section).
text = text[:idx] + open_entries + text[idx:]
# Recompute marker position (text grew) and insert CLOSED entries after the header.
idx2 = text.find(marker) + len(marker)
text = text[:idx2] + closed_entries + text[idx2:]

MD.write_text(text, encoding="utf-8")
print("PARKING_LOT.md updated: added C41-C43 (closed) and #49-#50 (open).")
