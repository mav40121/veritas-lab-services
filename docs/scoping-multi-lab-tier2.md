# Scoping: Multi-Lab Tier 2 — Lab as a First-Class Entity

**Status.** Pre-build scoping doc. No code on the Tier 2 cut ships until the operator approves this scope.
**Source.** Parking-lot items #11 (multi-lab pricing decision) and #12 (primary-lab seat counting), 2026-05-07. Re-opened 2026-05-15 when the Pfizer-studies seed (PR #131 → #132) exposed the email-as-lab-key brittleness in code.
**Author.** Claude Code, 2026-05-15. Builds on the already-shipped `labs` table + `users.lab_id` migration in `server/db.ts` lines 1141-1260.

Tier 2 is the data-layer cut for one user belonging to many labs. Tier 1 (the `labs` table + backfill of CLIA / lab name / accreditation flags off the user row) has already shipped. Tier 2 is what unlocks "Daniela has a seat on Michael's lab AND her own Pfizer lab", "Lisa Veri runs Milford and a second lab on different subscriptions", and "one operator email can own multiple labs without the seed/admin code silently picking the wrong row".

---

## 1. Goal in one sentence

Make `labs` the data-routing identity for every scoped table and let one authenticated user select which lab they are currently working in, so the same email can own and switch between multiple labs without the codebase guessing which lab a row belongs to.

## 2. Why now

- **Pfizer / Daniela handoff is the first real cross-org case.** Her email is `daniela.rivera@pfizer.com`; today she is a seat on Michael's lab. If Pfizer ever signs its own VeritaAssure subscription, she needs to belong to both labs with independent role and permissions.
- **The seed canary.** PR #131 used `WHERE email = OWNER_EMAIL` to find Michael's lab. Today there is one user with that email so it resolved correctly, but the moment a second lab signs up under the same email the seed silently lands rows on the wrong lab. PR #132 fixed the seed by switching to CLIA; every other `WHERE user_id = ?` data query in the codebase carries the same latent bug.
- **Enterprise tier is the priciest plan ($2,999/yr, 25 seats).** Multi-lab is its differentiator. Without Tier 2 the operator cannot honestly sell "one operator account, multiple labs, separate subscriptions" — which is exactly what #11 records as the pricing model.
- **Lock semantics already shipped.** `labs.clia_locked` and `labs.lab_name_locked` exist (db.ts:1155-1156) and the Account Settings UI shows "Locked - contact support to change". That UX is built on the assumption that the lab is a separate entity from the user. Tier 2 finishes that work.

## 3. Current state (what is already done)

Shipped (do not rebuild):

