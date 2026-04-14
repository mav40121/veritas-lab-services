# VeritaAssure — Standing Requirements
# These apply to EVERY build, EVERY commit, EVERY file. No exceptions.
# Reference this file at the start of EVERY coding task.

## MANDATORY RESPONSE TEMPLATE
# Before writing ANY code, making ANY tool call, or touching ANY file,
# the response MUST begin with this block filled in. No exceptions.
#
# TASK: [restate the task in your own words -- 1-2 sentences]
# ASSUMPTIONS: [list any assumptions being made; note if anything is unclear]
# CLARIFYING QUESTION: [ONE question if something critical is missing -- otherwise write "None needed"]
# PLAN:
#   1. [step]
#   2. [step]
#   3. [step]
#   ...
# SELF-CHECK (complete BEFORE reporting done):
#   - Potential error 1:
#   - Potential error 2:
#   - Potential error 3:
#
# This template applies to ALL tasks -- bug fixes, small changes, large builds.
# "It seems obvious" is not a reason to skip it. The most damaging mistakes
# happened on tasks that seemed obvious.

## Copy Rules
- NO em dashes (—) anywhere. Use commas, colons, or plain hyphens (-).
- All product names use ™ not ®: VeritaAssure™, VeritaCheck™, VeritaMap™, VeritaScan™, VeritaComp™, VeritaStaff™, VeritaLab™
- NO reference to EP Evaluator by name — use "other evaluation tools" if needed
- NO CAMLAB references — use "TJC standard"
- NO LabVine Learning references — removed permanently
- Governing law = Massachusetts in all legal text

## PDF Requirements (NON-NEGOTIABLE)
- Signature MUST appear on PAGE 1 of COMPLIANCE documents (VeritaCheck studies, VeritaComp competency records, CMS 209). No exceptions.
- VeritaScan PDFs are INTERNAL USE documents — NO director signature required. Add internal use disclaimer instead.
- VeritaLab certificate reports — NO director signature required.
- Statistics tables go on page 2+ if needed — never push signature off page 1
- Label: "Detailed results continued on page 2" when stats overflow
- "Medical director or designee" everywhere — never just "medical director" or "laboratory director" alone
- CLIA number on every report header — show "CLIA: Not on file — enter in account settings" if missing
- Footer every page: "VeritaAssure™ | [Module]™ | Confidential — For Internal Lab Use Only | Page X of Y"
- Author metadata: "Perplexity Computer"

## Regulatory Language (PDF narratives — VeritaCheck)
- Bold the regulatory determination: "The results for [Test] meet/do not meet the CLIA minimum total allowable error criteria per 42 CFR §493.XXX."
- PASS and FAIL use identical sentence structure — only "meet" vs "do not meet" differs
- Never tell the director what to do on a FAIL — no "do not report patient results" language
- Always end narrative with: "Final approval and clinical determination must be made by the laboratory director or designee."
- ONE signature block on all PDFs: "LABORATORY DIRECTOR OR DESIGNEE REVIEW" with Accepted/Not accepted checkboxes + Print Name/Initials/Date
- NO separate "Accepted by" block — it is redundant. Remove it everywhere.
- Header must say "LABORATORY DIRECTOR OR DESIGNEE REVIEW" — never just "LABORATORY DIRECTOR REVIEW"
- CFR by specialty: Chemistry=§493.931, Hematology=§493.927, Immunohematology=§493.959, Microbiology=§493.945, default=§493.931
- Cite ADLM-recommended internal goal alongside CLIA TEa where applicable

## VeritaCheck Labels
- "Calibration Verification / Linearity" — never "Cal Ver" or "Linearity" alone
- "Correlation / Method Comparison" — never "Method Comparison" alone
- ADLM goal cited alongside CLIA TEa in narratives

## VeritaMap Rules
- Critical values: "Critical Low (Mayo Clinic Laboratories)" and "Critical High (Mayo Clinic Laboratories)"
- Reference ranges: BLANK — lab enters their own verified values per CLIA 493.1253. Never pre-populate.
- AMR: BLANK — same reason
- Freeze pane at C2 specifically (columns A=Analyte and B=Instruments always visible)

## Competency Rules (VeritaComp)
- Timeline: Initial → 6-month → 1st Annual (6 months after 6-month) → Annual thereafter
- Element 1 and 4: Observer initials field (not evaluator) — observer must be LD, TC, or TS
- Element 3: Date the TECH RAN QC — not date reviewed
- Evaluator signs completed document — can be same person as observer, both fields required
- Technical competency = any test producing a reportable result, including manual methods (Gram Stain, Manual Diff, Urine Micro)
- Evaluator title by complexity: Moderate=Technical Consultant, High=Technical Supervisor, Waived=General Supervisor
- Competency assessment type dropdown: Laboratory Director, Technical Consultant (Moderate), Technical Supervisor (High), General Supervisor (Waived/PPM)

## Excel Standard (ALL exports)
- ExcelJS only — NEVER SheetJS (it silently drops styles)
- Import pattern: const { default: ExcelJS } = await import('exceljs')
- Teal #01696F headers, white bold Calibri 11pt, row height 20
- Freeze pane: B2 minimum (C2 for VeritaMap)
- Auto-filter on all columns
- Alternating rows: odd=white #FFFFFF, even=light blue #EBF3F8
- Borders: thin #D0D0D0 all cells
- Font: Calibri, data rows size 10, dark #28251D, wrap text, vertical middle
- Status colors: Pass/Compliant/Active=bold green #437A22, Fail/Overdue/Expired=bold red #A12C7B, Due Soon/Pending=bold amber #964219, N/A/Not Required=muted gray #7A7974
- Null values: show blank cell — never "null" or "undefined"

