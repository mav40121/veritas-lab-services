# CLAUDE.md — Veritas Lab Services / VeritaAssure

This file is the contract between Claude Code and Michael Veri for work in this repo. Read it in full at the start of every session before writing any code, making any tool call, or touching any file. STANDING_REQUIREMENTS.md (in this same directory) is the authoritative long-form spec; this file is the operational summary plus repo-specific workflow knowledge. When the two disagree, STANDING_REQUIREMENTS.md wins, and you fix CLAUDE.md.

---

## 0. Operator

- Michael Veri, MS, MBA, MLS(ASCP), CPHQ
- Owner, Veritas Lab Services, LLC (Massachusetts, filed 1/2/2026)
- Title: Laboratory Operations Consultant
- Email: VeriLabGuy@gmail.com / info@veritaslabservices.com
- Timezone: America/New_York (Eastern). Home base Massachusetts (Upton). Travels on-site for consulting engagements (was Globe, Arizona for the SCAHC engagement through 7/31/26); default to ET for all "my time" / scheduling unless he says he is traveling.

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
- Trademark symbols (2026-10-27): the USPTO registered VeritaAssure (SN 99731002), VeritaMap (SN 99730987), VeritaScan (SN 99730993) and VeritaCheck (SN 99730975), issue date October 27, 2026. Those four use ®; every other product name uses ™ until its own registration issues, and ® on an unregistered mark is an error. script/audit.py enforces both directions (REGISTERED_MARKS; receipt scripts/verify-registered-marks-audit.py). The VeritaAssure® suite is eighteen modules organized into two streams:
  - **Compliance (12):** VeritaCheck®, VeritaMap®, VeritaScan®, VeritaComp™, VeritaPolicy™, VeritaStaff™, VeritaLab™, VeritaPT™, VeritaTrack™, VeritaResponse™, VeritaQC™, VeritaMaintain™ (the rebranded Equipment Maintenance module; route /equipment-app).
  - **Operations (6):** VeritaBench™, VeritaPace™, VeritaShift™, VeritaQA™, VeritaStock™, VeritaOps™.
  - The suite mark itself is VeritaAssure®. Any public-facing copy that gives a module count must say "eighteen" (12 compliance + 6 operations).
- EP Evaluator MAY be named in public-facing copy (rule relaxed 2026-09-27 by Michael; historically this was banned). Reasoning: in our field everyone knows the name, and naming the incumbent makes the menu-to-studies comparison land. Keep comparisons factual and non-disparaging.
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
- Footer every page: `VeritaAssure® | [Module]™ or ® (registered marks only) | Confidential — For Internal Lab Use Only | Page X of Y`.
- Author metadata: `Perplexity Computer`.

### Regulatory language (VeritaCheck narratives)

