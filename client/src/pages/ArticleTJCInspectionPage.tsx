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

export default function ArticleTJCInspectionPage() {
    useSEO({ title: "TJC Laboratory Inspection Checklist and Preparation Guide | Veritas Lab Services", description: "Prepare your clinical laboratory for a Joint Commission survey. Common findings, checklist items, and strategies from a former TJC laboratory surveyor." });
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
            Preparing for a TJC Laboratory Inspection: A Practical Checklist for Lab Directors
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            The laboratories that do well on TJC surveys are not the ones that scrambled the week before. They are the ones that maintain documentation continuously and can retrieve anything in under two minutes.
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
                "TJC surveys follow a tracer methodology, starting at the patient and working backward through your system",
                "Five areas are traced most consistently: method validation, proficiency testing, competency, instrument documentation, and procedures",
                "Documentation is not paperwork, it is the evidence that your quality practices exist",
                "Conduct a mock survey ninety days before your anticipated survey window",
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
            A TJC laboratory survey does not begin with a checklist. It begins with a tracer, and the tracer starts at the patient. A surveyor follows a test result backward through your system: who ordered it, which analyzer ran it, what verification was on file for that analyzer, who performed the test, how their competency was documented, and where your proficiency testing record sits for that analyte. Every link in that chain either holds or does not.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">The Five Areas Surveyors Trace Most Consistently</h2>

          <h3 className="font-semibold text-lg mt-8 mb-2">Method Validation Records</h3>
          <p>
            For every quantitative test you report, there must be a record on file confirming the method performs acceptably in your hands. Calibration verification at least every six months. Method comparison when a new instrument was added. Precision when a new method was implemented. These records must be current, signed by the medical director or designee, and immediately retrievable.
          </p>

          <h3 className="font-semibold text-lg mt-8 mb-2">Proficiency Testing</h3>
          <p>
            Your PT enrollment must cover every regulated analyte. Your results must have been submitted on time. Any unacceptable result must have a documented corrective action, including root cause analysis and preventive measures. Surveyors look for the full loop: failure, investigation, correction, verification.
          </p>

          <h3 className="font-semibold text-lg mt-8 mb-2">Competency Assessments</h3>
          <p>
            Every person who performs or reports tests must have documented competency for those specific tests. The competency must be tied to the test menu, not just the department. A surveyor who asks "show me the competency record for the person who ran this troponin" expects to see documentation for troponin specifically, using your troponin method.
          </p>

          <h3 className="font-semibold text-lg mt-8 mb-2">Test Menu and Instrument Documentation</h3>
          <p>
            You must be able to show which instruments perform which tests, the role of each instrument (primary, backup, satellite), and the performance verification history for each. This is frequently a gap in smaller labs that rely on memory rather than documentation.
          </p>

          <h3 className="font-semibold text-lg mt-8 mb-2">Policies and Procedures</h3>
          <p>
            All procedures must be current, approved by the medical director or designee, and match what your staff actually does. An outdated procedure that describes a method you replaced two years ago is a finding.
          </p>

          <Callout type="warning">
            <strong>The most expensive phrase in lab compliance:</strong> "We do it, we just do not document it." This is the sentence that turns a correctable practice gap into a deficiency. If you perform proficiency testing and there is no record, a surveyor cannot distinguish your compliant lab from a non-compliant one. Documentation is not paperwork, it is the evidence that your quality practices exist.
          </Callout>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">How VeritaAssure(TM) Addresses Each Area</h2>
          <p>
            VeritaMap(TM) maintains your complete instrument and test menu inventory. When a surveyor asks which instruments perform a test and what their verification history looks like, you open VeritaMap(TM) and show them.
          </p>
          <p>
            VeritaCheck(TM) stores every validation study with date, analyst, pass or fail determination, and medical director or designee signature. Generating any report for surveyor review takes under thirty seconds.
          </p>
          <p>
            VeritaComp(TM) links competency assessments to specific method groups in your test menu. The gap between "we assessed competency" and "we assessed competency for this method, for this person, on this date" is exactly what surveyors are testing.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">The 90-Day Rule</h2>
          <p>
            Conduct a mock survey ninety days before your anticipated survey window. Use your actual documentation, not what you plan to have. Any gap found at ninety days can be corrected. A gap found by a surveyor becomes a finding on your official report.
          </p>

          <Callout type="tip">
            <strong>Mock survey tip:</strong> Pick a random analyte, pull its complete documentation chain (validation, PT, competency, instrument record, procedure), and time how long it takes to produce every document. If it takes more than two minutes, your retrieval system needs work.
          </Callout>

          {/* VeritaAssure CTA */}
          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 my-8">
            <div className="flex items-start gap-3">
              <FlaskConical size={20} className="text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">VeritaAssure(TM) keeps your lab survey-ready</div>
                <p className="text-sm text-muted-foreground mb-3">
                  Explore the full VeritaAssure(TM) suite at veritaslabservices.com and see how integrated documentation changes the survey experience.
                </p>
                <Button asChild size="sm" className="bg-primary text-primary-foreground">
                  <Link href="/veritaassure">Explore VeritaAssure(TM) <ChevronRight size={13} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          </div>

          <p>
            Final approval and clinical determination must be made by the laboratory director or designee.
          </p>

          {/* Newsletter */}
          <NewsletterSignup variant="inline" source="article-tjc-inspection" />

          {/* Final CTA */}
          <div className="rounded-xl bg-primary text-primary-foreground p-7 mt-10 text-center">
            <FlaskConical size={28} className="mx-auto mb-3 opacity-80" />
            <h3 className="font-serif text-xl font-bold mb-2">Ready to prepare for your next survey?</h3>
            <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
              VeritaScan(TM) provides a complete TJC compliance checklist mapped to every standard. Run your own mock survey and identify gaps before the surveyor does.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
                <Link href="/veritascan">Explore VeritaScan(TM) <ChevronRight size={15} className="ml-1" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
                <Link href="/veritaassure">Full VeritaAssure(TM) Suite <ExternalLink size={13} className="ml-1" /></Link>
              </Button>
            </div>
          </div>

          {/* References */}
          <div className="mt-10 pt-6 border-t border-border">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">References</div>
            <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
              <li>The Joint Commission. (2024). Laboratory Services Standards. Laboratory Accreditation Program.</li>
              <li>The Joint Commission. (2024). Performance Evaluation Standards for Laboratory Services. Hospital Accreditation Program.</li>
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
