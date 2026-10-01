# System / Organization Entity: Design and Build Plan

Status: APPROVED (COA D, phased hybrid). Decided by Michael Veri on 2026-09-30.
Owner: main agent (engineering). Scope: design and build plan only. No schema or
code changes ship under this document without a per-phase PR and the usual gates.

This document is the contract for turning the current implicit "owner-as-system"
model into a first-class System (Organization) entity, without disrupting the
existing single-lab customers or the paying multi-lab systems already live.

---

## 1. Why this exists

We are pursuing hospital-system deals (Lifepoint, Sanford Health, USON, Forrest
General) where one customer owns many labs. Michael's directive: "Whatever we
build, it needs to be robust because it will be the bulk of our business model."

Today a "system" is not a modeled thing. It is an emergent side effect of several
labs sharing one `owner_user_id`. That works for shipping now, but the invariant
that a system's seats, roles, and billing live in one place is enforced only by
the accident that all the labs point at the same person's account. Nothing in the
schema guarantees it, and there is nowhere to hang system-level concepts (org
roles, org billing, SSO, batch provisioning). This document fixes that
deliberately, in reversible layers.

---

## 2. Current model (verified in code)

A system = labs that share one `owner_user_id`. Three tables carry the behavior.

### 2.1 Tables

- **`users`** carries the seat pool and the tier:
  - `plan` (tier archetype) and `seat_count` (explicit active-seat cap override).
- **`labs`** carries ownership plus per-lab structural flags:
  - `owner_user_id` (the account that owns and pays for this lab)
  - `plan`, `subscription_*`, `clia_number`
  - `is_repository` (shared document/policy library lab, excluded from the
    readiness roll-up) — `server/db.ts:2149`
  - `parent_warehouse_lab_id` (nullable self-FK, VeritaStock warehouse/location
    hierarchy only, NOT a general system link) — `server/db.ts:2208`
  - `medical_director_email` / `medical_director_name` (director designation,
    stored by email so a pending invite can be named) — `server/db.ts:2221`
  - `is_trial`, `is_demo`, `primary_regime` (CLIA vs NYS-CLEP)
- **`lab_members`**: `lab_id`, `user_id`, `role` (owner | admin | staff),
  `is_primary_lab`, `permissions_json`, `status`. This is per-lab membership.
- **`user_seats`**: `owner_user_id`, `seat_email`, `seat_user_id`, `lab_id`,
  `seat_type` (active | staff_portal), `status`, `invite_token`. This is the
  seat ledger, keyed by the OWNER, not by the lab.

### 2.2 The seat invariant (the load-bearing logic)

Canonical example at `server/routes.ts:9778-9805`:

- Cap = `Math.max(users.seat_count, PLAN_SEATS[ownerPlan])`.
- `PLAN_SEATS` (`server/db.ts:2356`): clinic 2, community 5, hospital 15,
  enterprise 25, large_hospital 25, lab 25.
- Count = `SELECT ... FROM user_seats WHERE owner_user_id = ? AND status !=
  'deactivated'` — summed across ALL of that owner's labs, plus the owner
  themselves (owner counts as one active seat).
- Designated medical directors across the owner's labs sit on a FREE seat and do
  not count against the active cap.

The same `PLAN_SEATS[ownerPlan]` cap formula recurs at `server/routes.ts:9940`,
`:28137`, and `:30663`. Any change to how the cap is derived must touch every
one of those sites, which is exactly why Phase 2 is isolated and tested.

Consequence: seats ALREADY pool at the owner level. There is no per-lab cap. One
owner over eight labs = a single pooled cap today, with no new code. This is why
we can build Forrest and Lifepoint on the current model right now.

### 2.3 Staff Portal band (honor system)

`STAFF_PORTAL_BANDS` (`server/stripe.ts:84`): small up to 25 staff ($149/yr),
medium up to 100 ($399/yr), large up to 250 ($799/yr). Above 250 routes to a
System-tier custom quote. There is no hard staff-count enforcement field; it is
honor-system at current scale (CLAUDE.md §10).

### 2.4 Provisioning and oversight

- `POST /api/admin/provision-owner-lab` (net-new owner + comped lab, owner sets
  own password via a reset-token link) — built 2026-09-30 for Angela Cedeno.
