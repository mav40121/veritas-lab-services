# Scoping: Multi-Lab Tier 2 — Lab as a First-Class Entity

**Status.** Pre-build scoping doc. No code on the Tier 2 cut ships until the operator approves this scope.
**Source.** Parking-lot items #11 (multi-lab pricing decision) and #12 (primary-lab seat counting), 2026-05-07. Re-opened 2026-05-15 when the Pfizer-studies seed (PR #131 → #132) exposed the email-as-lab-key brittleness in code.
**Author.** Claude Code, 2026-05-15. Builds on the already-shipped `labs` table + `users.lab_id` migration in `server/db.ts` lines 1141-1260.

Tier 2 is the data-layer cut for one user belonging to many labs. Tier 1 (the `labs` table + backfill of CLIA / lab name / accreditation flags off the user row) has already shipped. Tier 2 is what unlocks "Daniela has a seat on Michael's lab AND her own Pfizer lab", "Lisa Veri runs Milford and a second lab on different subscriptions", and "one operator email can own multiple labs without the seed/admin code silently picking the wrong row".

---

## 1. Goal in one sentence

Make `labs` the data-routing identity for every scoped table and put the active lab in the URL of every scoped page, so the same email can hold parallel sessions in different labs (one tab per lab) without active-lab state silently corrupting another tab and without breaking shareable links.

## 1a. UX shape: URL-routed, not active-lab-in-session

Decided 2026-05-15: lab scope lives in the URL (`/labs/{labId}/studies/123`), not in the JWT or a server-side "active lab" pointer. The reasons specific to this product:

- **Consultants need parallel tabs.** The operator is the first beta consultant for the platform. Active-lab-in-session breaks consultant workflows: switching in one tab silently re-scopes others. URL-routing is parallel-safe by construction.
- **Shareable links.** "Look at this study" is only useful as a Slack message if the URL encodes the lab; otherwise the recipient sees wrong data or a 404 depending on their hidden active-lab state.
- **Single-lab users are unaffected.** Bare `/dashboard` server-side-redirects to `/labs/{their_only_lab_id}/dashboard`. They never see a picker.
- **Matches the regulatory model.** A CAP inspection IS lab-scoped. "You are in lab X" via URL is more legible during a screen-share than via hidden session state.

Mental model: like GitHub orgs (`github.com/anthropic/...`), Linear workspaces (`linear.app/{workspace}/...`), and Notion teamspaces. Org-in-URL is the standard for B2B multi-tenant products precisely because the alternatives break under parallel work.

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
  default_lab_id        -- nullable; target for bare `/dashboard` redirect.
                        --   Auto-updated to whichever lab the user last
                        --   visited (`/labs/{id}/...` page hit). NOT the
                        --   source of truth for scope — URL is.
  hipaa_acknowledged, hipaa_acknowledged_at   -- stays per-user
  created_at
  -- DEPRECATED for one release window, then dropped:
  --   plan, subscription_*, stripe_*, study_credits, lab_id, clia_*,
  --   has_completed_onboarding
