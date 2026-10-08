# VeritaAssure Parking Lot

Canonical, persistent record of items deferred from active work. This file
is the source of truth across sessions, replacing the old practice of
reconstructing the parking lot from chat history each time.

**Bootstrap rule:** every fresh VeritaAssure session reads this file as
part of step B2 (see `skills/veritaassure-bootstrap/SKILL.md`). Items in
the OPEN sections must be surfaced to the user during the session
briefing.

**How to use this file:**
- New parking-lot items get added under OPEN, dated, with a one-line
  source pointer (which session or screenshot surfaced it).
- When an item is shipped, it moves to CLOSED with a closure-evidence
  pointer (commit SHA, file/line that proves the change is live, or an
  explicit user statement).
- Never silently delete an item. If it turns out to never have been a
  real ask, move it to NOT CARRIED OVER with the reason.

**Recovery scope:** This file was created 2026-05-01 evening. Items
recovered from prior sessions are best-effort across the
past_session_contexts archive (earliest parking-lot mention found is
2026-04-27). Items parked in earlier sessions may need user recall.

---

## OPEN

### 5. v0.6 source-grounded rebuild of all 4 accreditor columns

**Effort:** L (3-5 weeks)
**Importance:** High — accreditor citation accuracy underpins every VeritaPolicy / VeritaScan / VeritaCheck artifact.

**What:** AABB ids in aabbRequirements.ts (138/168 marked "real") and
COLA ids in colaRequirements.ts (167/168 marked "real") came from
agent generator output, not from a human cross-check against the
authoritative source documents (BBTS PDF for AABB, current COLA
checklist PDF for COLA). Same concern less acute for CAP (12 MAS xlsx)
and TJC (CAMLAB PDF + text extract).

**Fix shape:** Per the in-flight todo list at session start:
- Spawn CAP rebuild subagent (12 MAS xlsx files)
- Spawn TJC rebuild subagent (CAMLAB PDF + text extract)
- Spawn AABB rebuild subagent (BBTS PDF)
- Spawn COLA rebuild subagent (current checklist PDF)
- Review topical audits for each accreditor (gate: <10% wrong)
- Merge passing CSVs into v0.6 master citation index

**Source:** prior session handoff. Re-confirmed during 2026-05-01 QC
review.

