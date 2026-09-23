import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";

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

function IntLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="text-primary hover:underline">{children}</Link>;
}

function CmsLink({ href, label }: { href: string; label: string }) {
  return (
    <span className="block mt-2 text-sm">
      Read it on CMS:{" "}
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-medium">
        {label}
      </a>
    </span>
  );
}

export default function ArticleCliaBrochuresPage() {
  useSEO({
    title: "The CLIA Brochures Every Lab Leader Should Read, and What Each One Is Really Telling You",
    description:
      "A former Joint Commission surveyor's guide to the free CMS CLIA brochures, what each covers, the requirement behind it, and why it matters, from proficiency testing and personnel competency to calibration verification and IQCP.",
  });
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Inspection Readiness</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Inspection Readiness</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            The CLIA Brochures Every Lab Leader Should Read, and What Each One Is Really Telling You
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            CMS publishes a small library of free CLIA brochures that state each requirement in plain language. Here is what the ones
            that matter most actually tell you, and why a former surveyor would put each on your list.
          </p>
          <div className="mt-4 text-xs text-muted-foreground">By Michael Veri, MS, MBA, MLS(ASCP), CPHQ · 5 min read · September 2026</div>
        </div>
      </section>

      {/* Body */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          {/* Lede */}
          <div className="prose-styles space-y-4 text-[15px] leading-relaxed mb-10">
            <p>
              Most of the deficiencies I wrote as a Joint Commission surveyor did not come from laboratories that did not care. They
              came from laboratories where a requirement had simply never been stated plainly to the person responsible for meeting it.
              CMS publishes a small library of free CLIA brochures that do exactly that, state the requirement in plain language for the
              audience that needs it, and almost no lab leader has read them. They are short, they are written by the people who wrote
              the rule, and they cost nothing. Reading them once is one of the highest-value hours a laboratory leader can spend. Here
              is what the ones that matter most actually tell you, and why I would put each on your list. Every one of them is on the
              CMS CLIA resources page, linked at the end.
            </p>
          </div>

          {/* Table of contents */}
          <Card className="mb-10">
            <CardContent className="p-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">The brochures</div>
              <TocLink href="#verification">1. Verification of Performance Specifications</TocLink>
              <TocLink href="#calibration">2. Calibration and Calibration Verification</TocLink>
              <TocLink href="#proficiency">3. Proficiency Testing and PT Referral</TocLink>
              <TocLink href="#competency">4. Assessing Personnel Competency</TocLink>
              <TocLink href="#director">5. Laboratory Director Responsibilities</TocLink>
              <TocLink href="#iqcp">6. Developing an Individualized Quality Control Plan</TocLink>
              <TocLink href="#complaints">7. Laboratory Complaints</TocLink>
              <TocLink href="#certification">8. CLIA Certification</TocLink>
              <TocLink href="#how-to-read">How to read them</TocLink>
            </CardContent>
          </Card>

          <Section id="verification" title="Verification of Performance Specifications">
            <p>
              This is the brochure that explains what you owe before you report a single patient result on a new test. Under CLIA, a
              laboratory that brings up an unmodified, FDA-cleared method must verify, before patient testing, that it can reproduce the
              manufacturer's claims for accuracy, precision, and reportable range, and that the reference intervals it will use are
              appropriate for its patients (42 CFR 493.1253). The brochure matters because verification is one of the most misunderstood
              words in the regulation. Laboratories confuse it with the far larger burden of establishing performance from scratch,
              decide that is impractical, and skip it, when the required study is modest and the failure to do it is one of the more
              serious findings a surveyor can write. If you read one brochure, read this one. We go deeper on the reference-interval
              piece in our own guide to <IntLink href="/resources/verifying-reference-intervals">verifying reference intervals</IntLink>.
              <CmsLink href="https://www.cms.gov/regulations-and-guidance/legislation/clia/downloads/6064bk.pdf" label="Verification of Performance Specifications" />
            </p>
          </Section>

          <Section id="calibration" title="Calibration and Calibration Verification">
            <p>
              Calibration verification is the step that confirms your instrument is still reporting accurately across its full reportable
              range, not just at the level your daily controls happen to sit. The brochure lays out when it is required, at least every
              six months, and also after a complete change of reagents, after major maintenance or repair, and when controls begin to
              reflect an unusual trend (42 CFR 493.1255), and it clears up the common confusion between calibration, calibration
              verification, and the analytical measurement range. The failure I saw most often was not skipping it entirely, it was
              running it at two levels when the method needed the full span, so the high and low ends of the reportable range were never
              actually confirmed. Our{" "}
              <IntLink href="/resources/calibration-verification-requirements-clia">calibration-verification article</IntLink>{" "}
              walks the mechanics if you want the working version.
              <CmsLink href="https://www.cms.gov/files/document/clia-brochure-calibration-and-calibration-verification-april-2006.pdf" label="Calibration and Calibration Verification" />
            </p>
          </Section>

          <Section id="proficiency" title="Proficiency Testing and PT Referral">
            <p>
              This is the brochure with the highest stakes, and the one whose rules are most often misunderstood. It explains how PT must
              be handled, tested within the routine workflow like a patient sample, by the staff who normally do the testing, and it
              spells out the bright line: a laboratory may not refer a PT sample to another laboratory, or report results obtained from
              another laboratory, before the event close date (42 CFR 493.801(b)(5)). The consequences are serious. A repeat referral, or
              reporting another laboratory's results, can revoke the certificate for at least a year and bar the owner and operator from
              owning or operating a CLIA laboratory; other improper referrals draw a civil money penalty, a directed plan of correction,
              and required staff retraining (42 CFR 493.1840). Read this one closely, and read it with your whole team, because the people
              most likely to make this mistake are the well-meaning technologists who just wanted to confirm a result. Our{" "}
              <IntLink href="/resources/proficiency-testing-clia-pt-referral">proficiency testing article</IntLink>{" "}
              covers the referral trap in depth.
              <CmsLink href="https://www.cms.gov/files/document/clia-brochure-proficiency-testing-and-pt-referral-october-2024.pdf" label="Proficiency Testing and PT Referral" />
            </p>
          </Section>

          <Section id="competency" title="Assessing Personnel Competency">
            <p>
              This is the brochure I wish every laboratory director kept on the wall. It lays out the six procedures CLIA requires for
              assessing competency (42 CFR 493.1235), direct observation of test performance, monitoring of the recording and reporting
              of results, review of quality control and records, direct observation of maintenance and function checks, assessment of
              test performance through blind or previously analyzed samples, and assessment of problem-solving skills, and it makes clear
              that all six apply where relevant, not the convenient two. Most competency programs I reviewed documented the two elements
              you can satisfy from paperwork and quietly skipped the four that require watching the work. This brochure is the
              plain-language answer to the question are we doing competency right, and for most laboratories the honest answer is not yet.
              <CmsLink href="https://www.cms.gov/regulations-and-guidance/legislation/clia/downloads/clia_compbrochure_508.pdf" label="Assessing Personnel Competency" />
            </p>
          </Section>

          <Section id="director" title="Laboratory Director Responsibilities">
            <p>
              The director is accountable for everything on the certificate, and this brochure is the plain list of what everything
              means: ensuring the physical and environmental conditions are adequate, employing qualified personnel, ensuring the
              laboratory reports accurate results, and ensuring a quality assessment program is in place, among others. It matters because
              a large share of director responsibilities are delegable in practice but never delegable in accountability, and directors
              who have never read this list are often surprised, during a survey, by how much the regulation places squarely on them. If
              you direct a laboratory, or you are the medical director of record for one, this brochure tells you what you signed up for.
              <CmsLink href="https://www.cms.gov/regulations-and-guidance/legislation/clia/downloads/brochure7.pdf" label="Laboratory Director Responsibilities" />
            </p>
          </Section>

          <Section id="iqcp" title="Developing an Individualized Quality Control Plan">
            <p>
              For laboratories that want to tailor quality control to their actual risk rather than default to two levels a day, the IQCP
              is the pathway CLIA provides, and the step-by-step workbook is the clearest walk-through of how to build one: a risk
              assessment across the whole testing process, a quality control plan that addresses the risks you found, and an ongoing
              quality assessment that proves the plan works. The brochure matters because IQCP is widely misunderstood as a way to do
              less quality control, when it is really a way to do defensible quality control. A plan built without a genuine risk
              assessment is the version that fails a survey.
              <CmsLink href="https://www.cms.gov/regulations-and-guidance/legislation/CLIA/Downloads/IQCP-workbook.pdf" label="Developing an IQCP: A Step-By-Step Guide" />
            </p>
          </Section>

          <Section id="complaints" title="Laboratory Complaints">
            <p>
              This is the shortest brochure and the one leaders overlook, because no one believes the complaint process applies to a
              well-run lab. It explains how CLIA complaints are filed and handled, and reading it is less about the process than about the
              mindset: a single credible complaint can trigger a survey, and the laboratories that handle complaints well internally,
              documenting them, investigating them, and closing the loop, are the ones that rarely see an external one. Knowing how the
              outside process works is the best argument for building the inside one.
              <CmsLink href="https://www.cms.gov/regulations-and-guidance/legislation/clia/downloads/cliabrochure9.pdf" label="Laboratory Complaints" />
            </p>
          </Section>

          <Section id="certification" title="CLIA Certification">
            <p>
              The certification brochure is the practical one, how to obtain and maintain the right certificate for the testing you
              actually perform, whether that is a certificate of waiver, provider-performed microscopy, compliance, or accreditation. It
              matters most at two moments: when a laboratory adds testing that exceeds the complexity its certificate covers, and when it
              lets a certificate lapse or mismatches its certificate type to its menu. Both are avoidable, and both are common. If your
              test menu has changed in the last year and no one has looked at your certificate since, this brochure is your prompt to
              check.
              <CmsLink href="https://www.cms.gov/regulations-and-guidance/legislation/clia/downloads/howobtaincliacertificate.pdf" label="CLIA Certification" />
            </p>
          </Section>

          <Section id="how-to-read" title="How to read them">
            <p>
              Read them in the order your next survey would care about. Start with Verification of Performance Specifications and
              Assessing Personnel Competency, the two areas where I saw the most serious and the most avoidable findings. Then Proficiency
              Testing, because the stakes are the highest. Then Calibration Verification and the IQCP workbook for the quality-control
              core, and Laboratory Director Responsibilities to see the whole picture from the seat that is accountable for it. None of
              them will take more than a coffee break, and together they are a better survey-readiness primer than most of the paid
              training I have seen. Every brochure above is also on the{" "}
              <a href="https://www.cms.gov/medicare/health-safety-standards/clinical-laboratory-improvement-amendments-clia/resources-support" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">CMS CLIA resources page</a>.
            </p>
          </Section>

          {/* Bottom CTA */}
          <Card className="mt-12 border-primary/20 bg-primary/5">
            <CardContent className="p-6 sm:p-8 text-center">
              <h3 className="font-serif text-xl font-semibold mb-2">The brochures tell you the requirement. We help you pass.</h3>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto mb-4">
                A mock inspection by a former Joint Commission laboratory surveyor walks your laboratory the way a real survey would,
                against these exact requirements, and shows you where the plain-language rule and your actual practice have drifted apart.
                Our resource library takes the same education-first approach on the topics laboratories ask about most.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button asChild className="bg-primary hover:bg-primary/90">
                  <Link href="/readiness">Book a mock inspection <ChevronRight size={14} className="ml-1" /></Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/resources">Browse the resource library</Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground italic mt-8 leading-relaxed">
            Michael Veri, MS, MBA, MLS(ASCP), CPHQ, is the founder of Veritas Lab Services and a former Joint Commission laboratory
            surveyor with more than 200 facility inspections. He is the author of Lab Management 101: A Guide to Laboratory Leadership.
            This guide points to the CMS CLIA brochures and summarizes them; it does not replace them.
          </p>
        </div>
      </section>
    </div>
  );
}
