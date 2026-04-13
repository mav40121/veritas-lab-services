# VeritaAssure — Session Handoff Summary
**Generated:** April 1, 2026 at 7:19 AM MST  
**Purpose:** Paste this as the first message in a new Perplexity Computer conversation to resume work seamlessly.

---

## CRITICAL: Read This First

Before doing ANY build work, read the standing requirements file in full:

```
/home/user/workspace/STANDING_REQUIREMENTS.md
```

This file is the canonical source of all copy rules, PDF requirements, regulatory language standards, Excel standards, pricing, credentials, and infrastructure. It must be loaded at the start of every coding task. No exceptions.

---

## 1. User Identity

- **Name:** Michael Veri, MS, MBA, MLS(ASCP), CPHQ
- **Title:** Laboratory Operations Consultant | Owner, Veritas Lab Services, LLC
- **Email:** VeriLabGuy@gmail.com / info@veritaslabservices.com
- **Timezone:** America/Phoenix (MST, no daylight saving)
- **Company:** Veritas Lab Services, LLC, Massachusetts, filed 1/2/2026
- **Location:** Upton, MA (sole employee)

### Non-Negotiable Rules for All Responses and Code

- NO em dashes (--) anywhere. Use commas, colons, or hyphens.
- All product names use (TM) not (R): VeritaAssure(TM), VeritaCheck(TM), VeritaMap(TM), VeritaScan(TM), VeritaComp(TM), VeritaStaff(TM), VeritaLab(TM)
- NO reference to "EP Evaluator" by name. Use "other evaluation tools" if needed.
- NO CAMLAB references. Use "TJC standard."
- NO LabVine Learning references.
- Governing law = Massachusetts in all legal text.
- PDF signatures MUST appear on PAGE 1. Always. No exceptions.
- "Medical director or designee" everywhere. Never just "medical director" or "laboratory director" alone.
- CLIA number on every report header. Show "CLIA: Not on file -- enter in account settings" if missing.
- Never tell the director what to do on a FAIL. No "do not report patient results" language.
- Always end VeritaCheck narratives with: "Final approval and clinical determination must be made by the laboratory director or designee."
- VeritaCheck study labels: "Calibration Verification / Linearity" (never "Cal Ver" alone), "Correlation / Method Comparison" (never "Method Comparison" alone).
- ExcelJS only for all exports. NEVER SheetJS.
- Large tasks: present build breakdown first, get approval, then build.
- Show mock PDF before building any PDF-generating feature.
- Never bundle more than 2-3 focused changes in one commit.
- Run full audit after every significant build before reporting complete.

---

## 2. Business Context

### Company
- **Legal Name:** Veritas Lab Services, LLC
- **State:** Massachusetts
- **Filed:** January 2, 2026
- **Website:** https://www.veritaslabservices.com
- **Contact:** info@veritaslabservices.com

### Platform
- **Brand:** VeritaAssure(TM)
- **Description:** A SaaS compliance and method validation platform for clinical laboratories. Provides EP study analysis, test menu regulatory mapping, inspection readiness checklists, competency management, personnel management, and certificate tracking.
- **Target users:** Lab directors, technical consultants, compliance officers at hospital labs, reference labs, and physician office labs (POLs).
- **Positioning:** Browser-based, no desktop software required. Competes against EP Evaluator (do not name), StaffReady, mylabcompliance.io, MediaLab.
- **Disclaimer language:** VeritaAssure is a statistical calculation tool. Results require interpretation by a licensed medical director or designee. Not medical advice. No PHI in any field.

---

## 3. External Credentials

| Service | Value |
|---|---|
| Live site | https://www.veritaslabservices.com |
| GitHub repo | https://github.com/mav40121/veritas-lab-services |
| GitHub token | ghp_REDACTED_SEE_RAILWAY_ENV |
| Railway token | RAILWAY_TOKEN_REDACTED |
| Railway Service ID | 170f5560-8cf0-4341-9c87-294062ebedd1 |
| Railway Environment ID | cd669f7c-23f3-434c-895d-ca40ac504e91 |
| Resend API key | re_REDACTED_SEE_RAILWAY_ENV |
| GA4 Measurement ID | G-M3TB43ZX4E |
| GA4 Property ID | 503314560 |
| Chase Stripe payout account | last four 5726 |
| Admin secret | veritas-admin-2026 |

### Stripe (Live Keys)
- Stripe live key is stored in Railway environment as `STRIPE_SECRET_KEY` (not hardcoded).
- Webhook secret is stored in Railway environment as `STRIPE_WEBHOOK_SECRET`.

---

## 4. Product Suite Status

