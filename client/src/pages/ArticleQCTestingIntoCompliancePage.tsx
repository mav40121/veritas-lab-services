import { useSEO } from "@/hooks/useSEO";
import { QC_ARTICLE_FAQ } from "@/lib/faqContent";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, FlaskConical, AlertTriangle, User, ExternalLink } from "lucide-react";
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

export default function ArticleQCTestingIntoCompliancePage() {
  useSEO({
    title: "Out-of-Range QC: Investigate, Don't Repeat Into Compliance",
    description:
      "What to do when a control is out of range: investigate for an assignable cause, document the corrective action, and why repeating a control until it passes is testing into compliance. From a former laboratory surveyor.",
  });
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Quality Control</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Quality Control</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            When Quality Control Stops Working: The Out-of-Range Result You Are Supposed to Investigate
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            A perfect quality control chart is not the goal. Here is what an out-of-range control is really telling you,
            the two ways laboratories quietly silence it, and how a former surveyor reads the record behind the chart.
          </p>
        </div>
      </section>

      {/* Body */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          {/* Key takeaways */}
          <Card className="mb-10 border-primary/20 bg-primary/5">
            <CardContent className="p-5">
              <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-3">Key takeaways</div>
              <ul className="space-y-2 text-sm leading-relaxed list-disc pl-5">
                <li>A control is a sensor, not a hurdle. An out-of-range result is information the laboratory asked for.</li>
                <li>Repeating a control until it passes, with no documented investigation, is testing into compliance. United States v. Barr Laboratories settled that line in 1993.</li>
                <li>Set control limits from your own instrument's mean and standard deviation, never the package insert range. CLSI C24 is explicit on this.</li>
                <li>Match the quality control to each method's sigma. One rule set across the menu over-controls strong methods and under-controls weak ones.</li>
                <li>Under CLIA, hold patient results until controls pass (42 CFR §493.1256) and document the corrective action (42 CFR §493.1282). The record, not the clean chart, protects the laboratory.</li>
              </ul>
            </CardContent>
          </Card>

          {/* Table of contents */}
          <Card className="mb-10">
            <CardContent className="p-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Contents</div>
              <TocLink href="#what">What an out-of-range control actually is</TocLink>
              <TocLink href="#first">The first failure: repeating until it passes</TocLink>
              <TocLink href="#second">The second failure: control limits set too wide</TocLink>
              <TocLink href="#deeper">The deeper question: is your QC designed to your method</TocLink>
              <TocLink href="#surveyor">What a surveyor expects to see</TocLink>
              <TocLink href="#faq">Frequently asked questions</TocLink>
            </CardContent>
          </Card>

          {/* Opening */}
          <div className="prose-styles space-y-4 text-[15px] leading-relaxed mb-10">
            <p>
              A laboratory director once showed me two years of quality control records with real pride. Every analyte, every day,
              every level inside the limits. The Levey-Jennings charts were clean enough to frame. By every internal measure, the program
              was airtight. The problem with a chart that clean is that a true analytical system does not behave that way. Run against
              limits derived from its own performance, a method will produce occasional outliers, because that is what a normal distribution
              does over enough runs. Months of flawless charts do not mean the laboratory found a corner of the universe where statistics
              stopped applying. They mean the signal has been distorted somewhere.
            </p>
            <p>
              There are two common ways that distortion happens, and a deeper question underneath both of them. None of the three is usually
              the result of bad intent. All three quietly convert quality control from a diagnostic instrument into a reporting artifact, and a
              surveyor who understands them will treat a perfect chart as a reason to look closer, not a reason to move on.
            </p>
          </div>

          <Section id="what" title="What an out-of-range control actually is">
            <p>
              Quality control exists to answer one question before a single patient result leaves the laboratory: is the measurement system
              performing the way it did when its performance was verified. The control is not a hurdle to clear. It is a sensor. When a control
              result falls outside the laboratory's acceptability limits, the system is telling the laboratory that something may have changed,
              and the correct response is to find out what.
            </p>
            <p>
              CLIA frames this as a requirement, not a courtesy. Under 42 CFR §493.1256, the laboratory must run control procedures that monitor
              the accuracy and precision of the complete analytic process, must establish its own criteria for acceptable control performance,
              and must not report patient results from a run until the controls meet those criteria. The companion standard, 42 CFR §493.1282,
              then requires the laboratory to take and document corrective action whenever control materials fail to meet that criteria. Read
              together, the regulations do not say repeat the control until it agrees with you. They say hold the patient results, investigate,
              and correct. The distance between those two readings is where most quality control programs quietly fail.
            </p>
          </Section>

          <Section id="first" title="The first failure: repeating until it passes">
            <p>
              The most common quality control failure in clinical laboratories is also the most human. A control falls outside two standard
              deviations. The technologist, believing the first value was a fluke and the repeat will be the truth, runs it again. The repeat
              falls in range. The out-of-range result is discarded, only the repeat is recorded, and the chart stays clean. The drift the control
              was built to catch stays invisible.
            </p>
            <p>
              This is not malicious. It comes from a technologist who genuinely trusts the second number more than the first. But quality control
              is a signal, and a signal you discard until it agrees with you is not quality control at all. Some repeating is legitimate. When a
              control fails, the laboratory may rerun it as part of an investigation, because the failure itself can be caused by a degraded control
              vial, a pipetting error, or a control that was not at temperature. The line is whether an investigation happens. Repeating to
              investigate is sound practice. Repeating to produce a passing number, with no investigation and no documented cause, is the failure.
            </p>
            <p>
              The pharmaceutical industry litigated this exact line more than thirty years ago, and the principle it established applies cleanly
              to the clinical laboratory. In United States v. Barr Laboratories, 812 F. Supp. 458 (D.N.J. 1993), Judge Wolin drew the distinction
              in plain terms. A laboratory may retest as part of an investigation to find an assignable cause for an out-of-specification result.
              But once no laboratory error is found, additional retesting for the purpose of testing a product into compliance is not acceptable.
              The court was equally clear that averaging passing retests with the original failing result is not acceptable, because the average
              conceals the very variability the test exists to reveal. Swap out-of-specification for out-of-range control, and that is the QC habit
              described above. The clinical laboratory and the pharmaceutical laboratory answer to different regulations, but the principle is
              identical: a failing result is a signal that demands an investigation for assignable cause, not a number to be retested or averaged away.
            </p>
            <p>The defensible response to an out-of-control quality control result has a fixed shape:</p>
            <ol className="list-decimal pl-6 space-y-2">
              <li>Do not report patient results from the affected run.</li>
              <li>
                Investigate for an assignable cause. Work a consistent checklist: control material integrity and expiration, reagent lot and
                expiration, calibration status, instrument maintenance and function, operator technique, and environmental conditions.
              </li>
              <li>
                If an assignable cause is found and corrected, document the cause and the corrective action, then rerun controls to confirm the
                system is back in control before resuming patient testing.
              </li>
              <li>
                If no assignable cause is found, the result stands as a real signal. The laboratory cannot keep repeating until a passing value
                appears. The next steps are broader troubleshooting, recalibration, or manufacturer support, and patient results from the affected
                period may need review.
              </li>
            </ol>
            <p>
              The record that protects the laboratory is not the clean chart. It is the documented investigation behind every flagged run: the
              assignable cause, the corrective action, and the confirmation that the system was back in control before patient testing resumed.
              That is precisely what a corrective-action workflow is built to hold. In{" "}
              <Link href="/veritaassure" className="text-primary font-medium hover:underline">VeritaAssure™</Link>, a failed control can be escalated
              into a tracked VeritaResponse™ finding, so the investigation and its corrective action live in one record against a due-date clock
              rather than in a technologist's memory.
            </p>
            <p>
              There is a statistical reason the repeat reflex feels justified, and it points to the real fix. Limits set at two standard deviations
              will flag roughly one in twenty in-control results by chance alone, and across two control levels that climbs toward one in ten. A
              technologist who repeats an occasional flag is not imagining that some flags are false. Some are. The error is in resolving every flag
              the same way, by repeating until it clears, instead of by design. The durable answer is upstream: a quality control strategy whose
              rules are chosen so that genuine error is caught and chance flags stay rare, which is a property of how the rules are matched to the
              method, not of how many times a control is repeated.
            </p>
          </Section>

          <Section id="second" title="The second failure: control limits set too wide">
            <p>
              The second way a chart goes quietly false is subtler, because the technologist follows every rule correctly. The limits themselves
              are wrong. When a laboratory sets its control limits from the manufacturer's package insert range rather than from control results
              calculated on its own instrument, the limits are almost always too wide to catch anything.
            </p>
            <p>
              The insert range is broad by design. It has to encompass the variation seen across many laboratories, many instruments, and many
              reagent lots, so it is wider than the true imprecision of any single laboratory. Adopt it as your control limits and you have built a
              net with holes large enough for real shifts to swim through. A clinically significant drift can develop without ever crossing a limit
              that was set to tolerate the whole industry.
            </p>
            <p>
              The correct practice is to establish the mean and standard deviation from your own instrument, using control results gathered over a
              baseline period, and to set the limits from that. This is not only sound statistics; it is the consensus position of CLSI C24, the
              standard for statistical quality control in the medical laboratory, whose current edition is explicit that control limits should come
              from the laboratory's own observed mean and standard deviation rather than from a package insert. It is the same imprecision a method
              verification measures when a test is first brought online, which is what{" "}
              <Link href="/veritacheck" className="text-primary font-medium hover:underline">VeritaCheck™</Link> calculates from a precision study.
              Your own standard deviation is tighter than the insert range, the limits move in, and the real shifts finally have something to cross.
              A chart with no exceptions over a long stretch should prompt the question an experienced reviewer asks first: are these limits actually
              capable of detecting an error, or were they set wide enough to guarantee a clean wall.
            </p>
            <Callout type="info">
              The limit-setting statistic is the same one you establish during performance verification. For the regulatory basis of that work, see{" "}
              <Link href="/resources/calibration-verification-requirements-clia" className="text-primary font-medium hover:underline">calibration verification requirements under CLIA <ChevronRight size={13} className="inline" /></Link>,
              and for where the allowable-error target comes from, see{" "}
              <Link href="/resources/clia-tea-what-lab-directors-dont-know" className="text-primary font-medium hover:underline">CLIA total allowable error <ChevronRight size={13} className="inline" /></Link>.
            </Callout>
          </Section>

          <Section id="deeper" title="The deeper question: is your QC designed to your method">
            <p>
              Underneath both failures is a question most laboratories never ask. Is the quality control designed to the method, or is the same set
              of rules run on everything regardless of how the method performs.
            </p>
            <p>
              Methods are not equally capable. A robust, high-performing assay with a wide margin between its analytical error and the total
              allowable error needs relatively little quality control to stay safe. A marginal method, operating close to the edge of its allowable
              error, needs more. Sigma metrics put a number on this. The sigma of a method is the{" "}
              <Link href="/resources/clia-tea-what-lab-directors-dont-know" className="text-primary font-medium hover:underline">total allowable error</Link>,
              minus the bias, divided by the imprecision.
            </p>
            <p>
              A number makes the stakes concrete, as an illustration rather than a universal rule. Take an assay with a ten percent total allowable
              error. At two percent bias and two percent imprecision its sigma is four, a method that a single control rule and two levels can keep
              safe. Let the imprecision drift to three percent and the sigma falls to roughly two and a half, into the territory where one rule no
              longer protects the patient and the laboratory needs a multirule design, the Westgard rules, with more controls and tighter review.
              Same allowable error, same instrument, a completely different quality control requirement, driven entirely by how the method actually
              performs. Those three inputs, the allowable error, the bias, and the imprecision, are the same figures a verification study produces,
              the ones VeritaCheck™ derives from precision and comparison studies, which is what lets a laboratory set its quality control to the
              method rather than to the package insert.
            </p>
            <p>The relationship is direct enough to put in a table:</p>
            <div className="overflow-x-auto my-6">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-primary text-primary-foreground">
                    <th className="text-left p-2 font-semibold">Method sigma</th>
                    <th className="text-left p-2 font-semibold">What it means</th>
                    <th className="text-left p-2 font-semibold">QC that protects it</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border"><td className="p-2 font-medium align-top">6 or higher</td><td className="p-2 align-top">Wide margin to the allowable error</td><td className="p-2 align-top">A single rule, two levels, routine frequency</td></tr>
                  <tr className="border-b border-border bg-muted/30"><td className="p-2 font-medium align-top">4 to 6</td><td className="p-2 align-top">Comfortable margin</td><td className="p-2 align-top">A single rule or a light multirule, two levels</td></tr>
                  <tr className="border-b border-border"><td className="p-2 font-medium align-top">3 to 4</td><td className="p-2 align-top">Little room to spare</td><td className="p-2 align-top">A multirule, more controls per run, tighter review</td></tr>
                  <tr className="bg-muted/30"><td className="p-2 font-medium align-top">Below 3</td><td className="p-2 align-top">Not safe on QC alone</td><td className="p-2 align-top">Redesign, add controls and frequency, or replace the method</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              Designing the control rules to the measured performance of each method is the core of what CLSI C24 calls a quality control strategy,
              and its current edition devotes a full chapter to how a laboratory should recover from an out-of-control result. Running the same rules
              on every analyte ignores this. It over-controls the methods that do not need it and, far more dangerously, under-controls the methods
              that do. Designing the quality control to the method, rather than applying one rule set across the menu, is the step that separates a
              program that looks busy from a program that actually protects results. It is also the part of quality control where most laboratories
              still have room to grow.
            </p>
          </Section>

          <Section id="surveyor" title="What a surveyor expects to see">
            <p>
              A <Link href="/resources/tjc-laboratory-inspection-what-to-expect" className="text-primary hover:underline">surveyor</Link> who knows quality control does not page through a clean chart and feel reassured. The reviewer looks for the things a
              manufactured chart cannot produce. Control limits calculated from the laboratory's own data, not lifted from the insert. A documented
              investigation behind every out-of-control result, with an assignable cause and a corrective action, not a silent repeat. Evidence that
              the quality control strategy was matched to the performance of each method. And a culture in which a flagged control is treated as
              information the laboratory wanted, not an inconvenience to be cleared.
            </p>
            <p>
              The flawless chart is not the goal. A laboratory that never sees an out-of-range control is not a laboratory with perfect methods. It
              is a laboratory that has stopped listening to the one instrument designed to warn it.
            </p>
          </Section>

          <h2 id="faq" className="font-serif text-2xl font-bold mt-10 mb-3 scroll-mt-20">Frequently Asked Questions</h2>
          {QC_ARTICLE_FAQ.map(({ q, a }) => (
            <div key={q} className="border-b border-border py-5 last:border-0">
              <h3 className="font-semibold text-base mb-2">{q}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
            </div>
          ))}

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Closing</h2>
          <div className="prose-styles space-y-4 text-[15px] leading-relaxed">
            <p>
              Quality control does not lie. The control either reflects the real-time state of the measurement system or it has been engineered to
              look like it does. Repeating until a result passes, setting limits too wide to flag anything, and running the same rules on methods that
              need different ones all produce the same deceptively clean record, and all defeat the purpose. The laboratories with the most defensible
              quality control are not the ones with the cleanest charts. They are the ones that treat every out-of-range result as a question worth
              answering, and keep the documented answer.
            </p>
            <p>
              <Link href="/veritaassure" className="text-primary font-medium hover:underline">VeritaQC™</Link> evaluates daily quality control against
              the Westgard rules, charts it on Levey-Jennings, and flags out-of-control results for documented review, and can escalate a failed run
              into a VeritaResponse™ corrective-action finding, so the investigation behind a flagged run is captured rather than lost. The work of
              quality control is the same with any tool or none: the out-of-range result is a signal, and the record that protects the laboratory is
              what it did about it.
            </p>
          </div>

          {/* Newsletter */}
          <NewsletterSignup variant="inline" source="article-qc-testing-into-compliance" />

          {/* Final CTA */}
          <div className="rounded-xl bg-primary text-primary-foreground p-7 mt-10 text-center">
            <FlaskConical size={28} className="mx-auto mb-3 opacity-80" />
            <h3 className="font-serif text-xl font-bold mb-2">Keep the record behind every flagged run</h3>
            <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
              VeritaQC™ evaluates daily QC against the Westgard rules, charts Levey-Jennings, and captures the documented investigation behind every
              out-of-control result, so a flagged control becomes evidence rather than a gap.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
                <Link href="/veritaassure">Explore VeritaAssure™ <ChevronRight size={15} className="ml-1" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
                <Link href="/resources">More resources <ExternalLink size={13} className="ml-1" /></Link>
              </Button>
            </div>
          </div>

          {/* References */}
          <div className="mt-10 pt-6 border-t border-border">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">References</div>
            <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
              <li>Code of Federal Regulations. (2024). Title 42, Part 493: Laboratory Requirements, §493.1256 (Control procedures) and §493.1282 (Corrective actions). <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ecfr.gov</a></li>
              <li>United States v. Barr Laboratories, Inc., 812 F. Supp. 458 (D.N.J. 1993). <a href="https://law.justia.com/cases/federal/district-courts/FSupp/812/458/1762275/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">justia.com</a></li>
              <li>Clinical and Laboratory Standards Institute. (2016). C24, 4th Edition: Statistical Quality Control for Quantitative Measurement Procedures: Principles and Definitions. <a href="https://clsi.org/shop/standards/c24/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">clsi.org</a></li>
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
                Michael Veri is a former Joint Commission Laboratory Surveyor with 200+ facility inspections and a CPHQ-certified healthcare quality
                professional. He founded Veritas Lab Services to provide expert consulting and accessible compliance tools to clinical laboratories
                nationwide, and is the developer of VeritaCheck™, VeritaScan™, and VeritaMap™.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