```

Every scoped table gets a `lab_id` column. Backfill from `user_id` via the user's `users.lab_id` (now seat-aware). Read queries shift from `WHERE user_id = ?` to `WHERE lab_id = ?` where `lab_id` is parsed from the URL params (`req.params.labId`) and validated against `lab_members` for the authenticated user on every request. Write paths set both `user_id` (the creator, audit-trail value) and `lab_id` (the owning lab) during the dual-write window. JWT carries `{ userId }` only — no active-lab claim; URL is the single source of truth for scope.

URL shape decision: numeric `lab_id` in path, NOT CLIA. CLIA is regulated (locked once first study runs), but it is the lab's public identity and putting it in URLs leaks identity into browser history, screen-shares, and customer-support tickets. Internal `lab_id` is opaque, stable, shorter (4-5 digits vs 10), and decouples URL stability from any future CLIA-renumbering scenarios. Format: `/labs/42/studies/123`.

## 5. Migration phases

Each phase is a separate PR (or small cluster). The whole sequence is 12-15 PRs over 3-5 weeks of focused work.

| Phase | Scope | PR shape | Effort |
|---|---|---|---|
| **0. Schema** | Add `lab_members` table. Add new columns to `labs` (plan, subscription_*, stripe_*, study_credits, has_completed_onboarding, preferred_pt_vendor). No reader/writer changes yet. | 1 PR | 1-2 days |
| **1. Backfill** | For every `users` row, ensure a `lab_members` row exists with role='owner' if the user has `lab_id`, status='active', is_primary_lab=true. For every `user_seats` row, insert a corresponding `lab_members` row inheriting the owner's lab. Copy plan / subscription / Stripe / study_credits / onboarding fields from users to the user's primary labs row. Idempotent, runs on every boot like the existing lab backfill. | 1 PR | 2-3 days |
| **2. URL + auth surface** | Frontend router refactor: every scoped page moves from `/studies/123` to `/labs/:labId/studies/123` (and same for `/veritapolicy`, `/veritamap`, etc.). Server adds `labScopeMiddleware` that reads `req.params.labId`, asserts active membership, attaches `{ labId }` to the request. Bare `/dashboard` server-redirects to `/labs/{users.default_lab_id ?? first_membership.lab_id}/dashboard`. New endpoint `GET /api/labs/me` lists memberships (drives the NavBar switcher dropdown which rewrites the URL to `/labs/{new}/<same-current-path>`). Permanent 301 redirects for ~12 legacy root paths so old bookmarks/emails keep working. `default_lab_id` auto-updates on every page hit. | 1 PR | 4-6 days |
| **3. Read flip per module** | One PR per module (VeritaCheck, VeritaPolicy, VeritaMap, VeritaScan, VeritaComp, VeritaPT, VeritaLab, VeritaTrack, VeritaStock, VeritaBench/Pace/Shift/QA, VeritaResponse if it has landed). Each PR adds a `lab_id` column to its scoped tables, backfills from each row's `user_id` → that user's `lab_id`, switches API routes to `/api/labs/:labId/<module>`, and switches the queries to `WHERE lab_id = ?` resolved from URL via `labScopeMiddleware`. Tests included. | ~10 PRs | 7-10 days |
| **4. Write flip + Stripe** | Per-module writes set `lab_id` from URL scope. Stripe webhook lookup changes from customer→user to customer→lab. Stripe checkout creates a new lab + membership for "add another lab" path. Subscription columns on `users` go read-only (still readable but no longer written). | 2-3 PRs | 5-7 days |
| **5. Cleanup** | Drop deprecated columns from `users` (`plan`, `subscription_*`, `stripe_*`, `study_credits`, `clia_*`, `has_completed_onboarding`, `lab_id`). Drop dual-write. Audit script gains a rule that flags any new `WHERE user_id = ?` in a scoped query. | 1 PR | 2-3 days |

Dual-write window between phases 3 and 5: writers populate both `user_id` and `lab_id` so a rollback at any point is harmless.

## 6. Architecture sketch (helpers, not boilerplate)

```ts
// server/lib/labScope.ts
export function labScopeMiddleware(req: AuthedRequest, res: Response, next: NextFunction) {
  const labId = Number(req.params.labId);
  if (!Number.isFinite(labId)) return res.status(400).json({ error: "Missing or invalid lab id" });
  const { userId } = req.jwt;
  const membership = sqlite.prepare(
    "SELECT id, role FROM lab_members WHERE user_id = ? AND lab_id = ? AND status = 'active' LIMIT 1"
  ).get(userId, labId) as any;
  if (!membership) return res.status(403).json({ error: "No active membership for this lab" });
  req.scope = { labId, userId, role: membership.role };
  sqlite.prepare("UPDATE users SET default_lab_id = ? WHERE id = ?").run(labId, userId);
  next();
}

// every scoped route
app.get("/api/labs/:labId/studies", auth, labScopeMiddleware, (req, res) => {
  res.json(sqlite.prepare("SELECT * FROM studies WHERE lab_id = ? ORDER BY id DESC").all(req.scope.labId));
});