- `POST /api/admin/provision-comp-lab` (existing userId + `is_primary_lab`).
- `POST /api/labs/:labId/members` (per-lab member invite; MD is a first-class
  role as of PR #1372).
- Oversight = the lab switcher (labs where you are a member) plus the readiness
  roll-up / network command center, which groups the owner's labs. `is_repository`
  labs are excluded from that roll-up (PR #1329).

### 2.5 What is missing

- No `organizations` table. No org-level identity, roles, billing, or SSO.
- The single-owner invariant is unenforced. If a member lab is ever created or
  transferred under a different owner, its seats silently stop pooling and it
  drops out of the system view. This is the San Carlos siloing shape.
- Total key-person risk: the system lives inside one person's user account.
- Provisioning is per-lab and manual. No "stand up a system of N labs" primitive.
- Billing is per-lab subscriptions, not one system invoice.

---

## 3. Design goals

1. A first-class System (Organization) object that owns membership, seats, roles,
   and billing.
2. Backward compatible: standalone single-lab customers (the majority today) are
   untouched. A lab with no organization behaves exactly as it does now.
3. Incremental and reversible: never a big-bang rewrite of the seat gate. Each
   phase ships and can be rolled back on its own.
4. A safe, idempotent, dry-runnable migration for the systems that already exist
   implicitly (San Carlos, Gameday labs 19/29/30, Heywood, Lifepoint/Angela).

---

## 4. Target design

### 4.1 New table: `organizations`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | INTEGER PK | |
| `name` | TEXT | System display name (for example, "Lifepoint Health") |
| `billing_owner_user_id` | INTEGER FK users | Primary contact / billing account. Replaces the implicit "shared owner" |
| `plan` | TEXT | System tier archetype |
| `active_seat_pool` | INTEGER | The pooled active-seat cap (source of truth once Phase 2 lands) |
| `staff_seat_band` | TEXT | small / medium / large / custom |
| `subscription_status` | TEXT | One subscription for the whole system |
| `subscription_expires_at` | TEXT | |
| `stripe_customer_id` | TEXT | |
| `stripe_subscription_id` | TEXT | |
| `created_at` / `updated_at` | TEXT | |

### 4.2 New column: `labs.organization_id`

Nullable FK to `organizations.id`.
- `NULL` = standalone lab. Behaves exactly as today. This is the entire
  backward-compatibility guarantee.
- Non-null = member of that system.

Added with an ALTER migration block (PRAGMA table_info pattern, CLAUDE.md §8 NEW
DB TABLE RULE), no backfill, no cascading writes.

### 4.3 New table: `organization_members`

`org_id`, `user_id`, `org_role`, `status`, `created_at`.

`org_role` values: `org_owner`, `org_admin`, `system_reviewer` (read across all
member labs), extensible. An org role grants access across EVERY member lab, so
"one QA director over all eight labs" is a single row, not eight per-lab rows.

### 4.4 Behavior changes (all gated on `organization_id` being set)

- **Seat gate becomes dual-path.** If a lab has `organization_id`, cap and count
  resolve at the org (`organizations.active_seat_pool`, `user_seats` counted by
  org membership). If `organization_id` is NULL, the current owner-level path is
  used, unchanged. Applies at all four cap sites in §2.2.
- **Roles resolve via org OR lab.** Access checks (for example
  `canManageLabMembers`) accept an `organization_members` role spanning the
  system in addition to the per-lab `lab_members` role.
- **Roll-up and switcher group by `organization_id`** when present, else by
  `owner_user_id` as today. `is_repository` exclusion is unchanged.
- **Billing** is one subscription on the organization.
- **Repository lab** is an `is_repository` lab whose `organization_id` points at
  the system (shared library across the system).

---

## 5. Courses of action considered

### COA A: Do nothing (owner-as-system forever)
- Advantages: zero work.
- Disadvantages: the §2.5 failure modes become load-bearing at 70+ labs. Silent
  seat siloing, key-person risk, no org roles, manual per-lab billing. Not viable
  if systems are the bulk of the business.

### COA B: Harden the convention, no schema change
Add a guard that all of a system's labs share one owner; add a thin "system view"
grouped by owner.
- Advantages: cheap, low risk, ships in a day.
- Disadvantages: does not fix roles, billing, or key-person risk. Still nowhere
  to hang org concepts. Buys time, not a foundation.

### COA C: Full System entity, big-bang
Build `organizations` plus org seats/roles/billing and migrate everything at once.
- Advantages: cleanest end state fastest.
- Disadvantages: highest risk. Touches the seat gate (every customer's invites)
  and migrates live paying systems in one shot. Wrong bet under deal pressure.

### COA D: Phased hybrid (SELECTED)
Build the org entity in reversible layers. Ship the risky seat-gate change only
after the entity is proven as a pure grouping.
- Advantages: each phase is shippable, reversible, and low blast radius. Land
  Forrest/Lifepoint on today's model and backfill the org underneath the same
  labs with no re-provisioning. The one load-bearing change (seat gate) is
  isolated and gated behind `organization_id`.
- Disadvantages: more total calendar time than a big-bang, and a dual-path seat
  gate is carried during the transition.

---

## 6. Decision and rationale

**Selected: COA D.**

The seat gate is load-bearing on every paying customer, and "the bulk of the
business" cannot tolerate a botched migration. Phasing lets us (1) protect the
invariant immediately, (2) introduce the real entity as a pure grouping first
with no behavior change, so if the model is wrong we simply do not use it, (3)
move the risky seat and role logic only when the entity is proven and tested, and
(4) never block a deal, because Forrest and Lifepoint build on today's owner model
and get upgraded into an org row later with zero re-provisioning.

COA C is faster on paper but bets existing revenue on one migration. COA B does
not actually solve the problem. COA A is a dead end for a systems business.

---

## 7. Build plan (phased)

Each phase is its own PR (or small set of PRs), with the standard gates: TASK /
PLAN / Self-check commit keys, ALTER migration blocks for any new table or column,
a `scripts/verify-*.js` receipt where logic branches, and Gate 3 verification for
anything customer-facing.

### Phase 0: Guard the invariant (cheap insurance, ~hours)
- Add a guard in the ownership-transfer and lab-create paths so a system's labs
  cannot silently drift to a second owner.
- Ship `scripts/verify-system-ownership.mjs`: report labs grouped by owner and
  flag any implicit system whose member labs sit under more than one owner (this
  detects the current San Carlos siloing).
- No schema change. Fully reversible.

### Phase 1: Introduce the entity as a pure grouping (~days)
- `organizations` table + `labs.organization_id` in `server/db.ts` with proper
  ALTER migration blocks (watch the known fresh-boot schema-gap issue; validate a
  clean-room boot).
- `organization_members` table.
- Group the readiness roll-up and the lab switcher by `organization_id` when set,
  else by `owner_user_id` (no behavior change for standalone labs).
- Migration endpoint `POST /api/admin/organizations/backfill` (ADMIN_SECRET-gated,
  `dryRun` supported): idempotently create one org row per existing implicit
  system and link its member labs by setting `organization_id`.
- Seats, roles, and billing are UNCHANGED in this phase. The entity is read-only
  grouping. If the model is wrong, we do not consume it. Fully reversible.

### Phase 2: Move seats and roles to the org (~1-2 weeks)
- Dual-path seat gate at all four cap sites (§2.2): org-level when
  `organization_id` is set, owner-level otherwise.
- `organization_members` roles honored by access checks
  (`canManageLabMembers` and peers).
- `organizations.active_seat_pool` becomes the source of truth for org-linked
  labs.
- Extensive tests against Mike/Gameday, San Carlos, and Heywood snapshots BEFORE
  cutover. Migrate seat pools org-ward one system at a time. Standalone labs
  literally unchanged (the `organization_id IS NULL` branch is the current code).

### Phase 3: Org billing and batch provisioning (~1-2 weeks)
- One subscription / renewal object on the organization.
- `POST /api/admin/provision-system` batch primitive: stand up a system with N
  labs plus a repository lab plus the seat pool in one call, replacing the
  per-lab manual sequence for systems.
- Retire per-lab provisioning FOR SYSTEMS (single-lab provisioning stays).

---

## 8. Migration of existing implicit systems

Handled by the Phase 1 backfill endpoint, idempotent and dry-runnable, one system
at a time with a per-system verify.

CORRECTION (Phase 0 audit, 2026-09-30): the earlier draft named San Carlos as the
siloing-risk case. The live audit showed the opposite.

- **San Carlos** (SCAHC, owner #37, labs 2 and 6) is CLEAN at the ownership
  level: both labs sit under one owner. It is the clean multi-lab case, not the
  risk case. Backfilled as org#3.
- **Gameday** (Mike Hiltunen, owner #66, labs 19/29/30) is where the real drift
  was: three of Mike's seats on his own labs were parented to a different owner
  (the seat-pool-drift shape). Phase 0 deactivated those vestigial self-seats,
  so the ownership audit now reads zero orphans. Backfilled as org#1.
- **UMass Milford** (owner #33, labs 4/5) backfilled as org#2; **US Oncology
  Network (Demo)** (owner #69, labs 25-28, all `is_demo`) backfilled as org#4 as
  a safe test case for the roll-up/switcher grouping.
- **Heywood** (2 labs, verbal yes) and **Lifepoint / Angela** (Raleigh General,
  with a repository lab) will validate the repository-lab-in-an-org path when
  they sign.

Deferred guard (from Phase 0): the transfer-ownership and lab-create guard was
deferred because, before the entity existed, there was nothing to protect (the
transfer route already re-parents seats atomically). Now that `organizations`
exists, the guard has a concrete meaning for Phase 2: a lab with an
`organization_id` cannot be transferred to an owner outside the org without the
org link moving too. Implement it alongside the Phase 2 seat/role move.

Note: Gameday labs are REAL client data. No fabricated writes during migration
(CLAUDE.md §8 DATA PROVENANCE RULE). Migration only sets `organization_id` and
creates org rows; it never touches measurement data.

---

## 9. Risks and mitigations

- **Seat-gate blast radius.** Dual-path (org vs owner); standalone labs are the
  unchanged current branch; ship behind `organization_id` only; snapshot-based
  tests at all four cap sites before cutover.
- **Migrating live systems.** Idempotent + dry-run + per-system verify; never
  migrate all systems at once.
- **Fresh-boot schema incompleteness** (known issue). Every new column and table
  gets its ALTER migration block in the same commit; validate a clean-room boot
  before merge.
- **Breaking single-lab customers.** The `organization_id IS NULL` path is the
  literal current code. If a phase touches that path, it is a bug.
- **Scope creep under deal pressure.** Phases 0 and 1 are safe to start anytime.
  Phase 2 is the only one that needs a deliberate, low-traffic window.

---

## 10. Two-track framing

- **Track 1 (now):** ship Forrest, Lifepoint, Sanford, and USON on the current
  owner-as-system model. Seats already pool at the owner level, so one master
  owner over the member labs plus an `is_repository` repository lab works today
  with no new code.
- **Track 2 (deliberate):** build this entity in the phases above with the coding
  agent, not rushed under a deal deadline. When a system is later linked to an org
  row, its existing labs are reused in place with zero re-provisioning.

---

## 11. Open decisions (for Michael, not blocking Phase 0/1)

1. **Org role taxonomy.** Confirm the initial `org_role` set: `org_owner`,
   `org_admin`, `system_reviewer`. Add more later as customers ask.
2. **Billing model in Phase 3.** One system invoice vs per-lab line items rolled
   into one subscription. Leans toward one invoice with per-lab line items for
   the customer's own cost allocation.
3. **SSO.** In or out of scope for the first systems. Likely a later phase once a
   customer requires it in writing (System-tier trigger per CLAUDE.md §10).

---

## Appendix: verified code references (as of 2026-09-30)

- `server/db.ts:2356` — `PLAN_SEATS` (clinic 2, community 5, hospital 15,
  enterprise 25, large_hospital 25, lab 25).
- `server/db.ts:2149` — `is_repository` (excluded from readiness roll-up).
- `server/db.ts:2208` — `parent_warehouse_lab_id` (VeritaStock hierarchy only).
- `server/db.ts:2221` / `:2222` — `medical_director_email` / `_name`.
- `server/routes.ts:9778-9805` — canonical seat cap + owner-wide count logic.
- `server/routes.ts:9940`, `:28137`, `:30663` — the same `PLAN_SEATS[plan]` cap
  formula recurs; all must change together in Phase 2.
- `server/stripe.ts:84` — `STAFF_PORTAL_BANDS` (small 25/$149, medium 100/$399,
  large 250/$799; above 250 = System-tier quote).
- `POST /api/admin/provision-owner-lab`, `POST /api/admin/provision-comp-lab`,
  `POST /api/labs/:labId/members` — current provisioning and membership endpoints.
