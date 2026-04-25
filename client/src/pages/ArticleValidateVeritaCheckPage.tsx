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

export default function ArticleValidateVeritaCheckPage() {
    useSEO({ title: "How to Validate VeritaCheck™ for CLIA Compliance | Veritas Lab Services", description: "Software validation documentation for VeritaCheck™ under CLIA requirements. How to validate laboratory information systems and comply with 42 CFR 493.1252." });
return (
    <div className="min-h-screen bg-background">

      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Software Validation</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Software Validation</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            How to Validate VeritaCheck™ for Your Clinical Laboratory: A Step-by-Step Guide for Lab Directors
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            Most labs can complete the full IQ/OQ/PQ validation process in under two hours. Here is the step-by-step process.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground border-t border-border pt-4">
            <span className="flex items-center gap-1.5"><User size={12} /> Michael Veri, Former Joint Commission Surveyor, CPHQ</span>
            <span className="flex items-center gap-1.5"><Clock size={12} /> 8 min read</span>
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
                "Software validation is required under CLIA 42 CFR 493.1251 and CAP checklist item COM.01300",
                "The appropriate framework is IQ/OQ/PQ: Installation Qualification, Operational Qualification, Performance Qualification",
                "Most labs complete the full process in under two hours",
                "A free Software Validation Record template is available at veritaslabservices.com",
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
            If you are preparing to use VeritaCheck™ in your clinical laboratory, your first question should be: do we have a validation record on file? For most regulated labs, the answer needs to be yes before you run a single study through any software tool. The good news is that validating VeritaCheck™ is straightforward, and most labs can complete it in under two hours.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Why Software Validation Is Required</h2>
          <p>
            CLIA regulations under 42 CFR 493.1251 require laboratories to establish and verify the performance of all methods and procedures used in the testing process, including software involved in reporting. CAP checklist item COM.01300 addresses software validation directly. These requirements exist because software errors in a regulated environment carry the same risk as method errors. Documenting your validation demonstrates that the tool performs as intended in your specific setting.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What Validating VeritaCheck™ Actually Means</h2>
          <p>
            This is not a full 21 CFR Part 11 pharmaceutical validation exercise. VeritaCheck™ is a cloud-based method validation tool, and the appropriate framework is an IQ/OQ/PQ process: Installation Qualification, Operational Qualification, and Performance Qualification. Each step is brief and practical. You are not rewriting software, you are confirming it works correctly in your lab's hands.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Step-by-Step Validation Process</h2>

          <h3 className="font-semibold text-lg mt-8 mb-2">IQ - Installation Qualification</h3>
          <p>
            Open VeritaCheck™ in a supported browser (Chrome or Edge recommended). Log in with your lab credentials. Confirm that your lab name and CLIA number appear correctly in the report header. That is your IQ complete. No software installation is required because VeritaCheck™ is browser-based.
          </p>

          <h3 className="font-semibold text-lg mt-8 mb-2">OQ - Operational Qualification</h3>
          <p>
            Use the demo studies built into the platform to verify that known results produce the expected pass or fail outcome. Enter results that should trigger a failure and confirm the software flags them. Enter results that should pass and confirm they are reported as passing. Document what you entered and what the system returned. This confirms that the core calculation and reporting logic functions as designed.
          </p>

          <Callout type="tip">
            <strong>OQ shortcut:</strong> The demo lab in VeritaCheck™ includes pre-loaded studies with known outcomes. Use these to verify pass and fail logic without entering data from scratch.
          </Callout>

          <h3 className="font-semibold text-lg mt-8 mb-2">PQ - Performance Qualification</h3>
          <p>
            Run one real study from your lab through VeritaCheck™. Review the generated report for completeness, accuracy, and correct identification of your laboratory. Have the medical director or designee review the output and confirm it is clinically appropriate for your setting. Their signature on this step closes the PQ.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">The Software Validation Template</h2>
          <p>
            Veritas Lab Services, LLC provides a free Software Validation Record template designed specifically for VeritaCheck™. The template walks through each IQ, OQ, and PQ step with fillable fields for actual results, observations, and a signature block for the medical director or designee. You do not need to build a form from scratch. The template is available at veritaslabservices.com.
          </p>

          <Callout type="info">
            <strong>Download the template:</strong> The free Software Validation Record template is available on the Resources page. It mirrors the three-phase IQ/OQ/PQ process with fillable fields and signature blocks.
          </Callout>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">How Long Does It Take?</h2>
          <p>
            Most labs complete the full IQ/OQ/PQ process in under two hours. The template is already structured to mirror the three-phase process. Your team fills in the actual results, notes any observations, and obtains the required signatures. For labs with a cooperative medical director or designee, the entire exercise can often be completed in a single working session.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What to Keep on File</h2>
          <p>
            Store the completed, dated, and signed Software Validation Record with your other method validation documentation. The medical director or designee signature is required. Retain the record in accordance with your lab's document control policy, with a minimum of two years recommended to align with standard CLIA retention expectations. The record should be retrievable during inspection.
          </p>

          {/* VeritaCheck CTA */}
          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 my-8">
            <div className="flex items-start gap-3">
              <FlaskConical size={20} className="text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">Ready to get started?</div>
                <p className="text-sm text-muted-foreground mb-3">
                  VeritaCheck™ is part of the VeritaAssure™ suite of compliance tools available at veritaslabservices.com. Download the free Software Validation Record template, complete your IQ/OQ/PQ, and have your documentation in place before your next study cycle.
                </p>
                <Button asChild size="sm" className="bg-primary text-primary-foreground">
                  <Link href="/veritacheck">Open VeritaCheck™ <ChevronRight size={13} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          </div>

          <p>
            Final approval and clinical determination must be made by the laboratory director or designee.
          </p>

          {/* Newsletter */}
          <NewsletterSignup variant="inline" source="article-validate-veritacheck" />

          {/* Final CTA */}
          <div className="rounded-xl bg-primary text-primary-foreground p-7 mt-10 text-center">
            <FlaskConical size={28} className="mx-auto mb-3 opacity-80" />
            <h3 className="font-serif text-xl font-bold mb-2">A clean validation record is one less finding to worry about.</h3>
            <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
              Download the free template, complete your IQ/OQ/PQ, and start running studies with confidence.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
                <Link href="/veritacheck">Run a Free Study <ChevronRight size={15} className="ml-1" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
                <Link href="/resources">Back to Resources <ExternalLink size={13} className="ml-1" /></Link>
              </Button>
            </div>
          </div>

          {/* References */}
          <div className="mt-10 pt-6 border-t border-border">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">References</div>
            <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
              <li>Code of Federal Regulations. (2024). 42 CFR 493.1251 - Establishment and Verification of Performance Specifications. <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ecfr.gov</a></li>
              <li>College of American Pathologists. (2024). COM.01300 - Software Validation. CAP Accreditation Checklists.</li>
              <li>FDA. (2002). General Principles of Software Validation; Final Guidance for Industry and FDA Staff.</li>
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
