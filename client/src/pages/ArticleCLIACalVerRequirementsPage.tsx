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

export default function ArticleCLIACalVerRequirementsPage() {
    useSEO({ title: "Calibration Verification Requirements Under CLIA | Veritas Lab Services", description: "Detailed breakdown of CLIA calibration verification requirements including frequency, documentation, acceptable performance criteria, and common surveyor findings." });
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
            Calibration Verification Requirements Under CLIA: What Every Lab Director Needs to Know
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            Calibration verification is one of the most consistently cited deficiencies in CLIA and CAP laboratory inspections. This article covers what the regulation requires and what your records need to show.
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
                "Calibration verification must be performed at least every six months for all non-waived quantitative tests",
                "Several events trigger out-of-cycle verification beyond the standard schedule",
                "Documentation completeness is the most common inspection finding, not whether the verification was performed",
                "VeritaCheck™ automates calculations, applies acceptance criteria, and generates inspector-ready PDF reports",
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

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What the Regulation Requires</h2>
          <p>
            Under 42 CFR 493.1255, laboratories must perform calibration verification at least every six months for each quantitative test system. Calibration verification confirms that your instrument continues to accurately measure across its entire reportable range, using materials with known concentrations that span from the low end to the high end of that range.
          </p>
          <p>
            The requirement applies to all non-waived quantitative tests. Waived tests are exempt from this specific requirement, though good laboratory practice still supports periodic verification.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">When You Must Verify Beyond the Six-Month Cycle</h2>
          <p>
            Several events trigger an out-of-cycle calibration verification requirement. These include: a complete change of reagent lot when the manufacturer specifies verification is needed, major instrument maintenance or repair that could affect performance, and any time QC results suggest the calibration may have shifted. Documenting the trigger event along with the verification results is important because inspectors often look for this connection.
          </p>

          <Callout type="warning">
            <strong>Important:</strong> Always document the trigger event alongside the verification results. Inspectors frequently look for this connection when verification was performed outside the regular six-month cycle.
          </Callout>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What Analytes Require It</h2>
          <p>
            Calibration verification is required for all quantitative non-waived tests you report to patients. This includes high-volume chemistry panels, hematology indices that carry a reportable range, coagulation assays, and immunoassay quantitative tests. If you are unsure whether a specific analyte requires it, the manufacturer's instructions for use are the starting reference. CLIA 42 CFR 493.1255 and CAP checklist item COM.30450 provide additional guidance.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What Your Documentation Must Include</h2>
          <p>
            A calibration verification record that satisfies an inspector includes: the date performed, the identity of the analyst, the materials used (name, lot number, concentration values), your measured results for each level, calculated recovery percentages, and the pass or fail determination with the acceptance criteria applied. A narrative or signature from the medical director or designee confirming review is standard practice for CAP-accredited laboratories.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Common Inspection Findings</h2>
          <p>
            The most common citation is not that the verification was not done, but that the documentation is incomplete. Missing lot numbers, no pass or fail determination, no documentation of who reviewed the results, or records that cannot be produced during the survey are all findings waiting to happen. A second common issue is failing to document the trigger when verification was performed outside the six-month cycle.
          </p>

          <Callout type="info">
            <strong>Documentation tip:</strong> Before your next survey, pull a random calibration verification record and confirm it includes the date, analyst, materials with lot numbers, measured results, recovery percentages, pass or fail determination, and reviewer signature. If any element is missing, address it now.
          </Callout>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">A More Efficient Approach</h2>
          <p>
            Tools like VeritaCheck™ perform the recovery calculations automatically, apply your acceptance criteria, and generate an inspector-ready PDF report that includes your CLIA number, analyst identification, all input values, and a clear pass or fail determination. The report is stored in your account and retrievable at any time. For a laboratory running multiple analytes across multiple instruments, this eliminates the spreadsheet management problem entirely.
          </p>

          {/* VeritaCheck CTA */}
          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 my-8">
            <div className="flex items-start gap-3">
              <FlaskConical size={20} className="text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">VeritaCheck™ automates calibration verification</div>
                <p className="text-sm text-muted-foreground mb-3">
                  Enter your data and VeritaCheck™ handles every calculation: recovery percentages, pass/fail against CLIA TEa, and a signed PDF report with your CLIA number. Your first study is free.
                </p>
                <Button asChild size="sm" className="bg-primary text-primary-foreground">
                  <Link href="/veritacheck">Run a Free Study <ChevronRight size={13} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          </div>

          <p>
            Final approval and clinical determination must be made by the laboratory director or designee. Learn more about VeritaCheck™ at veritaslabservices.com.
          </p>

          {/* Newsletter */}
          <NewsletterSignup variant="inline" source="article-clia-calver-requirements" />

          {/* Final CTA */}
          <div className="rounded-xl bg-primary text-primary-foreground p-7 mt-10 text-center">
            <FlaskConical size={28} className="mx-auto mb-3 opacity-80" />
            <h3 className="font-serif text-xl font-bold mb-2">Ready to run your next study?</h3>
            <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
              VeritaCheck™ handles calibration verification with automated CLIA TEa lookup, all statistics calculated, and a signed PDF report generated in minutes.
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
              <li>Code of Federal Regulations. (2024). 42 CFR 493.1255 - Calibration and Calibration Verification. <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ecfr.gov</a></li>
              <li>College of American Pathologists. (2024). COM.30450 - Calibration Verification. CAP Accreditation Checklists.</li>
              <li>Centers for Medicare & Medicaid Services. (2006). Calibration and Calibration Verification: CLIA Brochure. <a href="https://www.cms.gov/files/document/clia-brochure-calibration-and-calibration-verification-april-2006.pdf" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">cms.gov</a></li>
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