### VeritaCheck(TM) - Method Validation Suite
- **Route:** /#/veritacheck (also /study/new)
- **Status:** LIVE (green badge in navbar)
- **What works:**
  - 7 study types: Calibration Verification / Linearity, Correlation / Method Comparison, Precision, Lot-to-Lot Reagent Verification, QC Range Establishment, Multi-Analyte Coag New Lot (PT/aPTT/Fibrinogen), PT/Coag New Lot Validation (unlocked as of March 31)
  - Variable data levels (3-40 per study)
  - Column-first Tab navigation in data grid
  - Deming regression + OLS with 95% CI, SEE, Bias column for Method Comparison
  - Instrument names pulled from user's VeritaMap for Method Comparison dropdown
  - Pass/fail computation on server side (not just client)
  - Server-side status recompute for all existing studies on startup
  - Per-study $25 checkout, VeritaCheck Unlimited $299/yr checkout
  - PDF reports via Puppeteer: signature on page 1, stats on page 2 if needed
  - CLIA number on every PDF header
  - "Detailed results continued on page 2" label when stats overflow
  - "Medical director or designee" throughout PDF
  - Bold regulatory determination sentence in narrative
  - Laboratory Director Review block (Accepted/Not accepted + signature) on all PDFs
  - Specialty-specific CFR citations: Chemistry=493.931, Hematology=493.927, etc.
  - ADLM goal cited alongside CLIA TEa
  - HIPAA acknowledgment timestamp on signup
  - PHI reminder banner in data entry
  - 2-year read-only data retention after subscription expiry
- **Study results page:** /#/study/:id/results

### VeritaMap(TM) - Test Menu Regulatory Mapping
- **Route:** /#/veritamap (landing), /#/veritamap-app (app), /#/veritamap-app/:id (view map), /#/veritamap-app/:id/build (build map)
- **Status:** LIVE (green badge in navbar)
- **What works:**
  - 3-step instrument selection: Department > Vendor > Instrument cascade
  - 189 instruments across Chemistry, Hematology, Coagulation, Urinalysis, Blood Gas, Blood Bank, POC, Microbiology, Molecular, Immunology/Protein, Endocrinology/Immunoassay, Toxicology/TDM, Respiratory Molecular, ESR, Fecal Testing, Histology/Pathology, Cytology, Manual/Kit Tests
  - "Other" write-in for custom instruments
  - Custom test entry for EUA/LDT support
  - Boolean bug fixed: `active` field now cast to 1/0 before SQLite binding (was causing 500 errors)
  - Critical values: "Critical Low (Mayo Clinic Laboratories)" and "Critical High (Mayo Clinic Laboratories)"
  - Reference ranges: blank (lab enters their own per CLIA 493.1253)
  - AMR: blank (same reason)
  - Excel export: ExcelJS, teal #01696F headers, freeze at C2, autofilter, alternating rows
  - Intelligence panel: shows upcoming verification requirements
  - Method comparison: VeritaMap instruments populate VeritaCheck instrument dropdown
  - Freemium limit: 4 instruments / 10 analytes per map for free users
- **Known issue documented:** See /home/user/workspace/veritamap_debug_report.md (SQLite boolean binding -- now FIXED in server/routes.ts)
- **Instrument redesign spec:** See /home/user/workspace/instrument_redesign_spec.md (already built)

### VeritaScan(TM) - Inspection Readiness Checklist
- **Route:** /#/veritascan (landing), /#/veritascan-app (list), /#/veritascan-app/:id (scan detail)
- **Status:** LIVE (green badge in navbar)
- **What works:**
  - Create/manage compliance scan checklists
  - Auto-complete checklist items
  - Excel export (ExcelJS standard)
  - PDF export: executive summary or full report
  - Access gated to Waived ($499/yr) and above

### VeritaLab(TM) - Certificate and Accreditation Tracking
- **Route:** /#/veritalab (landing), /#/veritalab-app (app)
- **Status:** LIVE, recently released (New badge in navbar)
- **What works:**
  - Certificate tracking: CLIA, CAP, TJC, COLA, state licenses, accreditations
  - Document archive: upload PDFs/files per certificate (20MB max)
  - Renewal reminders: email alerts at 90, 60, 30 days before expiration (via Resend)
  - CLIA certificate auto-populated from CLIA confirmation step at signup
  - Excel export of all certificates
  - Access gated to Waived ($499/yr) and above

### VeritaComp(TM) - Competency Assessment Management
- **Route:** /#/veritacomp (landing), /#/veritacomp-app (list), /#/veritacomp-app/:programId (program detail)
- **Status:** IN PROGRESS (amber badge in navbar)
- **What works (Phase 1 complete):**
  - Three competency types: Technical (HR.01.06.01 EP 18), Waived (WT.03.01.01), Non-Technical (HR.01.06.01 EP 5/6)
  - Assessment form with all 6 CLIA elements
  - Per-element dates and observer initials
  - Evaluator title by complexity: Moderate=Technical Consultant, High=Technical Supervisor, Waived=General Supervisor
  - Quiz engine with addendum on PDF
  - PDF generation: signature on page 1, summary table at top, compact layout
  - Competency timeline: Initial, 6-month, 1st Annual (6 months after 6-month), Annual thereafter
  - Element 1 and 4: Observer initials field (not evaluator)
  - Element 3: Date the tech ran QC (not date reviewed)
  - TC vs TS complexity guidance on form and PDF
  - WIP banner on landing and app pages
  - Access gated to Waived ($499/yr) and above
