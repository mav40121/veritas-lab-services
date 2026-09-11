import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, FlaskConical, AlertTriangle } from "lucide-react";

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

export default function ArticlePostAnalyticalPage() {
  useSEO({
    title: "Critical Values and Corrected Reports: The Post-Analytical Last Mile",
    description:
      "A former Joint Commission surveyor on the post-analytical last mile: the critical value list your medical staff must own, read-back that confirms delivery, and the corrected-report call CLIA requires under 42 CFR 493.1291(k).",
  });
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Post-Analytical</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Post-Analytical Safety</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            The Last Mile: Why a Correct Result Still Reaches the Patient Wrong
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            The critical value list your medical staff must own, the read-back that confirms delivery, the corrected report
            that has to reach the clinician, and the autoverification rules quietly releasing results no one reads.
          </p>
          <div className="mt-4 text-xs text-muted-foreground">By Michael Veri, MS, MBA, MLS(ASCP), CPHQ · 9 min read · September 2026</div>
        </div>
      </section>

      {/* Body */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          {/* Lede */}
          <div className="prose-styles space-y-4 text-[15px] leading-relaxed mb-10">
            <p>
              A laboratory measures its success by the accuracy of the number. A patient experiences it as whether the right
              clinician acted on the right number in time. Those are not the same thing, and the distance between them is where
              a surprising amount of harm lives. The result was correct. The critical value was called, to a unit clerk who
              never passed it along. The corrected report replaced the wrong one in the chart ninety minutes after the wrong one
              had already been treated. The average callback took twelve minutes, and the one that mattered took thirty-eight.
              In every case the laboratory did its job analytically and the patient was harmed anyway. This is the post-analytical
              last mile, and it is the least-watched phase in most laboratories, because it happens after the part the lab controls.
            </p>
          </div>

          {/* Table of contents */}
          <Card className="mb-10">
            <CardContent className="p-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Contents</div>
              <TocLink href="#critical-value-list">1. The critical value list nobody chose</TocLink>
              <TocLink href="#call-not-received">2. The call that was made but not received</TocLink>
              <TocLink href="#correction-not-care">3. The correction that never reached the care</TocLink>
              <TocLink href="#autoverification">4. The result that left without a human</TocLink>
              <TocLink href="#why-broken">5. Why the last mile stays broken</TocLink>
            </CardContent>
          </Card>

          <Section id="critical-value-list" title="The critical value list nobody chose">
            <p>
              Start with the list itself, because a perfect callback rate on the wrong list is not safety. A critical value list
              is a medical decision, not a laboratory decision. The thresholds define what clinicians drop everything for, which
              means they belong to your medical staff and should be set and reviewed with them, not inherited and copied forward
              through two LIS migrations until no one can say who chose the potassium critical of 6.0. A list nobody revisits
              drifts two ways at once. It over-calls values the physicians have learned to ignore, training them to treat the
              phone as noise, and it under-calls the ones your patients actually need. CLIA requires the laboratory to
              immediately alert the responsible clinician to results that indicate an imminently life-threatening condition, or
              panic or alert values (42 CFR 493.1291(g)); it is your medical executive committee that must own what belongs on
              the list.
            </p>
          </Section>

          <Section id="call-not-received" title="The call that was made but not received">
            <p>
              Calling is not the same as reaching. A critical value logged as called to "the floor" is not a critical value
              delivered to someone who can act on it. The read-back exists for this reason: to confirm that a specific, licensed
              person received the specific value and repeated it correctly. And the number that matters is not your average
              notification time, it is the tail. An average callback of twelve minutes can hide the one that took thirty-eight,
              and the patient does not experience your average. Pull the slowest calls, not the mean, and ask who actually
              received them.
            </p>
          </Section>

          <Section id="correction-not-care" title="The correction that never reached the care">
            <p>
              Correcting the report and correcting the care are two different acts, and CLIA knows the difference. When an error
              in a reported result is detected, 42 CFR 493.1291(k) requires you to notify the person who ordered or used the
              result, not merely to issue an amended report.
            </p>
            <Callout type="warning">
              A critical potassium that goes out at 2.9, is acted on with replacement, and is corrected to 6.4 ninety minutes
              later when the specimen turns out to have been drawn above a running IV line and diluted, has done its damage the
              moment the first number was treated. The amended report dropping quietly into the chart changes nothing if no one
              reads it. The fix is a phone call, because the harm has already left the laboratory and is sitting at the bedside.
            </Callout>
          </Section>

          <Section id="autoverification" title="The result that left without a human">
            <p>
              Autoverification is the newest link in the last mile and the easiest to forget. Right now, in most laboratories
              that use it, results are leaving for patient charts without a person ever seeing them, released by rules that were
              written once and, in many labs, never revisited. Autoverification is a decision, not a default. Every rule, the
              ranges it passes, the flags it holds, the deltas it ignores, encodes a judgment about which results are safe to
              release unseen, and that judgment goes stale as methods, populations, and reference intervals change. A rule set
              two years ago is releasing today's results on yesterday's assumptions.
            </p>
          </Section>

          <Section id="why-broken" title="Why the last mile stays broken">
            <p>
              Every phase before this one is measured by whether the work was done well. The last mile is measured by
              documentation, whether the call was logged, whether the correction was issued, whether the rule exists, and
              documentation is a poor proxy for delivery. An internal audit confirms the call was logged. It does not confirm
              anyone received it. So the audit passes while the loop stays open, and the gap only becomes visible when a patient
              is treated on a number that was already known to be wrong.
            </p>
          </Section>

          <Section id="references" title="References">
            <p className="text-sm"><strong>42 CFR 493.1291(g).</strong> Standard: Test report. Immediate alerting of imminently life-threatening results, or panic or alert values.</p>
            <p className="text-sm"><strong>42 CFR 493.1291(k).</strong> Standard: Test report. Corrected reports and notification of the authorized person who ordered or used the result.</p>
            <p className="text-sm"><strong>42 CFR 493.1290 and 493.1299.</strong> Condition and quality assessment for postanalytic systems.</p>
          </Section>

          {/* Bottom CTA */}
          <Card className="mt-12 border-primary/20 bg-primary/5">
            <CardContent className="p-6 sm:p-8 text-center">
              <h3 className="font-serif text-xl font-semibold mb-2">Give the critical value list an owner with VeritaMap™</h3>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto mb-4">
                VeritaMap™ is where a laboratory records the critical value thresholds its medical executive committee has
                actually adopted, with the review documented, so the list stops belonging to no one. Or have a former Joint
                Commission surveyor follow a real critical value, or a real corrected report, from the analyzer to the bedside
                in a mock inspection and find where the loop breaks. Included in every VeritaAssure™ plan.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button asChild className="bg-primary hover:bg-primary/90">
                  <Link href="/veritamap">Explore VeritaMap<span aria-hidden>™</span> <ChevronRight size={14} className="ml-1" /></Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/readiness">Book a mock inspection</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground italic mt-8 leading-relaxed">
            Michael Veri, MS, MBA, MLS(ASCP), CPHQ, is the founder of Veritas Lab Services and a former Joint Commission laboratory
            surveyor with more than 200 facility inspections. He is the author of Lab Management 101: A Guide to Laboratory Leadership.
            This guide summarizes the CLIA regulations at 42 CFR 493.1291; it does not replace them.
          </p>
        </div>
      </section>
    </div>
  );
}
