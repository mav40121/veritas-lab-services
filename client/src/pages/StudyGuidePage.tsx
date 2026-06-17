import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ExternalLink, ChevronRight, FlaskConical, BarChart2, Activity, Repeat, Beaker, Droplets, Sigma, Shuffle, Lock, Filter, Target, Package, CheckSquare } from "lucide-react";

// ─── External reference links ─────────────────────────────────────────────────
const REFS = {
  cliaCalVerBrochure: {
    label: "CMS CLIA Brochure: Calibration & Calibration Verification",
    url: "https://www.cms.gov/files/document/clia-brochure-calibration-and-calibration-verification-april-2006.pdf",
    source: "CMS.gov",
  },
  cliaVerificationBrochure: {
    label: "CMS CLIA Brochure: Verification of Performance Specifications",
    url: "https://www.cms.gov/regulations-and-guidance/legislation/clia/downloads/6064bk.pdf",
    source: "CMS.gov",
  },
  cliaBrochures: {
    label: "All CLIA Brochures (CMS)",
    url: "https://www.cms.gov/medicare/quality/clinical-laboratory-improvement-amendments/brochures",
    source: "CMS.gov",
  },
  cfr493927: {
    label: "42 CFR §493.927 - PT acceptance criteria, general immunology",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/section-493.927",
    source: "eCFR",
  },
  cfr493931: {
    label: "42 CFR §493.931 - PT acceptance criteria, routine chemistry",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/section-493.931",
    source: "eCFR",
  },
  cfr493937: {
    label: "42 CFR §493.937 - PT acceptance criteria, toxicology",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/section-493.937",
    source: "eCFR",
  },
  cfr493941: {
    label: "42 CFR §493.941 - PT acceptance criteria, hematology",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/section-493.941",
    source: "eCFR",
  },
  cfr4931253: {
    label: "42 CFR §493.1253 - Establishment and verification of performance specifications",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1253",
    source: "eCFR",
  },
  cfr4931255: {
    label: "42 CFR §493.1255 - Calibration and calibration verification procedures",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-K/section-493.1255",
    source: "eCFR",
  },
  clsiEP6: {
    label: "CLSI EP06 - Evaluation of Linearity",
    url: "https://clsi.org/standards/products/method-evaluation/documents/ep06/",
    source: "CLSI",
  },
  clsiEP9: {
    label: "CLSI EP09 - Measurement Procedure Comparison (Method Comparison)",
    url: "https://clsi.org/standards/products/method-evaluation/documents/ep09/",
    source: "CLSI",
  },
  clsiEP10: {
    label: "CLSI EP10-A3 - Preliminary Evaluation of Quantitative Clinical Laboratory Measurement Procedures (Carryover)",
    url: "https://clsi.org/standards/products/method-evaluation/documents/ep10/",
    source: "CLSI",
  },
  clsiEP15: {
    label: "CLSI EP15-A3 - User Verification of Precision and Estimation of Bias",
    url: "https://clsi.org/standards/products/method-evaluation/documents/ep15/",
    source: "CLSI",
  },
  clsiEP17: {
    label: "CLSI EP17-A2 - Evaluation of Detection Capability for Clinical Laboratory Measurement Procedures",
    url: "https://clsi.org/standards/products/method-evaluation/documents/ep17/",
    source: "CLSI",
  },
  clsiEP26: {
    label: "CLSI EP26 - User Evaluation of Acceptability of a Reagent Lot Change",
    url: "https://clsi.org/standards/products/method-evaluation/documents/ep26/",
    source: "CLSI",
  },
  clsiC24: {
    label: "CLSI C24-Ed4 - Statistical Quality Control for Quantitative Measurement Procedures: Principles and Definitions",
    url: "https://clsi.org/standards/products/quality-management/documents/c24/",
    source: "CLSI",
  },
  clsiEP28: {
    label: "CLSI EP28-A3c - Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory",
    url: "https://clsi.org/standards/products/method-evaluation/documents/ep28/",
    source: "CLSI",
  },
  clsiOverview: {
    label: "CLSI EP Documents - Verifying Performance Claims (Overview)",
    url: "https://clsi.org/resources/insights-blog/verifying-performance-claims-for-medical-laboratory-tests/",
    source: "CLSI",
  },
  qso2025: {
    label: "CMS QSO-25-10 - Updated CLIA Survey Guidance (2025)",
    url: "https://www.cms.gov/files/document/qso-25-10-clia-revised.pdf",
    source: "CMS.gov",
  },
};