- **In progress / Phase 2:** Expanded question banks (coming soon)

### VeritaStaff(TM) - Personnel and Credentialing Management
- **Route:** /#/veritastaff (landing), /#/veritastaff-app (list), /#/veritastaff-app/:employeeId (employee record)
- **Status:** IN PROGRESS (amber badge in navbar)
- **What works:**
  - Employee roster with CLIA role assignments (LD, CC, TC, TS, GS, TP, CT, CT_GS)
  - Specialty assignments for TC and TS roles (17 CMS specialties)
  - Lab setup: CLIA number, certificate type, accreditation body
  - Competency timeline engine (Initial, 6-month, annual)
  - CMS 209 Laboratory Personnel Report auto-generation
  - NYS additional requirements support
  - WIP banner on landing and app pages
  - Access gated to Waived ($499/yr) and above

### CUMSUM Tracker
- **Route:** /#/cumsum
- **Status:** LIVE (no separate badge -- integrated feature)
- **What works:**
  - Create CUMSUM trackers per instrument/analyte
  - Enter daily QC runs
  - Pass/fail verdict with geometric mean calculation
  - Excel and PDF export

### Demo
- **Route:** /#/demo (public, no auth required)
- **Demo account:** demo@veritaslabservices.com / VeritaDemo2026!
- **Demo lab:** Riverside Regional Medical Center, CLIA 22D0999999
- **Status:** Fully public, no auth walls, all 5 modules shown, real PDFs generated

### Public Pages
- /#/ -- Homepage (why-first messaging, hero, pull quote, bridge copy)
- /#/services -- Services and pricing
- /#/team -- About Michael Veri
- /#/dashboard -- Authenticated user study dashboard
- /#/contact -- Contact form
- /#/login -- Login / Register
- /#/resources -- Clinical lab knowledge base (3 articles + TEa lookup)
- /#/study-guide -- "Which study do I need?" guide
- /#/book -- Lab Management 101 book (Coming Soon badge)
- /#/roadmap -- Product roadmap (completed, in progress, coming soon)
- /#/getting-started -- New user onboarding guide (7-step flow)
- /#/account/settings -- Account settings (CLIA number, lab name, etc.)
- /#/account/seats -- Seat management for multi-user plans
- /#/terms -- Terms of Service (Massachusetts governing law)
- /#/privacy -- Privacy Policy
- /#/reset-password -- Password reset

---

## 5. Pricing Model (Live in Stripe)

### Base Plans

| Tier | Who | Price | Stripe Price ID |
|---|---|---|---|
| Per Study | One-time, single user | $25 | price_1TGXPo5dn6rqLgIxsnvNa2oi |
| VeritaCheck(TM) Unlimited | Single user, VC only, CLIA required | $299/yr | price_1TGXPn5dn6rqLgIxfyoLXVKo |
| Waived | Certificate of Waiver labs | $499/yr | price_1TGXPl5dn6rqLgIx14yANdxj |
| Community | 1-8 specialties | $799/yr | price_1TGXPm5dn6rqLgIxHdfFVNfA |
| Hospital | 9-15 specialties | $1,299/yr | price_1TGXPm5dn6rqLgIxC5UCBXLn |
| Large Hospital | 16+ specialties | $1,999/yr | price_1TGXPm5dn6rqLgIxzahbIaQV |

### Per-Seat Add-On Pricing

| Band | Price/Seat/Year | Stripe Price ID |
|---|---|---|
| Seats 2-5 | $199/seat | price_1TGXPn5dn6rqLgIxdrreE5X4 |
| Seats 6-10 | $179/seat | price_1TGXPn5dn6rqLgIxEhLz7fmK |
| Seats 11-25 | $159/seat | price_1TGXPn5dn6rqLgIxtsRXHf80 |
| Seats 26+ | $139/seat | price_1TGXPo5dn6rqLgIxo3Fj2Llr |

### Rules
- CLIA tier auto-assigned from specialty count -- no self-reporting.
- Certificate of Waiver always routes to Waived tier regardless of specialty count.
- CLIA lookup step required before checkout.
- CLIA required for VeritaCheck Unlimited tier (no bypass).
- Seat 1 is included in base plan. Add-ons start at seat 2.
- Canonical price source: server/stripe.ts (PRICES, SEAT_PRICES, PLAN_LIMITS, SEAT_PRICING).

### Plan Access Matrix (which plans unlock which modules)

| Module | Plans That Include It |
|---|---|
| VeritaCheck (unlimited studies) | waived, community, hospital, large_hospital, veritacheck_only |
| VeritaMap | waived, community, hospital, large_hospital |
| VeritaScan | waived, community, hospital, large_hospital |
| VeritaComp | waived, community, hospital, large_hospital |
| VeritaStaff | waived, community, hospital, large_hospital |
| VeritaLab | waived, community, hospital, large_hospital |

