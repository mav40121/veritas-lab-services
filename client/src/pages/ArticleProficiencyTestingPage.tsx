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

export default function ArticleProficiencyTestingPage() {
  useSEO({
    title: "Proficiency Testing Under CLIA: The Rules Labs Get Wrong, and the Mistake That Ends Careers",
    description:
      "A former Joint Commission surveyor on CLIA proficiency testing: what needs PT after the 2024 regulated-analyte change, how PT is graded, how to cover what PT does not, and the PT referral rule that carries the most severe consequences in CLIA.",
  });
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Proficiency Testing</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Proficiency Testing</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            Proficiency Testing Under CLIA: The Rules Labs Get Wrong, and the Mistake That Ends Careers
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            What actually needs PT after the 2024 regulated-analyte change, how PT is graded, how to cover what PT does not,
            and the referral rule that carries the most severe consequences in CLIA.
          </p>
          <div className="mt-4 text-xs text-muted-foreground">By Michael Veri, MS, MBA, MLS(ASCP), CPHQ · 14 min read · August 2026</div>
        </div>
      </section>

      {/* Body */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          {/* Lede */}
          <div className="prose-styles space-y-4 text-[15px] leading-relaxed mb-10">
            <p>
              Proficiency testing looks like the simplest thing CLIA asks of a laboratory. Three shipments a year, run the samples, report the results, get a score. That simplicity is exactly why it is one of the most misunderstood areas of the entire program, and the misunderstandings run in two directions at once. Some laboratories enroll in programs for tests that never required PT and pay for it every year. Others do not realize that one routine-looking act, handling a PT sample the way they handle every patient specimen and sending it out, can end the laboratory director's and the owner's careers.
            </p>
            <p>
              This guide goes deeper than the checklist. It is built on the CMS Proficiency Testing and PT Referral brochure and reflects the 2024 change to the regulated-analyte list. What actually needs PT now, how PT is graded, how to cover what PT does not, and the referral rule that carries the most severe consequences in CLIA.
            </p>
          </div>

          {/* Table of contents */}
          <Card className="mb-10">
            <CardContent className="p-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Contents</div>
              <TocLink href="#list-changed">1. The list changed in 2024</TocLink>
              <TocLink href="#what-pt-checks">2. What PT actually checks</TocLink>
              <TocLink href="#not-every-test">3. Not every nonwaived test needs PT</TocLink>
              <TocLink href="#coverage-trap">4. The coverage trap: primary method vs the instrument next to it</TocLink>
              <TocLink href="#enrollment">5. Enrollment rules that quietly cause findings</TocLink>
              <TocLink href="#grading">6. How PT is graded, and why a perfect run can still fail</TocLink>
              <TocLink href="#test-like-patients">7. Test PT the way you test patients, until the moment you would not</TocLink>
              <TocLink href="#referral">8. The mistake that ends careers: PT referral</TocLink>
              <TocLink href="#verify-yourself">9. When you must verify a regulated analyte yourself</TocLink>
              <TocLink href="#after-results">10. Even a passing score is not the finish line</TocLink>
              <TocLink href="#records">11. Keep the record a surveyor will actually ask for</TocLink>
              <TocLink href="#coverage-gap">12. The part that actually causes the gap: coverage</TocLink>
            </CardContent>
          </Card>

          <Section id="list-changed" title="Start here: the list changed in 2024">
            <p>
              If your understanding of which analytes require PT is more than a couple of years old, it is out of date. A CLIA final rule, effective July 11, 2024, delivered the first update to the regulated-analyte list since the program began in 1992. It added 29 regulated analytes and removed 5, and it moved most acceptable-performance limits from standard deviations to fixed percentage targets. The additions reach across chemistry, immunology, and other specialties that previously did not require proficiency testing. Analytes you correctly treated as exempt a few years ago may now be regulated. Before you trust any internal list, reconcile it against the current Subpart I list on the CMS CLIA website. This single reconciliation is the highest-value hour you will spend on PT this year.
            </p>
          </Section>

          <Section id="what-pt-checks" title="What PT actually checks">
            <p>
              An HHS-approved program sends your laboratory a set of samples on a schedule, usually three events a year, you test them, and the program grades your results against CLIA criteria. It is the closest thing CLIA has to an external audit of your bench, because it examines the whole testing process, pre-analytical through post-analytical, and it implicitly checks whether your personnel are performing. A drifting PT score is often the first visible sign of a problem that has not yet reached a patient result.
            </p>
          </Section>

          <Section id="not-every-test" title="Misunderstanding one: not every nonwaived test needs PT">
            <p>
              PT is required only for the <strong>regulated analytes</strong> named in Subpart I of the CLIA regulations. Everything else falls into one of two buckets, and both trip labs up.
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Waived tests.</strong> No PT required. You may enroll voluntarily, but the moment you do, every PT referral rule below applies to those samples.</li>
              <li><strong>Nonwaived tests not on the Subpart I list, the unregulated analytes.</strong> No PT required, but you are not off the hook. CLIA requires you to verify the accuracy of any test you perform at least twice a year. The workhorse method is a split-sample comparison, where you split a patient specimen, never a PT sample, with another laboratory that runs the same test and your director reviews both sets of results for acceptability. Enrolling in PT voluntarily also satisfies it. Either way, the assessment is semiannual, documented, and reviewed by the laboratory director or designee. An undocumented "we compare sometimes" is a finding waiting to happen.</li>
            </ul>
            <p>
              So the real question is never whether you run PT on everything. It is which of your analytes are regulated and enrolled, which are unregulated and covered by a documented twice-yearly accuracy check, and whether you can prove both on demand.
            </p>
          </Section>

          <Section id="coverage-trap" title="The coverage trap: PT covers the primary method, not the instrument next to it">
            <p>
              PT is required only for the test system you use as the <strong>primary</strong> method for a given analyte. If you run the same analyte on two analyzers, you do PT on one. That sounds like a break, and it is a trap. The second instrument does not disappear from your obligations. It still has to be shown to produce comparable results, at least twice a year, under the instrument comparison requirement at 42 CFR 493.1281. Labs read "PT on the primary method only" as permission to ignore the backup analyzer entirely, and a surveyor who sees two instruments and one comparison record has found a gap. PT and instrument comparison are two different obligations that together cover the same analyte across every system that reports it.
            </p>
          </Section>

          <Section id="enrollment" title="Enrollment rules that quietly cause findings">
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>One PT program per CLIA certificate.</strong> If you run nonwaived testing at more than one site under a single certificate through the multiple-site exception, you rotate PT events through the sites, one event at Site A, the next at Site B, and so on until all participate, then start again. You never order the same event for multiple sites or instruments, and you never share an event between sites, because that pattern looks like referral. If each site holds its own certificate, each enrolls separately, and it is worth using different programs per site to avoid even the appearance of referral.</li>
              <li><strong>You cannot switch programs in the first year.</strong> You must participate in an approved program for a full calendar year before changing, and you must notify CMS before any change.</li>
              <li><strong>New lab or new regulated analyte mid-year, enroll as soon as possible,</strong> then complete the program for the rest of the calendar year.</li>
            </ul>
          </Section>

          <Section id="grading" title="How PT is graded, and why a perfect run can still fail">
            <p>
              Each event delivers five samples per analyte. For most analytes, satisfactory performance is <strong>80 percent</strong>, four of five correct. Immunohematology is the exception that catches people: <strong>ABO and Rh typing and compatibility testing require 100 percent</strong>, because a single error there can kill a patient. Some areas are graded at the <strong>subspecialty level rather than per analyte</strong>, including bacteriology, mycobacteriology, virology, parasitology, mycology, compatibility testing, and antibody detection and identification, which changes how a failure is counted for your microbiology and blood bank sections.
            </p>
            <p>
              And here is the failure mode nobody expects. <strong>A clerical or transcription error is graded as a wrong result.</strong> You can run the sample flawlessly, get the right number on the analyzer, write or key the wrong value onto the form, and fail. The bench work was perfect and the score is an 80. Treat the transcription of PT results with the same care as the testing, because CLIA grades the number you reported, not the number you produced.
            </p>
            <p>
              Every PT results form carries a <strong>signed attestation statement</strong>. The personnel who tested the samples and the laboratory director attest that the PT was tested like patient specimens, by routine staff, with no referral to or discussion with another laboratory. That signature is not a formality. Signing it when any of those things is untrue is its own violation.
            </p>
          </Section>

          <Section id="test-like-patients" title="Test PT the way you test patients, until the exact moment you would not">
            <p>
              PT samples must be handled like patient specimens: the same number of replicates, at the same time, by the same personnel who run patients, on the same test system and reagents you use for patients, rotated through your staff, and only on your primary method. Read the PT booklet for each event, because some samples require specific preparation before testing.
            </p>
            <p>
              There is one hard stop inside that rule, and it is where careers end. You treat the PT sample like a patient specimen right up to the point where you would send a patient specimen out to another laboratory. Then you stop.
            </p>
          </Section>

          <Section id="referral" title="The mistake that ends careers: PT referral">
            <p>
              PT referral is sending your PT samples to another laboratory, or discussing your PT results with another laboratory before the event cutoff, for any reason. It does not matter that you routinely send that test's patient specimens out. It does not matter whether the analyte is regulated, unregulated, or waived. Sending the sample is the violation.
            </p>
            <p>
              The trap is that referral is almost never deliberate. It is a technologist on autopilot, handling a PT sample exactly the way they handle every patient specimen for that assay, including a send-out step that has become second nature. That send-out usually takes one of three forms, and knowing them is how you train it out of the workflow:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Confirmatory testing:</strong> a second procedure that substantiates or questions an initial result. A positive HIV or Lyme screen that reflexes to a confirmatory method is confirmatory testing.</li>
              <li><strong>Reflex testing:</strong> additional testing your procedures trigger automatically when a result is abnormal or meets set criteria. A positive hepatitis A screen that reflexes to IgM is reflex testing.</li>
              <li><strong>Distributive testing:</strong> testing split across laboratories with different certificates, each doing part of the work needed for one reportable result. One lab runs the protein electrophoresis, another runs the total protein, and together they complete the interpretation.</li>
            </ul>
            <p>
              On a patient specimen, all three are good medicine. On a PT sample, all three are referral. When your workflow would reflex, confirm, or distribute, you mark "Would refer" or "Test not performed" on the PT sheet, and you do not send anything. That is why CLIA requires written procedures and specific staff training to stop PT samples from leaving the building even when the reflex is automatic.
            </p>
            <Callout type="warning">
              The sanctions are the most severe in CLIA. Depending on severity, they can include revocation, suspension, or limitation of your CLIA certificate, the laboratory director losing the ability to direct any laboratory for two years, the owner losing the right to own or operate a laboratory for two years, a directed Plan of Correction, a civil money penalty, and your laboratory's name published on the public CMS Laboratory Registry. And if another laboratory ever sends a PT sample to you, do not test it. Notify CMS, your State Agency, and your accreditation organization, and name the laboratory that sent it.
            </Callout>
          </Section>

          <Section id="verify-yourself" title="When you must verify a regulated analyte yourself">
            <p>
              PT does not always produce a usable grade, and in three situations you must verify the accuracy of a regulated analyte on your own and document it:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Late submission.</strong> Results reported after the deadline are graded zero, regardless of how you actually performed.</li>
              <li><strong>Samples not tested.</strong> If you did not test the event, the grade is zero.</li>
              <li><strong>No consensus.</strong> When laboratories did not agree enough for the program to grade a sample, you receive a "Not Graded" code and an artificial 100 percent that tells you nothing about your real performance. Verify that testing yourself.</li>
            </ul>
          </Section>

          <Section id="after-results" title="After the results, even a passing score is not the finish line">
            <p>
              You must review and investigate every event, including the ones you pass. An 80 percent means one of five samples failed, and a failed sample you do not investigate is a warning you chose not to read. Get the terminology right, because it drives the consequences:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Unsatisfactory performance:</strong> you missed the satisfactory score for an analyte, test, subspecialty, or specialty in a single event.</li>
              <li><strong>Unsuccessful performance:</strong> you failed to reach a satisfactory score for the same analyte, subspecialty, or specialty in two consecutive events, or two of three.</li>
              <li><strong>Unsuccessful participation:</strong> the broader category, including repeated unsatisfactory scores across events for the same analyte, specialty, or subspecialty.</li>
            </ul>
            <p>
              A failing score requires documented remedial action: monitor the test system, review your quality control, contact the manufacturer if needed, and look back at the patient results produced during the affected window to identify anyone potentially impacted. Repeated failure can force you to cease testing that analyte until you complete reinstatement PT, two consecutive successful events after you have identified and corrected the cause, and a cease-testing sanction can suspend that testing and its reimbursement for six months.
            </p>
          </Section>

          <Section id="records" title="Keep the record a surveyor will actually ask for">
            <p>
              Hold your PT records for at least two years from the event date. The record is not just the score. It includes the sample preparation and handling instructions, every testing step through result reporting, instrument printouts and raw data and any manual entry logs, the results form with the signed attestation, a screen capture if you reported electronically, the program's evaluation of your performance, and all corrective-action documentation. A clean score with no supporting record is a finding on its own.
            </p>
          </Section>

          <Section id="coverage-gap" title="The part that actually causes the gap: coverage">
            <p>
              Notice the pattern through all of this. The hard part is rarely running an event. It is knowing, across a full menu on multiple instruments, which analytes are regulated and enrolled, which are unregulated and covered by a documented twice-yearly accuracy check, and which secondary instruments still owe a comparison, and being able to show all three on demand. Menus move. A new analyzer arrives, a send-out comes in-house, the 2024 rule pulls a new analyte into the regulated list, and the enrollment does not keep pace. Six months later there is a regulated analyte with no PT on file, and no one noticed, because the record of what is covered lives in binders and memory that never quite agree.
            </p>
          </Section>

          <Section id="references" title="References">
            <p className="text-sm"><strong>CMS Proficiency Testing and PT Referral brochure</strong> (revised October 2024). Centers for Medicare &amp; Medicaid Services.</p>
            <p className="text-sm"><strong>42 CFR Part 493, Subpart H and Subpart I.</strong> Participation in proficiency testing, and the regulated-analyte lists with acceptable performance criteria.</p>
            <p className="text-sm"><strong>42 CFR 493.1281.</strong> Standard: Comparison of test results.</p>
            <p className="text-sm"><strong>CMS-3355-F.</strong> CLIA Proficiency Testing Regulations Related to Analytes and Acceptable Performance; effective July 11, 2024.</p>
          </Section>

          {/* Bottom CTA */}
          <Card className="mt-12 border-primary/20 bg-primary/5">
            <CardContent className="p-6 sm:p-8 text-center">
              <h3 className="font-serif text-xl font-semibold mb-2">Find your PT gaps before a surveyor does with VeritaPT™</h3>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto mb-4">
                VeritaPT™ reads your test menu, checks every analyte against its current CLIA PT requirement, and surfaces the regulated
                analytes with no enrollment and the unregulated ones with no documented alternative assessment. Or have a former Joint
                Commission surveyor walk your menu and your PT referral procedures in a mock inspection. Included in every VeritaAssure™ plan.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button asChild className="bg-primary hover:bg-primary/90">
                  <Link href="/veritapt">Explore VeritaPT<span aria-hidden>™</span> <ChevronRight size={14} className="ml-1" /></Link>
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
            This guide summarizes the CMS Proficiency Testing and PT Referral brochure and the CLIA regulations; it does not replace them.
          </p>
        </div>
      </section>
    </div>
  );
}