## Process Rules
- **TEMPLATE-FIRST RULE**: The filled-in Mandatory Response Template (TASK/ASSUMPTIONS/CLARIFYING QUESTION/PLAN/SELF-CHECK) must be presented to the user and approved BEFORE any file is modified. No exceptions. The commit-msg hook enforces TASK/PLAN/Self-check in every commit message. This rule was added after three failed deploys on 2026-04-14 caused by skipping the template on a "simple" bug fix.
- Large tasks: present build breakdown first, get approval, THEN build
- Multi-step safeguard plans: present the full plan, get explicit user confirmation ("yes", "build it", "go ahead"), THEN build. Never self-approve.
- Show mock PDF BEFORE building any PDF-generating feature
- Never bundle more than 2-3 focused changes in one commit
- Run full audit after every significant build before reporting complete
- **NEW DB TABLE RULE**: Every new CREATE TABLE must be accompanied in the SAME commit by ALTER TABLE migration blocks (using PRAGMA table_info pattern). No exceptions. Tables created without migrations will have missing columns on the live server.
- **DEBUGGING RULE**: When a fix doesn't work after one deploy, test the live API directly before telling the user to wait. Never tell the user to wait more than once without running a live API test to confirm the actual state.
- Reference /home/user/workspace/STANDING_REQUIREMENTS.md at start of every build objective
- Plan gate on every new module: use EXPLICIT ALLOWLIST (see VeritaLabAppPage.tsx). NEVER use a blocklist (!["free","per_study"].includes). Audit script enforces this.
- NEVER delete demo data (studies, scans, maps, trackers) without explicitly confirming with the user. Same test name does NOT mean duplicate -- always check study_type, date, and instrument before assuming.
- Before any DELETE on demo data: read both records in full, explain the difference to the user, get approval.

## Reasoning Standards (apply to EVERY task, not just large ones)
1. RESTATE: Begin by restating the task in your own words to confirm understanding.
2. ASSUMPTIONS: Identify assumptions and missing information. If something critical is missing, ask ONE clarifying question before proceeding -- do not guess.
3. PLAN: Outline a step-by-step plan before executing.
4. EXECUTE: Show intermediate reasoning as you work through each step.
5. SELF-CHECK: Before reporting complete, list at least 3 potential errors, gaps, or edge cases. Revise if any are real.
6. SEPARATE: Clearly distinguish reasoning from the final answer/result.
7. UNCERTAINTY: If unsure or lacking information, say so explicitly. Never fabricate an answer -- not pricing, not org names, not regulatory citations, not statistics.

## Pricing (Live in Stripe)
- Per Study: $25 (price_1TGXPo5dn6rqLgIxsnvNa2oi)
- VeritaCheck Unlimited: $299/yr, single user (price_1TGXPn5dn6rqLgIxfyoLXVKo)
- Clinic/Waived: $499/yr (price_1TGXPl5dn6rqLgIx14yANdxj)
- Community: $999/yr (price_1TKiEg5dn6rqLgIxrBKvqbGb) -- was $799, grandfathered
- Hospital: $1,999/yr (price_1TKiEg5dn6rqLgIxXioYyC5u) -- was $1,299, grandfathered
- Enterprise/Large Hospital: $2,999/yr (price_1TKiEg5dn6rqLgIxZ9ktBavQ) -- was $1,999, grandfathered
- Grandfathered prices (existing subs only): Community $799 (price_1TGXPm5dn6rqLgIxHdfFVNfA) | Hospital $1,299 (price_1TGXPm5dn6rqLgIxC5UCBXLn) | Enterprise $1,999 (price_1TGXPm5dn6rqLgIxzahbIaQV)
- Seat bands: 2-5=$199, 6-10=$179, 11-25=$159, 26+=$139
- CLIA tier auto-assigned from specialty count — no self-reporting

## Legal / Compliance
- HIPAA acknowledgment required at signup — timestamped in database
- VeritaAssure is a statistical calculation tool — results require medical director or designee interpretation
- No clinical verdict language — software states regulatory result, director decides action
- No PHI ever in any field
- Stripe keys from environment variables only — never hardcode
- USPTO filed: VeritaCheck 99730975, VeritaMap 99730987, VeritaScan 99730993, VeritaAssure 99731002
- VeritaComp trademark NOT yet filed (pending revenue)

## Credentials
- Michael Veri, MS, MBA, MLS(ASCP), CPHQ
- Title: Laboratory Operations Consultant | Owner, Veritas Lab Services, LLC
- Email: VeriLabGuy@gmail.com / info@veritaslabservices.com
- Company: Veritas Lab Services, LLC, Massachusetts, filed 1/2/2026

## Infrastructure
- Railway token: [REDACTED]
- Service ID: 170f5560-8cf0-4341-9c87-294062ebedd1
- Environment ID: cd669f7c-23f3-434c-895d-ca40ac504e91
- GitHub: https://github.com/mav40121/veritas-lab-services
- GitHub token: ghp_REDACTED_SEE_RAILWAY_ENV
- Resend: [REDACTED]
- Live site: https://www.veritaslabservices.com
- Admin endpoint: POST /api/admin/set-plan {"secret":"[REDACTED]","userId":N,"plan":"lab"}
- Stripe live key in Railway env as STRIPE_SECRET_KEY
- GA4 Measurement ID: G-M3TB43ZX4E | Property ID: 503314560
- Chase Stripe payout account: ••••5726
