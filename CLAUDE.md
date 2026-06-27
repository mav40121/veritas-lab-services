# CLAUDE.md — Veritas Lab Services / VeritaAssure

This file is the contract between Claude Code and Michael Veri for work in this repo. Read it in full at the start of every session before writing any code, making any tool call, or touching any file. STANDING_REQUIREMENTS.md (in this same directory) is the authoritative long-form spec; this file is the operational summary plus repo-specific workflow knowledge. When the two disagree, STANDING_REQUIREMENTS.md wins, and you fix CLAUDE.md.

---

## 0. Operator

- Michael Veri, MS, MBA, MLS(ASCP), CPHQ
- Owner, Veritas Lab Services, LLC (Massachusetts, filed 1/2/2026)
- Title: Laboratory Operations Consultant
- Email: VeriLabGuy@gmail.com / info@veritaslabservices.com
- Timezone: America/Phoenix (Globe, Arizona)

Michael is the regulatory and operational authority on every artifact you produce. You show your math, he decides if it ships.

---

## 1. MANDATORY RESPONSE TEMPLATE — every task, no exceptions

Before writing any code, making any tool call, or touching any file, your first message of the turn MUST begin with this block, filled in:

```
TASK: [restate the task in your own words, 1-2 sentences]
ASSUMPTIONS: [list assumptions; note anything unclear]
CLARIFYING QUESTION: [ONE question if something critical is missing, otherwise "None needed"]
PLAN:
  1. [step]
  2. [step]
  3. [step]
SELF-CHECK (complete BEFORE reporting done):
  - Potential error 1:
  - Potential error 2:
  - Potential error 3:
```

This applies to bug fixes, small changes, and large builds. "It seems obvious" is not a reason to skip it. The most damaging mistakes happened on tasks that seemed obvious. The husky commit-msg hook also enforces TASK: / PLAN: / Self-check: in every commit message; commits without those keys are rejected.

---

## 2. Procedural Gates (NON-NEGOTIABLE)

These are gates between specific tool calls, not principles. Either the prior call satisfies the precondition or the next call is a violation.

### Gate 1: Recommendation lockout

After you give Michael a recommendation in plain text (any sentence beginning with "I recommend", "My recommendation", "I'd suggest doing X", "Doing it" referring to your own proposal, or any equivalent), the very next tool call in the same turn must be one of:

- `confirm_action` proposing the recommended change
- `ask_user_question` clarifying the recommendation
- A read-only tool (`read`, `grep`, `glob`, `bash` running `cat`/`grep`/`ls`/`pdfinfo`/`curl -s` GET only)

The next tool call must NOT be `edit`, `write`, `bash` running `npm`/`git add`/`git commit`/`git push`, deploy mutations, or anything else that modifies files or remote state. This holds even when the recommendation seems obvious, low-risk, or follows from prior approved work. Momentum is not consent.

### Gate 2: Deploy confirmation

Every `git push` to `main` and every Railway `serviceInstanceDeploy` mutation must be preceded by an explicit user instruction in the conversation that names the change being deployed, OR by a `confirm_action` in the same turn that you called and Michael approved.

A user message saying "fix it" or "do it" earlier in the conversation does NOT cover later changes you introduced on your own initiative. Each deploy needs its own authorization tied to the specific commit being shipped.

Both gates are phrased so violations are detectable in the conversation log. If Michael finds you shipped without an authorizing message or confirm_action, that is a discrete, demonstrable breach.

### Gate 3: Verification before declaring done

Before any sentence in your reply that asserts a change is "shipped", "complete", "done", "fixed", "ready", "verified", "QC'd", or any synonym, you must have completed and surfaced the following in the same reply:

1. **Artifact verification.** The customer-facing output the change produces (PDF, page, API response, downloaded file) has been rendered or fetched and inspected against the intent in writing. Cite the file path or URL.
2. **Math verification.** If any computation changed, the math has been exercised on a known input set with expected outputs cited. A `scripts/verify-*.js` script is the standard receipt.
3. **Schema verification.** If a column or table was added or altered, confirm the migration ran in production by querying the new field via API or admin path.
4. **URL verification.** Every new route was hit (curl or browser) and returned a 2xx with the expected content.
5. **Bug-class sweep.** If a bug was fixed, audit the codebase for other instances of the same shape. State the search query and the result ("grep'd for X, found Y, all clean" or "found Z, fixed in same PR").
6. **Deploy verification.** The production deploy is ACTIVE on the commit hash containing the change, not just "PR merged". Pull `deployments` on the service and confirm.
7. **Conditional / null branch.** If the change has a feature flag, an optional input, or an if/else, exercise both states.
8. **Browser exercise.** If the change ships a customer-clickable button, link, form, or download trigger, server-side verify scripts are NOT sufficient — they test API correctness in isolation and miss timing, token, popup, blob, redirect, and rendering bugs that only surface through the actual browser flow. Before claiming done, exactly one of:
   - *Human-in-the-loop:* deploy to prod, then explicitly ask Michael to click the new button on the live URL and confirm the user-visible result. Wait for his confirmation. State explicitly: "deployed `<sha>`; Gate 3 requires you to click `<button>` on `<url>` before I can call this verified — please confirm or report what you see."
   - *Browser-automated:* run a Playwright or Puppeteer script that loads the actual page on prod (or staging), drives the click, waits for the user-visible result (new tab opens, PDF downloads, toast appears, table updates), and asserts on the user-visible state.

   This step exists because PR #286 shipped a "PDF token expired or not found" race that all 13 of my scripted verify checks PASSED. The script claimed the token in 50ms; the browser took 60+ seconds. Token-expiry bugs of that shape are invisible to script-only verification.

   Step 8 is in scope the moment a button, link, or form appears in the diff. Pure backend-wiring PRs that ship no UI element don't trigger it.

For multi-PR sequences, **run Gate 3 after every PR that touches a customer-facing artifact**, not after the whole sequence. Mid-sequence verification catches bugs while context is fresh; end-of-sequence verification lets bugs stack across multiple PRs and makes triage harder.

If any step is genuinely impractical (no local env, deploy delayed, private route, etc.), state so explicitly in the same reply. Skipping silently is a procedural breach.

**Exempted changes** that do not need Gate 3: memory files, scripts in `/scripts`, internal documentation, CI config, comments-only edits, and changes to this CLAUDE.md itself. State "Gate 3 N/A (internal change)" when claiming such a change is done.

Enforcement: violations are detectable by reading the conversation log. A "done" claim without the matching receipts is a discrete, demonstrable breach, same as Gate 1 and Gate 2.

### The verify-*.js convention

Any change to math, parsing, escaping, lot-tracking, or any logic with branching ships with a paired `scripts/verify-*.js` script that:

- Hardcodes a known input set (typically the exact data set from the bug report or the spec)
- Exercises every meaningful branch of the affected logic
- Asserts expected outputs and prints PASS / FAIL per case
- Exits with non-zero status on any failure (so it can land in CI later)

Existing examples to copy the pattern from:

- `scripts/verify-precision-parity.js` — math parity against EP Evaluator's printed values
- `scripts/verify-canonical-tea-matching.js` — hasCanonicalTea direct + fallback + negative cases

The verify script becomes the discoverable receipt for Gate 3 step 2 (math verification) and step 5 (bug-class sweep). Commit it in the same PR as the fix.

### The sanity-curl convention

After every deploy of a change that adds or alters a customer-facing API endpoint or field, run one `curl` against production after the deploy is ACTIVE and paste the response into the conversation. Three lines, ten seconds, removes the "merged ≠ live" failure mode.

Example shape:

```
curl -sS -H "Authorization: Bearer $TOKEN" https://www.veritaslabservices.com/api/labs/3/studies/491 | python -m json.tool | head -20
```

This satisfies Gate 3 step 3 (schema verification) and step 4 (URL verification) for server-side changes.

### How to ask questions

When you ask Michael a question with options, present them as numbered plain text in chat (not the AskUserQuestion modal — see STANDING_REQUIREMENTS.md "How to ask questions" for the modal exception):

```
**Q1 — Question text?**

1. ★ **Option label** — *[my-rec: brief reasoning]*
2. **Alternate option** — *[my-rec: why I do not recommend this]*
3. **Another alternate** — *[my-rec: why not this either]*
```

Required:

- **Numbered** so Michael can answer with "Option N".
- **Exactly one ★** on the recommended option. Not every option; not zero options. The ★ is the recommendation marker.
- **`[my-rec: brief reasoning]` on every option**, including the ones you are not recommending. Phrase the my-rec annotations so it is obvious which one you actually recommend.

Plain-text questions in chat without numbering, without the ★, or without `[my-rec: ...]` on every option are a procedural breach.

---

## 3. Copy Rules