- Bold the regulatory determination: "The results for [Test] meet/do not meet the CLIA minimum total allowable error criteria per 42 CFR §493.XXX."
- PASS and FAIL use identical sentence structure — only "meet" vs "do not meet" differs.
- Never tell the director what to do on a FAIL. No "do not report patient results" language.
- Always end the narrative with: "Final approval and clinical determination must be made by the laboratory director or designee."
- ONE signature block on all PDFs: "LABORATORY DIRECTOR OR DESIGNEE REVIEW" with Accepted / Not accepted checkboxes + Print Name/Initials/Date.
- NO separate "Accepted by" block — it is redundant.
- Header must say "LABORATORY DIRECTOR OR DESIGNEE REVIEW" — never just "LABORATORY DIRECTOR REVIEW".
- CFR by specialty (42 CFR 493 Subpart I headings, eCFR as of 2026-10-01): Routine Chemistry = §493.931, Endocrinology = §493.933, Toxicology = §493.937, Hematology = §493.941, Immunohematology = §493.959, General Immunology = §493.927, Syphilis Serology = §493.923, Microbiology = §§493.911-493.919 (Bacteriology §493.911, Mycobacteriology §493.913, Mycology §493.915, Parasitology §493.917, Virology §493.919), default = §493.931. §493.945 is Cytology (gynecologic examinations) ONLY, never microbiology (it was wrongly listed here as Microbiology until 2026-10-09). Histopathology has no Subpart I section. Full specialty→section map: server/veritamapData.ts CFR_MAP, pinned by scripts/verify-cfr-specialty-map.mjs.
- The results screen's narrative is client/src/lib/studyNarrative.ts and the printed one is server/pdfReport.ts narrativeHTML; keep them saying the same thing (2026-11-08). A criterion stored in units (teaIsPercentage 0: Sodium ±4 mmol/L, Potassium ±0.3 mmol/L, Calcium ±1.0 mg/dL, pH ±0.04) holds the number itself, so never multiply it by 100. CFR paragraphs, from the CFR text: calibration verification limits 42 CFR §493.1255(b)(2) and §493.1253(b)(3); precision of an unmodified FDA-cleared test §493.1253(b)(1)(i)(B); method comparison §493.1281(a). No "Manufacturer precision claims are verified" unless a vendor claim was entered. Lot-to-lot and PT/INR cite §493.1255(b)(3)(i), as their reference block does. scripts/verify-study-narrative.mts pins all of it.
- A units criterion in precision and lot-to-lot (Michael 2026-11-08, Q239 = 1): precision passes a level when 2 SD is within the limit (sd <= limit / 2, the k=2 reading the absolute floor already used); lot-to-lot compares each pair's difference and the cohort's mean absolute difference in units. A percent criterion's absolute floor counts on the screen as it always did in the stored verdict (precision: CV within the percent OR 2 SD within the floor; lot-to-lot: each pair within the greater of the two). computeStudyStatus and client/src/lib/calculations.ts must agree; tests/integration/units-limit-rule.test.ts compares them. Linearity (EP06) with a units criterion (Michael 2026-11-08, Q240 = 1) passes when every level's mean is within the limit of its assigned value and r² >= 0.95, the test calibration verification already uses for a units limit; before, it was compared as 100% slope error, so r² alone decided. A percent criterion keeps |slope - 1| x 100 within the percent. The rule is in computeStudyStatus, client/src/lib/studyResults.ts and the VeritaCheckPage save path; the screen and PDF add a |Mean - Assigned| column and say which acceptance applied. The boot recompute skips saved units-criterion precision, lot-to-lot and linearity studies (isUnitsRuleStudy), so their saved verdicts stay until Michael decides; `GET /api/admin/veritacheck/units-limit-counts` (header `x-admin-secret`) gives counts by type (precision, lot_to_lot, linearity), lab ids and preset names, and how many saved verdicts the rule would change. It writes nothing. Summary lines name the unit (calculateCalVer and calculateMethodComparison take it; computeStudyResults passes it through criterionForm), and Save draft stores teaIsPercentage, teaUnit and the floor as Submit does. Printed determinations cite what their own reference block cites: linearity §493.1253(b)(1)(i)(C) (reportable range), reference range verification §493.1253(b)(1)(ii) (reference intervals); scripts/verify-cfr-paragraph-citations.mjs pins both.
- The startup floor backfill never touches a study with a preset label (BUG-139, Michael 2026-11-08, Q241 = 1). Pass 1 of backfillAbsoluteFloorOnStartup (server/backfillAbsoluteFloor.ts) gave a floor to any study with none whose name loosely matched a floor analyte, so a "Lab-defined" Creatinine at 5% gained ±0.2 mg/dL on the next deploy, and "IgE" took PSA's floor through the substring match; a floor only loosens, so a saved FAIL could read PASS. It now skips a labeled row as Pass 2 already did; a legacy row with no label (saved before 2026-06-04) still gets one. Rows it changed before stay as they are until Michael decides: `GET /api/admin/veritacheck/floor-backfill-counts` (header `x-admin-secret`, read-only) counts labeled rows holding the floor the pass gives that their own criterion doesn't carry (presetWithoutFloor: certain; labDefined: possible, the lab may have typed it), and how many verdicts that floor decides, by lab id. tests/integration/floor-backfill-label.test.ts and regulated-analyte-labels.test.ts pin it.
- No ADLM half-TEa claim (Michael 2026-11-06, Q210 = 1). No source exists for it, so don't put it back. Narratives state the CLIA determination and leave any internal goal to the laboratory's director or designee. CLIA leaves the criterion to the lab, the director documents why, and CMS says PT limits aren't performance goals; never call using PT limits "recommended". script/audit.py fails on the claim.

### VeritaCheck sign-in

- Signing in is required to save or open a study (Michael 2026-11-06, Q193 = 1). `GET /api/studies`, `GET /api/studies/:id` and `POST /api/studies` refuse anyone signed out or with a bad session, and answer the same whether or not the study exists. Studies with no owner (user_id NULL or 0, from before this rule) stay in place and unopened: `GET /api/studies/:id` gives 404 even signed in. Michael decides later whether they stay, so don't delete them. `GET /api/admin/access-audit-counts` gives their count, oldest and newest dates, and how many carry a lab.

### VeritaCheck labels

- "Calibration Verification / Linearity" — never "Cal Ver" or "Linearity" alone.
- "Correlation / Method Comparison" — never "Method Comparison" alone.
- No ADLM half-TEa claim in narratives (Michael 2026-11-06, Q210 = 1; see Regulatory language above).
- CUMSUM is a study type within VeritaCheck®, never a standalone module. Never list it as its own feature, row, or module.

### VeritaMap rules

- Critical values: lab-entered only, labeled plainly "Critical Low" / "Critical High" (blank until the lab records its MEC-adopted thresholds; a "MEC Reviewed/Approved" column records the adoption). The prior Mayo Clinic Laboratories starting-point layer was removed 2026-07-10 (it never worked as intended); a Mayo reference link now lives only in the VeritaMap Resources tab. Do not re-introduce a Mayo (or any vendor) critical-value default.
- Reference ranges: BLANK — the lab enters their own verified values per CLIA 493.1253. Never pre-populate.
- AMR: BLANK — same reason.
- Complexity (WAIVED / MODERATE / HIGH): lab-stated only, same class as the three above. It is a REGULATORY property, not a display field — it drives PT enrollment (493.801), performance verification (493.1253), competency elements (493.1235), QC design (493.1256), and personnel requirements (Subpart M). Never default it. `POST /api/admin/seed-instrument-menu` rejects a payload row with missing/blank complexity (`400 complexity_required`) and allowlists the three values (`400 complexity_invalid`). This was the one exception until 2026-07-16: a silent `|| "MODERATE"` default seeded CLIA-waived CLINITEK Status+ rows as MODERATE on San Carlos, over-applying requirements and producing a false readiness picture. To CORRECT complexity on an existing row use `set-complexity` (§13); re-posting through the seeder cannot fix it (INSERT OR IGNORE no-ops into `skipped[]`).
- Reference ranges and critical values are stored per age/sex BAND: `veritamap_analyte_values` is keyed `(map_id, analyte, age_min_days, age_max_days, sex)`, not `(map_id, analyte)`. The common case is one "All ages / any sex" band (`0`, `999999`, `'A'`), which is what every row meant before bands existed. `age_max_days` is NOT NULL with an UNBOUNDED sentinel of `999999` **on purpose**: SQLite treats NULLs as DISTINCT inside a UNIQUE index, so a nullable upper bound would silently permit duplicate rows and defeat the key. Do not "clean that up." Any upsert on this table must name the FULL key; the stale `ON CONFLICT(map_id, analyte)` throws `ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint` and 500s every save. `veritamap_tests` is a DIFFERENT table whose key is unchanged and correctly keeps `ON CONFLICT(map_id, analyte)`.
- Freeze pane at C2 specifically (columns A=Analyte and B=Instruments stay visible).

