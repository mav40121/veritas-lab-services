import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, FlaskConical, AlertTriangle } from "lucide-react";
import { CPRT_FAQ } from "@/lib/faqContent";

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

export default function ArticleCostPerReportablePage() {
  useSEO({
    title: "What Your Tests Actually Cost: A Four-Layer CPRT Framework for Clinical Laboratories",
    description: "The CLSI GP11-A four-layer cost-per-reportable-test (CPRT) framework: reagents, labor, equipment, overhead. Which layer answers which question, how to compare configurations honestly, and what to do this quarter.",
  });
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Lab Economics</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Lab Economics</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            What Your Tests Actually Cost: A Four-Layer CPRT Framework for Clinical Laboratories
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            The CLSI GP11-A four-layer framework for cost-per-reportable-test, which question each layer answers, the
            discipline required to compare two configurations honestly, and the moves a laboratory director can make this quarter.
          </p>
        </div>
      </section>

      {/* Body */}
      <section className="py-12 sm:py-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          {/* Lede */}
          <div className="prose-styles space-y-4 text-[15px] leading-relaxed mb-10">
            <p>
              In twenty-three years of clinical laboratory work and more than two hundred surveys with The Joint Commission, the single most common pattern I have seen at the intersection of the lab director's office and the CFO's office is this. When finance asks what a test costs, the laboratory gives a number that does not match the question being asked. The number is usually right. The question being answered is the wrong one. The decision that follows is made on a wrong premise.
            </p>
            <p>
              The clinical laboratory industry has had a defensible framework for cost-per-reportable-test (CPRT) since the late 1990s, in the form of NCCLS document GP11-A, later continued under CLSI. The framework separates the cost of a single reportable result into four layers, each of which answers a different financial question. The framework is conceptually unchanged in the years since. It is also rarely operationalized inside the laboratories that need it most.
            </p>
            <p>
              This article walks through the four layers, the question each one answers, the discipline required to compare two configurations honestly, and the specific operational moves a laboratory director can make this quarter to put the framework in front of a finance team.
            </p>
          </div>

          {/* Table of contents */}
          <Card className="mb-10">
            <CardContent className="p-5">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Contents</div>
              <TocLink href="#why">1. Why most laboratories cannot answer the cost question well</TocLink>
              <TocLink href="#four-layer">2. The four-layer model from CLSI GP11-A</TocLink>
              <TocLink href="#matching">3. Matching the layer to the question</TocLink>
              <TocLink href="#worked-example">4. Worked example: sodium under two configurations</TocLink>
              <TocLink href="#this-quarter">5. What to do this quarter</TocLink>
              <TocLink href="#clia">6. The CLIA context</TocLink>
              <TocLink href="#closing">7. Closing: VeritaOps and the next step</TocLink>
              <TocLink href="#references">References</TocLink>
            </CardContent>
          </Card>

          <Section id="why" title="1. Why most laboratories cannot answer the cost question well">
            <p>
              The data needed to calculate the cost of a clinical laboratory test lives in at least four systems and three offices. The reagent unit cost lives in the procurement contract. The other supplies cost lives in the consumables purchase log. The calibrator and QC purchase records live in the QC budget. The technologist labor cost lives in payroll. The instrument purchase amount lives in capital accounting. The annual maintenance contract lives in service agreements. The facility, IT, and administrative overhead lives in a different department entirely. The volume of reportable results lives in the LIS, but in a form that finance does not have access to.
            </p>
            <p>
              The result is that when a CFO or service-line director asks what it costs to run one basic metabolic panel, the laboratory director, supervisor, or operations manager pulls together the cleanest data they have access to, which is usually the reagent invoice line, and gives that number. It is correct. It is also dramatically incomplete.
            </p>
            <p>Three failure modes follow.</p>
            <p>
              <strong>Failure one: insource decisions made on Layer 1.</strong> A laboratory looking at a low-volume specialty test compares its in-house reagent cost to the reference laboratory's published charge. If the in-house cost looks lower, the math feels favorable and the test is kept or brought in-house. The reality is that at low volume, the calibrator amortization, QC amortization, labor per setup, and competency maintenance costs combine to push the actual per-reportable cost well above the reagent line. The decision feels rational. The economics are negative.
            </p>
            <p>
              <strong>Failure two: charge-master pricing set without overhead.</strong> A laboratory negotiating with a payer or building a fee schedule sets the per-test price at a small markup over reagent cost, on the theory that the laboratory is already paying for the staff and the building anyway. This is the inverse error. When overhead and depreciation are not loaded in, the laboratory is structurally subsidizing the volume it runs and the contract negotiation has no defensible floor.
            </p>
            <p>
              <strong>Failure three: capital requests rejected because the depreciation case was never built.</strong> When a laboratory director asks the finance committee for a new analyzer to replace aging equipment or absorb growth, the case usually rests on operational arguments such as turnaround time, technologist time, and instrument reliability. The financial argument that finance committees actually respond to is per-test cost at Layer 3, including depreciation and maintenance, across projected volume. It is rarely presented because it has not been built.
            </p>
            <p>
              All three failures share a common cause. The laboratory was answering a financial question with a number that did not include the components that mattered for that specific question.
            </p>
          </Section>

          <Section id="four-layer" title="2. The four-layer model from CLSI GP11-A">
            <p>
              The four-layer framework comes from CLSI GP11-A, <em>Basic Cost Accounting for Clinical Services; Approved Guideline</em>, published by NCCLS in 1998 and continued under CLSI when the organization succeeded NCCLS in 2005. The structure is conceptual, but the math is straightforward. Each layer is the prior layer plus one additional cost category.
            </p>

            <p><strong>Layer 1: Reagents and supplies.</strong> L1 captures every consumable that is required to produce one reportable result and to keep the assay performing on the instrument. The components are:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Reagent cost per test (the line on the reagent invoice, divided by the number of tests the reagent kit produces)</li>
              <li>Other supplies per test (sample cups, pipette tips, cuvettes, anything else consumed per test)</li>
              <li>Calibrator amortization (calibrator kit cost times calibrations per year, divided by annual volume)</li>
              <li>QC amortization (QC cost per run at all levels times QC runs per year, divided by annual volume)</li>
            </ul>
            <p>
              L1 is the marginal cost of running one additional test on an instrument that is already operating. It is the right number to use when the question is whether to add one more analyte to a panel that the laboratory already runs.
            </p>

            <p>
              <strong>Layer 2: + Direct labor.</strong> L2 adds the laboratory technologist's time. The formula is L1 + (tech minutes per test / 60) × loaded hourly rate. The loaded hourly rate is the technologist's base wage plus benefits plus an overhead allocation, typically 1.3 to 1.4 times base hourly. That is the technologist's full cost to the institution per hour, not just the wage line.
            </p>
            <p>
              L2 is the marginal cost of bringing a test in-house when the analyzer is already on the floor but the work to run the test is not yet being done. It is the right number for the most common insource-versus-send-out decision a laboratory will face.
            </p>

            <p>
              <strong>Layer 3: + Equipment depreciation.</strong> L3 adds the cost of the analyzer itself, amortized over its useful life, plus annual maintenance. The formula is L2 + (instrument purchase / useful life in years + annual maintenance) / annual volume.
            </p>
            <p>
              L3 is the right number when the question is whether to purchase a new analyzer, replace an aging analyzer, or expand into a new analytical category that requires new capital equipment. It is also the right number when a finance committee asks the laboratory director to defend the analyzer line on the capital budget.
            </p>

            <p>
              <strong>Layer 4: + Overhead.</strong> L4 adds the indirect costs of running a clinical laboratory at all, which include facility, quality, IT, administration, and billing. Overhead is applied either as a flat dollar amount per test from finance or as a percentage markup on the prior layer.
            </p>
            <p>
              L4 is the fully-loaded cost of producing one reportable result, including every dollar the institution spends to make the laboratory possible. It is the right number when the laboratory is setting charge-master prices, defending the price floor in a payer contract negotiation, or building the laboratory's contribution to enterprise margin.
            </p>
          </Section>

          <Section id="matching" title="3. Matching the layer to the question">
            <p>
              The single most important discipline in cost-per-reportable-test work is matching the layer to the question being asked. The wrong layer applied to the right question is a worse failure than no answer at all, because a wrong layer carries the false confidence of a precise dollar figure.
            </p>
            <p>A short matching table:</p>
            <div className="overflow-x-auto my-4">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left font-semibold p-2 border-b border-border">Question</th>
                    <th className="text-left font-semibold p-2 border-b border-border w-32">Use layer</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="p-2 border-b border-border">Add a new analyte to a panel we already run</td><td className="p-2 border-b border-border font-mono">L1</td></tr>
                  <tr><td className="p-2 border-b border-border">Switch reagent vendors on an existing assay</td><td className="p-2 border-b border-border font-mono">L1</td></tr>
                  <tr><td className="p-2 border-b border-border">Send out a test we currently run in-house</td><td className="p-2 border-b border-border font-mono">L1 or L2</td></tr>
                  <tr><td className="p-2 border-b border-border">Bring a send-out back in-house, analyzer already on floor</td><td className="p-2 border-b border-border font-mono">L2</td></tr>
                  <tr><td className="p-2 border-b border-border">Buy a new analyzer (capital justification)</td><td className="p-2 border-b border-border font-mono">L3</td></tr>
                  <tr><td className="p-2 border-b border-border">Replace an aging analyzer with a different platform</td><td className="p-2 border-b border-border font-mono">L3</td></tr>
                  <tr><td className="p-2 border-b border-border">Set or defend a charge-master price</td><td className="p-2 border-b border-border font-mono">L4</td></tr>
                  <tr><td className="p-2">Build the laboratory's contribution to enterprise margin</td><td className="p-2 font-mono">L4</td></tr>
                </tbody>
              </table>
            </div>
            <p>
              The discipline becomes most important when two configurations are being compared side-by-side. A direct dollar comparison between a fully-loaded L4 calculation on one option and an L2-only calculation on the other is mathematically meaningless. The two numbers are answering different questions. An honest comparison requires the same layer be enabled on both sides.
            </p>
          </Section>

          <Section id="worked-example" title="4. Worked example: sodium under two configurations">
            <p>
              To make the framework concrete, consider two CPRT studies of a sodium assay, run on two different bench configurations.
            </p>

            <p><strong>Analyzer A (higher-volume bench, all four layers enabled):</strong></p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Annual volume: 75,000 reportable results</li>
              <li>Reagent cost per test: $0.40</li>
              <li>Other supplies per test: $0.80</li>
              <li>Calibrator kit cost: $200; calibrations per year: 8</li>
              <li>QC cost per run: $8; QC runs per year: 365</li>
              <li>Tech minutes per test: 0.40; loaded hourly rate: $45.00</li>
              <li>Instrument purchase: $250,000; useful life: 7 years; annual maintenance: $20,000</li>
              <li>Overhead: $0.05 per test (flat from finance)</li>
            </ul>
            <p>
              Layer build-up for Analyzer A: L1 = $1.26 per test. L2 = $1.56. L3 = $2.30. L4 = $2.35. Annual cost at L4 = $176,484.
            </p>

            <p><strong>Analyzer B (lower-volume bench, L1 + L2 only enabled):</strong></p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Annual volume: 50,000 reportable results</li>
              <li>Reagent cost per test: $0.45</li>
              <li>Other supplies per test: $0.10</li>
              <li>Calibrator kit cost: $200; calibrations per year: 12</li>
              <li>QC cost per run: $8; QC runs per year: 365</li>
              <li>Tech minutes per test: 0.50; loaded hourly rate: $54.99</li>
            </ul>
            <p>
              Layer build-up for Analyzer B: L1 = $0.66 per test. L2 = $1.11. L3 and L4 not calculated. Annual cost at L2 = $55,733.
            </p>

            <Callout type="warning">
              <strong>The misleading comparison.</strong> Looking at the bottom-line annual cost figures, Analyzer A costs $176,484 per year and Analyzer B costs $55,733. The naive read is that Analyzer B is dramatically cheaper. This conclusion is not supportable from the data, because the two figures are calculated at different layers. Analyzer A includes equipment depreciation and overhead. Analyzer B does not. The comparison is fully-loaded against partial.
            </Callout>

            <Callout type="tip">
              <strong>The honest comparison.</strong> To compare the two configurations fairly, both must be calculated at the same layer. At L2 (reagents and supplies plus direct labor, no equipment, no overhead), Analyzer A costs $1.56 per test and Analyzer B costs $1.11 per test. The per-test marginal cost on B is approximately 29 percent lower. Multiplied by their respective volumes, Analyzer A's L2 annual cost is approximately $117,000 and Analyzer B's is $55,733. B is still less expensive at L2, but the differential is partly volume-driven and the per-test differential is smaller than the naive figure suggested.
            </Callout>

            <p>
              <strong>The decisions each comparison supports.</strong> The L2 comparison is the right one for the question of which bench has the lower marginal cost for sodium. The L4 comparison would be the right one for setting the charge-master price, but it would require running Analyzer B's L3 and L4 calculations as well, so the comparison is matched on both sides.
            </p>
            <p>
              The honest-comparison rule, stated plainly: do not compare two layers that are not the same.
            </p>

            <Callout type="info">
              <strong>Note on the labor rates.</strong> Loaded hourly rates differ between Analyzer A ($45.00) and Analyzer B ($54.99) in this example, reflecting realistic variation in tech assignment, shift mix, and grade-level coverage across instruments within a single laboratory. Each analyzer's CPRT uses its own actual loaded rate, not a harmonized average. The honest-comparison rule from Section 3 applies to inputs as well as to layer enablement: when comparing two configurations, the differences should be the differences that actually exist, not artifacts of averaging.
            </Callout>
          </Section>

          <Section id="this-quarter" title="5. What to do this quarter">
            <p>
              The framework is theoretical until it is operationalized. Three steps a laboratory director or operations manager can take in the next ninety days.
            </p>
            <p>
              <strong>Step one.</strong> Select five to ten tests that drive the laboratory's economics. High-volume routine tests, high-cost specialty tests, and any test currently under consideration for insource, send-out, or vendor change. Do not try to build CPRT for the entire menu at once.
            </p>
            <p>
              <strong>Step two.</strong> Build the CPRT for each selected test at every layer. Use real data where it exists. For data that does not exist yet, such as overhead allocation per test, request it from finance with the framework in front of you, so the request is specific and answerable. Many laboratories find that their finance office has never been asked for a per-test overhead figure and is willing to produce one when asked.
            </p>
            <p>
              <strong>Step three.</strong> For each test, identify the open finance question and present the matching layer. A test currently under insource discussion gets an L2 calculation in the next finance meeting. A test on the capital expansion request list gets L3. A test entering charge-master review gets L4. The objective is that every cost conversation between the laboratory and finance has a defensible number behind it, drawn from the layer that fits the question.
            </p>
            <p>
              The most powerful side effect of this work is that finance starts to come to the laboratory with the right question, not the wrong one. Once a CFO or service-line director has seen one well-built L3 or L4 worksheet, they begin to recognize that the laboratory can answer the cost question in a way that supports defensible decisions. Future questions tend to be sharper and more answerable.
            </p>
          </Section>

          <Section id="clia" title="6. The CLIA context">
            <p>
              The CLIA regulations do not prescribe a cost-per-reportable-test framework. The relevant standards for the laboratory director's responsibility in this domain are 42 CFR §493.1407 (high-complexity testing) or §493.1445 (moderate-complexity testing), which together hold the laboratory director responsible for the overall operation and administration of the laboratory, including the employment of qualified personnel and assuring compliance with applicable regulations.
            </p>
            <p>
              The standard does not require CPRT. It does require that the director can defend the resource decisions made under their license. In practice, a director who cannot articulate the per-reportable-test economics of their test menu, their reagent vendor choices, and their capital posture is operating outside the spirit of that obligation even when fully inside the letter.
            </p>
            <Callout type="info">
              The four-layer framework is decision-grade discipline, not compliance theater. It exists to make the director's resource decisions explicable and defensible, both to the institution and to the director themselves.
            </Callout>
          </Section>

          <Section id="closing" title="7. Closing: VeritaOps™ and the next step">
            <p>
              The four-layer model survives the budget meeting because it answers the right question with a number that maps to that specific question. Reagent cost alone, gross annual laboratory spend alone, or a single all-in figure across the menu does not.
            </p>
            <p>
              VeritaOps™, inside the VeritaAssure™ platform, runs CPRT studies in the four-layer GP11-A structure with side-by-side comparison and a one-page PDF that finance can read without translation. The honest-comparison rule is displayed alongside every side-by-side in the comparison view, so a layer-mismatch reads at a glance whenever two studies are placed next to each other. Most laboratory teams will spend more time gathering the inputs than running the calculations, which is the right ratio.
            </p>
            <p>
              If you want to walk through the four-layer framework against a worked example before deciding whether to build it for your own menu, the operations module demonstration is here:
            </p>
            <div className="my-4 flex flex-wrap gap-3">
              <Button asChild className="bg-primary hover:bg-primary/90">
                <Link href="/demo/operations">
                  Open the VeritaOps demo <ChevronRight size={14} className="ml-1" />
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/operations">Learn about VeritaOps</Link>
              </Button>
            </div>
            <p>
              The first study in your own laboratory will be slower than the second, and the second will be slower than the third. By the fifth, the framework starts to think for you, and the conversations between the laboratory and finance start to land on the right layer the first time.
            </p>
          </Section>

          <Section id="faq" title="Frequently Asked Questions">
            {CPRT_FAQ.map(({ q, a }) => (
              <div key={q} className="border-b border-border py-4 last:border-0">
                <h3 className="font-semibold text-base mb-2">{q}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
              </div>
            ))}
          </Section>

          {/* References */}
          <Section id="references" title="References">
            <p className="text-sm">
              NCCLS. <em>Basic Cost Accounting for Clinical Services; Approved Guideline.</em> NCCLS document GP11-A. Wayne, PA: NCCLS; 1998.
            </p>
            <p className="text-sm">
              <strong>42 CFR §493.1407.</strong> Standard: Laboratory director responsibilities (high-complexity testing).
            </p>
            <p className="text-sm">
              <strong>42 CFR §493.1445.</strong> Standard: Laboratory director responsibilities (moderate-complexity testing).
            </p>
          </Section>

          {/* Bottom CTA */}
          <Card className="mt-12 border-primary/20 bg-primary/5">
            <CardContent className="p-6 sm:p-8 text-center">
              <h3 className="font-serif text-xl font-semibold mb-2">Build your first CPRT study in VeritaOps™</h3>
              <p className="text-sm text-muted-foreground max-w-xl mx-auto mb-4">
                Four layers, side-by-side comparison, one-page PDF for finance. Included in every VeritaAssure™ plan.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <Button asChild className="bg-primary hover:bg-primary/90">
                  <Link href="/demo/operations">Open the VeritaOps demo</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/pricing">View pricing</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
}