- NO em dashes (—) in public-facing artifacts. Use commas, colons, or plain hyphens. Public-facing means anything a customer, prospect, accreditor, or non-employee sees: website copy, leave-behinds, brochures, generated PDFs (VeritaCheck, VeritaComp, VeritaScan, VeritaMap, VeritaLab, certificates, CMS 209), demo assets, marketing emails, social cards, externally shown decks, the master citation index xlsx, and book content. Em-dashes are tolerated only in internal files like this one, STANDING_REQUIREMENTS.md, code comments, and scratch notes. When in doubt, treat as public-facing.
- All product names use ™ not ®. The VeritaAssure™ suite is seventeen modules organized into two streams:
  - **Compliance (11):** VeritaCheck™, VeritaMap™, VeritaScan™, VeritaComp™, VeritaPolicy™, VeritaStaff™, VeritaLab™, VeritaPT™, VeritaTrack™, VeritaResponse™, VeritaQC™.
  - **Operations (6):** VeritaBench™, VeritaPace™, VeritaShift™, VeritaQA™, VeritaStock™, VeritaOps™.
  - The suite mark itself is VeritaAssure™. Any public-facing copy that gives a module count must say "seventeen" (11 compliance + 6 operations), not "twelve".
- NO reference to EP Evaluator by name — use "other evaluation tools" if the comparison is needed.
- NO CAMLAB references — use "TJC standard".
- NO dated accreditor manual references in public-facing copy. Never name a TJC, CAP, AABB, or COLA manual by year, month/year, or edition. Use "the current TJC standard" or "TJC standard for laboratory accreditation". The audit script enforces this.
- NO LabVine Learning references — removed permanently.
- Governing law = Massachusetts in all legal text.
- Labs **verify**, manufacturers **validate**. Never write "method validation" or "validation suite" describing what the lab is doing. Use "performance verification" or "verification of performance specifications" (per the CMS CLIA brochure of the same name).

---

## 4. URL Canonicalization (Print and Marketing)

- Canonical demo URL: `veritaslabservices.com/demo`. NEVER `veritaslabservices.com/#/demo`.
- Canonical compliance demo URL: `veritaslabservices.com/demo/compliance`. Same rule, no hash.
- Production: `https://www.veritaslabservices.com` (apex 301s to www; print QC requires the www. form).

Before declaring QC complete on any printed asset, brochure, leave-behind, deck, ad, social card, or generated PDF that contains URLs, run an explicit grep for these forbidden patterns and report the result:

- `/#/` (hash routing)
- `localhost`
- `127.0.0.1`
- `radiant-quietude` (Railway internal hostname)
- `staging`, `preview`, `pr-`
- any subdomain other than `www`

A clean grep is a required step in the QC checklist, not optional. Visual inspection is not a substitute.

---

## 5. PDF Requirements (NON-NEGOTIABLE)

- Signature MUST appear on page 1 of compliance documents (VeritaCheck studies, VeritaComp competency records, CMS 209). The director's approval (Accepted / Not accepted checkboxes plus Signature/Date/Print Name/Title) is the verdict, and it must be visible on the same page as the study results, narrative, and CFR citations. Never propose putting it on its own page.
- VeritaScan PDFs are internal use documents — no director signature required. Use an internal-use disclaimer instead.
- VeritaLab certificate reports — no director signature required.
- Statistics tables go on page 2+ if needed; never push the signature off page 1.
- Do NOT add a "Detailed results continued on page X" label. The page footer (Page X of Y) and the "Continued from page 1" section heading already convey this. The orphan label caused a dead-page bug on 2026-04-28.
- "Medical director or designee" everywhere — never just "medical director" or "laboratory director" alone.
- CLIA number on every report header. Show "CLIA: Not on file — enter in account settings" if missing.
- Footer every page: `VeritaAssure™ | [Module]™ | Confidential — For Internal Lab Use Only | Page X of Y`.
- Author metadata: `Perplexity Computer`.

### Regulatory language (VeritaCheck narratives)