// frontend (wouter) route
<Route path="/labs/:labId/studies" component={MyStudiesPage} />
// inside the page: const { labId } = useParams(); useQuery(["studies", labId], () => fetch(`/api/labs/${labId}/studies`))
```

One middleware, one line per route. The `seatRow ? seatRow.owner_user_id : payload.userId` pattern (routes.ts:1907-1910 and ~25 other places) collapses to `req.scope.labId`. The `default_lab_id` auto-update means the next bare `/dashboard` visit lands on the same lab the user last worked in — invisible to single-lab users, useful resume-state for multi-lab consultants.

Bare-route redirect:
```ts
// /dashboard → /labs/{default_or_first}/dashboard
app.get("/dashboard", auth, (req, res) => {
  const user = sqlite.prepare("SELECT default_lab_id FROM users WHERE id = ?").get(req.jwt.userId) as any;
  const first = sqlite.prepare(
    "SELECT lab_id FROM lab_members WHERE user_id = ? AND status = 'active' ORDER BY is_primary_lab DESC, id ASC LIMIT 1"
  ).get(req.jwt.userId) as any;
  const target = user?.default_lab_id ?? first?.lab_id;
  if (!target) return res.redirect("/onboarding");
  return res.redirect(`/labs/${target}/dashboard`);
});
```

NavBar switcher:
```tsx
const { data: memberships } = useQuery(["my-labs"], () => fetch("/api/labs/me").then(r => r.json()));
// dropdown shows memberships; clicking item navigates:
const switchLab = (newLabId: number) => {
  const newPath = location.replace(/^\/labs\/\d+/, `/labs/${newLabId}`);
  setLocation(newPath);  // wouter setLocation; same logical page, different lab
};
```

The switcher is hidden when `memberships.length <= 1`. Single-lab users never see it.

## 7. Risks

1. **URL redirect surface.** Every existing user-scoped frontend route (`/dashboard`, `/study/:id/results`, `/veritapolicy-app`, `/veritamap`, `/veritascan`, etc.) needs a permanent 301 redirect to its lab-scoped form. Old bookmarks, customer-support screenshots, and email links must keep resolving. Implement as a small redirect table in `server/routes.ts`: for each legacy path, look up the user's default lab (or the resource's owning lab for resource-deep links like `/study/123`) and 301. ~12 root paths + ~6 resource-deep paths to handle. Test with curl that every legacy URL still resolves correctly during and after Phase 2.

2. **Sweep completeness.** Every `WHERE user_id = ?` outside auth must be reviewed. Audit script must enforce the rule after Phase 5. Likely 200+ touchpoints across `server/routes.ts` and module helpers; not all are scoped queries (some are legitimate "who created this" lookups), so the sweep is judgement-by-grep, not automated.

3. **Stripe state.** Today the Stripe customer carries `stripe_customer_id` on the user row. After Phase 4, it lives on the lab row. The owner switching labs does NOT switch Stripe identity, but each lab gets its own customer and its own subscription. Webhook handler in `server/routes.ts` (Stripe section) is the most delicate part of the cut.

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
5. **URL shape:** numeric `lab_id` in path (recommended; opaque, stable, short) vs CLIA in path (human-readable but leaks regulated lab identity into browser history, screen-shares, and customer-support tickets). Recommendation: numeric `lab_id`.
6. **Legacy URL handling:** 301 every old user-scoped path to its new lab-scoped form (recommended; preserves bookmarks/emails/screenshots) vs return a friendly "URL changed" landing page that requires a click. Recommendation: 301.
7. **Naming for the join table:** `lab_members` (parking lot convention) vs `lab_memberships` (more conventional). Existing parking-lot text uses `lab_members`; pick one and stick.
8. **Sequencing against #17 VeritaResponse:** VeritaResponse scoping says "after multi-lab Tier 2 lands". Confirm Tier 2 ships first, or accept that VeritaResponse will get a one-helper swap later.

## 10. Effort estimate

Total: **3-5 weeks** of focused implementation. Splits:

- Phase 0 (schema): 1-2 days
- Phase 1 (backfill, builds on existing Tier 1 backfill): 2-3 days
- Phase 2 (URL refactor + `labScopeMiddleware` + redirects + NavBar switcher): 4-6 days
- Phase 3 (read flip, ~10 modules, routes move to `/api/labs/:labId/*`): 7-10 days
- Phase 4 (write flip + Stripe webhook + checkout): 5-7 days
- Phase 5 (cleanup + audit-script rule): 2-3 days

Risk-weighted with Stripe ambiguity, the read-flip surface area, and the URL redirect work: budget 5 weeks, not 3.

## 11. The pitch (internal, not customer-facing)

> "Tier 2 makes the lab the data identity instead of the user. Every scoped page lives at `/labs/{id}/...` so a consultant can hold Pfizer's lab in one tab and Michael's in another without either tab silently corrupting the other. Single-lab users never see the change — they sign in, get bounced to their lab's dashboard, and work as before. Multi-lab users get the GitHub-org / Linear-workspace pattern they already know. The 2026-05-15 seed bug stops being a class of risk; pricing decision #11 and seat-counting decision #12 stop being parking-lot notes and start being enforced in code."
