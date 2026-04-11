import { useSEO } from "@/hooks/useSEO";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Link } from "wouter";
import { CheckCircle2, Map, ChevronRight, FlaskConical, Shield, ExternalLink } from "lucide-react";

const COLUMNS = [
  { col: "Test Name",              reg: "42 CFR §493.1251",      desc: "Every test on the menu requires a written procedure and regulatory documentation." },
  { col: "Method / Platform",      reg: "42 CFR §493.1252",      desc: "Instrument and method must be on record for each test performed." },
  { col: "Complexity (CLIA)",      reg: "42 CFR §493.15–§493.17",desc: "High, moderate, and waived tests carry different personnel, QC, and PT requirements." },
  { col: "PT Program",             reg: "42 CFR §493.801–§493.865",desc: "Regulated analytes require enrollment in a CMS-approved proficiency testing program." },
  { col: "Competency Module",      reg: "42 CFR §493.1451–§493.1495",desc: "All 6 competency assessment methods must be documented for every testing personnel member per test." },
  { col: "Linearity Required?",    reg: "42 CFR §493.1253(b)(2)",desc: "Quantitative tests require verification of the reportable range before patient testing begins." },
  { col: "Correlation Required?",  reg: "42 CFR §493.1255(b)(3)",desc: "When two or more instruments run the same test, correlation studies are required." },
  { col: "Manufacturer QC",        reg: "42 CFR §493.1256",      desc: "QC frequency and materials per manufacturer instructions, unless an IQCP is in place." },
  { col: "Reference Range Source", reg: "42 CFR §493.1253(b)(3)",desc: "Reference intervals must be established or verified for each patient population served." },
  { col: "SOP / Policy Location",  reg: "42 CFR §493.1251–§493.1252",desc: "Written procedures must be accessible at the bench and reviewed on a defined schedule." },
  { col: "IQCP Implemented?",      reg: "42 CFR §493.1256(d)",   desc: "Individualized QC Plans require a risk assessment, QC plan, and annual quality assessment." },
  { col: "Regulatory Gaps / Notes",reg: "All",                   desc: "Open items, action plans, and findings linked directly to VeritaScan domain findings." },
];

const FEATURES = [
  "Map every test to CLIA complexity, PT enrollment, and competency assignment",
  "Identify linearity and correlation gaps across the entire test menu",
  "Track QC requirements, IQCP status, and reference range sources",
  "Document SOP locations for every test. Surveyors ask, you answer",
  "Regulatory gap column links directly to VeritaScan findings",
  "Filter by specialty/section: focus on one department at a time",
  "Sort by complexity: see all high-complexity tests instantly",
  "Know your PT obligations before the enrollment deadline",
  "Last Verified and Verified By columns for review cycle tracking",
  "Built on CLIA '88 (42 CFR Part 493), CAP LAP standards, and TJC standards",
];

