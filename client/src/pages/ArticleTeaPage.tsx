import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, Clock, FlaskConical, User, AlertTriangle, ExternalLink, Search } from "lucide-react";
import { NewsletterSignup } from "@/components/NewsletterSignup";

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
  { analyte: "Hemoglobin", criteria: "±7% or ±1.0 g/dL (greater)", cfr: "§493.941" },
  { analyte: "Troponin I", criteria: "±30% or ±0.9 ng/mL (greater)", cfr: "§493.931" },
  { analyte: "TSH", criteria: "±20% or ±0.2 mIU/L (greater)", cfr: "§493.933" },
  { analyte: "INR", criteria: "±15%", cfr: "§493.941" },
  { analyte: "Potassium", criteria: "±0.3 mmol/L", cfr: "§493.931" },
];

export default function ArticleTeaPage() {
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
            In four years and more than 200 inspections as a Joint Commission laboratory surveyor, I regularly encountered a pattern: labs evaluating calibration verification against manufacturer-stated allowable error, unaware that the regulatory standard, defined in federal law, already exists for every analyte they test. This article explains what CLIA TEa is, where it lives in the Code of Federal Regulations, and why your lab should be using it.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground border-t border-border pt-4">
            <span className="flex items-center gap-1.5"><User size={12} /> Michael Veri, Former Joint Commission Surveyor, CPHQ</span>
            <span className="flex items-center gap-1.5"><Clock size={12} /> 10 min read</span>
            <span>March 2026</span>
          </div>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">

        {/* Key Takeaways */}
        <Card className="border-primary/20 bg-primary/5 mb-10">
          <CardContent className="p-5">
            <div className="font-semibold text-sm text-primary mb-3">Key Takeaways</div>
            <ul className="space-y-2">
              {[
                "CLIA TEa (Total Allowable Error) is the federally mandated acceptable performance standard for every regulated analyte",
                "It lives in 42 CFR Part 493, Subpart H: a publicly accessible, free government document",
                "Most labs use manufacturer-stated allowable error instead, which may be more lenient than federal law requires",
                "Using CLIA TEa for calibration verification makes your pass/fail evaluation defensible to any accreditation surveyor",
                "The 2025 CLIA Final Rule updated TEa values for many analytes, effective July 11, 2024. Your lab may be using outdated criteria",
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
            The ones who said CLIA TEa were right. The others weren't wrong exactly, CLIA doesn't prohibit using manufacturer criteria, but they were often using a standard less rigorous than what federal law already defines, sometimes without knowing the federal standard existed.
          </p>
          <p>
            This is not a criticism of those directors. CLIA is a complex regulatory framework, and the TEa tables are buried in a subsection of a subsection of the Code of Federal Regulations. Nobody hands you a copy when you become lab director. You're expected to find it yourself.
          </p>
          <p>
            This article tells you exactly where to find it and what to do with it.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What Is CLIA TEa?</h2>
          <p>
            CLIA TEa (Total Allowable Error) is the maximum permissible difference between a laboratory's result and the target value for a given analyte, as defined in <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">42 CFR Part 493</a>. It is expressed as a percentage, an absolute value, or a combination of both (whichever is greater applies).
          </p>
          <p>
            For example, the CLIA TEa for glucose is <strong>±8% or ±6 mg/dL, whichever is greater</strong>. That means at a glucose value of 50 mg/dL, the ±6 mg/dL absolute criterion governs (because 8% of 50 = 4 mg/dL, which is less than 6). At a glucose of 200 mg/dL, the ±8% criterion governs (because 8% of 200 = 16 mg/dL, which is greater than 6). This dual-criterion structure accounts for the fact that percentage error is less meaningful at very low concentrations.
          </p>

          <Callout type="info">
            <strong>TEa governs two things:</strong> Proficiency testing (PT) grading, your PT results are evaluated against TEa, and calibration verification pass/fail evaluation. Many labs know the PT connection but miss the calibration verification application.
          </Callout>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Where to Find It in the CFR</h2>
          <p>
            CLIA TEa values are published in <strong>42 CFR Part 493, Subpart H</strong>: "Participation in Proficiency Testing for Laboratories Performing Nonwaived Testing." The relevant sections:
          </p>
          <div className="bg-muted/40 rounded-lg border border-border p-4 space-y-2 text-sm font-mono my-4">
            <div><span className="text-primary font-semibold">§493.927</span> - General Immunology (alpha-1 antitrypsin, AFP, ANA, complement, hepatitis markers, immunoglobulins...)</div>
            <div><span className="text-primary font-semibold">§493.931</span> - Routine Chemistry (glucose, sodium, creatinine, troponin, lipids, liver enzymes, BNP...)</div>
            <div><span className="text-primary font-semibold">§493.933</span> - Endocrinology (TSH, T4, T3, cortisol, FSH, LH, estradiol, testosterone...)</div>
            <div><span className="text-primary font-semibold">§493.937</span> - Toxicology (digoxin, phenytoin, lithium, carbamazepine, acetaminophen...)</div>
            <div><span className="text-primary font-semibold">§493.941</span> - Hematology (CBC, differential, fibrinogen, PT, INR, aPTT...)</div>
            <div><span className="text-primary font-semibold">§493.959</span> - Immunohematology (ABO, Rh, antibody detection, compatibility...)</div>
          </div>
          <p>
            Every section is publicly available at <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ecfr.gov</a> at no cost. The CFR is a US government publication and is in the public domain. You can read, reproduce, and share it freely. There is no paywalled version.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Sample TEa Values: 2025 CLIA Final Rule</h2>
          <p>The table below shows a representative sample. The 2025 CLIA Final Rule (effective July 11, 2024) updated values for many analytes, tightening some significantly.</p>

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
            <Button asChild size="lg" className="bg-primary text-primary-foreground gap-2">
              <Link href="/resources/clia-tea-lookup">
                <Search size={15} /> Search All {76}+ Analytes in the Free TEa Lookup Tool
              </Link>
            </Button>
          </div>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Why Manufacturer Criteria Aren't Always Sufficient</h2>
          <p>
            Manufacturer-stated allowable error is the performance claim made in the package insert or instrument specification sheet. It is based on what the manufacturer's testing showed their system can achieve, not on what regulators determined is acceptable for patient safety.
          </p>
          <p>
            In some cases, manufacturer claims are more stringent than CLIA TEa. In others, they are more lenient. The critical point: <strong>only CLIA TEa is the regulatory standard.</strong> If a surveyor asks how you determined your calibration verification was acceptable, "the manufacturer said so" is a defensible answer, but "42 CFR §493.931 establishes ±8% or ±6 mg/dL for glucose, and all five of our calibration levels fell within that range" is a better one.
          </p>

          <Callout type="warning">
            <strong>Check your current criteria against the 2025 update.</strong> The July 2024 CLIA Final Rule tightened TEa for several high-volume analytes. Glucose moved from ±10% to ±8%. Creatinine moved from ±15% to ±10%. If your lab's calibration verification template still uses the old values, you may be accepting results that no longer meet the current regulatory standard.
          </Callout>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">The ADLM Recommendation: Half of CLIA TEa</h2>
          <p>
            The <a href="https://www.adlm.org" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Association for Diagnostics & Laboratory Medicine (ADLM)</a> recommends that laboratories adopt internal performance goals at <strong>half of the CLIA TEa</strong>, providing a quality margin that keeps results well within acceptable performance even under normal analytical variation.
          </p>
          <p>
            For glucose, that means an internal goal of ±4% or ±3 mg/dL (half of the CLIA TEa of ±8% or ±6 mg/dL). Using half TEa as an internal standard doesn't change what you report to regulators. It simply gives your quality program a tighter target that reduces the risk of marginal results.
          </p>
          <p>
            Whether to adopt ADLM recommendations is a laboratory director or designee decision. The regulatory floor is CLIA TEa. The quality ceiling is whatever your director or designee determines is appropriate for your patient population and clinical context.
          </p>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">How to Apply TEa to Calibration Verification</h2>
          <p>The mechanics are straightforward once you have the correct TEa value:</p>
          <ol className="list-decimal list-inside space-y-2 pl-2">
            <li>For each calibration level, calculate: <strong>% difference = (observed − expected) ÷ expected × 100</strong></li>
            <li>For analytes with dual criteria (% or absolute, whichever is greater), calculate the absolute difference too: <strong>|observed − expected|</strong></li>
            <li>Apply the appropriate criterion based on which is greater at that concentration</li>
            <li>If all levels fall within TEa: <strong>PASS</strong>. If any level exceeds TEa: <strong>FAIL</strong>. Investigate before reporting patient results</li>
            <li>Document the TEa source (42 CFR citation) in your study report for surveyor reference</li>
          </ol>

          {/* VeritaCheck CTA */}
          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 my-8">
            <div className="flex items-start gap-3">
              <FlaskConical size={20} className="text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">VeritaCheck™ does all of this automatically</div>
                <p className="text-sm text-muted-foreground mb-3">
                  Select your analyte, enter your calibration levels, and VeritaCheck applies the correct 2025 CLIA TEa automatically, handling the dual-criterion logic, calculating % error and absolute error at each level, and generating a CLIA-compliant PDF report with the CFR citation included. Your first study is free.
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

          {[
            {
              q: "Does CLIA require labs to use CLIA TEa for calibration verification, or can we use manufacturer criteria?",
              a: "CLIA does not explicitly mandate that labs use TEa for calibration verification pass/fail evaluation. It mandates that calibration verification be performed and documented. However, CLIA TEa is the regulatory acceptable performance standard for the same analytes, and using it makes your criteria directly defensible to surveyors. Using manufacturer criteria that are more lenient than CLIA TEa creates a risk: you could pass your own internal study while exceeding the federal regulatory standard."
            },
            {
              q: "What's the difference between TEa used for proficiency testing and TEa used for calibration verification?",
              a: "It's the same table: the TEa values in 42 CFR Part 493 apply to both. For proficiency testing, they define whether your PT results are graded as acceptable. For calibration verification, they define whether your instrument's performance at each calibration level is acceptable. The regulatory authority is the same; the application differs."
            },
            {
              q: "Our analyte isn't in the CLIA TEa table. What do we use?",
              a: "If an analyte isn't regulated under CLIA proficiency testing requirements, there is no federally mandated TEa. In that case, labs should use manufacturer-stated allowable error, biological variation-based goals (from EFLM or RCPA tables), or medical decision-based criteria established by the laboratory director or designee. Document the rationale for whatever criteria you choose."
            },
            {
              q: "How often does CLIA TEa change?",
              a: "Infrequently, but the 2025 CLIA Final Rule was the first major update in decades for many analytes. Before that, some values dated to 1992. The July 2024 effective date made this the largest single update to CLIA acceptable performance criteria in the modern era. Check the current eCFR rather than relying on reference cards or QC software that may not have been updated."
            },
            {
              q: "What does 'target value ±X% or ±Y units, whichever is greater' mean in practice?",
              a: "The dual criterion accounts for concentration-dependent error. At low concentrations, a fixed percentage can be smaller than what's analytically meaningful, so the absolute value floor protects the criterion from being trivially easy to pass near zero. Apply both. The one that allows a larger absolute difference is the governing criterion at that concentration."
            },
          ].map(({ q, a }) => (
            <div key={q} className="border-b border-border py-5 last:border-0">
              <h3 className="font-semibold text-base mb-2">{q}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
            </div>
          ))}

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Conclusion</h2>
          <p>
            CLIA TEa is not obscure knowledge reserved for compliance specialists. It is public federal law, freely available, and directly applicable to every calibration verification study your lab performs. The fact that most lab directors don't know it exists is a gap in how laboratory science education approaches regulatory competency, not a reflection of those directors' capabilities.
          </p>
          <p>
            Now you know where it is. Use the lookup tool to find your analytes. Update your calibration verification templates. Cite the CFR in your study reports. When a surveyor asks how you determined your acceptability criteria, you'll have the answer.
          </p>

          {/* Newsletter */}
          <NewsletterSignup variant="inline" source="article-tea" />

          {/* Final CTA */}
          <div className="rounded-xl bg-primary text-primary-foreground p-7 mt-10 text-center">
            <Search size={28} className="mx-auto mb-3 opacity-80" />
            <h3 className="font-serif text-xl font-bold mb-2">Look up your analytes now</h3>
            <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
              The complete 2025 CLIA TEa table: all 76+ analytes across chemistry, hematology, immunology, endocrinology, toxicology, coagulation, and blood bank. Free, no login required.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
                <Link href="/resources/clia-tea-lookup">Open TEa Lookup Tool <Search size={15} className="ml-1" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
                <Link href="/veritacheck">Run a Free Study in VeritaCheck <ExternalLink size={13} className="ml-1" /></Link>
              </Button>
            </div>
          </div>

          {/* References */}
          <div className="mt-10 pt-6 border-t border-border">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">References</div>
            <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
              <li>Code of Federal Regulations. (2024). Title 42, Part 493, Subpart H. <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ecfr.gov</a></li>
              <li>Centers for Medicare & Medicaid Services. (2024). CLIA Proficiency Testing: Analytes and Acceptable Performance Final Rule (CMS-3355-F). <a href="https://www.cms.gov" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">cms.gov</a></li>
              <li>Westgard JO. (2024). 2025 CLIA Acceptance Limits for Proficiency Testing. <a href="https://www.westgard.com/clia-a-quality/quality-requirements/2024-clia-requirements.html" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">westgard.com</a></li>
              <li>Association for Diagnostics & Laboratory Medicine. (2024). Quality Management Guidelines. <a href="https://www.adlm.org" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">adlm.org</a></li>
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
                Michael Veri is a US Army veteran with 22 years of military leadership, former Joint Commission Laboratory Surveyor with 200+ facility inspections, and CPHQ-certified healthcare quality professional. He is the developer of VeritaCheck™, VeritaScan™, and VeritaMap™, available at veritaslabservices.com.
              </p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