---

## 6. Infrastructure

### Hosting
- **Platform:** Railway (Nixpacks builder)
- **Node version:** 20
- **Start command:** `node dist/index.cjs`
- **Build command:** `npm run build`
- **Health check:** GET /api/health
- **Restart policy:** ON_FAILURE, max 3 retries
- **Database:** SQLite via better-sqlite3, persisted at /data/veritas.db (Railway persistent volume -- survives redeploys)

### Deploy Commands
```bash
# Push to Railway via GitHub (auto-deploy on push to main)
git push origin main

# Or direct Railway CLI deploy
railway up
```

### Admin Endpoints
```bash
# Set a user's plan
POST /api/admin/set-plan
Body: {"secret":"veritas-admin-2026","userId":N,"plan":"lab"}
# Valid plans: waived, community, hospital, large_hospital, veritacheck_only, per_study, free

# List all users
POST /api/admin/users
Body: {"secret":"veritas-admin-2026"}

# View newsletter subscribers
GET /api/admin/newsletter?secret=veritas-admin-2026

# Manage discount codes
GET /api/admin/discount-codes?secret=veritas-admin-2026
POST /api/admin/discount-codes
PATCH /api/admin/discount-codes/:id
```

### Test / Demo Accounts
- **Demo account:** demo@veritaslabservices.com / VeritaDemo2026!
  - Plan: lab (full access)
  - CLIA: 22D0999999
  - Lab: Riverside Regional Medical Center
  - Pre-seeded with 3 EP studies, full VeritaMap, VeritaScan scan, competency program, staff roster

### Environment Variables (set in Railway)
- STRIPE_SECRET_KEY -- Stripe live secret key
- STRIPE_WEBHOOK_SECRET -- Stripe webhook signing secret
- RESEND_API_KEY -- re_REDACTED_SEE_RAILWAY_ENV
- ADMIN_SECRET -- veritas-admin-2026
- JWT_SECRET -- veritas-lab-services-secret-2026
- FRONTEND_URL -- https://www.veritaslabservices.com

### Key Technical Notes
- SPA with hash router (wouter with useHashLocation). All routes are /#/route format.
- GA4 fires page_view on every hash route change.
- All Stripe keys from environment variables only -- never hardcoded.
- ExcelJS dynamic import pattern: `const { default: ExcelJS } = await import('exceljs')`
- PDF generation: Puppeteer (server-side), generates fresh HTML each time (no caching).
- Author metadata in PDFs: "Perplexity Computer"
- Footer on every PDF page: "VeritaAssure(TM) | [Module](TM) | Confidential -- For Internal Lab Use Only | Page X of Y"

---

## 7. USPTO Trademarks Filed

| Mark | Serial Number | Status |
|---|---|---|
| VeritaCheck | 99730975 | Filed |
| VeritaMap | 99730987 | Filed |
| VeritaScan | 99730993 | Filed |
| VeritaAssure | 99731002 | Filed |
| VeritaComp | NOT YET FILED | Pending revenue |

---

## 8. Session Work Completed (March 30-31, 2026)

### March 30, 2026

**Infrastructure and Pricing**
- Removed all Stripe keys from source code -- moved to Railway environment variables only
- Implemented new CLIA-tier based pricing (replaced old Starter/Professional/Lab/Complete tiers)
- Built CLIA lookup step before Stripe checkout (CMS CLIA registry lookup)
- CLIA required for VeritaCheck Unlimited tier -- no bypass path
- CLIA number auto-assigned at signup, tier auto-determined from specialty count
- Per-seat add-on pricing: 4 bands ($199/$179/$159/$139 per seat/yr)
- Named seats and session limiting
- Coupon code redemption system

**VeritaCheck**
- Method Comparison redesign: instrument dropdown pulls from user's VeritaMap, removed Reference column, primary vs backup statistics, correct labels throughout
- Renamed "VeritaCheck Only" to "VeritaCheck Unlimited"

**VeritaMap**
- Extracted Electrolytes as dedicated specialty from General Chemistry
- Alphabetical test sorting
- Added GEM Premier 4000 and 5000 blood gas analyzers
- Expanded instrument database to 189 instruments with vendor field
- Redesigned instrument selection to 3-step department/vendor/instrument cascade
- Added Manual Procedures department (manual differential, gram stain, urine microscopy, 20+ procedures)
- Added Other/Custom write-in for instruments and custom test entry
- XLSX export: Mayo critical values, reference ranges blank (CLIA 493.1253), AMR blank, compliance status
- Excel freeze at C2 (Analyte=A, Instruments=B always visible)
- Teal headers, autofilter, alternating rows (ExcelJS)
- Fixed critical value labels to "Critical Low (Mayo Clinic Laboratories)" throughout
- Removed pre-populated reference ranges and AMR

