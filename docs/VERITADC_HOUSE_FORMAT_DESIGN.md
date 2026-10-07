# VeritaDC per-lab house DOCX format (parking lot #71)

Status: BUILT 2026-10-07 on Michael's option 1 (see "Decisions" at the end). First instance: UMass Milford (labs 4 and 5, Lisa's). Source: Lisa's "this is our current policy format" sample, `Gen 31 Dress code policy Rev 07-25.docx` (forwarded 2026-10-06, `Fw_ Policies.eml`).

**This is a standing VLS service, not a one-off** (Michael, 2026-10-07): any client can email a draft policy or a policy-on-policies and we move the stock policies onto their letterhead and format. SCAHC was the first instance (pre-uploaded per-policy artifacts in `veritapolicy_lab_artifacts`, served artifact-first). Milford is the first renderer-based instance; the next client's format is one renderer module plus one setting.

## How it works (as built)
- `veritapolicy_settings.docx_format` (`veritadc` default, `umass_milford`), `house_facility_path`, `house_safety_default`; `veritapolicy_house_numbers (lab_id, policy_id, house_number, revision)`.
- `POST /api/admin/veritapolicy/set-house-format {secret, labId, format, facilityPath?, safetyDefault?, numbers?: [{policyId, houseNumber, revision}], dryRun?}`: WE switch a lab on after converting its sample; audited; no customer-facing picker.
- `server/veritapolicyHouseFormats.ts`: `buildUmassMilfordDocument` (registry entry); `generatePolicyDocxBuffer(..., house)` dispatches; both DOCX download routes (single and bundle.zip) read the lab's setting. Artifact-first still wins when a lab has a pre-uploaded custom DOCX for a policy.
- Receipt: `tests/integration/veritadc-house-format.test.ts` (real routes, 20 checks).

To switch Milford on: `set-house-format` for labs 4 and 5 with `format: "umass_milford"`, `facilityPath: "MRMC/Laboratory/General"` (or whatever Lisa confirms), `safetyDefault` = her cross-reference sentence, and `numbers` as her team supplies them. That call is Michael's go, after Lisa confirms the facility path and the first numbers.

## What the house format is (extracted 2026-10-06 13:21)

- Roman-numeral sections, in this order: **I. Purpose**, **II. Policy**, **III. Guidelines**, **IV. Personal Safety Requirements**, **V. References**.
- A **Revision History** table (revision, date, description, author).
- A footer carrying the **facility path**, the **policy number** (the "Gen 31" style house number), the **revision date**, and the page number.

## What VeritaDC renders today (server/veritapolicyDocx.ts)

`generatePolicyDocxBuffer(policyId, lab, crosswalk, opts)` builds one fixed layout from a `PolicyTemplate` (`purpose`, `scope`, `policy_statements[]`, `procedure_steps[]`, `definitions[]`, `cfr_text_blocks[]`) with the lab name + CLIA in the header and the `VeritaAssure | VeritaDC | Confidential | Page X of Y` footer, plus the optional UNCONTROLLED watermark and the "Downloaded by" provenance line. Both download routes (`routes.ts` ~35454 and ~35603) call it directly. There is no per-lab format choice anywhere.

## Design

### 1. A per-lab format setting (not a per-policy one)
- `veritapolicy_settings` gains `docx_format TEXT NOT NULL DEFAULT 'veritadc'` (allowlist: `veritadc`, `umass_milford`), `facility_path TEXT` (the footer path, e.g. "UMass Memorial Health - Milford Regional / Laboratory"), and `policy_number_prefix TEXT` (optional default prefix for house numbers). PRAGMA/ALTER migration block in `db.ts`, same pattern as every other column.
- `veritapolicy_lab_policies` gains `house_policy_number TEXT` (per policy, e.g. "Gen 31") and `house_revision TEXT` (e.g. "Rev 07-25"). Both lab-entered, never generated: the numbering is Lisa's scheme, not ours.
- VeritaDC Settings tab: a "Document format" selector (VeritaDC standard / UMass Milford house format) plus the facility path field; the per-policy number and revision fields appear on the policy detail panel only when the lab is on a house format.

### 2. A format registry in the generator
- `veritapolicyDocx.ts` keeps `buildDocument` as the `veritadc` renderer and adds `buildUmassMilfordDocument(tmpl, lab, crosswalk, opts, house)` where `house = { facilityPath, policyNumber, revision, revisionHistory[] }`.
- Section mapping from the existing template fields:
  - I. Purpose: `tmpl.purpose` (+ `scope` as a second paragraph when present).
  - II. Policy: `policy_statements[]`, numbered.
  - III. Guidelines: `procedure_steps[]`, numbered; `definitions[]` as a lead-in list when present.
  - IV. Personal Safety Requirements: NEW optional template field `safety_requirements?: string[]`. When a template has none, the section renders a single bracketed prompt "[Enter the personal safety requirements that apply to this procedure]" so the draft never silently invents safety content. Michael decides whether the 96 built-in templates get authored safety text (see decisions).
  - V. References: the CFR citations from `cfr_text_blocks` (citation + label) and the accreditor crosswalk lines (TJC / CAP / COLA / AABB) the lab has enabled.
- Revision History table: first row from the lab's stored `house_revision` (or "Rev 1, <draft date>, Initial VeritaDC draft, <downloading user>") and subsequent rows from the policy's revision records (the major-revision log already captured by VeritaDC).
- Footer: `{facility_path}  |  {house_policy_number}  |  {house_revision}  |  Page X of Y`. The VeritaAssure provenance stays in document properties (`creator`, `description: Generated by VeritaPolicy`) and in the optional "Downloaded by" line, not in the house footer. The UNCONTROLLED watermark option keeps working in both formats.
- Header: lab name + CLIA stays (it is an identity layer, and it does not conflict with the sample).

### 3. Routing
- Both download routes read the lab's `docx_format` and dispatch to the registry. Default `veritadc` means zero change for every other lab.

### 4. Receipts
- Unit receipt `tests/integration/veritadc-house-format.test.ts`: render one built-in policy for a lab set to `umass_milford` with a house number, unzip the DOCX, assert the five section headings in order, the Revision History table, and the footer string; render the same policy for a `veritadc` lab and assert the current footer is unchanged (regression).
- Gate 3 step 8: Playwright download of a draft on a local build with the setting toggled, open the DOCX text, same assertions.
- Copy rules apply to the rendered text (no em dashes, TM marks, www URL).

### 5. Effort
- M: about a day of build plus the receipts. The generator work is the bulk; the settings UI is small.

## Decisions (Michael, 2026-10-07, option 1)

1. **IV. Personal Safety Requirements.** Her sample's own convention is a cross-reference ("Please refer to our lab safety policy: Personal Protective Equipment & General Safety Requirements."). That sentence is stored once per lab (`house_safety_default`) and rendered in every draft; a lab with none gets a bracketed prompt, never invented safety language.
2. **House numbering.** Entered by Lisa's team (per policy, via the admin endpoint today), never generated. Until a number exists the draft shows "Policy No.: ________".
3. **Footer provenance.** No vendor line in the house footer. Provenance stays in the document properties ("Generated by VeritaPolicy (house format: UMass Milford)") and the optional "Downloaded by" line.
4. **Scope.** Per-lab setting switched on by us; labs 4 and 5 first. The mechanism is general (any client's format is the next registry entry), there is no customer-facing picker.