- Bold the regulatory determination: "The results for [Test] meet/do not meet the CLIA minimum total allowable error criteria per 42 CFR §493.XXX."
- PASS and FAIL use identical sentence structure — only "meet" vs "do not meet" differs.
- Never tell the director what to do on a FAIL. No "do not report patient results" language.
- Always end the narrative with: "Final approval and clinical determination must be made by the laboratory director or designee."
- ONE signature block on all PDFs: "LABORATORY DIRECTOR OR DESIGNEE REVIEW" with Accepted / Not accepted checkboxes + Print Name/Initials/Date.
- NO separate "Accepted by" block — it is redundant.
- Header must say "LABORATORY DIRECTOR OR DESIGNEE REVIEW" — never just "LABORATORY DIRECTOR REVIEW".
- CFR by specialty: Chemistry = §493.931, Hematology = §493.941, Immunohematology = §493.959, Microbiology = §493.945, default = §493.931. (§493.927 is General Immunology, not Hematology. Full specialty→section map: server/veritamapData.ts CFR_MAP.)
- Cite ADLM-recommended internal goal alongside CLIA TEa where applicable.

### VeritaCheck labels

- "Calibration Verification / Linearity" — never "Cal Ver" or "Linearity" alone.
- "Correlation / Method Comparison" — never "Method Comparison" alone.
- ADLM goal cited alongside CLIA TEa in narratives.
- CUMSUM is a study type within VeritaCheck™, never a standalone module. Never list it as its own feature, row, or module.

### VeritaMap rules

- Critical values labeled "Critical Low (Mayo Clinic Laboratories)" and "Critical High (Mayo Clinic Laboratories)".
- Reference ranges: BLANK — the lab enters their own verified values per CLIA 493.1253. Never pre-populate.
- AMR: BLANK — same reason.
- Freeze pane at C2 specifically (columns A=Analyte and B=Instruments stay visible).

### Competency (VeritaComp)

- Timeline: Initial → 6-month → 1st Annual (6 months after the 6-month) → Annual thereafter.
- Element 1 and 4: Observer initials field (not evaluator); observer must be LD, TC, or TS.
- Element 3: Date the tech RAN QC, not date reviewed.
- Evaluator signs the completed document; can be the same person as the observer; both fields required.
- Technical competency = any test producing a reportable result, including manual methods (Gram Stain, Manual Diff, Urine Micro).
- Evaluator title by complexity: Moderate = Technical Consultant, High = Technical Supervisor, Waived = General Supervisor.
- Competency assessment type dropdown: Laboratory Director, Technical Consultant (Moderate), Technical Supervisor (High), General Supervisor (Waived/PPM).

---

## 6. Excel Standard (ALL exports)

- ExcelJS only — never SheetJS (it silently drops styles).
- Import pattern: `const { default: ExcelJS } = await import('exceljs')`.
- Teal #01696F headers, white bold Calibri 11pt, row height 20.
- Freeze pane: B2 minimum (C2 for VeritaMap).
- Auto-filter on all columns.
- Alternating rows: odd = white #FFFFFF, even = light blue #EBF3F8.
- Borders: thin #D0D0D0 on all cells.
- Font: Calibri, data rows size 10, color #28251D, wrap text, vertical middle.
- Status colors: Pass / Compliant / Active = bold green #437A22; Fail / Overdue / Expired = bold red #A12C7B; Due Soon / Pending = bold amber #964219; N/A / Not Required = muted gray #7A7974.
- Null values: blank cell — never literal "null" or "undefined".

### Customer-facing workbooks (NON-NEGOTIABLE — added 2026-05-03)

Applies to every customer-facing Excel deliverable (VeritaPolicy, VeritaScan, VeritaMap, VeritaComp, VeritaCheck export, audit-trail extracts).

1. About sheet is sheet 1. Workbook opens with the About sheet active.
2. **About sheet contents (mandatory order):** product title bar (brand teal), lab identity row (`Prepared for: <Lab Name>    CLIA: <CLIA>`), product disclaimer paragraph, How-to-use section, Source/provenance block, Coverage gaps paragraph with `info@veritaslabservices.com` email pattern.
3. **Lab identity stamped in three independent layers:** (a) visible About-sheet identity row, (b) `pageSetup.oddHeader.right` on every sheet carrying `<Lab Name>    CLIA: <CLIA>`, (c) `pageSetup.oddFooter.left` on every sheet carrying the same. Header and footer survive cell-level copy-paste.
4. Sheet protection on, with password. About sheet fully read-only. Data sheets lock all citation/identity columns; only review-input columns (Notes, Keep, comparable per-product) remain unlocked. Password sourced from server-side env, never committed.
5. Each About tab is hand-written for its product. No shared content helper. Structural boilerplate (brand colors, header/footer pattern, protection options) may be copy-pasted across routes; the About copy itself is authored per product.
6. Em-dash ban applies to every cell, header, footer, and About paragraph. Use periods or semicolons.
7. Brand colors only: teal #01696F headers, tint #E6F2F2 for section bars, alt-row #EBF3F8, text #28251D / #0A3A3D. No off-shades.
8. Identity values come from the live lab record at export time. Never hardcode except in demo-fixture builders.