**VeritaScan**
- Fixed executive report PDF corruption

**VeritaComp (Phase 1)**
- Full build: technical, waived, and non-technical competency types
- Renamed VeritaCompetency to VeritaComp throughout
- CAP competency requirements added to landing page
- Quiz engine with addendum PDF
- Specimen data, per-item dates/initials on assessments and PDFs
- TC vs TS complexity guidance on form and PDF
- WIP banners on landing and app pages
- Fixed app page crash (readOnly variable out of scope)
- Fixed programs endpoint, staff employee DELETE
- Standardized Excel formatting

**VeritaStaff**
- Full build: employee roster, CLIA role assignments, CMS 209 autogeneration, competency timeline engine
- 17 CMS specialty assignments for TC/TS roles
- Lab setup: CLIA, certificate type, accreditation body (TJC, CAP, COLA, CLIA_ONLY, NYS, OTHER)
- NYS additional requirements support

**VeritaLab**
- Full build: certificate tracking, document archive, renewal reminders
- Auto-populate CLIA certificate from CLIA confirmation at signup

**Demo Page**
- Fully public live demo (no auth walls)
- VeritaCheck first with working PDF generation
- All 5 modules accessible in demo
- Tabbed demo with per-tab narratives

**Compliance / Copy**
- Removed all CAMLAB references, replaced with "TJC standard"
- Replaced all em-dashes with commas, colons, or hyphens
- Removed all EP Evaluator references

**SEO / Marketing**
- Added training angle on homepage and book page
- Published "How VeritaAssure Trains Lab Leaders" article
- GA4 real measurement ID (G-M3TB43ZX4E) added
- GA4 SPA tracking: page_view fires on every hash route change
- Fixed canonical tags, www redirect, sitemap URLs for Google Search Console
- 2-year read-only data retention after subscription expiry
- Hover tooltips on all pricing feature items
- Team page updated with VeritaAssure launch context
- Homepage mobile layout: software products visible above fold

