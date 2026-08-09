# Site-wide audit findings

Pages scanned: **85**
App.tsx routes: **120**
Canonical modules: **17** (11 compliance + 6 operations)

Tier 1 (factual / customer-facing): **11** findings
Tier 2 (consistency / dead-link / off-canon pricing): **9** findings
Tier 3 (polish / SEO / em-dash): **45** findings

Canonical module set:
- **Compliance (11):** VeritaCheck, VeritaMap, VeritaScan, VeritaComp, VeritaPolicy, VeritaStaff, VeritaLab, VeritaPT, VeritaTrack, VeritaResponse, VeritaQC
- **Operations (6):** VeritaBench, VeritaPace, VeritaShift, VeritaQA, VeritaStock, VeritaOps

## Tier 1 — factual, customer-facing

### `(cross-page)` (1 finding)
- **module name inventory**: Module names appearing on pages that are NOT in the canonical 17
  - `VeritaLabAppPage`
  - `VeritaMapBuildPage`
  - `VeritaMapMapPage`
  - `VeritaPolicyCompliancePage`
  - `VeritaPolicyMyPoliciesPage`

### `FAQPage.tsx` (1 finding)
- **module count**: Claims 'twelve / 12 modules' but canonical is 17 (11 compliance + 6 operations)
  - `oratories. The suite includes twelve modules covering performance verification, inspection readiness, competency, policy management, test menu mappin`
  - `a: "The suite includes twelve production modules: VeritaCheck\u2122 (perform`

### `VeritaCheckPage.tsx` (1 finding)
- **unknown module name**: References 'VeritaMapMapPage' which is not in the canonical 17

### `VeritaMapAppPage.tsx` (1 finding)
- **unknown module name**: References 'VeritaMapMapPage' which is not in the canonical 17

### `VeritaMapBuildPage.tsx` (1 finding)
- **unknown module name**: References 'VeritaMapMapPage' which is not in the canonical 17

### `VeritaMapLabwidePage.tsx` (1 finding)
- **unknown module name**: References 'VeritaMapMapPage' which is not in the canonical 17

### `VeritaMapMapPage.tsx` (2 findings)
- **unknown module name**: References 'VeritaMapBuildPage' which is not in the canonical 17
- **unknown module name**: References 'VeritaMapMapPage' which is not in the canonical 17

### `VeritaPolicyCompliancePage.tsx` (1 finding)
- **unknown module name**: References 'VeritaPolicyCompliancePage' which is not in the canonical 17

### `VeritaPolicyMyPoliciesPage.tsx` (1 finding)
- **unknown module name**: References 'VeritaPolicyMyPoliciesPage' which is not in the canonical 17

### `VeritaQCAppPage.tsx` (1 finding)
- **unknown module name**: References 'VeritaLabAppPage' which is not in the canonical 17

## Tier 2 — consistency / dead links / off-canon pricing

### `AdminReportPage.tsx` (2 findings)
- **pricing**: Price string '$1,999/yr' is not a canonical CLAUDE.md section 10 value
  - `$1,999/yr`
- **pricing**: Price string '$2,999/yr' is not a canonical CLAUDE.md section 10 value
  - `$2,999/yr`

### `FAQPage.tsx` (2 findings)
- **pricing**: Price string '$1,999/yr' is not a canonical CLAUDE.md section 10 value
  - `$1,999/yr`
- **pricing**: Price string '$2,999/yr' is not a canonical CLAUDE.md section 10 value
  - `$2,999/yr`

### `PricingPage.tsx` (1 finding)
- **internal link**: Links to /contact?subject=System+tier+quote but no route registered in App.tsx

### `RequestInvoicePage.tsx` (2 findings)
- **pricing**: Price string '$1,999/yr' is not a canonical CLAUDE.md section 10 value
  - `$1,999/yr`
- **pricing**: Price string '$2,999/yr' is not a canonical CLAUDE.md section 10 value
  - `$2,999/yr`

### `VeritaAssurePage.tsx` (2 findings)
- **pricing**: Price string '$1,999/yr' is not a canonical CLAUDE.md section 10 value
  - `$1,999/yr`
- **pricing**: Price string '$2,999/yr' is not a canonical CLAUDE.md section 10 value
  - `$2,999/yr`

## Tier 3 — polish / SEO / em-dash

### `AccountSettingsPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `AdminReportPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `ArticlePrecisionInterpretationPage.tsx` (1 finding)
- **em-dash**: 5 em-dash(es) outside code comments
  - `is collected across a structured design — typically 5 days of 5 replicates each —`
  - `<strong>42 CFR Part 493 Subpart I — Proficiency Testing Programs for Nonwai`
  - `<strong>42 CFR §493.1253 — Establishment and verification of perfo`

### `CumsumPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `DashboardPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `DemoCprtPage.tsx` (1 finding)
- **em-dash**: 1 em-dash(es) outside code comments
  - `title: "VeritaOps™ CPRT Demo — Cost Per Reportable Test",`

### `DemoLabPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `DemoQcPage.tsx` (1 finding)
- **em-dash**: 1 em-dash(es) outside code comments
  - `title: "VeritaQC™ Demo — Westgard QC + Monthly Attestation",`

### `DemoSelectorPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `FoundingLabApplyPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `JoinPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `LabMembersPage.tsx` (2 findings)
- **SEO**: Page does not call useSEO(); missing customized title/description
- **em-dash**: 2 em-dash(es) outside code comments
  - `: `Seat created. Email delivery failed — share the invite link manually.` });`
  - `{!canManage && " — read-only view. Only the owner or an ad`

### `LoginPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `PrivacyPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `ResetPasswordPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `StudyGuidePage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `StudyResultsPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `SurveyorViewPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `TermsPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaBenchPIPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaBenchStaffingPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaCheckVerificationPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaCompAppPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaLabAppPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaMapAppPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaMapBuildPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaMapLabwidePage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaMapMapPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaMapResourcesPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaOpsAppPage.tsx` (1 finding)
- **em-dash**: 2 em-dash(es) outside code comments
  - `<span className="text-muted-foreground">—</span>}`
  - `<span className="text-muted-foreground">—</span>}`

### `VeritaPTAppPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaPolicyAppPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaPolicyCompliancePage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaPolicyMyPoliciesPage.tsx` (2 findings)
- **SEO**: Page does not call useSEO(); missing customized title/description
- **em-dash**: 1 em-dash(es) outside code comments
  - `Step {p.step_order} — {p.step_name} (`

### `VeritaQCAppPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaQCDailyReviewPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaResponseAppPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaResponseFindingPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaScanAppPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaScanScanPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaStaffAppPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `VeritaTrackAppPage.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description

### `not-found.tsx` (1 finding)
- **SEO**: Page does not call useSEO(); missing customized title/description