---

## 7. Lab Identity (data layer)

- Real users: resolve via `storage.getUserById(req.user.id)`. Never hardcode lab name or CLIA in a production route.
- Demo lab fixture: Riverside Regional Medical Center / CLIA 22D0999999. This is the only lab identity that may appear hardcoded, and only in demo-fixture builders.
- Production export routes must read `lab_name` and `clia_number` from the user's record and pass them into the export helper.

---

## 8. Process Rules

- TEMPLATE-FIRST RULE. The filled-in Mandatory Response Template must be presented to Michael and approved BEFORE any file is modified. The husky commit-msg hook enforces TASK/PLAN/Self-check in every commit message.
- Large tasks: present a build breakdown first, get approval, THEN build.
- Multi-step safeguard plans: present the full plan, get explicit user confirmation ("yes", "build it", "go ahead"), THEN build. Never self-approve.
- Show mock PDF BEFORE building any PDF-generating feature.
- Never bundle more than 2-3 focused changes in one commit.
- Run a full audit after every significant build before reporting complete.
- NEW DB TABLE RULE. Every new CREATE TABLE must be accompanied in the same commit by ALTER TABLE migration blocks (using the PRAGMA table_info pattern). Tables created without migrations will have missing columns on the live server.
- DEBUGGING RULE. When a fix doesn't work after one deploy, test the live API directly before telling Michael to wait. Never tell him to wait more than once without running a live API test to confirm actual state.
- SCRIPT-WITH-ARTIFACT RULE. Any work product generated by Python (xlsx, pdf, csv, docx, pptx, json) must be delivered together with the .py script that produced it, in the same response. Sharing only the output is a procedural breach. If multiple scripts produced the artifact, share all of them.
- Plan gate on every new module: use an explicit allowlist (see `client/src/pages/VeritaLabAppPage.tsx` for the canonical pattern). NEVER use a blocklist (e.g. `!["free","per_study"].includes(...)`). The audit script enforces this.
- Demo data: never delete demo studies, scans, maps, or trackers without explicit confirmation. Same test name does not mean duplicate; check study_type, date, and instrument first. Before any DELETE, read both records in full, explain the difference, get approval.

---

## 9. Reasoning Standards

Apply to every task, not just large ones.

1. Restate the task in your own words.
2. Assumptions: identify them and the missing information. If something critical is missing, ask ONE clarifying question — do not guess.
3. Plan step-by-step before executing.
4. Execute with intermediate reasoning visible.
5. Self-check before reporting complete: list at least three potential errors, gaps, or edge cases. Revise if any are real.
6. Separate reasoning from the final answer.
7. Uncertainty: if unsure, say so explicitly. Never fabricate pricing, org names, regulatory citations, or statistics.

---

## 10. Pricing (live in Stripe)

**Published list pricing as of 2026-05-23 (MEDIUM scenario):**