**Roadmap Page**
- Built product roadmap page (/#/roadmap): completed, in progress, coming soon sections
- Added reference range verification workflow to roadmap

### March 31, 2026

**Pre-Demo QA Sprint**
- Full overnight QA audit: all pre-demo issues resolved
- Demo rebuild: real study data, working PDFs, full statistics
- Defensive array guards in PDF generation (prevent map of undefined)
- Fixed VeritaMap Excel export ExcelJS dynamic import (.default required)
- Full Excel formatting standard applied across all exports (teal headers, freeze, autofilter, alternating rows)
- Demo competency backfill: specimen IDs and dates on all elements
- Competency summary table moved to top of PDF and web view
- Competency PDF: compact layout, all element data present, final evaluator sign-off
- Added "Generate CMS 209" button to demo VeritaStaff tab
- Fixed study dashboard pass/fail: server-side verification and status recompute on startup
- Fixed book page pricing: equal card weight, no $499 confusion
- Critical demo fixes: navbar account, pricing text, services copy, stat count
- Navbar polish: roadmap consolidation, badges, services chevron, book page copy

**PDF Standards (Standing Requirements Enforcement)**
- VeritaCheck PDF: CLIA number on header -- demo uses 22D0999999, "not on file" message for others
- PDF always generated fresh (no cached HTML)
- Disclaimer and CFR link correct (links to 493.931)
- Fine print uses "medical director or designee"
- CLIA TEa line: 42 CFR links to correct specialty section

**"Why-First" Homepage Messaging**
- Rewrote homepage hero with why-first messaging
- Added pull quote (dark text on light background fix)
- Bridge copy and services opening rewritten
- Bio section updated

**Getting Started Onboarding**
- Built /#/getting-started page (7-step onboarding flow)
- First-login banner on dashboard for new users
- Progress tracking (steps completed/remaining)

**VeritaLab CLIA Integration**
- Auto-populate VeritaLab CLIA certificate from CLIA confirmation step
- Updated Step 7 copy in Getting Started

**HIPAA Compliance**
- HIPAA acknowledgment at signup (timestamped in database)
- PHI reminder banner in VeritaCheck data entry

**PDF Standards (Final Batch)**
- Signature ALWAYS on page 1 (major rework of pdfReport.ts)
- Statistics tables on page 2+ when they overflow
- "Detailed results continued on page 2" label
- Bold regulatory determination line in narratives
- Director review language on all PDFs
- Removed directive fail language ("do not report patient results")
- PT/Coag New Lot Validation unlocked (previously gated as Coming Soon)

**Pull Quote Fix**
- Fixed text contrast: dark text on light background (was unreadable)

**VeritaComp and VeritaStaff marked "In Progress" in navbar**
- Both modules show amber "In Progress" badge

**Demo Narrative Fix**
- Method comparisons also required every 6 months (fixed narrative text)
- Added creatinine Calibration Verification / Linearity study to demo (3 EP studies total)

---

## 9. Open Items / Roadmap

### In Progress (Started, Not Complete)
- VeritaComp Phase 2: Expanded question banks (more analyte-specific questions per department)
- VeritaStaff: further polish and edge case handling (CMS 209 edge cases, multi-lab support)

### Coming Soon (Designed, Not Built)
- VeritaComp(TM) Expanded Question Banks (Phase 2)
- VeritaPT(TM) -- Proficiency Testing Tracker (track PT results, flag failures, document corrective action)
- VeritaLab(TM) -- Director and Staff Credential Tracking (add personal credentials to VeritaLab, not just lab certs)
- VeritaCheck(TM) -- Reference Range Verification Workflow (CLIA 493.1253 compliant)
- Mobile-optimized views (currently desktop-first)
- Enterprise API Access

### Known Issues / Technical Debt
- VeritaMap Build page: the instrument redesign spec at /home/user/workspace/instrument_redesign_spec.md describes the 3-step cascade already built. Future work may involve expanding the instrument database beyond 189 instruments.
- VeritaMap debug report at /home/user/workspace/veritamap_debug_report.md documents the SQLite boolean binding bug. This has been FIXED (active boolean cast to 1/0 in server/routes.ts). No action needed.
- Book page (/#/book): "Lab Management 101" is Coming Soon. Book is not yet published/for sale.

### SEO / Marketing (Researched, Not Yet Built)
- SEO content gap analysis at /home/user/workspace/seo_content_gap_analysis.md identifies 8-12 target keywords for organic traffic
- No organic traffic yet beyond brand queries
- Additional articles planned around: CLIA competency assessment template, calibration verification linearity study, method comparison study how-to, QC range establishment, lot-to-lot reagent verification

---

## 10. Key Files in Workspace

| File / Directory | Description |
|---|---|
| /home/user/workspace/STANDING_REQUIREMENTS.md | CANONICAL SOURCE -- all rules, pricing, credentials, standards. Read first. |
| /home/user/workspace/SESSION_HANDOFF.md | This file. |
| /home/user/workspace/veritas-lab-services-1bd90c05/ | Main application repo (most recent checkout) |
| /home/user/workspace/veritas-lab-services-1bd90c05/server/routes.ts | All API routes (241 KB, comprehensive) |
| /home/user/workspace/veritas-lab-services-1bd90c05/server/pdfReport.ts | All PDF generation logic (143 KB) |
| /home/user/workspace/veritas-lab-services-1bd90c05/server/stripe.ts | Stripe config, all price IDs, PLAN_LIMITS |
| /home/user/workspace/veritas-lab-services-1bd90c05/server/seedDemo.ts | Demo account seed data |
| /home/user/workspace/veritas-lab-services-1bd90c05/server/db.ts | SQLite schema and migrations (25 KB) |
| /home/user/workspace/veritas-lab-services-1bd90c05/client/src/App.tsx | All client-side routes |
| /home/user/workspace/price_locations.md | Price audit: all Stripe price IDs and where they appear in code |
| /home/user/workspace/instrument_redesign_spec.md | VeritaMap 3-step instrument selection spec (already built) |
| /home/user/workspace/veritamap_debug_report.md | VeritaMap SQLite boolean bug (FIXED) |
| /home/user/workspace/veritacompetency_spec.md | VeritaComp full build specification |
| /home/user/workspace/veritastaff_spec.md | VeritaStaff full build specification |
| /home/user/workspace/veritamap_excel_spec.md | VeritaMap Excel export specification |
| /home/user/workspace/seo_content_gap_analysis.md | SEO keyword research and content gap analysis |
| /home/user/workspace/veritas.db | Local SQLite DB copy (not production) |
| /home/user/workspace/veritas-site-dns-guide.md | GoDaddy DNS migration guide |
| /home/user/workspace/coding_session_adec7a49.jsonl | Full coding session log (large) |

---

## 11. Database Schema Summary

Key tables in SQLite at /data/veritas.db (Railway):

- **users** -- id, email, password_hash, name, plan, study_credits, subscription_status, subscription_expires_at, clia_number, clia_lab_name, clia_tier, seat_count, has_completed_onboarding, onboarding_seen, hipaa_acknowledged, hipaa_acknowledged_at, created_at
- **studies** -- id, userId, testName, instruments (JSON), date, studyType, cliaAllowableError, dataPoints (JSON), status (pass/fail), created_at
- **veritamap_maps** -- id, user_id, name, instruments (JSON), created_at, updated_at
- **veritamap_tests** -- per analyte per map (aggregated from instrument tests)
- **veritamap_instruments** -- id, map_id, user_id, instrument_name, role, category, created_at
- **veritamap_instrument_tests** -- id, instrument_id, map_id, analyte, specialty, complexity, active (0/1), last_cal_ver, last_method_comp, last_precision, last_sop_review, notes
- **veritascan_scans** -- id, user_id, name, created_at, updated_at
- **veritascan_items** -- id, scan_id, section, item, status, notes, created_at
- **competency_programs** -- id, user_id, name, department, type (technical/waived/nontechnical), map_id, created_at, updated_at
- **competency_employees** -- id, user_id, name, title, hire_REDACTED_SEE_RAILWAY_ENV, lis_initials, status
- **competency_assessments** -- id, program_id, employee_id, assessment_type, assessment_date, evaluator_name, evaluator_title, status, etc.
- **competency_quizzes** -- id, user_id, program_id, method_group_id, questions (JSON)
- **staff_labs** -- id, user_id, lab_name, clia_number, certificate_type, accreditation_body, complexity, etc.
- **staff_employees** -- id, lab_id, user_id, last_name, first_name, title, hire_REDACTED_SEE_RAILWAY_ENV, performs_testing, status
- **staff_roles** -- id, employee_id, lab_id, role, specialty_number
- **lab_certificates** -- id, user_id, cert_type, cert_name, cert_number, issuing_body, issued_date, expiration_date, lab_director, is_auto_populated
- **lab_certificate_documents** -- id, certificate_id, user_id, file_name, file_data, file_size, mime_type
- **lab_certificate_reminders** -- id, certificate_id, user_id, reminder_date, reminder_type, sent
- **user_seats** -- id, owner_id, seat_email, seat_name, active, last_login_at
- **newsletter_subscribers** -- id, email, name, source, created_at
- **discount_codes** -- id, code, partner_name, discount_pct, applies_to, max_uses, use_count, active
- **cumsum_trackers** -- id, user_id, instrument_name, analyte, created_at
- **cumsum_entries** -- id, tracker_id, user_id, run_date, value, cumsum_value, verdict

---

## 12. Standing Requirements Reference

The file `/home/user/workspace/STANDING_REQUIREMENTS.md` contains every non-negotiable rule and must be read at the start of every build. Key sections:

1. **Copy Rules** -- no em dashes, TM not R, no EP Evaluator, no CAMLAB, no LabVine, Massachusetts law
2. **PDF Requirements** -- signature page 1, stats page 2+, medical director or designee, CLIA on header, footer format, author metadata
3. **Regulatory Language** -- bold determination sentence, PASS/FAIL sentence structure, no directive fail language, director review block, CFR by specialty, ADLM goal
4. **VeritaCheck Labels** -- Cal Ver / Linearity, Correlation / Method Comparison
5. **VeritaMap Rules** -- Mayo Clinic Laboratories attribution, blank reference ranges, blank AMR, freeze at C2
6. **Competency Rules** -- timeline sequence, observer vs evaluator, element 3 date, evaluator title by complexity
7. **Excel Standard** -- ExcelJS only, teal #01696F headers, freeze B2 minimum (C2 for VeritaMap), autofilter, alternating rows, status colors, Calibri 11pt headers/10pt data
8. **Process Rules** -- build breakdown before building, mock PDF before PDF features, 2-3 changes per commit, full audit before reporting complete
9. **Pricing** -- all live Stripe price IDs
10. **Legal / Compliance** -- HIPAA, no clinical verdict language, no PHI, Stripe from env vars, USPTO serials
11. **Credentials** -- Michael Veri credentials and company
12. **Infrastructure** -- Railway token, service ID, environment ID, GitHub, Resend, live site, admin endpoint, GA4, Chase

---

*End of session handoff through March 31 morning. Continued below.*

---

## 13. Session Work Completed (March 31 Morning -- April 1, 2026)

### March 31, 2026 (Morning -- Pre-Demo Audit Sprint)

**Bug Fixes (7 total)**
- PT/Coag New Lot Validation was still gated as Coming Soon on StudyResultsPage -- unlocked
- "laboratory director or supervisor" replaced with "laboratory director or designee" in multiple locations
- "Cal Ver" abbreviation removed from all user-facing text -- replaced with full label "Calibration Verification / Linearity"
- Additional minor pre-demo bugs resolved in the same audit pass

**PDF Standards (Final Enforcement)**
- Director review block added to ALL VeritaCheck PDFs: heading reads "LABORATORY DIRECTOR OR DESIGNEE REVIEW" with Accepted / Not accepted checkboxes and signature line
- Bold regulatory determination sentence enforced on all PDFs
- Signature always on page 1 -- statistics tables moved to page 2 with "Detailed results continued on page 2" label

**HIPAA Compliance**
- HIPAA acknowledgment checkbox added to signup flow -- timestamp stored in database (hipaa_acknowledged_at column)
- Registration is blocked if checkbox is unchecked
- PHI reminder amber banner added to VeritaCheck data entry screen

**UI Fixes**
- Pull quote text color hardcoded to #1B4B4E (was using Tailwind theme class that failed to resolve -- unreadable)

**VeritaLab**
- CLIA number auto-populated from CLIA confirmation step at signup

**Onboarding**
- Getting Started page built (/#/getting-started): 7 step cards with progress tracking
- First-login banner built (OnboardingBanner.tsx) shown on dashboard after new account creation
- Account Settings page built (/#/account/settings)
- Step 7 updated: "Confirm your CLIA certificate expiration date"

**VeritaMap**
- Serial number optional field added to instruments: form, map view, Excel export, and database all updated

**Business**
- Huron demo call cancelled -- reschedule pending. Email to Ann Marie Roman drafted.

---

### Trademark Scam -- March 31, 2026

- Received fraudulent email impersonating USPTO using VeritaAssure serial number 99731002
- Scammer used real attorney name Zachary Cromer but operated from fake domain: teas@usaoffice109.com
- Spoke to scammer by phone but provided NO personal or financial information
- **Actions taken:**
  - Filed FTC fraud report at ReportFraud.ftc.gov
  - Sent fraud alert email to Chase business account ending in 5726
  - Reported scam domain to USPTO at TMScams@uspto.gov

---

### April 1, 2026

**Competitive Intelligence**
- Perplexity analysis of EP Evaluator competitive landscape reviewed and analyzed
- EP Evaluator pricing confirmed: $865-$1,440/yr single user (VeritaCheck Unlimited is $299/yr)
- Four key competitive gaps identified (see Section 15 below)

**New Compliance Documents Created**
- `VeritaCheck_CLSI_Compliance_Matrix.pdf` -- one page, landscape orientation. Maps all 6 VeritaCheck study types to applicable CLSI, CLIA, CAP, and TJC standards. Saved to /home/user/workspace/.
- `VeritaCheck_Software_REDACTED_SEE_RAILWAY_ENV.pdf` -- 4 pages, fillable template. Provides labs with a structured workflow to validate VeritaCheck before using it for compliance documentation. Saved to /home/user/workspace/.
- Both documents are APPROVED for the Resources page and onboarding flow -- NOT YET BUILT into the site.

---

## 14. Open Items (Carry Forward)

| Item | Status | Notes |
|---|---|---|
| Add CLSI Compliance Matrix to Resources page and navbar | APPROVED, NOT BUILT | File exists at /home/user/workspace/VeritaCheck_CLSI_Compliance_Matrix.pdf |
| Add Software Validation Template to Resources page and navbar | APPROVED, NOT BUILT | File exists at /home/user/workspace/VeritaCheck_Software_REDACTED_SEE_RAILWAY_ENV.pdf |
| Wire Software Validation Template into onboarding flow (Getting Started + welcome email) | APPROVED, NOT BUILT | -- |
| Ann Marie Roman / Huron reschedule | PENDING | Email drafted, awaiting response |
| ASCLS LabJAM June 28 - July 2, St. Louis | DECISION NEEDED | Early bird $830, deadline April 28 |
| VeritaComp Phase 2: quiz engine expansion | IN PROGRESS | More analyte-specific question banks |
| VeritaStaff: CMS 209 edge cases, multi-lab polish | IN PROGRESS | -- |
| Pricing restructure (per-seat with CLIA tiers) | LIVE | VeritaComp/VeritaStaff still In Progress badges |
| SaMD legal opinion | DEFERRED | Frier Levitt or Mintz -- budget when revenue allows |
| CAP checklist mapping (competitive gap) | NOT STARTED | See Section 15 |

---

## 15. Competitive Intelligence -- EP Evaluator Gap Analysis

**EP Evaluator pricing:** $865-$1,440/yr (single user). VeritaCheck Unlimited: $299/yr.

| Gap | Status |
|---|---|
| Software validation package -- labs need to validate tools before compliance use | DONE -- template created April 1 |
| CLSI compliance matrix -- visual proof of regulatory alignment | DONE -- matrix created April 1 |
| CAP checklist mapping -- map VeritaCheck outputs to CAP checklist item numbers | NOT YET BUILT |
| Inspector-readiness -- reports must be defensible to a peer CAP inspector familiar with EP Evaluator format | ONGOING -- review with each PDF update |

**Positioning note:** VeritaCheck is 3-5x cheaper than EP Evaluator with all CLSI study types covered. Documentation gap is closing. CAP checklist mapping is the next priority for inspector-readiness positioning.

---

## 16. Key New Files in Workspace (Added March 31 -- April 1)

| File | Description |
|---|---|
| /home/user/workspace/VeritaCheck_CLSI_Compliance_Matrix.pdf | One-page landscape compliance matrix. Maps 6 study types to CLSI/CLIA/CAP/TJC. |
| /home/user/workspace/VeritaCheck_Software_REDACTED_SEE_RAILWAY_ENV.pdf | 4-page fillable software validation template for labs. |
| /home/user/workspace/STANDING_REQUIREMENTS.md | 108-line canonical rules file. MUST READ at start of every build. |
| /home/user/workspace/SESSION_HANDOFF.md | This file. |

---

*End of session handoff. Last substantive work: April 1, 2026 -- compliance documents created, competitive gap analysis reviewed.*
