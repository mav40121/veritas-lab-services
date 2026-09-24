# One-off parking-lot sync (2026-09-24): move #43, #44, #45, #46 from OPEN to
# CLOSED and add #48 as CLOSED, reflecting work verified/shipped this session.
# Robust block-move by regex on the item separators (no fragile hand-edits).
import re
import pathlib

MD = pathlib.Path(__file__).resolve().parent.parent / "PARKING_LOT.md"
text = MD.read_text(encoding="utf-8")

# 1) Remove the four OPEN item blocks. Each item runs from its "### N." heading
#    to the first "\n---\n" that follows (its own trailing separator).
for n in (43, 44, 45, 46):
    pattern = re.compile(r"### " + str(n) + r"\. .*?\n---\n", re.DOTALL)
    new, count = pattern.subn("", text, count=1)
    if count != 1:
        raise SystemExit(f"expected to remove exactly one #{n} block, removed {count}")
    text = new

# 2) Concise CLOSED entries (newest first), inserted right after the CLOSED header.
closed_entries = """### C40. VeritaComp Competencies Owed derived from VeritaStaff, with gap detection (was #48)

**Closure evidence:** PR #1314 (squash 2bcb0db9). GET /api/labs/:labId/competency/owed derives each VeritaStaff testing employee's owed competencies from their assigned instruments (staff_employee_instruments -> veritamap_instruments + tests), on the CLIA timeline, and flags instruments not covered by any competency program as gaps. CompetenciesOwedSection renders it on the VeritaComp landing page. Reuses the shipped bridge + suggested-method-groups match rules; no new tables. Verified live on prod with real assignment data: 2 instruments assigned to a demo staffer produced owed=2, gaps=2 (HIGH, Technical Supervisor), then reverted cleanly. Closed 2026-09-24.

**Source:** 2026-09-23/24 session, Michael ("veritacomp bases what competencies they owe (currently untrue, but needs to be true)"). Option 1 (unify roster on VeritaStaff, match instruments by id).

---

### C39. VeritaScan line items can attach or link evidence (was #46)

**Closure evidence:** PR #1312 (squash a1dda93d). VeritaScan scan checklist items now show linked evidence as chips (open link, remove) plus a writer "Link evidence" affordance whose picker links an existing VeritaDC/Library document; a shortcut deep-links to the Library for new (governed) documents. Reuses the already-shipped lab_documents + document_checklist_links + coverage endpoints (URL-pointer only, no file storage, no new tables). Browser-verified live on prod (scan 23): the affordance renders and the picker opens. Closed 2026-09-24.

**Source:** 2026-09-23 session, Michael. Recurring request. Companion: cross-module evidence display on the VeritaDC policy shipped in PR #1313 (by-target cross-links surfaced in the policy View modal, browser-verified live).

---

### C38. VeritaTrack calendar month cells expand to reveal hidden tasks (was #45)

**Closure evidence:** VeritaTrack CalendarView month cells with more than three tasks now expand in place (chevron, "+N more" toggling to "Show less", due dates), so no task is hidden with no path to it (client/src/pages/VeritaTrackAppPage.tsx CalendarView). Shipped 2026-09-23. Closed 2026-09-24.

**Source:** 2026-09-23 session, Michael screenshot of the VeritaTrack calendar (lab 3, September cell).

---

### C37. Long Excel column headers no longer clip CFR citations (was #44)

**Closure evidence:** Verified already fixed on main during the 2026-09-24 session. The VeritaMap export derives the header row height from the longest wrapped header via headerRowHeight(headers, colWidths) (server/routes.ts:15935) instead of a fixed 20, so "Reference Range Attestation (42 CFR 493.1253)" and the other long headers print in full. No new code this session. Closed 2026-09-24.

**Source:** parked 2026-07-16 (PR 4 Gate 3 render); found already-fixed 2026-09-24.

---

### C36. License stamp no longer clobbers the §6 header/footer or names the wrong lab (was #43)

**Closure evidence:** Verified already fixed on main during the 2026-09-24 session. setHeaderFooter (shared/licenseExceljs.ts:155-209) now preserves an existing §6 header and appends (not overwrites) the footer left section, and customer-facing exports name the scoped lab: the VeritaScan library export reads req.scope.lab.name / clia_number (server/routes.ts:16572-16573), not the licensee. No new code this session (avoided regressing the existing fix). Closed 2026-09-24.

**Source:** parked 2026-07-16 (PR 4 Gate 3 render); found already-fixed 2026-09-24.

---

"""

marker = "## CLOSED (audit trail)\n\n"
idx = text.find(marker)
if idx < 0:
    raise SystemExit("CLOSED header not found")
insert_at = idx + len(marker)
text = text[:insert_at] + closed_entries + text[insert_at:]

MD.write_text(text, encoding="utf-8")
print("PARKING_LOT.md updated: moved #43,#44,#45,#46 to CLOSED; added C36-C40.")
