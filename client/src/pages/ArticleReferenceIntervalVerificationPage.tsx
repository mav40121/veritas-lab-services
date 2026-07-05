import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, FlaskConical, AlertTriangle } from "lucide-react";

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

export default function ArticleReferenceIntervalVerificationPage() {
  useSEO({
    title: "How to Verify Reference Intervals Under CLIA: A Practical Guide",
    description: "CLIA requires most laboratories to verify, not establish, reference intervals. The three tiers of establish, verify, and documented review, how to define reference individuals, the CLSI EP28-A3c 20-sample verification, and re-verifying when the method changes.",
  });
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Reference Intervals</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Reference Intervals</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            Verifying Reference Intervals When You Cannot Establish Them
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            Most reference intervals were never established by the laboratory printing them. They were inherited. CLIA does not require
            most laboratories to establish reference intervals. It requires them to verify that the intervals they use are appropriate for
            their own patients, and there is a defined, achievable path to do that even for a small laboratory.
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
              <TocLink href="#claims">What a reference interval actually claims</TocLink>
              <TocLink href="#tiers">The three tiers: establish, verify, transfer</TocLink>
              <TocLink href="#individuals">Defining your reference individuals</TocLink>
              <TocLink href="#documented-review">When you cannot get twenty</TocLink>
              <TocLink href="#does-not-fit">When the interval genuinely does not fit</TocLink>
              <TocLink href="#method-change">The trigger every laboratory forgets</TocLink>
              <TocLink href="#surveyor">What a surveyor expects to see</TocLink>
              <TocLink href="#references">References</TocLink>
            </CardContent>
          </Card>

          <div className="prose-styles space-y-4 text-[15px] leading-relaxed mb-10">
            <p>
              Every clinical laboratory prints reference intervals on every report it releases, and most of those intervals were never
              established by the laboratory printing them. They came from the assay package insert, from the previous director, or from the
              instrument vendor at installation, and they have appeared beside patient results for years without anyone asking the one question
              that matters: are these intervals appropriate for the patients this laboratory actually serves. The reference interval is quietly one
              of the most consequential numbers a laboratory produces, because it is the boundary the clinician uses to decide whether a result
              is normal, and it is the number most often adopted without verification.
            </p>
            <p>
              The reason it goes unexamined is that establishing a reference interval from scratch is genuinely hard, and most laboratories cannot
              do it. The good news, which is not widely enough understood, is that CLIA does not require most laboratories to establish reference
              intervals. It requires them to verify that the intervals they use are appropriate. This article lays out what a reference interval
              actually claims, the three tiers of establishing versus verifying versus documented review, how to define your reference individuals,
              what to do when you cannot recruit enough of them, and the trigger most laboratories forget entirely.
            </p>
          </div>

          <Section id="claims" title="What a reference interval actually claims">
            <p>
              A reference interval is not a property of the assay. It is a claim about a population. When a laboratory reports a result against a
              reference interval, it is asserting that a defined group of healthy reference individuals, tested by this method, produced results
              that fell within that range. The interval that comes in the package insert is a real reference interval, but it belongs to the
              manufacturer&rsquo;s reference population, which was assembled to represent a broad, generally healthy group and is frequently skewed
              toward younger adults.
            </p>
            <p>
              The problem arrives when the laboratory&rsquo;s patients do not resemble that reference population. A laboratory serving nursing homes,
              a pediatric practice, an oncology center, or a demographically distinct community is measuring patients whose healthy baseline may
              differ from the manufacturer&rsquo;s reference group. The interval is not wrong in an analytical sense. It is wrong for those patients,
              and it will misclassify them, flagging normal patients as abnormal or, worse, letting genuinely abnormal results sit inside a range
              that was never built to catch them.
            </p>
          </Section>

          <Section id="tiers" title="The three tiers: establish, verify, transfer">
            <p>
              CLIA, under 42 CFR &sect;493.1253, lists the reference interval among the performance specifications a laboratory must verify are
              appropriate for its own patient population before reporting patient results. It does not dictate a single method. In practice there
              are three tiers, and most laboratories only need the second or third.
            </p>
            <p>
              <strong>Establishing</strong> an interval from scratch is the full study, and it is why laboratories avoid the topic. The CLSI
              guideline on reference intervals recommends a minimum of 120 qualified reference individuals per partition, meaning per sex, per
              age group, or per any other partition the analyte requires. A laboratory establishing intervals for several partitions of several
              analytes is recruiting hundreds of healthy volunteers. Very few clinical laboratories can or should do this.
            </p>
            <p>
              <strong>Verifying</strong> a manufacturer&rsquo;s or published interval is the tier most laboratories should use, and it is far more
              attainable. The laboratory tests a small group of its own reference individuals, commonly twenty, against the interval it intends to
              adopt. If no more than a small proportion, conventionally two of the twenty, fall outside the proposed interval, the interval is
              considered verified for that laboratory&rsquo;s population. Twenty reference individuals is a study a small laboratory can actually
              complete.
            </p>
            <Callout type="tip">
              If three or more of the twenty fall outside the proposed interval, the verification has not passed. The CLSI EP28-A3c procedure is
              to test a second group of twenty. If the interval fails again, the laboratory has evidence that the published interval does not fit
              its population, and the correct response is to adopt a different published interval or, occasionally, to establish its own.
            </Callout>
            <p>
              <strong>Documented review</strong>, or transference, is the tier for the laboratory that genuinely cannot recruit even twenty
              reference individuals, which is a real situation for low-volume, specialized, or newly implemented tests. This path uses no new
              reference samples. Instead the laboratory documents a defensible rationale that the interval is appropriate, and that rationale is
              the subject of a later section.
            </p>
          </Section>

          <Section id="individuals" title="Defining your reference individuals">
            <p>
              Whether verifying with twenty or establishing with more, the reference individuals are only meaningful if the laboratory defines who
              counts as one, in writing, before it begins. A list of twenty healthy adults with no definition of healthy is a dataset that looks
              rigorous and defends nothing.
            </p>
            <p>
              The definition is a set of inclusion and exclusion criteria set in advance: the age range and sex distribution appropriate to the
              analyte, a health-status screen, exclusions for relevant medications and conditions, and fasting status where the analyte requires
              it. When a surveyor asks how the reference population was constituted, the written criteria are the answer. Their strength comes from
              being explicit, not from the sample being large.
            </p>
          </Section>

          <Section id="documented-review" title="When you cannot get twenty: the documented review pathway">
            <p>
              For the low-volume or specialty test, the documented review is the whole ballgame, and it is more defensible than most laboratories
              realize. The laboratory assembles and records a rationale built on evidence it already has access to.
            </p>
            <p>
              It assesses the manufacturer&rsquo;s reference population as described in the package insert or method documentation, and asks how
              closely that population resembles the laboratory&rsquo;s own patients. It reviews the published literature and any clinical guidance
              for the analyte, which for many tests now includes reference interval data for specific populations. It confirms the analytical
              performance of the method in its own hands, because an interval is only transferable if the method reproduces the performance the
              interval assumes. And it documents the similarity, or the difference, between the reference population and the population the
              laboratory serves.
            </p>
            <Callout type="warning">
              This tier is a fallback, not a shortcut. A documented review with no reference samples is the path a surveyor scrutinizes hardest,
              and its entire strength is the quality of the written rationale. Use it only when a twenty-sample verification is genuinely out of
              reach, and make the rationale specific enough that a reviewer can follow the reasoning from source to conclusion.
            </Callout>
            <p>
              The output is a written rationale that a reviewer can read: this interval, from this source, tested by this method, is appropriate
              for our patients for these reasons. If the assessment shows the interval does not fit, that finding is not a failure of the process.
              It is the process working, and it tells the laboratory it needs a different published interval or, occasionally, its own study.
            </p>
          </Section>

          <Section id="does-not-fit" title="When the interval genuinely does not fit">
            <p>
              Sometimes the honest conclusion of a documented review is that the manufacturer&rsquo;s interval is wrong for the patients, and the
              classic example is one every laboratory should know. Benign ethnic neutropenia describes neutrophil and white cell counts that are
              normal, and lower, in many individuals of African descent, and that would be flagged as abnormal against an interval derived from a
              predominantly European reference population. A laboratory serving that population and reporting the manufacturer&rsquo;s interval will
              generate a stream of false abnormals, and the fix is not a better instrument. It is a reference interval appropriate to the
              population.
            </p>
            <p>
              The same logic applies to the geriatric laboratory, where age shifts the healthy baseline for several analytes, and to the pediatric
              laboratory, where reference intervals partition sharply by age and an adult interval is simply the wrong instrument. The similarity
              assessment in the documented review exists precisely to catch these cases before a clinician does.
            </p>
          </Section>

          <Section id="method-change" title="The trigger every laboratory forgets">
            <p>
              The reference interval is not verified once and finished. It is tied to the method that produces it, and when the method changes, the
              verification no longer holds. A new analyzer, a new platform, a significant reagent reformulation, or a change in measurement
              principle can shift where results fall, and an interval verified on the old method is not automatically valid on the new one.
            </p>
            <p>
              The laboratory that migrates instruments and carries its reference intervals forward untouched has quietly un-verified them, and it
              is one of the most common gaps a thorough inspector finds. The rule is simple: when the method changes, re-verify the interval.
            </p>
          </Section>

          <Section id="surveyor" title="What a surveyor expects to see">
            <p>
              A surveyor who understands reference intervals does not want to see a full establishment study from every laboratory, because the
              surveyor knows most laboratories cannot produce one and are not required to. The surveyor wants evidence of a defensible process:
              written inclusion and exclusion criteria for reference individuals; a verification study, or a documented review with a real
              rationale, for the intervals in use; a similarity assessment between the reference population and the laboratory&rsquo;s patients,
              especially where the two plainly differ; and evidence that the intervals were re-verified when the method changed. The laboratory
              that can produce those is in a far stronger position than the one holding only a stack of package inserts.
            </p>
            <p>
              The reference interval is inherited more often than it is verified, and that is the gap. The work of closing it is not the daunting
              120-sample study most laboratories imagine and avoid. For nearly all laboratories it is a 20-sample verification, or a documented
              review that uses evidence already in reach, anchored to reference individuals the laboratory took the time to define. The interval
              prints on every report a laboratory releases. The question is whether the laboratory can show it is the right interval for the
              patients it actually serves, or whether it can only show the box it came in.
            </p>
            <Callout type="info">
              VeritaCheck&trade; runs reference interval verification as a study type built on the CLSI approach, so the 20-sample comparison and the
              pass or fail against the proposed interval are calculated and documented in a report ready for laboratory director or designee
              sign-off. The principle holds with any tool or none: a reference interval is a claim about your patients, and the record that
              protects the laboratory is the verification behind it.
            </Callout>
          </Section>

          <Section id="references" title="References">
            <p>
              <strong>42 CFR &sect;493.1253: Establishment and verification of performance specifications.</strong> The CFR provision
              requiring laboratories to verify accuracy, precision, reportable range, and reference intervals, and to verify that the
              manufacturer&rsquo;s reference intervals are appropriate for the laboratory&rsquo;s patient population, before reporting patient
              results.
            </p>
            <p>
              <strong>CLSI EP28-A3c: Defining, Establishing, and Verifying Reference Intervals in the Clinical Laboratory.</strong>
              Published by the Clinical and Laboratory Standards Institute. The consensus guideline for the 120-sample establishment study and the
              20-sample verification procedure referenced throughout this article.
            </p>
            <p>
              Standards bodies own their respective documents. This article references them by identifier only and does not reproduce their
              content.
            </p>
          </Section>

          <div className="text-xs text-muted-foreground border-t border-border pt-6">
            This guide is an educational summary of reference interval verification, not a substitute for the underlying standards or for the
            laboratory director or designee&rsquo;s professional judgment. &copy; 2026 Veritas Lab Services, LLC.
          </div>
        </div>
      </section>
    </div>
  );
}