- Per Study: $25 one-time (`price_1TGXPo5dn6rqLgIxsnvNa2oi`)
- Free trial: every new account is granted 2 free study credits (the standing VeritaCheck trial). On free/per_study plans, single studies AND Instrument Verifications each consume one credit and are blocked at 0 (402/403 `STUDY_CREDITS_EXHAUSTED`). Subscription plans and the demo `lab` are uncapped via the explicit `UNLIMITED_PLANS` allowlist. Gate lives in `server/studyCredits.ts`. Shipped 2026-06-27 (PR #875); this retired the prior unlimited-free single-study behavior. See the `project_veritacheck_free_study_credits` memory.
- VeritaCheck Unlimited: **$299 first year, $499/yr after** (`price_1TaQXR5dn6rqLgIxsi2uMrxS` is the $499 base; coupon `VCFIRSTYEAR` auto-applies $200 off once for Y1)
- Clinic: **$999/yr**, 2 active seats included, additional seats at $500/seat (`price_1TaQXR5dn6rqLgIxJVoI5Hsz` base, `price_1TaQXS5dn6rqLgIxLlLKs1Bv` add-on seat)
- Community: **$2,125/yr**, 5 active seats included, additional seats at $425/seat (`price_1TaQXR5dn6rqLgIxHnDQt7fU` base, `price_1TaQXS5dn6rqLgIx38gjkn6t` add-on seat) — Most Popular
- Hospital: **$4,995/yr**, 15 active seats included, additional seats at $333/seat (`price_1TaQXR5dn6rqLgIx5XOqsLKU` base, `price_1TaQXT5dn6rqLgIxxFWywFOy` add-on seat)
- System: **Custom quote**, triggered by >1 CLIA lab OR 16+ active seats OR SSO/BAA/SLA requirements. No published Stripe price; sales-team negotiated.

**Per-seat additional-seat model:** each tier's $/seat rate applies to ACTIVE seats above the tier-included count. No more total-seat-count bands. To get a lower per-seat rate, the customer upgrades tiers. The function `getSeatPriceForTier(plan)` in `server/stripe.ts` returns the tier-indexed add-on rate.

**Staff Portal (read-and-sign access for non-writer staff)** — retires the prior $99/seat view-only model as of 2026-06-08 (locked at 0 paying labs, no grandfathering risk). One shared lab kiosk login (CLIA + PIN, synthetic JWT, per-event signature capture cross-referenced to VeritaStaff™ employee dropdown). Surveyor-defensible audit trail. Used for policy read-and-sign, competency self-attestation, inventory adjustments, credential viewing, corrective-action acknowledgements.

Pricing is a flat band by staff count, not per user. Pitch line: **"You pay for who edits, plus a small flat band for who reads."**

- **Small band:** up to 25 staff — **$149/yr**
- **Medium band:** up to 100 staff — **$399/yr**
- **Large band:** up to 250 staff — **$799/yr**
- **Above 250 staff:** System tier custom quote, Staff Portal included in negotiation

Bands map to base tier archetypes: Small ≈ Clinic, Medium ≈ Community, Large ≈ Hospital. Each band is 14-19% of the base tier it maps to, and 7-15% of MediaLab's per-user equivalent at the same staff count. Honor system on staff count at the current scale; automated enforcement deferred until revenue justifies the build.

Stripe price IDs land in `server/stripe.ts` once the SKUs are created in the Stripe dashboard. Until then, Staff Portal add-ons are billed manually via invoice. Constants in `server/stripe.ts` reference env vars (`STRIPE_STAFF_PORTAL_SMALL_PRICE`, `STRIPE_STAFF_PORTAL_MEDIUM_PRICE`, `STRIPE_STAFF_PORTAL_LARGE_PRICE`) so the SKU creation can be done in the dashboard without a code deploy.

**Retired (preserve legacy IDs, never reference for NEW checkouts):** the $99/yr view-only seat add-on model (Clinic 1 / Community 2 / Hospital 3 included counts, $99/seat extras). The constants `VIEW_ONLY_ADDON_RATE_PER_YEAR`, `VIEW_ONLY_ADDON_UNIT_AMOUNT_CENTS`, and `getViewOnlyAddOnPriceId()` stay defined in `server/stripe.ts` per the no-delete rule. No customer is on this structure (0 paying labs at time of retirement).

**Coupons:**

- `VCFIRSTYEAR` — $200 off once, auto-applied at every VC Unlimited checkout. Delivers Y1 = $299 / Y2+ = $499.
- `COLA2026`, `BETA2026`, `DAVID10`, `JOHN2026` — partner / conference codes per the project memories.

**Grandfathered legacy IDs (preserved in `server/stripe.ts`, never delete; existing subs ride these):**

- Clinic / Waived: $499/yr (`price_1TGXPl5dn6rqLgIx14yANdxj`)
- Community: $999/yr (`price_1TKiEg5dn6rqLgIxrBKvqbGb`)
- Hospital: $1,999/yr (`price_1TKiEg5dn6rqLgIxXioYyC5u`)
- Enterprise / Large Hospital: $2,999/yr (`price_1TKiEg5dn6rqLgIxZ9ktBavQ`)
- Earlier-era (existing subs only): Community $799 (`price_1TGXPm5dn6rqLgIxHdfFVNfA`), Hospital $1,299 (`price_1TGXPm5dn6rqLgIxC5UCBXLn`), Enterprise $1,999 (`price_1TGXPm5dn6rqLgIxzahbIaQV`)

**Legacy seat band Stripe IDs (preserved; replaced by tier-indexed model going forward):**

- Seat bands: 2-5 = $199, 6-10 = $179, 11-25 = $159, 26+ = $139

**Founding Lab Program:** charter customer cohort, limited size, application-gated at `/founding-lab/apply`. Benefits: confidential discount, locked rate with annual at-will mutual renewal (Year 1 minimum commitment, 60 days' written notice to decline at any anniversary), facility name on Founding Labs page, priority support Year 1. Exchange: up to 2 reference calls per month (30 min, Veritas not present). Discount amount is never published; negotiated per applicant. The earlier "24-month price lock" framing was retired 2026-06-03 in favor of annual at-will mutual renewal at the locked rate.

**COLA grandfather policy:** see `project_cola_pricing_grandfather_policy.md` memory. Three layers: COLA2026 code through 2026-12-31, named-contact honored pricing OR Founder terms through 2026-09-30, new pricing for everyone else.

- Pricing tier is selected by the customer based on the number of active (writer) seats they need. Read-and-sign staff access is handled by the Staff Portal flat-band add-on described above (Small/Medium/Large by staff count), NOT per-seat. No "auto-assignment from specialty count" — that was an earlier pricing concept that was retired.

---

## 11. Legal / Compliance

- HIPAA acknowledgment required at signup, timestamped in DB.
- VeritaAssure is a statistical calculation tool; results require medical director or designee interpretation.
- No clinical verdict language; the software states the regulatory result, the director decides action.
- No PHI in any field, ever.
- Stripe keys from environment variables only; never hardcoded.
- USPTO filed: VeritaCheck 99730975, VeritaMap 99730987, VeritaScan 99730993, VeritaAssure 99731002.
- VeritaComp trademark NOT yet filed (pending revenue).

---

## 12. CREDENTIAL HANDLING (NON-NEGOTIABLE)

You do NOT ask Michael to paste operational secrets in chat. He does not type `ADMIN_SECRET`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `JWT_SECRET`, the GitHub PAT, or any other Railway-env value into the conversation. Asking is a violation, even if you think it would be faster.

- **Bootstrap credential.** The only secret you may ask for is the Railway API token, and only when it is not already stored in agent memory or STANDING_REQUIREMENTS.md. The token is the bootstrap, nothing else.
- **Standard retrieval pattern.** When you need an operational secret, query Railway's GraphQL `variables(projectId, environmentId, serviceId)` with the Railway token, read the value into a shell variable, use it in the same `bash` call, let the variable die with the process. The value never appears in tool output, never gets written to a file, never gets echoed back. Any temp file used during retrieval is removed in the same call.
- **No "give me the X secret" requests.** If you find yourself about to ask for `ADMIN_SECRET` or any other env value, stop and pull it from Railway env instead.
- **Do not flag operator-supplied credentials as compromised.** If Michael voluntarily pastes a token, treat it as a normal credential. Do not later tell him to rotate on the grounds that "it appeared in chat."
- Concrete token values do not belong in this file or STANDING_REQUIREMENTS.md. Use the placeholders below; read live values from Railway env at use time.

---

## 13. Infrastructure

- Railway API token: read from agent memory; if missing, ask Michael once. Never echoed in chat. Never written to a file.
- Project ID: `29c628f1-7860-4fca-8fee-227159bb86e8`
- Service ID: `170f5560-8cf0-4341-9c87-294062ebedd1` (`radiant-quietude`)
- Environment ID: `cd669f7c-23f3-434c-895d-ca40ac504e91`
- GitHub repo: https://github.com/mav40121/veritas-lab-services (`mav40121/veritas-lab-services`)
- GitHub PAT: stored as `GITHUB_TOKEN` in Railway env. Use `gh` / `git` via the `github` credential preset; no manual paste.
- Live site: https://www.veritaslabservices.com (apex 301s to www; print QC requires the www. form).
- Admin endpoints: `GET /api/admin/backup-db?secret=$ADMIN_SECRET`, `POST /api/admin/set-plan` with `{secret, userId, plan}`. Read `ADMIN_SECRET` from Railway env at use time.
- Resend: `RESEND_API_KEY` in Railway env; production transactional email is wired to it.
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in Railway env.
- JWT: `JWT_SECRET` in Railway env.
- GA4: Measurement ID `G-M3TB43ZX4E`; Property ID 503314560.
- Chase Stripe payout: ••••5726.

---

## 14. DEPLOY RULE (NON-NEGOTIABLE)

- Always use `latestCommit: true` when calling `serviceInstanceDeploy`. Without this flag, Railway redeploys a CACHED OLD BUILD, not the latest code.
- Correct mutation: `serviceInstanceDeploy(serviceId: "...", environmentId: "...", latestCommit: true)`.
- Better: include an explicit `commitSha` argument for the specific commit being shipped. This was the pattern used through the May 3, 2026 PRs (#37, #38, #39).
- Never use `serviceInstanceDeploy` without `latestCommit: true`. This caused a critical outage on 2026-04-14.
- Never use `serviceInstanceRedeploy` — it also uses cached builds.
- After deploy, always verify the deployment `commitHash` matches the expected commit by querying Railway (`deployments` on the service) and checking the result.

### Deploy preflight (Gate 2 reminder)

Before pushing or deploying, confirm:

1. Michael's most recent message in the conversation explicitly authorizes shipping this specific commit, OR
2. You called `confirm_action` in this turn and Michael approved.

"Fix it" or "do it" from earlier in the conversation does NOT cover changes you introduced on your own initiative.

---

## 15. Database Backup

- Railway volume backups require Pro plan (the hobby plan token lacks permission).
- Real backup endpoint: `GET /api/admin/backup-db?secret=[ADMIN_SECRET]` — downloads the raw SQLite file.
- The `nightly_snapshots` table is IN the same DB; not a real backup. If the DB is lost, snapshots are lost too.
- External backups must be downloaded to a separate location, not stored in the Railway volume.

---

## 16. Repo layout — files you'll touch most

- `server/routes.ts` — Express route definitions, including `/api/veritapolicy/*`, `/api/veritacheck/*`, `/api/veritamap/*`, `/api/admin/*`.
- `server/db.ts` — better-sqlite3 setup, CREATE TABLE statements, and the PRAGMA table_info migration blocks. Every new table goes here together with its ALTER migration.
- `server/storage.ts` — `getUserById` and other lab-identity reads. Production export routes pull `lab_name` and `clia_number` from here.
- `server/excel/` — ExcelJS export helpers. About-sheet boilerplate (brand colors, page-setup header/footer, sheet-protection options) lives here; product-specific About copy is authored in each route.
- `server/pdf/` — PDF generators (VeritaCheck, VeritaComp, VeritaScan, VeritaLab, CMS 209). Signature-on-page-1 rule is enforced here.
- `client/src/pages/VeritaPolicyAppPage.tsx` — 96-row master list UI; mirrors the polished Excel.
- `client/src/pages/VeritaPaceAppPage.tsx`, `client/src/pages/VeritaBenchAppPage.tsx` — both carry the MedLab Magazine how-to banner at the top.
- `client/src/pages/VeritaLabAppPage.tsx` — canonical example of the explicit-allowlist plan gate. Copy this pattern for new modules.
- `script/audit.py` — enforces em-dash ban, dated-manual-reference ban, allowlist-not-blocklist plan gates, URL canonicalization. Run it before reporting any significant build complete.
- `STANDING_REQUIREMENTS.md` — the authoritative long-form spec. Reference at the start of every build objective.
- `SESSION_START_CHECKLIST.md` — read at session start.

---

## 17. Commit and PR workflow

- Commits MUST include the `TASK:` / `PLAN:` / `Self-check:` keys in the message body. The husky commit-msg hook rejects commits without them.
- Use `gh` CLI for all GitHub operations with `api_credentials=["github"]` from bash. Do not paste a PAT in chat.
- Keep commits focused: 2-3 changes max per commit.
- For each new feature: open a PR, wait for the validate workflow to pass, request Michael's approval, then merge.
- The validate workflow runs against the diff and against historical commits in the PR's range. If validate fails on a historical commit (e.g., a revert), do not "fix" the historical commit. Stop and ask Michael how to proceed; do not force-push or rewrite history without explicit approval.

---

## 18. What "stop" means

When Michael says "stop", "do not touch this", "leave it alone", or any equivalent, you stop. You do not finish the in-flight tool call's logical follow-up. You do not "just push the small remaining piece". You do not re-open the topic in a later turn unless he explicitly reopens it.

If you violate a gate or a standing rule, the correct response is: state the violation plainly, do nothing else, and wait for direction. Do not propose remediation. Do not start a recovery plan. Wait.

---

## 19. One-line summary

Read STANDING_REQUIREMENTS.md and SESSION_START_CHECKLIST.md at session start. Open every reply with the Mandatory Response Template. Honor Gate 1 and Gate 2. Use `★ <option> [my-rec: ...]` format for every option. Never paste secrets in chat; pull them from Railway env. Always deploy with `latestCommit: true` plus an explicit `commitSha`. When Michael says stop, stop.
