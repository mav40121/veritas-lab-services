import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, Clock, FlaskConical, User, ExternalLink } from "lucide-react";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { CHOOSE_SOFTWARE_FAQ } from "@/lib/faqContent";

export default function ArticleChooseComplianceSoftwarePage() {
  useSEO({ title: "How to Choose Lab Compliance Software, 2026 Buyer's Guide", description: "A former Joint Commission surveyor's six-question guide to evaluating lab compliance software for a clinical laboratory: accreditor fit, lifecycle coverage, surveyor-defensible output, PHI risk, who built it, and pricing." });
  return (
    <div className="min-h-screen bg-background">
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Buyer's Guide</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Buyer's Guide</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            How to Choose Lab Compliance Software
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            A former Joint Commission surveyor's guide to evaluating a compliance platform for a clinical laboratory.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground border-t border-border pt-4">
            <span className="flex items-center gap-1.5"><User size={12} /> Michael Veri, Former Joint Commission Surveyor, CPHQ</span>
            <span className="flex items-center gap-1.5"><Clock size={12} /> 9 min read</span>
            <span>October 2026</span>
          </div>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Card className="border-primary/20 bg-primary/5 mb-10">
          <CardContent className="p-5">
            <div className="font-semibold text-sm text-primary mb-3">Key Takeaways</div>
            <ul className="space-y-2">
              {[
                "Choosing lab compliance software is not about counting features. It is about one question: will its output hold up in front of a surveyor.",
                "The content must be crosswalked to your actual accreditor (CLIA plus TJC, CAP, or COLA), not to a generic “compliance” checklist.",
                "A platform should cover the full compliance lifecycle (verification, PT, QC, competency, policy, personnel, readiness), not one slice you then stitch together in spreadsheets.",
                "Surveyor-defensible output states the regulatory determination, cites the 42 CFR Part 493 section, and carries a director signature block on the same page as the results.",
                "Ask whether it stores PHI (a HIPAA surface you may not need), who built it (have they run surveys), and whether you can try it on transparent pricing.",
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
          <p>Lab compliance software is a platform that helps a clinical laboratory document and maintain what its accreditor and CLIA expect: performance verification, proficiency testing, quality control, competency, policies, personnel, and inspection readiness. Choosing one is less about counting features and more about one question: will its output hold up in front of a surveyor. Most laboratories evaluate the wrong things. Here is what actually matters, from someone who spent years on the other side of the survey.</p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">1. Does it match your accreditor, not just "compliance" in general?</h2>
          <p>A tool that says "compliance" is not the same as a tool that knows your accreditor. CLIA is the federal floor, and on top of it a laboratory answers to TJC, CAP, COLA, or a state program, each with its own requirement set and its own language. The software you want maps its content to the accreditor you actually hold, so a policy or a study is tied to the specific requirement a surveyor will cite, not to a generic checklist. Ask a vendor to show you their content crosswalked to your accreditor. If they cannot, you are buying a filing cabinet.</p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">2. Does it cover the whole lifecycle, or just one piece?</h2>
          <p>Compliance is not one task. It is performance verification when you bring a test online, proficiency testing three times a year, quality control every day, competency on a schedule, policy review on a cycle, personnel records that match assigned roles, and the readiness to show all of it on demand. A single-purpose tool solves one of these and leaves you stitching the rest together in spreadsheets, which is where surveys are lost. Decide whether you want a point tool or a platform that covers the lifecycle and lets you grow into it.</p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">3. Will its outputs survive a surveyor?</h2>
          <p>This is the test that separates real compliance software from document storage. When the platform generates a study or a record, does it state the regulatory determination and cite the exact 42 CFR Part 493 section, and does it carry a laboratory director or designee signature block on the page with the results? A surveyor does not want a spreadsheet of numbers. They want a defensible document that shows the determination, the citation, and the sign-off together. If the output would not survive being handed across the table, the software has not done the job.</p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">4. Does it store protected health information?</h2>
          <p>Many platforms pull in patient data to do their work, which means you have just added a HIPAA surface and a breach risk to your compliance program. Ask directly whether the software stores protected health information. A tool that does its job on de-identified study data, lot numbers, and control values, and stores no PHI at all, removes an entire category of risk from your desk.</p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">5. Who built it?</h2>
          <p>Compliance software written by engineers who have never sat through a survey tends to model the paperwork, not the survey. Software built by someone who has conducted inspections models what a surveyor actually asks for: the missing corrective action on a passing PT score, the monthly review that was signed but missed something, the provider notification that never got documented. Ask who designed the content, and whether they have stood on the survey side of the table.</p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">6. How does it price, and can you try it?</h2>
          <p>Compliance software should let you start small and prove value before you commit a budget. Look for transparent published pricing rather than a mandatory sales call, a real free trial so you can load your own data, and a plan that fits your laboratory's size instead of an enterprise contract you do not need. A vendor confident in the product lets you try it.</p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">The kinds of tools you will find</h2>
          <p>In practice you will run into four categories. General document-management and QMS platforms are strong at storing and routing files but know nothing about CLIA, so you supply all the regulatory content yourself. Laboratory information systems run testing and can hold some quality records, but compliance is a side feature, not their purpose. Spreadsheets are free and universal and are exactly what surveyors find failing. And purpose-built laboratory compliance software is designed around the survey itself. Match the category to how much of the work you want the software to actually know.</p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Where VeritaAssure fits</h2>
          <p><Link href="/veritaassure" className="text-primary hover:underline">VeritaAssure&#8482;</Link> is the purpose-built option, an integrated eighteen-module compliance and operations suite built by a former Joint Commission laboratory surveyor. Its content is crosswalked to CLIA, CAP, TJC, and COLA; it covers the full lifecycle from verification to inspection readiness; its reports cite the CFR section and carry the director signature block; it stores no protected health information; and it <Link href="/pricing" className="text-primary hover:underline">publishes its pricing</Link> with a free trial. Whether you choose it or not, evaluate any platform against the six questions above. The one that answers all six is the one that will hold up when a surveyor is sitting across from you.</p>

          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 my-8">
            <div className="flex items-start gap-3">
              <FlaskConical size={20} className="text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">VeritaAssure&#8482; answers all six questions</div>
                <p className="text-sm text-muted-foreground mb-3">
                  Crosswalked to CLIA, CAP, TJC, and COLA, covering the full lifecycle, with CFR-cited reports, no stored PHI, and published pricing with a free trial.
                </p>
                <Button asChild size="sm" className="bg-primary text-primary-foreground">
                  <Link href="/veritaassure">Explore VeritaAssure&#8482; <ChevronRight size={13} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          </div>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Frequently Asked Questions</h2>
          {CHOOSE_SOFTWARE_FAQ.map(({ q, a }) => (
            <div key={q} className="border-b border-border py-5 last:border-0">
              <h3 className="font-semibold text-base mb-2">{q}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
            </div>
          ))}

          <NewsletterSignup variant="inline" source="article-choose-compliance-software" />

          <div className="rounded-xl bg-primary text-primary-foreground p-7 mt-10 text-center">
            <FlaskConical size={28} className="mx-auto mb-3 opacity-80" />
            <h3 className="font-serif text-xl font-bold mb-2">Evaluate the platform that answers all six</h3>
            <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
              See the full VeritaAssure&#8482; suite, or start with its published pricing and a free trial.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
                <Link href="/veritaassure">Explore VeritaAssure&#8482; <ChevronRight size={15} className="ml-1" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
                <Link href="/pricing">See Pricing <ExternalLink size={13} className="ml-1" /></Link>
              </Button>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-border">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">References</div>
            <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
              <li>Code of Federal Regulations. Title 42, Part 493: Laboratory Requirements. <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ecfr.gov</a></li>
            </ol>
          </div>

          <div className="mt-8 pt-6 border-t border-border flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User size={20} className="text-primary" />
            </div>
            <div>
              <div className="font-semibold text-sm">Michael Veri</div>
              <div className="text-xs text-muted-foreground mb-1">Owner, Veritas Lab Services, LLC &middot; Former Joint Commission Laboratory Surveyor &middot; CPHQ</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Michael Veri is a former Joint Commission laboratory surveyor who conducted more than 200 facility inspections, and a CPHQ-certified healthcare quality professional. He founded Veritas Lab Services to provide expert consulting and accessible compliance tools to clinical laboratories nationwide.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
