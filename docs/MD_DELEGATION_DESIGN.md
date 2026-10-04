# Medical Director Letter of Delegation — design (item 5)

Status: APPROVED for build (decisions locked with Michael 2026-10-03). Supersedes the earlier
free-form draft. The delegation is delivered as a signable **Letter of Delegation** document
(the CMS 209 pattern): a list of the responsibilities a laboratory director may delegate, with
yes/no toggles the Medical Director flips and then e-signs in the system. That signed letter is
both the surveyor-facing artifact and the record the access gates read, so there is no drift.

## 1. Regulatory basis (CMS Laboratory Director Responsibilities brochure; 42 CFR 493 Subpart M)

- Delegation is the **laboratory director's** act: the director "must indicate, in writing, which
  responsibilities you will delegate to personnel in these positions" (brochure p.4). The written,
  signed letter is exactly that instrument.
- Delegable responsibilities are defined **by position**: Clinical Consultant; Technical Consultant
  (moderate complexity) or Technical Supervisor (high complexity); General Supervisor (high
  complexity, a narrower set).
- The director's **core duties are non-delegable** (brochure p.3: test-system appropriateness,
  physical/environmental conditions, safety, the onsite visits, and signing/approving policies).
  These never appear as toggles.
- Brochure: https://www.cms.gov/regulations-and-guidance/legislation/clia/downloads/brochure7.pdf

## 2. Decisions (locked)

- **Signer/author:** the designated **Medical Director only** (the user whose email equals
  `labs.medical_director_email`). An account owner who is not the MD cannot author a delegation
  (it would not be the LD's act and would be surveyor-indefensible). The owner's lever is naming
  the MD, which is owner-only (shipped in PR A / PR #1441).
- **Structure:** **one Letter of Delegation per delegate** (named person + position + complexity
  scope).
- **Toggle coverage (v1):** ship the **full delegable list** grouped by position. Two line items
  are wired to live access gates (below); the rest are documented delegations with no software gate
  yet.
- **Complexity match:** **per item.** At co-sign/closure time the gate resolves the specific test's
  complexity from VeritaMap. A TS covers high and moderate (superset); a TC covers moderate only.
  A mixed-complexity item takes the highest complexity present (requires a TS). An item not tied to
  a specific test falls back to the lab's highest complexity.
- **Owner break-glass override:** allowed, **logged distinctly as "owner override"**, never recorded
  as a director attestation.
- **Home:** **VeritaStaff**, alongside CMS 209 and the position descriptions.

## 3. The toggle catalog (delegable responsibilities, by position)

Only delegable items appear. The two marked [GATE] drive live access gates in v1; the rest are
documented-only for now. The toggles a given letter shows depend on the delegate's position.

**Clinical Consultant**
- Ensure test reports include information needed to interpret results.
- Be available to consult on results and interpret them for specific patient conditions.

**Technical Consultant (moderate) / Technical Supervisor (high)** — general testing
- Select appropriate test methodology.
- Verify test method performance (accuracy and precision) before use.
- Establish and maintain the QA and QC programs.
- **[GATE] Review and co-sign the monthly QC period review** (QC program / remedial action for
  significant deviations).
- Establish and maintain acceptable analytical performance for each test system.
- **[GATE] Review and close corrective actions and inspection findings** (remedial action and
  documentation; results reported only when the system functions).

**Technical Consultant / Supervisor** — proficiency testing
- Enroll the laboratory in a CMS-approved PT program; test PT samples per CLIA; return results on
  time; ensure staff review PT reports; follow corrective action on unacceptable PT.

**Technical Consultant / Supervisor** — personnel and competency
- Ensure personnel are trained and demonstrate competency before testing patients; assure ongoing
  competency; maintain the procedures for monitoring competency in all phases; identify remedial
  training / CE needs; provide the approved procedure manual.

**General Supervisor (high complexity)**
- **[GATE] Review and close corrective actions and inspection findings** (assure results not
  reported until corrective actions are complete).
- Ensure testing personnel receive orientation and training; evaluate and document testing-personnel
  competency.

(Note: the GS may hold the finding-closure gate for high complexity, consistent with the brochure's
GS delegable set; the GS is NOT eligible for the QC period-review co-sign, which stays TC/TS.)

## 4. Data model

`director_delegations` — one row per signed letter (one delegate):

| column | notes |
|---|---|
| `id` | PK |
| `lab_id` | lab the letter applies to |
| `delegate_user_id`, `delegate_staff_employee_id` | the named delegate (from the VeritaStaff roster) |
| `position` | `clinical_consultant` \| `technical_consultant` \| `technical_supervisor` \| `general_supervisor` |
| `complexity_scope` | `moderate` \| `high` (high covers moderate) |
| `responsibilities_json` | map of toggle_key -> boolean, from the catalog in section 3 |
| `signed_by_user_id` | the designated MD who signed |
| `signed_name`, `signed_at` | typed e-signature + timestamp (null while draft) |
| `status` | `draft` \| `active` \| `revoked` \| `superseded` |
| `revoked_at`, `revoked_by_user_id`, `supersedes_id` | lifecycle |
| `created_at`, `updated_at` | standard |

Table ships with its ALTER-guard migration in the same commit. The toggle catalog is a server
constant keyed by position so the valid toggles and their gate mapping are defined in one place.

## 5. Access gates (Phase 2)

Shared helper `mayAttestAsDirectorOrDesignee(labId, userId, gateKey, complexity)`:
1. true if `userId` is the lab's designated MD.
2. else true if an `active` letter to `userId` has `gateKey` toggled on AND `complexity_scope`
   covers the item's complexity (TS covers high+moderate; TC moderate only; GS high for the
   finding-closure gate only).
3. else false.

Wired into: `POST /api/labs/:labId/qc/period-reviews/md-cosign` (gateKey `qc_period_cosign`, which
already enforces MD-only in the handler today; this adds the designee path) and
`POST /api/labs/:labId/findings/:id/signoff` (gateKey `finding_closure`). The **owner override**
path is a separate branch that records an `owner_override` marker on the co-sign/closure instead of
a director/designee attestation.

Per-item complexity source: VeritaMap complexity for the test tied to the QC control lot or the
finding; mixed -> highest; untied -> lab highest.

## 6. Artifact (Phase 1)

The signed Letter of Delegation renders to PDF on the lab's letterhead, signature block on page 1
("medical director or designee" conventions), listing the delegate, position, complexity scope, the
toggled responsibilities (checked / not checked), and the MD's e-signature and date. Mirrors the
CMS 209 generator. Retained and exportable for survey.

## 7. Lifecycle

- Auto-revoke all of a lab's active letters when the MD is re-designated (a new LD must re-delegate).
- Support annual re-signing; a re-signed letter supersedes the prior one (`supersedes_id`), keeping
  the history.
- Every create / sign / revoke writes to the lab audit log.

## 8. Build phases

1. **Phase 1 (PR B1):** `director_delegations` table + migration; the toggle catalog constant; the
   MD-only create / edit-draft / sign / revoke API; the Letter of Delegation PDF. Verify script.
2. **Phase 2 (PR B2):** the `mayAttestAsDirectorOrDesignee` gate + per-item complexity resolver,
   wired into QC co-sign and finding closure, plus the owner-override branch. Verify script +
   inventory-sweep re-check.
3. **Phase 3 (PR B3):** VeritaStaff UI — the MD's Letter-of-Delegation screen (toggles + e-sign),
   and the co-sign / closure flows showing who is authorized and why.

Each phase is its own PR with Gate-3 receipts.
