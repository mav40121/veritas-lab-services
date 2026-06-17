import { useSEO } from "@/hooks/useSEO";
import { EP26_ARTICLE_FAQ } from "@/lib/faqContent";
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

export default function ArticleEP26Page() {
  useSEO({
    title: "CLSI EP26 Reagent Lot Verification: Protocol and How-To Guide",
    description: "How clinical laboratories verify a new reagent lot under CLSI EP26 (2nd edition, 2022). The protocol, sample requirements, acceptance criteria, and documentation for lot-to-lot verification.",
  });
  return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Regulatory Compliance</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Regulatory Compliance</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            CLSI EP26 Reagent Lot Verification: A Working Protocol for Clinical Laboratories
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            Every new reagent lot can shift your results before a single control flags it. CLIA requires you to catch that shift before you report patient results. Here is what CLSI EP26 (2nd Edition) actually asks for, how to run it, and where laboratories get the sample count and acceptance criterion wrong.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground border-t border-border pt-4">
            <span className="flex items-center gap-1.5"><User size={12} /> Michael Veri, Former Joint Commission Surveyor, CPHQ</span>
            <span className="flex items-center gap-1.5"><Clock size={12} /> 9 min read</span>
            <span>June 2026</span>
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
                "Reagent lot verification confirms a new lot agrees with the current lot on patient samples, before you report from it",
                "CLIA requires the verification and documented acceptance criteria, but does not set a sample count",
                "The medical director or designee owns the sample count and the acceptance criterion",
                "Most laboratories anchor the acceptance criterion to total allowable error (TEa), a practical way to set the acceptable-difference limit EP26 calls for",
                "It is event-driven: you verify every new lot, before patient reporting, not on a calendar",
              ].map(t => (
                <li key={t} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 size={13} className="text-primary shrink-0 mt-0.5" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-[15px] leading-relaxed">

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What is reagent lot-to-lot verification?</h2>
          <p>
            <strong>Reagent lot-to-lot verification is the study that confirms a new reagent lot produces results that agree with the lot it replaces, on real patient samples, before you use it to report patient results.</strong>
          </p>
          <p>
            A new lot is a manufacturing change. Recalibration, a slightly different antibody, a new buffer, any of these can move your results enough to matter clinically while still passing your daily controls, because controls are a different matrix at a fixed concentration. The patient-safety rationale is direct: a lot-induced shift that goes undetected is reported on every patient until someone notices. CLIA requires laboratories to verify the new lot performs acceptably and to define and document the acceptance criteria (<a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">42 CFR §493.1253(b)(3) and §493.1255</a>). The regulation requires the act and the documented criteria; it leaves the protocol to the laboratory.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What is CLSI EP26?</h2>
          <p>
            CLSI EP26, 2nd Edition (<em>User Evaluation of Acceptability of a Reagent Lot Change</em>, 2022) is the consensus guideline that describes how to evaluate whether a new reagent lot differs meaningfully from the current one. It replaced the 2013 first edition, which carried the older title <em>User Evaluation of Between-Reagent Lot Variation</em>. Its core design is to test patient samples on both the current lot and the new lot and to judge the difference against a clinically meaningful limit. The guideline deliberately balances reliably detecting a change that matters against the resource cost of a task laboratories perform constantly.
          </p>
          <Callout type="info">
            <strong>How the protocol is structured:</strong> EP26 works in two stages. First you decide the medically acceptable difference and the acceptable risk for each analyte, then you evaluate the new lot against that criterion. Many laboratories anchor the acceptable difference to total allowable error (TEa), a published, defensible yardstick. This guide describes that TEa-anchored approach, which is what VeritaCheck™ implements.
          </Callout>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">When you must verify a new reagent lot</h2>
          <p>
            The trigger is the event, not the calendar: any time a new reagent lot enters service for patient testing, before results from that lot are reported. This is different from calibration verification, which is triggered initially and then on a recurring schedule. The two often travel together (a new lot may prompt recalibration), but they answer different questions. Calibration verification asks whether your results are correct against known values; lot verification asks whether changing the lot moved your results.
          </p>
          <p>
            For the accuracy side of that pair, see our guide to{" "}
            <Link href="/resources/clia-calibration-verification-method-comparison" className="text-primary font-medium hover:underline">CLIA calibration verification and method comparison <ChevronRight size={13} className="inline" /></Link>.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">The EP26 protocol, step by step</h2>
          <ol className="list-decimal list-inside space-y-2 pl-2">
            <li><strong>Select patient samples.</strong> Choose samples that span the analytical measuring range, including values near medical decision points. The number is the medical director or designee's call; in practice many laboratories set a minimum around 20 and use more for higher-stakes analytes.</li>
            <li><strong>Run each sample on both lots.</strong> Test every selected sample on the current reagent lot and the new lot in the same run, under the same conditions, to isolate the lot as the only variable.</li>
            <li><strong>Calculate the per-specimen difference.</strong> For each sample, compute the percent difference between the new lot result and the current lot result.</li>
            <li><strong>Compare against the acceptance criterion.</strong> Evaluate the differences against your pre-defined, TEa-anchored limit (see the next section).</li>
            <li><strong>Accept or investigate.</strong> If the lot meets the criterion, accept it. If it does not, treat it as an investigation rather than an automatic rejection.</li>
            <li><strong>Document and sign off.</strong> Record the data, the criterion, the determination, and the medical director or designee approval.</li>
          </ol>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Setting the acceptance criterion</h2>
          <p>
            Anchor the criterion to the analyte's total allowable error. A common, defensible rule is to accept the new lot when the mean absolute percent difference between lots is within TEa and at least 90 percent of paired patient specimens are within TEa. TEa gives you a federally published, clinically grounded yardstick rather than an unwritten internal threshold, which is far easier to defend to a surveyor.
          </p>
          <p>
            Where do you get TEa for your analyte? See{" "}
            <Link href="/resources/clia-tea-what-lab-directors-dont-know" className="text-primary font-medium hover:underline">CLIA total allowable error: what most lab directors don't know <ChevronRight size={13} className="inline" /></Link>.
          </p>
          <Callout type="tip">
            <strong>The director owns the number.</strong> Neither EP26 nor CLIA sets the sample count or the exact criterion. Both are the medical director or designee's documented decision, scaled to how much risk the analyte carries.
          </Callout>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What to do when a lot fails verification</h2>
          <p>
            A failed verification is the start of an investigation, not a verdict. Reasonable next steps include confirming the sample integrity and data entry, repeating or expanding the study with additional samples, and checking for an assignable cause such as a calibration shift, a control problem, or a sample issue. The final determination, including whether the lot can be placed into service, rests with the laboratory director or designee.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Documentation surveyors expect</h2>
          <p>A defensible lot-verification record includes:</p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li>The analyte, instrument, and the old and new lot numbers</li>
            <li>The patient samples used and their paired results on both lots</li>
            <li>The acceptance criterion and its TEa basis, defined before the study</li>
            <li>The calculated differences and the pass or investigate outcome</li>
            <li>The medical director or designee review and sign-off, with date</li>
          </ul>

          {/* VeritaCheck CTA */}
          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 my-8">
            <div className="flex items-start gap-3">
              <FlaskConical size={20} className="text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">How VeritaCheck™ automates EP26</div>
                <p className="text-sm text-muted-foreground mb-3">
                  VeritaCheck™ runs Reagent Lot Verification as a study type. Enter the paired patient results, and it computes the per-specimen differences, applies the TEa-anchored criterion, and generates a signed, CLIA-compliant PDF with the regulatory citation. No spreadsheets, no manual math. Your first study is free.
                </p>
                <Button asChild size="sm" className="bg-primary text-primary-foreground">
                  <Link href="/veritacheck">Run a Free Study <ChevronRight size={13} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          </div>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Frequently Asked Questions</h2>

          {EP26_ARTICLE_FAQ.map(({ q, a }) => (
            <div key={q} className="border-b border-border py-5 last:border-0">
              <h3 className="font-semibold text-base mb-2">{q}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
            </div>
          ))}

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Conclusion</h2>
          <p>
            Reagent lot verification is a small study with a large failure mode: a lot shift that slips past daily QC and rides out on patient results. EP26 gives you the design, CLIA gives you the obligation, and TEa gives you a defensible line. Set the sample count and the criterion deliberately, document them before you start, and let the medical director or designee own the determination. Done that way, lot verification is a routine, survey-ready part of your quality program rather than a scramble at the bench.
          </p>

          {/* Newsletter */}
          <NewsletterSignup variant="inline" source="article-ep26" />

          {/* Final CTA */}
          <div className="rounded-xl bg-primary text-primary-foreground p-7 mt-10 text-center">
            <FlaskConical size={28} className="mx-auto mb-3 opacity-80" />
            <h3 className="font-serif text-xl font-bold mb-2">Verify your next reagent lot in minutes</h3>
            <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
              VeritaCheck™ runs Reagent Lot Verification alongside calibration verification, method comparison, and EP15 precision, with automated CLIA TEa lookup and a signed PDF report.
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
              <li>Clinical and Laboratory Standards Institute. (2022). EP26, 2nd Edition: User Evaluation of Acceptability of a Reagent Lot Change. <a href="https://clsi.org/shop/standards/ep26/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">clsi.org</a></li>
              <li>Code of Federal Regulations. (2024). Title 42, Part 493: Laboratory Requirements, §493.1253 and §493.1255. <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ecfr.gov</a></li>
              <li>Loh TP, et al. (2020). Recommendations for laboratory informatics specifications needed for the application of patient-based real-time quality control. Clinica Chimica Acta.</li>
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
                Michael Veri is a US Army veteran with 22 years of military leadership, former Joint Commission Laboratory Surveyor with 200+ facility inspections, and CPHQ-certified healthcare quality professional. He founded Veritas Lab Services to provide expert consulting and accessible compliance tools to clinical laboratories nationwide, and is the developer of VeritaCheck™, VeritaScan™, and VeritaMap™.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
