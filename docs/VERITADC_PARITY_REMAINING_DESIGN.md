# VeritaDC MediaLab-parity: remaining depth items — status + design

Parking-lot #39. Updated 2026-10-04. Owner: Michael Veri.
Status: PROPOSED (scoping) for the two unbuilt items; status correction for the rest.

## 0. Status correction (what actually shipped this session)

The parking-lot #39 body listed seven "remaining, customer-triggered" depth items
as of 2026-09-29. Four of the seven shipped THIS session (2026-10-04) and are in
the codebase on main. Verified by reading the files, not from memory:

| #39 depth item | State | Evidence |
|---|---|---|
| Per-department role mapping | SHIPPED | `policy_manual_approvers` table (db.ts), `manualApproverUserIds()` + `manualId` override wired into `canUserApproveStep`/`countEligibleReviewersForStep` (veritapolicyApproval.ts), manual-approvers dialog (VeritaPolicyMyPoliciesPage.tsx), verify-veritadc-manual-approvers.ts |
| Reviewer-phrase library | SHIPPED | `REJECT_PHRASES` + reject-phrase chips in the reject dialog (VeritaPolicyMyPoliciesPage.tsx) |
| Cross-policy linking | SHIPPED | `policy_document_links` table (db.ts), link CRUD routes (routes.ts), Related-policies section in the view dialog, verify-veritadc-cross-policy-links.ts |
| Customizable email templates | SHIPPED | `policy_email_templates` table (db.ts), template CRUD + render path (veritapolicyReminders.ts, policyReminderTemplate.ts), reminder-templates dialog (VeritaPolicyMyPoliciesPage.tsx) |
| SSO / Active Directory | SCOPED | docs/SSO_AD_DESIGN.md (Phase 1 SAML 2.0) |
| Approval delegation | OPEN | this doc, section 1 |
| In-browser DOCX editing | OPEN | this doc, section 2 |

Items 1 to 5 of the original recommended sequence (PDF watermarking, quizzes,
Excel dashboard export, auto-expire cron, print stylesheet) were already shipped
before this session. So of MediaLab's document-control depth, the only genuinely
unbuilt gaps left are **approval delegation** and **in-browser DOCX editing**.
That moves the honest sales claim close to "we replace MediaLab," not just
"we replicate the surface."

The parking-lot #39 entry should be updated to reflect this (done in the same
pass as this doc).

## 1. Approval delegation (BUILT 2026-10-04, effort M)

> Status: SHIPPED to a PR on 2026-10-04 (deploy held for operator authorization,
> Gate 2). Implemented exactly as designed below: `policy_approval_delegations`
> table + migration, `delegatorsFor` + `canUserApproveStepDelegated` +
> `countEligibleReviewersForStepDelegated` in server/veritapolicyApproval.ts (both
> laundering guards), delegate attribution on the signoff comment + audit log,
> CRUD routes, and a Delegations dialog in VeritaPolicyMyPoliciesPage.tsx. Verified
> by scripts/verify-veritadc-approval-delegation.ts (19/19) plus a full local
> browser exercise (create -> ACTIVE -> revoke) and API guard checks.
>
> **End-to-end approve-by-delegate verified 2026-10-04 (post-deploy).** On a
> throwaway lab: an in-review policy with a `specific_user` step (user 2), a
> delegation 2 -> 3, and the delegate (user 3) given an active VeritaPolicy seat.
> The delegate's `pending-step` preview returned `canApprove:true` with
> `viaDelegation {delegatorId:2, delegatorName}`; the owner control was correctly
> blocked by self-approval. `POST .../approve` as the delegate returned
> `{ok:true, status:"approved"}`; the signoff recorded
> `comment: "[Signed as delegate for Deleg QA Owner (user #2)]"` and the audit row
> carried `via_delegation:true, delegator_user_id:2`. Core value prop confirmed
> through the full HTTP stack.
>
> **Known constraint found during that test (candidate follow-up, not a
> delegation bug):** the approve/reject routes are gated by
> `requireModuleEdit('veritapolicy')`, so a delegate must have VeritaPolicy EDIT
> access (owner/admin or an active seat whose permissions resolve to `edit`) to
> actually approve; a seatless member is view-only and is 403'd at approve time.
> This is pre-existing and applies to every reviewer, not just delegates. But the
> `pending-step` preview does NOT run the module-edit check, so it can report
> `canApprove:true` to a delegate (or any reviewer) who will then be blocked at
> approve time with a "view-only access" error. Candidate polish: have
> `pending-step` reflect module-edit access (add an `editAccess` flag or fold it
> into `canCurrentUserApprove`) so the UI never offers an approve control that the
> POST will reject. Deferred as a separate small fix since it is pre-existing and
> orthogonal to delegation; flagged for Michael.