export default function VeritaMapPage() {
    useSEO({ title: "VeritaMap | Clinical Laboratory Test Menu Mapping Software", description: "Map your complete laboratory test menu with instrument assignments, reference ranges, and critical values. Built for CLIA compliance and accreditation surveys." });
return (
    <div>
      {/* Hero */}
      <section className="border-b border-border bg-primary/5">
        <div className="container-default py-16">
          <div className="grid lg:grid-cols-2 gap-12 items-center max-w-5xl mx-auto">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Map size={20} className="text-primary" />
                <Badge className="bg-primary/10 text-primary border-0">New Product</Badge>
                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 border">Now Live</Badge>
              </div>
              <h1 className="font-serif text-5xl font-bold mb-3 leading-tight">VeritaMap™</h1>
              <p className="text-xl text-muted-foreground font-medium mb-5">
                Laboratory Test Menu Regulatory Mapping Tool
              </p>
              <div className="border-l-4 border-primary pl-4 mb-6">
                <p className="text-base leading-relaxed italic text-foreground/90">
                  "Every test your lab runs. Every regulatory obligation it carries. In one place."
                </p>
              </div>
              <p className="text-muted-foreground leading-relaxed mb-4">
                VeritaMap is the master regulatory map for your test menu. For every test your laboratory performs, VeritaMap documents the CLIA complexity, PT enrollment, competency assignment, linearity and correlation requirements, QC obligations, reference range source, and SOP location, all mapped to the exact CFR and TJC standards that require it.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-6">
                Most laboratories discover regulatory gaps during inspections. VeritaMap finds them first.
              </p>

              <div className="flex flex-wrap gap-3 mb-8">
                <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                  <div className="text-2xl font-bold text-primary">Free</div>
                  <div className="text-xs text-muted-foreground">Up to 4 instruments & 10 analytes</div>
                </div>
                <div className="bg-card border border-border rounded-lg px-4 py-2.5 text-center">
                  <div className="text-2xl font-bold text-primary">Included</div>
                  <div className="text-xs text-muted-foreground">in Waived ($499/yr) and above</div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/veritamap-app" className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-6 py-3 rounded-lg text-sm transition-colors">
                  Launch VeritaMap →
                </Link>
                <Link href="/login" className="inline-flex items-center justify-center gap-2 border border-border hover:bg-secondary text-foreground font-semibold px-6 py-3 rounded-lg text-sm transition-colors">
                  Sign In / Create Account
                </Link>
              </div>
            </div>

            {/* Right: visual */}
            <div className="flex justify-center lg:justify-end">
              <div className="relative">
                <div className="w-64 h-80 bg-gradient-to-br from-[#0e8a82] to-[#0a5e58] rounded-lg shadow-2xl flex flex-col p-6 text-white">
                  <div className="flex items-center gap-2 mb-4">
                    <Map size={20} className="text-white/80" />
                    <span className="font-serif font-bold text-lg">VeritaMap™</span>
                  </div>
                  <div className="space-y-2 flex-1">
                    {["Glucose · Chem · Mod · PT ✓","HgbA1C · Chem · Mod · Lin ✓","CBC · Heme · Mod · Corr ✓","PT/INR · Coag · Mod · PT ✓","Blood Cx · Micro · High · -","Urine Cx · Micro · High · -","ABO/Rh · BB · High · Corr ✓","UA Dipstick · UA · Waived · -"].map((t, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.includes("✓") ? "bg-green-400" : "bg-amber-400"}`} />
                        <span className="text-white/80 font-mono">{t}</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-white/20 pt-3 mt-2">
                    <div className="text-xs text-white/60">207 tests · 42 gaps found</div>
                  </div>
                </div>
                <div className="absolute -bottom-2 -right-2 w-64 h-80 bg-black/20 rounded-lg -z-10" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* What it is */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="grid lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2 space-y-5">
              <h2 className="font-serif text-3xl font-bold">What is VeritaMap?</h2>
              <p className="text-muted-foreground leading-relaxed">
                Every clinical laboratory has a test menu. Every test on that menu carries a specific set of regulatory obligations: a CLIA complexity designation, a proficiency testing requirement, a competency assessment obligation, a linearity or correlation study requirement, a quality control standard, a reference range verification requirement, and a written procedure. Most laboratories track these obligations inconsistently, if at all.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                VeritaMap is the infrastructure that makes every obligation visible. One row per test. One column per regulatory requirement. Every cell mapped to the exact 42 CFR section and TJC standards that mandate it. The result is a complete, auditable picture of your laboratory's regulatory obligations across the entire test menu, and a clear view of where the gaps are before a surveyor finds them.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                VeritaMap is designed to be permanent infrastructure. Unlike a self-inspection that happens once before a survey, VeritaMap is updated when tests are added, instruments change, PT programs shift, or competency assignments are reassigned. A laboratory that maintains a current VeritaMap can answer any regulatory question about any test in seconds, because the documentation is already there.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                When VeritaMap identifies that a test requires linearity verification, one click opens VeritaCheck to run the study. When it flags a competency gap, it links directly to the corresponding VeritaScan finding for the corrective action workflow. The three tools are designed to work together.
              </p>
              <p className="text-base font-semibold text-foreground">
                Know your obligations. Document your compliance. Find the gaps before the survey does.
              </p>
            </div>

            {/* Stat cards */}
            <div className="space-y-4">
              {[
                { stat: "12", label: "Regulatory data points per test" },
                { stat: "3", label: "Regulatory authorities mapped (CLIA, CAP, TJC)" },
                { stat: "∞", label: "Tests supported, no menu size limit" },
              ].map((s, i) => (
                <div key={i} className="bg-muted/30 border border-border rounded-xl p-4 text-center">
                  <div className="font-serif text-4xl font-bold text-primary mb-1">{s.stat}</div>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              ))}
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
                <div className="text-xs font-semibold text-primary mb-1">Integrates with</div>
                <div className="space-y-1.5">
                  <Link href="/veritacheck" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                    <FlaskConical size={12} />VeritaCheck™ - run linearity & correlation studies
                  </Link>
                  <Link href="/veritascan" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                    <Shield size={12} />VeritaScan™ - link gaps to domain findings
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 12 columns */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">12 Regulatory Data Points Per Test</h2>
          <p className="text-muted-foreground mb-8">Every column mapped to the specific regulation that requires it.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {COLUMNS.map((c, i) => (
              <div key={i} className="border border-border rounded-xl p-4 bg-card hover:bg-muted/20 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="font-semibold text-sm">{c.col}</div>
                  <code className="text-xs text-primary bg-primary/10 px-1.5 py-0.5 rounded shrink-0">{c.reg}</code>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">What's Included</h2>
          <p className="text-muted-foreground mb-8">Everything your lab needs to map, track, and maintain regulatory compliance across the full test menu.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-start gap-2.5 text-sm">
                <CheckCircle2 size={15} className="text-primary mt-0.5 shrink-0" />
                <span className="text-muted-foreground">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="section-padding border-b border-border bg-muted/20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">Pricing</h2>
          <p className="text-muted-foreground mb-8">Start free. Upgrade when you're ready.</p>
          <div className="grid sm:grid-cols-2 gap-6 max-w-2xl">

            <Card className="border-2 border-border">
              <CardContent className="p-6">
                <div className="font-bold text-lg mb-1">Starter</div>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-4xl font-bold">Free</span>
                </div>
                <p className="text-sm text-muted-foreground mb-5">
                  Try free: up to 4 instruments and 10 analytes per map.
                </p>
                <ul className="space-y-2 mb-6">
                  {["Up to 4 instruments per map","Up to 10 analytes per map","All 12 regulatory columns","Regulatory gap tracking"].map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 size={13} className="text-primary shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <Link href="/veritamap-app" className="block w-full border border-primary rounded-lg py-2.5 text-sm font-semibold text-primary text-center hover:bg-primary/5 transition-colors">
                  Launch VeritaMap
                </Link>
              </CardContent>
            </Card>

            <Card className="border-2 border-primary bg-primary/5 relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-primary text-primary-foreground">Full Access</Badge>
              </div>
              <CardContent className="p-6">
                <div className="font-bold text-lg mb-1">VeritaAssure&#8482; Suite</div>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-sm text-muted-foreground">from</span>
                  <span className="text-4xl font-bold">$499</span>
                  <span className="text-sm text-muted-foreground">/year</span>
                </div>
                <p className="text-sm text-muted-foreground mb-5">
                  Unlimited instruments and analytes. Full regulatory gap report. CLIA tier-based pricing determined by your certificate.
                </p>
                <ul className="space-y-2 mb-6">
                  {["Unlimited instruments and analytes","Full regulatory gap report PDF","VeritaCheck + VeritaScan included","Annual review cycle tracking","Priority support"].map(f => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 size={13} className="text-primary shrink-0" />{f}
                    </li>
                  ))}
                </ul>
                <Link href="/pricing" className="block w-full bg-primary hover:bg-primary/90 rounded-lg py-2.5 text-sm font-semibold text-primary-foreground text-center transition-colors">
                  View All Plans →
                </Link>
              </CardContent>
            </Card>
          </div>

          {/* Full suite callout */}
          <div className="mt-6 max-w-2xl">
            <div className="bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20 rounded-xl p-5">
              <div className="font-bold text-base mb-1">
                VeritaAssure&#8482; Suite: <span className="text-primary">Starting at $499/year</span>
                <Badge className="ml-2 bg-primary text-primary-foreground text-xs">Full Suite</Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-3">
                The complete clinical laboratory regulatory compliance platform. All three tools, VeritaCheck, VeritaScan, and VeritaMap, in one plan.
              </p>
              <div className="grid sm:grid-cols-3 gap-3 mb-3">
                {[
                  { icon: <FlaskConical size={14} />, name: "VeritaCheck™", desc: "Unlimited EP studies" },
                  { icon: <Shield size={14} />, name: "VeritaScan™", desc: "Self-inspection audit" },
                  { icon: <Map size={14} />, name: "VeritaMap™", desc: "Test menu mapping" },
                ].map((t, i) => (
                  <div key={i} className="bg-card border border-border rounded-lg p-3 text-center">
                    <div className="flex items-center justify-center gap-1 text-primary mb-1">{t.icon}<span className="font-semibold text-xs">{t.name}</span></div>
                    <div className="text-xs text-muted-foreground">{t.desc}</div>
                  </div>
                ))}
              </div>
              <Link href="/pricing" className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-medium">
                View all plans <ChevronRight size={13} />
              </Link>
            </div>
          </div>

          <p className="text-xs text-muted-foreground mt-5">
            Questions?{" "}
            <a href="mailto:info@veritaslabservices.com?subject=VeritaMap Purchase Inquiry" className="text-primary hover:underline">
              Contact us
            </a>
          </p>
        </div>
      </section>

      {/* Who it's for */}
      <section className="section-padding border-b border-border">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <h2 className="font-serif text-3xl font-bold mb-2">Who This Is For</h2>
          <p className="text-muted-foreground mb-8">Any laboratory that wants to know its regulatory obligations, before a surveyor does.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { title: "Laboratory Directors", desc: "You're responsible for every test on that menu. Know what each one requires and where your documentation lives." },
              { title: "Quality Managers", desc: "Your QA program can't monitor what it can't see. VeritaMap makes every obligation visible and trackable." },
              { title: "New Lab Administrators", desc: "Inherited a test menu with unknown compliance status? VeritaMap tells you where you stand for every test, fast." },
              { title: "Lab Compliance Consultants", desc: "Deploy VeritaMap at every client engagement. Consistent, defensible, citation-mapped. The same tool every time." },
              { title: "Survey-Prep Teams", desc: "Surveyors ask about specific tests. VeritaMap means you can answer, with documentation, for any test in seconds." },
              { title: "Growing Laboratories", desc: "Adding tests? VeritaMap ensures every new test is mapped to its regulatory obligations before the first patient result." },
            ].map((item, i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-4">
                <div className="font-semibold text-sm mb-1.5">{item.title}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section-padding">
        <div className="max-w-xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-serif text-2xl font-bold mb-3">Ready to map your test menu?</h2>
          <p className="text-muted-foreground mb-6">
            VeritaMap is live. Select your instruments, pull the FDA-cleared test menu, and have a compliance map for your lab in minutes.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              <Link href="/veritamap-app">Launch VeritaMap <ChevronRight size={15} className="ml-1" /></Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/login">Sign In / Create Account</Link>
            </Button>
          </div>
          <div className="mt-6 flex flex-col gap-2 items-center">
            <Link href="/veritacheck" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
              <FlaskConical size={14} />Also try VeritaCheck - EP studies<ChevronRight size={13} />
            </Link>
            <Link href="/veritascan" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium">
              <Shield size={14} />Also try VeritaScan - inspection readiness<ChevronRight size={13} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
