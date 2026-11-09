import { useSEO } from "@/hooks/useSEO";
import { TEA_ARTICLE_FAQ } from "@/lib/faqContent";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, Clock, FlaskConical, User, AlertTriangle, ExternalLink, Search } from "lucide-react";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { ContentUpgrade } from "@/components/ContentUpgrade";
import { teaData } from "@/lib/cliaTeaData";

function Callout({ children, type = "info" }: { children: React.ReactNode; type?: "info" | "warning" | "tip" }) {
  const styles = {
    info: "border-primary/20 bg-primary/5",
    warning: "border-amber-300 bg-amber-50 dark:bg-amber-950/30",
    tip: "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30",
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

const teaSampleTable = [
  { analyte: "Glucose", criteria: "±8% or ±6 mg/dL (greater)", cfr: "§493.931" },
  { analyte: "Sodium", criteria: "±4 mmol/L", cfr: "§493.931" },
  { analyte: "Creatinine", criteria: "±10% or ±0.2 mg/dL (greater)", cfr: "§493.931" },
  { analyte: "Hemoglobin", criteria: "±4%", cfr: "§493.941" },
  { analyte: "Troponin I", criteria: "±30% or ±0.9 ng/mL (greater)", cfr: "§493.931" },
  { analyte: "TSH", criteria: "±20% or ±0.2 mIU/L (greater)", cfr: "§493.933" },
  { analyte: "INR", criteria: "±15%", cfr: "§493.941" },
  { analyte: "Potassium", criteria: "±0.3 mmol/L", cfr: "§493.931" },
];

export default function ArticleTeaPage() {
    useSEO({ title: "CLIA Total Allowable Error (TEa): 2026 Limits by Specialty", description: "The 2026 CLIA total allowable error (TEa) limits for every regulated analyte, by specialty, with 42 CFR §493 citations. Free printable PDF table." });
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
            CLIA Allowable Error (TEa): What It Is, Where to Find It, and Why Most Lab Directors Don't Know About It
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            In four years and more than 200 inspections as a Joint Commission laboratory surveyor, I regularly encountered a pattern: labs evaluating calibration verification against manufacturer-stated allowable error, unaware that CLIA publishes a PT acceptance limit for every regulated analyte, which a medical director or designee may adopt as the cal ver criterion. This article explains what CLIA TEa is, where it lives in the Code of Federal Regulations, what it was written to do, and what to document if your lab adopts it.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground border-t border-border pt-4">
            <span className="flex items-center gap-1.5"><User size={12} /> Michael Veri, Former Joint Commission Surveyor, CPHQ</span>
            <span className="flex items-center gap-1.5"><Clock size={12} /> 10 min read</span>
            <span>Published March 2026 · Updated November 2026</span>
          </div>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">

        {/* 2026 limits at a glance (SEO refresh 2026-11-09). eCFR history checked 2026-11-09: no Subpart I acceptance
            limit changed in substance after CMS-3355-F took effect on 2024-07-11 (493.945, gyn cytology PT, is not a TEa). */}
        <Callout type="info">
          <strong>Looking for the 2026 limits?</strong> The CLIA acceptable limits in effect for 2026 are the values from the CLIA proficiency testing final rule (CMS-3355-F), effective July 11, 2024. Look up any analyte in the <Link href="/resources/clia-tea-lookup" className="text-primary hover:underline">TEa Lookup</Link>, or download the full table as a PDF below.
        </Callout>

        {/* Content upgrade: TEa reference table (lead-capture experiment) */}
        <ContentUpgrade
          source="upgrade-tea-table"
          assetUrl="/clia-tea-reference-2026.pdf"
          assetName="2026-CLIA-TEa-Reference-Table.pdf"
          title="Download the 2026 CLIA TEa reference table (PDF)"
          description="The CLIA proficiency testing acceptance limits in one printable table, grouped by specialty with the CFR section. Free."
        />

        {/* Key Takeaways */}
        <Card className="border-primary/20 bg-primary/5 mb-10">
          <CardContent className="p-5">
            <div className="font-semibold text-sm text-primary mb-3">Key Takeaways</div>
            <ul className="space-y-2">
              {[
                "CLIA TEa (Total Allowable Error) is the federally defined PT acceptable performance criterion for every regulated analyte",
                "It lives in 42 CFR Part 493, Subpart I: a publicly accessible, free government document",
                "Some laboratories use manufacturer-stated limits and some adopt the CLIA PT limit. Manufacturer limits vary: some are tighter than the CLIA PT limit and some are wider",
                "CLIA leaves the calibration verification criterion to the laboratory. A medical director or designee may adopt a PT limit, and should document why it fits the clinical need",
                "CMS said in the preamble to its 2022 PT rule (CMS-3355-F) that PT limits were written to grade proficiency testing and weren't intended as performance goals. That is preamble text, not regulation text",
                "The CLIA proficiency testing final rule (CMS-3355-F, published July 11, 2022) updated TEa values for many analytes, effective July 11, 2024. If your lab adopted PT limits, check that it carries the current values",
              ].map(t => (
                <li key={t} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 size={13} className="text-primary shrink-0 mt-0.5" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="space-y-6 text-[15px] leading-relaxed">

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">The Pattern I Saw on Survey</h2>
          <p>
            During my time as a Joint Commission laboratory surveyor, I encountered a consistent pattern across facilities of every size and complexity level. When I asked lab directors what criteria they used to evaluate calibration verification pass/fail, the most common answer was "the manufacturer's allowable error." Some said "our internal lab policy." A smaller number said "CLIA TEa."
          </p>
          <p>
            None of those answers is wrong on its face. CLIA does not specify numeric acceptance criteria for calibration verification: §493.1253(b)(3) and §493.1255(b)(2) require the lab to establish and document criteria, and the choice belongs to the medical director or designee. For accuracy and precision, the regulation's comparison is the manufacturer's claim (§493.1253(b)(1)(i)). A director may adopt the CLIA PT limit as the cal ver criterion, and should document why it fits the clinical need.
          </p>
          <p>
            This is not a criticism of those directors. CLIA is a complex regulatory framework, and the TEa tables are buried in a subsection of a subsection of the Code of Federal Regulations. Nobody hands you a copy when you become lab director. You're expected to find it yourself.
          </p>
          <p>
            This article tells you exactly where to find it and what to do with it.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What Is CLIA TEa?</h2>
          <p>
            CLIA TEa (Total Allowable Error) is the maximum permissible difference between a laboratory's result and the target value for a given analyte on proficiency testing, as defined in <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">42 CFR Part 493</a>. It is expressed as a percentage, an absolute value, or a combination of both (whichever is greater applies).
          </p>
          <p>
            For example, the CLIA TEa for glucose is <strong>±8% or ±6 mg/dL, whichever is greater</strong>. That means at a glucose value of 50 mg/dL, the ±6 mg/dL absolute criterion governs (because 8% of 50 = 4 mg/dL, which is less than 6). At a glucose of 200 mg/dL, the ±8% criterion governs (because 8% of 200 = 16 mg/dL, which is greater than 6). This dual-criterion structure accounts for the fact that percentage error is less meaningful at very low concentrations.
          </p>

          <Callout type="info">
            <strong>The CFR applies these limits to one thing:</strong> grading proficiency testing (PT). Calibration verification limits are set by the laboratory under §493.1253(b)(3) and §493.1255(b)(2). A laboratory that uses a PT limit for calibration verification is making its own documented decision.
          </Callout>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Where to Find It in the CFR</h2>
          <p>
            CLIA TEa values are published in <strong>42 CFR Part 493, Subpart I</strong> ("Proficiency Testing Programs for Nonwaived Testing"). The relevant sections:
          </p>
          <div className="bg-muted/40 rounded-lg border border-border p-4 space-y-2 text-sm font-mono my-4">
            <div><span className="text-primary font-semibold">§493.927</span> - PT acceptance criteria, general immunology (alpha-1 antitrypsin, AFP, ANA, complement, hepatitis markers, immunoglobulins...)</div>
            <div><span className="text-primary font-semibold">§493.931</span> - PT acceptance criteria, routine chemistry (glucose, sodium, creatinine, troponin, lipids, liver enzymes, BNP...)</div>
            <div><span className="text-primary font-semibold">§493.933</span> - PT acceptance criteria, endocrinology (TSH, free T4, cortisol, hCG, vitamin B12...)</div>
            <div><span className="text-primary font-semibold">§493.937</span> - PT acceptance criteria, toxicology (digoxin, phenytoin, lithium, carbamazepine, acetaminophen...)</div>
            <div><span className="text-primary font-semibold">§493.941</span> - PT acceptance criteria, hematology (CBC, differential, fibrinogen, PT, INR, aPTT...)</div>
            <div><span className="text-primary font-semibold">§493.959</span> - PT acceptance criteria, immunohematology (ABO group, D (Rho) typing, unexpected antibody detection, compatibility testing, antibody identification)</div>
          </div>
          <p>
            Every section is publicly available at <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ecfr.gov</a> at no cost. The CFR is a US government publication and is in the public domain. You can read, reproduce, and share it freely. There is no paywalled version.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Sample TEa Values: Current CLIA Criteria</h2>
          <p>The table below shows a representative sample. The CLIA proficiency testing final rule (CMS-3355-F, published July 11, 2022, effective July 11, 2024) updated values for many analytes, tightening some significantly.</p>

          <div className="overflow-x-auto my-4 rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 border-b border-border">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-xs text-muted-foreground">ANALYTE</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-xs text-muted-foreground">ACCEPTABLE PERFORMANCE</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-xs text-muted-foreground">CFR</th>
                </tr>
              </thead>
              <tbody>
                {teaSampleTable.map((row, i) => (
                  <tr key={row.analyte} className={`border-b border-border ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                    <td className="px-4 py-2.5 font-medium">{row.analyte}</td>
                    <td className="px-4 py-2.5 text-primary font-semibold">Target value {row.criteria}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{row.cfr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-center my-6">
            <Button asChild size="lg" className="bg-primary text-primary-foreground gap-2 whitespace-normal h-auto max-w-full text-center">
              <Link href="/resources/clia-tea-lookup">
                <Search size={15} /> Search All {teaData.length} Analytes in the Free TEa Lookup Tool
              </Link>
            </Button>
          </div>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Manufacturer Criteria and CLIA PT Limits</h2>
          <p>
            Manufacturer criteria are a vendor performance claim, not a federally published acceptance limit, and they are still what the regulation points to. 42 CFR §493.1253(b)(1)(i) asks a laboratory to show accuracy and precision comparable to those established by the manufacturer, and §493.1255(b)(1) has it follow the manufacturer's calibration verification instructions. Manufacturer-stated allowable error is the performance claim made in the package insert or instrument specification sheet, based on what the manufacturer's testing showed the system can achieve.
          </p>
          <p>
            Manufacturer limits vary. Some are tighter than the CLIA PT limit and some are wider. A medical director or designee may adopt the CLIA PT limit as the cal ver criterion under §493.1255(b)(2), and should document why it fits the clinical need. CMS said in the preamble to CMS-3355-F (87 FR 41194, July 11, 2022) that PT limits were written to grade proficiency testing and weren't intended as performance goals, and that goals for accuracy and precision should rest on clinical needs and the manufacturer's labeling. That is preamble text, not regulation text, and it is why the record should state the reason for the choice, not only the number. For glucose, that record names ±8% or ±6 mg/dL from 42 CFR §493.931, the §493.1255(b)(2) adoption, and the clinical reason the limit fits.
          </p>

          <Callout type="warning">
            <strong>Check your criteria against the current CFR.</strong> The CLIA PT final rule (CMS-3355-F, published July 11, 2022, effective July 11, 2024) tightened limits for several high-volume analytes. Glucose moved from ±10% to ±8%. Creatinine moved from ±15% to ±10%. If your laboratory adopted PT limits as its calibration verification criteria, check that your template carries the current values.
          </Callout>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Setting an Internal Goal</h2>
          <p>
            CLIA sets no internal goal; the laboratory sets its own criterion. Some laboratories budget a fraction of allowable total error for a given study, and rules of thumb differ: Westgard uses one-third of TEa for bias on calibration verification, and Data Innovations recommends 25 to 50 percent for systematic error. The medical director or designee decides and should document why.
          </p>
          <p>
            Whether to adopt a fraction of TEa, a PT limit, the manufacturer's limit, or something else is a laboratory director or designee decision. The deciding factors are your patient population and clinical context, and the decision should be documented.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">How to Apply TEa to Calibration Verification</h2>
          <p>To apply TEa to calibration verification, calculate each calibration level's difference from its target, compare it to the TEa your laboratory adopted using the criterion that governs at that concentration, and pass the study only if every level falls within it. The mechanics are straightforward once your medical director or designee has set the criterion:</p>
          <ol className="list-decimal list-inside space-y-2 pl-2">
            <li>For each calibration level, calculate: <strong>% difference = (observed − expected) ÷ expected × 100</strong></li>
            <li>For analytes with dual criteria (% or absolute, whichever is greater), calculate the absolute difference too: <strong>|observed − expected|</strong></li>
            <li>Apply the appropriate criterion based on which is greater at that concentration</li>
            <li>If all levels fall within TEa: <strong>PASS</strong>. If any level exceeds TEa: <strong>FAIL</strong>. Investigate before reporting patient results</li>
            <li>Document the criterion, its source (the 42 CFR citation if it is a PT limit), and why it fits the clinical need in your study report for surveyor reference</li>
          </ol>
          <p>If you are evaluating a platform to manage verification like this across your whole test menu, here is how to choose <Link href="/resources/how-to-choose-lab-compliance-software" className="text-primary hover:underline">lab compliance software</Link>.</p>

          {/* VeritaCheck CTA */}
          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 my-8">
            <div className="flex items-start gap-3">
              <FlaskConical size={20} className="text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">VeritaCheck® does all of this automatically</div>
                <p className="text-sm text-muted-foreground mb-3">
                  Select your analyte, enter your calibration levels, and VeritaCheck® can apply the current CLIA PT limit when your lab uses one, or a criterion your director adopts. It handles the dual-criterion logic, calculates % error and absolute error at each level, and generates a CFR-cited PDF report ready for director or designee signature. Your first two studies are free.
                </p>
                <div className="flex gap-2 flex-wrap">
                  <Button asChild size="sm" className="bg-primary text-primary-foreground text-xs">
                    <Link href="/veritacheck">Run a Free Study <ChevronRight size={12} className="ml-1" /></Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="text-xs">
                    <Link href="/resources/clia-tea-lookup">Browse TEa Values <Search size={12} className="ml-1" /></Link>
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Frequently Asked Questions</h2>

          {TEA_ARTICLE_FAQ.map(({ q, a }) => (
            <div key={q} className="border-b border-border py-5 last:border-0">
              <h3 className="font-semibold text-base mb-2">{q}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
            </div>
          ))}

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Conclusion</h2>
          <p>
            CLIA TEa is not obscure knowledge reserved for compliance specialists. It is public federal law, freely available, and it governs how your PT is graded. The fact that most lab directors don't know it exists is a gap in how laboratory science education approaches regulatory competency, not a reflection of those directors' capabilities.
          </p>
          <p>
            Now you know where it is. Use the lookup tool to find your analytes. If your lab adopts a PT limit, put the limit, the CFR citation, and the reason it fits the clinical need in your calibration verification procedure and study reports. When a surveyor asks how you determined your acceptability criteria, you'll have the answer.
          </p>

          <p className="mt-8 text-[15px] leading-relaxed">
            Related reading: total allowable error is also the anchor for designing quality control to each method. See{" "}
            <Link href="/resources/quality-control-testing-into-compliance" className="text-primary font-medium hover:underline">when quality control stops working <ChevronRight size={13} className="inline" /></Link>.
          </p>

          {/* Newsletter */}
          <NewsletterSignup variant="inline" source="article-tea" />

          {/* Final CTA */}
          <div className="rounded-xl bg-primary text-primary-foreground p-7 mt-10 text-center">
            <Search size={28} className="mx-auto mb-3 opacity-80" />
            <h3 className="font-serif text-xl font-bold mb-2">Look up your analytes now</h3>
            <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
              The CLIA PT limit table: {teaData.length} analytes across chemistry, endocrinology, hematology, coagulation, immunology, immunohematology, and toxicology. Free, no login required.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
                <Link href="/resources/clia-tea-lookup">Open TEa Lookup Tool <Search size={15} className="ml-1" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
                <Link href="/veritacheck">Run a Free Study in VeritaCheck® <ExternalLink size={13} className="ml-1" /></Link>
              </Button>
            </div>
          </div>

          {/* References */}
          <div className="mt-10 pt-6 border-t border-border">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">References</div>
            <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
              <li>Code of Federal Regulations. (2024). Title 42, Part 493, Subpart I. <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ecfr.gov</a></li>
              <li>Centers for Medicare & Medicaid Services. (2022). CLIA Proficiency Testing Regulations Related to Analytes and Acceptable Performance, final rule (CMS-3355-F), 87 FR 41194. <a href="https://www.cms.gov" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">cms.gov</a></li>
              <li>Westgard JO. (2024). 2025 CLIA Acceptance Limits for Proficiency Testing. <a href="https://www.westgard.com/clia-and-quality-regulation-requirements/quality-requirements/2024-clia-requirements.html" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">westgard.com</a></li>
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
                Michael Veri is a US Army veteran with 23 years of Army Reserve service, former Joint Commission Laboratory Surveyor with 200+ facility inspections, and CPHQ-certified healthcare quality professional. He is the developer of VeritaCheck®, VeritaScan®, and VeritaMap®, available at veritaslabservices.com.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