### Competency (VeritaComp)

- Timeline (Michael 2026-10-11): orientation/training documented first; Initial before patient testing (no deadline from hire); 6-month at initial + 6; 1st Annual at initial + 12 (closes the first year of patient testing, whatever day the 6-month was done); Annual thereafter. 42 CFR 493.1451(b)(9) / 493.1413(b)(9); 493.1235 sets no interval.
- Element 1 and 4: Observer initials field (not evaluator); observer must be LD, TC, or TS.
- Element 3: Date the tech RAN QC, not date reviewed.
- Evaluator signs the completed document; can be the same person as the observer; both fields required.
- Technical competency = any test producing a reportable result, including manual methods (Gram Stain, Manual Diff, Urine Micro).
- Evaluator title by complexity: Moderate = Technical Consultant, High = Technical Supervisor, Waived = General Supervisor.
- Per-method sign-off (Michael 2026-10-13, Q156/Q158): each method (instrument) is signed off on its own for each person, so onboarding is signed department by department; the whole-record Sign & Complete is retired. A method can be signed Fail or Remediation Required once its elements all have data or N/A; a Pass needs every element marked Pass or N/A (two passed methods for waived), and an unsigned entry with data and no Pass or N/A reads Needs review, never FAIL (Michael 2026-11-05, Q179 = 1; shared/competencyStatus.ts). Signer must be a VeritaStaff person whose role fits the method: Moderate = TC or TS for that specialty (a TS for a specialty meets the TC requirements, Michael Q159) or LD (493.1413(b)(8), 493.1407(a)); High = TS for that specialty, a GS named in an active Letter of Delegation for competency (493.1463(b)(4)), or LD (493.1451(b)(8), 493.1445(a)); Waived = GS, TC, TS or LD. Nobody signs their own competency (Michael Q163). Rules live in shared/competencySignoff.ts and are re-checked on the server. Each method runs its own clock from its own signed initial (Q157 = 1).
- Staff self-entry (Michael 2026-09-27, opened to the person page 2026-11-05 after RFGH staff could not enter their specimen numbers): a Staff login adds the factual DATA on their OWN unsigned record, on the person page (`PUT .../test-system/:id/my-data`) and on a program record in My sign-offs (`PUT /api/staff-portal-session/competencies/:id`). Technical: Element 1 specimen ID, Element 2 evidence and date, Element 3 QC date, Element 5 sample type and ID, Element 6 quiz ID, score and date. Waived: evidence and date, per specimen on blind specimen testing. The observer, Pass, N/A, Acceptable, Element 4, evaluator initials and sign-off stay the evaluator's; the server takes them from the stored row whatever is sent (shared/competencySelfEntry.ts, server/competencySelfEntry.ts). A mark belongs to a specimen or sample row by position, so a row carrying one can't be removed. "Own" comes from the session seat, never the client. The per-lab implicit "Competency" record is only a container: it is never listed for acknowledgement and /sign refuses it; My sign-offs shows a plain row to the person's own record instead.
- Staff logins see their own competency data only (Michael 2026-11-05, Q182 = 1), in every lab. server/competencySelfEntry.ts staffOwnScope decides it per lab from the session: anyone holding a staff_portal seat in the lab, in any status and with or without a roster link, is limited to that seat's active roster row, and a deactivated or unlinked seat is limited to nobody. Not limited: the lab's owner or admin, an org admin, anyone with another live seat in the lab (an editor with a staff card, a view-only reviewer), and a Staff seat given edit on the module. Each read returns only their own data or refuses with 403 `STAFF_OWN_ONLY`, including the older unscoped routes; a route keyed by a stored row checks that row's lab. Program names stay visible so staff can find their own records (`GET .../competency/programs` gives id, name, department, type, record kind and their own count, and leaves out the implicit container). The roster is their own row; VeritaTrack's task owner and VeritaPT's Tested by ask with `?names=1`, and a Staff seat with edit on those modules gets id, name and title. Qualified observers is only the people named on their own record. GET /api/labs/me carries `competencyOwnOnly` and `ownEmployeeId`, read through useStaffOwnScope, so VeritaComp shows them client/src/components/StaffOwnCompetency.tsx instead of the evaluator's screens. The same limit covers the rest of a person's staff file (Michael 2026-11-06, Q186 = 1), through rosterOwnIn, so a Staff seat with edit on VeritaStaff or VeritaComp keeps it: another person's credential documents, CE summary, CE transcript and VeritaCheck studies refuse with 403 `STAFF_OWN_ONLY`; veritaceu/roster-summary (which sends `ownOnly`, so the CE tab reads My status), staff/credentials-dashboard-stats, staff/cms209-readiness (`ownOnly` again, for the banner's wording) and GET staff-portal-invites return only their own; POST staff/cms209 refuses because it lists the whole lab. GET competency/reminder-config refuses through staffOwnIn because it names who gets the emails. Schedule names (GET schedule/staff) stay open by Michael's decision, because staff normally see who's working. GET members gives a Staff login its own row and no pending invitations, with `ownOnly`, and the members screen says to ask their director or supervisor (Michael 2026-11-06, Q192 = 1); a Staff seat with edit on VeritaStaff, VeritaComp, VeritaScan or VeritaDC keeps the list, because their owner pickers and assign list need the names. A new read of a person's data needs the same guard; the sweep in tests/integration/staff-own-competency-data.test.ts (section 36) fails if it shows a coworker. Two things stay open in it by decision: schedule/staff, and the lab's VeritaCheck study lists and coverage, because a study is the lab's record and who ran it isn't a personnel matter. A Staff login also never reads a quiz's answer key (Michael 2026-11-05, Q185 = 1): `GET /api/veritacomp/quizzes/:id?withAnswers=1` refuses it with 403 `STAFF_NO_ANSWER_KEY`, and a Staff seat with edit on VeritaComp keeps it because it builds quizzes. They see the answers for review only after submitting.
- Non-technical competency frequency (Michael 2026-11-04, "The sites shoudl be able to set frequency", go Q216 = 1, 2026-11-06): one setting per lab, `labs.competency_nontechnical_months`, 12, 24 or 36 months (shared/competencyNontechnicalFrequency.ts). Blank is today's behavior and the default: a non-technical record has no due date and sends no reminder. `GET/PUT /api/labs/:labId/competency/nontechnical-frequency`: any member reads it; only the lab's owner or an admin (lab, org, or Veritas support with access on) changes it, so an editor or a Staff seat with edit on VeritaComp gets 403 `OWNER_OR_ADMIN_ONLY`. With it set, each person on each non-technical program comes due that many months after their last signed, passing record there (server/competencyNontechnicalDue.ts): the date reuses addMonthsIso and signedRecordDate, and a Fail or Remediation Required as the newest signed record is due again now, as BUG-051 has it for a method. Worked out when read and never stored, so a save rewrites no record. Decide by the program's type, never `a.competency_type`: a Bulk Import or Cohort Sign-off row can hold 'technical' whatever its program is. Left out: new-hire evaluations, people marked Not applicable on the program, anyone inactive in VeritaComp or VeritaStaff, and anyone with no passing record (they still read Not assessed; a program isn't assigned to anyone, so there's nothing to date from). The lab's annual month doesn't move these dates. `GET .../nontechnical-due` gives a Staff login only their own rows. planCompetencyReminders adds these rows to the digest, escalation and monthly report; `computeCompetencyDue` stays technical only. The technical clock, the VeritaStaff schedule, the dashboard tile, the compliance score, Competencies owed and the register don't read this setting, so 42 CFR 493.1451(b)(9) and 493.1413(b)(9) timing can't move; tests/integration/competency-nontechnical-frequency.test.ts (section 8) compares every technical reader at each setting against blank. On screen: the "Non-technical competency frequency" card on VeritaComp, a date and an Overdue badge on the program's roster, and a Staff login's own date on their program row. The card's TJC sentence comes from Michael's 11/4 statement and paraphrases, so don't quote TJC text or name a dated manual there.
- A VeritaComp program holding competency records can't be deleted (Michael 2026-11-06, Q184 = 1), the way a quiz with results can't. `DELETE /api/labs/:labId/competency/programs/:id` and the older `DELETE /api/competency/programs/:id` both go through deleteProgramIfEmpty in server/routes.ts: any assessment on the program, in any status, or any item on its assessments or pointing at one of its method groups, returns 409 `PROGRAM_HOLDS_RECORDS` with `record_count`, `assessment_count` and `item_count`, and nothing is removed. An empty program still deletes, with its method groups, checklist items and Not applicable rows. The confirm box says how many records it holds and that they can't be deleted that way, in the words from shared/competencyProgramDelete.ts, with no Delete button; if the list is out of date, the server's refusal lands in the same box.
- A non-technical record never clears anyone for patient testing (2026-11-06). Only a technical or waived program's record can: `programCanClearForTesting` in shared/competencyClearance.ts, an allowlist, and queries write out `p.type IN ('technical', 'waived')`. It holds at Bulk Import (`importedByStaffEmployee`), whole-record Sign & Complete on both routes, the admin backfill (`earliestSignedInitials`), the not-cleared audit's "passed on file", and duty-change events (a non-technical Duty Change record leaves an analyzer's reevaluation open). A new-hire evaluation is type nontechnical, so it's covered. A non-technical record still loads onto its own program. Decide by the program's type, never `competency_assessments.competency_type`: every route now stores the program's type, but rows from before this rule hold 'technical' from Bulk Import and Cohort Sign-off, and they aren't rewritten. The content hash in My sign-offs keeps reading the stored value so a signature on file still matches. People a non-technical record already cleared stay as they are; scripts/count-nontechnical-clearance.sql counts them, and no admin route does. VeritaShift's competency-aware coverage (`getCompetentStaffByDept`) still counts any passed record in the department, because a non-testing bench such as phlebotomy has only non-technical competency: that's a product question, not this rule.
- Competency assessment type dropdown: Laboratory Director, Technical Consultant (Moderate), Technical Supervisor (High), General Supervisor (Waived/PPM).
- Coverage rule (Michael 2026-10-12): "If there are no new or unique skills, the competency covers both. Same rationale as 'you are competencied for potassium, therefore sodium is covered.'" A method group covers ONLY the analyzers it names (shared/competencyStatus.ts methodGroupCoversInstrument); analyzers with no unique skills between them (XN-1000 / XN-450, CA-660 Primary / Backup) go in ONE group. Never credit an analyzer through another group because they share a test or a department (that credited the manual differential via the XN-1000; BUG-043). A waived device with no naming group falls to a waived program.
- Method groups are the lab's choice (Michael 2026-10-14, Q166/Q168): every analyzer is its own method until the lab groups it on VeritaComp > Method groups (/veritacomp-app/method-groups). VeritaComp only SUGGESTS same make-and-model-family analyzers (shared/competencyGrouping.ts suggestGroups) and never groups on its own. A group must be one complexity, and a manual method groups only with other manual methods, never with an analyzer, which the screen states is the medical director or designee deciding there are no new or unique skills (Michael 2026-11-04; groupProblem, re-checked on the server). Manual methods are never suggested. The lowest-id analyzer is the lead and holds the working items; a group sign-off writes one competency_method_signoffs row per analyzer linked by group_signoff_id, so splitting a group keeps every analyzer's sign-offs. An analyzer belongs to at most one group (UNIQUE lab_id, instrument_id).
- A quiz follows the lab's method group (REQ-131, Redington, 2026-11-06). The tab's groups (competency_instrument_groups) and a program's rows (competency_method_groups, what a quiz is labeled with) stay two lists, joined at read time: a row belongs to a tab group when it names one of the group's analyzers by whole name (shared/competencyQuizGroups.ts; program detail sends it as `labGroups` on each row, never to a Staff login). The quiz form, the "Tests knowledge of" choices and the quiz card show the group and its analyzers as they are now, and the Element 6 picker takes a quiz labeled on another row of the same group, only after its own three matches find nothing. Nothing is copied onto the row and no quiz label is rewritten: a row's `instruments` decides what a competency record credits (BUG-043, BUG-120), so adding an analyzer there would credit assessments already on file with an analyzer nobody was assessed on. A tab group that shares no analyzer with any row of a program doesn't appear on that program's quizzes; Rebuild from VeritaMap adds the row.

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
- Demo lab fixture: Sample Regional Medical Center / CLIA 22D0999999 (Michael Q190 = 1, 2026-11-06: a real hospital had the old name; never name a fixture after a real facility). The public demo banner calls it "(fictional)". This is the only lab identity that may appear hardcoded, and only in demo-fixture builders.
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
- SISTER LABS (Michael 2026-11-06, Q191 = 1). Matching a record's owner doesn't by itself open the record: a seat in lab A doesn't reach lab B's records just because one owner holds both labs. The rule lives only in server/labAccessGuard.ts `ownerMatchCounts`: the match counts for the owner themself, a record with no lab, a seat in that record's lab, an older seat with no lab on it, or an older seat whose holder has no active lab membership anywhere (they have no lab switcher, so the owner match is all they work through). "Older" means accepted, or failing that invited, before `OLDER_SEAT_BEFORE`, or with neither date, so a new seat can't fall into the last two. `resolveRowForMutation`, the userCanAccess* helpers, `resolveActiveLabForRequest`, `resolveLabForUser` and `resolveLegacyLabId` all use it, so naming a sister lab in X-Active-Lab-Id gets nobody in. A route whose own query filters on the owner calls `ownerRowInReach` (the rule, or a membership in the record's lab). A new by-id route needs one of these; tests/integration/sister-lab-row-access.test.ts and the sister-lab logins in unscoped-read-lab-isolation.test.ts fail if a listed read or a list crosses. `GET /api/admin/access-audit-counts` gives `olderSeatsKeepingOwnerReach`, so nobody reads seat rows to see how many remain.
- Plan gate on every new module: use an explicit allowlist (see `client/src/pages/VeritaLabAppPage.tsx` for the canonical pattern). NEVER use a blocklist (e.g. `!["free","per_study"].includes(...)`). The audit script enforces this.
- Demo data: never delete demo studies, scans, maps, or trackers without explicit confirmation. Same test name does not mean duplicate; check study_type, date, and instrument first. Before any DELETE, read both records in full, explain the difference, get approval.
- **DATA PROVENANCE RULE (NON-NEGOTIABLE).** Never write fabricated, synthetic, or "example" data into any lab account. QC readings, control results, study values, competencies, inventory counts, dates, or anything that reads as a real measurement must originate from the user or the user's real source data, never invented by you. This holds even when asked to "seed", "populate", "make the demo look good", or when you judge a feature "invisible without data". Treat EVERY lab as real client/production data unless the user has explicitly designated it a throwaway sandbox in the current conversation. Before writing ANY data to a lab you did not just create as an explicit sandbox: (1) state plainly that you are about to write data, exactly what values and to which lab, and (2) get explicit confirmation that fabricated values are acceptable on THAT specific lab. An instruction to "seed the demo" is NOT that confirmation unless it also confirms the target lab holds no real data. Minting an owner JWT to bulk-write invented data via a script is the exact mechanism that caused the 2026-08-10 violation (12 fabricated QC readings on client lab 19, Gameday); owner-JWT writes are for the user's real actions only. When in doubt, treat the account as real and do not write. Build the feature and let Michael decide how to demonstrate it with real data.

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
8. Source of truth: read the actual file, API response, or schema before asserting how the code, prod, or DB behaves — never from memory, a summary, or a tool's cached index (a glob/search can miss a real file, e.g. when run from the wrong directory; confirm by reading the path). Validate SQL against the real schema via `scripts/audit-sql-columns.mjs` on an `/api/admin/schema-db` structure-only copy, never a fresh `db.ts` boot, and never a production data download (customer data is never used for testing, 2026-10-25). Full rule in STANDING_REQUIREMENTS.md.

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

**Staff Portal (read-and-sign access for non-writer staff)** — retires the prior $99/seat view-only model as of 2026-06-08 (locked at 0 paying labs, no grandfathering risk). Read-and-sign staff sign in with their own email and password (Staff seats issued from the flat band below), with per-event signature capture cross-referenced to the VeritaStaff™ roster. Surveyor-defensible audit trail. Used for policy read-and-sign, competency self-attestation, inventory adjustments, credential viewing, corrective-action acknowledgements. NOTE: the former CLIA + PIN shared-kiosk mechanism (and the separate inventory-count kiosk) were removed 2026-09-30; the Staff Portal is real per-person accounts, never a shared kiosk. See the `reference_seat_model_and_kiosk_retirement` memory.

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
- USPTO REGISTERED 2026-10-27: VeritaCheck SN 99730975, VeritaMap SN 99730987, VeritaScan SN 99730993, VeritaAssure SN 99731002 (use ®).
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
- Admin endpoints: `GET /api/admin/schema-db` (header `x-admin-secret`; structure only, no records; use this for testing and SQL checks), `GET /api/admin/backup-db?secret=$ADMIN_SECRET` (full data; backup and recovery only, never testing), `POST /api/admin/set-plan` with `{secret, userId, plan}`. Read `ADMIN_SECRET` from Railway env at use time.
- VeritaMap consistency admin endpoints (ADMIN_SECRET-gated; all support `{dryRun:true}` where they mutate): `GET /api/admin/veritamap/consistency-audit` (read-only, reports veritamap_tests vs instrument_tests divergence across live maps; the nightly guard's on-demand path), `POST /api/admin/veritamap/resync-complexity` (re-derive veritamap_tests.complexity = max instrument_tests complexity per analyte), `POST /api/admin/veritamap/purge-orphan-maps` (delete veritamap_* child rows whose parent map was deleted), `POST /api/admin/veritamap/add-analyte` (`{secret, labId, mapId?, instrumentNameLike, analyte, copyFromAnalyte, dryRun}`; `mapId` is required when the lab has more than one map and must be one of its maps: targeted INSERT OR IGNORE of one analyte onto every instrument on the lab's map whose name matches the substring; `copyFromAnalyte` mirrors an existing analyte's specialty+complexity so nothing is guessed; safer than the build-page full-replace because it cannot drop existing analytes), `POST /api/admin/veritamap/set-complexity` (`{secret, labId, mapId?, instrumentNameLike, analyte|analytes[], complexity, dryRun}`; `mapId` follows the same rule as add-analyte: the SOURCE-side complexity correction. UPDATE-only on existing `veritamap_instrument_tests` rows, then calls `rebuildMapTests`; targeted, dryRun-able, and it can neither insert nor drop a row. Use this when the BUILD PAGE itself shows the wrong complexity. Do NOT reach for `resync-complexity` for that: resync only re-derives the `veritamap_tests` rollup FROM `instrument_tests`, so against a wrong source it faithfully propagates the wrong value. Re-posting the correct value through `seed-instrument-menu` also cannot fix it: that insert is INSERT OR IGNORE and silently no-ops into `skipped[]`. Added 2026-07-16 after CLIA-waived CLINITEK Status+ rows sat MODERATE on San Carlos with no path to correct them). See `reference_veritamap_complexity_stores` memory.
- VeritaScan auto-completion audit: `GET /api/admin/veritascan/auto-completion-audit` (header `x-admin-secret`; read-only, counts only, no names): the items VeritaComp and VeritaCheck have marked, by item id.
- VeritaScan mark correction (Michael Q189 = 1, 2026-11-06; server/veritascanMarkCorrection.ts): `POST /api/admin/veritascan/correct-auto-marks` (header `x-admin-secret` only) moves automatic marks the records don't support back to Not Assessed with a note: a VeritaComp mark outside today's mapping (item 60 stays), and a VeritaCheck mark linked to a draft or failed study unless a passing study in the same scope marks that item. It's a dry run unless `{dryRun:false, expectedTotal:N}`, where N is the dry run's `total_to_move`; anything else is 409 `COUNT_CHANGED` with nothing written. The answer is counts per lab, with lab ids and no names. "Nothing has changed since" is read from the row's content (the lab's words in the notes, an owner, a due date, a teaching note, or evidence linked to the item), never `updated_at`, because the scan screen's auto-save rewrites `updated_at` on every item in the scan at each edit. `scan_saved_after_mark` counts marks to move in a scan saved since the mark; someone who looked and left it Compliant leaves no trace. A corrected row reads `completion_source = 'admin_correction'`, and each one has an audit row holding its values from before.
- VeritaMaintain stain log (2026-11-06, Michael Q178 = 1; server/stainLog.ts, shared/stainLogRules.ts, client/src/pages/StainLogPage.tsx, /labs/:id/equipment-app/stain-log). Two records and no new review. A month grid hangs on a `lab_equipment` row: the lab sets its own rows (`stain_log_rows`: stain or reagent, water or rinse, or check; as needed, daily or monthly, with the code the schedule asks for), and a day's cell holds codes in `stain_log_entries` (D, C, F, TO, R, or Acceptable and Problem on a check). A change (C) to a stain or reagent needs its lot and expiration; a lot past its expiration that day, or a Problem, needs the corrective action and is still recorded. A list-style manual log (`stain_manual_entries`) has the specimen's type and no specimen number, because the standing no-PHI rule rejects specimen-to-patient linkage. Every stain log write refuses text that looks like patient information or a labeled specimen number (400 `PHI_REFUSED`), the way tissue does. Entries are never edited: a void needs a reason, keeps the row, and only its recorder or a VeritaMaintain editor can do it. Recording is open to every member; rows need VeritaMaintain edit. A limited Staff login reads initials, as on paper, but not a coworker's name. server/maintainRecordReview.ts takes what the month shows, so one signature covers an instrument's maintenance and its stain log, and the manual log is one more record (`item_type = 'stain_manual'`, `item_id` = the lab) in a month it has entries; the Excel report gains its sheets only in such a month. Problems there: a daily row short on a day the instrument was used (anything on its grid that day; a stainer doesn't run every day, so a day with nothing at all is a note), a monthly row with nothing in a finished month, and a lot in the station past its expiration. An instrument holding entries can't be deleted (409 `HOLDS_STAIN_LOG`), and a row holding entries, voided ones too, can only be retired (409 `ROW_HAS_ENTRIES`). The older `solution_change` entry stays; its rows show read-only beside the grid. Printing is the browser's print of the same page (`#compliance-print-area`, landscape), not a PDF.
- ROSE blank form in VeritaDC (2026-11-06, Michael Q178 = 1; server/veritadcBlankForms.ts): rapid on-site evaluation carries a patient label, so it stays a paper form and is never a screen. `GET /api/labs/:labId/veritapolicy/blank-forms/rose.docx` (VeritaDC edit) builds the blank Word file with the lab's name and CLIA from the live record. "Use the blank ROSE form" fills the normal upload dialog as a Form, so it gets its number, version, approval and history like any document. It writes nothing until the lab uploads it.
- VeritaDC bulk load (2026-11-06, Heywood's move out of MediaLab; server/veritadcBulkLoad.ts, scripts/veritadc-bulk-load.mts): `POST /api/admin/veritadc/bulk-load/document` (header `x-admin-secret`, multipart) loads one document from a prior system as approved, with its number, version and real dates, into `policy_carried_records` with its signature face page. It writes no signoff and no attestation and sends no email; a rerun recognizes the number. `GET /api/admin/veritadc/bulk-load/status?labId=N` is counts only. The script's default is a dry run with no POST path; a real load needs `--apply` and, on production, `--go`. A lab-scoped GET (`/api/labs/:id/...`) with a service token is NOT write-free: it adds a `record_views` row (server/recordViews.ts). Read production for a dry run through `/api/admin/*` only.
- VeritaStock tissue (2026-11-06, Heywood, REQ-106; Michael Q152 = 1: NO PHI; server/tissue.ts, shared/tissueRules.ts, /labs/:id/veritastock/tissue): one row per graft in `tissue_units`, keyed on the supplier's tissue ID, with an append-only `tissue_unit_events` and the lab's own `tissue_catalog` (suppliers are `stock_vendors` rows, which can't be deleted while a tissue row uses them). No recipient or MRN field exists anywhere; a lookback runs tissue ID, then our record, then the hospital's chart. Every tissue write refuses text that looks like patient information (400 `PHI_REFUSED`), where the platform guard only warns. Issue is refused on an expired unit or any read-back not answered yes. A unit holds exactly one final disposition (`state`). Catalog, corrections and undo need VeritaStock edit; recording a step needs only write access. It doesn't exist on veritastock.com: every route answers 404 on a stock deployment and the page redirects. Admin: `GET /api/admin/veritastock/tissue/catalog-status?labId=N` (counts and product names only) and `POST /api/admin/veritastock/tissue/catalog-load` (`x-admin-secret`; dry run unless `apply: true` with `go`; a rerun adds nothing), driven by vls-ops/prod_heywood_tissue_catalog_load.mjs.
- VeritaDC read-and-sign by group (2026-11-06, Step D of Heywood's move; server/policyReadSign.ts, client/src/components/ReadSignDialog.tsx): a Staff login's My sign-offs, document list and bell show only what's assigned to them. An editor assigns a document, a manual (its sub-manuals and any later document come with it) or every document to lab groups (`lab_groups`, never a second group table), roster people or everyone (`policy_read_sign_assignments`, a rule worked out when read, so a new group member owes what the group owes). `POST /api/labs/:labId/veritapolicy/read-sign` sends no email at any scope; the only mail is `POST .../read-sign/notice`, one email per person who owes something and can sign in, which must name the count the editor saw (409 `COUNT_CHANGED`) and can't repeat for a scope inside 24 hours (409 `NOTICE_RECENT`). `veritaDcStaffGuard` sits in front of every `/api/labs/:labId/veritapolicy` route, by the staffOwnScope rule: a limited Staff login reads only an approved or review-overdue document's current version, and the tracker, signature list, signature report, audit trail and compliance page answer 403 `STAFF_OWN_ONLY`. A new read under `/documents/:id` stays closed until it is added to `DOCUMENT_READS_ALLOWED`; the sweep in tests/integration/veritadc-read-sign-groups.test.ts section 6 walks every VeritaDC GET. A limited login can look up any approved document read-only (`/api/staff-portal-session/policies/lookup`, search only, two letters; 42 CFR 493.1251(a) has the procedure manual available to laboratory personnel) and can't sign it (403 `NOT_ASSIGNED`). The boot that creates the table runs one seed (server/policyReadSignSeed.ts): a lab with approved documents and a Staff login or staff signature keeps today's behavior as "Everyone in the lab, All documents", except a lab holding carried-over documents. A new lab starts with nothing assigned and no groups. `GET /api/admin/veritadc/read-sign/status` (header `x-admin-secret`, optional `?labId=N`) is counts only.
- VeritaDC signature history (2026-11-06, Q207 = 1; server/veritadcHistoryLoad.ts, server/policyPriorSignature.ts, shared/policyPriorSignature.ts, scripts/veritadc-history-load.mts): a read-and-sign from a lab's prior system becomes a `policy_prior_signatures` row with its original date and the version the report names. It is never a `staff_portal_policy_signatures`, `policy_attestations` or `policy_signoffs` row, and every reader that decides "signed" also reads this table (policySignatureStatus.ts, policyReadSign.ts signedLookup, `GET /api/staff-portal-session/policies`), saying "Carried over from <system>". A row with a `version_id` counts as signed for that loaded version by signatureStillCurrent, so a later major asks again and a later minor follows the lab's rule; MediaLab's report names the major only, so 2.0 on a document loaded at 2.1 counts. A row with no `staff_employee_id` is history (inactive in the prior system, or not on this lab's roster): no login, owing nothing. `POST /api/admin/veritadc/history-load/rows` (header `x-admin-secret`) re-checks each row: the document must be carried over, the person on this lab's active roster, the name that roster row unless a person chose it. `GET .../history-load/status?labId=N` is counts only; `GET .../history-load/reference?labId=N` holds names, for the script only. The script's default is a dry run with no POST path and prints counts only; names go only to its files in the work folder. A real load needs `--apply` and, on production, `--go`. A name matches only with the same letters in the same order (case, spacing, periods, apostrophes and hyphens set aside); anything else goes on a people-to-check list and is fed back with `--people-map`. An open row writes nothing: the person owes it when the lab assigns the document, and the script lists them for the lab. The load sends no email, assigns no read-and-sign and creates no login.
- Demo lab fixture rename: `POST /api/admin/demo-fixture/rename` (header `x-admin-secret` only; server/demoFixtureRename.ts). One-time, moves the fixture's existing rows to the new name, and the demo user's studies to a made-up analyst, in one transaction. Dry run unless `{dryRun:false, confirm:"Sample Regional Medical Center"}`. The answer has counts and ids per table, plus `leftAlone`, the rows carrying the old name that aren't the fixture, which it never changes. The boot seed no longer sets the lab name, or the analyst those studies carried, on an existing row, so a deploy alone changes neither.
- Resend: `RESEND_API_KEY` in Railway env; production transactional email is wired to it.
- Newsletter test addresses (2026-11-09): `POST /api/newsletter/subscribe` answers a reserved test address (example.com/.net/.org and their subdomains, .test, .invalid, .example, .localhost; server/newsletterGuards.ts) with success and stores nothing and sends nothing. A smoke spec had posted one to production on every run (914 rows, each with a welcome email from info@). A live spec that writes to production must use a reserved address or clean up after itself. tests/integration/newsletter-reserved-domain.test.ts pins it.
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
- SQUASH-MERGE SUBJECT RULE. On `gh pr merge --squash`, the squash commit's SUBJECT defaults to the PR title and its body concatenates the branch commits as `* TASK:` bullets. The Commit Message Gate ("validate") re-runs on the push to main and checks the squash commit for `^TASK:` / `^PLAN:` / `^Self-check:` at LINE START. A bulleted `* TASK:` does not match `^TASK:`, so a default squash subject fails the gate, turns main's check suite red, and Railway ("wait for CI") then SKIPS every deploy and freezes production on the last green build (see deploy-freeze-alert.yml). ALWAYS squash with an explicit compliant message: `gh pr merge <n> --squash --subject "TASK: <summary>" --body "$(printf 'PLAN:\n  1. ...\n\nSelf-check:\n  - ...')"`. After any merge, confirm the `validate` check is green on the new main tip before assuming the deploy will run.
  - The keys must sit at LINE START, each on its own line. A one-line body like `TASK: x PLAN: y Self-check: z` FAILS the gate: only `^TASK:` matches; `PLAN:` and `Self-check:` are mid-line. This exact one-line-body mistake froze prod on 2026-09-28 (squash commits #1354 and #1357 both red; recovered by pushing one compliant commit to advance HEAD, since the gate re-validates only the commits in each new push). Use real newlines in `--body`, never spaces between the keys.

---

## 18. What "stop" means

When Michael says "stop", "do not touch this", "leave it alone", or any equivalent, you stop. You do not finish the in-flight tool call's logical follow-up. You do not "just push the small remaining piece". You do not re-open the topic in a later turn unless he explicitly reopens it.

If you violate a gate or a standing rule, the correct response is: state the violation plainly, do nothing else, and wait for direction. Do not propose remediation. Do not start a recovery plan. Wait.

---

## 19. One-line summary

Read STANDING_REQUIREMENTS.md and SESSION_START_CHECKLIST.md at session start. Open every reply with the Mandatory Response Template. Honor Gate 1 and Gate 2. Use `★ <option> [my-rec: ...]` format for every option. Never paste secrets in chat; pull them from Railway env. Always deploy with `latestCommit: true` plus an explicit `commitSha`. When Michael says stop, stop.
