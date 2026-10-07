# In-app Getting Started (parking lot #72)

Status: DESIGN for Michael's review, 2026-10-07. Nothing built yet. Follows the public page shipped in PR #1480 (`/resources/getting-started`); Michael: "Love it being built into the system."

## Single source of truth already exists

`client/src/lib/gettingStartedContent.ts` holds `SYSTEM_PHASES` (6 phases, 19 steps, each `{ task, who }`) and `MODULE_GUIDES` (18 modules, 3 steps each). The public page renders it. The in-app version reads the same arrays, so the handout and the in-app checklist cannot drift. The work is adding **live state** to each step and two surfaces to show it.

## Design

### 1. Progress is derived, not stored (with a small escape hatch)
`GET /api/labs/:labId/getting-started` returns `{ phases: [{ title, steps: [{ key, task, who, status: 'done' | 'todo' | 'manual', detail, href }] }], modules: [...], percent }`. Each step carries a stable `key` added to the content file (e.g. `p1.profile`, `p2.map.instruments`). Status is computed from the lab's real tables, read-only, no writes:

| Step | Derived from |
|---|---|
| P1 profile complete | `users.name`, `title`, `analyst_initials` for the signed-in user |
| P1 HIPAA acknowledgment | `users.hipaa_acknowledged_at` |
| P1 lab identity | `labs.name`, `clia_number`, address fields present |
| P1 users and seats | `lab_members` for the lab > 1 or any issued seat |
| P1 medical director designated | the medical director designation record for the lab |
| P2 VeritaMap instruments + complexity | at least one map with an instrument, and every `veritamap_instrument_tests` row has a complexity |
| P2 reference ranges / AMR / critical values | any `veritamap_analyte_values` or `veritamap_amr_values` row with a value |
| P2 VeritaStaff roster + assignments | `staff_employees` active > 0 and `staff_employee_instruments` > 0 |
| P3 first VeritaCheck study + PDF | `studies` for the lab > 0; PDF generated if a pdf token was claimed for one of them (or `manual`) |
| P3 competency assessed | `competency_assessments` > 0 with evaluator sign-off |
| P3 policy assigned for read-and-sign | `veritapolicy_lab_policies` with an assignment |
| P3 QC entered + co-signed | `qc_results` > 0; co-sign present |
| P3 PT enrolled + VeritaTrack scheduled | `pt_enrollments_v2` > 0 and `veritatrack_tasks` > 0 |
| P4 inventory | `inventory_items` > 0 |
| P4 schedule / CPRT | a VeritaShift schedule or a CPRT study |
| P5 key PDFs reviewed | `manual` (owner ticks it) |
| P5 Inspection Readiness viewed | `manual` |
| P6 recurring cycles set | policy review interval set, competency cadence configured, PT calendar populated |
| P6 Staff Portal invites | staff seats issued > 0 |

`manual` steps are the only stored state: `lab_onboarding_checks (lab_id, step_key, checked_by_user_id, checked_at)` with a PRAGMA/ALTER migration block. Everything else recomputes on every read, so a lab that deletes its only map goes back to "todo" honestly.

### 2. Two surfaces, one component
- **Dashboard card** "Getting started: N of 19 done" with the six phases collapsed, each step a checkmark or a "Go" link to the module route (`href` from the API, lab-scoped `/labs/:labId/...`). Owner/admin can collapse it; it hides itself at 100 percent with a "Show again" link in the account menu. Per-lab dismissal lives in `lab_onboarding_checks` under the key `card.dismissed`, not in localStorage, so it is the same for every admin.
- **Module how-to cards** (`ModuleHowToCard`, already on every module page): the three `MODULE_GUIDES` steps for that module render under the video with live checkmarks from the same endpoint, filtered to that module. Zero new copy; the public page and the card read the same strings.

### 3. Access
- Read: any lab member. Manual ticks: owner/admin (`requireModuleEdit` is not the right gate; use the lab role). Staff Portal accounts never see the card.

### 4. Receipts
- Integration test: provision a scratch lab, assert percent 0 and every derived step `todo`; add a map + instrument + staff + assignment through the real routes, assert those steps flip to `done` and percent moves; tick a manual step, assert it persists and another lab cannot read it.
- Gate 3 step 8: Playwright on a local build, dashboard card renders with the right count, clicking "Go" lands on the module, ticking a manual step updates the count.

### 5. Effort
- M: the derivation table is the bulk (18 queries, each small); UI is one component used twice. About two days with receipts.

## Decisions needed from Michael

1. **Placement**: dashboard card plus module cards (my rec), or a dedicated `/labs/:labId/getting-started` page only.
2. **Auto-hide at 100 percent** (my rec) or stay visible as a permanent health strip.
3. **Which steps stay manual**: the two in Phase 5 are the only ones with no honest data signal; confirm, or drop them from the in-app list.
4. **Multi-lab systems**: show the card per lab (my rec, since the state is per lab) or roll it up on the network overview as well.
