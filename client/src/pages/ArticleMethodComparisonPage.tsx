import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, Clock, FlaskConical, User, AlertTriangle, ExternalLink } from "lucide-react";
import { NewsletterSignup } from "@/components/NewsletterSignup";

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

export default function ArticleMethodComparisonPage() {
    useSEO({ title: "How to Perform a Method Comparison Study for CLIA | Veritas Lab Services", description: "Step-by-step guide to performing a CLIA-compliant method comparison study, including sample requirements, statistical analysis, and acceptable bias thresholds." });
return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Method Evaluation</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Method Evaluation</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            How to Perform a Method Comparison Study in Your Clinical Laboratory
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            A method comparison study is required whenever your laboratory implements a new test method, adds a new instrument, or needs to demonstrate equivalence between two instruments running the same analyte.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground border-t border-border pt-4">
            <span className="flex items-center gap-1.5"><User size={12} /> Michael Veri, Former Joint Commission Surveyor, CPHQ</span>
            <span className="flex items-center gap-1.5"><Clock size={12} /> 10 min read</span>
            <span>April 2026</span>
          </div>
        </div>
      </section>

      {/* Article body */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">

        {/* Key Takeaways */}
        <Card className="border-primary/20 bg-primary/5 mb-10">
          <CardContent className="p-5">
            <div className="font-semibold text-sm text-primary mb-3">Key Takeaways</div>
            <ul className="space-y-2">
              {[
                "Method comparison is required when placing a new analyzer into service, adding a new reagent system, or comparing two instruments",
                "Use a minimum of 40 patient specimens spanning the full analytical measurement range",
                "Define your acceptance criteria before running the study, not after",
                "VeritaCheck™ handles regression calculations and generates an inspector-ready report automatically",
              ].map(t => (
                <li key={t} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 size={13} className="text-primary shrink-0 mt-0.5" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Prose */}
        <div className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-[15px] leading-relaxed">

          <p>
            A method comparison study, also called a Correlation study, is required whenever your laboratory implements a new test method, adds a new instrument that performs an existing test, or needs to demonstrate equivalence between two instruments running the same analyte. Done correctly, it provides documented evidence that the new method produces results comparable to your existing method across the full analytical range. Done incorrectly or incompletely, it is a finding waiting to appear on your CAP or TJC inspection report.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">When a Method Comparison Is Required</h2>
          <p>
            The primary triggers are: placing a new analyzer into service, adding a new reagent system for an existing test, and whenever two instruments in your lab perform the same test and you need to demonstrate they produce equivalent results. CLSI EP09-A3 is the reference protocol. CAP checklist items COM.30650 and COM.30700 address method comparison and correlation directly.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Specimen Requirements</h2>
          <p>
            Use a minimum of 40 patient specimens that span the full analytical measurement range for the analyte. Fresh patient samples are strongly preferred over QC materials or commercial comparators because they reflect the actual matrix your methods will encounter in routine testing. Specimens should represent the full range from low to high, not clustered around the midpoint. Collecting samples at low, mid, and high concentrations deliberately will produce more meaningful statistics.
          </p>

          <Callout type="tip">
            <strong>Best practice:</strong> Deliberately collect specimens at low, mid, and high concentrations. A dataset clustered around the midpoint will produce misleading regression statistics that do not reflect method agreement across the full range.
          </Callout>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Running the Study</h2>
          <p>
            Test each specimen on both methods as close together in time as practical, the same day or within 4 hours for analytes that are time-sensitive. Enter the paired results and calculate the regression statistics. The key outputs are: slope, y-intercept, Pearson correlation coefficient (r), and bias at clinically significant decision points. Deming regression or Passing-Bablok regression is preferred over ordinary least squares for method comparison because it accounts for error in both methods.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What Pass or Fail Means</h2>
          <p>
            There is no universal pass or fail cutoff that applies to all analytes. Your laboratory, or the instrument manufacturer, establishes the acceptable limits for slope, intercept, and bias. A slope of 1.00 and intercept of 0 would represent perfect agreement. In practice, acceptable limits are typically set at slope of 0.97 to 1.03, and bias at medical decision points within your laboratory's total allowable error specification. Document your acceptance criteria before running the study, not after.
          </p>

          <Callout type="warning">
            <strong>Common mistake:</strong> Do not define your acceptance criteria after seeing the results. Inspectors look for criteria that were established before the study was run. Retrospective criteria selection undermines the scientific validity of the study.
          </Callout>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Common Mistakes</h2>
          <p>
            The most common error is using QC materials instead of patient specimens. A second common mistake is running too few specimens or specimens that do not cover the full range, which limits the statistical conclusions you can draw. A third is not documenting the acceptance criteria in advance, which makes it difficult to defend the result during an inspection.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Documentation for Your Inspection File</h2>
          <p>
            Your method comparison record should include: the date of the study, analyst identification, a list of specimens tested with both method results, the regression statistics, a comparison to your acceptance criteria, and the pass or fail determination with reviewer signature. CAP inspectors look for the acceptance criteria to be defined, not just the statistics.
          </p>

          {/* VeritaCheck CTA */}
          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 my-8">
            <div className="flex items-start gap-3">
              <FlaskConical size={20} className="text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">VeritaCheck™ automates method comparison</div>
                <p className="text-sm text-muted-foreground mb-3">
                  VeritaCheck™ handles the regression calculations automatically and generates an inspector-ready Correlation / Method Comparison report with your CLIA number and a complete statistical summary. Your first study is free.
                </p>
                <Button asChild size="sm" className="bg-primary text-primary-foreground">
                  <Link href="/veritacheck">Run a Free Study <ChevronRight size={13} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          </div>

          <p>
            Final approval and clinical determination must be made by the laboratory director or designee.
          </p>

          {/* Newsletter */}
          <NewsletterSignup variant="inline" source="article-method-comparison" />

          {/* Final CTA */}
          <div className="rounded-xl bg-primary text-primary-foreground p-7 mt-10 text-center">
            <FlaskConical size={28} className="mx-auto mb-3 opacity-80" />
            <h3 className="font-serif text-xl font-bold mb-2">Ready to run your next study?</h3>
            <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
              VeritaCheck™ handles method comparison with Deming regression, Bland-Altman analysis, CLIA TEa evaluation, and a signed PDF report generated in minutes.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
                <Link href="/veritacheck">Run a Free Study <ChevronRight size={15} className="ml-1" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
                <Link href="/study-guide">Which study do I need? <ExternalLink size={13} className="ml-1" /></Link>
              </Button>
            </div>
          </div>

          {/* References */}
          <div className="mt-10 pt-6 border-t border-border">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">References</div>
            <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
              <li>CLSI EP09-A3. (2018). Measurement Procedure Comparison and Bias Estimation Using Patient Samples. <a href="https://clsi.org/standards/products/method-evaluation/documents/ep09/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">clsi.org</a></li>
              <li>College of American Pathologists. (2024). COM.30650, COM.30700 - Method Comparison and Correlation. CAP Accreditation Checklists.</li>
              <li>Code of Federal Regulations. (2024). Title 42, Part 493: Laboratory Requirements. <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ecfr.gov</a></li>
            </ol>
          </div>

          {/* Author bio */}
          <div className="mt-8 pt-6 border-t border-border flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User size={20} className="text-primary" />
            </div>
            <div>
              <div className="font-semibold text-sm">Michael Veri</div>
              <div className="text-xs text-muted-foreground mb-1">Owner, Veritas Lab Services, LLC · Former Joint Commission Laboratory Surveyor · CPHQ</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Michael Veri is a US Army veteran with 22 years of military leadership, former Joint Commission Laboratory Surveyor with 200+ facility inspections, and CPHQ-certified healthcare quality professional. He founded Veritas Lab Services to provide expert consulting and accessible compliance tools to clinical laboratories nationwide.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