### Problem
When a reviewer who must approve a workflow step is out (vacation, leave), the
approval stalls. MediaLab lets that reviewer name a temporary designate for a
date window. We have no delegation model today.

### Design — extend the eligibility layer, do not fork it
The approval eligibility already funnels through two functions in
`server/veritapolicyApproval.ts`:
- `canUserApproveStep(sqlite, { userId, labId, documentOwnerId, stepRow, isMajorRevision?, manualId? })`
- `countEligibleReviewersForStep(...)`

Delegation is a thin additional allowance layered on top, exactly mirroring how
`manualApproverUserIds()` was added this session. A delegate inherits the
delegator's eligibility for a step during an active window; the delegate does NOT
gain any role they would not have by standing in for the delegator.

### Data model
```
CREATE TABLE policy_approval_delegations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_id INTEGER NOT NULL,
  from_user_id INTEGER NOT NULL,          -- the reviewer delegating away
  to_user_id INTEGER NOT NULL,            -- the designate standing in
  required_role TEXT,                     -- NULL = all roles the delegator holds; else scope to one role
  manual_id INTEGER,                      -- NULL = all manuals; else scope to one department/manual
  starts_on TEXT NOT NULL,                -- YYYY-MM-DD, lab-local
  ends_on TEXT NOT NULL,                  -- YYYY-MM-DD, inclusive
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
```
New-table rule: ship the matching PRAGMA table_info ALTER migration block in the
same commit (CLAUDE.md §8).

### Eligibility rule (the one subtle part)
In `canUserApproveStep`, after the self-approval guard and before returning the
final decision, add a delegation allowance:
- Resolve the set of users whose eligibility `userId` currently inherits: any
  `policy_approval_delegations` row where `to_user_id = userId`, `revoked_at IS
  NULL`, today is within `[starts_on, ends_on]`, `required_role` is NULL or equals
  the step role, and `manual_id` is NULL or equals the document's manual.
- For each such `from_user_id`, test whether THAT delegator would pass
  `canUserApproveStep` for this step. If any does, `userId` passes by delegation.
- Critical guard: the self-approval block still applies to the DELEGATOR. If the
  delegator is the document owner and self-approval is off, the delegate cannot
  launder an approval the delegator could not make. Check `from_user_id` against
  `documentOwnerId` too, not just `userId`.
- `countEligibleReviewersForStep` adds active delegates of each already-eligible
  reviewer to the count (deduped by user id), so the "enough reviewers exist"
  preflight reflects stand-ins.