**Status:** Open. Multi-hour subagent fan-out work. Work-pass 2026-10-04: BLOCKED on materials. AABB and COLA columns cannot be source-grounded without the gated manuals (item #28); CAP is 11/12 modules verifiable from files on the drive, MOL file missing (item #27); TJC is operator-authoritative. Not startable without fabricating accreditor citations. Awaiting #27 + #28.

**Pre- vs post-COLA:** Pre-COLA. May 6-8 conference; Saturday + Sunday +
Monday available before the booth.

---

_(item #17 reclassified to CLOSED 2026-09-28; VeritaResponse shipped and live, see C48 below)_

---

_(item #18 closed 2026-09-28; all phases shipped, see C47 below)_

---

_(item #22 closed 2026-05-28; see C26 below)_

---

### 27. Acquire CAP MOL (Molecular) checklist to verify 2 pending entries

**Effort:** N/A (operator action — ~1 hour of code work once the file is in hand)
**Importance:** Low — two entries total; low traffic; only matters when a customer cites a MOL standard.

**What:** PR #108 left 2 entries in `server/capRequirements.ts`
flagged as unverified because the operator does not hold the CAP MOL
(Molecular Pathology) MAS xlsx file:

- `MOL.35855` - NGS HLA Discrepancy Resolution
- `MOL.37460` - Contamination Control

The other 11 CAP modules (ANP, CHM, COM, CYP, DRA, GEN, HEM, IMM,
MIC, POC, TRM, URN) were verified against the 12 MAS files held on
the operator's local drive at
`C:/Users/veril/OneDrive/Desktop/Lab/Regulatory/2026 Cap checklists/`.
The MOL module's MAS xlsx is the only one missing from that set.

**Fix shape:** Operator obtains `MAS_MOL_12092025_Long_*.xlsx` from
CAP e-LAB Solutions Suite (download requires CAP accreditation
credentials). Drops the file in the same folder. Re-run
`fix_cap_fabricated_ids_v10.py` with the MOL module included to
verify these 2 IDs exist; if either is fake, substitute against the
real MOL Subject Headers using the same surgical-replacement
discipline.

**Source:** PR #108 commit 92f9573 (closed via merge 2026-05-11),
audit findings.

**Status:** Open, blocks on operator obtaining the MOL checklist. Work-pass 2026-10-04: NEEDS MICHAEL. The MAS_MOL xlsx download requires CAP e-LAB credentials (agent cannot download). Drop MAS_MOL_*.xlsx in the 2026 Cap checklists folder and the agent re-runs the MOL verify (MOL.35855 + MOL.37460).

**Pre- vs post-COLA:** Post-COLA. Two entries; low traffic.

---

### 28. Acquire AABB Standards 35th edition + current COLA Accreditation Manual for exhaustive citation verification

**Effort:** N/A (operator action — ~1-2 days of audit re-run once the manuals are held)
**Importance:** High — gates #5 from reaching "exhaustively verified" status for AABB and COLA.

**What:** The 2026-05-11 QC audit found that VeritaScan, cfrRequirements
cross-refs, and colaRequirements.ts cite about 180 AABB and COLA codes
that the public compilations
(`build_aabb_pdf.py` / `build_cola_pdf.py`) do not cover. These are
format-valid (correct chapter prefix and section format) and the master
citation index treats many of them as real, but they cannot be
exhaustively verified against authoritative source until the gated
accreditor manuals are held.

Examples (representative; not exhaustive):
- AABB: `1.2.3`, `1.2.4`, `1.3.3`, `2.1.6`-`2.3.2`, `3.1.1`+ - sequential
  AABB Standards for Blood Banks and Transfusion Services 35th edition
  (effective April 1, 2026) chapter codes.
- COLA: `APM 2`-`APM 16`, `CA 3`-`CA 6`, `FAC 11`-`FAC 14`,
  `MA 4`, `PST 23`, `VER 9` - real COLA criterion codes that the
  public 2013 manual + LabGuides + 2019 Validation excerpts compilation
  does not enumerate fully.

**Fix shape:** Operator obtains the gated manuals (AABB Standards via
AABB enrollment; current COLA Accreditation Manual via the lab's
COLA enrollment). Once held, an exhaustive ID set is extracted and the
QA audit re-run. Any format-valid code that still does not appear in
the real manual gets surgical replacement; any code already in the
manual is confirmed and the "compilation gap" flag in PROVENANCE.md
is downgraded.

**Source:** 2026-05-11 QC/QA audit, documented in
`OneDrive\Lab\Regulatory\aaa Truth Master Document\PROVENANCE.md`
"Audit-coverage limits" section.

**Status:** Open, blocks on operator obtaining the gated accreditor
manuals. Until then, AABB / COLA citations are best-effort against
the public-source compilations. Work-pass 2026-10-04: NEEDS MICHAEL.
AABB Standards 35th ed. + current COLA Accreditation Manual are gated
behind enrollment; agent cannot obtain them. On arrival the agent
extracts the exhaustive ID set and re-runs the QA audit.

**Pre- vs post-COLA:** Post-COLA. Operator-side action item, no code
work pending until the source documents land.

---

### 29. VeritaStock barcode scanning (full mobile scan flow)

**Effort:** L (12 working days, ~3 weeks calendar)
**Importance:** High — strategic moat vs Unity Lab Services ($30K+/yr); presold as included on Clinic+ tiers; build triggers on first paid commitment.

**What:** The remaining barcode-scanning build for VeritaStock, scoped
during the 2026-05-20 Pfizer follow-up discussion. Order-now reorder
document (PDF + Excel) already shipped in PR #286. This item is the
mobile scan companion that turns VeritaStock into a true Unity Lab
Services-class inventory product.

**Full scope (12 working days):**
- Day 1: barcode generation library + "Print Labels" PDF endpoint
  (Avery 5160, 30 labels per sheet)
- Day 2: schema additions (`barcode_value` column on
  `inventory_items` + `scan_events` audit table) with ALTER TABLE
  migration pattern
- Day 3: PWA shell - manifest, service worker, install prompt,
  mobile-first layout
- Day 4: scanner page - camera access via MediaDevices API,
  zxing-js decode, item lookup, quantity entry, submit
- Day 5: scan-history view per item + scan-events Excel audit export
- Day 6: edge cases - offline scan queue with local IndexedDB,
  permission-denied UX, seat-user scan permissions
- Day 7: real-device testing (iOS Safari + Android Chrome) + verify
  script
- Day 8: polish, marketing copy, roadmap page update, docs, Gate 3
  prod verify
- Day 9-10: offline queue hardening + mobile UI polish + error states
- Day 11-12: label-printing wizard + item-catalog CSV import +
  onboarding flow

**Why parked vs build now:**
- No paying customers yet for VeritaStock specifically
- Pfizer expressed interest but has not committed; quote and pricing
  discussion still in flight as of 2026-05-21
- Pre-sell strategy decided: trigger build on first paid commitment
  rather than speculative-build
- "Coming Q3 2026" badge in marketing copy serves as signal-of-demand
  capture in the meantime

**Pricing model (locked during 2026-05-21 strategy session):**
- Barcode scanning is INCLUDED FREE on every Clinic+ tier that has
  VeritaStock (per the gate-by-cost-to-deliver principle - the
  feature costs zero per customer to deliver after build)
- Optional onboarding service: $1,500 flat (covers custom label
  generation, CSV catalog import, 1-hour training Zoom)
- Marketing line: "Unity Lab Services charges $30K+/year for barcode
  scanning. We include it free with VeritaStock. Optional onboarding:
  $1,500 flat. No tier upgrade required."

**Technical anchors locked:**
- PWA (Progressive Web App), NOT native iOS/Android apps - phone
  camera works fine for lab volumes (200-400 items per round, not
  Amazon-warehouse scale)
- Libraries: zxing-js (scanning) and bwip-js (label generation) -
  both MIT/Apache, $0 cost
- No third-party services, no app store fees, no new infrastructure
- Reuses existing JWT auth and multi-lab scoping

**Out-of-pocket cash cost: $0.** Time cost: ~12 dev days + ~6 hours
of operator testing.

**Trigger to build:** First paid commitment from Pfizer or any other
Hospital/Enterprise prospect that names barcode scanning as a
requirement. Pre-sale closes via the Pfizer email or a similar
inbound, then build kicks off the same day.

**Source:** 2026-05-20 Pfizer follow-up session, after the order-now
reorder document shipped (PR #286). Strategic decision documented in
the team pricing analysis docx at
`C:\Users\veril\Downloads\VeritaAssure-Pricing-Analysis-2026-05-21.docx`
(version 2). The Request-an-Instrument feature (PR #293) was built
instead as the durable customer-feedback channel for VeritaMap;
barcode scanning waits on revenue commitment.

**Status:** Parked pending first paid commitment. Work-pass 2026-10-04: HELD BY STRATEGY, build-decision needs Michael. Already fully scoped (12-day plan below), so nothing to add by re-scoping. Trigger remains first paid commitment naming barcode scanning. Building now would override the locked strategy and spend ~12 dev days speculatively. Recommendation: hold. Say the word to build speculatively.

---

_(item #30 closed 2026-10-07; CFR Reference tab shipped PR #1461, deployed 2026-10-04, see C62 below)_

---

### 32. Lab leader community / forum (paid subscription idea)

**Effort:** XL (ongoing operational commitment, not a build) as paid; S (a few days to spin up) as free invite-only Slack/Discord alternative.
**Importance:** Low as paid product (SWOT verdict: don't build); Medium as free lead-funnel alternative.

**What:** Operator-floated 2026-05-22: a vetted online forum for
laboratory leaders (directors, managers, supervisors). Pricing as
proposed: $5 first year promo, then $5/mo or $50/yr. David McCormick
would manage day-to-day moderation with a 50% revenue split. Premise:
existing lab-leader communities have decayed (Facebook groups bot-
infested, LinkedIn lab-leader groups inactive, listservs dead,
ASCP / CLMA discussions gated behind $200+/yr society dues). There
is a real gap in the market for an active, vetted, current
lab-leader water cooler.

**SWOT summary (full analysis done 2026-05-22):**

Strengths: real gap exists, operator credibility (MS/MBA/MLS(ASCP)/
CPHQ + former TJC surveyor + 200+ surveys), warm seed network of
~47 COLA contacts, David's consultant network extends reach,
VeritaAssure customers become natural members, owned SaaS
infrastructure could host.

Weaknesses: operator is already overcommitted across 11+ Verita
modules + active sales pipeline (COPC, Pfizer, Tywauna, Pagan,
Rivera, etc.); forum operations is not core competence for either
operator or David; lab leaders are time-poor and resist a 5th
platform; $5/yr signals low value and underprices proper management;
no plan for the daily content engine that keeps forums alive
post-launch.

Opportunities: real lead funnel into VeritaAssure (zero CAC for
forum members), network-effect competitive moat if it reaches
critical mass (~300+ engaged), content reuse for marketing,
underserved niche within a niche (hospital-employed lab leaders),
AI-assisted moderation now feasible.

Threats: established communities (ASCP, CLMA, CAP, AABB) have 50+
years of institutional inertia; moderation liability is meaningful
in a clinical-leader context (member gets bad peer advice, clinical
event follows, forum operator named); bot/spam invasion is what
killed Facebook lab groups and will come for any open forum; free
competitors keep emerging; biggest threat is distraction from
VeritaAssure core business.

**Economic math kills the proposal as stated:**

- $5/yr × 100 members × 50% split = $250/yr each. David earns more
  from one VeritaAssure Hospital tier referral ($1,999 × 50% Y1 =
  $1,000) than from a full year of forum operations.
- Break-even on real management compensation requires ~500 paying
  members at $50/yr. 500 lab-leader members is harder than it sounds.
  Mature professional society forums struggle to keep that many
  actively paying for digital-only access.
- Realistic David labor at 250 members: 5-8 hrs/week × 52 weeks =
  260-416 hrs/yr for ~$6,250 = $15-24/hr. He will go consult
  at $200/hr instead.

**Verdict:** the IDEA is right (real gap, real demand). The
EXECUTION as proposed is wrong: wrong pricing (too low to signal
value or fund management), wrong incentive (David needs base + equity
not pure rev share at $5/yr), wrong positioning (should be lead funnel
into VeritaAssure not a standalone profit center), wrong commitment
size (one-person shop running a 5th product surface is too much).

**Recommended alternative (not blocked, can do anytime):**

Spin up a free, invite-only Slack or Discord ("Verita Network" or
similar) restricted to lab leaders the operator personally vets, plus
VeritaAssure customers. Positioned as relationship glue + market
intel + product feedback channel, not a profit center. Cost: $15-50/mo
platform + evening hours. Upside is the SaaS lead funnel. Pair with a
quarterly virtual roundtable (90 min, 15-25 invited attendees,
topic-driven, recorded) for the "scheduled high-signal event" while
the Slack/Discord is the "always-on water cooler between events."

**Decision rule to revisit the paid forum:** answer yes to all three
before building: (a) willing to commit 5-8 hrs/week to moderation for
12-18 months even at sub-$5k/yr revenue, (b) explicitly funding it as
a lead funnel into VeritaAssure rather than a P&L, (c) willing to cap
VeritaAssure day-job hours to make room. If any answer is no, build
the free Slack + roundtable alternative first and revisit the paid
forum when VeritaAssure has 50+ paying customers and can fund a
part-time community manager.

**Pre- vs post-COLA:** Post-COLA. No customer urgency.

**Status:** Open. Work-pass 2026-10-04: BUSINESS DECISION, needs Michael. SWOT verdict stands (do not build a paid forum; economics kill it). The recommended free invite-only Slack/Discord plus quarterly roundtable is an operational commitment, not a build, gated on the three-question decision rule above. No code to produce. Needs Michael's go/no-go on the free alternative.

---

_(item #33 closed 2026-05-28; see C27 below)_

---

_(items #34 and #35 closed 2026-05-24; see C23 and C24 below)_

---

_(item #36 closed 2026-09-29; shipped PR #1368, prod-verified, see C52 below)_

---

_(item #37 closed 2026-05-28; see C28 below)_

---

### 38. Screen-capture video: VeritaCheck method comparison in 60 seconds

**Effort:** S for agent prep (storyboard / pre-fill / captions / checklist); ~1 hour of operator time to record + light post-production.
**Importance:** Medium — operator selected this as the highest-impact positioning artifact during the 2026-05-12 review; pairs with item #37 to give Lisa both a static and a motion asset for follow-ups.

**What:** 30-60 second screen recording demonstrating the "experienced lab tech figures it out in seconds" claim. From blank method-comparison study to completed PDF, no voiceover, no narration, visible cursor motion. Embed autoplay-muted on the marketing site, include in conference follow-up emails.

**Why it parks:** The recording itself has to be done by a human with screen-capture software (Loom, ScreenPal, OBS Studio, Camtasia). The agent cannot drive a live recording. What the agent CAN deliver and will when this item is taken up: storyboard + click-by-click script, demo lab pre-fill state so the take is clean on first try, on-screen caption text, post-production checklist (crop, blur any CLIA number, add CTA card at end).

**Fix shape (when taken up):** Agent ships the recording-prep package (storyboard / pre-fill / captions / checklist). Operator or marketing sits down with Loom and records the take. Total: roughly 1 hour of operator time including a second take if needed.

**Source:** 2026-05-12 conversation. Michael selected the screen-cap video as the highest-impact positioning artifact, then asked the agent to record it. Agent does not have screen-recording capability; option parked rather than fudged.

**Status:** Open. Re-parked 2026-05-27 (originally PR #117, abandoned with merge conflicts then closed-and-re-authored at current numbering). Pending operator decision on whether to record this themselves or pivot to one-pager (item #37). Work-pass 2026-10-04: AGENT HALF DELIVERED. docs/VERITACHECK_DEMO_VIDEO_PREP.md ships the full recording-prep package (storyboard, click-by-click script grounded in real UI labels, demo-lab pre-fill state, on-screen captions + end card, post-production checklist). Remaining is operator-only: the ~1hr recording and a real paired dataset from Michael's own records.

**Pre- vs post-COLA:** Post-COLA, conference-driven.

---

### 39. MediaLab parity hardening (VeritaPolicy approval workflow depth)

**Effort:** L (1-2 weeks for the high-value items; each independent feature is M)
**Importance:** Medium-High — the C29 build shipped the surface MediaLab markets but depth is shallower than their 30-year-hardened version. Closing the gaps converts a "we replicate MediaLab" claim into a "we replace MediaLab" claim at the same price point.

**What:** The VeritaPolicy approval workflow build (C29, 2026-05-29) hit roughly 60-70% MediaLab feature surface. The following gaps remain when comparing against an enterprise MediaLab Document Control deployment:

- **Quizzes on attestations.** Schema columns `quiz_score` and `quiz_total_questions` exist on `policy_attestations` but the quiz authoring + presentation UI was scoped out of Phase 4. MediaLab labs use 5-10 multiple-choice questions per policy to confirm comprehension, not just attestation. Adds compliance defensibility.
- **PDF watermarking.** MediaLab burns user name + timestamp into every downloaded PDF copy as a deterrent against forwarding. We serve clean originals. Add Puppeteer-style overlay at download time.
- **Per-policy role mapping at department level.** MediaLab lets a lab say "only Microbiology Lab Director can approve Microbiology policies." Our `required_role` is per-step on the workflow, not per-document-by-manual.
- **Approval delegation.** When a reviewer is on vacation, MediaLab supports temporary delegation to a designate. We have no delegation model.
- **In-browser DOCX editing.** MediaLab has a structured editor that creates a Table of Contents from headings. We treat documents as opaque files; revisions require a new upload.
- **Reviewer-phrase library.** MediaLab provides standard reject phrases ("Section X needs CFR citation"). Our reviewer enters free-text comment.
- **Cross-policy linking.** MediaLab lets one policy reference another by ID; surveyor can click through. Ours treats each doc as an island.
- **SSO / Active Directory integration.** Lab IT departments expect AD login. We have email+password only.
- **Excel export of compliance dashboard.** Surveyors want xlsx with VeritaAssure brand colors and proper headers. Our dashboard is JSON only. Half-day to add per the Excel Standard in CLAUDE.md §6.
- **Print stylesheet.** MediaLab has a print view. Ours uses default browser print.
- **Auto-expire cron** (was deferred from Phase 6B). Approved policies past `next_review_date` by 60+ days currently stay status='approved' with a visual red flag. MediaLab auto-flips to expired and locks edits.
- **Real-time customizable email templates.** Our review reminder emails are hardcoded. MediaLab lets each customer customize subject and body.

**Why it parks:** None of these gaps block customer sign-ups; the build is functional and verified at the API + UI happy-path level (35/35 API + 19/19 UI test pass against live prod per the qa-policy-build.js + qa-policy-ui.js scripts). But they will surface in head-to-head sales calls against MediaLab. Triage by hot prospect feedback.

**Recommended sequence when taken up:**
1. ~~PDF watermarking~~ **SHIPPED.** The policy DOCX download stamps "Downloaded by <name> on <date>" (server/veritapolicyDocx.ts) plus the opt-in UNCONTROLLED COPY diagonal watermark; policy documents download as DOCX, so there is no clean-PDF path left to overlay.
2. ~~Quizzes on attestations~~ **SHIPPED.** PolicyQuizAuthorDialog (authoring) + StaffPortal QuizTake / attempt endpoint (staff take + score).
3. ~~Excel export of compliance dashboard~~ **SHIPPED.** GET /api/labs/:labId/veritapolicy/compliance/xlsx plus an "Export xlsx" button on the Compliance Dashboard (per the §6 Excel Standard).
4. ~~Auto-expire cron (closes Phase 6B gap, ~half day)~~ **SHIPPED 2026-06-02.** PR #510 = state-machine flip with audit log + admin endpoint. PR #514 = write-path edit-lock guards on PATCH /documents/:id and POST /attestations/:id/complete (other paths already had state-machine guards). End-to-end verified on prod via qa-auto-expire-test harness (PR #511 + #512 + #513 + the harness extension in #514).
5. ~~Print stylesheet (minor polish, ~1 hour)~~ **SHIPPED 2026-09-29 (PR #1367).** Print button + @media print on the Compliance Dashboard (prints only #compliance-print-area, drops app chrome/.no-print).

All five small parity items are now shipped. Items 6+ (SSO/AD, approval delegation, in-browser DOCX editing, per-department role mapping, reviewer-phrase library, cross-policy linking, customizable email templates) are larger and remain customer-triggered.

**Source:** 2026-05-29 QA pass after C29 shipped (qa-policy-build.js + qa-policy-ui.js: 54/54 happy path verified). Honest depth assessment surfaced by Michael's "how confident are you" question — see C29 entry for full QA receipts.

**Status:** Small-item sequence COMPLETE (items 1-5 all shipped; verified against the codebase 2026-09-29, print view PR #1367). **Note (2026-10-04):** the "delegation" listed here is VeritaPolicy APPROVAL-workflow delegation and remains open. A separate capability, CLIA laboratory-director RESPONSIBILITY delegation, shipped this session as the Letter of Delegation feature (VeritaStaff Delegations tab; signed letters gate QC period-review co-sign and finding closure; PRs #1442-1445) and is not this item.

Work-pass 2026-10-04: STATUS CORRECTED + remaining items scoped. Verified in-code that 4 of the 7 "remaining" depth items actually shipped THIS session: per-department role mapping (policy_manual_approvers + manualId override in canUserApproveStep), reviewer-phrase library (REJECT_PHRASES), cross-policy linking (policy_document_links), and customizable email templates (policy_email_templates). SSO is scoped (docs/SSO_AD_DESIGN.md, PR #1458). Two depth items remained unbuilt after the status review: approval delegation and in-browser DOCX editing. Both specced in docs/VERITADC_PARITY_REMAINING_DESIGN.md.

**Approval delegation: SHIPPED 2026-10-04** (on Michael's go). A reviewer (or owner/admin) names a temporary designate who inherits their approval eligibility for a date window; delegation layered onto canUserApproveStepDelegated / countEligibleReviewersForStepDelegated with two self-approval laundering guards; delegate's approvals attributed to the delegator on the signoff + audit. CRUD + a Delegations dialog in My Documents. Verified: scripts/verify-veritadc-approval-delegation.ts (19/19 incl. both guards), API guards (self-delegation/bad-dates 400), and a full local browser exercise (create -> ACTIVE -> revoke). PR #1460 merged + deployed 2026-10-04 (c6ef093f, health 200, route 401 unauthenticated); approve-by-delegate E2E verified locally (PR #1462 doc). Prod click-through was not performed. Remaining on this item: in-browser DOCX editing only.

**In-browser DOCX editing:** still a multi-week L; hold until a prospect names it (see the design doc's recommendation).

**Pre- vs post-COLA:** Post-COLA. Defensive against MediaLab in head-to-head sales calls.

---

### 42. Outbound demo-invite messaging campaign to 1st-degree LinkedIn contacts

**Effort:** L (1 week prep + 4-6 weeks of staged sends)
**Importance:** High. Converts existing warm network (~2,500 1st-degree contacts and growing weekly via the connection-invite cycle) into a demo pipeline. Complements COLA cohort outreach and content-driven inbound; only pipeline that leverages contacts already in 1st degree. The contact base is being built right now (80 sent this week, 80/week ongoing) and will be ready for activation within 4-6 weeks.

**What:** A staged outbound DM campaign walking Michael's 1st-degree LinkedIn contacts through tier-segmented demo invitations for VeritaAssure. Goal: convert warmest contacts into demo conversations first, then chain into trials and paid subscriptions. Separate pipeline from COLA cohort follow-up and from content-driven inbound; all three feed the same demo funnel but originate from different warmth sources.

**Tiered targeting (conversion-likelihood ranked):**

- **Tier 1 — Engagers + role match (highest conversion).** 1st-degree contacts who liked, commented, or shared a Michael Veri post in the last 90 days AND whose role is Lab Director, Quality Officer, Lab Manager, or Hospital Lab Leadership. Estimated size: 30-60 contacts. Highest expected conversion rate.
- **Tier 2 — Role match, no engagement.** 1st-degree contacts whose role matches the ICP but have not engaged with content. Accepted the connection but not been activated. Estimated size: 300-500 contacts. Moderate conversion.
- **Tier 3 — Allied roles.** Quality managers, lab supervisors, POC coordinators. Influence the buyer but are not the decision-maker. Estimated size: 200-400 contacts. Lower direct conversion, useful for organizational reach.
- **Tier 4 — Adjacent (consultants, accreditor staff, IVD vendors).** Influencer audience, not buyers. Estimated size: 100-300 contacts. Low conversion to direct demo, useful for word-of-mouth referrals.

**Message templates per tier:**

- Tier 1: Reference specific engagement and align to a VeritaAssure module. Anchor example: "Your comment on the reference-range post got me thinking about how VeritaCheck handles exactly that workflow, would you want a 30-minute walkthrough?"
- Tier 2: Soft intro anchored on Michael's recent content arc and Lab Management 101 release, then demo offer. No assumption of prior engagement.
- Tier 3: Position as a tool that makes their work easier in support of their director. Demo offer or trial.
- Tier 4: "fyi this exists, happy to walk you through it if useful" framing. No hard demo push.

**Pre-implementation work (must be done before any send):**

1. Export 1st-degree contact list from LinkedIn (Settings, Get a copy of your data, generates CSV with name, headline, email, company, position, connected-on date).
2. Cross-reference with content engagers list (manual pull from past 90 days of post analytics, or LinkedIn SSI export).
3. Build Tier 1-4 buckets in a working CSV with columns: name, LinkedIn URL, role, tier, engagement notes, sent date, replied, demo booked, outcome.
4. Filter out: existing VeritaAssure customers (pull current customer list from production DB), named contacts in COLA follow-up batch, contacts who explicitly opted out, contacts whose last LinkedIn activity is more than 2 years old.
5. Draft tier-specific message templates, store in `linkedin_search/outbound_messages_v1.md`.
6. Confirm cap pacing: LinkedIn 1st-degree DM cap is roughly 80-100 per day rolling. Plan 20-30/day to stay safely under.

**Pacing strategy:**

- Week 1: Tier 1 only, small batch. Watch reply and demo-book rate. Refine messaging if signal is weak.
- Weeks 2-4: Tier 2 staggered batches of 20-30/day, paced to LinkedIn rate limits.
- Week 5: Tier 3 after Tier 1/2 momentum is visible.
- Week 6+: Tier 4 light cadence, lowest priority.

**Risks to surface at implementation time:**

- Mass identical DMs trigger LinkedIn spam detection. Vary message bodies per recipient.
- LinkedIn ToS allows messaging 1st-degree but discourages bulk patterns. Pace strictly.
- Tier 1 reply rate is the leading indicator. If Tier 1 does not convert, do not push Tier 2.
- Coordinate with COLA cohort sender list to prevent double-touch of named contacts.
- Existing customers need to be deduped from the contact list. Pull current customer list from production DB as the source of truth.

**Implementation triggers (decide when to lift off parking lot):**

- Lab Management 101 has shipped (book gives a tangible asset to attach to the message).
- Tier 1 engagement size has hit 50+ (worth running).
- COLA cohort outreach concludes (avoid double-loading sender time).
- Michael has 2-3 hours/week to drive batches via in-panel Claude.

**Source:** 2026-06-04 session, after weekly LinkedIn invite batch completion (80 sent, cap hit at #84 Victoria Allen).

**Status:** Parked. Plan documented. Implementation deferred until trigger conditions met. Work-pass 2026-10-04: AGENT HALF DELIVERED. Pre-implementation step 5 done: linkedin_search/outbound_messages_v1.md ships the 4 tier message templates with 3-4 varied bodies each (anti-spam), merge fields, hard copy rules, and a reply-handling + pacing reference. NEEDS MICHAEL: steps 1-4 (LinkedIn contact export, engager cross-ref, Tier 1-4 bucket build, customer/COLA dedupe) and the sends, plus confirming the lift-off triggers (LM101 shipped, Tier 1 at 50+, COLA concluded, 2-3 hrs/wk available).

---






_(item #50 closed 2026-09-28; shipped PR #1356, prod-verified, see C49 below)_

---

_(item #51 closed 2026-09-28; shipped PR #1358, prod-verified, see C50 below)_

---

_(item #52 core closed 2026-09-28; shipped PR #1361 member-picker, prod-verified, see C51 below. Residual optional UX tracked there.)_

---

_(item #57 closed 2026-10-07; duplicate cleanup approved in full by Michael and deployed in PR #1501, see C75 below; vendor batches may resume)_

---

_(item #58 closed 2026-10-07; shipped PR #1481, deployed 2026-10-06, see C63 below)_

---

_(item #59 closed 2026-10-07; PR #1495 deployed, see C73 below)_

---

_(item #60 closed 2026-10-07; 74 CAP programs loaded 2026-10-06, see C64 below)_

---

### 61. VeritaMap: remove duplicate demo maps (dedupe tool shipped; awaiting selection)

**Effort:** XS (under 1 day)
**Importance:** Low-Medium — demo-lab hygiene; not customer-facing.

**What:** Michael created many maps while demoing and asked to remove
duplicates. The read-only-by-default admin `dedupe-maps` endpoint shipped
2026-10-06 (PR #1475). The audit found only a handful of strict content
duplicates (plus false matches from empty maps, and items in Lisa's live lab 4
that must not be touched). Needs Michael to pick what to delete — the strict
dupes, or a broader clean-out of lab 3's 21 maps. Deletion runs scoped per lab
with full cascade once he approves the ids.

**Source:** Michael, 2026-10-06.
**Status:** Open. Tool live; awaiting Michael's deletion selection.

---

_(item #62 closed 2026-10-07; PR #1474 merged + deployed 2026-10-06, see C65 below)_

---

_(item #63 closed 2026-10-07; PR #1493 deployed, prod receipt 2/2, see C67 below)_

---

_(item #64 closed 2026-10-07; three real causes fixed, PR #1486 + #1487 deployed, see C66 below)_

---

_(item #65 closed 2026-10-07; fix deployed in PR #1464 and the MedStar reply sent; see C79 below)_

---

_(item #66 closed 2026-10-07; PR #1489 deployed, see C68 below)_

---

_(item #67 closed 2026-10-07; guard removed on Michael's option 1, PR #1498 deployed, see C74 below)_

---

_(item #68 closed 2026-10-07; PR #1491 deployed, see C69 below)_

---

_(item #69 closed 2026-10-07; PR #1490 deployed, see C70 below)_

---

_(item #70 closed 2026-10-07; PR #1492 deployed, see C71 below)_

---

_(item #71 closed 2026-10-07; built and live in PR #1503 (5ec248c1); see C78 below)_

---

_(item #72 closed 2026-10-07; phase A built and live in PR #1505 (6f937201); see C77 below; phase B is #79)_

---

### 74. Env-gated Playwright specs never run in CI; two shipped unrunnable

**Effort:** S (1-3 days)
**Importance:** Medium. The Gate 3 step 8 receipts for authenticated UI are skipped in CI (no PW_TOKEN), so a spec can ship broken and nobody notices.

**What:** playwright-smoke runs 74 specs as "skip without PW_TOKEN". The
2026-10-07 local pass over merged UI PRs found two that could never pass as
written: module-howto-card-layout.spec (#1472) used two routes that do not
exist and measured the width of a text node, and
veritacheck-analyte-multiselect.spec (#1481) looked for a button that lives on
a package's Analytes tab, not the list page. Both repaired in PR #1493 and
proven on a local build (5/5 and 1/1). The fixes themselves were fine; the
receipts were not. A CI QA lab with a scoped PW_TOKEN secret (own test
system, never a client lab) would run these on every PR.

**Source:** overnight audit 2026-10-07 (local Playwright pass, see overnight log section 16).
**Status:** BUILT 2026-10-07 (PR #1507) and growing: the blocking "Sandbox receipts" step, seed_sandbox.mjs (now also flags Calcium exempt), mint_token.mjs, and the runbook scripts/ci-sandbox/finish_sandbox.sh (provision, mint, seed, secrets, Michael as admin, first run, one command once the owner exists). sandbox-receipts.txt now lists 12 specs (8 original plus the cal-ver exemption, module progress, VeritaMap date entry and VeritaComp element date specs), all proven on a local server seeded by the script. Still blocked on the sandbox owner signup (Q9: verilabguy+ci-sandbox@gmail.com), then finish_sandbox.sh does the rest.
---

_(item #75 closed 2026-10-07; fixed in the same change as #78, PR #1514 (44ca3e22); see C82 below)_

---

### 76. VeritaMap: Manual Diff cell lines never pair with the analyzer differential, so no correlation is triggered

**Effort:** S (1-3 days)
**Importance:** High. 42 CFR 493.1281 comparability: the same analyte on two methods (manual differential vs the hematology analyzer) must be correlated twice a year; when the map cannot see they are the same test, the requirement never appears and readiness over-reports.

**What:** Correlation grouping in the map intelligence matches instruments on
the exact analyte string. The library's "Manual Differential" entry names the
cell lines "Lymphocytes / Neutrophils / Monocytes / Eosinophils / Basophils";
the hematology analyzers (Sysmex XN-1000/XN-2000 and the rest) name them
"LYMPH% / NEUT% / MONO% / EO% / BASO%" (plus the absolute "#" rows). Same
measurand (the percentage differential), different strings, so Lymph on the
manual diff and LYMPH% on the analyzer show as two unrelated tests and the
Pri/Backup correlation requirement is never raised. Same for every cell line.
Fix: a canonical-analyte layer for correlation grouping (manual "Lymphocytes"
<-> analyzer "LYMPH%" / "Lymphocytes (%)" and the same for NEUT/MONO/EO/BASO;
the "%" row is the comparable one, not "#"), plus harmonizing the library's
Manual Differential names toward the analyzer convention so new maps do not
inherit the split. Receipt: a map with Sysmex XN + Manual Differential shows
one correlation requirement per cell line, and the existing name-based matches
are unchanged.

**Source:** Michael, 2026-10-07 morning ("Manual diff Lymph is the same as lymph% on the hematology analyzers, but they are showing as different tests and not triggering correlations. Same for the other cell lines").
**Status:** Open. Names on both sides confirmed in the library; build on request.

---

_(item #77 closed 2026-10-07; part A live in PR #1513 (cf624cde) and part B in PR #1517 (31a0742c); see C83 below)_

---

_(item #78 closed 2026-10-07; built and live in PR #1514 (squash 44ca3e22); see C81 below)_

---

_(item #79 closed 2026-10-07; built and live in PR #1513 (squash cf624cde); see C80 below)_

---

### 80. VeritaPT: the CAP program catalog behind the enrollment picker is incomplete and partly stale (FH9 and RT4 missing, FH2P obsolete)

**Effort:** S (1-3 days)
**Importance:** High. The enrollment picker is how a lab records its PT coverage for 42 CFR 493.801; a catalog that lacks the program a lab actually buys forces a wrong pick or "Other", and the coverage and readiness views are only as good as the catalog. Lisa hit it on her own lab the first time she used the dialog.

**What:** The "Manage PT Program Enrollments" dialog lists CAP programs from the
pt_vendor_programs table (GET /api/veritapt/programs), loaded through the admin
vendor-programs endpoint from operator-verified data with provenance in the
source column. Production holds 74 CAP programs, source "CAP Surveys catalog
(estore.cap.org), compiled 2026-10-06", and only six of them are Hematology:
FH2, FH2P, BCP, BP, BMD, ESR. Lisa (2026-10-07): FH9 is missing, RT4 is
missing, FH2P is an obsolete event, "I'm sure there are more." The CAP Surveys
catalog runs to several hundred programs, so a 74-row compile is a thin first
pass, not a catalog. (The API vendor list, 225 programs loaded 2026-10-05, has
not been checked the same way.) Fix: rebuild the CAP list from the current CAP
Surveys catalog as the source document, code, name, category and analytes per
program, verified by a CAP-enrolled director before load (Lisa is the natural
verifier; the loader's never-fabricated rule stands); reload with replaceVendor
CAP and the catalog edition recorded in source; mark retired programs such as
FH2P inactive rather than deleting them so existing enrollments stay valid;
then spot-check the API list against its own current catalog. Receipt: the
dialog on lab 5 offers FH9 and RT4 under Hematology, FH2P is gone from the
picker, and an existing enrollment on a retired code still displays.

**Source:** Lisa, 2026-10-07 ~10:20 (screenshot, lab 5 VeritaPT enrollments dialog).
**Status:** VERIFICATION STEP 2026-10-07: Lisa supplied the CAP Surveys 2026 and 2027 catalog PDFs; scripts/cap_catalog/extract_cap_catalog.py (pdftotext -layout parse: 756 codes in 2026, 764 in 2027, FH9 and RT4 present, FH2P absent from both) and build_cap_review_workbook.py produced the review workbook at Verita Products/VeritaPT/CAP_Surveys_catalog_review_2026-10-07.xlsx (773 rows: add 696, keep 72, retire FH2P and CMP3, 3 low-confidence rows). Scripts merged (PR 1d9e70e2). Waiting on Lisa's verification; then one admin load with the catalog edition as source, retired codes set inactive (4 existing CAP enrollments keep displaying). API vendor list still to check the same way.
---

### 81. Antimicrobial stewardship: the laboratory's share of the hospital program, inside VeritaAssure

**Effort:** M (1-2 weeks) for the lab-side scope; XL if it became a pharmacy-led stewardship system, which is not our lane
**Importance:** High. Every hospital lab is asked by its stewardship committee for an antibiogram and for evidence of lab participation; CMS makes the program a hospital condition of participation (42 CFR 482.42, infection prevention and control and antibiotic stewardship programs) and the TJC medication-management standard on antimicrobial stewardship surveys it. Nothing in the market packages the lab's piece.

**What:** Scope, not build (Lisa, 2026-10-07: "put that in the parking lot"). The
likely shape is the laboratory's obligations to the hospital program, not the
pharmacy's: an antibiogram builder on CLSI M39 conventions (first isolate per
patient per period, the 30-isolate reporting threshold, an annual table with
trends), documentation of selective and cascade susceptibility reporting rules,
turnaround tracking for rapid diagnostics (Gram stain, blood culture
identification), the committee-participation log (lab representation, minutes,
actions), and the crosswalk to 482.42, the TJC standard and the CAP
microbiology checklist. What already exists to build on: VeritaBench PI carries
the blood culture contamination rate; the VeritaPolicy master list already notes
antimicrobial stewardship support (antibiogram cadence and reporting cascades)
on the microbiology policy; 42 CFR 482.42 is in the requirement library; the
microbiology policy template 040 covers isolation and identification. Open
questions for the scope doc: which module hosts it (VeritaBench PI, VeritaQA or
a new module), isolate data intake (LIS export vs manual), and whether the
antibiogram is a PDF deliverable or a live table.

**Source:** Lisa, 2026-10-07 ~13:40 ("Lets scope an antimicrobial stewardship program in the system"), then parked before scoping.
**Status:** Open. Scope document on request (docs/ANTIMICROBIAL_STEWARDSHIP_SCOPE.md); no build.

---

### 82. Records written by a user who holds seats under several owners get stamped with another owner's user id

**Effort:** S-M (fix the stamping, repair rows, add a guard)
**Importance:** High. Wrong attribution on real records, and it already produced a false read in the St. Charles deal notes.

**What:** Since 2026-10-01 Michael (user 17) holds active seats under three other owners: user 81 (St. Charles, lab 31), user 85 (lab 32) and user 74 (labs 25-28). His writes since then are being stamped with user 81, Melissa Humphrey's account: 6 VeritaCheck studies in Michaels Lab (lab 3, created 10/05-10/07) and 20 VeritaTrack tasks in Redington-Fairview (lab 34, created 10/07 18:50 UTC while he built the Coag map) carry user_id 81, and the audit_log owner column on his 10/06-10/07 deletes reads 81. Melissa has not signed in since 2026-09-18, so none of these are hers. The rows are lab-scoped by lab_id, so the lab-scoped readers show them in the right lab; the damage is attribution, the audit trail, and any reader or credit path that still keys on user_id. Likely cause: the same seat-owner resolution that made Lisa's reads return Michael's data in August (see the seat-accept / display-scoping memory), here on the write side. Fix direction: stamp writes from the active lab's owner (labs.owner_user_id for the scoped lab) or the actor, never from an arbitrary seat owner; repair the 26 rows from 81 to 17 with a dry run first; add an audit guard so a new write path cannot regress.

**Source:** inbox check 2026-10-07 evening (Coding), found while tracing the backup anomaly and the RFGH lab build.
**Status:** Open.

---

### 83. A lab created from the account settings page gets no owner membership, so the owner is locked out of it

**Effort:** XS for the code, plus a one-row data repair
**Importance:** High and time-bound. The St. Charles reply scheduled for Friday 2026-10-09 4:00 PM ET tells Melissa the full suite is open on her lab.

**What:** The settings save path in server/routes.ts (about line 31741, "Owner doesn't have a lab yet -- create one") inserts a labs row and repoints users.lab_id but never inserts the owner's lab_members row; the /api/labs/me/add path does it correctly. labScopeMiddleware requires an active lab_members row, so every /api/labs/:id call returns 403 for that owner. Two labs on production have an owner with no membership: lab 31 St. Charles Health System - Bend (Melissa Humphrey, created 2026-09-18 21:31 UTC, 15 minutes after her signup; she signed in twice that day and never again) and lab 20 "ery" (junk signup). Fix: insert and audit the owner membership in that path, check the db.ts boot backfill for the same gap, add an integration test through the real route, then add the missing owner row on lab 31 (admin add-lab-membership, role owner, primary). The lab 31 write was blocked in the 10/07 session pending Michael's approval; lab 20 is junk and can be left.

**Source:** inbox check 2026-10-07 evening (Coding).
**Status:** Open. Lab 31 repair awaiting approval; it needs to land before the Friday send.

---

## CLOSED (audit trail)

### C83. VeritaMap: calibration verification "Not applicable" per test, and the exemption flags honored on the map page (was #77)

**Effort:** was S / **Importance:** High. Lisa's live case on Milford CCL Hematology (45 flagged tests shown as required, 0 percent score).

**Closure evidence:** Part A, PR #1513 (squash cf624cde, live 2026-10-07): the map detail returns cal_ver_exempt per instrument row and per test; the map page derives Exempt from the instrument-level flags as well as WAIVED in the cell, the header count and the score. Part B, PR #1517 (squash 31a0742c, live 2026-10-07): veritamap_tests.cal_ver_na with a required reason and who/when; both single-test update routes accept it (400 without a reason) and clear it on undo; the map page offers an N/A control with a reason list on every required row and shows "N/A: reason" with "Cal ver required again"; the labwide page and the Excel export show it (the export also shows "Exempt (instrument exemption)"); VeritaCheck coverage treats a per-test N/A like the row flags. Receipts: tests/integration/veritamap-cal-ver-exempt.test.ts 12/12, tests/integration/veritamap-cal-ver-na.test.ts 9/9, tests/playwright/veritamap-cal-ver-exempt.spec.ts and veritamap-cal-ver-na.spec.ts 1/1 each (both in the CI sandbox receipts list), light and dark screenshots.

### C82. VeritaComp assessment dialog: Element 2 (and 3, 4) date picker nearly unclickable (was #75)

**Effort:** was XS / **Importance:** Medium

**Closure evidence:** Fixed in PR #1514 (squash 44ca3e22, live 2026-10-07) together with #78: the Element 2 / 3 / 4 dates use the shared DateEntry control and the Element 2 column was widened from 128 px so the calendar control is fully visible. Receipt tests/playwright/veritacomp-element-date-entry.spec.ts 1/1 (typeable in the dialog, calendar control inside the dialog bounds, popover opens).

### C81. VeritaMap: manual date entry is clunky (was #78)

**Effort:** was S / **Importance:** Medium

**Closure evidence:** PR #1514 (squash 44ca3e22, live 2026-10-07). client/src/lib/dateEntry.ts (masking, loose parsing with exact round-trip and a 1900-2100 guard, display helpers; receipt scripts/verify-date-entry-parse.ts 25/25) and client/src/components/ui/date-entry.tsx (typed MM/DD/YYYY with the slashes inserted, paste, Enter/Escape, calendar popover on the existing Calendar and Popover primitives, Today, Clear; ISO in and out exactly like the native control so save paths are unchanged; invalid text flagged and never saved). Used by VeritaMapMapPage DateCell (Cal Ver, Method Comparison, Precision, SOP Review) and the VeritaComp element dates. Receipts: tests/playwright/veritamap-date-entry.spec.ts 1/1 (typed saves ISO, nonsense refused with no PUT, Today saves today, Clear restores empty) plus the AMR autosave regression 1/1; light and dark screenshots. The other ~60 native date inputs across the app adopt the control per page as they come up.

### C80. In-app Getting Started phase B: live checkmarks on the module how-to cards (was #79)

**Effort:** was XS / **Importance:** Medium

**Closure evidence:** PR #1513 (squash cf624cde, live 2026-10-07). shared MODULE_STEP_KEYS maps each module to its system-path steps; ModuleHowToCard reads the lab's getting-started payload under the same react-query key as the dashboard card and renders a "Your progress" block with done / to-do marks and the step detail; modules with no derived step are unchanged. The receipt found and the PR fixed two more defects: server/gettingStarted.ts scored the roster step (and the competency-cadence count) by staff_employees.lab_id, the staff_labs sequence, instead of tier2_lab_id (same class as the #59 roster fix; integration receipt now builds staff through the real routes with diverging ids); and VeritaMapAppPage rendered its how-to card only inside the signed-out wall, so signed-in users never saw it on the map list. Receipts: tests/integration/getting-started.test.ts ALL PASS; tests/playwright/module-howto-progress.spec.ts 3/3 (in the sandbox receipts list).

### C79. VeritaQC: Levey-Jennings chart and Westgard rules used two different mean/SD bases (was #65)

**Effort:** was S / **Importance:** High. Live on a paying account (MedStar, Gameday Plymouth): a 1-3s rejection drawn near the chart mean.

**Closure evidence:** Decision 2 (Michael, relayed by Lisa, 2026-10-07): the programmed (manufacturer) mean/SD is the single basis, because the MedStar director runs QC against the manufacturer's ranges. PR #1464 (squash 03db1fe4, live 10:41 ET): evaluateWestgardForLot extracted to server/qcWestgard.ts and scored against qc_control_lots.mfr_mean/mfr_sd, the monthly PDF on the same basis; receipt scripts/verify-veritaqc-westgard-mfr.ts 8/8. Stored violations not recomputed. Production numbers behind the call (read-only copy 2026-10-07): Plymouth PSA FREND B Level 1 lot 6361A26001, 9/28 result 1.39 = +3.2 SD on the lab's 30-run history (1.067/0.100) and +0.3 SD on the programmed 1.29/0.35 loaded 9/30 at Mike's request. Reply to Mike Hiltunen sent 2026-10-07 10:37 ET from info@ (Lisa, from Outlook): both Plymouth charts explained, fix stated, the bias-rule consequence of a programmed mean the lab does not run at (10 consecutive below 1.29 fires 10-x on every run), 42 CFR 493.1256(d)(10)(ii) on verifying stated values, and the offer to program the lab's own established mean/SD or re-score existing runs on his say-so. The CLSI C24 locked-established-basis design was recommended and declined; it stays available if a client asks for it.

### C78. Milford (labs 4/5) house policy format for VeritaDC drafts (was #71)

**Effort:** was M / **Importance:** Medium. Lisa's lab; first renderer-based instance of the standing house-format courtesy (SCAHC was artifact-based).

**Closure evidence:** Michael's option 1 (2026-10-07). PR #1503 (squash 5ec248c1, live): server/veritapolicyHouseFormats.ts renders the UMass Milford layout (header block, I. Purpose / II. Policy / III. Guidelines / IV. Personal Safety Requirements / V. References, Revision History table, house footer with facility path, policy number, revision and page), generatePolicyDocxBuffer dispatches on the lab's docx_format, both DOCX routes read it, veritapolicy_house_numbers holds Lisa's numbers, and POST /api/admin/veritapolicy/set-house-format switches a lab on (dryRun, audited). Receipt tests/integration/veritadc-house-format.test.ts 20/20; samples scratchpad/milford/VeritaDC_001_umass_milford_sample.docx and the stock sample delivered. Design and as-built in docs/VERITADC_HOUSE_FORMAT_DESIGN.md. NOT yet switched on for labs 4/5: that is one admin call once Lisa confirms the facility path and the first house numbers (Michael's go).

### C77. In-app Getting Started, phase A: dashboard card scored from the lab's own tables (was #72)

**Effort:** was M / **Importance:** Medium

**Closure evidence:** Michael's option 1 (2026-10-07). PR #1505 (squash 6f937201, live): shared/gettingStartedContent.ts (keys, derived/manual kind, lab-scoped routes), server/gettingStarted.ts derives the 19 statuses from real tables, lab_onboarding_checks stores only the two manual Phase-5 ticks and the per-lab dismissal, GET/POST /api/labs/:labId/getting-started[/check], GettingStartedCard on the dashboard (N of 19, first incomplete phase open, Go links, auto-hide at 100 percent with a show-again link). Receipts: tests/integration/getting-started.test.ts 19/19 and tests/playwright/getting-started-card.spec.ts 1/1 (now in the CI sandbox receipts list). Phase B (module-card checkmarks) is #79.

### C76. VeritaMap "Failed to delete map": half-cascade left shells, VeritaStaff FK blocked the rest (found and fixed 2026-10-07)

**Effort:** was S / **Importance:** High. Michael could not delete four demo maps on lab 3; the same code path would have gutted any map whose instrument was ever assigned to a staff member.

**Closure evidence:** Production log: `DELETE /api/labs/3/veritamap/maps/107` and `/106` -> 500 `FOREIGN KEY constraint failed`. Read-only DB copy: maps 106/107/108 had 0 tests, 0 instrument_tests, 2 instruments and 6/2/2 `staff_duty_change_events` rows pointing at those instruments; 109 still had its data plus 4 events. Cause: the delete ran seven separate statements with no transaction, died at the instrument delete on the VeritaStaff foreign key, and left the map as a shell (Michael's observation "every undeletable map shows 0 tests" was the scar, not the cause); the cascade was copy-pasted in five places. PR #1500 (merged 07:55, squash 7874a881, live in e51795e8): `server/veritamapDelete.ts` single-transaction cascade that also clears `staff_employee_instruments` and `staff_duty_change_events` for the map's instruments, `mapDeleteBlockers` names any remaining referrer in a 409, used by both routes, admin dedupe-maps, the demo purge and account deletion. Receipt `tests/integration/veritamap-delete-cascade.test.ts` 13/13 with `foreign_keys=1`: duty-tracked map deletes clean, an unanticipated blocker answers 409 and the map stays whole, legacy route same cascade, other lab refused. Michael's click on Sanford / FGH / VP's / Angie is the prod exercise.

### C75. VeritaMap test-menu accuracy audit: Siemens/Abbott duplicate cleanup (was #57)

**Effort:** was M / **Importance:** High

**Closure evidence:** Michael approved the full plan (option 2, 2026-10-07 morning). PR #1501 (merged 07:58, squash d20479f4, live in e51795e8): `scripts/dedup_instrument_library_2026-10-07.py` applied `scripts/data/instrument_library_dedup_2026-10-07.csv` to `client/src/lib/fdaInstrumentData.json`: 225 removals across 25 instrument entries (212 batch-added, 13 pre-existing twins), KEEP names retained, testCount recomputed, byte-identical CRLF round-trip. `--verify` receipt 29/29: 294 entries before and after, 269 untouched entries byte-for-byte identical, exactly the planned names removed, every KEEP present, survivors unchanged. 127 real-qualifier names (Crossmatch IS vs AHG, Basophils absolute vs %, AST gram-neg vs gram-pos, CK-MB activity vs mass, anti-Xa UFH/LMWH/rivaroxaban, pO2 A / A-a / a/A) untouched by construction. Library only: lab maps that already copied a duplicate keep it until that lab edits it. Vendor batches (Beckman UniCel/AU640, Sysmex, Roche immunoassay, smaller vendors) may resume; the batch scripts must key on the library's existing names first so this class does not recur.

### C74. VeritaCheck D1 method-comparison verdict: the mean-|bias| override is disputed (was #67)

**Effort:** was S / **Importance:** Medium

**Closure evidence:** Receipt first (tests/integration/d1-aggregate-override.test.ts, real engine): single-criterion TEa can never trigger the override (20,000 random all-pass datasets, zero counter-examples), dual-criterion TEa (percent OR absolute floor) flips all-pass studies to a false FAIL (7.5% of random datasets) because the guard averaged fractional biases inflated by floor-passed low samples against the percent TEa. Michael chose option 1 (2026-10-07 morning): remove the guard; the per-sample dual-criterion rule is the verdict. PR #1498 merged 07:24, deployed 07:33 (squash 9340296c, /api/health match). Mean bias is still computed and reported (pdfReport.ts 1279-1301 statistics, narrative and Bland-Altman bias line; StudyResultsPage.tsx 269-283, 1326, 1499); only the verdict override is gone. A study the old guard had falsely failed returns to PASS at the next boot recompute. study-status-boot-safety.test.ts still ALL PASS; tsc clean.

### C73. VeritaComp legacy program modal shows no VeritaStaff employees (was #59)

**Effort:** was S / **Importance:** Medium

**Closure evidence:** Michael's Option 2 built 2026-10-07 overnight. PR #1495 (merged 2026-10-07 00:39, squash b1aad70d, deploy confirmed by watcher). GET /api/labs/:labId/competency/programs/:id/eligible-employees returns the lab's active VeritaStaff employees assigned (staff_employee_instruments) to any instrument in the program's method groups, auto-bridged into competency_employees (idempotent, owner user id, same insert shape as the roster sync; a program with no method groups falls back to any assigned active staff). NewAssessmentDialog fetches it on open, merges into the Employee select, defaults the selection, shows "N from the VeritaStaff roster, assigned to this program's instruments"; the dead-end copy now points at Assign by Instrument. Receipts: tests/integration/veritacomp-eligible-employees.test.ts 14/14 through the real routes (returned / excluded by instrument / excluded inactive / one bridge row / idempotent / no-group fallback / other lab 403); Gate 3 step 8 tests/playwright/veritacomp-assessment-roster-employees.spec.ts 1/1 on a local build (dialog defaults to the roster member with her assigned Atellica CH 930, no dead-end notice). tsc clean. Prod click-through on lab 5 is Michael's (Lisa's lab; not touched).

### C72. Nightly backup studyCount anomaly on every user-deleted study (was #73)

**Effort:** was XS / **Importance:** Medium

**Closure evidence:** Found 2026-10-07 00:00 ET: the nightly check emailed ANOMALY for studyCount {value 801, prior 803}; the production audit_log (read-only backup copy, deleted after) shows Michael deleted 7 GC1 CREAT studies on 10/06 and 5 studies were created, 803 - 7 + 5 = 801. PR #1494 (merged 2026-10-07 00:26, squash 9eef515c): a decrease is ok when covered by audited study deletions since the prior run (prior.run_at, exact window so yesterday's deletes cannot mask a fresh loss); the check JSON carries dropped + auditedDeletesSincePriorRun. Receipt tests/integration/backup-integrity-named-drop.test.ts 19/19 through the real routes. Deploy confirmed by watcher (watch_1494.log).

### C71. Nightly backup "integrity ANOMALY" email on every real-user decrease, naming nobody (was #70)

**Effort:** was S / **Importance:** Medium

**Closure evidence:** PR #1492 (merged 2026-10-07 00:00, squash 793f5e5b, deploy SUCCESS 00:01:49, /api/health commit match). backup_integrity_log.real_user_emails snapshots the real-user list each run; each dropped address is looked up in audit_log (admin delete within 36 h) and classified explained vs unexplained, named in the check JSON and the anomaly email; userCount is ok when every drop is explained. DELETE /api/admin/users/:id now writes the audit row (operator id 0, because storage.deleteUser cascades audit_log by user_id and the first draft erased its own row; caught by the receipt). AuditModule gains "admin". Receipt: 15/15 through the real routes (403 wrong secret, 200 delete, audit row survives the cascade, explained vs unexplained, added, steady state). Production schema verified from a read-only backup copy: the column exists. First names land on the 10/08 00:00 ET run; comparisons start 10/09. Tonight's 10/07 run fired 90 s before the deploy and still ran the old check (see C72 for what it flagged).

### C70. computeStudyStatus throws at every boot for 4 studies and fail-safes them to FAIL (was #69)

**Effort:** was S / **Importance:** High

**Closure evidence:** Facts first: the 4 TypeErrors are legacy rows #43-#46 (user 14, no lab, instruments stored as a bare string, {x,y} points) already "fail"; the 4 nightly status flips (#457/#365/#364 -> pass, #318 -> fail) were the demo lab's seeded rows, re-stamped status='completed' by seedDemo at every boot and corrected by the recompute; #318 Troponin I is intended to fail (seed section 4.5). No customer study was affected. PR #1490 (merged 2026-10-06 23:1x, squash 9990ef2c, DEPLOY SUCCESS 23:19): cannot-evaluate flag (exception / no evaluable points / no measurable values) makes the boot recompute SKIP and log instead of writing a fail-safe FAIL; null-safe instrumentValues reads; shape from the first point with values; seeder stops resetting status. Receipt tests/integration/study-status-boot-safety.test.ts 6/6 (two earlier drafts failed it: legacy row still written fail, first-point shape bug). tsc clean.

### C69. VeritaMap: director attestation, MEC review and unlock stamp EVERY age/sex band of an analyte (was #68)

**Effort:** was S / **Importance:** Medium-High

**Closure evidence:** PR #1491 (merged 2026-10-06 23:34, squash 716e4f0a, DEPLOY SUCCESS 23:43, /api/health commit match). mec-review / attest-ref / unlock-ref parse the band and read/write only that row (All ages default for old clients; 400 for a band with no row; audit entityId carries the band label); TestRow sends the active band; handleProvenance replaces only the returned band (it used to collapse the band array to one row). Receipts: tests/integration/veritamap-attest-band-scope.test.ts 15/15 on the fix and 5 FAILED on the pre-fix handlers (the harness bites); tsc clean; browser exercise on a local build: pediatric band attested + locked while All ages stayed unlocked and attestable, API confirms ref_locked 1/0.

### C68. VeritaCheck: Hemoglobin studies render as "Lab-Set Internal Goal", and every narrative cites 42 CFR 493.931 (was #66)

**Effort:** was S / **Importance:** High

**Closure evidence:** PR #1489 (merged 2026-10-06 23:20, squash 80327dc0, DEPLOY SUCCESS 23:28, /api/health commit match). hasCanonicalTea consults the unregulated catalog and NAME_MAP before the alias set; new cfrSectionForTestName (cliaAnalytes subspecialty -> CFR_MAP) used by the narrative, the specs "CFR Reference" row and lot-to-lot; pt_coag and multi-analyte keep their 493.941 default. Receipts: scripts/verify-hgb-canonical-tea-cfr.ts 22/22 against the real module, verify-canonical-tea-matching.js still passes, tsc clean, rendered Hemoglobin PDF on a local build: "criterion (CLIA TEa) of +/-4.0% per 42 CFR 493.941", "CFR Reference (PT TEa, adopted) 42 CFR 493.941", zero "Lab-Set Internal Goal". Receipt also posted as a PR comment.

### C67. about:blank on PDF opens (window.open token pattern + Adobe Acrobat) (was #63)

**Effort:** was S / **Importance:** Medium

**Closure evidence:** PR #1493 (merged 2026-10-07 00:07, squash a070407c, DEPLOY SUCCESS ~00:20). Bug-class sweep found 16 window.open(/api/pdf/token) sites, not ~6: VeritaOps, VeritaQA, VeritaResponse x6, VeritaPace, VeritaStock x5, snap order, CMS-116, the public Why-VeritaCheck article; all now use downloadPdfToken (anchor download, named file). The VeritaScan document-library policy opener pre-opened a blank tab and pointed it at a PDF blob (the exact about:blank orphan with Acrobat): PDFs now close that tab and download, HTML keeps the tab. Server: /api/pdf/:token sends Content-Disposition attachment (was inline) so nothing left can hand a PDF navigation to the Acrobat extension; grep after the sweep: 0 left. Gate 3 step 8 on PRODUCTION: tests/playwright/pdf-open-no-blank-tab.spec.ts 2/2 against www (Download PDF fires a browser download, opens no new page, attachment header). Rode along: ModuleHowToCard data-testid and two env-gated spec repairs (see #74).

### C66. Milford VeritaMap: every value/date save failed, then the AMR autosave loop (was #64)

**Effort:** was S + S / **Importance:** High

**Closure evidence:** Three real causes, none of them the role gap first diagnosed. (1) Subscription gate: `hasMapAccess` requires `subscription_status = 'active'`; lab 4 sat on `free` with plan `hospital` never activated. Activated 2026-10-06 20:19 (`extend-lab-subscription`, expiry 2099); lab 5 was already active. (2) Date-save 500: the per-field autosave PUT bound `active = NULL` into a NOT NULL column; PR #1486 (partial update), deploy f46f003f; production receipt 2026-10-06 21:06: `PUT /api/labs/4/veritamap/maps/61/tests/25-hydroxyvitamin D 200 :: {"ok":true}`. (3) AMR autosave loop, surfaced by the fix: TestRow re-synced its AMR state from a prop the parent rebuilt on every render and re-armed its autosave after every successful save, ~1,400 blank PUTs a minute from the open map tab. PR #1487 (autosave arms only on user edits, value-keyed prop sync, server no-op guard answering `noop:true`, plus layer 2: `editAccess` on the map GET and a view-only banner with disabled inputs for members without edit rights), merged b69446db, deployed 2026-10-07 02:34Z, `/api/health` commit match, homepage 200. Receipts: tests/playwright/veritamap-amr-autosave-no-loop.spec.ts (24 PUTs in 6 s on the pre-fix bundle, 0 on the fix, 1 per edit, passes x2), veritamap-seat-view-only.spec.ts (editAccess=false, direct PUT 403, banner, disabled inputs, 0 writes), scripts/verify-veritamap-amr-noop-save.mjs 6/6. A tab still on the old bundle keeps PUTting until it reloads; the server now answers noop without writing.

### C65. Vendor instrument expansion PR #1474, 25 platforms (was #62)

**Effort:** was XS / **Importance:** Medium

**Closure evidence:** Merged 2026-10-06 13:12 (ac05b37), deploy SUCCESS 13:22. 269 -> 294 instruments with FDA-anchored CLIA complexity. Authorization: Michael's 13:07 "agree with all recommendations. go." The picker render on prod was not browser-checked (prod smoke pending).

### C64. VeritaPT CAP vendor program catalog (was #60)

**Effort:** was S / **Importance:** High

**Closure evidence:** Loaded 2026-10-06 14:20 via `POST /api/admin/veritapt/vendor-programs`: loaded 74, totalActive 299; the Program Name field is a dropdown for CAP. Caveat: the promised review-before-load did not happen; the 74 programs are visible in the dropdown for Michael's review, and a remove list is available on request.

### C63. VeritaCheck instrument-verification multi-select analyte menu (was #58)

**Effort:** was S / **Importance:** High

**Closure evidence:** PR #1481 merged 2026-10-06 15:45, deploy 8fa863a SUCCESS 16:01. Multi-select checklist sourced from the instrument's menu with Select all and a bulk insert; free text kept for custom analytes. Built under the 14:04 "continue in sequence, do not stop" mandate rather than a per-item go; browser check on prod pending (prod smoke).

### C62. Plain-language summary layer: CFR Reference tab (was #30)

**Effort:** was M / **Importance:** Medium

**Closure evidence:** PR #1461 merged 2026-10-04 (approach (a): a read-only "CFR Reference" tab in VeritaDC with plain-language summaries for 35 CFR sections, CFR rows only), deployed 2026-10-04 (f473fb1e, then ba891c3f). The twice-reverted policy-row approach (b) was not attempted. Rendered and browser-verified locally; on prod the API payload (235 CFR rows, 35 summaries, 0 accreditor rows) was verified and the filter logic replayed on it, but the logged-in page itself was not eyeballed.

### C61. Regenerate the access-inventory Excel with the corrected MD persona (was #44)

**Effort:** was XS / **Importance:** Low

**Closure evidence:** Delivered 2026-10-04. Regenerated VeritaAssure_Function_Inventory.xlsx with the corrected MD persona (active writer seat + designated director, not a seatless member): 73 edit-class rows flipped MD N to Y and 2 director-class rows flipped Owner N to Y (owner break-glass). Each access class gate was probe-verified against a seeded throwaway lab with correct-path probes across owner/admin/staff-portal/MD; the stale per-row HTTP column was replaced with the class-verified result, with a documented caveat that the original per-endpoint sweep had a hand-curated endpoint map that was not preserved (auto-resolution hits the SPA fallback, so per-row HTTP was not re-run). Delivered with the harness (inventory-sweep.mjs + apply-corrected-inventory.py).

### C60. VeritaQC Import Phase A browser click-through (was #40)

**Effort:** was XS / **Importance:** Low

**Closure evidence:** Verified 2026-10-04 by driving the deferred Gate-3 step-8 click-through in Claude's in-app browser (the original attempt stalled only because Claude-in-Chrome's renderer froze on a Radix Select, a tooling bug, not VeritaQC code). On a seeded throwaway lab: opened /labs/1/study/new, set Study Type to Precision Verification via the study-type Radix Select (opened; all 14 options rendered), clicked "Start from VeritaQC", entered analyte Glucose so candidates loaded (instrument ATELLICA Solution and control lot SEED-GLU-1 Level 1 auto-populated in their Radix Selects), Preview values rendered the matching results, and Import landed "Imported 15 replicates from VeritaQC" into the precision study. Every Radix Select rendered and selected without freezing. Backend was already 35/35 offline + 3 live-API smoke. VeritaQC was promoted to Live on the VeritaAssure overview page in the same change.

### C59. Confirm the finding-closure signer policy (was #43)

**Effort:** was XS / **Importance:** Medium

**Closure evidence:** Operator decision 2026-10-04: KEEP VeritaResponse finding closure restricted to the designated medical director, a delegated designee holding finding-closure for the lab's complexity, or the account owner as a logged break-glass override. The Item 5 Phase 2 tightening (shipped PRs #1443/#1444, live on prod) stands as intended; a non-MD admin closes findings only by holding a Letter of Delegation. The same MD-or-designee gate also guards QC period-review co-sign. No code change required.

### C58. VeritaDC per-document attestation tracker + "My Documents" rename (built as #45)

**Effort:** was M / **Importance:** Medium-High

**Closure evidence:** Shipped PRs #1447 (tracker + rename) and #1449 (date-only fmtDate fix), both in origin/main; deployed 2026-10-04 (tracker 740a966e live; fix 95daae84). The Compliance tab already showed per-staff attestation rates and admins could already assign approved documents, but there was no way to open ONE document and see its roster, and "who opened it" was logged but shown nowhere. Added a "Tracker" button on each approved document ("My Documents" tab) that opens a per-document roster: per assignee it shows assigned date, due date, last opened (derived from the existing viewed/version_viewed audit events, surfaced for the first time), attested date + version with a stale-version flag, and a derived status (Attested / Opened-not-signed / Overdue / Not opened), plus summary counts, Staff Portal read-and-sign signatures, and the Excel signature report. No schema change. Status logic extracted to server/policyAttestationStatus.ts, covered by scripts/verify-veritadc-attestation-tracker.ts (10/10). Browser-verified end to end on a local throwaway lab (five assignees across every status), light and dark mode; that exercise caught and fixed a date-only off-by-one in the shared fmtDate helper (PR #1449). Renamed the visible "My Policies" to "My Documents" (tab, page heading, compliance back-links); routing keys unchanged. Playwright evidence: tests/playwright/veritadc-attestation-tracker.spec.ts.

### C57. Hide sections a lab does not use from a master list (was #47)

**Effort:** was S-M / **Importance:** Medium-High (prospect-requested)

**Closure evidence:** Shipped PR #1364 (in origin/main), the entry was stale in OPEN. Built as the VeritaDC (VeritaPolicy) Master List "Show only applicable" toggle in client/src/pages/VeritaPolicyAppPage.tsx: per-lab, localStorage-persisted (`vp_hide_na_${activeLabId}`, resets on lab switch so no cross-lab stale state), opt-in default-off, filters rows where status === "na". Scope resolved to VeritaDC per the prospect ask. Verified against origin/main 2026-09-29.

### C56. VeritaCEU: curated free continuing-education provider list (was #53)

**Effort:** was S / **Importance:** Low-Medium

**Closure evidence:** Shipped as VeritaCEU phase 2 (PR #1410, squash bea451a2, deployed 2026-10-02). The "Find free CE" tab in VeritaCEU lists all 13 providers from Jennifer Small's 2026-09-25 list, grouped by type (society/publication, government, reference laboratory, diagnostics vendor, proficiency testing, webinar aggregator), each with a real CE URL web-verified 2026-10-02: ADLM Learning Lab, MLO, LabRoots, CDC OneLab REACH, ARUP, Bio-Rad, Abbott, Siemens Healthineers, Cardinal Health, Cepheid, Fisher Healthcare, American Proficiency Institute (with its customer-gated caveat noted), and Whitehat as the vendor aggregator, plus the Lab Week tip. Data in client/src/lib/freeCeProviders.ts; browser-verified light + dark. Receipt: tests/playwright/veritaceu-free-ce-directory.spec.ts.

### C55. VeritaScan: let sites add their own custom questions (was #55)

**Effort:** was M / **Importance:** Medium-High

**Closure evidence:** Shipped 2026-10-01 across four PRs. Design call (Michael): custom items are scored in a SEPARATE section that does NOT count toward the standardized readiness % (keeps the benchmark comparable across labs). Phase 1 PR #1404 (backend: `veritascan_custom_items` + `veritascan_custom_item_status` tables with migrations + delete-cascade clears, validation module, lab-scoped author/edit/retire CRUD; 18/18 validation + CRUD curl). Phase 2 PR #1405 (authoring UI: dedicated Custom Questions page, add/edit/soft-retire + show-retired, plan-gated, linked from the dashboard; browser-verified create/edit/retire light + dark). Phase 3 PR #1406 (per-scan custom-item status endpoints + `CustomQuestionsSection` on the scan page with its own tally; verified the custom write never touches `veritascan_items`, so the standardized % cannot move; scoring verify 6/6). Phase 4 PR #1407 (exports: a dedicated "Custom Questions" Excel worksheet + a "Custom / site-specific" PDF section with its own tally and a "not included in the standardized readiness score" note; both artifacts generated and inspected). tsc + build + audit + cascade guard clean throughout.

### C54. VeritaQC: at-entry warning when a QC point is outside 2 SD (was #56)

**Effort:** was S-M (shipped S) / **Importance:** High

**Closure evidence:** Shipped PR #1403 (squash-merged to main 0a0c2e41 2026-10-01, deployed, prod health confirmed). The server already emitted + persisted the Westgard 1-2s warning (a single control point 2 to 3 SD from the baseline mean); it only surfaced as a brief, easy-to-miss toast. Design call (Michael delegated): SOFT warning. Replaced the toast with a must-acknowledge dialog that names the rule code + SDI and the entered value, logs the result, and lets the tech continue (no corrective action; rejections still route to the forced CA modal). Browser-verified in light + dark mode (value 105 vs mean 100 SD 2 -> 1-2s |SDI| 2.50; re-check 109 -> 2.60). Receipt: `tests/playwright/veritaqc-warning-ack.spec.ts`; tsc + build clean.

### C53. VeritaTrack: quarterly task loaded as monthly until re-saved (was #54)

**Effort:** was S / **Importance:** Medium

**Closure evidence:** Shipped PR #1402 (squash-merged to main e62c7184 2026-10-01, deployed, prod health confirmed). Root cause: the scoped task-create path (`server/veritatrack.ts` POST `/api/labs/:labId/veritatrack/tasks`) did `Number(frequency_months || 1)`, defaulting every create to 1 month because the client sends only the `frequency` STRING, not `frequency_months`. Fix: `Number(frequency_months) || frequencyToMonths(frequency || "Monthly")`, so the stored months agree with the label (Quarterly -> 3, etc.). Receipt: `scripts/verify-veritatrack-frequency.mjs` 9/9; explicit numeric `frequency_months` still honored; unknown/empty falls back to 1.

### C52. VeritaResponse internal NCE / non-conforming event (was #36)

**Effort:** was L (shipped as MEDIUM) / **Importance:** High

**Closure evidence:** Shipped PR #1368 (squash-merged to main 29cc6e23 2026-09-29, deployed, Gate-3 passed on prod). Built inside VeritaResponse as a third finding `source_type = 'internal_nce'` (a lab-found event with no survey/PT trigger, per Michael's 2026-09-28 scope): added `event_date` / `discovered_by` / `signoff_role` columns (PRAGMA ALTER pattern), reused the CAPA / history / effectiveness spine, added an MD-or-owner/admin gated sign-off endpoint (`POST /api/labs/:labId/findings/:id/signoff`, 403s anyone who is not the designated MD or an owner/admin) reusing the `labs.medical_director_email` designation, and a section 5-compliant internal-NCE write-up PDF (`generateInternalNcePDF`, signature block on page 1). Client: "Internal event (NCE)" record type in the New Finding dialog (event date + discovered-by, survey fields hidden), a list badge, a gated sign-off button, and a PDF card. Receipts: env-gated Playwright spec `tests/playwright/veritaresponse-internal-nce.spec.ts` passed against prod; local PDF render-inspect (signature on page 1, correct CFR + statistics, no em dashes); tsc clean; audit 0 errors.

### C49. Competency "assessed this cycle" cadence-aware window (was #50)

**Effort:** was S-M / **Importance:** Medium

**Closure evidence:** Shipped PR #1356 (squash-merged to main, prod-verified live on c13f959c 2026-09-28). Added `competencyCycleWindowDays(schedule)` in `shared/competencyStatus.ts` returning 183 days in year 1 (initial_completed_at set, first_annual_completed_at null) else 365; `/api/labs/:labId/competency/owed` now gates `assessed` on each person's cadence cutoff instead of a flat 365-day lookback. Receipts: `scripts/verify-competency-cycle-window.mts` 8/8 (first-year vs annual + boundary); prod `GET /api/labs/3/competency/owed` returns 200 with the new path live. Backend-only, no schema change.

---

### C50. VeritaTrack task owner + owner-only reminder routing (was #51)

**Effort:** was S-M / **Importance:** Medium

**Closure evidence:** Shipped PR #1358 (prod-verified live on c13f959c 2026-09-28). Added `owner_employee_id` + `owner_email` on `veritatrack_tasks` and `owner_only` on `veritatrack_reminder_config` (idempotent PRAGMA-guarded ALTERs); task create/update accept an owner picked from the VeritaStaff roster; RemindersPanel gained an owner-only toggle; the reminder runner groups one digest per owner_email when owner-only is on, unowned tasks falling back to the lab list. Receipts: `scripts/verify-veritatrack-owner-reminders.mts` 11/11; prod schema confirmed (reminder-config returns `owner_only`, all 152 lab-3 tasks carry the owner columns); browser Gate-3 on prod confirmed the owner picker + owner-email field + `reminder-owner-only` toggle render with no page errors.

---

### C51. Designate Medical Director by picking a lab member (was #52, core)

**Effort:** was S-M / **Importance:** Medium-High

**Closure evidence:** Shipped PR #1361 (prod-verified live on c13f959c 2026-09-28). Added a member/pending-invite `<select>` (`data-testid="md-member-select"`) to the MD designation block on LabMembersPage that fills the director email, reusing the existing `PUT /api/labs/:labId/medical-director` (no schema or access-model change). Receipts: `tests/playwright/lab-members-medical-director.spec.ts` passes on prod (designate + restore round-trip); browser Gate-3 confirmed `md-member-select` renders with 7 options (Unassigned + the lab's 6 members).

**Residual (optional, reopen a scoped item only if the exact UX is wanted):** the original #52 also floated folding MD into the per-member role dropdown (Admin / Staff / + Medical Director) and a dedicated "designate/transfer medical director" block mirroring transfer-ownership. The shipped member-picker addresses the core friction (designate an existing member as MD without retyping the email); the role-dropdown-grant and transfer-MD-block framings were not built.

---

### C47. Unregulated-analyte / Alternative Assessment (AAA) coverage (was #18)

**Effort:** was S (Phase 3) / **Importance:** Medium

**Closure evidence:** All phases shipped. Phase 1 (VeritaScan AAA sub-block, items 169-173) via PR #78; Phase 2 data layer via PR #80 (aa_records table) + UI/coverage-union verified 2026-05-21 (computePTCoverage unions pt_enrollments_v2 with aa_records into a 5-bucket summary incl. aaaCovered; enrollment modal in VeritaPTAppPage); Phase 3 (AAA-failure-to-VeritaResponse-finding linkage citing 42 CFR 493.1236(c)(1)) via PR #753 (commit 7a05420, 2026-06-13), browser-verified on the demo lab. Full scoping context preserved in git history. Was mis-filed in OPEN after all phases shipped; closed 2026-09-28.

---

### C48. VeritaResponse post-survey deficiency module (was #17)

**Effort:** was XL / **Importance:** High

**Closure evidence:** BUILT and LIVE as a full flagship module: findings table + CRUD + lifecycle, per-accreditor due-date computation, 30/60/90-day effectiveness monitoring (wave C3), cross-module escalation INTO findings from VeritaQC corrective actions (wave A7) and from failed VeritaPT alternative assessments (PR #753), and VeritaScan-evidence linkage (wave C4). Original naming/scoping/accreditor research preserved in git history (the ~225-line #17 entry). Reclassified from OPEN to CLOSED 2026-09-28: the module is shipped, so it no longer belongs in the OPEN build queue.

**Residual (customer-triggered, not blocking, re-open a scoped item only if demand appears):** (a) a render audit to confirm which per-accreditor renderers (CMS-2567, CAP per-checklist, TJC ESC, AABB NER) and the 5-elements POC validator are built vs pending; (b) Tier 3 — AABB NER renderer + multi-accreditor finding linking (one event, two cited bodies) + multi-year trend analytics — remains deferred.

---

### C45. Unify coverage/competency recurrence helper (was #49) - closed as non-issue

**Closure evidence:** Investigated 2026-09-24 before building. The coverage recurrence math (+6-month interval, signed-resets-to-missing, nextDueOn/overdue, isFailVerdict) is ALREADY single-source in server/veritacheckCoverage.ts (computeCoverageFrom). server/coverageReport.ts and the routes.ts coverage export do not recompute it; they consume the computed nextDueOn/overdue/status fields and apply small surface-specific presentation labels (deliberately different vocabularies per surface, so they should not be merged). The only truly identical duplicate is a one-line date formatter. The competency "owed" derivation is NOT the same cadence: competency follows the CLIA milestone schedule (initial / semiannual year 1 / annual, 42 CFR 493.1451(b)(8) and 493.1235), which is a different regulatory interval from the coverage 6-month rule (493.1281 / 493.1255) and must stay separate. No worthwhile extraction; merging the two cadences would be wrong. Closed 2026-09-24. (The year-1 competency-window refinement remains tracked separately as #50.)

**Source:** 2026-09-24 session, "keep working" pass; scoped read-only, found no real duplication.

---

### C46. Verified-users product-update send path (wrong-list incident fix)

**Closure evidence:** Shipped PR #1324 (merged 4e05506a, deploy ACTIVE). New POST /api/admin/users/send targets registered VeritaAssure account holders (the users table), never the Lab Director's Briefing subscriber list. Separate explicitly-named endpoint (not a flag with a dangerous default), account-holder email framing, excludes suppressed emails and RFC-reserved test domains, CC owner, dryRun + testTo previews. Public unsubscribe now upserts a suppression row so opt-outs are honored across both audiences. Live dryRun: 49 verified-user recipients vs 673 on the Briefing list. Receipts: scripts/verify-product-update-send.mts 24/24, tsc clean, rendered sample inspected. Fixes the fallout from the 2026-09-23/24 wrong-list send (a product update went to the 675-person Briefing list). Nothing sends without Michael's explicit "send it."

**Source:** 2026-09-24 session; Michael selected this as the next build after the #41 close.

---

### C44. Verify-script convention backfill (was #41) + audit matcher fix

**Closure evidence:** #41 was fully backfilled on 2026-06-13 (all 8 high-stakes scripts landed; see C30); it had only been mis-filed in OPEN. A 2026-09-24 re-audit initially reported 4 of 5 recent math/logic commits as missing a verify script, which was a FALSE POSITIVE: scripts/audit_verify_script_coverage.py matched only scripts/verify-*.js / .cjs, so it ignored the .mjs / .mts / .ts verify scripts the repo now ships (e.g. verify-ptcoag-multi.mts, verify-tea-criterion-format.mjs). Fixed the matcher to accept .js/.cjs/.mjs/.ts/.mts; re-run shows 5 of 5 covered, 0 debt. The convention is being followed. Closed 2026-09-24.

**Source:** 2026-09-24 session, "keep working" pass; audit tooling bug found + fixed.

---

### C43. VeritaStaff instrument-centric (dual) assignment view

**Closure evidence:** PR #1320. GET/PUT /staff/instruments/:id/employees (transpose of the per-employee endpoints); an "Assign by Instrument" dialog lets a director pick a test system or manual test and check off who runs it. Same staff_employee_instruments join, with the 42 CFR 493.1235(a) duty-change event emitted on newly-added pairs so both orientations trigger the same reassessment. GET verified live on SCAHC lab 2. Closed 2026-09-24.

**Source:** 2026-09-24 session, Michael ("in staff we should also give the dual view when assigning coverage to test systems or manual tests").

---

### C42. VeritaComp coverage map (required-vs-assessed matrix, dual view)

**Closure evidence:** PR #1319 (+ status layer PR #1316). /competency/owed returns per-item assessed (locked passing assessment this cycle on a covering method group) + per-employee CLIA status; CompetencyCoverageMap renders a By-employee / By-instrument matrix (Assessed / Owed / Overdue / Gap). Verified live on SCAHC lab 2 (owed 116, assessed 2, gaps 0). Completes #48 as the VeritaCheck-parity coverage map. Closed 2026-09-24.

**Source:** 2026-09-24 session, Michael ("are we building the competencies to have a coverage map, same as veritacheck?" then "build it").

---

### C41. VeritaCheck coverage recurrence (method comparison + cal-ver/linearity + reports)

**Closure evidence:** PRs #1317 (method comparison), #1318 (cal-ver/linearity), #1321 (report Next-due columns). Periodic verification (correlation/method comparison 42 CFR 493.1281; cal-ver/linearity 42 CFR 493.1255; both 6-month) now recurs: a signed study banks the cycle and rolls to next-due = signed + 6 months instead of reading "done" forever. Status Missing/Failed/Completed-unsigned + a "Next due on" column on-screen and in both coverage exports; also credits the previously-ignored "correlation" study type. Root cause: computeCoverageFrom marked requirements done on mere existence, no date logic. Verified live on SCAHC lab 2 (101 correlations + 11 cal-ver rows now carry a next-due). Engine-level, all facilities. Closed 2026-09-24.

**Source:** 2026-09-24 session, Michael ("Look at San Carlos... they finished their last set of correlations (all 103) but their menu never reset").

---

### C40. VeritaComp Competencies Owed derived from VeritaStaff, with gap detection (was #48)

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

### C34. Wire the two static-audit guards into CI (was #43)

**Closure evidence:** both guards wired into the Multi-Lab Mutations Audit CI
workflow (.github/workflows/multilab-mutations-audit.yml) as steps:
`audit-delete-cascades.mjs` (DELETE handlers that orphan non-cascade FK children)
and `audit-labscoped-write-routes.mjs` (client lab-scoped writes with no matching
server route). Both exit non-zero on a finding, failing the job. Confirmed 0
findings on main at closure. Closed 2026-06-14. NOTE: a hard merge-block still
needs the one-time branch-protection toggle for the "multilab-mutations" check
(same caveat as the existing guards already in that workflow).

---

### C35. Legacy /api/studies over-returns studies across labs (was #44)

**Closure evidence:** `GET /api/studies` now scopes its list to the active lab
when one is resolved from the Referer (server/routes.ts), so every returned row
opens on the lab-scoped detail page; the genuine no-active-lab legacy global
fallback is unchanged. drizzle's studies schema lacks lab_id, so the scope filter
resolves the lab's study ids via raw SQL (idx_studies_lab_id) and filters on id,
mirroring the /api/labs/:labId/studies handler. Closed 2026-06-14.

---

### C30. Verify-script convention backfill (was #41)

**Closure evidence:** all 8 high-stakes math/logic commits now ship a paired
`scripts/verify-*.js` (EP17 sensitivity, Deming lot-to-lot, CUMSUM+QC+multi-analyte,
EP28 reference interval, Deming/OLS CI, EP15 ANOVA, qualitative method comparison,
TEa boundary), per the strike-throughs in #41. Closed 2026-06-13.

**Source:** scripts/audit_verify_script_coverage.py lookback, 2026-06-02; backfills
landed 2026-06-03..06.

---

### C31. VeritaPT AAA create/update/delete silently no-op in the multi-lab UI

**Closure evidence:** PR #754 (commit 92ad499) added lab-scoped POST/PUT/DELETE
`/api/labs/:labId/pt/aa-records`. The UI posted to the lab-scoped path but only GET
existed, so writes fell through to the SPA catch-all (200 + index.html, nothing
written); the UI did not check the response, so "Add AAA Record" cleared the form
and looked saved. Confirmed in-browser (rows 20 -> 20), fixed, and prod-verified
(create adds a row, delete removes it). Also fixed the lab-tagging defect (legacy
route mis-filed records to the user's default lab on multi-lab accounts).

**Source:** 2026-06-13, found during #18 Phase 3 QA;
`scripts/audit-labscoped-write-routes.mjs` now guards the class.

---

### C32. VeritaComp "Unlock assessment" false-success no-op

**Closure evidence:** PR #755 (commit 4234007) moved the unlock route to
`/api/labs/:labId/competency/assessments/:id/unlock` (the path the client calls).
It had been registered at the non-:labId path while using labScopeMiddleware (which
400s without :labId), so the client's lab-scoped POST hit the SPA fallback (200),
and the client's `if (!res.ok)` showed a false "Assessment unlocked" toast while the
signed assessment stayed locked. Prod-verified (path now returns JSON 404, not SPA
HTML).

**Source:** 2026-06-13, found by `scripts/audit-labscoped-write-routes.mjs`.

---

### C33. FK-cascade delete 500s + NavBar laptop-width overflow

**Closure evidence:** PRs #749/#750 fixed NavBar horizontal overflow at laptop
widths (collapse to the hamburger below 1560px); prod-verified at 1280-1920 with the
longest lab name. PRs #751/#752 fixed 6 delete handlers that 500'd on foreign-key
constraints (VeritaCheck verification analytes; VeritaResponse finding effectiveness
checks, in BOTH the lab-scoped and legacy handlers; VeritaMap instrument staff links;
competency assessment element docs; competency quiz assignments). All prod-verified
500 -> 200. `scripts/audit-delete-cascades.mjs` guards the class.

**Source:** 2026-06-13 browser QA of the A7-D4 wave + retro-QC of the 72h PR window.

---

### C1. FAQ "over 25 years" -> "over 23 years"

**Closure evidence:** client/src/pages/FAQPage.tsx line 20 reads "over
23 years" as of 2026-05-01.

**Source:** session 299e9a73 turn 14, ~2026-04-28.

---

### C5. David's VeritaQA grey-button bug (seat permissions mode)

**Closure evidence:** PR #10 squash-merged as commit a43fbba on
2026-05-01 23:19 MST. Railway deploy succeeded; deployed bundle
(`/assets/index-CBVwW2mk.js`) confirmed to contain new strings
('VeritaQA™ Suite', 'VeritaStock™', 'edit_all', 'view_all',
'Inherits future modules'). Resolver in shared/schema.ts
(`resolveSeatPermission`) auto-upgrades David's stored permissions
(9-of-9 keys = edit, veritabench/veritastock absent) to effective
edit on the new modules without any DB write. Verified locally
against his exact stored shape (14 of 14 expected outcomes matched).

**Source:** 2026-05-01 David's report; veritabench + veritastock
weren't in MODULE_LIST so seat permissions silently defaulted to
view, greying the browse button on /veritabench/pi line 323.

---

### C2. TeamPage present-tense "TJC surveyor" check

**Closure evidence:** site-wide search confirmed all surveyor language
is past-tense, consistent with user's 2021-2025 service. User closed
the item in session 299e9a73 turn 4.

**Source:** session 299e9a73, ~2026-04-28.

---

### C3. My Studies CSV/XLSX export (John as design partner)

**Closure evidence:** client/src/pages/DashboardPage.tsx line 46 calls
`/api/my-studies/export`. server/routes.ts line 1491 implements the
endpoint. Pulled forward into pre-COLA per user instruction.

**Source:** session 299e9a73 turn 5, ~2026-04-28.

---

### C4. Rotate GitHub PAT (because old PAT was committed in SESSION_HANDOFF files)

**Closure evidence:** no `ghp_*` or `github_pat_*` patterns in current
SESSION_HANDOFF.md or SESSION_HANDOFF-2.md as of 2026-05-01.

**Source:** session 299e9a73, ~2026-04-28.

---

### C6. VeritaPolicy service-line filtering removed (formerly #4)

**Closure rationale (operator decision 2026-05-10):** Keep all
VeritaPolicy rows. CFR-only references with no accreditor reference
are intentional. Labs are welcome to N/A specific lines that do not
apply to them. The "service-line filtering" reframing of the original
report misread the design intent.

**Closure evidence:** No code change required. The current behavior
(all rows shown, per-row N/A available) is the desired behavior.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C7. CLIA number format validation (formerly #13)

**Closure evidence:** `shared/validateClia.ts` defines `CLIA_REGEX =
/^\d{2}D\d{7}$/` (line 24), `validateClia()` helper with whitespace
and dash stripping plus uppercasing (lines 43-57), and
`CLIA_FORMAT_HINT` user-facing error message (lines 26-27). Used in
`client/src/pages/AccountSettingsPage.tsx:393` as placeholder text.
The centralized helper described in the original parking lot fix
shape exists and behaves as specified.

**Source:** Agent verification 2026-05-10 via grep + file read.
Operator confirmed shipped 2026-05-10.

---

### C8. VeritaMap lab-wide menu toggle (formerly #19)

**Closure evidence:** `client/src/pages/VeritaMapLabwidePage.tsx`
exists and implements the labwide read-only union view. Route is
registered in `client/src/App.tsx`. Toggle integration appears in
`client/src/pages/VeritaMapAppPage.tsx` and
`client/src/pages/VeritaMapMapPage.tsx`. Phase 1 of the original
parking lot plan (read-only union view, per-session toggle) shipped.

**Sequencing note:** #18 Phase 2 (real AAA coverage) can now build on
this lab-wide union safely. The hard sequencing dependency the
original entry called out is satisfied.

**Source:** Agent verification 2026-05-10 via grep + file read.
Operator confirmed shipped 2026-05-10.

---

### C9. Tier-1 smoke test checklist (formerly #6)

**Closure evidence:** `docs/smoke-test-tier1.md` documents the Tier-1
smoke-test process and post-deploy verification steps. Shipped via
PR #81 as part of the 2026-05-10 wave.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C10. Per-module gating (formerly #7)

**Closure evidence:** Client-side `useIsReadOnly` module keys wired
on `client/src/pages/VeritaPolicyAppPage.tsx` and
`client/src/pages/VeritaLabAppPage.tsx`. Server-side
`requireModuleEdit('veritapolicy')` and `requireModuleEdit('veritalab')`
guards added on `/api/veritapolicy/*` and `/api/veritalab/*` write
routes in `server/routes.ts`; `requireModuleEdit('veritatrack')`
added on 7 write routes in `server/veritatrack.ts`. Verified by
operator: seat user set to View on `veritapolicy` blocks UI saves
and returns 403 from curl; restoring Edit resumes writes; same
pattern verified for `veritalab` and `veritatrack`. Shipped via
PR #76.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C11. VeritaStock shipped copy (formerly #8)

**Closure evidence:** `client/src/pages/ArticleInventoryManagementPage.tsx`
line 305 footer reads "platform that includes VeritaStock™" instead
of the prior "planned for a future release" wording. Verified live
on `/resources/laboratory-inventory-management`. Shipped via PR #75.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C12. Admin report one-row-per-lab (formerly #14)

**Closure evidence:** `/api/admin/report` rewritten in
`server/routes.ts` (~line 595) to LEFT JOIN `labs` on
`owner_user_id`, expanding multi-lab owners into one row per lab
with the lab's own CLIA. Backward-compatible response shape returns
both `labs` (new) and `users` (legacy alias) so the rollout is
revertible. `client/src/pages/AdminReportPage.tsx` updated to read
`data.labs ?? data.users`, use `effective_clia_number` /
`effective_lab_name`, and key React rows by `lab_id` when present.
Operator-confirmed multi-lab owners now require a second `labs`
row added via Account Settings to surface two rows (data
prerequisite, not a code bug). Shipped via PR #85.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C14. UI relabel "CLIA TEa" -> "Lab-Set Internal Goal" (formerly #1)

**Closure evidence:** Shipped across four PRs over 2026-05-10.

- PR #77: added `hasCanonicalTea(analyte)` and `teaLabelFor(analyte)`
  helpers in `client/src/lib/cliaTeaData.ts` and
  `server/backfillAbsoluteFloor.ts`; swapped the
  `StudyResultsPage.tsx` KPI label so non-canonical analytes show
  "Lab-Set Internal Goal" instead of "CLIA TEa".
- PR #89: added 6 non-canonical analytes (Lipase, Bilirubin Direct,
  Bilirubin Unbound, Iron Saturation, Vitamin D 25-OH, Procalcitonin)
  to `CLIA_PRESETS` on `VeritaCheckPage.tsx` under a new SelectGroup
  "Lab-Set Internal Goal (no CLIA TEa)" with value=0 and cfr="" so
  the form does not cite §493 for them.
- PR #92: promoted the in-form help text to a visible amber callout
  box so users notice the non-canonical category.
- PR #96 (merge commit ccae239): completed the customer-facing
  artifact sweep. Added 4 wording helpers in `server/pdfReport.ts`
  (`criterionLabel`, `criterionAdjective`, `criterionSourcePhrase`,
  `criterionAuthorityPhrase`). Wired them into supportingPageHTML
  (headline "Adopted Acceptance Criterion (TEa)" + "CFR Reference"
  rows become "Lab-Set Internal Goal (no CLIA TEa)" + "Source:
  Laboratory-defined per director or designee policy. No CLIA PT
  criterion exists for this analyte under 42 CFR §493 Subpart I."
  for non-canonical). Wired through all 6 narrative branches:
  cal_ver pass/fail, method_comp pass/fail, precision pass/fail,
  lot_to_lot, pt_coag (the multi-analyte aggregate uses neutral
  per-analyte phrasing since one study can mix canonical and
  lab-defined analytes). Added `acceptanceCriterionLabel(testName)`
  helper in `server/routes.ts` and replaced all 8 demo-PDF persisted
  summaries.

**Verification:** Live `/api/demo/studies/364/pdf` (Glucose precision,
canonical analyte) returns a 3-page PDF that still cites "§493 PT TEa
for this analyte", "Adopted Acceptance Criterion (TEa)", and "adopted
under 42 CFR", and contains NONE of the non-canonical wording
("Lab-Set Internal Goal", "laboratory-defined", "no canonical CLIA PT
criterion", "per laboratory director or designee policy"). The
non-canonical branch is the opposite ternary arm of the same helper
calls and is type-checked by Railway's build; no demo studies exist
for non-canonical analytes yet, so end-to-end PDF verification of
that branch requires creating a real Lipase or Vitamin D study.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C13. WSLH PT vendor (formerly #15)

**Closure evidence:** Shipped 2026-05-10 via PR #79 (merge commit
eeebc6e; merged after rebase to resolve a `server/db.ts` collision
with PR #80's `aa_records` migration block, with both blocks
preserved side by side). `pt_enrollments_v2` CHECK constraint
rebuilt in `server/db.ts` to include `'WSLH'` via idempotent
CREATE NEW + INSERT SELECT + DROP + RENAME migration block.
`shared/wslhCatalog.ts` added with 6 starter programs (1310 General
Chem, 1260 Cardiac, 1080 Blood Lead, 1524 HbA1c, 4190 Hepatitis
Serology, 2230 Hematology). `'wslh'` added to `VALID_PT_VENDORS` in
`server/routes.ts`. WSLH wired into the vendor selector on
`client/src/pages/AccountSettingsPage.tsx` and into the vendor list
on `client/src/pages/VeritaPTAppPage.tsx`. Migration log line
`[migration] pt_enrollments_v2 vendor CHECK rebuilt to include
'WSLH'` is the post-deploy success signal. Shipped via PR #79.

**Source:** Operator instruction 2026-05-10 in this session.

---

### C15. VeritaStock lot tracking + expiration + reorder alerts (formerly #21)

**Closure evidence:** VeritaStock™ shipped the bench-level inventory
features the Perplexity competitor analysis identified as a gap:

- `inventory_items` table includes `lot_number TEXT` and
  `expiration_date TEXT` columns (server/db.ts:2294, 2310, 2313).
  Verified 2026-05-21 via PRAGMA table_info on the live DB.
- Per-lot consumption visible via the existing
  GET /api/labs/:labId/inventory endpoint (each item row carries
  current lot_number; consumption deltas tracked in scan_events
  ready for the future barcode scanning build, parking-lot #29).
- Reorder alerts shipped via PR #286 (commit a4a1fa6) as the
  "order now" reorder document PDF + Excel with director signature
  workflow. Triggered when qty_on_hand <= burn_rate * (lead_time +
  safety_stock). The customer-facing artifact is what
  myLabCompliance.io calls a "reorder alert"; we call it a "reorder
  document" to match the regulatory documentation framing.
- Expiration alerts visible in the VeritaStockPage stats card
  ("Expiring <30d") and the per-item Expiration column in the table
  (client/src/pages/VeritaStockPage.tsx:542-544).

**Honest gap:** myLabCompliance.io may ship more aggressive push
notifications (email or SMS) on lot expiry; VeritaStock today
surfaces this in-app and via the dashboard tile only. If a customer
asks for proactive expiration emails, that becomes a small follow-up
not a re-open of the full category.

**Source:** Originally Perplexity competitor analysis 2026-05-10.
Audit 2026-05-21 confirmed the feature set ships today.

---

### C16. PAL studies guided workflow (formerly #23)

**Closure evidence:** VeritaCheck™ already ships the Precision /
Accuracy / Linearity (PAL) study set under EP-protocol naming:

- **Precision (P):** `studyType === "precision"` — Precision
  Verification (EP15). Shipped with full math parity to EP Evaluator
  including CIs, 2 SD range, vendor SD verdict, and side-by-side
  PDF render verified against the Pfizer A-ALT precision study
  (2026-05-19 demo follow-up, PRs #277-282).
- **Accuracy (A):** `studyType === "method_comparison"` — Correlation
  / Method Comparison. Same EP-equivalent workflow as the PAL
  framing.
- **Linearity (L):** `studyType === "cal_ver"` — Calibration
  Verification / Linearity. Shipped with regression analysis,
  per-level recovery, and PDF render.

All three are available from the VeritaCheck™ study type picker;
they are not packaged under the "PAL" umbrella label because the
EP-protocol naming is more precise (P = EP15, A = method comparison,
L = EP6 cal_ver) and matches the regulatory citation chain on the
PDF deliverables.

**If a customer specifically requests the "PAL" wrapper terminology,**
that is a copy / UX update only, not a new build. Coverage is at
parity.

**Source:** Originally Perplexity competitor analysis 2026-05-10.
Audit 2026-05-21 confirmed the EP studies cover the PAL framing in
full.

---

### C17. Source-grounded 21/29/45 CFR + 42 CFR 482-485 (formerly #26)

**Closure evidence:** PR #301 (commit 8c27806, merged 2026-05-21)
source-grounded the 74 remaining non-493 entries in
`server/cfrRequirements.ts` against verbatim eCFR XML. Breakdown
shipped:

- 43 entries citing 21 CFR (Parts 606, 610, 640 - blood bank cGMP)
- 12 entries citing 29 CFR 1910.x (OSHA bloodborne pathogens,
  chemical hygiene)
- 10 entries citing 45 CFR 164.x (HIPAA Security Rule)
- 9 entries citing 42 CFR 482 / 483 / 484 / 485 (hospital and LTC
  Conditions of Participation)

Verbatim text comes from
`https://www.ecfr.gov/api/versioner/v1/full/{date}/title-{N}.xml`
through the same `rebuild_cfr_from_ecfr_v10.py` pipeline used for
the 493 sweep. Em-dash normalize per CLAUDE.md §3 applied. Header
comments updated to record the additional issue date.

**Follow-on:** The operator-facing concern about verbatim copy
displacement is tracked separately as parking lot #30 (plain-language
summary layer). #30 is additive to the verbatim text shipped in
this close-out, not a replacement for it.

**Source:** PR #301; tasks #18 in the in-session task tracker.

---

### C18. VeritaPolicy "Non CLIA" chapter rename (formerly #3)

**Closure evidence:** PR #300 (commit 34d7707, merged 2026-05-21)
renamed all 44 user-facing chapter labels in
`server/cfrRequirements.ts` that started with "Non CLIA". The string
was an artifact of the generator script categorizing CFR rows by
whether they sat inside or outside 42 CFR Part 493 (CLIA), and the
internal taxonomy was leaking onto the user-facing /veritapolicy
page.

Verified 2026-05-22 by grep: `Non CLIA` returns zero hits in
`server/cfrRequirements.ts`. The labels now read as customer-facing
descriptors anchored to the actual CFR title and topic.

**Earlier partial fix:** Phase 3.6 (commit 2600b3f) had stopped the
UI from rendering the underscored chapter slug alongside the label;
that stopped the "Non_CLIA_*" form from leaking but not the "Non
CLIA" wording itself. PR #300 closed the second half by editing the
data file directly.

**Source:** CAP customer screenshot of the /veritapolicy chapter
headers, 2026-05-01 evening. PR #300; tasks #17 in the in-session
task tracker.

---

### C19. VeritaStock department-scope toggle (formerly #31)

**Closure evidence:** PR #319 (commit d01f5fe, merged 2026-05-22)
shipped the persistent dept-scope toggle on VeritaStockPage. A new
"Working in:" selector in the page header lets a user choose between
"Lab-wide" (default) or any specific department. The choice is
persisted to `ui_preferences.veritastock_scope` and restored on every
reload so users who manage a single department land in their own
workspace without re-filtering.

**Implementation note:** scoped down significantly from the original
3-day Option A plan in the parking lot. The original called for
server-side reorder-list endpoint changes (Day 2), but the existing
endpoints already honor `?department=` query param via PR #304
(vendor filter work). Since the new scope toggle just syncs the
client-side `filterDept` to the user's saved scope on load, the
existing reorder URL builder picks up the dept scope automatically.
No server changes needed. Net diff: 49 lines on one file.

**Behavior model:** scope is the persistent default at load time;
filterDept is the session-level transient override. Changing
filterDept mid-session does NOT update scope (deliberately, to avoid
aggressive auto-saves). Changing scope via the new selector DOES
sync filterDept so the table immediately reflects the new default.

**Source:** John, San Carlos lab, 2026-05-21. Same conversation that
drove the vendor dropdown (PR #304), FILTERED VIEW banner (PR #305),
and Snap Order workflow (PR #307).

---

### C20. Primary-lab seat counting (formerly #12)

**Closure evidence:** `is_primary_lab INTEGER NOT NULL DEFAULT 0`
column was added to the `lab_members` table at db.ts:1276, with the
ALTER TABLE migration at db.ts:1302 ensuring the column is added on
production databases that pre-date the change. The first-lab-created
default is wired at db.ts:1387 (initial INSERT sets is_primary_lab=1
for the seed owner) and db.ts:1446 (membership lookups prefer
is_primary_lab=1 ordering).

The seat-counting logic that honors the primary-lab rule lives at
routes.ts:759 -- the `isSecondaryRow` check treats memberships where
`lab_id` is set AND `is_primary_lab !== 1` as secondary-lab rows
that do not burn a paid seat against the owner's seat count.

Schema, default-on-first-lab, lookup ordering, and seat enforcement
are all in production. The original decision ("owner burns one paid
seat on their primary lab, free implicit seat on every additional
lab they own") is implemented as written.

**Source:** 2026-05-07 multi-lab discussion. Build shipped as part
of the Multi-Lab Tier 2 architecture work (Phase 3.x series, prior
sessions). Status drift discovered 2026-05-22 during parking-lot
audit.

---

### C21. Multi-lab pricing model — Option A (formerly #11)

**Closure evidence:** PR #322 (commit 0ccd925, merged 2026-05-22)
added the customer-facing line to the pricing page that reflects
the parking-lot decision. Initial copy overspecified by asserting
"each lab gets its own subscription at its own tier" -- that
language committed the public page to a pricing structure that
contradicts Enterprise+ positioning ("custom pricing, custom
scope"). Softened the same session in a follow-up PR. Final block
on `client/src/pages/PricingPage.tsx`, immediately after the
Enterprise+ block, reads:

"Own multiple separate labs? Email us and we will work out the
right setup."

with a mailto link to `info@veritaslabservices.com`.

**Decision (per original entry, intent preserved):** the actual
structure (independent subscriptions at full tier price vs one
custom Enterprise+ contract) gets worked out per-customer in the
email conversation, NOT pre-anchored on the public pricing page.
This is why the entry was "Option A" without published bundle
discounts: simplicity and flexibility, with the conversation
shaped by each owner's actual situation.

**Distinct from Enterprise+:** Enterprise+ targets multi-site
health systems buying one centrally-scoped plan; multi-lab owner
block targets one owner with multiple independent labs (different
CLIA numbers, often different tiers, possibly different needs).
Different buyer mental model, both end at "email us."

**Source:** 2026-05-07 multi-lab discussion (Lisa Veri's
canonical-case session). PR #322 (initial build); softening PR
follow-up the same day after the operator caught the Enterprise+
conflict.

---

### C22. VeritaOps cost-per-test module (formerly #10)

**Closure evidence:** v1 of the VeritaOps Cost-Per-Reportable-Test
(CPRT) module shipped across PR #325 through PR #330 on 2026-05-22.
The module is feature-complete for the typical lab director workflow.

**v1 build summary:**

- **PR #325** v1.0 foundation: schema `veritaops_test_cost_studies`
  + ALTER migrations, `server/veritaops.ts` with `computeCprt()` and
  10 CRUD routes (account-scoped + lab-scoped), minimal
  `VeritaOpsAppPage.tsx` with create/edit/list/delete and live
  L1+L2 preview. Plan-gated. CLSI GP11-A cited in page subtitle.
- **PR #326** v1.5 discoverability: Operations marketing tile +
  NavBar entry, addressing the gap where v1.0 shipped a page with
  no nav path. Same-PR discipline lesson recorded in the commit
  message.
- **PR #327** v1.1: L3 (equipment depreciation) and L4 (overhead,
  flat dollars or % markup) opt-in sections in the dialog; live
  preview extended to show enabled layers; studies table gains L3
  and L4 columns with em-dash on opt-out.
- **PR #328** v1.2: PDF export via `server/veritaopsPdf.ts` using
  puppeteer. Internal-use report header, 2x2 CPRT result grid,
  annual cost projection at deepest enabled layer, full assumptions
  table for audit transparency, methodology block citing CLSI GP11-A.
- **PR #329** v1.3: side-by-side comparison view. Per-row checkboxes,
  Compare button activates at exactly 2 selections, dialog shows
  4-layer comparison table with cheaper-side emerald highlighting +
  annual cost tiles at each study's deepest enabled layer.
- **PR #330** v1.4: starter templates. 5 archetypes (custom blank,
  chemistry high-volume, hematology CBC, manual diff, send-out
  reference). Picker only shows when creating new (not editing);
  preserves user-typed test name when applying a template.
- **This PR (v1.5)** ships `scripts/verify-veritaops-cprt-math.js`
  with 10 known-input test cases exercising L1, L2, L3, L4 math
  including divide-by-zero edge cases and the two archetype templates.
  All 10 cases pass.

**Conceptual basis:** CLSI GP11-A "Basic Cost Accounting for
Clinical Services" (1998, the canonical lab cost-accounting
document). Research validated 2026-05-22 via session web pass:
[[reference_active_pipeline_doc]] context, GP35 was incorrectly
cited initially, corrected to GP11-A. HFMA has no lab-specific
cost-accounting framework so we do not cite them. The four-layer
model (Direct -> +Labor -> +Capital -> +Overhead) is universal in
cost accounting literature and aligned with what ADLM, ASCP, and
the published activity-based-costing studies independently describe.

**v2 backlog (NOT shipped, recorded for future work):**

- Excel export (Master List-style branded workbook with About sheet)
- Bulk import from LIS (rolling cost from real volume data)
- Vendor catalog integration (Roche / Abbott / Beckman menu reagent
  prices pre-loaded as defaults)
- Cost roll-up at the department level (sum all tests in Chemistry)
- Annual reporting view ("here is what your test menu cost this year")
- Activity-based costing (multi-step time tracking instead of one
  minutes-per-test number; the ABC PMC study referenced in research
  pass shows the academic methodology)
- Integration with VeritaStock (live reagent cost from inventory
  rather than user-entered; obvious next move because VeritaStock
  already tracks reagent cost + lot info)
- CMS CLFS comparison (let users enter Medicare payment per test
  alongside CPRT to show the margin/loss per test)

**Source:** This thread, 2026-05-07 12:05 PM CDT, user message:
"Parking lot: build an operations module for cost per test
calculations." Scoping pass + research session 2026-05-22; v1
build same session. PRs #325 through this one.

---

### C23. CCL lab name visual disambiguation in lab switcher (formerly #34)

**Effort:** XS (under 1 day, actual)
**Importance:** Low — cosmetic; only mattered when Lisa or Michael picked the wrong lab from the dropdown.

**What shipped (PR #361):** Added a `distinguishingSuffix()` helper to `client/src/components/LabSwitcher.tsx` that finds the longest shared prefix across a user's lab names and surfaces the differing tail. When the shared prefix is >20 chars (e.g. Lisa's two Milford labs that share "UMass Memorial Health - Milford Regional Medical Center"), the tail is rendered as a bold-foreground span on the active-lab chip and as an uppercase primary-tinted pill on each dropdown row. Role and primary flags also rendered as proper pills. Dropdown width bumped w-72 → w-80. Hovering a row shows the full lab name via `title=`.

**Source:** flagged 2026-05-23 immediately after provisioning Lisa's CCL lab; closed 2026-05-24.

---

### C24. VC Unlimited Y1/Y2 price disclosure UX (formerly #35)

**Effort:** XS (under 1 day, actual)
**Importance:** Low when shipped (proactive, no customer complaint yet) — but high if a procurement reviewer later disputes the $499 renewal as undisclosed.

**What shipped (PR #362):** VC Unlimited tile on `/pricing` now renders the price block as two prominent lines: `$299 first year` at text-3xl bold and `$499 /yr after` at text-2xl bold directly below. Procurement reviewers can no longer lock onto the headline $299 and miss the renewal disclosure. Implemented by splitting the PLAN data's combined `period` field into `period` + new optional `priceY2` / `periodY2` fields, with a conditional second-line render in PricingPage.tsx. Other tiles unchanged because the conditional gate is on `priceY2`.

**Source:** Pricing rebuild 2026-05-23; closed 2026-05-24 proactively before any customer dispute.

---

### C25. VeritaQC Phase 1 (Levey-Jennings + Westgard live engine) (formerly #20)

**Effort:** L (about 5 days end-to-end, actual: Phase 0 schema → Phase 1A evaluator → 1B entry UI → 1C daily review → 1D monthly PDF + attestation)
**Importance:** High — largest single gap vs myLabCompliance.io per Perplexity competitor analysis; promotes VeritaAssure from documentation tool to lab operations platform.

**What shipped (PRs #364, #365, #366, #367, #368, #369, #370, #371):**
- Phase 0 (#364): six-table schema (`qc_control_lots`, `qc_results`, `qc_rule_violations`, `qc_corrective_actions`, `qc_period_reviews`, `qc_rule_settings`) with PRAGMA-guarded ALTER migrations + admin seed/dump endpoints.
- Phase 1A (#365): `evaluateWestgardForLot` server-side rule engine (1-2s, 1-3s, 2-2s, R-4s, 4-1s, N-x, N-T) with baseline-excludes-candidate evaluation. `POST /api/labs/:labId/qc/results` ingests a result, evaluates rules, returns violations + `requires_corrective_action`. Per-lab + per-analyte rule settings (`bias_consecutive_count`, `trend_consecutive_count`).
- Phase 1B (#366): `VeritaQCAppPage` tech entry UI with lot picker, result form, in-the-moment violation banner, required corrective-action modal on rejection, recent-results table. Three endpoints: `GET /qc/lots`, `GET /qc/results`, `POST /qc/corrective-actions` (with optional `exclude_from_baseline`).
- Phase 1B fix (#367): render form disabled instead of hiding on read-only labs; added `POST /api/admin/extend-lab-subscription`.
- Stale-seat cleanup (#368): `POST /api/admin/seat-cleanup-by-user` to deactivate stray `user_seats` rows from the Lisa-cascade fallout.
- Phase 1C (#369): `VeritaQCDailyReviewPage` cross-lot triage feed grouped by lot, status filter (any / with_violation / missing_ca), summary tiles. `GET /qc/recent` endpoint with date + status filters.
- Phase 1D (#370): `server/pdfQCMonthly.ts` Puppeteer + HTML monthly review PDF with on-page-1 attestation block and inline SVG Levey-Jennings chart (Westgard color bands). Three endpoints: `GET /qc/period-reviews`, `POST /qc/period-reviews` (upsert by lab+lot+year+month), `GET /qc/period-reviews/pdf`. "Monthly Review & Attestation" card on the Daily Review page.
- Owner-override fix (#371): `useIsReadOnly` now returns false immediately when the user is owner or admin of the active lab, regardless of `isSeatUser` state. Closes the architectural gap where stale seat rows from another lab poisoned module rendering on the owner's own labs.

12/12 evaluator scenarios PASS in `scripts/verify-westgard-rules.js`. CLSI C24 supports lab-configurable bias/trend N via `qc_rule_settings`. Phase 1 is feature-complete; future phases (PT integration, multi-instrument LJ overlays, automated calibrator-lot bridging) deferred.

**Source:** Perplexity competitor analysis 2026-05-10. Scoping confirmed via the build_phase1_mockup.py iterations 2026-05-24. Shipped 2026-05-25.

---

### C26. VeritaLab CMS-116 application support + state licensing registry (formerly #22)

**Effort:** M (1-2 weeks for v1, actual)
**Importance:** Medium — competitor parity (myLabCompliance.io) plus useful at lab startup and at certificate-type changes.

**What shipped (five phases):** State licensure registry tab in VeritaLab, seeded with all 51 jurisdictions (state authority, form URL, fee, renewal cadence). CMS-116 form-fill UI tab inside VeritaLab. Draft-to-PDF generator producing the federal CLIA application form from the saved draft. Issued-cert wire-back so the generated certificate from a successful submission lands in the existing certificate tracker without manual re-entry. VeritaLab sub-tab plumbing so both surfaces live alongside the cert tracker at `/veritalab-app`.

**Source:** Perplexity competitor analysis (myLabCompliance.io), 2026-05-10. Reclassified as a VeritaLab extension 2026-05-25. Shipped 2026-05-28.

---

### C27. Active vs view-only seat split (formerly #33)

**Effort:** M (~1 week of engineering, actual: shipped in a single multi-PR session)
**Importance:** Medium — closed the gap between /pricing copy and product behavior; gives sales a clean answer for "do you charge for our medical director?"

**What shipped (six PRs in sequence):**
- #430 foundation: `user_seats.seat_type` column ('active' | 'view_only', default 'active'), `PLAN_VIEW_ONLY_SEATS` map (Clinic 1, Community 2, Hospital 3, System 5), admin report aggregation gains active and view-only counts alongside the existing total.
- #431 invite flow: invite UI asks seat type at the moment of invitation; default 'active'; passes through to the lab-scoped POST `/api/labs/:labId/members` and user-level POST `/api/account/seats`.
- #432 counting gates: dual-cap enforcement at both invite endpoints with `SUM(CASE WHEN COALESCE(seat_type,'active') = ...)` subquery so legacy rows count as active. Owner counts as active. View-only failures return `addOnRatePerYear: 99`; active failures preserve the `nextTier` upgrade hint.
- #433 members page UI: usage card above the invite form ("Active X of Y used", "View-only X of Y used", $99/yr add-on hint at cap), seat-type chip on every member and pending-invite row, `GET /api/labs/:labId/members` extended to return `seat_type`, `seatLimits`, `seatCounts`.
- #434 server gate: `authMiddleware` loads `seat_type`, blocks view-only seats from any non-GET / HEAD / OPTIONS method with `403 view_only_seat`. 12/12 PASS in `scripts/verify-view-only-seat-gate.js`.
- #435 Stripe add-on: `STRIPE_VIEW_ONLY_ADDON_PRICE` env hook, `getViewOnlyAddOnConfig()` helper, `addOnPriceId` exposed on all 402 / GET responses. `scripts/verify-view-only-addon-config.js` runs 3 local assertions + 5 live Stripe assertions when both env vars are present.

`STRIPE_VIEW_ONLY_ADDON_PRICE` remains unset (manual-invoice mode) until Michael creates the recurring $99/yr USD price in the Stripe dashboard.

**Source:** Pricing analysis doc Decision 3 (2026-05-21); MEDIUM scenario revised 2026-05-29 to retire the "unlimited view-only" claim. Shipped 2026-05-28.

---

### C28. "Why VeritaCheck" comparative one-pager (formerly #37)

**Effort:** S (one design pass + four claim paragraphs + PDF + matching marketing-site page, actual)
**Importance:** Medium — closed a positioning gap surfaced by six COLA conference attendees attached to a legacy verification tool; converts product-quality advantage into a leave-behind Lisa can hand out.

**What shipped (two PRs):**
- #428: full article page at `/article/why-veritacheck` covering cost, time-to-first-study, suite integration, and compliance; 1-page Puppeteer PDF generator; marketing-site presence so the article surfaces from the homepage navigation.
- #429: 1-page PDF margin and font fix (margins 12mm → 10mm, fonts shrunk 0.5pt, closing block trimmed) so the PDF holds to a single page instead of overflowing onto page 2.

Copy avoids naming "EP Evaluator" per CLAUDE.md §3; uses "other evaluation tools" and "legacy verification software." Audience recognition is the leverage.

**Source:** 2026-05-11 / 2026-05-12 conference notes review with Michael. Conference attendees (Whitehead, Odegard, Othman, Molinelli, Kyle, Allred) expressed interest in equivalent / superior product. Shipped 2026-05-28.

---

### C29. VeritaPolicy approval workflow — MediaLab functional mirror

**Effort:** XL (one focused session, 12 PRs landed)
**Importance:** High — replaces MediaLab Document Control ($752/$2,250 starting price, scaling to $10K-$20K/yr at enterprise per Capterra public data) with an included VeritaPolicy feature; closes a real positioning gap and gives sales a direct comparator line.

**What shipped (12 PRs over the 2026-05-29 session):**
- #438 Phase 0: 9-table schema (policy_manuals, policy_documents, policy_versions, policy_approval_workflows, policy_approval_steps, policy_signoffs, policy_attestations, policy_review_reminders, policy_audit_log) with PRAGMA migrations.
- #439 Phase 1: upload + manuals UI at `/labs/:labId/veritapolicy-app/my-policies`. 10 default manuals auto-seeded. DOCX/PDF/HTML upload via multer + mammoth render.
- #440 Phase 2: workflow engine with state machine (draft → in_review → approved → expired → archived). Default workflow library seeds 1-step LD approval + 2-step TC then LD.
- #441 Phase 2.1: workflow visibility polish — pending-step badge under in_review status, owner Recall button, eligibility warning in submit dialog.
- #442 Phase 3: 21 CFR Part 11 hardening — bcrypt password re-auth on approve/reject, sha256 tamper detection on render + download, signature history block in View modal.
- #443 Phase 4: employee read-and-attest with assign / list pending / complete endpoints; per-user-per-version idempotency.
- #444 Phase 5: periodic review re-certification with password gate; advances next_review_date by review_interval_months.
- #445 Phase 6A: compliance dashboard at `/labs/:labId/veritapolicy-app/compliance` with headline tiles, per-manual coverage, overdue + due-soon lists, per-user attestation rate.
- #446 Phase 6B: daily cron-fired email reminders via Resend (30_day_warning / overdue / final thresholds). Auto-expire deferred to 6C.
- #447 Phase 7: new-version upload, version history block in View modal, search bar with client-side filter.
- #448 Phase 8: surveyor public links — lab generates signed URL, surveyor browses approved policies at `/surveyor/:token` without auth. Auto-expires, revokeable, use_count tracked. The MediaLab differentiator.
- #449 QA helper: admin endpoint `POST /api/admin/veritapolicy/qa-corrupt-hash` so the tamper detection path can be exercised end-to-end without volume access.

**QA verification (2026-05-29):**
- API suite: 35/35 PASS against live prod via `C:\Users\veril\tooling\playwright-recorder\qa-policy-build.js` (password gate verified, attestation idempotency verified, surveyor token validation verified across short/unknown/revoked/expired states).
- UI suite: 19/19 PASS via Playwright with three browser contexts (owner, QA approver, anonymous surveyor) at `qa-policy-ui.js`.
- PDF upload + render + mobile viewport + synthetic tamper test (qa-policy-extras.js) blocked at session end by Railway token re-auth issue; tests written but not executed.

**MediaLab functional gap remains:** see new entry #39 (MediaLab parity hardening) for the 60-70% surface coverage assessment — quizzes on attestations, PDF watermarking, SSO/AD, in-browser DOCX editing, delegated approvals, reviewer-phrase library, cross-policy linking. The build shipped the surface MediaLab markets; depth and edge cases remain shallower than MediaLab's 30-year hardened version.

**Source:** Pricing strategy conversation 2026-05-29 (Michael: "I don't like bolt-ons; we should replicate this") → scoped 8 phases → shipped all 12 PRs in single session. Shipped 2026-05-29.

---

## NOT CARRIED OVER (explicitly rejected)

### R4. Mini-LIS module (formerly #24) — HIPAA boundary

**Rejected 2026-05-21 by operator decision.**

**Reason:** A Laboratory Information System handles order entry, result
reporting, patient demographics, MRNs, accession numbers, and specimen-
to-patient linkage. Every one of those touches PHI and pulls VeritaAssure™
across the HIPAA boundary. That triggers BAA negotiations, SOC 2 Type 2,
breach notification obligations, PHI encryption at rest, and audit
trails on every patient-data read. That is a different company with a
different cost structure and a different sales motion.

**Boundary statement:** VeritaAssure™ stays PHI-free as a permanent
architectural and business constraint. The compliance documentation,
QC, inventory, instrument mapping, competency, and policy modules all
sit on the non-PHI side of the line and stay there. New feature
proposals that would require accessioning, patient identifiers, or
specimen-to-patient linkage are rejected on this basis without needing
a per-feature debate.

**Source:** 2026-05-21 strategic decision (this session).

---

### R5. Phlebotomy module (formerly #25) — HIPAA boundary

**Rejected 2026-05-21 by operator decision, same basis as R4.**

**Reason:** Specimen collection by definition links a tube to a patient.
Phlebotomy workflow (drawing, labeling, accessioning, routing) is LIS-
shaped, not compliance-shaped, and crosses the same HIPAA boundary as
R4 Mini-LIS. Phlebotomist credentialing and competency tracking can
still land in VeritaStaff™ or VeritaComp™ when they ship; the
specimen-workflow surface itself is out of scope.

**Source:** 2026-05-21 strategic decision (this session).

---

### R6. WSLH PT booth follow-up email (formerly #16) — stale

**Closed 2026-05-21 by operator decision.**

**Reason:** Originally parked 2026-05-07 after the COLA Nashville booth
meeting. Delayed indefinitely on 2026-05-10 pending operator review of
WSLH contact details, and remained delayed without progress through
2026-05-21. Two weeks of no movement on a "send within 5-10 business
days" item is the real signal that the moment passed. Closing rather
than leaving in indefinite-delay state where it pretends to be active
backlog at every session bootstrap.

If WSLH outreach is needed in the future, that becomes a fresh parking
lot entry with a current set of facts rather than a re-animation of
the 2026-05-07 conversation.

**Source:** 2026-05-21 cleanup decision (this session).

---

### R1. Rotate Railway token because it appeared in chat

**Reason:** Per session 299e9a73 turn 7 (and STANDING_REQUIREMENTS.md
"CREDENTIAL HANDLING" section): tokens the user pastes in our chat are
not a leak; the agent does not auto-park rotation. The original "rotate
GitHub PAT" item was added because the PAT had been written into
committed SESSION_HANDOFF.md files in past sessions and pushed to the
repo, which is an actual leak. Token-in-our-conversation is not.

**Source:** session 299e9a73 turn 7, ~2026-04-28.

---

### R2. Real Stripe checkout abandonment diagnostic (formerly #2)

**Reason:** Operator decision 2026-05-10 — abandoned. Not pursuing a
Stripe-session-based abandonment diagnostic. The original concern
(text-parsed inference incorrectly presented as diagnosis) is noted
as a class of error to avoid; the build itself is no longer wanted.

**Source:** Operator instruction 2026-05-10 in this session.

---

### R3. VeritaScan sign-off date field (formerly #9)

**Reason:** Operator clarification 2026-05-10 — VeritaScan sign-off
is not a regulatory requirement. The cross-reference value with
VeritaMap correlation (originally proposed as the motivating use case)
does not justify adding the schema and UI. No code change.

**Source:** Operator instruction 2026-05-10 in this session.

---
