import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, Clock, FlaskConical, User, ExternalLink } from "lucide-react";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { EPEVAL_COMPARE_FAQ } from "@/lib/faqContent";

const COMPARISON: [string, string, string][] = [
  ["CLSI verification studies", "14 study types", "About 30 statistical modules"],
  ["Breadth of pure statistics", "The study types most CLIA labs use", "Broader and deeper"],
  ["Whole-lab coverage map", "Yes", "No (one experiment at a time)"],
  ["CLIA complexity and 42 CFR auto-mapping", "Yes", "No (maps to TEa and CLIA PT limits)"],
  ["Report style", "CFR-cited, director-signed, on the results page", "Statistical reports vs TEa and CLIA PT limits"],
  ["Delivery", "Web, part of the VeritaAssure suite", "Per-user licensed software"],
  ["Pricing", "Published, included in every tier", "No published price"],
];

export default function ArticleCompareEPEvaluatorPage() {
  useSEO({ title: "VeritaCheck vs EP Evaluator: CLIA Verification Compared", description: "How VeritaCheck and EP Evaluator compare for CLIA performance verification: statistical study coverage, 42 CFR citation, whole-menu coverage, reporting, and pricing. An honest side-by-side from a former Joint Commission surveyor." });
  return (
    <div className="min-h-screen bg-background">
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Comparison</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Comparison</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            VeritaCheck vs EP Evaluator
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            An honest comparison of two tools for CLIA performance verification, from the whole-lab coverage view to the CFR-cited report a surveyor reads.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground border-t border-border pt-4">
            <span className="flex items-center gap-1.5"><User size={12} /> Michael Veri, Former Joint Commission Surveyor, CPHQ</span>
            <span className="flex items-center gap-1.5"><Clock size={12} /> 7 min read</span>
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
                "Both run the core CLSI verification studies and evaluate against total allowable error; the difference is what happens around the statistics.",
                "EP Evaluator has the broader pure-statistics library (about 30 modules); VeritaCheck covers the 14 study types most CLIA labs use.",
                "Only VeritaCheck ties each study to a whole-lab coverage map (every analyte and instrument), which EP Evaluator has no concept of.",
                "VeritaCheck reports cite the exact 42 CFR section inline and carry a director signature on the results page; EP Evaluator maps to TEa and CLIA PT limits.",
                "VeritaCheck is included in every VeritaAssure tier at published prices; EP Evaluator is a per-user license plus annual maintenance with no published price.",
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
          <p>EP Evaluator, by Data Innovations, is the long-established statistical engine many laboratories use for performance verification. <Link href="/veritacheck" className="text-primary hover:underline">VeritaCheck&#8482;</Link> is the verification module inside VeritaAssure&#8482;. Both run the CLSI studies a CLIA laboratory needs. They differ in what happens around the statistics: whether a study is tied to the whole test menu, whether the output cites the regulation a surveyor will quote, and how the tool is priced. Here is a fair side-by-side.</p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What they share</h2>
          <p>Both perform the core CLSI verification studies, calibration verification and linearity, precision, method comparison, and the rest, and both evaluate results against total allowable error and CLIA proficiency testing limits. If all you need is to run a single study and read the statistics, either tool does that.</p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Where EP Evaluator is stronger</h2>
          <p>Give it its due. EP Evaluator has a broader statistical library, roughly thirty modules, and goes deeper on pure statistics than VeritaCheck's fourteen study types. It is mature and widely used. If your work demands the widest range of statistical protocols, including advanced critical-difference math that VeritaCheck does not implement, EP Evaluator covers more ground on statistics alone.</p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Where VeritaCheck is different</h2>
          <p>VeritaCheck is built around the survey, not only the statistics.</p>
          <ul>
            <li><strong>Whole-menu coverage.</strong> EP Evaluator's unit of work is one experiment: one analyte, one study, kept in project folders. It does not provide a whole-menu coverage view. VeritaCheck sits on the <Link href="/veritamap" className="text-primary hover:underline">VeritaMap&#8482; whole-lab menu</Link> (every analyte on every instrument, with CLIA complexity from a curated dataset of 260-plus analyzers) and reports, per analyte and instrument, what is covered, what needs review, what is missing, and what is exempt, with proficiency testing enrollment gaps alongside.</li>
            <li><strong>The report a surveyor reads.</strong> Each VeritaCheck study produces a report that states the regulatory determination, cites the exact 42 CFR section inline (493.927, 931, 933, 937, 941, 959), shows the ADLM goal next to the CLIA TEa, and carries a laboratory director or designee signature block on the page with the results. EP Evaluator maps results to TEa and CLIA PT limits; it does not auto-map to CLIA complexity or cite 42 CFR in the output.</li>
            <li><strong>Pricing you can see.</strong> VeritaCheck is included in every VeritaAssure tier at <Link href="/pricing" className="text-primary hover:underline">published annual prices</Link>, with no per-user or per-study upcharge. EP Evaluator is a per-user license plus annual maintenance, with no published pricing.</li>
          </ul>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Comparison</h2>
          <div className="overflow-x-auto not-prose my-6">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b-2 border-primary/30">
                  <th className="text-left py-2 pr-3 font-semibold text-muted-foreground"></th>
                  <th className="text-left py-2 px-3 font-semibold text-primary">VeritaCheck&#8482;</th>
                  <th className="text-left py-2 px-3 font-semibold">EP Evaluator</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([label, vc, ep]) => (
                  <tr key={label} className="border-b border-border align-top">
                    <td className="py-2 pr-3 font-medium">{label}</td>
                    <td className="py-2 px-3">{vc}</td>
                    <td className="py-2 px-3 text-muted-foreground">{ep}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Which to choose</h2>
          <p>If you want the deepest statistical library and nothing else, EP Evaluator has more modules. If you want verification that ties to your whole menu, produces a CFR-cited, director-signed report a surveyor accepts, and comes at a published price, that is what VeritaCheck is for. Many of the labs we talk to are not short on statistics. They are short on being able to show, on demand, that the whole menu is covered.</p>

          <p className="text-sm">Still deciding how to evaluate a platform in general? See our <Link href="/resources/how-to-choose-lab-compliance-software" className="text-primary hover:underline">buyer's guide to lab compliance software</Link>.</p>

          <p className="text-xs text-muted-foreground border-t border-border pt-4 not-prose">EP Evaluator and Data Innovations are trademarks of Data Innovations, LLC. This comparison is independent and based on publicly available information as of October 2026.</p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Frequently Asked Questions</h2>
          {EPEVAL_COMPARE_FAQ.map(({ q, a }) => (
            <div key={q} className="border-b border-border py-5 last:border-0">
              <h3 className="font-semibold text-base mb-2">{q}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
            </div>
          ))}

          <NewsletterSignup variant="inline" source="article-compare-ep-evaluator" />

          <div className="rounded-xl bg-primary text-primary-foreground p-7 mt-10 text-center">
            <FlaskConical size={28} className="mx-auto mb-3 opacity-80" />
            <h3 className="font-serif text-xl font-bold mb-2">See VeritaCheck&#8482; on your own studies</h3>
            <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
              Run a study, read the CFR-cited report, and see the whole-lab coverage map, at published pricing with a free trial.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
                <Link href="/veritacheck">Explore VeritaCheck&#8482; <ChevronRight size={15} className="ml-1" /></Link>
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
