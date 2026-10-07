# In-app Getting Started (parking lot #72)

Status: Phase A BUILT 2026-10-07 on Michael's option 1 (dashboard card, derived state, manual Phase-5 ticks, auto-hide at 100 percent, per-lab). Phase B BUILT 2026-10-07 (parking lot #79): `ModuleHowToCard` reads the same endpoint and shows a "Your progress" block with live done / to-do marks on the system steps mapped to the module in `MODULE_STEP_KEYS` (shared/gettingStartedContent.ts); modules with no derived step show no block. Receipt: `tests/playwright/module-howto-progress.spec.ts` (in the CI sandbox receipts list). Follows the public page shipped in PR #1480 (`/resources/getting-started`); Michael: "Love it being built into the system."

## As built (Phase A)
- Content moved to `shared/gettingStartedContent.ts` (the client file re-exports it); each system step carries a stable `key`, a `kind` (derived or manual) and a lab-scoped `route`.
- `server/gettingStarted.ts`: `computeGettingStarted(sqlite, labId, userId)` scores the 19 steps from the lab's real tables (table scoping by lab_id, account_id or the owner's user_id, checked against the live schema so nothing throws); `setGettingStartedCheck` writes only the manual keys to `lab_onboarding_checks` (new table, migration sentinel).
- Routes: `GET /api/labs/:labId/getting-started` (any member), `POST /api/labs/:labId/getting-started/check {key, checked}` (owner/admin; manual keys only, 400 otherwise).
- `client/src/components/GettingStartedCard.tsx` on the lab dashboard: "Getting started: N of 19 done", progress bar, phases collapsible with the first incomplete phase open, done steps struck through with the detail line, Go links into the module, Phase-5 checkboxes, dismiss (stored per lab) with a one-line "Show getting started" link; hides itself at 100 percent.
- Receipts: `tests/integration/getting-started.test.ts` (19 checks, real routes) and `tests/playwright/getting-started-card.spec.ts` (card renders, tick changes the count, Go link lands in the lab, dismiss/show).

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

## Decisions (Michael, 2026-10-07, option 1)

1. **Placement**: dashboard card now (Phase A); live checkmarks on the module how-to cards as Phase B.
2. **Auto-hide at 100 percent**: yes, with a one-line "Show getting started" link.
3. **Manual steps**: the two Phase-5 steps stay manual ticks (owner/admin).
4. **Multi-lab systems**: per lab; a network roll-up is not in scope.
