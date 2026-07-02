import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, FlaskConical, AlertTriangle } from "lucide-react";
import { PRECISION_FAQ } from "@/lib/faqContent";

function Callout({ children, type = "info" }: { children: React.ReactNode; type?: "info" | "warning" | "tip" }) {
  const styles = {
    info: "border-primary/20 bg-primary/5 text-foreground",
    warning: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-300",
    tip: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300",
  };
  const icons = {
    info: <FlaskConical size={15} className="text-primary shrink-0 mt-0.5" />,
    warning: <AlertTriangle size={15} className="text-amber-600 shrink-0 mt-0.5" />,
    tip: <CheckCircle2 size={15} className="text-emerald-600 shrink-0 mt-0.5" />,
  };
  return (
    <div className={`rounded-lg border p-4 flex gap-3 text-sm leading-relaxed my-6 ${styles[type]}`}>
      {icons[type]}
      <div>{children}</div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-10">
      <h2 className="font-serif text-2xl font-semibold mb-3 scroll-mt-20">{title}</h2>
      <div className="prose-styles space-y-4 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

function TocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="block py-1 text-sm text-muted-foreground hover:text-primary transition-colors">
      <span className="inline-flex items-center gap-1">{children}</span>
    </a>
  );
}

export default function ArticlePrecisionInterpretationPage() {
  useSEO({
    title: "Precision Verification Report Interpretation Guide | VeritaCheck",
    description: "Plain-language guide to reading a VeritaCheck precision verification report: what mean, SD, CV, 95% CI, Pass/Fail/Uncertain, and vendor SD comparisons actually mean and how they map to 42 CFR §493 and CLSI EP15-A3 requirements.",
  });
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>VeritaCheck Reports</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">VeritaCheck Reports</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            Precision Verification Report Interpretation Guide
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            How to read every field, table, and chart on a VeritaCheck precision verification report,
            and how each one maps to 42 CFR §493 and CLSI EP15-A3.
          </p>
        </div>
      </section>

      {/* Body */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          {/* Table of contents */}
          <Card className="mb-10">
            <CardContent className="p-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Contents</div>
              <TocLink href="#why">Why precision verification is required</TocLink>
              <TocLink href="#methodology">What the simple precision study does</TocLink>
              <TocLink href="#definitions">Statistical definitions</TocLink>
              <TocLink href="#advanced">Advanced (EP15) mode and ANOVA components</TocLink>
              <TocLink href="#goals">Precision verification goal modes</TocLink>
              <TocLink href="#verdict">Pass, Fail, and Uncertain</TocLink>
              <TocLink href="#report">Reading the VeritaCheck report</TocLink>
              <TocLink href="#references">References</TocLink>
            </CardContent>
          </Card>

          <Section id="why" title="Why precision verification is required">
            <p>
              Federal regulation 42 CFR §493.1253 requires every laboratory performing non-waived testing to verify the performance specifications
              of each method before reporting patient results, and to re-verify whenever a change in reagent lot, instrument, or test system could
              affect performance. Precision is one of the performance specifications a lab must verify; calibration verification, accuracy,
              reportable range, and reference intervals are the others.
            </p>
            <p>
              Accrediting bodies layer their own expectations on top of the CLIA requirement. CAP All Common and laboratory-discipline checklists
              require precision verification at intervals defined by the laboratory director. The Joint Commission references the same activity under
              its QSA standards. COLA, AABB, and CMS surveyors all expect to see documentation that precision was verified before each method was
              put into patient use and at the laboratory-defined interval thereafter.
            </p>
            <Callout type="info">
              The verification is the lab’s responsibility. The manufacturer validates the method; the lab verifies that the method performs to spec
              in its own hands, on its own instruments, with its own reagent lots, by its own staff. CLSI EP15-A3 is the procedural standard most
              labs adopt for that verification.
            </Callout>
          </Section>

          <Section id="methodology" title="What the simple precision study does">
            <p>
              In the simple precision path, the laboratory runs replicate measurements of a single quality control material at a single concentration
              level, then computes the mean, standard deviation, and coefficient of variation across all replicates. The result is an estimate of how
              tightly the instrument reproduces the same answer on the same sample under the same conditions, which the laboratory then compares
              against an acceptance criterion.
            </p>
            <p>
              The simple path is appropriate when all replicates are collected within a single run or a single day. It treats every replicate as
              drawn from the same pool, so it does not distinguish variability that comes from within a run versus variability that comes from day-to-day drift.
              When the verification needs to address both, the advanced (EP15) path is the right tool.
            </p>
            <Callout type="tip">
              The simple path satisfies the CLIA repeatability requirement for analytes that the laboratory director has decided do not need the
              fuller within-run / between-day decomposition that CLSI EP15-A3 prescribes. For an analyte where day-to-day drift is a known risk,
              run the advanced path.
            </Callout>
          </Section>

          <Section id="definitions" title="Statistical definitions">
            <p><strong>Mean.</strong> The arithmetic average of all replicate measurements. Sum of replicate values divided by the count of replicates.</p>
            <p><strong>Standard deviation (SD).</strong> A measure of how widely individual replicates spread around the mean. Computed with the n−1 (sample) formula, which is the standard for laboratory precision work. Larger SD means looser precision; smaller SD means tighter.</p>
            <p><strong>Coefficient of variation (CV).</strong> The SD expressed as a percent of the mean: CV = (SD ÷ mean) × 100. CV is the preferred precision metric when the SD scales with concentration, which is common in clinical chemistry. A CV of 5 percent means the SD is one-twentieth of the mean.</p>
            <p><strong>Bias and percent bias.</strong> When a target mean is supplied (for example, the assigned value of a control material from the package insert), bias is the observed mean minus the target mean. Percent bias expresses that difference as a fraction of the target. Bias is an accuracy metric, not a precision metric, but VeritaCheck surfaces it when a target is available because it is useful context.</p>
            <p><strong>Number of replicates (N).</strong> The count of measurements that contributed to the precision estimate. CLSI EP15-A3 recommends at least 20 replicates for within-run precision and a 5-day × 5-replicates-per-run design for the full within-laboratory precision estimate. With fewer than 20 replicates, the confidence interval around SD becomes wide enough that the precision estimate is much less trustworthy.</p>
            <p><strong>95% confidence interval for SD.</strong> A range that has a 95 percent chance of containing the true population SD given the data observed. Computed from the chi-square distribution with N−1 degrees of freedom. As N grows, the interval narrows. At N = 20 the interval is roughly 0.76 to 1.46 times the observed SD; at N = 50 it tightens to roughly 0.84 to 1.24 times.</p>
            <p><strong>95% confidence interval for mean.</strong> The same idea applied to the mean. Computed from the Student t distribution with N−1 degrees of freedom. Width depends on SD and N together.</p>
            <p><strong>Observed 2 SD range.</strong> Mean ± 2 × SD. Under a normal distribution, roughly 95 percent of individual measurements would be expected to fall inside this range. Useful as a quick reading of how far an individual patient result could swing relative to the mean of replicate runs.</p>
          </Section>

          <Section id="advanced" title="Advanced (EP15) mode and ANOVA components">
            <p>
              When the data is collected across a structured design — typically 5 days of 5 replicates each — VeritaCheck’s advanced mode uses analysis of variance to decompose the total observed variability into three components:
            </p>
            <p><strong>Within-run SD.</strong> Variability among replicates measured back-to-back in the same run, on the same day, by the same operator. This is the tightest layer.</p>
            <p><strong>Between-run SD.</strong> Variability added when multiple runs are performed within a day. Captures small drifts in calibration or environment that accumulate between runs.</p>
            <p><strong>Between-day SD.</strong> Variability added when the design spans multiple days. Captures day-to-day drift in calibration, reagent storage conditions, operator differences, and other slowly-changing factors.</p>
            <p><strong>Total SD.</strong> The square root of the sum of the three variance components. Represents the full within-laboratory precision of the method on this instrument at this analyte and concentration level.</p>
            <p>
              The ANOVA components answer different operational questions. A method with tight within-run precision but large between-day variability tells the laboratory that day-to-day calibration discipline matters more than the repeatability of any single run.
            </p>
          </Section>

          <Section id="goals" title="Precision verification goal modes">
            <p>VeritaCheck supports two complementary acceptance criteria. They can be evaluated together; the report shows whichever is populated.</p>
            <p>
              <strong>CLIA total allowable error (TEa).</strong> Federal regulation 42 CFR §493.927 through §493.959 publishes acceptance limits
              that the laboratory must satisfy on proficiency testing for each regulated analyte. Many laboratories adopt a fraction of the
              PT TEa as their precision verification acceptance criterion. A common convention, often attributed to the Association for
              Diagnostic and Laboratory Medicine (ADLM), is to use half of TEa for precision and the other half for bias. VeritaCheck
              defaults to the published PT TEa as the precision criterion and additionally surfaces the ADLM internal goal alongside it.
            </p>
            <p>
              <strong>Vendor SD.</strong> The within-run SD claim published by the instrument manufacturer in the package insert. Optional;
              supply it as an additional acceptance criterion when the laboratory wants the report to verify that the lab is performing at
              or below the manufacturer’s published claim. When set, the report surfaces a Pass / Fail / Uncertain verdict against this
              vendor goal in addition to the CLIA TEa verdict.
            </p>
            <Callout type="info">
              These criteria answer different questions. CLIA TEa asks whether the method is fit for the regulatory purpose of reporting
              patient results. The vendor SD asks whether the lab is matching the manufacturer’s claim. Both are valid; many laboratories
              evaluate against both.
            </Callout>
          </Section>

          <Section id="verdict" title="Pass, Fail, and Uncertain">
            <p>
              For the CLIA TEa criterion, the report calls the precision Pass when the observed CV is at or below the adopted percent
              criterion and (when applicable) when the SD is at or below the dual-criterion absolute floor expressed as a 2-SD envelope.
            </p>
            <p>
              For the vendor SD criterion, the report uses a three-state verdict that takes the 95 percent confidence interval around the
              observed SD into account:
            </p>
            <p>
              <strong>Pass.</strong> The upper bound of the 95 percent confidence interval for the observed SD does not exceed the vendor
              goal. The observed precision is below the goal with statistical confidence.
            </p>
            <p>
              <strong>Uncertain.</strong> The vendor goal falls inside the 95 percent confidence interval around the observed SD. The point
              estimate is below the goal, but the data does not have enough power to assert that the true SD is below the goal with
              confidence. The laboratory director may want to run additional replicates or accept the result as marginally acceptable based
              on professional judgment.
            </p>
            <p>
              <strong>Fail.</strong> The lower bound of the 95 percent confidence interval for the observed SD exceeds the vendor goal. The
              true SD is above the goal with statistical confidence.
            </p>
            <Callout type="warning">
              All three verdict labels are statistical findings, not clinical determinations. Final acceptance for patient testing requires
              review and sign-off by the laboratory director or designee.
            </Callout>
          </Section>

          <Section id="report" title="Reading the VeritaCheck report">
            <p><strong>Key Statistics Summary (page 1).</strong> Mean, SD, CV, 95% CI for both, observed 2 SD range, and overall pass / fail.
              When a vendor SD goal is supplied, an additional Vendor SD Goal / Vendor Verdict row appears, color-coded by verdict. When a
              target mean is supplied, a Target Mean / Bias row appears.</p>
            <p><strong>Study Narrative Summary.</strong> Plain-language methodology paragraph, regulatory determination citing the relevant CFR section, ADLM internal goal context, and a closing sentence reminding that final acceptance is the laboratory director's or designee's responsibility.</p>
            <p><strong>Regulatory Compliance References.</strong> Cross-references to CAP, CLSI, and 42 CFR §493 Subpart I sections that govern the verification activity. Citations only; the underlying standards are referenced by identifier and are not reproduced.</p>
            <p><strong>Laboratory Director or Designee Review.</strong> Signature block with Accepted / Not accepted checkboxes, signature line, date, print name, and title. Placed on page 1 so the regulatory determination is visible on the same page as the verdict.</p>
            <p><strong>Confidence Intervals and Distribution (page 2).</strong> Per-level table of 95% CI for SD, 95% CI for mean, observed 2 SD range, and (when populated) bias, percent bias, vendor SD goal, and vendor verdict.</p>
            <p><strong>Precision Plot.</strong> A Levey-Jennings style scatter of the standard deviation index (SDI) of each replicate against its specimen index. Reference bands at ±1, ±2, ±3 SDI. When a target mean and target SD are provided, the SDI is computed against the target rather than the observed mean.</p>
            <p><strong>Histogram.</strong> Frequency distribution of the observed values with a normal-curve overlay scaled to the modal bar. Vertical lines mark the observed mean and (when supplied) the target mean.</p>
            <p><strong>Vendor SD Verdict bar (when present).</strong> Vertical bar at the observed SD with horizontal fence whiskers at the 95 percent confidence interval bounds and a dashed goal line at the vendor SD. Color is green for Pass, amber for Uncertain, magenta-red for Fail.</p>
            <p><strong>Supporting Data and User Specifications.</strong> Study type, test name, adopted acceptance criterion, CFR reference, analyst, date, instrument, test methods, and (when populated) precision verification goal mode, within-run SD from vendor, target mean, target CV, units, control lot, reagent lot, and comment.</p>
          </Section>

          <Section id="faq" title="Frequently Asked Questions">
            {PRECISION_FAQ.map(({ q, a }) => (
              <div key={q} className="border-b border-border py-4 last:border-0">
                <h3 className="font-semibold text-base mb-2">{q}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
              </div>
            ))}
          </Section>

          <Section id="references" title="References">
            <p>
              <strong>42 CFR Part 493 Subpart I — Proficiency Testing Programs for Nonwaived Testing.</strong> Federal regulation establishing the PT acceptance criteria the laboratory must satisfy and the performance specifications it must verify before reporting patient results.
            </p>
            <p>
              <strong>42 CFR §493.1253 — Establishment and verification of performance specifications.</strong> The CFR provision requiring labs to verify accuracy, precision, reportable range, and reference intervals before patient testing.
            </p>
            <p>
              <strong>CLSI EP15-A3 — User Verification of Precision and Estimation of Bias; Approved Guideline.</strong> Published by the Clinical and Laboratory Standards Institute. The procedural standard most laboratories adopt for the verification activity, including the 5-day × 5-replicate design referenced in advanced mode.
            </p>
            <p>
              <strong>ADLM — Association for Diagnostic and Laboratory Medicine.</strong> Professional society whose published recommendations on splitting allowable total error into systematic and random error budgets inform the "ADLM internal goal" surfaced alongside the CLIA TEa in VeritaCheck narratives.
            </p>
            <p>
              Standards bodies own their respective documents; VeritaCheck references them by identifier only and does not reproduce their content.
            </p>
          </Section>

          <div className="text-xs text-muted-foreground border-t border-border pt-6">
            This guide is for VeritaCheck users and prospective customers. It is an educational summary of the precision verification activity, not a
            substitute for the underlying standards or for the laboratory director's professional judgment. © 2026 Veritas Lab Services, LLC.
          </div>
        </div>
      </section>
    </div>
  );
}