- `labs` table — id, clia_number UNIQUE, lab_name, accreditation_cap/tjc/cola/aabb, clia_locked, lab_name_locked, owner_user_id, created_at, updated_at. Defined in db.ts:1141-1162.
- `lab_audit_log` table for CLIA / name / accreditation change history. db.ts:1166-1181.
- `users.lab_id` nullable FK to `labs.id`. db.ts:1183-1186.
- Idempotent backfill on every server startup: each user with a populated `clia_number` or `clia_lab_name` gets a labs row and `users.lab_id` is pointed at it. Seat users inherit owner's lab_id. db.ts:1188-1260.
- Pricing decision recorded (parking-lot #11): each lab = independent Stripe subscription, full tier price, no published multi-lab discount.
- Seat-counting decision recorded (parking-lot #12): owner burns one paid seat on the primary lab, is a free implicit seat on every secondary lab they own.

Not yet built:

- Many-to-many user↔lab membership (current `users.lab_id` is 1:1).
- Active-lab context in the JWT / session.
- Lab-switcher UI surface.
- Scoped tables still use `user_id`; ~25 tables across the modules carry `user_id` or `account_id` columns that should resolve through `lab_id`.
- Plan / subscription / Stripe customer mapping still lives on `users`.

## 4. Data-model shape (the change)

```
lab_members:                          -- new; replaces users.lab_id as the
  id                                     source of truth for who can access
  lab_id                                 which lab
  user_id
  role                  ('owner' | 'director' | 'technical_consultant'
                         | 'technical_supervisor' | 'general_supervisor'
                         | 'staff' | 'read_only')
  permissions_json      -- same shape as today's user_seats.permissions
                           (per-module view/edit gates added in PR #7)
  status                ('active' | 'invited' | 'revoked')
  is_primary_lab        -- per #12; default true for first membership
  invited_at, accepted_at, last_active_at
  invite_token          -- for invite-by-email flow
  UNIQUE(lab_id, user_id)

labs:                                 -- existing; add subscription columns
  ... (current columns) ...
  plan                  -- moved from users.plan
  subscription_status   -- moved from users.subscription_status
  subscription_expires_at
  plan_expires_at
  stripe_customer_id    -- moved from users.stripe_customer_id
  stripe_subscription_id
  study_credits         -- moved from users.study_credits
  has_completed_onboarding
  preferred_pt_vendor
  preferred_standards   -- (already represented via accreditation_* flags;
                           keep the flags, drop the JSON)

users:                                -- existing; shrinks to auth + profile
  id, email UNIQUE, password_hash, name
  last_active_lab_id    -- nullable convenience pointer for resume-where-left-off
  hipaa_acknowledged, hipaa_acknowledged_at   -- stays per-user
  created_at
  -- DEPRECATED for one release window, then dropped:
  --   plan, subscription_*, stripe_*, study_credits, lab_id, clia_*,
  --   has_completed_onboarding
```

Every scoped table gets a `lab_id` column. Backfill from `user_id` via the user's `users.lab_id` (now seat-aware). Read queries shift from `WHERE user_id = ?` to `WHERE lab_id = ?` where `lab_id` resolves from the JWT's `active_lab_id`. Write paths set both `user_id` (the creator, audit-trail value) and `lab_id` (the owning lab) during the dual-write window.

## 5. Migration phases

Each phase is a separate PR (or small cluster). The whole sequence is 12-15 PRs over 3-5 weeks of focused work.

| Phase | Scope | PR shape | Effort |
|---|---|---|---|
| **0. Schema** | Add `lab_members` table. Add new columns to `labs` (plan, subscription_*, stripe_*, study_credits, has_completed_onboarding, preferred_pt_vendor). No reader/writer changes yet. | 1 PR | 1-2 days |
| **1. Backfill** | For every `users` row, ensure a `lab_members` row exists with role='owner' if the user has `lab_id`, status='active', is_primary_lab=true. For every `user_seats` row, insert a corresponding `lab_members` row inheriting the owner's lab. Copy plan / subscription / Stripe / study_credits / onboarding fields from users to the user's primary labs row. Idempotent, runs on every boot like the existing lab backfill. | 1 PR | 2-3 days |
| **2. Auth surface** | Add `active_lab_id` to JWT payload. On login, resolve from `users.last_active_lab_id` or first active `lab_members` row. New endpoints: `GET /api/labs/me` (list memberships), `POST /api/labs/switch/:labId` (flip active lab, validate membership, update `last_active_lab_id`). NavBar lab-switcher dropdown behind a `enable_lab_switcher` feature flag. | 1 PR | 3-5 days |
| **3. Read flip per module** | One PR per module (VeritaCheck, VeritaPolicy, VeritaMap, VeritaScan, VeritaComp, VeritaPT, VeritaLab, VeritaTrack, VeritaStock, VeritaBench/Pace/Shift/QA, VeritaResponse if it has landed). Each PR adds a `lab_id` column to its scoped tables, backfills from each row's `user_id` → that user's `lab_id`, and switches the read queries to `WHERE lab_id = ?` resolved from JWT. Tests included. | ~10 PRs | 7-10 days |
| **4. Write flip + Stripe** | Per-module writes set `lab_id` from JWT's active_lab_id. Stripe webhook lookup changes from customer→user to customer→lab. Stripe checkout creates a new lab + membership for "add another lab" path. Subscription columns on `users` go read-only (still readable but no longer written). NavBar feature flag removed. | 2-3 PRs | 5-7 days |
| **5. Cleanup** | Drop deprecated columns from `users` (`plan`, `subscription_*`, `stripe_*`, `study_credits`, `clia_*`, `has_completed_onboarding`, `lab_id`). Drop dual-write. Audit script gains a rule that flags any new `WHERE user_id = ?` in a scoped query. | 1 PR | 2-3 days |

Dual-write window between phases 3 and 5: writers populate both `user_id` and `lab_id` so a rollback at any point is harmless.

## 6. Architecture sketch (helpers, not boilerplate)

```ts
// server/lib/labScope.ts
export function resolveLabScope(req: AuthedRequest): { labId: number; userId: number } {
  const { userId, activeLabId } = req.jwt;
  const membership = db.prepare(
    "SELECT id FROM lab_members WHERE user_id = ? AND lab_id = ? AND status = 'active' LIMIT 1"
  ).get(userId, activeLabId);
  if (!membership) throw new HttpError(403, "No active membership for the requested lab");
  return { labId: activeLabId, userId };
}

// every scoped route
app.get("/api/studies", auth, (req, res) => {
  const { labId } = resolveLabScope(req);
  res.json(db.prepare("SELECT * FROM studies WHERE lab_id = ? ORDER BY id DESC").all(labId));
});
```

One helper, two lines per route. The `seatRow ? seatRow.owner_user_id : payload.userId` pattern (routes.ts:1907-1910 and ~25 other places) collapses to a single call.

## 7. Risks

1. **Sweep completeness.** Every `WHERE user_id = ?` outside auth must be reviewed. Audit script must enforce the rule after Phase 5. Likely 200+ touchpoints across `server/routes.ts` and module helpers; not all are scoped queries (some are legitimate "who created this" lookups), so the sweep is judgement-by-grep, not automated.

2. **Stripe state.** Today the Stripe customer carries `stripe_customer_id` on the user row. After Phase 4, it lives on the lab row. The owner switching labs does NOT switch Stripe identity, but each lab gets its own customer and its own subscription. Webhook handler in `server/routes.ts` (Stripe section) is the most delicate part of the cut.

3. **db.ts owner-account block (line 866).** `SELECT plan FROM users WHERE email = OWNER_EMAIL` keeps the operator on permanent enterprise. After Phase 4, plan is on labs, not users. The block becomes: find the user by OWNER_EMAIL, find that user's primary lab via lab_members, force-upgrade the lab's plan to enterprise. OWNER_EMAIL stays auth-tied; OWNER_CLIA (already in place from PR #132) is the data-routing key.

4. **Onboarding UX.** First signup creates users row + labs row + lab_members row in one transaction. Invite-by-email creates a lab_members row in `invited` status with a token; accept flow flips it to `active` and links the existing (or newly-created) user_id. Edge case: invited email belongs to an existing user who is already an owner of their own lab — the invite adds a membership on a different lab without disturbing their existing one. This is exactly the Pfizer/Daniela case.

5. **HIPAA acknowledgment.** Stays per-user. A user accepts HIPAA once and it travels across all their labs. Revisit only if legal flags multi-lab as needing per-lab acknowledgment.

6. **Subscription-banner UI.** The current banner reads `user.subscription_status` and `user.subscription_expires_at`. Phase 4 changes this to active-lab's subscription. Multi-lab owners may want to see "Lab A: active until 2027-01, Lab B: trial ends in 7 days" simultaneously; consider deferring that to a Phase 6 if it adds scope.

7. **Per-module gating semantics.** `user_seats.permissions` JSON shape (PR #7) moves to `lab_members.permissions_json` unchanged. Test that an owner's lab_members row gets `{}` (= full edit on everything) by default while seat memberships preserve their existing JSON.

## 8. Cross-references

- **Parking-lot #11 (pricing):** consumed by Phase 4. Each lab gets its own Stripe subscription at full tier price; no multi-lab discount in code. Custom deals via per-customer Stripe coupon.
- **Parking-lot #12 (primary-lab seat counting):** `lab_members.is_primary_lab` flag (Phase 0) + seat-cap enforcement honoring the primary-lab-only-counts rule (Phase 4).
- **PR #126 (veritapolicy lab-owner scoping):** the seat-resolution pattern this generalizes. The dual-write window in Phase 3-4 lets PR #126's `seatRow ? owner : self` helper stay live until the corresponding module flips read-side.
- **PR #131 / #132 (Pfizer studies seed):** the canary that triggered this doc. Seed already uses `OWNER_CLIA` lookup — no further change needed for that block during the migration. It's a forward-correct exemplar.
- **db.ts:1141-1260:** the existing Tier 1 labs-table + backfill is the foundation. Phase 1 of this doc reuses the same idempotent-on-startup pattern.
- **VeritaResponse and VeritaOps scoping docs:** both flag dependency on `lab_members`. Confirm Tier 2 lands before either of those modules cuts over.

## 9. What the operator needs to decide before code starts

1. **Approve the `lab_members` shape** (Section 4): role enum, permissions JSON inheritance from `user_seats`, `is_primary_lab` flag per #12.
2. **Approve the 5-phase migration sequence** (Section 5) and the dual-write window between Phases 3 and 5.
3. **Approve the subscription-on-labs move** (Section 4): plan / subscription / Stripe columns leave `users`, land on `labs`. This is what makes pricing #11 actually work in code.
4. **Confirm role enumeration** (Section 4): `owner | director | technical_consultant | technical_supervisor | general_supervisor | staff | read_only`. Aligns with VeritaComp Element-1/4 observer rules and CLAUDE.md §6 evaluator-by-complexity tables.
5. **NavBar UX:** dropdown picker (recommended, matches the "current lab" lock indicator in Account Settings) vs URL-based lab routing (`/labs/55D5555555/studies`). Recommendation: dropdown.
6. **Feature-flag rollout:** flag-gated on the operator's account first for a week, then global; vs big-bang switch at end of Phase 5. Recommendation: flag-gated.
7. **Naming for the join table:** `lab_members` (parking lot convention) vs `lab_memberships` (more conventional). Existing parking-lot text uses `lab_members`; pick one and stick.
8. **Sequencing against #17 VeritaResponse:** VeritaResponse scoping says "after multi-lab Tier 2 lands". Confirm Tier 2 ships first, or accept that VeritaResponse will get a one-helper swap later.

## 10. Effort estimate

Total: **3-5 weeks** of focused implementation. Splits:

- Phase 0 (schema): 1-2 days
- Phase 1 (backfill, builds on existing Tier 1 backfill): 2-3 days
- Phase 2 (auth surface + NavBar picker behind flag): 3-5 days
- Phase 3 (read flip, ~10 modules): 7-10 days
- Phase 4 (write flip + Stripe webhook + checkout): 5-7 days
- Phase 5 (cleanup + audit-script rule): 2-3 days

Risk-weighted with Stripe ambiguity and the read-flip surface area: budget 5 weeks, not 3.

## 11. The pitch (internal, not customer-facing)

> "The seed bug we shipped on 2026-05-15 is the same shape as every other `WHERE user_id = ?` in the codebase. Tier 2 makes the lab the data identity instead of the user, so the next Daniela works on day one and the next operator who buys a second lab does not silently overwrite the first one's reference studies. Pricing decision #11 and seat-counting decision #12 stop being parking-lot notes and start being enforced in code."