### Audit + attribution
Every approval taken by delegation writes a `policy_audit_log` row recording both
the acting delegate and the delegator ("Approved by Jane Doe as delegate for John
Smith"). Surveyor-defensibility requires the chain be visible, not silent.

### UI
- A "Delegations" control in VeritaDC (My Documents area or an admin settings
  surface): create a delegation (to-user, optional role, optional manual, date
  window, note), list active/upcoming/expired, revoke.
- A reviewer can create their own outgoing delegation; owner/admin can create any.
- When a delegate opens a document they can approve only via delegation, show the
  "acting for <delegator>" banner so the attribution is obvious before they sign.

### Verify + gates
- `scripts/verify-veritadc-approval-delegation.ts`: window boundaries (day before
  start, first day, last day, day after end), role scoping, manual scoping,
  revoked rows, and the self-approval-laundering guard (delegate of a blocked
  owner stays blocked). PASS/FAIL per case, non-zero exit on failure.
- Playwright spec driving create-delegation then approve-as-delegate on prod,
  asserting the banner and the audit attribution (Gate 3 step 8).

### Effort
M. The eligibility plumbing, the per-manual pattern, and the dialog scaffolding
all exist from this session, so this is an extension, not a greenfield build.

## 2. In-browser DOCX editing (scoping only, effort L)

### Problem
MediaLab has a structured in-app editor that builds a Table of Contents from
headings; revisions happen in-browser. We treat policy documents as opaque files:
a revision is a new DOCX upload. This is the single largest remaining gap and the
hardest to do well.

### Why this is an L, not an M
- A faithful DOCX round-trip (open .docx, edit, save .docx without mangling
  styles, numbering, tables, headers/footers) is a hard problem. Naive
  HTML-to-DOCX loses fidelity, which in a document-control system is a
  surveyor-facing defect, not a cosmetic one.
- It intersects the existing versioning model (`policy_versions`, file storage at
  `<lab_id>/<document_id>/v<n>/document.<ext>`) and the major-revision MD-only
  approval routing. An in-app edit must mint a new version through the same
  controlled path, not bypass it.
- The watermark/download stamping (server/veritapolicyDocx.ts) and the DOCX
  download contract must keep working on editor-produced files.

### Candidate approaches (decide at build time, not now)
1. **Structured section editor, not a DOCX WYSIWYG.** Model a policy as ordered
   sections (heading + rich-text body) in our own schema; render to DOCX on
   download with the existing generator; derive the ToC from the section
   headings. Highest control, cleanest versioning, but existing uploaded DOCX
   files do not import into it automatically (import is a separate sub-project).
   Recommended direction if we build.
2. **Embed a third-party DOCX editor** (e.g. an OnlyOffice/Collabora document
   server, or a commercial SDK). Fast fidelity, but adds a heavy service
   dependency, licensing cost, and a security surface that needs its own review.
   Likely overkill for policy-length documents.
3. **Rich-text (HTML) editor with DOCX export.** Lowest effort, worst fidelity on
   round-trip; acceptable only if we accept that in-app-edited docs are reflowed,
   not byte-faithful to an original Word file.

### Recommendation
If taken up, build approach 1 (structured section editor) scoped to NEW policies
authored in-app, keep upload-a-DOCX as the path for externally authored
documents, and treat "import an existing DOCX into the structured editor" as a
later, separate effort. Do not promise MediaLab-identical Word editing; promise
in-app authoring with a generated ToC and controlled versioning. This is a
multi-week build and should not start without a prospect actually asking for it.

## 3. Build vs hold — needs Michael

Both remaining items are marked "customer-triggered" in the parking lot
("re-open a scoped sub-item only when a prospect asks"). No prospect has asked for
either as of 2026-10-04. So the decision is yours:

- **Approval delegation:** ready-to-build M, extends plumbing already in place.
  Lowest-risk of the two, real survey-defensibility value, and it is the kind of
  depth Lifepoint/Sanford IT and quality reviewers probe. Build-on-your-go.
- **In-browser DOCX editing:** multi-week L with real fidelity risk. Hold until a
  prospect names it as a blocker; then build approach 1.

I did not speculatively build either, because the parking lot gates them to a
prospect ask and a rushed multi-feature build plus deploy in one pass is exactly
the failure mode the gates exist to prevent. Say the word on delegation and it is
a clean next PR.
