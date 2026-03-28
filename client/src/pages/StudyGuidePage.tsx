import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ExternalLink, ChevronRight, FlaskConical, BarChart2, Activity } from "lucide-react";

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
  cfr493931: {
    label: "42 CFR §493.931 — Calibration Verification",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/subject-group-ECFRefb3c9d811d8641/section-493.931",
    source: "eCFR",
  },
  cfr493933: {
    label: "42 CFR §493.933 — Method Comparison & Bias",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/subject-group-ECFRefb3c9d811d8641/section-493.933",
    source: "eCFR",
  },
  cfr493941: {
    label: "42 CFR §493.941 — Precision & Accuracy",
    url: "https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493/subpart-I/subject-group-ECFRefb3c9d811d8641/section-493.941",
    source: "eCFR",
  },
  clsiEP6: {
    label: "CLSI EP06 — Evaluation of Linearity",
    url: "https://clsi.org/standards/products/method-evaluation/documents/ep06/",
    source: "CLSI",
  },
  clsiEP9: {
    label: "CLSI EP09 — Measurement Procedure Comparison (Method Comparison)",
    url: "https://clsi.org/standards/products/method-evaluation/documents/ep09/",
    source: "CLSI",
  },
  clsiEP15: {
    label: "CLSI EP15-A3 — User Verification of Precision and Estimation of Bias",
    url: "https://clsi.org/standards/products/method-evaluation/documents/ep15/",
    source: "CLSI",
  },
  clsiOverview: {
    label: "CLSI EP Documents — Verifying Performance Claims (Overview)",
    url: "https://clsi.org/resources/insights-blog/verifying-performance-claims-for-medical-laboratory-tests/",
    source: "CLSI",
  },
  qso2025: {
    label: "CMS QSO-25-10 — Updated CLIA Survey Guidance (2025)",
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
            Run a {title} in VeritaCheck
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
            This guide explains the three core study types — what they are, when CLIA requires them, and how VeritaCheck automates each one.
          </p>
          <p className="text-xs text-muted-foreground mt-4 max-w-2xl">
            All regulatory citations are drawn directly from{" "}
            <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">42 CFR Part 493</a>{" "}
            and official CMS CLIA guidance. This page is an educational summary — always consult your laboratory director and the full regulation for compliance decisions.
          </p>
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
                  <td className="py-3 px-4"><a href={REFS.cfr493931.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">§493.931</a></td>
                </tr>
                <tr className="border-b border-border hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 font-medium text-primary">Correlation / Method Comparison</td>
                  <td className="py-3 px-4 text-muted-foreground">Do my two instruments (or methods) agree with each other?</td>
                  <td className="py-3 px-4">When introducing a new method; annually recommended</td>
                  <td className="py-3 px-4"><a href={REFS.cfr493933.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">§493.933</a></td>
                </tr>
                <tr className="hover:bg-muted/20 transition-colors">
                  <td className="py-3 px-4 font-medium text-primary">Precision Verification (EP15)</td>
                  <td className="py-3 px-4 text-muted-foreground">Is my instrument producing consistent, reproducible results?</td>
                  <td className="py-3 px-4">When introducing a new method; after major maintenance</td>
                  <td className="py-3 px-4"><a href={REFS.cfr493941.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">§493.941</a></td>
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
            what="Calibration verification confirms that your instrument is producing accurate results across its entire reportable range — from the lowest to the highest value it can measure. It is sometimes called a linearity study because you are confirming that measured values track linearly with known assigned values."
            howIt="You test materials with known assigned concentrations at multiple levels spanning the reportable range (minimum 3 levels — low, mid, high). VeritaCheck calculates percent recovery and observed error for each level, runs OLS regression, and evaluates every result against your CLIA Total Allowable Error (TEa). The report shows a scatter plot, percent recovery chart, linearity summary, and a CLIA pass/fail verdict. OLS regression is used because calibrator assigned values are treated as exact. Other evaluation tools and software may use different regression methods by default — minor slope differences between tools are expected and do not affect pass/fail evaluation."
            when={[
              "Every 6 months (required by CLIA for all non-waived tests)",
              "Whenever calibration is performed",
              "After a major instrument repair or component replacement",
              "When switching to a new reagent lot (manufacturer-dependent)",
              "Any time there is reason to doubt instrument accuracy",
            ]}
            frequency="Every 6 months minimum"
            regulation="42 CFR §493.931"
            passFail="All measured results must fall within the CLIA Total Allowable Error (TEa) for that analyte. VeritaCheck evaluates each level individually and reports the percentage of results passing. A PASS requires 100% of results within TEa."
            refs={[
              REFS.cliaCalVerBrochure,
              REFS.cfr493931,
              REFS.clsiEP6,
              REFS.qso2025,
            ]}
            ctaStudyType="cal_ver"
          />

          <StudyCard
            icon={<Activity size={22} className="text-white" />}
            color="bg-[#2563eb]"
            badge="New Method / Instrument"
            title="Correlation / Method Comparison"
            subtitle="Confirm two methods or instruments agree before reporting patient results"
            what="A method comparison study determines whether two measurement procedures (or two instruments running the same assay) produce equivalent results on the same patient samples. It is required any time a laboratory introduces a new test method, adds an instrument, or begins reporting results from a second analyzer."
            howIt="You run a set of patient or split samples on both the reference method and the test method simultaneously. VeritaCheck performs Deming regression, OLS regression with 95% confidence intervals, Bland-Altman analysis, and calculates bias at each concentration level. The report includes correlation and Bland-Altman plots, regression statistics, and a level-by-level pass/fail table. Deming regression is used because both methods carry measurement error. Other evaluation tools and software may use different regression methods by default — minor slope differences between tools are expected and do not affect pass/fail evaluation."
            when={[
              "Before putting a new instrument or analyzer into service",
              "When introducing a new test method or reagent system",
              "When splitting work between two analyzers running the same test",
              "When resuming testing after an extended instrument downtime",
              "Annually for instruments running the same assay (best practice)",
            ]}
            frequency="At method introduction; annually recommended"
            regulation="42 CFR §493.933"
            passFail="Each paired result is evaluated against the CLIA TEa for that analyte. VeritaCheck also evaluates mean % bias from Bland-Altman analysis. A PASS requires the majority of paired results within TEa and mean bias within acceptable limits. Your laboratory director makes the final acceptability determination."
            refs={[
              REFS.cliaVerificationBrochure,
              REFS.cfr493933,
              REFS.clsiEP9,
              REFS.clsiOverview,
            ]}
            ctaStudyType="method_comparison"
          />

          <StudyCard
            icon={<FlaskConical size={22} className="text-white" />}
            color="bg-[#7c3aed]"
            badge="New Method Verification"
            title="Precision Verification (EP15)"
            subtitle="Confirm your instrument is producing reproducible, consistent results"
            what="Precision verification measures how consistently an instrument produces the same result when the same sample is tested multiple times. Imprecision (variability) is expressed as a standard deviation (SD) or coefficient of variation (CV%). CLIA requires laboratories to verify that their instruments meet the manufacturer's stated precision claims before reporting patient results."
            howIt="You run control materials repeatedly — typically 20 times over multiple days or runs — and VeritaCheck calculates the mean, SD, and CV for each control level. In Advanced (EP15 ANOVA) mode, within-run, between-run, between-day, and total imprecision are separated using analysis of variance, exactly per CLSI EP15-A3. Results are compared to your CLIA allowable imprecision (CV%) for each analyte."
            when={[
              "Before introducing any new test method into service (CLIA required)",
              "After a major instrument repair or component replacement",
              "When reagent lot changes cause QC shifts or trends",
              "Annually as part of method performance review (best practice)",
              "Any time imprecision is suspected based on QC patterns",
            ]}
            frequency="At method introduction; after major maintenance"
            regulation="42 CFR §493.941"
            passFail="Each control level must have a CV% at or below your CLIA allowable imprecision for that analyte. In Advanced mode, total imprecision CV is compared to the limit. VeritaCheck reports pass/fail per level. Your laboratory director reviews and approves all precision data before the method enters clinical use. Note: some commercial tools evaluate precision against manufacturer-claimed imprecision rather than directly against CLIA TEa — VeritaCheck uses CLIA TEa directly, which is the more conservative and regulatory-defensible standard."
            refs={[
              REFS.cliaVerificationBrochure,
              REFS.cfr493941,
              REFS.clsiEP15,
              REFS.clsiOverview,
            ]}
            ctaStudyType="precision"
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
          <p className="text-muted-foreground mb-6">VeritaCheck automates all three study types — no desktop software, no spreadsheets. Generate a CLIA-compliant PDF report in minutes.</p>
          <Link href="/veritacheck" className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-3 rounded-lg font-semibold text-sm transition-colors">
            <FlaskConical size={16} />
            Open VeritaCheck
          </Link>
        </div>
      </section>
    </div>
  );
}