function RefLink({ r }: { r: typeof REFS[keyof typeof REFS] }) {
  return (
    <a
      href={r.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
    >
      <ExternalLink size={11} className="shrink-0 opacity-70" />
      {r.label}
      <span className="text-xs text-muted-foreground">({r.source})</span>
    </a>
  );
}

function StudyCard({
  icon,
  color,
  badge,
  title,
  subtitle,
  when,
  frequency,
  regulation,
  what,
  howIt,
  passFail,
  refs,
  ctaStudyType,
}: {
  icon: React.ReactNode;
  color: string;
  badge: string;
  title: string;
  subtitle: string;
  when: string[];
  frequency: string;
  regulation: string;
  what: string;
  howIt: string;
  passFail: string;
  refs: (typeof REFS[keyof typeof REFS])[];
  ctaStudyType: string;
}) {
  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      {/* Header */}
      <div className={`${color} px-6 py-5`}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5">{icon}</div>
          <div>
            <Badge className="mb-1.5 text-xs bg-white/20 text-white border-0">{badge}</Badge>
            <h2 className="text-xl font-bold text-white">{title}</h2>
            <p className="text-sm text-white/80 mt-0.5">{subtitle}</p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 space-y-5">
        {/* What it is */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1.5">What it is</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{what}</p>
        </div>

        {/* How it works */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1.5">How it works</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{howIt}</p>
        </div>

        {/* When to run */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1.5">When to run it</h3>
          <ul className="space-y-1">
            {when.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <ChevronRight size={13} className="text-primary mt-0.5 shrink-0" />
                {w}
              </li>
            ))}
          </ul>
        </div>

        {/* Frequency + Regulation */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-xs text-muted-foreground font-medium mb-0.5">CLIA Frequency</div>
            <div className="text-sm font-semibold">{frequency}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="text-xs text-muted-foreground font-medium mb-0.5">Governing Regulation</div>
            <div className="text-sm font-semibold">{regulation}</div>
          </div>
        </div>

        {/* Pass/Fail criteria */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-1.5">Pass / Fail criteria</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">{passFail}</p>
        </div>

        {/* References */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-2">Official references</h3>
          <ul className="space-y-1.5">
            {refs.map((r, i) => (
              <li key={i}><RefLink r={r} /></li>
            ))}
          </ul>
        </div>

        {/* CTA */}
        <div className="pt-1">
          <Link href="/veritacheck" className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
            <FlaskConical size={14} />
            Run a {title} in VeritaCheck{"\u2122"}
            <ChevronRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function StudyGuidePage() {
  return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-14">
          <div className="flex items-center gap-2 mb-4">
            <BookOpen size={20} className="text-primary" />
            <Badge className="bg-primary/10 text-primary border-0">Study Guide</Badge>
          </div>
          <h1 className="font-serif text-4xl font-bold mb-3">Which study does your lab need?</h1>
          <p className="text-muted-foreground text-lg max-w-2xl leading-relaxed">
            CLIA requires non-waived laboratories to verify and document instrument performance on a defined schedule.
            This guide explains the ten study types supported by VeritaCheck™, what they are, when CLIA requires them, and how VeritaCheck™ automates each one.
          </p>
          <p className="text-xs text-muted-foreground mt-4 max-w-2xl">
            All regulatory citations are drawn directly from{" "}
            <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">42 CFR Part 493</a>{" "}
            and official CMS CLIA guidance. This page is an educational summary. Always consult your laboratory director or designee and the full regulation for compliance decisions.
          </p>
        </div>
      </section>

      {/* What VeritaCheck adds beyond the spreadsheet: cross-cutting capabilities */}
      <section className="section-padding border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-2xl font-bold mb-2">What VeritaCheck™ adds beyond the spreadsheet</h2>
          <p className="text-muted-foreground text-sm mb-6 max-w-3xl leading-relaxed">
            Every VeritaCheck study uses the same audit-trail, exclusion, and finalization model. These capabilities apply across the study types below, so the director sees the same workflow and the surveyor sees the same defensibility regardless of which protocol the study runs.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="border border-border rounded-lg p-4 bg-background">
              <div className="flex items-start gap-3">
                <div className="mt-0.5"><Filter size={18} className="text-primary" /></div>
                <div>
                  <h3 className="text-sm font-semibold mb-1">Per-point exclusion with audit trail</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Mark an individual data point as excluded (transcription error, specimen issue, known interference) without redoing the whole study. The point stays on the record, struck through with the reason and timestamp, and the regression or SD recomputes without it. Surveyor sees the full collected-then-excluded story.
                  </p>
                </div>
              </div>
            </div>
            <div className="border border-border rounded-lg p-4 bg-background">
              <div className="flex items-start gap-3">
                <div className="mt-0.5"><Target size={18} className="text-primary" /></div>
                <div>
                  <h3 className="text-sm font-semibold mb-1">AMR coverage analysis</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Optionally enter the claimed Analytical Measurement Range on any range-relevant study. The PDF reports how close the lowest and highest tested points come to each AMR edge, with a coverage percentage and verdict (fully exercised, near-edge, under-tested, or outside AMR) per CLSI EP06 commentary.
                  </p>
                </div>
              </div>
            </div>
            <div className="border border-border rounded-lg p-4 bg-background">
              <div className="flex items-start gap-3">
                <div className="mt-0.5"><Sigma size={18} className="text-primary" /></div>
                <div>
                  <h3 className="text-sm font-semibold mb-1">Systematic error at medical decision levels</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Method comparison studies report systematic error at each clinically relevant decision level for the analyte, decomposed into constant bias (intercept) and proportional bias (slope minus one). |SE at MDL| is compared against TEa at that concentration, with a per-MDL verdict the director signs off on.
                  </p>
                </div>
              </div>
            </div>
            <div className="border border-border rounded-lg p-4 bg-background">
              <div className="flex items-start gap-3">
                <div className="mt-0.5"><Lock size={18} className="text-primary" /></div>
                <div>
                  <h3 className="text-sm font-semibold mb-1">Draft, sign off, amend lifecycle</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Studies move from draft to signed off when the director signs. Signed-off studies are locked from direct edits; any change after sign-off creates an amendment row linked to the original, preserving the audit trail. Drafts can be edited freely.
                  </p>
                </div>
              </div>
            </div>
            <div className="border border-border rounded-lg p-4 bg-background">
              <div className="flex items-start gap-3">
                <div className="mt-0.5"><Package size={18} className="text-primary" /></div>
                <div>
                  <h3 className="text-sm font-semibold mb-1">Survey Bundle PDF by analyzer</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    One click produces a single bundled PDF that groups every verification and supporting study by analyzer, with a cover page, per-element pass/fail, statistical appendices, and signature blocks. Surveyor walks away with one document per instrument.
                  </p>
                </div>
              </div>
            </div>
            <div className="border border-border rounded-lg p-4 bg-background">
              <div className="flex items-start gap-3">
                <div className="mt-0.5"><CheckSquare size={18} className="text-primary" /></div>
                <div>
                  <h3 className="text-sm font-semibold mb-1">Editable analyte, values, and TEa</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Director can edit the analyte name, individual entered values, TEa preset, and units on any draft study without redoing the run. Combined with per-point exclusion, this covers the everyday correction path Michael L flagged: typos and outliers do not force a redo.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick comparison */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-2xl font-bold mb-6">At a glance</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left py-3 px-4 font-semibold">Study Type</th>
                  <th className="text-left py-3 px-4 font-semibold">Question it answers</th>
                  <th className="text-left py-3 px-4 font-semibold">CLIA frequency</th>
                  <th className="text-left py-3 px-4 font-semibold">CFR citation</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 font-medium text-primary">Calibration Verification / Linearity</td>
                  <td className="py-3 px-4 text-muted-foreground">Is my instrument reading accurately across its full reportable range?</td>
                  <td className="py-3 px-4">Every 6 months (minimum)</td>
                  <td className="py-3 px-4"><a href={REFS.cfr4931255.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">§493.1255(b)(3)</a>; analyte criterion from §493.927, .931, .937, .941 (lab-adopted)</td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 font-medium text-primary">Reportable Range Verification</td>
                  <td className="py-3 px-4 text-muted-foreground">What is the highest and lowest concentration I can reliably report on this analyzer for this analyte?</td>
                  <td className="py-3 px-4">At method introduction; when the manufacturer changes the AMR claim</td>
                  <td className="py-3 px-4"><a href={REFS.cfr4931253.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">§493.1253(b)(1)(iii)</a>; CLSI EP06</td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 font-medium text-primary">Correlation / Method Comparison</td>
                  <td className="py-3 px-4 text-muted-foreground">Do my two instruments (or methods) agree with each other?</td>
                  <td className="py-3 px-4">When introducing a new method; annually recommended</td>
                  <td className="py-3 px-4"><a href={REFS.cfr4931253.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">§493.1253(b)(2)</a>; analyte criterion from §493.927, .931, .937, .941 (lab-adopted)</td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 font-medium text-primary">Precision</td>
                  <td className="py-3 px-4 text-muted-foreground">Is my instrument producing consistent, reproducible results?</td>
                  <td className="py-3 px-4">When introducing a new method; after major maintenance</td>
                  <td className="py-3 px-4"><a href={REFS.cfr4931253.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">§493.1253(b)(1)(ii)</a>; allowable imprecision adopted from analyte PT criterion</td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 font-medium text-primary">Sensitivity Verification (EP17-A2)</td>
                  <td className="py-3 px-4 text-muted-foreground">What is the lowest concentration my method can detect (LoB / LoD) and quantify (LoQ) reliably?</td>
                  <td className="py-3 px-4">Verification: when introducing an FDA-cleared method. Establishment: for any modified or in-house (LDT) method.</td>
                  <td className="py-3 px-4"><a href={REFS.cfr4931253.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">§493.1253(b)(2)(iii)</a> for establishment; <a href={REFS.cfr4931253.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">§493.1253(b)(1)</a> for verification. CLSI EP17-A2.</td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 font-medium text-primary">Reference Range Verification</td>
                  <td className="py-3 px-4 text-muted-foreground">Can we adopt the manufacturer's reference ranges for our patient population?</td>
                  <td className="py-3 px-4">When adopting manufacturer reference ranges</td>
                  <td className="py-3 px-4">CLSI EP28-A3c</td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 font-medium text-primary">Reagent Lot Verification (EP26)</td>
                  <td className="py-3 px-4 text-muted-foreground">Does the new reagent lot perform equivalently to the current lot on patient samples?</td>
                  <td className="py-3 px-4">At each qualifying reagent lot change</td>
                  <td className="py-3 px-4">42 CFR §493.1253(b)(3), §493.1255; CLSI EP26</td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 font-medium text-primary">QC Lot Verification (C24-Ed4)</td>
                  <td className="py-3 px-4 text-muted-foreground">What are the lab's calculated mean and SD for this new QC lot, and did the changeover introduce any analytical drift?</td>
                  <td className="py-3 px-4">When introducing a new QC lot; optional crossover bias check vs prior lot; optional vendor SDI comparison</td>
                  <td className="py-3 px-4">42 CFR §493.1256; CLSI C24-Ed4</td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 font-medium text-primary">Carryover (EP10)</td>
                  <td className="py-3 px-4 text-muted-foreground">Does a high-concentration sample leave residue that contaminates the next low sample?</td>
                  <td className="py-3 px-4">At new instrument introduction; after major maintenance affecting sample path</td>
                  <td className="py-3 px-4">42 CFR §493.1253(b)(1); CLSI EP10-A3</td>
                </tr>
                <tr className="hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 font-medium text-primary">Multi-Analyte Coagulation Verification</td>
                  <td className="py-3 px-4 text-muted-foreground">Are all analytes on my coagulation analyzer performing within specification?</td>
                  <td className="py-3 px-4">At verification; each analyte assessed individually</td>
                  <td className="py-3 px-4">42 CFR §493.1255</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Detailed cards */}
      <section className="section-padding">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 space-y-8">

          <StudyCard
            icon={<BarChart2 size={22} className="text-white" />}
            color="bg-[#0e8a82]"
            badge="Most Common"
            title="Calibration Verification / Linearity"
            subtitle="Verify your instrument reads accurately from low to high"
            what="Calibration verification confirms that your instrument is producing accurate results across its entire reportable range, from the lowest to the highest value it can measure. It is sometimes called a linearity study because you are confirming that measured values track linearly with known assigned values. Reportable Range is the same data shape and study type group in VeritaCheck; a lab that wants to verify only the upper and lower extremes uses the same form with fewer levels."
            howIt="You test materials with known assigned concentrations at multiple levels spanning the reportable range (minimum 3 levels: low, mid, high). VeritaCheck™ calculates percent recovery and observed error for each level, runs OLS regression, and evaluates every result against the calibration verification acceptance criterion your laboratory has adopted (typically the §493 PT TEa for that analyte, approved by the medical director or designee). The report shows a scatter plot, percent recovery chart, linearity summary, and a pass/fail verdict. OLS regression is used because calibrator assigned values are treated as exact. Other evaluation tools and software may use different regression methods by default. Minor slope differences between tools are expected and do not affect pass/fail evaluation. Optional AMR coverage analysis reports how close your lowest and highest tested points come to each AMR edge, with a verdict per CLSI EP06 commentary (fully exercised at 95% each end, near-edge at 90 to 94%, under-tested below 90%). Per-point exclusion lets the director remove an outlier or transcription error from the regression without redoing the study; the excluded point stays on the record with the reason."
            when={[
              "Every 6 months (required by CLIA for all non-waived tests)",
              "Whenever calibration is performed",
              "After a major instrument repair or component replacement",
              "When switching to a new reagent lot (manufacturer-dependent)",
              "Any time there is reason to doubt instrument accuracy",
            ]}
            frequency="Every 6 months minimum"
            regulation="42 CFR §493.1255(b)(3)"
            passFail="All measured results must fall within the calibration verification acceptance criterion adopted by your lab (typically the §493 PT TEa for that analyte). VeritaCheck™ evaluates each level individually and reports the percentage of results passing. A PASS requires 100% of results within the adopted criterion."
            refs={[
              REFS.cliaCalVerBrochure,
              REFS.cfr493931,
              REFS.clsiEP6,
              REFS.qso2025,
            ]}
            ctaStudyType="cal_ver"
          />

          <StudyCard
            icon={<Target size={22} className="text-white" />}
            color="bg-[#1d4ed8]"
            badge="Reportable Range Focused"
            title="Reportable Range Verification"
            subtitle="Verify the upper and lower extremes of your AMR claim, with fewer levels than a full linearity"
            what="Reportable Range Verification is the focused form of CLSI EP06 used when a lab wants to confirm just the highest and lowest measurable concentrations on the analyzer rather than the full linearity surface across the range. CLIA-recognized for confirming the manufacturer's Analytical Measurement Range (AMR) claim is appropriate for the lab's specific instrument and sample type, and surveyors accept it as a separate study from full linearity when the lab has documented why a focused verification is sufficient (e.g., the AMR claim has not changed since the last full linearity, and the lab only needs to confirm performance at the extremes)."
            howIt="Same study type group in VeritaCheck as Calibration Verification / Linearity but with as few as 2 levels (low + high). VeritaCheck™ computes percent recovery and observed error at each level and evaluates against the adopted acceptance criterion. The optional AMR coverage analysis is particularly relevant here: the director enters the claimed AMR low and high, and the PDF reports whether your tested extremes cover at least 95% of the claimed range on each end (per CLSI EP06 commentary). Per-point exclusion is available on the same dialog as Linearity."
            when={[
              "At method introduction when the lab wants to verify only the AMR extremes rather than the full linearity surface",
              "When the manufacturer updates the AMR claim and the lab needs to confirm performance at the new boundary",
              "When a focused re-verification is appropriate after a sample-path repair that does not warrant a full linearity redo",
              "As an interim verification between full linearity studies if the director or designee determines it is sufficient",
            ]}
            frequency="At method introduction; when AMR claim changes; otherwise as the director or designee determines"
            regulation="42 CFR §493.1253(b)(1)(iii); CLSI EP06 is the methodology standard"
            passFail="Each level must fall within the calibration verification acceptance criterion adopted by your lab (typically the §493 PT TEa for that analyte). VeritaCheck™ evaluates each level individually. The AMR coverage analysis reports separately whether the tested range exercises both edges of the claimed AMR (full coverage at 95% each end, near-edge at 90 to 94%, under-tested below 90%). Your laboratory director or designee makes the final acceptability determination."
            refs={[
              REFS.cliaCalVerBrochure,
              REFS.cfr4931253,
              REFS.clsiEP6,
              REFS.qso2025,
            ]}
            ctaStudyType="reportable_range"
          />

          <StudyCard
            icon={<Shuffle size={22} className="text-white" />}
            color="bg-[#a16207]"
            badge="New Instrument / Major Service"
            title="Carryover (CLSI EP10-A3)"
            subtitle="Confirm a high-concentration sample does not contaminate the next low sample"
            what="Carryover quantifies how much of a high-concentration sample's analyte gets carried into the next sample through the analyzer's probe, tubing, or reaction vessel. Even small carryover can falsely elevate a subsequent low result and clinical decisions made on that result. CLIA-relevant when introducing a new instrument, after a major service event affecting the sample path, and when manufacturer carryover claims need to be verified for the lab's specific use."
            howIt="The lab runs a defined alternating sequence of Low and High specimens, typically 21 samples in the pattern L,L,H,H,L,L,H,L,H,H,L,L,L,L,H,H,L,L,H,L,L. VeritaCheck™ classifies each Low result as either Low-after-Low (no high specimen preceded it) or Low-after-High (a high specimen preceded it), then computes the SD of each group. The carryover statistic is the difference between Mean(Low-after-High) and Mean(Low-after-Low). The error limit is three times the SD of the Low-after-Low group. Carryover passes when the carryover statistic does not exceed the error limit. Many modern closed-tube analyzers carry the manufacturer's carryover claim through normal operation, and many labs document Carryover as Not Performed with the manufacturer carryover claim citation when the analyzer is new and unmodified. Per-point exclusion lets the director remove an outlier specimen from the SD calculation; the excluded point stays on the record with the reason."
            when={[
              "At new instrument introduction (CLIA-required as part of method verification)",
              "After major service that touches the sample path: probe replacement, valve service, wash station rebuild",
              "When QC patterns suggest sample-to-sample interaction (e.g., a high result followed by an unexpectedly elevated low)",
              "When manufacturer carryover claims are not provided or are inadequate for the specific specimen type the lab uses",
              "When clinically sensitive analytes (cardiac markers, infectious-disease serology, tumor markers) are added to the menu",
            ]}
            frequency="At method introduction; after major sample-path service"
            regulation="42 CFR §493.1253(b)(1); CLSI EP10-A3 is the methodology standard"
            passFail="Carryover passes when Mean(Low-after-High) minus Mean(Low-after-Low) does not exceed three times the SD of Low-after-Low (the EP10 error limit). VeritaCheck™ reports the carryover statistic, error limit, Low-after-Low and Low-after-High counts, and a pass/fail verdict. For most modern closed-tube analyzers running an unmodified manufacturer procedure, this study confirms the manufacturer's carryover claim rather than producing a new claim. Your laboratory director or designee makes the final acceptability determination."
            refs={[
              REFS.clsiEP10,
              REFS.cliaVerificationBrochure,
              REFS.cfr4931253,
            ]}
            ctaStudyType="carryover"
          />

          <StudyCard
            icon={<Activity size={22} className="text-white" />}
            color="bg-[#2563eb]"
            badge="New Method / Instrument"
            title="Correlation / Method Comparison"
            subtitle="Confirm two methods or instruments agree before reporting patient results"
            what="A method comparison study determines whether two measurement procedures (or two instruments running the same assay) produce equivalent results on the same patient samples. It is required any time a laboratory introduces a new test method, adds an instrument, or begins reporting results from a second analyzer."
            howIt="You run a set of patient or split samples on both the reference method and the test method simultaneously. VeritaCheck™ performs OLS regression on the paired data, reports slope, intercept, correlation r, and r-squared, and then computes systematic error at each medical decision level for the analyte. Systematic error at MDL is decomposed into constant bias (intercept) and proportional bias (slope minus one), and |SE at MDL| is compared against TEa at that concentration to produce a per-MDL verdict. Optional AMR coverage analysis reports how close your tested data spans to each edge of the claimed AMR. Per-point exclusion lets the director remove an outlier or transcription error from the regression without redoing the study; the excluded point stays on the record with the reason. Other evaluation tools and software may use different regression methods or different MDL tables by default. Minor numerical differences between tools are expected and do not affect pass/fail evaluation."
            when={[
              "Before putting a new instrument or analyzer into service",
              "When introducing a new test method or reagent system",
              "When splitting work between two analyzers running the same test",
              "When resuming testing after an extended instrument downtime",
              "Annually for instruments running the same assay (best practice)",
            ]}
            frequency="At method introduction; annually recommended"
            regulation="42 CFR §493.1253(b)(2)"
            passFail="Each paired result is evaluated against the method comparison acceptance criterion adopted by your lab (typically the §493 PT TEa for that analyte, under §493.1253(b)(2)). The systematic error analysis at medical decision levels provides an additional per-MDL verdict: |SE at MDL| under TEa at that concentration meets criteria; |SE at MDL| at or above TEa at that concentration does not. A PASS requires the regression to meet the adopted criterion AND |SE at MDL| to be under TEa at every clinically relevant decision level. Your laboratory director or designee makes the final acceptability determination."
            refs={[
              REFS.cliaVerificationBrochure,
              REFS.cfr4931253,
              REFS.clsiEP9,
              REFS.clsiOverview,
            ]}
            ctaStudyType="method_comparison"
          />

          <StudyCard
            icon={<FlaskConical size={22} className="text-white" />}
            color="bg-[#7c3aed]"
            badge="New Method Verification"
            title="Precision"
            subtitle="Confirm your instrument is producing reproducible, consistent results"
            what="Precision verification measures how consistently an instrument produces the same result when the same sample is tested multiple times. Imprecision (variability) is expressed as a standard deviation (SD) or coefficient of variation (CV%). CLIA requires laboratories to verify that their instruments meet the manufacturer's stated precision claims before reporting patient results."
            howIt="You run control materials repeatedly, typically 20 times over multiple days or runs. VeritaCheck™ calculates the mean, SD, and CV for each control level. In Advanced (EP15 ANOVA) mode, within-run, between-run, between-day, and total imprecision are separated using analysis of variance, exactly per CLSI EP15-A3. Results are compared to the precision acceptance criterion adopted by your lab for that analyte (typically the §493 PT TEa, approved by the medical director or designee). Per-point exclusion lets the director remove a transcription error or specimen issue from the SD calculation without redoing the run; the excluded point stays on the record with the reason."
            when={[
              "Before introducing any new test method into service (CLIA required)",
              "After a major instrument repair or component replacement",
              "When reagent lot changes cause QC shifts or trends",
              "Annually as part of method performance review (best practice)",
              "Any time imprecision is suspected based on QC patterns",
            ]}
            frequency="At method introduction; after major maintenance"
            regulation="42 CFR §493.1253(b)(1)(ii)"
            passFail="Each control level must have a CV% at or below the allowable imprecision adopted by your lab for that analyte. In Advanced mode, total imprecision CV is compared to the limit. VeritaCheck™ reports pass/fail per level. Your laboratory director or designee reviews and approves all precision data before the method enters clinical use. Note: some commercial tools evaluate precision against manufacturer-claimed imprecision rather than against the §493 PT TEa for the analyte. VeritaCheck™ uses §493 PT TEa as the precision benchmark when your lab adopts that approach (typical and recommended); this is the more conservative and easier-to-defend choice. Your medical director or designee approves the criterion in either case."
            refs={[
              REFS.cliaVerificationBrochure,
              REFS.cfr493941,
              REFS.clsiEP15,
              REFS.clsiOverview,
            ]}
            ctaStudyType="precision"
          />

          <StudyCard
            icon={<Sigma size={22} className="text-white" />}
            color="bg-[#7c3aed]"
            badge="Detection & Quantitation"
            title="Sensitivity Verification (CLSI EP17-A2)"
            subtitle="Confirm the lowest concentration you can detect and reliably report"
            what="Sensitivity verification quantifies three thresholds at the low end of an assay's measuring range. The Limit of Blank (LoB) is the highest value expected from a blank specimen at 95 percent confidence (mean + 1.645 standard deviations of the blanks). The Limit of Detection (LoD) is the lowest true concentration that can be reliably distinguished from a blank (LoB plus a confidence-weighted SD at low concentration). The Limit of Quantitation (LoQ) is the lowest concentration where the result is both precise enough and accurate enough to release as a quantitative number. Below LoQ, labs report 'detected, not quantifiable' or '< LoQ' rather than a numeric value."
            howIt="VeritaCheck supports two modes per CLSI EP17-A2. Verification mode confirms a manufacturer's published LoB / LoD / LoQ claims with a small study (typically 5 to 7 blank and low-level replicates) and is the path for an FDA-cleared, unmodified assay. Establishment mode is the full study for modified or laboratory-developed methods: approximately 60 blank and 60 low-level replicates across multiple reagent lots and multiple days, plus optional LoQ concentration levels with multiple replicates at each. Per-reagent-lot LoB breakdown is included in the report when lot labels are tagged on the entered replicates. The director-adopted CV and absolute bias thresholds for LoQ default to the EP17-A2 starting points of 20 percent and 25 percent respectively, and are editable per-study so they can match the clinical decision point of the assay (e.g., tighter for therapeutic drug monitoring)."
            when={[
              "At method introduction for an FDA-cleared assay (Verification mode)",
              "When modifying a manufacturer's procedure (specimen type, reagents, calibration steps): the method converts to Establishment mode",
              "For laboratory-developed tests (LDTs) without manufacturer-published sensitivity claims",
              "When changing reagent lots if the manufacturer's IFU requires re-verification of sensitivity",
              "Whenever the clinical decision point falls near the assay detection limit and confirmation of the floor is warranted",
            ]}
            frequency="Verification: at method introduction. Establishment: at method introduction for any LDT or modified method."
            regulation="42 CFR §493.1253(b)(2)(iii) (Establishment); §493.1253(b)(1) (Verification)"
            passFail="LoB is the calculated 95th-percentile blank value. LoD is the lowest concentration reliably distinguishable from a blank. LoQ requires BOTH a CV at or below the director-adopted precision threshold AND an absolute bias at or below the director-adopted accuracy threshold at the lowest tested concentration. In Verification mode, the lab confirms its calculated values fall at or below the manufacturer's published claims. In Establishment mode, the lab adopts its calculated values as the official performance specs, subject to medical director or designee approval. The VeritaCheck PDF includes per-lot LoB breakdown when lot labels are supplied."
            refs={[
              REFS.clsiEP17,
              REFS.cliaVerificationBrochure,
              REFS.clsiOverview,
            ]}
            ctaStudyType="sensitivity"
          />

          <StudyCard
            icon={<Beaker size={22} className="text-white" />}
            color="bg-[#0d9488]"
            badge="Reference Range Adoption"
            title="Reference Range Verification"
            subtitle="Verify manufacturer reference ranges for your patient population"
            what="Reference range verification determines whether a manufacturer's published reference ranges are appropriate for your laboratory's patient population. This is required when your laboratory adopts reference ranges from the manufacturer rather than establishing its own. The CLSI EP28-A3c protocol provides the standard methodology."
            howIt="You collect specimens from a minimum of 20 healthy individuals representative of your patient population. Each specimen is tested using your method. If 2 or fewer of the 20 results fall outside the manufacturer's stated reference range, the range is considered verified for your population. If more than 2 results fall outside, further investigation or a full reference range study may be required. Optional AMR coverage analysis surfaces a compact summary of how the specimen value range relates to the claimed AMR. Per-point exclusion lets the director remove a specimen later identified as non-representative (e.g., subclinical condition discovered after collection) from the analysis; the excluded specimen stays on the record with the reason."
            when={[
              "When adopting manufacturer reference ranges for a new test or method",
              "When changing to a new instrument platform with different reference ranges",
              "When your patient population demographics change significantly",
              "When the manufacturer updates its reference ranges",
            ]}
            frequency="At method introduction or reference range change"
            regulation="CLSI EP28-A3c"
            passFail="Pass if 2 or fewer of 20 specimens fall outside the manufacturer's stated reference range. If more than 2 fall outside, the reference range may not be appropriate for your population, and a full reference range study or further investigation is required. Your laboratory director or designee makes the final determination."
            refs={[
              REFS.cliaVerificationBrochure,
              REFS.clsiEP28,
              REFS.clsiOverview,
            ]}
            ctaStudyType="ref_interval"
          />

          <StudyCard
            icon={<Repeat size={22} className="text-white" />}
            color="bg-[#d97706]"
            badge="Reagent Change"
            title="Reagent Lot Verification (CLSI EP26)"
            subtitle="Confirm new reagent lot performs equivalently to the current lot, using patient samples"
            what="Reagent Lot Verification confirms that a new reagent lot produces patient results consistent with the current lot, before the new lot is placed into routine clinical use. The study is governed by CLSI EP26 (User Evaluation of Acceptability of a Reagent Lot Change), which establishes that the comparison should use real patient specimens rather than QC material because QC matrices may not reflect how a reagent lot performs on the actual patient sample matrix."
            howIt="Patient specimens spanning the analytical measurement range are tested in parallel on both the current reagent lot and the new reagent lot. VeritaCheck™ computes per-specimen percent difference and applies a two-part TEa-based pass rule: (1) the mean absolute percent difference must be within the adopted total allowable error, AND (2) at least 90 percent of paired specimens must fall within the TEa criterion. This TEa-based variant is the rule most working clinical labs apply; the full formal EP26 protocol is heavier than routine chemistry workflows allow, a limitation flagged in peer-reviewed evaluations (Thompson 2017, Loh 2020)."
            when={[
              "Every time a new reagent lot is brought into clinical use, including coag, chemistry, hematology, and immunoassay reagents",
              "When the manufacturer's instructions for use (IFU) require verification at a lot change",
              "When QC drift after a lot change suggests a performance shift",
              "Recommended for high-volume or clinically sensitive analytes as standard practice",
            ]}
            frequency="At each qualifying reagent lot change"
            regulation="42 CFR §493.1253(b)(3) (manufacturer's instructions) and §493.1255 (calibration verification). CLSI EP26 is the methodology standard."
            passFail="The mean absolute percent difference between current and new lot must be within the adopted TEa, AND at least 90 percent of paired specimens must fall within TEa. Per-specimen results outside TEa on a passing study are documented in the per-sample table. Your laboratory director or designee reviews and approves results before the new lot enters service."
            refs={[
              REFS.clsiEP26,
              REFS.cliaCalVerBrochure,
              REFS.cfr493931,
            ]}
            ctaStudyType="lot_to_lot"
          />

          <StudyCard
            icon={<BarChart2 size={22} className="text-white" />}
            color="bg-[#0891b2]"
            badge="QC Material Change"
            title="QC Lot Verification (CLSI C24-Ed4)"
            subtitle="Establish the lab's mean and SD for a new QC lot, with optional crossover bias check and vendor SDI comparison"
            what="QC Lot Verification is the study you run when a new lot of QC material arrives. It produces the lab's own calculated mean and standard deviation for the new lot, which become the operating values on the Levey-Jennings chart per 42 CFR §493.1256. The study supports three sections that can be used together or separately: (1) new lot range establishment, always required; (2) crossover bias check vs the prior lot, optional; (3) vendor SDI comparison against package-insert assigned values, optional and informational only. CLIA requires the laboratory to determine its own mean and SD; vendor values are reference points, not the operating values."
            howIt="The default replicate grid is 2 measurements per day for 10 days (20 points per level per analyzer), which is the CLSI C24-Ed4 accelerated path and matches what most working clinical labs actually run. Configurable to 1 per day for 20 days (gold standard) or 4 per day for 5 days (short cycle). When the crossover bias check is enabled, the lab enters a parallel grid of prior-lot replicates collected in the same window; VeritaCheck™ computes the prior lot's mean and SD from those replicates and runs a pooled-SD bias verdict (Accept under 1 SD, Caution 1 to 2 SD, Fail at or above 2 SD). When the vendor section is enabled, the lab enters the package-insert mean and SD per analyte+level; VeritaCheck™ computes the Standard Deviation Index per Westgard and color-codes the result. The PDF stitches whichever sections were used and cites only the standards that actually applied."
            when={[
              "At every new lot of QC material, before the lot is placed into routine clinical use",
              "Crossover bias check (opt-in) recommended when the lot change is happening on a high-volume or clinically sensitive analyte to detect any analytical drift during the changeover",
              "Vendor SDI comparison (opt-in) when the QC material is assayed and the package insert provides method-specific or method-agnostic assigned values",
            ]}
            frequency="At each new QC lot change. Sections 2 and 3 are opt-in per study."
            regulation="42 CFR §493.1256 (QC requirements: lab must determine its own mean and SD). CLSI C24-Ed4 is the methodology standard."
            passFail="Section 1 (range establishment) always succeeds in producing the lab's calculated mean and SD; the director adopts these as the new operating values. Section 2 (crossover bias check) returns Accept / Caution / Fail per pooled SD between new and prior lot. Section 3 (vendor SDI) returns a Westgard color-coded classification (excellent / acceptable / investigate / unacceptable) but does NOT gate the study pass; vendor SD is reference only per CLIA. Director or designee reviews and signs the report before the new lot enters service."
            refs={[
              REFS.clsiC24,
              REFS.cfr493931,
            ]}
            ctaStudyType="qc_range"
          />

          <StudyCard
            icon={<Droplets size={22} className="text-white" />}
            color="bg-[#dc2626]"
            badge="Coagulation Panel"
            title="Multi-Analyte Coagulation Verification"
            subtitle="Verify all coagulation analytes on a single analyzer in one study"
            what="Multi-analyte coagulation verification is designed for coagulation analyzers that run multiple assays (PT/INR, aPTT, fibrinogen, D-dimer, and others). Each analyte is assessed individually within a single verification study, allowing the laboratory to document performance across the full coagulation test menu in one organized report."
            howIt="You test verification materials at multiple levels for each coagulation analyte on the instrument. VeritaCheck™ evaluates each analyte independently, calculating recovery, bias, and pass or fail against the analyte's adopted acceptance criterion (typically the §493 PT TEa). The report groups all analytes together but maintains individual pass or fail determinations for each, producing a single document that covers the entire coagulation panel."
            when={[
              "At calibration verification intervals (every 6 months) for coagulation analyzers",
              "When adding a new coagulation analyzer to service",
              "After major maintenance or component replacement on a coagulation instrument",
              "When changing reagent lots for coagulation assays",
            ]}
            frequency="Every 6 months minimum; at qualifying events"
            regulation="42 CFR §493.1255"
            passFail="Each analyte is evaluated independently against its adopted acceptance criterion (typically the §493 PT TEa). All analytes must pass for the overall verification to be acceptable. If any single analyte fails, that analyte requires investigation and corrective action before the instrument continues reporting results for that test. Your laboratory director or designee reviews the complete panel results."
            refs={[
              REFS.cliaCalVerBrochure,
              REFS.cfr493931,
              REFS.clsiEP6,
            ]}
            ctaStudyType="coag_multi"
          />
        </div>
      </section>

      {/* Additional resources */}
      <section className="section-padding border-t border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-2xl font-bold mb-2">Additional resources</h2>
          <p className="text-muted-foreground text-sm mb-6">Official regulatory and standards documents referenced in this guide.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {Object.values(REFS).map((r, i) => (
              <div key={i} className="flex items-start gap-2 p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors">
                <ExternalLink size={13} className="text-primary mt-0.5 shrink-0" />
                <div>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium hover:text-primary transition-colors">{r.label}</a>
                  <div className="text-xs text-muted-foreground mt-0.5">{r.source}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-padding border-t border-border">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-serif text-2xl font-bold mb-3">Ready to run a study?</h2>
          <p className="text-muted-foreground mb-6">VeritaCheck™ automates all ten study types, no desktop software, no spreadsheets. Generate a CLIA-compliant PDF report in minutes.</p>
          <Link href="/veritacheck" className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-lg font-semibold text-sm transition-colors">
            <FlaskConical size={16} />
            Open VeritaCheck{"\u2122"}
          </Link>
        </div>
      </section>
    </div>
  );
}
