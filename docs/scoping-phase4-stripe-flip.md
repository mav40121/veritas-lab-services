# Scoping: Multi-Lab Tier 2 — Phase 4 (Write Flip + Stripe)

**Status.** Pre-build scoping doc. Phase 4 ships only after the operator approves this scope.
**Source.** Generated 2026-05-15 after Phase 3 completion (PRs #131–#153). Builds on the master scoping doc `docs/scoping-multi-lab-tier2.md` (PR #133).
**Author.** Claude Code, 2026-05-15.

Phase 4 makes `labs` the authoritative writer for plan, subscription state, Stripe customer mapping, and study credits. Phase 3 made the data layer ready (Phase 0 added the columns to `labs`; Phase 1 copied current values from `users` to each owner's primary lab); Phase 4 cuts over the writers and the Stripe webhook so each lab is its own billable subscription. This is what makes parking-lot #11 (each lab = independent Stripe subscription, full tier price) actually work in code.

---

## 1. Goal in one sentence

Move plan / subscription / Stripe state from `users` to `labs` as the authoritative writer, and re-point the Stripe webhook from customer→user lookups to customer→lab lookups, so a single operator can hold multiple independent paid lab subscriptions without one tab's billing event overwriting another's.

## 2. Why now

- **Phase 3 is done.** Every scoped data table is lab-keyed and the read surface uses lab-scoped routes. Billing is the last user-shaped column set still authoritative on the wrong entity.
- **Parking-lot #11 (multi-lab pricing).** "Each lab = independent Stripe subscription at full tier price, no published discount." That decision is enforced by code only after Phase 4. Today, if Lisa Veri brings her second lab online, the codebase cannot separately track its plan or expiration.
- **Parking-lot #12 (primary-lab seat counting).** Owner is one paid seat on primary, free implicit on secondaries. Seat-cap enforcement reads `users.seat_count` today; that needs to read `labs.seat_count` per lab.
- **Operator's permanent enterprise.** The `db.ts:866` block that keeps the operator forever on enterprise updates `users.plan`. After Phase 4 it must update the operator's primary lab.

## 3. Current state (what is already in place)

Phase 0 shipped these columns on `labs` (see `server/db.ts` Phase 0 block):

- `plan`
- `subscription_status`
- `subscription_expires_at`
- `plan_expires_at`
- `stripe_customer_id`
- `stripe_subscription_id`
- `study_credits`
- `has_completed_onboarding`
- `preferred_pt_vendor`

Phase 1 backfill (`server/db.ts` Phase 1 block) copied each owner's current values from `users` onto their primary `labs` row, only if the labs column was NULL (never overwrite). On every boot the backfill is idempotent and re-runs safely.

Phase 4 work is therefore purely the cutover: change WHO writes the canonical value (users.X → labs.X), change WHO the webhook looks up (user by customer → lab by customer), keep the legacy users columns read-only for one transition release, then remove them in Phase 5.

## 4. Stripe webhook event-type matrix

The webhook is at `server/routes.ts:5416`. Today it handles four event types. The matrix below lists each one's current behavior (what it writes to `users`) and the Phase 4 target (what it should write to `labs`).

| Stripe event | Today: lookup | Today: writes to users | Phase 4: lookup | Phase 4: writes to labs |
|---|---|---|---|---|
| `checkout.session.completed` | `session.metadata.userId` | `plan`, `stripe_subscription_id`, `subscription_status='active'`, `subscription_expires_at`, `plan_expires_at`, `seat_count`, `study_credits` (per-study path) | `session.metadata.labId` (new) | same columns on the `labs` row |
| `customer.subscription.deleted` | `getUserByStripeCustomerId(sub.customer)` | `plan='free'`, `stripe_subscription_id=null`, `subscription_status='expired'`, `subscription_expires_at=now` | `getLabByStripeCustomerId(sub.customer)` (new) | same columns on the `labs` row |
| `customer.subscription.updated` | `getUserByStripeCustomerId(sub.customer)` | `subscription_expires_at=current_period_end`, `subscription_status='active'` | `getLabByStripeCustomerId(...)` | same columns on the `labs` row |
| `invoice.payment_failed` | `getUserByStripeCustomerId(invoice.customer)` | `subscription_expires_at=now+7d grace`, `subscription_status='payment_failed'` | `getLabByStripeCustomerId(...)` | same columns on the `labs` row |

Events the handler currently ignores (silently `200 OK`):

- `customer.subscription.created` — fires alongside checkout.session.completed; today we rely on checkout metadata. After Phase 4 the labId metadata path still works, but a defensive `created` handler that mirrors `updated` is cheap insurance.
- `invoice.paid` / `invoice.finalized` — recurring renewals. Today `subscription.updated` catches the expiry bump. After Phase 4, same.
- `customer.deleted` — never fires from our checkout (we don't delete customers), worth handling defensively to mark a lab orphaned.
- `charge.refunded` — refund flow. Out of scope for Phase 4; track separately.

## 5. The lookup change

**Today (Phase 3 state).** `stripe_customer_id` is on `users`. `storage.getUserByStripeCustomerId(id)` does `SELECT ... FROM users WHERE stripe_customer_id = ?`.

**Phase 4.** `stripe_customer_id` becomes authoritative on `labs`. New helper `storage.getLabByStripeCustomerId(id)` does `SELECT ... FROM labs WHERE stripe_customer_id = ?`. Webhook handlers use it. The corresponding column on `users` is read-only deprecated.

**Backfill (already done in Phase 1).** Every owner's `users.stripe_customer_id` got copied onto their primary `labs.stripe_customer_id`. So as of today, every existing Stripe customer is mapped on both sides. Phase 4 just stops writing the user side.

**New lab creation path.** When a user clicks "Add another lab" (Phase 4 checkout flow):

1. Insert `labs` row with the new lab's identity.
2. Insert `lab_members` row (role='owner', is_primary_lab=0).
3. Create a fresh Stripe customer with the lab's name.
4. Stamp `labs.stripe_customer_id` = new Stripe customer id.
5. Run `stripe.checkout.sessions.create` with `metadata.labId = newLab.id`.

The metadata.labId is what `checkout.session.completed` reads back. The owner's existing user → existing primary lab → existing Stripe customer chain is untouched.

## 6. PR sequence

Five sub-PRs over 5-7 days. Each is reviewable independently; merges are sequential.

### Phase 4.1 — Stripe webhook refactor (riskiest, ship first under test mode)

- Add `storage.getLabByStripeCustomerId(customerId)`.
- Rewrite all four event-type branches to look up by lab and update lab columns.
- For `checkout.session.completed`: read `session.metadata.labId`. Fall back to `session.metadata.userId` → owner's primary lab for backward compat through the transition. Dual-write to both `users` and `labs` for this release only, so a deploy rollback leaves both stores consistent.
- Add defensive handlers for `customer.subscription.created` and `customer.deleted`.
- Test against Stripe test-mode keys with `stripe trigger` replay of every event type.
- 1 PR, ~150 lines.

### Phase 4.2 — Checkout endpoint update (low risk)

- `app.post("/api/stripe/checkout", ...)` at `server/routes.ts:5249` adds `metadata.labId` from `req.scope.labId` (read from URL or default_lab_id).
- New endpoint `POST /api/labs/me/add` that creates a new labs row + lab_members owner row + Stripe customer + Stripe checkout session in one transaction. Returns the Stripe checkout URL.
- 1 PR, ~120 lines.

### Phase 4.3 — Read-side consolidation (the broad sweep, ~40-50 call sites)

`req.user.plan` becomes `req.scope.lab.plan`. `req.user.subscriptionStatus` becomes `req.scope.lab.subscription_status`. Affected helpers:

- `hasCheckAccess`, `hasScanAccess`, `hasMapAccess`, `hasCompetencyAccess`, `hasPTAccess`, `hasTrackAccess`, `hasLabCertAccess`, `hasStaffAccess`, `hasOpsAccess` — all accept either user or lab; sweep them to take lab.
- `getAccessLevel(user)` becomes `getAccessLevel(lab)`.
- `requireWriteAccess` middleware reads from `req.scope.lab` if present.
- `SubscriptionBanner.tsx` and `SubscriptionModal.tsx` read from active lab via `/api/labs/me`.
- `/api/auth/me` continues to return user identity, but the page-level subscription state comes from `/api/labs/me` (already shipped Phase 2a).
- 2-3 PRs grouped by access-tier function, ~300 lines.

### Phase 4.4 — db.ts permanent-enterprise + writer-flip migrations

- `db.ts:866` (OWNER_EMAIL permanent enterprise) flips from `UPDATE users SET plan='enterprise'` to: find the user by OWNER_EMAIL, find their primary lab via `lab_members WHERE is_primary_lab=1`, `UPDATE labs SET plan='enterprise'` on that lab.
- Set-plan admin endpoint (`POST /api/admin/set-plan`) targets a lab, not a user.
- Seat-related logic that reads `users.seat_count` now reads `labs.seat_count` of the owner's primary lab.
- 1 PR, ~80 lines.

### Phase 4.5 — Users-row writes become read-only deprecated

- Remove or no-op every `UPDATE users SET plan = ?` / `subscription_*` / `stripe_*` / `study_credits` write outside the auth + onboarding paths.
- Add an audit-script rule that flags any new `UPDATE users SET (plan|subscription_status|...)` outside the auth-rooted helpers.
- Legacy users columns stay readable for transition. Phase 5 cleanup drops them.
- 1 PR, ~60 lines + audit rule.

## 7. Risks (Stripe-specific)

1. **Silent payment loss.** Customer pays, webhook fires, handler updates the wrong lab (or no lab), customer sees free-plan UI after payment. Mitigation: dual-write to both users and labs in 4.1 for one release; verify both rows agree on a daily reconciliation script. Roll forward, not back, if a discrepancy is found.

2. **Wrong cancellation.** `customer.subscription.deleted` for lab A's Stripe customer accidentally downgrades lab B because of a stale users.stripe_customer_id row. Mitigation: when Phase 4.1 ships, drop any rows where users.stripe_customer_id no longer matches that user's primary lab's stripe_customer_id (Phase 1 backfill should have aligned them, but a stale partial write may exist).

3. **Stripe customer mapping is hard to undo.** Once "add another lab" creates a separate Stripe customer for lab #2, you cannot easily merge it back. If we ship 4.2 and discover the model is wrong, refunding and re-issuing is the only safe rollback.

4. **db.ts:866 race.** The permanent-enterprise update runs on every boot. After Phase 4.4 it depends on `lab_members` having an `is_primary_lab=1` row for the operator. If Phase 1 backfill failed for any reason (e.g. operator's user has no `lab_id` yet at boot time), the lab plan does not get force-upgraded. Mitigation: the block first runs the Tier 1 backfill, then the Phase 1 lab-membership backfill, then the permanent-enterprise upgrade. Ordering is preserved by source order in db.ts; verify in the 4.4 PR.

5. **Test mode vs live.** Stripe test keys and live keys are separate. The webhook URL is the same. Make sure 4.1 is tested with test keys + test mode webhooks BEFORE flipping any code path that processes live events. Use `stripe listen` / `stripe trigger` locally.

6. **Subscription banner flicker.** During 4.3, the user.plan source temporarily disagrees with the lab.plan source. UI shows a stale tier briefly. Mitigation: ship 4.3 in one wave (all subscription-banner consumers flipped together) rather than one helper at a time.

7. **`storage.getUserByStripeCustomerId` callers outside the webhook.** There may be other call sites that depend on this lookup (admin reporting, debug endpoints). A grep before shipping 4.1 will find them. Likely just the webhook, but verify.

## 8. Test plan

Pre-merge of 4.1:

1. Run `stripe trigger checkout.session.completed` against test-mode keys with `metadata.labId` set to a known test lab. Verify the lab row's plan, subscription_status, subscription_expires_at, plan_expires_at, seat_count update; verify users row dual-write also lands.
2. Run `stripe trigger customer.subscription.updated` against a test customer that's mapped on labs. Verify lab subscription_expires_at moves.
3. Run `stripe trigger customer.subscription.deleted`. Verify lab plan='free', subscription_status='expired'.
4. Run `stripe trigger invoice.payment_failed`. Verify lab subscription_status='payment_failed' with 7-day grace.
5. Replay each event against a customer whose users.stripe_customer_id is stale (deliberately mismatched). Confirm the new lab lookup wins; document the user-row staleness as a known-OK state during the transition.

Post-merge of 4.1, before 4.2:

6. Watch live webhook logs for 24-48 hours. Confirm no customer hits "wrong record updated" errors.
7. Spot-check the operator's lab row: `SELECT plan, subscription_status, subscription_expires_at FROM labs WHERE id = (your primary lab id)`. Should match what the operator sees in the app.

## 9. Decisions the operator needs to make before code starts

1. **Approve the dual-write window in 4.1.** One release worth of writing to both users and labs. Acceptable belt-and-suspenders or unnecessary overhead?
2. **Confirm the metadata.labId path.** Every new Stripe checkout will carry `metadata.labId`. Today many existing subscriptions have `metadata.userId`. Plan: fall back to userId → primary-lab resolution for checkout.session.completed events from before the cutover. OK?
3. **Sequence vs VeritaResponse Phase 2.** VeritaResponse scoping doc (`docs/scoping-veritaresponse.md`) was waiting for multi-lab Tier 2 to land. After Phase 4 ships, VeritaResponse Phase 2 (the actual CMS-2567 renderer and 5-elements validator) is unblocked. Plan: ship Phase 4 first, then start VeritaResponse?
4. **Backfill verification.** Before shipping 4.1, run an ad-hoc query to verify every existing `users.stripe_customer_id` IS-EQUAL-TO their primary lab's `labs.stripe_customer_id`. If any rows disagree, fix them by hand before the webhook flip.
5. **Test-mode webhook endpoint URL.** Stripe test mode and live mode webhooks can point at the same URL (the server distinguishes by signing secret). Confirm we have STRIPE_WEBHOOK_SECRET (live) and STRIPE_WEBHOOK_SECRET_TEST configured separately, or that we're OK testing against the live URL with test-mode events.

## 10. Effort estimate

Total: **5-7 days** of focused implementation. Splits:

- Phase 4.1 (webhook refactor + stripe sandbox test): 1.5-2 days
- Phase 4.2 (checkout for add-another-lab): 1 day
- Phase 4.3 (read-side consolidation, ~40-50 sites): 2-3 days
- Phase 4.4 (db.ts permanent enterprise + admin endpoints): 0.5 day
- Phase 4.5 (users-row writes deprecated + audit rule): 0.5-1 day

Risk-weighted with Stripe testing time: budget 7 days.

## 11. The pitch (internal, not customer-facing)

> "Today the codebase pretends one user maps to one billable subscription. Phase 3 made the data layer recognize that one operator can own multiple labs. Phase 4 finishes the model on the money side: each lab carries its own Stripe customer, its own plan, its own subscription expiry. The webhook stops asking 'which user owns this Stripe customer' and starts asking 'which lab does this Stripe customer belong to.' Parking-lot decision #11 (each lab gets its own subscription at full tier price) becomes enforced in code, not documented in markdown."
